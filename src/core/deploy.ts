import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { GitHubError, apiBase } from './github.js'
import type { DeployInfo } from './types.js'

interface Pkg {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface DeployPlan extends DeployInfo {
  /** Folder uploaded to GitHub Pages (relative to the repo root). */
  outputDir: string
  manager: 'npm' | 'yarn' | 'pnpm'
  hasLock: boolean
}

async function readPkg(dir: string): Promise<Pkg | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as Pkg
  } catch {
    return null
  }
}

function manager(dir: string): { manager: DeployPlan['manager']; hasLock: boolean } {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { manager: 'pnpm', hasLock: true }
  if (existsSync(path.join(dir, 'yarn.lock'))) return { manager: 'yarn', hasLock: true }
  return { manager: 'npm', hasLock: existsSync(path.join(dir, 'package-lock.json')) }
}

/**
 * Decides whether a project can be published on GitHub Pages as-is. Only setups whose base path
 * can be handled safely are supported: plain static sites, Vite and Create React App.
 */
export async function detectDeploy(dir: string): Promise<DeployPlan | null> {
  const pkg = await readPkg(dir)
  const m = manager(dir)
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const hasBuild = !!pkg?.scripts?.build

  if (pkg && hasBuild) {
    if (deps['@sveltejs/kit'] || deps.next || deps.nuxt || deps['@remix-run/react']) return null // SSR frameworks
    if (deps.vite) return { kind: 'vite', label: 'Vite (build + GitHub Pages)', outputDir: 'dist', ...m }
    if (deps['react-scripts']) return { kind: 'cra', label: 'Create React App (build + GitHub Pages)', outputDir: 'build', ...m }
    return null
  }
  if (existsSync(path.join(dir, 'index.html'))) {
    return { kind: 'static', label: 'Site statique (GitHub Pages)', outputDir: '.', ...m }
  }
  return null
}

/** A Node project with build/test scripts can get a CI workflow. */
export async function detectCi(dir: string): Promise<boolean> {
  const pkg = await readPkg(dir)
  return !!(pkg?.scripts?.build || pkg?.scripts?.test)
}

const run = (m: DeployPlan['manager'], script: string, args = '') => {
  const a = args ? ` ${m === 'npm' ? '-- ' : ''}${args}` : ''
  return `${m === 'npm' ? 'npm run' : m} ${script}${a}`
}

const install = (p: Pick<DeployPlan, 'manager' | 'hasLock'>) =>
  p.manager === 'pnpm' ? 'pnpm install --frozen-lockfile' : p.manager === 'yarn' ? 'yarn install --frozen-lockfile' : p.hasLock ? 'npm ci' : 'npm install'

export const PAGES_WORKFLOW_PATH = '.github/workflows/gitdrop-pages.yml'
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'

/** Base path under which GitHub Pages serves the repository. */
export const pagesBase = (login: string, repo: string) =>
  repo.toLowerCase() === `${login.toLowerCase()}.github.io` ? '/' : `/${repo}/`

export function pagesWorkflow(plan: DeployPlan, login: string, repo: string): string {
  const base = pagesBase(login, repo)
  const steps: string[] = ['      - uses: actions/checkout@v4']
  if (plan.kind !== 'static') {
    if (plan.manager === 'pnpm') steps.push('      - uses: pnpm/action-setup@v4\n        with:\n          version: 9')
    steps.push('      - uses: actions/setup-node@v4\n        with:\n          node-version: 20')
    steps.push(`      - run: ${install(plan)}`)
    if (plan.kind === 'vite') {
      steps.push(`      - run: ${run(plan.manager, 'build', `--base=${base}`)}`)
    } else {
      steps.push(`      - run: ${run(plan.manager, 'build')}\n        env:\n          PUBLIC_URL: ${base === '/' ? '' : base.replace(/\/$/, '')}`)
    }
  }
  steps.push('      - uses: actions/configure-pages@v5')
  steps.push(`      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: ${plan.outputDir}`)
  steps.push('      - id: deployment\n        uses: actions/deploy-pages@v4')

  return `# Généré par Gitdrop — publie le site sur GitHub Pages à chaque push sur main.
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
${steps.join('\n')}
`
}

export async function ciWorkflow(dir: string): Promise<string> {
  const pkg = (await readPkg(dir)) ?? {}
  const m = manager(dir)
  const steps = ['      - uses: actions/checkout@v4']
  if (m.manager === 'pnpm') steps.push('      - uses: pnpm/action-setup@v4\n        with:\n          version: 9')
  steps.push('      - uses: actions/setup-node@v4\n        with:\n          node-version: 20')
  steps.push(`      - run: ${install(m)}`)
  if (pkg.scripts?.build) steps.push(`      - run: ${run(m.manager, 'build')}`)
  if (pkg.scripts?.test) steps.push(`      - run: ${run(m.manager, 'test')}`)
  return `# Généré par Gitdrop — build et tests à chaque push / pull request.
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
${steps.join('\n')}
`
}

/** Enables GitHub Pages with the "GitHub Actions" source. Returns the site URL. */
export async function enablePages(token: string, fullName: string, fallbackUrl: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'gitdrop',
    'Content-Type': 'application/json',
  }
  let res: Response
  try {
    res = await fetch(`${apiBase()}/repos/${fullName}/pages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ build_type: 'workflow' }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new GitHubError(0, 'Impossible de joindre GitHub pour activer Pages.', 'network')
  }
  const json = (await res.json().catch(() => null)) as { html_url?: string; message?: string } | null
  if (res.status === 201 || res.status === 409) {
    return json?.html_url ?? fallbackUrl
  }
  if (res.status === 403 || res.status === 422) {
    throw new GitHubError(
      res.status,
      'GitHub Pages n’est pas disponible pour ce dépôt (un dépôt privé exige un plan payant). Rendez-le public ou publiez le site ailleurs.'
    )
  }
  throw new GitHubError(res.status, json?.message || `Activation de Pages impossible (${res.status}).`)
}
