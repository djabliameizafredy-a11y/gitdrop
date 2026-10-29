import { createRequire } from 'node:module'

// Single Executable Application support: in the standalone binary the web UI is embedded as assets.
const load: NodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url)

export interface AssetStore {
  get(relPath: string): Buffer | null
}

interface SeaModule {
  isSea(): boolean
  getAsset(key: string): ArrayBuffer
}

function sea(): SeaModule | null {
  try {
    const m = load('node:sea') as SeaModule
    return m.isSea() ? m : null
  } catch {
    return null // Node < 20.12 has no node:sea
  }
}

export const isSeaBinary = (): boolean => sea() !== null

/** Embedded UI files when running as the standalone binary, otherwise null. */
export function seaAssets(): AssetStore | null {
  const m = sea()
  if (!m) return null
  return {
    get(rel) {
      try {
        return Buffer.from(m.getAsset(`ui/${rel}`))
      } catch {
        return null
      }
    },
  }
}
