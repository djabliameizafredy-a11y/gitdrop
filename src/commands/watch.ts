import { watch } from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import { suggestCommitMessage } from '../core/commitmsg.js'
import { isGitRepo, originUrl, pendingSecrets, runUpdate } from '../core/update.js'
import { ensureAuth } from './auth.js'
import { log } from './term.js'

export const watchCommand = new Command('watch')
  .description('Surveille le dossier et pousse automatiquement chaque modification sur GitHub')
  .argument('[dir]', 'dossier du projet (dépôt déjà publié)', '.')
  .option('--delay <seconds>', 'attente après la dernière modification', (v) => Number.parseFloat(v), 5)
  .option('--force', 'pousser même si des fichiers sensibles sont détectés')
  .action(async (dirArg: string, o: { delay: number; force?: boolean }) => {
    const dir = path.resolve(dirArg)
    if (!(await isGitRepo(dir)) || !(await originUrl(dir))) {
      throw new Error('Ce dossier doit être un dépôt publié (« gitdrop push » d’abord).')
    }
    if (!(o.delay >= 0.5)) throw new Error('--delay doit être d’au moins 0,5 seconde.')
    const { token, user } = await ensureAuth()

    let timer: NodeJS.Timeout | null = null
    let running = false
    let again = false
    let lastBlocked = ''

    const sync = async (): Promise<void> => {
      if (running) {
        again = true
        return
      }
      running = true
      try {
        const { pending, sensitive } = await pendingSecrets(dir)
        if (!pending) return
        if (sensitive.length && !o.force) {
          const key = sensitive.map((f) => f.path).join('|')
          if (key !== lastBlocked) {
            lastBlocked = key
            log.warn(`Push suspendu — fichiers sensibles : ${sensitive.map((f) => f.path).join(', ')} (ajoutez-les au .gitignore ou utilisez --force)`)
          }
          return
        }
        lastBlocked = ''
        const message = await suggestCommitMessage(dir)
        const r = await runUpdate({ token, user: { login: user.login, id: user.id }, dir, message })
        log.ok(`${new Date().toLocaleTimeString('fr-FR')}  ${pc.bold(message)} → ${r.branch}`)
      } catch (e) {
        log.error(e instanceof Error ? e.message : String(e))
      } finally {
        running = false
        if (again) {
          again = false
          schedule()
        }
      }
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void sync(), o.delay * 1000)
    }

    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? '').replace(/\\/g, '/')
      // Ignore Git's own files (our commits would retrigger us) and heavy folders.
      if (/(^|\/)(\.git|node_modules)(\/|$)/.test(name)) return
      schedule()
    })
    console.log(`\n👀 ${pc.bold('Gitdrop watch')} — ${dir}\n   Chaque modification sera poussée ${o.delay}s après la dernière. Ctrl+C pour arrêter.\n`)
    schedule()
    const stop = () => {
      watcher.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    await new Promise(() => undefined)
  })
