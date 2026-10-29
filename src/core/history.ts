import { existsSync } from 'node:fs'
import path from 'node:path'
import { git } from './git.js'
import { isSensitiveName, matchContent, matchName } from './secrets.js'
import type { HistoryFinding, HistoryScan, ProviderLink } from './types.js'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_FINDINGS = 30
const MAX_LINE = 2000

/**
 * Scans the whole Git history (all branches) of a repository for secrets: sensitive files that
 * were ever added (even if deleted since) and secrets in added lines. Streams `git log -p`, with
 * a size cap so huge repositories stay fast.
 */
export async function scanHistory(dir: string): Promise<HistoryScan> {
  const count = await git(['rev-list', '--all', '--count'], { cwd: dir })
  const commits = count.code === 0 ? Number(count.stdout.trim()) || 0 : 0
  if (commits === 0) return { findings: [], commits: 0, truncated: false }

  const found = new Map<string, HistoryFinding>()
  const add = (commit: string, file: string, reason: string, provider?: ProviderLink) => {
    const key = `${file}`
    let f = found.get(key)
    if (!f) {
      if (found.size >= MAX_FINDINGS) return
      f = { commit: commit.slice(0, 8), path: file, reasons: [], providers: [], stillPresent: existsSync(path.join(dir, file)) }
      found.set(key, f)
    }
    if (!f.reasons.includes(reason)) f.reasons.push(reason)
    if (provider && !f.providers.some((p) => p.name === provider.name)) f.providers.push(provider)
  }

  // 1. Sensitive files that were ever added.
  const names = await git(['log', '--all', '--diff-filter=A', '--name-only', '--format=%x00%H', '-z'], { cwd: dir })
  if (names.code === 0) {
    let commit = ''
    for (const part of names.stdout.split('\0')) {
      if (!part) continue
      if (/^\n?[0-9a-f]{40}$/.test(part.trim())) {
        commit = part.trim()
        continue
      }
      const file = part.replace(/^\n+/, '')
      if (file && isSensitiveName(file)) for (const r of matchName(path.basename(file))) add(commit, file, r)
    }
  }

  // 2. Secrets in added lines.
  let bytes = 0
  let truncated = false
  let buffer = ''
  let commit = ''
  let file = ''
  const handle = (line: string) => {
    if (line.startsWith('\0')) {
      commit = line.slice(1, 41)
    } else if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : ''
    } else if (line.startsWith('+') && file && line.length <= MAX_LINE) {
      if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock)$/.test(file)) return
      if (/\.(example|sample|template|dist)$/.test(file)) return
      for (const hit of matchContent(line.slice(1))) add(commit, file, hit.reason, hit.provider)
    }
  }
  await git(['log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--format=%x00%H'], {
    cwd: dir,
    onStdout: (chunk) => {
      bytes += chunk.length
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const l of lines) handle(l)
      if (bytes > MAX_BYTES) {
        truncated = true
        return true
      }
      return found.size >= MAX_FINDINGS
    },
  })
  if (buffer) handle(buffer)

  return { findings: [...found.values()], commits, truncated }
}
