import path from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import { isGitRepo, deployExisting, originUrl } from '../core/update.js'
import { ensureAuth } from './auth.js'
import { Spinner, log } from './term.js'

export const deployCommand = new Command('deploy')
  .description('Publie le site d’un dépôt déjà poussé sur GitHub Pages')
  .option('-C, --dir <path>', 'dossier du projet', '.')
  .action(async (o: { dir: string }) => {
    const dir = path.resolve(o.dir)
    if (!(await isGitRepo(dir)) || !(await originUrl(dir))) throw new Error('Ce dossier n’est pas un dépôt publié.')
    const { token, user } = await ensureAuth()
    const spinner = new Spinner()
    spinner.start('Activation de GitHub Pages…')
    try {
      const r = await deployExisting({ token, user: { login: user.login, id: user.id }, dir })
      spinner.succeed('Workflow de déploiement poussé')
      if (r.branch !== 'main') log.warn(`Le workflow se déclenche sur « main » (vous êtes sur « ${r.branch} »).`)
      console.log(`\n🌐 ${pc.bold(pc.cyan(r.siteUrl))}  ${pc.dim('(en ligne dans ~1 minute)')}\n`)
    } catch (e) {
      spinner.fail('Publication impossible')
      throw e
    }
  })
