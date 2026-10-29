import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import pc from 'picocolors'
import { gitVersion } from '../core/git.js'
import { seaAssets } from '../core/sea.js'
import { startServer } from '../server/index.js'
import { log, openBrowser } from './term.js'

function findUi(): { uiDir?: string; assets?: ReturnType<typeof seaAssets> & object } {
  const override = process.env.GITDROP_UI_DIR
  if (override && existsSync(override)) return { uiDir: override }
  const assets = seaAssets()
  if (assets) return { assets }
  const candidates = [
    fileURLToPath(new URL('./ui', import.meta.url)),
    fileURLToPath(new URL('../dist/ui', import.meta.url)),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('Interface introuvable : réinstallez Gitdrop (npm i -g gitdrop).')
  return { uiDir: found }
}

export const uiCommand = new Command('ui')
  .description('Ouvre l’interface web locale (glisser-déposer un dossier ou un .zip)')
  .argument('[path]', 'dossier à analyser sur place (avec son historique Git)')
  .option('-p, --port <port>', 'port local', (v) => Number.parseInt(v, 10))
  .option('--no-open', 'ne pas ouvrir le navigateur')
  .action(async (target: string | undefined, o: { port?: number; open: boolean }) => {
    let preloadDir: string | undefined
    if (target) {
      preloadDir = path.resolve(target)
      if (!existsSync(preloadDir) || !statSync(preloadDir).isDirectory()) throw new Error(`Dossier introuvable : ${preloadDir}`)
    }
    if (o.port !== undefined && (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535)) {
      throw new Error('Port invalide.')
    }
    if (!(await gitVersion())) log.warn('Git n’est pas installé : le push échouera tant qu’il est absent.')
    const server = await startServer({ ...findUi(), preloadDir, port: o.port })
    console.log(`\n🪂 Gitdrop — interface locale\n   ${pc.cyan(server.url)}\n`)
    log.dim('Les fichiers restent sur votre machine. Ctrl+C pour arrêter.')
    if (o.open) openBrowser(server.url)

    const stop = () => {
      void server.close().then(() => process.exit(0))
      setTimeout(() => process.exit(0), 500).unref()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
