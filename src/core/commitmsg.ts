import path from 'node:path'
import { git } from './git.js'

interface Change {
  status: string
  file: string
}

const DOCS = /(^|\/)(docs?\/|readme|license|changelog|contributing)|\.(md|mdx|txt|rst)$/i
const TESTS = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i
const DEPS = /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[\w.-]*\.txt|composer\.(json|lock)|go\.(mod|sum)|Cargo\.(toml|lock)|pubspec\.(yaml|lock))$/
const CI = /(^|\/)(\.github\/|\.gitlab-ci|Dockerfile|docker-compose|\.circleci\/)/

async function pending(dir: string): Promise<Change[]> {
  const r = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: dir })
  const out: Change[] = []
  const parts = r.stdout.split('\0').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    const x = entry[0]
    const y = entry[1]
    let status = x !== ' ' && x !== '?' ? x : y
    if (entry.startsWith('??')) status = 'A'
    if (x === 'R' || x === 'C') i++ // the old path follows
    out.push({ status, file: entry.slice(3) })
  }
  return out
}

const label = (files: string[]) => {
  const names = files.slice(0, 3).map((f) => path.basename(f))
  return names.join(', ') + (files.length > 3 ? ` +${files.length - 3} more` : '')
}

/**
 * Builds a Conventional-Commits message from the pending changes (no network, no AI):
 * the type comes from what changed, the subject from the file names.
 */
export async function suggestCommitMessage(dir: string): Promise<string> {
  const changes = await pending(dir)
  if (changes.length === 0) return 'chore: update'
  const files = changes.map((c) => c.file)
  const all = (re: RegExp) => files.every((f) => re.test(f))

  if (all(DOCS)) return `docs: update ${label(files)}`
  if (all(TESTS)) return `test: update ${label(files)}`
  if (all(DEPS)) return 'chore(deps): update dependencies'
  if (all(CI)) return `ci: update ${label(files)}`
  if (changes.every((c) => c.status === 'D')) return `chore: remove ${label(files)}`
  if (changes.every((c) => c.status === 'A')) return `feat: add ${label(files)}`
  return `chore: update ${label(files)}`
}
