import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DetectedStack } from './detect.js'
import { CI_WORKFLOW_PATH, PAGES_WORKFLOW_PATH, ciWorkflow, detectDeploy, enablePages, pagesBase, pagesWorkflow } from './deploy.js'
import { buildEnvExample, envExampleName } from './envexample.js'
import { GitHubError, createRepo, isEmptyRepo, setTopics, webBase } from './github.js'
import { isLicenseId, licenseText } from './license.js'
import type { LicenseId } from './license.js'
import { GitMissingError, git, gitVersion } from './git.js'
import { buildGitignore, ignorePattern } from './gitignore.js'
import { hasLicense, hasReadme } from './project.js'
import { generateReadme } from './readme.js'
import type { PushEvent } from './types.js'
import { hardSkipPatterns, walkProject } from './walk.js'

export interface PushConfig {
  repoName: string
  visibility: 'public' | 'private'
  description?: string
  addReadme: boolean
  addGitignore: boolean
  commitMessage: string
  excludePaths: string[]
  /** Generate a LICENSE file when the project has none. */
  license?: LicenseId
  /** Create a `.env.example` (names only) next to each excluded `.env` file. */
  envExample?: boolean
  /** Push a single fresh commit instead of the project's existing Git history. */
  freshHistory?: boolean
  /** Generate a CI workflow (build/test) for Node projects. */
  ci?: boolean
  /** Publish the site on GitHub Pages (static, Vite, CRA). */
  deploy?: boolean
  /** Extra repository topics (the stack is added automatically). */
  topics?: string[]
}

export interface PushOutcome {
  url: string
  fullName: string
  fileCount: number
  totalSize: number
  siteUrl?: string
}

export interface PushArgs {
  token: string
  user: { login: string; id: number; name?: string | null }
  projectDir: string
  stack: DetectedStack
  config: PushConfig
  emit: (ev: PushEvent) => void
}

export const PUSH_STEPS = [
  { id: 'files', label: 'Préparation des fichiers' },
  { id: 'commit', label: 'Création du commit' },
  { id: 'repo', label: 'Création du dépôt GitHub' },
  { id: 'push', label: 'Envoi vers GitHub (branche main)' },
  { id: 'deploy', label: 'Publication sur GitHub Pages' },
] as const

type StepId = (typeof PUSH_STEPS)[number]['id']

/** Base URL used for git transport (overridable for tests). */
export const gitBase = () => process.env.GITDROP_GIT_BASE || webBase()

const BLOCK_START = '# >>> gitdrop'
const BLOCK_END = '# <<< gitdrop'

const sanitizeTopic = (t: string) =>
  t.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)

async function pushRef(dir: string, token: string, remoteUrl: string, ref: string, emit: (ev: PushEvent) => void) {
  const r = await git(['push', '--progress', remoteUrl, `${ref}:refs/heads/main`], {
    cwd: dir,
    token,
    onStderr: trackProgress(emit),
  })
  if (r.code !== 0) throw new Error(explainPushError(r.stderr))
}

/** Keeps junk and user exclusions out of the commit without touching the project's own files. */
async function writeLocalExcludes(dir: string, lines: string[]): Promise<void> {
  const infoDir = path.join(dir, '.git', 'info')
  await mkdir(infoDir, { recursive: true })
  const file = path.join(infoDir, 'exclude')
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    existing = ''
  }
  const start = existing.indexOf(BLOCK_START)
  const end = existing.indexOf(BLOCK_END)
  if (start !== -1 && end > start) {
    existing = existing.slice(0, start) + existing.slice(end + BLOCK_END.length + 1)
  }
  const block = [BLOCK_START, ...lines, BLOCK_END].join('\n') + '\n'
  await writeFile(file, existing.replace(/\s*$/, '\n') + block, 'utf8')
}

async function initRepo(dir: string): Promise<void> {
  let r = await git(['init', '-b', 'main'], { cwd: dir })
  if (r.code !== 0) {
    // git < 2.28 has no -b
    r = await git(['init'], { cwd: dir })
    if (r.code !== 0) throw new Error(`git init a échoué : ${firstLines(r.stderr)}`)
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir })
  }
}

function firstLines(text: string, n = 4): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/^(remote|error|fatal):\s*/i, '').trim())
      .filter(Boolean)
      .slice(-n)
      .join(' · ') || 'erreur inconnue'
  )
}

export function explainPushError(stderr: string): string {
  if (/GH013|push protection|Push cannot contain secrets|secret scanning/i.test(stderr)) {
    const link = /https:\/\/github\.com\/\S*unblock-secret\S*/i.exec(stderr)?.[0]
    return (
      'GitHub a bloqué le push : un secret (clé API, token…) a été détecté dans un fichier. ' +
      'Retirez-le du projet puis relancez.' +
      (link ? ` Pour l’autoriser malgré tout : ${link}` : '')
    )
  }
  if (/without [`']?workflow[`']? scope|workflow.*scope/i.test(stderr)) {
    return 'Le token n’a pas le scope « workflow » (requis pour .github/workflows). Relancez « gitdrop login ».'
  }
  if (/GH001|exceeds GitHub's file size limit|this exceeds/i.test(stderr)) {
    return 'Un fichier dépasse la limite de 100 Mo de GitHub. Retirez-le du projet.'
  }
  if (/Authentication failed|Invalid username or token|returned error: (401|403)|Permission to .* denied/i.test(stderr)) {
    return 'GitHub a refusé l’authentification pour le push. Relancez « gitdrop login » (scope « repo » requis).'
  }
  if (/Could not resolve host|unable to access|Failed to connect|timed out/i.test(stderr)) {
    return 'Impossible de joindre GitHub. Vérifiez votre connexion réseau.'
  }
  return `Le push a échoué : ${firstLines(stderr)}`
}

/** `-c` config that gives commits an author when the machine has no Git identity. */
export async function identityConfig(dir: string, user: { login: string; id: number }): Promise<string[]> {
  const config = ['commit.gpgsign=false']
  const name = await git(['config', 'user.name'], { cwd: dir })
  const email = await git(['config', 'user.email'], { cwd: dir })
  if (!name.stdout.trim()) config.push(`user.name=${user.login}`)
  if (!email.stdout.trim()) config.push(`user.email=${user.id}+${user.login}@users.noreply.github.com`)
  return config
}

/** Commits staged changes if any. Returns false when there was nothing to commit and no history. */
export async function commitAll(
  dir: string,
  message: string,
  user: { login: string; id: number }
): Promise<'committed' | 'clean' | 'empty'> {
  const add = await git(['add', '-A'], { cwd: dir })
  if (add.code !== 0) throw new Error(`git add a échoué : ${firstLines(add.stderr)}`)

  const hasHead = (await git(['rev-parse', '--verify', 'HEAD'], { cwd: dir })).code === 0
  const staged = (await git(['diff', '--cached', '--quiet'], { cwd: dir })).code === 1
  if (!staged) return hasHead ? 'clean' : 'empty'

  const commit = await git(['commit', '--no-verify', '-m', message.trim() || 'Initial commit'], {
    cwd: dir,
    config: await identityConfig(dir, user),
  })
  if (commit.code !== 0) throw new Error(`git commit a échoué : ${firstLines(commit.stderr || commit.stdout)}`)
  return 'committed'
}

export function trackProgress(emit: (ev: PushEvent) => void) {
  return (chunk: string) => {
    const all = [...chunk.matchAll(/Writing objects:\s+(\d+)%/g)]
    const last = all.at(-1)
    if (last) emit({ type: 'progress', percent: Number(last[1]) })
  }
}

/**
 * Full pipeline: prepare files → local commit → create the GitHub repo → git push to main.
 * The repo is created only after the local commit succeeded, so a local failure never leaves
 * an empty repository behind. Uses the real `git` binary (reliable, fast, keeps history).
 */
export async function runPush(args: PushArgs): Promise<PushOutcome> {
  const { token, user, projectDir: dir, stack, config, emit } = args
  const label = (id: StepId) => PUSH_STEPS.find((s) => s.id === id)!.label
  const step = (id: StepId, status: 'running' | 'done' | 'error') =>
    emit({ type: 'step', id, label: label(id), status })
  const fail = <T extends Error>(id: StepId, e: T): never => {
    step(id, 'error')
    throw e
  }

  if (!(await gitVersion())) throw new GitMissingError()

  // 1. Files: generated .gitignore / README, repo init, local excludes.
  step('files', 'running')
  try {
    const gitignorePath = path.join(dir, '.gitignore')
    const hasGitignore = existsSync(gitignorePath)
    if (!hasGitignore && config.addGitignore) {
      await writeFile(gitignorePath, buildGitignore(stack.id, config.excludePaths), 'utf8')
    } else if (hasGitignore && config.excludePaths.length) {
      const existing = await readFile(gitignorePath, 'utf8').catch(() => '')
      const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()))
      const missing = config.excludePaths.map(ignorePattern).filter((p) => !have.has(p))
      if (missing.length) {
        await writeFile(gitignorePath, existing.replace(/\s*$/, '\n') + missing.join('\n') + '\n', 'utf8')
      }
    }
    if (!hasReadme(dir) && config.addReadme) {
      await writeFile(
        path.join(dir, 'README.md'),
        generateReadme({ repoName: config.repoName, description: config.description, stack, username: user.login }),
        'utf8'
      )
    }
    if (config.license && isLicenseId(config.license) && !hasLicense(dir)) {
      await writeFile(path.join(dir, 'LICENSE'), licenseText(config.license, user.name || user.login), 'utf8')
    }
    if (config.envExample !== false) {
      for (const rel of config.excludePaths) {
        const target = envExampleName(rel)
        if (!target || existsSync(path.join(dir, target))) continue
        const content = buildEnvExample(await readFile(path.join(dir, rel), 'utf8').catch(() => ''))
        if (content) await writeFile(path.join(dir, target), content, 'utf8')
      }
    }
    if (config.ci && !existsSync(path.join(dir, CI_WORKFLOW_PATH))) {
      await mkdir(path.join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(path.join(dir, CI_WORKFLOW_PATH), await ciWorkflow(dir), 'utf8')
    }
    if (!existsSync(path.join(dir, '.git'))) await initRepo(dir)

    const walk = await walkProject(dir)
    const excludes = [
      ...hardSkipPatterns(dir),
      ...config.excludePaths.map(ignorePattern),
      ...walk.oversized.map((f) => ignorePattern(f.relPath)),
    ]
    await writeLocalExcludes(dir, excludes.filter((l) => !l.includes('\n')))
    if (walk.files.length === 0 && !existsSync(path.join(dir, '.git', 'refs', 'heads'))) {
      throw new Error('Aucun fichier à pousser : tout est exclu ou ignoré.')
    }
  } catch (e) {
    return fail('files', e as Error)
  }
  step('files', 'done')

  // 2. Local commit.
  step('commit', 'running')
  try {
    const result = await commitAll(dir, config.commitMessage, user)
    if (result === 'empty') throw new Error('Aucun fichier à pousser : tout est exclu ou ignoré.')
  } catch (e) {
    return fail('commit', e as Error)
  }
  step('commit', 'done')

  // 3. GitHub repository (an empty repo left by an interrupted run is reused).
  step('repo', 'running')
  const fullName = `${user.login}/${config.repoName}`
  let url = `${webBase()}/${fullName}`
  try {
    try {
      const created = await createRepo(token, {
        name: config.repoName,
        private: config.visibility === 'private',
        description: config.description?.trim() || undefined,
      })
      url = created.html_url || url
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'exists' && (await isEmptyRepo(token, fullName))) {
        emit({ type: 'warning', message: 'Un dépôt vide portant ce nom existait déjà : il a été réutilisé.' })
      } else {
        throw e
      }
    }
  } catch (e) {
    return fail('repo', e as Error)
  }
  step('repo', 'done')

  // 4. Push.
  step('push', 'running')
  const remoteUrl = `${gitBase()}/${fullName}.git`
  let ref = 'HEAD'
  if (config.freshHistory) {
    const tree = (await git(['rev-parse', 'HEAD^{tree}'], { cwd: dir })).stdout.trim()
    const c = await git(['commit-tree', tree, '-m', config.commitMessage.trim() || 'Initial commit'], {
      cwd: dir,
      config: await identityConfig(dir, user),
    })
    ref = c.stdout.trim()
    if (c.code !== 0 || !ref) {
      step('push', 'error')
      throw new Error('Impossible de créer le commit propre (sans historique).')
    }
  }
  try {
    await pushRef(dir, token, remoteUrl, ref, emit)
  } catch (e) {
    step('push', 'error')
    throw new Error(`${(e as Error).message} (Le dépôt vide est prêt : ${url} — relancez pour réessayer.)`)
  }
  step('push', 'done')

  // Wire up `origin` so plain `git push` and `gitdrop update` keep working. With a fresh history the
  // local and remote histories differ on purpose, so the local repo is left untouched.
  let wired = false
  if (!config.freshHistory) {
    const remotes = (await git(['remote'], { cwd: dir })).stdout.split(/\s+/).filter(Boolean)
    if (!remotes.includes('origin')) {
      await git(['remote', 'add', 'origin', remoteUrl], { cwd: dir })
      const branch = (await git(['symbolic-ref', '--short', 'HEAD'], { cwd: dir })).stdout.trim()
      if (branch === 'main') {
        await git(['config', 'branch.main.remote', 'origin'], { cwd: dir })
        await git(['config', 'branch.main.merge', 'refs/heads/main'], { cwd: dir })
        // The push went straight to the URL, so record what origin/main now points to.
        await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir })
        wired = true
      }
    }
  }

  // Topics: best effort, never fatal.
  try {
    const topics = [...new Set([stack.id, ...(config.topics ?? [])].map(sanitizeTopic).filter(Boolean))].slice(0, 20)
    if (topics.length) await setTopics(token, fullName, topics)
  } catch (e) {
    emit({ type: 'warning', message: `Topics non ajoutés : ${(e as Error).message}` })
  }

  // 5. GitHub Pages (optional, never fatal). The workflow goes in a second commit, after Pages is
  // enabled, so its very first run does not fail.
  let siteUrl: string | undefined
  if (config.deploy) {
    step('deploy', 'running')
    try {
      const plan = await detectDeploy(dir)
      if (!plan) throw new Error('Ce projet ne peut pas être publié automatiquement sur GitHub Pages.')
      const fallback = `https://${user.login}.github.io${pagesBase(user.login, config.repoName)}`
      siteUrl = await enablePages(token, fullName, fallback)
      await mkdir(path.join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(path.join(dir, PAGES_WORKFLOW_PATH), pagesWorkflow(plan, user.login, config.repoName), 'utf8')
      const message = 'ci: deploy to GitHub Pages'
      if (config.freshHistory) {
        await git(['add', '-A'], { cwd: dir })
        const tree = (await git(['write-tree'], { cwd: dir })).stdout.trim()
        const c = await git(['commit-tree', tree, '-p', ref, '-m', message], { cwd: dir, config: await identityConfig(dir, user) })
        await pushRef(dir, token, remoteUrl, c.stdout.trim(), emit)
      } else {
        await commitAll(dir, message, user)
        await pushRef(dir, token, remoteUrl, 'HEAD', emit)
        if (wired) await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir })
      }
      step('deploy', 'done')
    } catch (e) {
      step('deploy', 'error')
      siteUrl = undefined
      emit({ type: 'warning', message: `Le dépôt est en ligne, mais pas le site : ${(e as Error).message}` })
    }
  }

  const tree = await git(['ls-tree', '-r', '-l', 'HEAD'], { cwd: dir })
  let fileCount = 0
  let totalSize = 0
  for (const line of tree.stdout.split('\n')) {
    const m = /^\d+ \w+ [0-9a-f]+\s+(\d+|-)\t/.exec(line)
    if (!m) continue
    fileCount++
    totalSize += m[1] === '-' ? 0 : Number(m[1])
  }
  return { url, fullName, fileCount, totalSize, siteUrl }
}
