import { Command } from 'commander'
import pc from 'picocolors'
import { readHistory } from '../core/config.js'
import { log } from './term.js'

export const historyCommand = new Command('history')
  .description('Liste les derniers dépôts créés avec Gitdrop')
  .action(() => {
    const items = readHistory().slice(0, 15)
    if (!items.length) return log.info('Aucun push pour le moment.')
    for (const h of items) {
      const date = new Date(h.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
      console.log(`${pc.dim(date)}  ${pc.cyan(h.repoUrl)}  ${pc.dim(`${h.visibility} · ${h.fileCount} fichiers`)}`)
    }
  })
