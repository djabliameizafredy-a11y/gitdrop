import path from 'node:path'

/** Variable names kept, values blanked: a safe `.env.example` from a real `.env`. */
export function buildEnvExample(content: string): string {
  const out: string[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (line.startsWith('#')) {
      // Comments are kept only when they cannot hide a value.
      if (!line.includes('=') && line.length <= 80) out.push(line)
      continue
    }
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line)
    if (m) out.push(`${m[1]}=`)
  }
  while (out.at(-1) === '') out.pop()
  return out.length ? out.join('\n') + '\n' : ''
}

/** `.env` → `.env.example`, `.env.local` → `.env.local.example`; null when not an env file. */
export function envExampleName(relPath: string): string | null {
  const base = path.basename(relPath)
  if (!/^\.env(\.[A-Za-z0-9_-]+)*$/.test(base) || /\.(example|sample|template|dist)$/.test(base)) return null
  return path.posix.join(path.posix.dirname(relPath.replace(/\\/g, '/')), `${base}.example`).replace(/^\.\//, '')
}
