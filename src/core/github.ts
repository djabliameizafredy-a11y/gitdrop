// Minimal typed GitHub REST client (no dependency). Base URLs can be overridden for tests / GHES.

export const apiBase = () => process.env.GITDROP_GITHUB_API || 'https://api.github.com'
export const webBase = () => process.env.GITDROP_GITHUB_WEB || 'https://github.com'

export type GitHubErrorKind = 'auth' | 'scope' | 'rate' | 'exists' | 'network' | 'other'

export class GitHubError extends Error {
  status: number
  kind: GitHubErrorKind
  constructor(status: number, message: string, kind: GitHubErrorKind = 'other') {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.kind = kind
  }
}

function explain(status: number, json: unknown): GitHubError {
  const body = json as { message?: string; errors?: { message?: string }[] } | null
  const msg = body?.message ?? ''
  const errs = body?.errors?.map((e) => e.message ?? '').join(', ') ?? ''
  if (status === 401) {
    return new GitHubError(401, 'Token GitHub invalide ou expiré. Relancez « gitdrop login ».', 'auth')
  }
  if (status === 403) {
    if (/rate limit|abuse|secondary/i.test(msg)) {
      return new GitHubError(403, 'Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes.', 'rate')
    }
    return new GitHubError(
      403,
      'Accès refusé par GitHub. Le token doit avoir le scope « repo » (relancez « gitdrop login »).',
      'scope'
    )
  }
  if (status === 404) {
    return new GitHubError(404, 'Ressource introuvable — le token a-t-il le scope « repo » ?', 'scope')
  }
  if (status === 422) {
    if (/already exists/i.test(msg) || /already exists/i.test(errs)) {
      return new GitHubError(
        422,
        'Un dépôt portant ce nom existe déjà sur votre compte GitHub. Choisissez un autre nom.',
        'exists'
      )
    }
    return new GitHubError(422, `Requête refusée par GitHub : ${msg}${errs ? ` — ${errs}` : ''}`)
  }
  return new GitHubError(status, msg || `Erreur GitHub (${status})`)
}

interface Call {
  token: string
  method?: string
  body?: unknown
}

async function call(pathname: string, opts: Call): Promise<{ status: number; json: unknown; headers: Headers }> {
  let res: Response
  try {
    res = await fetch(apiBase() + pathname, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gitdrop',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new GitHubError(0, 'Impossible de joindre GitHub. Vérifiez votre connexion réseau.', 'network')
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, json, headers: res.headers }
}

export interface GhUser {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
}

export interface VerifiedUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
  /** OAuth scopes granted to the token, or null for fine-grained tokens (header absent). */
  scopes: string[] | null
}

export async function getUser(token: string): Promise<VerifiedUser> {
  const r = await call('/user', { token })
  if (r.status < 200 || r.status >= 300) throw explain(r.status, r.json)
  const u = r.json as GhUser
  const header = r.headers.get('x-oauth-scopes')
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    avatarUrl: u.avatar_url,
    scopes: header === null ? null : header.split(',').map((s) => s.trim()).filter(Boolean),
  }
}

export interface GhRepo {
  full_name: string
  html_url: string
}

export async function createRepo(
  token: string,
  input: { name: string; private: boolean; description?: string }
): Promise<GhRepo> {
  const r = await call('/user/repos', {
    token,
    method: 'POST',
    body: { ...input, auto_init: false },
  })
  if (r.status < 200 || r.status >= 300) throw explain(r.status, r.json)
  return r.json as GhRepo
}

/** True when the repo exists and has no commit yet (safe to reuse after an interrupted push). */
export async function isEmptyRepo(token: string, fullName: string): Promise<boolean> {
  const r = await call(`/repos/${fullName}/commits?per_page=1`, { token })
  return r.status === 409
}

export async function getRepo(token: string, fullName: string): Promise<GhRepo | null> {
  const r = await call(`/repos/${fullName}`, { token })
  return r.status === 200 ? (r.json as GhRepo) : null
}

export async function setTopics(token: string, fullName: string, names: string[]): Promise<void> {
  const r = await call(`/repos/${fullName}/topics`, { token, method: 'PUT', body: { names } })
  if (r.status < 200 || r.status >= 300) throw explain(r.status, r.json)
}

export async function getDefaultBranch(token: string, fullName: string): Promise<string> {
  const r = await call(`/repos/${fullName}`, { token })
  if (r.status < 200 || r.status >= 300) throw explain(r.status, r.json)
  return (r.json as { default_branch?: string }).default_branch ?? 'main'
}

export async function createPullRequest(
  token: string,
  fullName: string,
  input: { title: string; head: string; base: string; body?: string }
): Promise<{ html_url: string; number: number }> {
  const r = await call(`/repos/${fullName}/pulls`, { token, method: 'POST', body: input })
  if (r.status < 200 || r.status >= 300) throw explain(r.status, r.json)
  return r.json as { html_url: string; number: number }
}
