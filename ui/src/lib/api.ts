// The local server only answers requests that carry the per-launch key found in the URL fragment
// (http://localhost:PORT/#k=...). It is kept in sessionStorage and removed from the address bar.

const STORAGE = 'gitdrop-key'

function loadKey(): string {
  const m = /[#&]k=([0-9a-f]+)/.exec(window.location.hash)
  if (m) {
    try {
      sessionStorage.setItem(STORAGE, m[1])
    } catch {
      // Storage can be unavailable (privacy mode, sandboxed frame): the key just stays in memory.
    }
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return m[1]
  }
  try {
    return sessionStorage.getItem(STORAGE) ?? ''
  } catch {
    return ''
  }
}

export const apiKey = loadKey()

export function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-gitdrop-key', apiKey)
  return fetch(path, { ...init, headers, cache: 'no-store' })
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init)
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !json) throw new Error(json?.error || `Erreur du serveur local (${res.status})`)
  return json
}
