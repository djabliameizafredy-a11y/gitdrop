import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'

const ROOT = path.join(os.tmpdir(), 'gitdrop-workspaces')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024
const MAX_ENTRIES = 50_000
const SWEEP_AFTER_MS = 3 * 60 * 60 * 1000

export interface WorkspaceMeta {
  originalName: string
  rootName: string | null
  fileCount: number
  totalSize: number
}

export function getProjectDir(id: string): string | null {
  return UUID_RE.test(id) ? path.join(ROOT, id, 'project') : null
}

export async function readWorkspaceMeta(id: string): Promise<WorkspaceMeta | null> {
  if (!UUID_RE.test(id)) return null
  try {
    return JSON.parse(await readFile(path.join(ROOT, id, 'meta.json'), 'utf8')) as WorkspaceMeta
  } catch {
    return null
  }
}

export async function removeWorkspace(id: string): Promise<void> {
  if (!UUID_RE.test(id)) return
  await rm(path.join(ROOT, id), { recursive: true, force: true }).catch(() => undefined)
}

const JUNK = /(^|\/)(__MACOSX|\.git|node_modules)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$/

/**
 * Extracts a zip archive into a fresh temporary workspace (zip-slip and zip-bomb protected).
 * When every file lives under one root folder, that folder is stripped.
 */
export async function extractZipToWorkspace(
  buffer: Buffer,
  originalName: string
): Promise<{ id: string; projectDir: string; meta: WorkspaceMeta }> {
  let zip: AdmZip
  let entries: AdmZip.IZipEntry[]
  try {
    zip = new AdmZip(buffer)
    entries = zip.getEntries()
  } catch {
    throw new Error('Archive illisible : vérifiez que le fichier est un .zip valide.')
  }
  if (entries.length > MAX_ENTRIES) throw new Error('Archive trop volumineuse (trop de fichiers).')

  const files = entries
    .filter((e) => !e.isDirectory)
    .map((e) => ({ entry: e, name: e.entryName.replace(/\\/g, '/') }))
    .filter((f) => !JUNK.test(f.name))

  // Declared sizes are checked up-front so a zip bomb never reaches the disk.
  const declared = files.reduce((acc, f) => acc + f.entry.header.size, 0)
  if (declared > MAX_EXTRACTED_BYTES) throw new Error('Projet trop volumineux après extraction (200 Mo max).')

  const tops = new Set(files.map((f) => f.name.split('/')[0]))
  const top = tops.size === 1 ? [...tops][0] : null
  const stripRoot = !!top && files.length > 0 && files.every((f) => f.name.includes('/'))

  await mkdir(ROOT, { recursive: true })
  const id = randomUUID()
  const projectDir = path.join(ROOT, id, 'project')
  await mkdir(projectDir, { recursive: true })

  const base = path.resolve(projectDir)
  let fileCount = 0
  let totalSize = 0
  try {
    for (const f of files) {
      const rel = stripRoot ? f.name.slice(f.name.indexOf('/') + 1) : f.name
      if (!rel) continue
      const target = path.resolve(projectDir, rel)
      if (!target.startsWith(base + path.sep)) continue // zip-slip guard
      const data = f.entry.getData()
      totalSize += data.length
      if (totalSize > MAX_EXTRACTED_BYTES) throw new Error('Projet trop volumineux après extraction (200 Mo max).')
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, data)
      fileCount++
    }
  } catch (e) {
    await removeWorkspace(id)
    throw e
  }
  if (fileCount === 0) {
    await removeWorkspace(id)
    throw new Error('L’archive ne contient aucun fichier exploitable.')
  }

  const meta: WorkspaceMeta = { originalName, rootName: stripRoot ? top : null, fileCount, totalSize }
  await writeFile(path.join(ROOT, id, 'meta.json'), JSON.stringify(meta), 'utf8')
  void sweepOldWorkspaces()
  return { id, projectDir, meta }
}

/** Removes workspaces untouched for more than 3 hours (best effort). */
export async function sweepOldWorkspaces(): Promise<void> {
  try {
    const cutoff = Date.now() - SWEEP_AFTER_MS
    for (const d of await readdir(ROOT)) {
      const s = await stat(path.join(ROOT, d)).catch(() => null)
      if (s && s.mtimeMs < cutoff) await rm(path.join(ROOT, d), { recursive: true, force: true })
    }
  } catch {
    // Nothing to sweep.
  }
}
