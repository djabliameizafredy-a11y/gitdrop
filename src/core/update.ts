import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PAGES_WORKFLOW_PATH, detectDeploy, enablePages, pagesBase, pagesWorkflow } from './deploy.js'
import { git } from './git.js'
import { createPullRequest, getDefaultBranch } from './github.js'
import { commitAll, explainPushError, identityConfig, trackProgress } from './push.js'
import { scanSecrets } from './secrets.js'
import type { PushEvent } from './types.js'

type User = { login: string; id: number }

export async function isGitRepo(dir: string): Promise<boolean> {
  return (await git(['rev-parse', '--is-inside-work-tree'], { cwd: dir })).code === 0
}

export async function originUrl(dir: string): Promise<string | null> {
  const r = await git(['remote', 'get-url', 'origin'], { cwd: dir })
  return r.code === 0 ? r.stdout.trim() : null
}

/** `https://github.com/o/r.git`, `git@github.com:o/r.git` or a local path → `o/r`. */
export function repoFromRemote(url: string): string | null {
  const parts = url
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .filter(Boolean)
  return parts.length >= 2 ? `${parts.at(-2)}/${parts.at(-1)}` : null
}

export async function currentBranch(dir: string): Promise<string> {
  return (await git(['symbolic-ref', '--short', 'HEAD'], { cwd: dir })).stdout.trim()
}

/** Sensitive files among pending changes (modified, untracked or already staged). Stages nothing. */
export async function pendingSecrets(dir: string) {
  const list = async (args: string[]) => (await git(args, { cwd: dir })).stdout.split('\0').filter(Boolean)
  const names = [
    ...new Set([
      ...(await list(['ls-files', '-m', '-o', '--exclude-standard', '-z'])),
      ...(await list(['diff', '--cached', '--name-only', '--diff-filter=AM', '-z'])),
    ]),
  ]
  const candidates = []
  for (const rel of names) {
    const abs = path.join(dir, rel)
    const s = await stat(abs).catch(() => null)
    if (s?.isFile()) candidates.push({ relPath: rel, absPath: abs, size: s.size })
  }
  return { pending: names.length, sensitive: await scanSecrets(candidates) }
}

export interface UpdateArgs {
  token: string
  user: User
  dir: string
  message: string
  /** Work on this branch (created if needed) instead of the current one. */
  branch?: string
  /** Open a pull request for the branch against the default branch. */
  pr?: boolean
  emit?: (ev: PushEvent) => void
}

export interface UpdateOutcome {
  committed: boolean
  branch: string
  prUrl?: string
}

async function switchBranch(dir: string, name: string): Promise<void> {
  const exists = (await git(['rev-parse', '--verify', `refs/heads/${name}`], { cwd: dir })).code === 0
  const r = await git(exists ? ['checkout', name] : ['checkout', '-b', name], { cwd: dir })
  if (r.code !== 0) throw new Error(`Impossible de passer sur la branche « ${name} » : ${r.stderr.trim()}`)
}

/** Commits pending changes (if any), pushes the branch to `origin`, optionally opens a PR. */
export async function runUpdate(args: UpdateArgs): Promise<UpdateOutcome> {
  const { token, user, dir, message, emit } = args
  const origin = await originUrl(dir)
  if (!origin) throw new Error('Aucun remote « origin » : utilisez « gitdrop push » pour créer le dépôt.')
  const fullName = repoFromRemote(origin)

  let defaultBranch = ''
  if (args.pr) {
    if (!fullName) throw new Error('Impossible de déterminer le dépôt GitHub à partir de « origin ».')
    defaultBranch = await getDefaultBranch(token, fullName)
    const target = args.branch ?? (await currentBranch(dir))
    if (target === defaultBranch) {
      throw new Error(`Vous êtes sur « ${defaultBranch} » : indiquez une branche avec --branch pour ouvrir une pull request.`)
    }
  }
  if (args.branch && args.branch !== (await currentBranch(dir))) await switchBranch(dir, args.branch)

  const result = await commitAll(dir, message, user)
  const branch = await currentBranch(dir)
  if (!branch) throw new Error('HEAD est détaché : placez-vous sur une branche avant de pousser.')
  const push = await git(['push', '--progress', '-u', 'origin', branch], {
    cwd: dir,
    token,
    onStderr: emit ? trackProgress(emit) : undefined,
  })
  if (push.code !== 0) throw new Error(explainPushError(push.stderr))

  let prUrl: string | undefined
  if (args.pr && fullName) {
    const subject = (await git(['log', '-1', '--format=%s'], { cwd: dir })).stdout.trim() || message
    prUrl = (await createPullRequest(token, fullName, { title: subject, head: branch, base: defaultBranch })).html_url
  }
  return { committed: result === 'committed', branch, prUrl }
}

/**
 * Cancels the last pushed commit safely: creates a revert commit and pushes it (no force-push,
 * history stays intact for everyone).
 */
export async function undoLastPush(args: { token: string; user: User; dir: string; emit?: (ev: PushEvent) => void }) {
  const { token, user, dir } = args
  const branch = await currentBranch(dir)
  if (!branch) throw new Error('HEAD est détaché : placez-vous sur une branche.')
  const head = (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  const remote = await git(['rev-parse', `refs/remotes/origin/${branch}`], { cwd: dir })
  if (remote.code !== 0 || remote.stdout.trim() !== head) {
    throw new Error('Le dernier commit n’est pas celui poussé sur GitHub : rien à annuler automatiquement.')
  }
  const subject = (await git(['log', '-1', '--format=%s'], { cwd: dir })).stdout.trim()
  const parents = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: dir })).stdout.trim().split(' ').length - 1
  if (parents === 0) throw new Error('C’est le tout premier commit : il n’y a rien à annuler avant lui.')
  const revert = await git(['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), 'HEAD'], {
    cwd: dir,
    config: await identityConfig(dir, user),
  })
  if (revert.code !== 0) {
    await git(['revert', '--abort'], { cwd: dir })
    throw new Error(`L’annulation a échoué (conflit ?) : ${(revert.stderr || revert.stdout).trim().split('\n')[0]}`)
  }
  const push = await git(['push', '--progress', '-u', 'origin', branch], {
    cwd: dir,
    token,
    onStderr: args.emit ? trackProgress(args.emit) : undefined,
  })
  if (push.code !== 0) throw new Error(explainPushError(push.stderr))
  return { branch, subject }
}

/** Adds the GitHub Pages workflow to an already published repository and enables Pages. */
export async function deployExisting(args: { token: string; user: User; dir: string; emit?: (ev: PushEvent) => void }) {
  const { token, user, dir } = args
  const origin = await originUrl(dir)
  const fullName = origin ? repoFromRemote(origin) : null
  if (!fullName) throw new Error('Aucun remote « origin » GitHub : utilisez « gitdrop push » d’abord.')
  const repo = fullName.split('/')[1]
  const plan = await detectDeploy(dir)
  if (!plan) {
    throw new Error('Ce projet ne peut pas être publié automatiquement (supportés : site statique, Vite, Create React App).')
  }
  const siteUrl = await enablePages(token, fullName, `https://${user.login}.github.io${pagesBase(user.login, repo)}`)
  await mkdir(path.join(dir, '.github', 'workflows'), { recursive: true })
  await writeFile(path.join(dir, PAGES_WORKFLOW_PATH), pagesWorkflow(plan, user.login, repo), 'utf8')
  const branch = await currentBranch(dir)
  const committed = await commitAll(dir, 'ci: deploy to GitHub Pages', user)
  const push = await git(['push', '--progress', '-u', 'origin', branch], {
    cwd: dir,
    token,
    onStderr: args.emit ? trackProgress(args.emit) : undefined,
  })
  if (push.code !== 0) throw new Error(explainPushError(push.stderr))
  return { siteUrl, branch, committed: committed === 'committed' }
}
