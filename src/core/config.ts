import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { GitHubUser, HistoryItem } from './types.js'

export function configDir(): string {
  if (process.env.GITDROP_HOME) return process.env.GITDROP_HOME
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'gitdrop')
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')
  return path.join(base, 'gitdrop')
}

export interface StoredConfig {
  token?: string
  user?: GitHubUser & { id: number }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Atomic write with owner-only permissions (the file may hold the GitHub token). */
function writeJson(file: string, data: unknown): void {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(tmp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    // chmod is a no-op on some platforms (Windows).
  }
}

const configFile = () => path.join(configDir(), 'config.json')
const historyFile = () => path.join(configDir(), 'history.json')

export const readConfig = (): StoredConfig => readJson<StoredConfig>(configFile(), {})

export function saveAuth(token: string, user: GitHubUser & { id: number }): void {
  writeJson(configFile(), { ...readConfig(), token, user })
}

export function clearAuth(): boolean {
  const had = !!readConfig().token
  if (existsSync(configFile())) writeJson(configFile(), {})
  return had
}

export type TokenSource = 'config' | 'env'

/** Token precedence: GITDROP_TOKEN, then stored login, then GH_TOKEN / GITHUB_TOKEN. */
export function resolveToken(): { token: string; source: TokenSource } | null {
  const env = process.env.GITDROP_TOKEN?.trim()
  if (env) return { token: env, source: 'env' }
  const stored = readConfig().token
  if (stored) return { token: stored, source: 'config' }
  const fallback = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)?.trim()
  if (fallback) return { token: fallback, source: 'env' }
  return null
}

export const readHistory = (): HistoryItem[] => readJson<HistoryItem[]>(historyFile(), [])

export function addHistory(item: Omit<HistoryItem, 'id' | 'createdAt'>): void {
  const entry: HistoryItem = {
    ...item,
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  }
  writeJson(historyFile(), [entry, ...readHistory()].slice(0, 50))
}
