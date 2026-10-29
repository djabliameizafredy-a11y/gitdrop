import path from 'node:path'
import { confirm } from '@inquirer/prompts'
import { Command } from 'commander'
import pc from 'picocolors'
import { isGitRepo, originUrl, undoLastPush } from '../core/update.js'
import { ensureAuth } from './auth.js'
import { Spinner, isInteractive, log } from './term.js'

export const undoCommand = new Command('undo')
  .description('Annule le dernier commit poussé (crée un commit d’annulation, sans force-push)')
  .option('-C, --dir <path>', 'dossier du projet', '.')
  .option('-y, --yes', 'ne pas demander de confirmation')
  .action(async (o: { dir: string; yes?: boolean }) => {
    const dir = path.resolve(o.dir)
    if (!(await isGitRepo(dir)) || !(await originUrl(dir))) throw new Error('Ce dossier n’est pas un dépôt publié.')
    const { token, user } = await ensureAuth()
    if (isInteractive() && !o.yes) {
      if (!(await confirm({ message: 'Annuler le dernier commit poussé ?', default: false }))) return log.info('Annulé.')
    }
    const spinner = new Spinner()
    spinner.start('Annulation du dernier commit…')
    try {
      const r = await undoLastPush({ token, user: { login: user.login, id: user.id }, dir })
      spinner.succeed(`Commit « ${r.subject} » annulé sur la branche ${pc.bold(r.branch)}`)
    } catch (e) {
      spinner.fail('Annulation impossible')
      throw e
    }
  })
