import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { getClientId, pollDeviceFlow, startDeviceFlow } from '../core/auth.js'
import type { AssetStore } from '../core/sea.js'
import { addHistory, clearAuth, readHistory, resolveToken, saveAuth } from '../core/config.js'
import { detectStack } from '../core/detect.js'
import { gitVersion } from '../core/git.js'
import { GitHubError, getUser } from '../core/github.js'
import { analyzeProject } from '../core/project.js'
import { isLicenseId } from '../core/license.js'
import { runPush } from '../core/push.js'
import { slugifyRepoName } from '../core/types.js'
import type { AppState, DevicePoll, DeviceStart, PushEvent } from '../core/types.js'
import {
  extractZipToWorkspace,
  getProjectDir,
  readWorkspaceMeta,
  removeWorkspace,
  sweepOldWorkspaces,
} from '../core/workspace.js'

declare const __VERSION__: string | undefined
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const MAX_ARCHIVE_BYTES = 90 * 1024 * 1024
const MAX_JSON_BYTES = 1024 * 1024

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, 'Corps de requête trop volumineux.'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req, MAX_JSON_BYTES)
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'Requête invalide.')
  }
}

export interface ServerOptions {
  /** Folder holding the built UI (npm install / dev). */
  uiDir?: string
  /** Embedded UI files (standalone binary). Takes precedence over uiDir. */
  assets?: AssetStore
  /** Local folder analysed in place (no copy), e.g. from `gitdrop ui ./project`. */
  preloadDir?: string
  port?: number
}

export interface RunningServer {
  url: string
  port: number
  key: string
  close: () => Promise<void>
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  // A random key (carried in the URL fragment, never sent to logs) protects the API from other
  // websites and other local users: only the page we opened knows it.
  const key = randomBytes(16).toString('hex')
  const flows = new Map<string, { deviceCode: string; interval: number; expiresAt: number }>()
  let pushing = false
  const localDirs = new Map<string, string>()
  let preload: { workspaceId: string; name: string } | null = null
  if (opts.preloadDir) {
    const id = randomUUID()
    localDirs.set(id, path.resolve(opts.preloadDir))
    preload = { workspaceId: id, name: path.basename(path.resolve(opts.preloadDir)) }
  }
  const resolveDir = (ws: string) => localDirs.get(ws) ?? getProjectDir(ws)
  let port = opts.port ?? 3737

  void sweepOldWorkspaces()

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return res.end()
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message })
      sendJson(res, 500, { error: 'Erreur interne du serveur local.' })
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // DNS-rebinding guard: only accept our own loopback host names.
    const host = (req.headers.host ?? '').toLowerCase()
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
      throw new HttpError(403, 'Hôte non autorisé.')
    }
    const url = new URL(req.url ?? '/', `http://${host}`)

    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-gitdrop-key'] !== key) {
        throw new HttpError(401, 'Session expirée : relancez « gitdrop ui » et utilisez le lien affiché.')
      }
      const origin = req.headers.origin
      if (req.method !== 'GET' && origin && origin !== `http://${host}`) {
        throw new HttpError(403, 'Origine non autorisée.')
      }
      return api(req, res, url)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée.')
    return serveStatic(res, url.pathname)
  }

  function serveStatic(res: ServerResponse, pathname: string): void {
    const headers = (ext: string) => ({
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
    if (opts.assets) {
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
      if (rel.split('/').includes('..')) throw new HttpError(403, 'Accès refusé.')
      // Unknown paths without an extension fall back to the app shell.
      const buf = opts.assets.get(rel) ?? (path.extname(rel) ? null : opts.assets.get('index.html'))
      if (!buf) throw new HttpError(404, 'Introuvable.')
      res.writeHead(200, headers(path.extname(rel) || '.html'))
      res.end(buf)
      return
    }
    const root = path.resolve(opts.uiDir ?? '')
    let file = path.resolve(root, '.' + decodeURIComponent(pathname))
    if (!file.startsWith(root)) throw new HttpError(403, 'Accès refusé.')
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html')
    if (!existsSync(file)) throw new HttpError(404, 'Interface introuvable : réinstallez Gitdrop.')
    res.writeHead(200, headers(path.extname(file)))
    createReadStream(file).pipe(res)
  }

  async function currentUser() {
    const t = resolveToken()
    if (!t) return null
    try {
      const u = await getUser(t.token)
      return { token: t.token, user: u }
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'auth' && t.source === 'config') clearAuth()
      return null
    }
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = `${req.method} ${url.pathname}`

    if (route === 'GET /api/state') {
      const me = await currentUser()
      const state: AppState = {
        version: VERSION,
        connected: !!me,
        user: me ? { login: me.user.login, name: me.user.name, avatarUrl: me.user.avatarUrl } : null,
        deviceFlow: !!getClientId(),
        git: !!(await gitVersion()),
        preload,
      }
      return sendJson(res, 200, state)
    }

    if (route === 'POST /api/auth/token') {
      const { token } = await readJson<{ token?: string }>(req)
      if (!token || token.trim().length < 20) throw new HttpError(400, 'Token manquant ou invalide.')
      try {
        const u = await getUser(token.trim())
        saveAuth(token.trim(), { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatarUrl })
        return sendJson(res, 200, { user: { login: u.login, name: u.name, avatarUrl: u.avatarUrl } })
      } catch (e) {
        if (e instanceof GitHubError) throw new HttpError(e.kind === 'auth' ? 401 : 502, e.message)
        throw new HttpError(502, 'Connexion à GitHub impossible. Réessayez.')
      }
    }

    if (route === 'POST /api/auth/device/start') {
      const clientId = getClientId()
      if (!clientId) throw new HttpError(400, 'Connexion par code indisponible : utilisez un token.')
      try {
        const code = await startDeviceFlow(clientId)
        const flowId = randomUUID()
        flows.set(flowId, {
          deviceCode: code.deviceCode,
          interval: code.interval,
          expiresAt: Date.now() + code.expiresIn * 1000,
        })
        const out: DeviceStart = {
          flowId,
          userCode: code.userCode,
          verificationUri: code.verificationUri,
          interval: code.interval,
          expiresIn: code.expiresIn,
        }
        return sendJson(res, 200, out)
      } catch (e) {
        throw new HttpError(502, e instanceof Error ? e.message : 'Connexion à GitHub impossible.')
      }
    }

    if (route === 'POST /api/auth/device/poll') {
      const clientId = getClientId()
      const { flowId } = await readJson<{ flowId?: string }>(req)
      const flow = flowId ? flows.get(flowId) : undefined
      if (!clientId || !flow || flow.expiresAt < Date.now()) {
        if (flowId) flows.delete(flowId)
        return sendJson(res, 200, { status: 'expired' } satisfies DevicePoll)
      }
      try {
        const r = await pollDeviceFlow(clientId, flow.deviceCode, flow.interval)
        if (r.status === 'pending') {
          flow.interval = r.interval
          return sendJson(res, 200, { status: 'pending', interval: r.interval } satisfies DevicePoll)
        }
        flows.delete(flowId!)
        if (r.status !== 'ok') return sendJson(res, 200, { status: r.status } satisfies DevicePoll)
        const u = await getUser(r.token)
        saveAuth(r.token, { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatarUrl })
        return sendJson(res, 200, {
          status: 'ok',
          user: { login: u.login, name: u.name, avatarUrl: u.avatarUrl },
        } satisfies DevicePoll)
      } catch (e) {
        throw new HttpError(502, e instanceof Error ? e.message : 'Connexion à GitHub impossible.')
      }
    }

    if (route === 'POST /api/auth/logout') {
      clearAuth()
      return sendJson(res, 200, { ok: true })
    }

    if (route === 'POST /api/upload') {
      const length = Number(req.headers['content-length'] ?? 0)
      if (length > MAX_ARCHIVE_BYTES) throw new HttpError(413, 'Archive trop volumineuse (90 Mo maximum).')
      const buf = await readBody(req, MAX_ARCHIVE_BYTES)
      const rawName = String(req.headers['x-filename'] ?? 'projet.zip')
      let name = 'projet.zip'
      try {
        name = decodeURIComponent(rawName)
      } catch {
        // keep default
      }
      try {
        const { id, meta } = await extractZipToWorkspace(buf, name)
        return sendJson(res, 200, {
          workspaceId: id,
          fileCount: meta.fileCount,
          totalSize: meta.totalSize,
          rootName: meta.rootName,
          originalName: meta.originalName,
        })
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Extraction de l’archive impossible.')
      }
    }

    if (route === 'GET /api/analyze') {
      const ws = url.searchParams.get('ws') ?? ''
      const dir = resolveDir(ws)
      if (!dir || !existsSync(dir)) throw new HttpError(404, 'Projet introuvable ou expiré.')
      const meta = localDirs.has(ws) ? null : await readWorkspaceMeta(ws)
      const hint = localDirs.has(ws)
        ? path.basename(dir)
        : meta?.rootName || meta?.originalName?.replace(/\.zip$/i, '') || 'mon-projet'
      return sendJson(res, 200, await analyzeProject(dir, hint))
    }

    if (route === 'POST /api/push') return pushRoute(req, res)

    if (route === 'GET /api/history') {
      return sendJson(res, 200, { history: readHistory().slice(0, 20) })
    }

    throw new HttpError(404, 'Route inconnue.')
  }

  async function pushRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<Record<string, unknown>>(req)
    const ws = String(body.workspaceId ?? '')
    const name = String(body.name ?? '').trim()
    const visibility = body.visibility === 'public' ? 'public' : 'private'
    if (!name || name.length > 120) throw new HttpError(400, 'Nom de dépôt invalide.')
    const dir = resolveDir(ws)
    if (!dir || !existsSync(dir)) throw new HttpError(404, 'Projet introuvable ou expiré. Rechargez-le.')
    if (pushing) throw new HttpError(409, 'Un push est déjà en cours.')

    const me = await currentUser()
    if (!me) throw new HttpError(401, 'Connectez-vous à GitHub avant de pousser un projet.')

    const excludePaths = Array.isArray(body.excludePaths)
      ? body.excludePaths.filter((p): p is string => typeof p === 'string').slice(0, 200)
      : []
    const config = {
      repoName: slugifyRepoName(name),
      visibility: visibility as 'public' | 'private',
      description: String(body.description ?? '').slice(0, 350),
      addReadme: body.readme !== false,
      addGitignore: body.addGitignore !== false,
      commitMessage: String(body.commitMessage ?? 'Initial commit').slice(0, 200),
      excludePaths,
      license: isLicenseId(body.license) ? body.license : undefined,
      envExample: body.envExample !== false,
      freshHistory: body.freshHistory === true,
      ci: body.ci === true,
      deploy: body.deploy === true,
      topics: Array.isArray(body.topics)
        ? body.topics.filter((t): t is string => typeof t === 'string').slice(0, 10)
        : [],
    }

    pushing = true
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })
    const send = (ev: PushEvent) => {
      if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n')
    }
    try {
      const stack = await detectStack(dir)
      const outcome = await runPush({
        token: me.token,
        user: { login: me.user.login, id: me.user.id, name: me.user.name },
        projectDir: dir,
        stack,
        config,
        emit: send,
      })
      addHistory({
        username: me.user.login,
        repoName: config.repoName,
        repoUrl: outcome.url,
        visibility: config.visibility,
        stack: stack.id,
        fileCount: outcome.fileCount,
      })
      if (!localDirs.has(ws)) await removeWorkspace(ws)
      send({
        type: 'done',
        url: outcome.url,
        fullName: outcome.fullName,
        fileCount: outcome.fileCount,
        siteUrl: outcome.siteUrl,
      })
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : 'Erreur inconnue pendant le push.' })
    } finally {
      pushing = false
      res.end()
    }
  }

  // Bind to loopback only; if the default port is busy, try the next ones.
  const requested = opts.port !== undefined
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || requested || attempt === 19) {
        throw (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? new Error(`Le port ${port} est déjà utilisé. Essayez --port <autre-port>.`)
          : e
      }
      port++
    }
  }

  return {
    url: `http://localhost:${port}/#k=${key}`,
    port,
    key,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
