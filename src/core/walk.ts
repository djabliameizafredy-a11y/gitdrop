import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isIgnored, parseIgnoreRules } from './gitignore.js'

/** Folders that are never pushed (dependencies, caches, build tooling). */
export const HARD_SKIP_DIRS = [
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', '.turbo',
  '.cache', 'coverage', '.gradle', '.parcel-cache', '.nuxt', '.output', '.expo', 'Pods',
  '.dart_tool', '.idea', '.svelte-kit', '.angular',
]
export const HARD_SKIP_FILES = ['.DS_Store', 'Thumbs.db']

/**
 * `vendor/` only holds dependencies at the root of a PHP, Go, Ruby or Rust project. Anywhere else
 * (e.g. `assets/vendor/` in a website) it contains real files that must be pushed.
 */
export function vendorIsDependencies(projectDir: string): boolean {
  return ['composer.json', 'go.mod', 'Gemfile', 'Cargo.toml'].some((f) => existsSync(path.join(projectDir, f)))
}

/** Lines written to `.git/info/exclude` so Git never stages dependency/cache folders. */
export function hardSkipPatterns(projectDir: string): string[] {
  return [
    ...HARD_SKIP_DIRS.filter((d) => d !== '.git').map((d) => `${d}/`),
    ...(vendorIsDependencies(projectDir) ? ['/vendor/'] : []),
    ...HARD_SKIP_FILES,
  ]
}

/** GitHub rejects files above 100 MB; stay safely below. */
export const MAX_FILE_BYTES = 90 * 1024 * 1024

const SKIP_DIRS = new Set(HARD_SKIP_DIRS)
const SKIP_FILES = new Set(HARD_SKIP_FILES)

export interface WalkedFile {
  absPath: string
  relPath: string
  size: number
}

export interface WalkResult {
  files: WalkedFile[]
  totalSize: number
  skippedDirs: string[]
  oversized: WalkedFile[]
}

/** Recursively collects the files that would be pushed (own .gitignore + hard skips applied). */
export async function walkProject(projectDir: string): Promise<WalkResult> {
  let rules: string[] = []
  try {
    rules = parseIgnoreRules(await readFile(path.join(projectDir, '.gitignore'), 'utf8'))
  } catch {
    rules = []
  }

  const skipVendor = vendorIsDependencies(projectDir)
  const files: WalkedFile[] = []
  const skippedDirs: string[] = []
  const oversized: WalkedFile[] = []
  let totalSize = 0

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (skipVendor && !rel && entry.name === 'vendor')) {
          skippedDirs.push(relPath)
          continue
        }
        if (isIgnored(relPath, rules)) continue
        await walk(abs, relPath)
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue
        if (isIgnored(relPath, rules)) continue
        const s = await stat(abs)
        const f = { absPath: abs, relPath, size: s.size }
        if (s.size > MAX_FILE_BYTES) {
          oversized.push(f)
          continue
        }
        files.push(f)
        totalSize += s.size
      }
    }
  }

  await walk(projectDir, '')
  return { files, totalSize, skippedDirs, oversized }
}
