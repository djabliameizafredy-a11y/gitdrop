import { spawn } from 'node:child_process'

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

export interface GitOptions {
  cwd?: string
  /** GitHub token used for HTTP auth (never written to disk or to the remote URL). */
  token?: string
  /** Receives each stderr chunk (git reports push progress there). */
  onStderr?: (chunk: string) => void
  /** Streams stdout instead of buffering it; return true to stop (kills git). */
  onStdout?: (chunk: string) => boolean | void
  /** Extra `-c key=value` config. */
  config?: string[]
}

let cachedVersion: string | null | undefined

export async function gitVersion(): Promise<string | null> {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const r = await rawGit(['--version'], {})
    const m = /(\d+\.\d+(?:\.\d+)?)/.exec(r.stdout)
    cachedVersion = r.code === 0 && m ? m[1] : null
  } catch {
    cachedVersion = null
  }
  return cachedVersion
}

function versionAtLeast(v: string, major: number, minor: number): boolean {
  const [a, b] = v.split('.').map(Number)
  return a > major || (a === major && (b ?? 0) >= minor)
}

function rawGit(args: string[], opts: GitOptions, env?: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      if (!opts.onStdout) {
        stdout += d.toString('utf8')
      } else if (opts.onStdout(d.toString('utf8')) === true) {
        child.kill()
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stderr += s
      opts.onStderr?.(s)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

export class GitMissingError extends Error {
  constructor() {
    super('Git n’est pas installé (ou introuvable dans le PATH). Installez-le : https://git-scm.com/downloads')
    this.name = 'GitMissingError'
  }
}

/**
 * Runs git. When a token is given it is passed through an HTTP Authorization header set via
 * environment config (git >= 2.31) so it never shows up in the process list or in .git/config.
 */
export async function git(args: string[], opts: GitOptions = {}): Promise<GitResult> {
  const version = await gitVersion()
  if (!version) throw new GitMissingError()

  const cfg = [...(opts.config ?? [])]
  let env: NodeJS.ProcessEnv | undefined
  let secret: string | undefined

  if (opts.token) {
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${opts.token}`).toString('base64')}`
    secret = header
    if (versionAtLeast(version, 2, 31)) {
      env = {
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: header,
        GIT_CONFIG_KEY_1: 'credential.helper',
        GIT_CONFIG_VALUE_1: '',
      }
    } else {
      cfg.push(`http.extraheader=${header}`, 'credential.helper=')
    }
  }

  const full = [...cfg.flatMap((c) => ['-c', c]), ...args]
  const res = await rawGit(full, opts, env)
  if (secret || opts.token) {
    const scrub = (s: string) => {
      let out = s
      if (secret) out = out.split(secret).join('***')
      if (opts.token) out = out.split(opts.token).join('***')
      return out
    }
    res.stdout = scrub(res.stdout)
    res.stderr = scrub(res.stderr)
  }
  return res
}
