
import { create } from 'zustand'
import { toast } from 'sonner'
import { api, apiJson } from '@/lib/api'
import type {
  Analysis,
  AppState,
  DevicePoll,
  DeviceStart,
  GitHubUser,
  HistoryItem,
  PushEvent,
  Visibility,
} from '@core/types'

export type StepId = 1 | 2 | 3 | 4

interface UploadState {
  phase: 'idle' | 'zipping' | 'uploading' | 'analyzing' | 'ready' | 'error'
  progress: number
  workspaceId: string | null
  fileCount: number
  totalSize: number
  rootName: string | null
  error: string | null
}

interface PushStepState {
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
}

interface PushState {
  running: boolean
  steps: Record<string, PushStepState>
  percent: number
  done: boolean
  result: { url: string; fullName: string; fileCount: number; siteUrl?: string } | null
  error: string | null
}

interface ConfigState {
  name: string
  visibility: Visibility
  description: string
  readme: boolean
  addGitignore: boolean
  commitMessage: string
  excludePaths: string[]
  license: 'none' | 'mit' | 'isc' | 'unlicense'
  deploy: boolean
  ci: boolean
  freshHistory: boolean
}

const emptyUpload: UploadState = {
  phase: 'idle',
  progress: 0,
  workspaceId: null,
  fileCount: 0,
  totalSize: 0,
  rootName: null,
  error: null,
}

const emptyPush: PushState = {
  running: false,
  steps: {},
  percent: 0,
  done: false,
  result: null,
  error: null,
}

const emptyConfig: ConfigState = {
  name: '',
  visibility: 'private',
  description: '',
  readme: true,
  addGitignore: true,
  commitMessage: 'Initial commit',
  excludePaths: [],
  license: 'none',
  deploy: false,
  ci: false,
  freshHistory: false,
}

export interface DeviceLogin {
  code: DeviceStart
  status: 'waiting' | 'expired' | 'denied'
}

interface GitdropStore {
  step: StepId
  app: { version: string; git: boolean; deviceFlow: boolean; preload: AppState['preload'] }
  device: DeviceLogin | null
  session: GitHubUser | null
  sessionLoaded: boolean
  connecting: boolean
  connectError: string | null
  upload: UploadState
  analysis: Analysis | null
  config: ConfigState
  push: PushState
  history: HistoryItem[]
  historyLoaded: boolean

  fetchMe: () => Promise<void>
  connect: (token: string) => Promise<void>
  startDeviceLogin: () => Promise<void>
  cancelDeviceLogin: () => void
  disconnect: () => Promise<void>
  setStep: (s: StepId) => void

  setUpload: (patch: Partial<UploadState>) => void
  uploadReady: (r: {
    workspaceId: string
    fileCount: number
    totalSize: number
    rootName: string | null
  }) => void
  setAnalysis: (a: Analysis) => void
  applyAnalysisToConfig: () => void
  updateConfig: (patch: Partial<ConfigState>) => void
  toggleExclude: (path: string) => void
  resetProject: () => void

  startPush: () => Promise<void>
  resetPush: () => void
  handlePushEvent: (ev: PushEvent) => void

  loadHistory: () => Promise<void>
}

let deviceTimer: ReturnType<typeof setTimeout> | null = null

export const useGitdropStore = create<GitdropStore>()((set, get) => ({
  step: 1,
  app: { version: '', git: true, deviceFlow: false, preload: null },
  device: null,
  session: null,
  sessionLoaded: false,
  connecting: false,
  connectError: null,
  upload: emptyUpload,
  analysis: null,
  config: emptyConfig,
  push: emptyPush,
  history: [],
  historyLoaded: false,

  fetchMe: async () => {
    try {
      const st = await apiJson<AppState>('/api/state')
      set({
        app: { version: st.version, git: st.git, deviceFlow: st.deviceFlow, preload: st.preload },
        session: st.connected ? st.user : null,
        sessionLoaded: true,
      })
      if (st.connected && get().step === 1) set({ step: 2 })
    } catch (e) {
      set({ sessionLoaded: true })
      toast.error(e instanceof Error ? e.message : 'Serveur local injoignable')
    }
  },

  connect: async (token) => {
    set({ connecting: true, connectError: null })
    try {
      const json = await apiJson<{ user: GitHubUser }>('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      set({ session: json.user, connecting: false, step: 2 })
      toast.success(`Connecté en tant que ${json.user.login}`)
      get().loadHistory()
    } catch (e) {
      set({
        connecting: false,
        connectError: e instanceof Error ? e.message : 'Connexion impossible',
      })
    }
  },

  startDeviceLogin: async () => {
    get().cancelDeviceLogin()
    set({ connectError: null, connecting: true })
    try {
      const code = await apiJson<DeviceStart>('/api/auth/device/start', { method: 'POST' })
      set({ device: { code, status: 'waiting' }, connecting: false })
      window.open(code.verificationUri, '_blank', 'noopener,noreferrer')

      const poll = async (delaySec: number) => {
        deviceTimer = setTimeout(async () => {
          if (get().device?.code.flowId !== code.flowId) return
          try {
            const r = await apiJson<DevicePoll>('/api/auth/device/poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ flowId: code.flowId }),
            })
            if (get().device?.code.flowId !== code.flowId) return
            if (r.status === 'pending') return poll(r.interval)
            if (r.status === 'ok') {
              set({ device: null, session: r.user, step: 2 })
              toast.success(`Connecté en tant que ${r.user.login}`)
              get().loadHistory()
              return
            }
            set({ device: { code, status: r.status } })
          } catch (e) {
            set({ device: null, connectError: e instanceof Error ? e.message : 'Connexion impossible' })
          }
        }, delaySec * 1000)
      }
      void poll(code.interval)
    } catch (e) {
      set({
        connecting: false,
        connectError: e instanceof Error ? e.message : 'Connexion impossible',
      })
    }
  },

  cancelDeviceLogin: () => {
    if (deviceTimer) clearTimeout(deviceTimer)
    deviceTimer = null
    set({ device: null })
  },

  disconnect: async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    set({
      session: null,
      step: 1,
      upload: emptyUpload,
      analysis: null,
      config: emptyConfig,
      push: emptyPush,
    })
    toast.info('Déconnecté de GitHub.')
  },

  setStep: (s) => {
    // Navigation is blocked only while a push is streaming.
    if (get().push.running) return
    set({ step: s })
  },

  setUpload: (patch) => set((state) => ({ upload: { ...state.upload, ...patch } })),

  uploadReady: (r) =>
    set((state) => ({
      upload: {
        ...state.upload,
        workspaceId: r.workspaceId,
        fileCount: r.fileCount,
        totalSize: r.totalSize,
        rootName: r.rootName,
      },
    })),

  setAnalysis: (a) =>
    set({
      analysis: a,
      // Pre-check every sensitive file for exclusion as soon as the analysis lands.
      config: { ...get().config, excludePaths: a.sensitiveFiles.map((f) => f.path) },
    }),

  applyAnalysisToConfig: () => {
    const a = get().analysis
    if (!a) return
    set({
      config: {
        ...get().config,
        name: a.suggestedName,
        readme: !a.hasReadme,
        addGitignore: !a.hasGitignore,
        excludePaths: a.sensitiveFiles.map((f) => f.path),
        commitMessage: 'Initial commit',
        visibility: get().config.visibility,
        // Secrets already in the Git history: default to publishing one clean commit.
        freshHistory: !!a.history?.findings.length,
        deploy: false,
        ci: false,
        license: 'none',
      },
    })
  },

  updateConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),

  toggleExclude: (path) => {
    const cur = get().config.excludePaths
    set({
      config: {
        ...get().config,
        excludePaths: cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path],
      },
    })
  },

  resetProject: () =>
    set({
      upload: emptyUpload,
      analysis: null,
      config: emptyConfig,
      push: emptyPush,
      step: 2,
    }),

  startPush: async () => {
    const { upload, config, push } = get()
    if (push.running) return
    if (!upload.workspaceId) {
      toast.error('Aucun projet chargé. Rechargez vos fichiers.')
      return
    }
    if (!config.name.trim()) {
      toast.error('Choisissez un nom de dépôt avant de pousser.')
      return
    }
    set({ step: 4, push: { ...emptyPush, running: true } })
    try {
      const res = await api('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: upload.workspaceId,
          name: config.name,
          visibility: config.visibility,
          description: config.description,
          readme: config.readme,
          addGitignore: config.addGitignore,
          commitMessage: config.commitMessage,
          excludePaths: config.excludePaths,
          license: config.license === 'none' ? undefined : config.license,
          deploy: config.deploy,
          ci: config.ci,
          freshHistory: config.freshHistory,
        }),
      })
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(json?.error || 'Le push a échoué')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            get().handlePushEvent(JSON.parse(line) as PushEvent)
          } catch {
            // Ignore malformed lines.
          }
        }
      }
    } catch (e) {
      set({
        push: {
          ...get().push,
          running: false,
          error: e instanceof Error ? e.message : 'Erreur réseau pendant le push',
        },
      })
    }
  },

  resetPush: () => set({ push: emptyPush }),

  handlePushEvent: (ev) => {
    const s = get()
    if (ev.type === 'step') {
      set({
        push: {
          ...s.push,
          steps: {
            ...s.push.steps,
            [ev.id]: { label: ev.label, status: ev.status },
          },
        },
      })
    } else if (ev.type === 'progress') {
      set({ push: { ...s.push, percent: ev.percent } })
    } else if (ev.type === 'warning') {
      toast.warning(ev.message)
    } else if (ev.type === 'done') {
      set({
        push: {
          ...s.push,
          running: false,
          done: true,
          result: { url: ev.url, fullName: ev.fullName, fileCount: ev.fileCount, siteUrl: ev.siteUrl },
        },
      })
      get().loadHistory()
    } else if (ev.type === 'error') {
      set({ push: { ...s.push, running: false, error: ev.message } })
    }
  },

  loadHistory: async () => {
    try {
      const json = await apiJson<{ history?: HistoryItem[] }>('/api/history')
      set({ history: json.history ?? [], historyLoaded: true })
    } catch {
      set({ historyLoaded: true })
    }
  },
}))
