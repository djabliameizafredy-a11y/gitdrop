// GitHub OAuth Device Flow + helpers to obtain a token.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { webBase } from './github.js'

declare const __CLIENT_ID__: string | undefined

const SCOPES = 'repo workflow'

/** Public OAuth App client id (injected at build time) or GITDROP_CLIENT_ID at runtime. */
export function getClientId(): string | null {
  const fromEnv = process.env.GITDROP_CLIENT_ID?.trim()
  if (fromEnv) return fromEnv
  const built = typeof __CLIENT_ID__ === 'string' ? __CLIENT_ID__.trim() : ''
  return built || null
}

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'gitdrop',
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new Error('Impossible de joindre GitHub. Vérifiez votre connexion réseau.')
  }
  return (await res.json().catch(() => ({}))) as T
}

export async function startDeviceFlow(clientId: string): Promise<DeviceCode> {
  const r = await postForm<{
    device_code?: string
    user_code?: string
    verification_uri?: string
    interval?: number
    expires_in?: number
    error?: string
    error_description?: string
  }>(`${webBase()}/login/device/code`, { client_id: clientId, scope: SCOPES })
  if (!r.device_code || !r.user_code || !r.verification_uri) {
    throw new Error(
      r.error === 'device_flow_disabled'
        ? 'Le Device Flow n’est pas activé sur l’OAuth App GitHub de Gitdrop.'
        : r.error_description || 'GitHub a refusé la demande de connexion.'
    )
  }
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUri: r.verification_uri,
    interval: r.interval ?? 5,
    expiresIn: r.expires_in ?? 900,
  }
}

export type PollResult =
  | { status: 'pending'; interval: number }
  | { status: 'ok'; token: string }
  | { status: 'expired' }
  | { status: 'denied' }

export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
  interval: number
): Promise<PollResult> {
  const r = await postForm<{ access_token?: string; error?: string; interval?: number }>(
    `${webBase()}/login/oauth/access_token`,
    {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }
  )
  if (r.access_token) return { status: 'ok', token: r.access_token }
  switch (r.error) {
    case 'authorization_pending':
      return { status: 'pending', interval }
    case 'slow_down':
      return { status: 'pending', interval: r.interval ?? interval + 5 }
    case 'expired_token':
      return { status: 'expired' }
    case 'access_denied':
      return { status: 'denied' }
    default:
      throw new Error('Réponse inattendue de GitHub pendant la connexion.')
  }
}

/** Waits (CLI use) until the user authorizes the device code. */
export async function waitForDeviceToken(clientId: string, code: DeviceCode): Promise<string> {
  let interval = code.interval
  const deadline = Date.now() + code.expiresIn * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    const res = await pollDeviceFlow(clientId, code.deviceCode, interval)
    if (res.status === 'ok') return res.token
    if (res.status === 'denied') throw new Error('Autorisation refusée dans le navigateur.')
    if (res.status === 'expired') break
    interval = res.interval
  }
  throw new Error('Le code a expiré. Relancez « gitdrop login ».')
}

const exec = promisify(execFile)

/** Reuses an existing GitHub CLI session when `gh` is installed and logged in. */
export async function ghCliToken(): Promise<string | null> {
  try {
    const { stdout } = await exec('gh', ['auth', 'token'], { timeout: 5000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}
