// Types shared between the CLI, the local server and the web UI (no Node imports here).

export type Visibility = 'public' | 'private'

export interface GitHubUser {
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface ProviderLink {
  name: string
  /** Where to revoke / rotate the leaked credential. */
  url: string
}

export interface SensitiveFile {
  path: string
  reasons: string[]
  size: number
  providers?: ProviderLink[]
}

/** A secret found in the Git history of a project that already has a .git folder. */
export interface HistoryFinding {
  commit: string
  path: string
  reasons: string[]
  providers: ProviderLink[]
  /** True when the file still exists in the working tree. */
  stillPresent: boolean
}

export interface HistoryScan {
  findings: HistoryFinding[]
  commits: number
  truncated: boolean
}

export interface DeployInfo {
  kind: 'static' | 'vite' | 'cra'
  label: string
}

export interface StackInfo {
  id: string
  label: string
  emoji: string
  details: string[]
}

export interface Analysis {
  fileCount: number
  totalSize: number
  stack: StackInfo
  hasReadme: boolean
  hasGitignore: boolean
  hasGit: boolean
  hasLicense: boolean
  sensitiveFiles: SensitiveFile[]
  /** Secrets found in the existing Git history (null when there is no history). */
  history: HistoryScan | null
  /** Set when the project can be published on GitHub Pages. */
  deploy: DeployInfo | null
  /** True when a Node project has build/test scripts (a CI workflow can be generated). */
  canCi: boolean
  suggestedName: string
  gitignoreContent: string
  warnings: string[]
}

export type PushEvent =
  | { type: 'step'; id: string; label: string; status: 'running' | 'done' | 'error' }
  | { type: 'progress'; percent: number }
  | { type: 'warning'; message: string }
  | { type: 'done'; url: string; fullName: string; fileCount: number; siteUrl?: string }
  | { type: 'error'; message: string }

export interface HistoryItem {
  id: string
  username: string
  repoName: string
  repoUrl: string
  visibility: string
  stack: string
  fileCount: number
  createdAt: string
}

export interface AppState {
  version: string
  connected: boolean
  user: GitHubUser | null
  /** True when an OAuth client id is configured, so the Device Flow can be offered. */
  deviceFlow: boolean
  /** False when the `git` binary is missing (pushing is impossible without it). */
  git: boolean
  /** Folder given to `gitdrop ui <path>`, analysed in place (keeps its .git history). */
  preload: { workspaceId: string; name: string } | null
}

export interface DeviceStart {
  flowId: string
  userCode: string
  verificationUri: string
  /** Polling interval in seconds. */
  interval: number
  expiresIn: number
}

export type DevicePoll =
  | { status: 'pending'; interval: number }
  | { status: 'ok'; user: GitHubUser }
  | { status: 'expired' }
  | { status: 'denied' }

export function slugifyRepoName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96)
  return slug || 'mon-projet'
}
