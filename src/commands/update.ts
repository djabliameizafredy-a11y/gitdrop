import { confirm, input } from '@inquirer/prompts'
import { Command } from 'commander'
import pc from 'picocolors'
import path from 'node:path'
import { suggestCommitMessage } from '../core/commitmsg.js'
import { isGitRepo, originUrl, pendingSecrets, runUpdate } from '../core/update.js'
import type { PushEvent } from '../core/types.js'
import { ensureAuth } from './auth.js'
import { Spinner, isInteractive, log } from './term.js'

export const updateCommand = new Command('update')
  .description('Commit les modifications du dossier courant et les pousse sur GitHub')
  .argument('[message]', 'message du commit')
  .option('-C, --dir <path>', 'dossier du projet', '.')
  .option('--force', 'pousser même si des fichiers sensibles sont détectés')
  .option('-b, --branch <name>', 'travailler sur cette branche (créée si besoin)')
  .option('--pr', 'ouvrir une pull request pour la branche')
  .action(async (message: string | undefined, o: { dir: string; force?: boolean; branch?: string; pr?: boolean }) => {
    const dir = path.resolve(o.dir)
    if (!(await isGitRepo(dir))) {
      throw new Error('Ce dossier n’est pas un dépôt Git. Utilisez « gitdrop push » pour le publier d’abord.')
    }
    const origin = await originUrl(dir)
    if (!origin) throw new Error('Aucun remote « origin » : utilisez « gitdrop push » pour créer le dépôt.')

    const { token, user } = await ensureAuth()
    const interactive = isInteractive()

    const { pending, sensitive } = await pendingSecrets(dir)
    if (sensitive.length) {
      for (const f of sensitive) log.warn(`${pc.bold(f.path)} — ${f.reasons.join(', ')}`)
      if (!o.force) {
        const proceed =
          interactive && (await confirm({ message: 'Des fichiers sensibles vont être poussés. Continuer ?', default: false }))
        if (!proceed) throw new Error('Annulé : ajoutez ces fichiers au .gitignore ou utilisez --force.')
      }
    }

    const suggested = pending ? await suggestCommitMessage(dir) : 'chore: update'
    const commitMessage =
      message ?? (interactive && pending ? await input({ message: 'Message du commit :', default: suggested }) : suggested)

    const spinner = new Spinner()
    spinner.start('Envoi vers GitHub…')
    const emit = (ev: PushEvent) => {
      if (ev.type === 'progress') spinner.update(`Envoi vers GitHub ${ev.percent}%`)
    }
    try {
      const r = await runUpdate({
        token,
        user: { login: user.login, id: user.id },
        dir,
        message: commitMessage,
        branch: o.branch,
        pr: o.pr,
        emit,
      })
      spinner.succeed(r.committed ? `Commit créé et branche « ${r.branch} » poussée` : `Branche « ${r.branch} » poussée (rien de nouveau à committer)`)
      if (r.prUrl) console.log(`\n🔀 Pull request : ${pc.cyan(r.prUrl)}`)
    } catch (e) {
      spinner.fail('Échec du push')
      throw e
    }
    console.log(`\n🔗 ${pc.cyan(origin.replace(/\.git$/, ''))}\n`)
  })
