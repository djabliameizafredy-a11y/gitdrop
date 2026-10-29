
import JSZip from 'jszip'
import { apiJson, apiKey } from '@/lib/api'

export interface CollectedFile {
  file: File
  path: string
}

export interface UploadResponse {
  workspaceId: string
  fileCount: number
  totalSize: number
  rootName: string | null
  originalName?: string
}

export const MAX_TOTAL_BYTES = 90 * 1024 * 1024

const SKIP_SEGMENT =
  /^(node_modules|\.git|__MACOSX|\.next|\.nuxt|\.output|\.venv|venv|vendor|coverage|\.turbo|\.cache|\.parcel-cache|\.svelte-kit|\.angular|\.dart_tool|Pods|\.idea|\.gradle)$/
const SKIP_FILE = /^(\.DS_Store|Thumbs\.db)$/

function shouldSkipPath(p: string): boolean {
  const segs = p.split('/')
  const name = segs[segs.length - 1]
  if (SKIP_FILE.test(name)) return true
  for (let i = 0; i < segs.length - 1; i++) {
    if (SKIP_SEGMENT.test(segs[i])) return true
  }
  return false
}

export function collectFromInput(fileList: File[]): { files: CollectedFile[]; skipped: number } {
  let skipped = 0
  const files: CollectedFile[] = []
  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name
    if (shouldSkipPath(path)) {
      skipped++
      continue
    }
    files.push({ file, path })
  }
  return { files, skipped }
}

interface MinimalDirReader {
  readEntries: (cb: (entries: FileSystemEntry[]) => void, err?: (e: unknown) => void) => void
}

/** Recursively collects files from a drop event, preserving folder structure. */
export async function collectFromDataTransfer(
  dt: DataTransfer
): Promise<{ files: CollectedFile[]; skipped: number }> {
  const items = Array.from(dt.items ?? [])
  const entries: FileSystemEntry[] = []
  // Must be called synchronously before any await.
  for (const item of items) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry()
    if (entry) entries.push(entry)
  }

  if (entries.length === 0) {
    return collectFromInput(Array.from(dt.files))
  }

  const files: CollectedFile[] = []
  let skipped = 0

  async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const fe = entry as FileSystemFileEntry
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (shouldSkipPath(path)) {
        skipped++
        return
      }
      const file = await new Promise<File | null>((resolve) => {
        fe.file(resolve, () => resolve(null))
      })
      if (file) files.push({ file, path })
      return
    }
    if (entry.isDirectory) {
      if (SKIP_SEGMENT.test(entry.name)) {
        skipped++
        return
      }
      const de = entry as FileSystemDirectoryEntry
      const reader = de.createReader() as MinimalDirReader
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries(
            (es) => resolve(es),
            () => resolve([])
          )
        })
        if (!batch.length) break
        for (const e of batch) await walkEntry(e, path)
      }
    }
  }

  for (const e of entries) await walkEntry(e, '')
  return { files, skipped }
}

export function uploadArchive(
  blob: Blob,
  name: string,
  onProgress: (pct: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.setRequestHeader('x-gitdrop-key', apiKey)
    xhr.setRequestHeader('content-type', 'application/zip')
    xhr.setRequestHeader('x-filename', encodeURIComponent(name))
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as UploadResponse & { error?: string }
        if (xhr.status >= 200 && xhr.status < 300) resolve(json)
        else reject(new Error(json.error || `Échec de l’envoi (${xhr.status})`))
      } catch {
        reject(new Error('Réponse invalide du serveur'))
      }
    }
    xhr.onerror = () => reject(new Error('Connexion au serveur local impossible'))
    xhr.send(blob)
  })
}

export async function zipAndUpload(
  entries: CollectedFile[],
  onPhase: (phase: 'zipping' | 'uploading', progress: number) => void
): Promise<UploadResponse> {
  if (entries.length === 0) throw new Error('Aucun fichier trouvé dans la sélection.')
  const total = entries.reduce((acc, e) => acc + e.file.size, 0)
  if (total > MAX_TOTAL_BYTES) {
    throw new Error('Sélection trop volumineuse (90 Mo maximum après compression).')
  }
  // A single .zip is forwarded as-is.
  if (entries.length === 1 && /\.zip$/i.test(entries[0].path)) {
    onPhase('uploading', 0)
    return uploadArchive(entries[0].file, entries[0].file.name, (p) => onPhase('uploading', p))
  }
  onPhase('zipping', 0)
  const zip = new JSZip()
  for (const e of entries) zip.file(e.path, e.file)
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => onPhase('zipping', Math.round(meta.percent))
  )
  onPhase('uploading', 0)
  return uploadArchive(blob, 'gitdrop-upload.zip', (p) => onPhase('uploading', p))
}

export function analyzeWorkspace(workspaceId: string) {
  return apiJson<import('@core/types').Analysis>(`/api/analyze?ws=${encodeURIComponent(workspaceId)}`)
}
