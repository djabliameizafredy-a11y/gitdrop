import { confirm, password } from '@inquirer/prompts'
import { Command } from 'commander'
import pc from 'picocolors'
import { ghCliToken, getClientId, startDeviceFlow, waitForDeviceToken } from '../core/auth.js'
import { clearAuth, resolveToken, saveAuth } from '../core/config.js'
import { getUser } from '../core/github.js'
import type { VerifiedUser } from '../core/github.js'
import { Spinner, isInteractive, log, openBrowser } from './term.js'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Gitdrop'

function printDeviceCode(uri: string, code: string): void {
  const pad = `  ${code}  `
  const bar = '─'.repeat(pad.length)
  console.log('')
  console.log(`  1. Ouvre  →  ${pc.cyan(uri)}`)
  console.log(`  2. Entre  →  ┌${bar}┐`)
  console.log(`               │${pc.bold(pad)}│`)
  console.log(`               └${bar}┘`)
  console.log('')
}

async function verifyAndSave(token: string): Promise<VerifiedUser> {
  const user = await getUser(token)
  if (user.scopes && !user.scopes.includes('repo')) {
    log.warn('Ce token n’a pas le scope « repo » : la création de dépôts échouera.')
  }
  saveAuth(token, { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl })
  return user
}

export async function loginFlow(opts: { token?: string; gh?: boolean } = {}): Promise<VerifiedUser> {
  let token = opts.token?.trim()

  if (!token && opts.gh) {
    token = (await ghCliToken()) ?? undefined
    if (!token) throw new Error('Aucune session GitHub CLI trouvée (« gh auth login » d’abord).')
  }

  if (!token) {
    const clientId = getClientId()
    if (clientId) {
      const spinner = new Spinner()
      const code = await startDeviceFlow(clientId)
      log.ok('Code généré')
      printDeviceCode(code.verificationUri, code.userCode)
      if (isInteractive()) openBrowser(code.verificationUri)
      spinner.start('En attente de l’autorisation…')
      try {
        token = await waitForDeviceToken(clientId, code)
      } finally {
        spinner.stop()
      }
    } else if (isInteractive()) {
      const gh = await ghCliToken()
      if (gh && (await confirm({ message: 'Session GitHub CLI détectée. L’utiliser ?', default: true }))) {
        token = gh
      } else {
        console.log(`\nCréez un token (scopes repo + workflow) : ${pc.cyan(TOKEN_URL)}\n`)
        token = (await password({ message: 'Collez votre token GitHub :', mask: '•' })).trim()
      }
    } else {
      throw new Error('Non connecté. Utilisez « gitdrop login --token <token> » ou la variable GITHUB_TOKEN.')
    }
  }

  const user = await verifyAndSave(token)
  log.ok(`Connecté : ${pc.bold('@' + user.login)}`)
  return user
}

/** Returns a verified token, running the login flow first when needed (interactive only). */
export async function ensureAuth(): Promise<{ token: string; user: VerifiedUser }> {
  const found = resolveToken()
  if (found) {
    try {
      return { token: found.token, user: await getUser(found.token) }
    } catch (e) {
      if (!(e instanceof Error) || !/invalide|expiré/i.test(e.message)) throw e
      if (found.source === 'config') clearAuth()
      if (!isInteractive()) throw e
      log.warn(e.message)
    }
  } else if (!isInteractive()) {
    throw new Error('Non connecté. Lancez « gitdrop login » ou définissez GITHUB_TOKEN.')
  } else {
    log.info('Vous n’êtes pas encore connecté à GitHub.')
  }
  const user = await loginFlow()
  const t = resolveToken()
  return { token: t!.token, user }
}

export const loginCommand = new Command('login')
  .description('Connecte Gitdrop à votre compte GitHub (une seule fois)')
  .option('-t, --token <token>', 'utiliser un token d’accès personnel')
  .option('--gh', 'réutiliser la session GitHub CLI (gh)')
  .action(async (o: { token?: string; gh?: boolean }) => {
    await loginFlow(o)
    log.dim(`Token stocké en local (${process.platform === 'win32' ? '%APPDATA%\\gitdrop' : '~/.config/gitdrop'}), jamais envoyé ailleurs qu’à GitHub.`)
  })

export const logoutCommand = new Command('logout')
  .description('Supprime le token GitHub stocké')
  .action(() => {
    log.ok(clearAuth() ? 'Déconnecté : le token a été supprimé.' : 'Aucun token stocké.')
  })

export const whoamiCommand = new Command('whoami')
  .description('Affiche le compte GitHub connecté')
  .action(async () => {
    const found = resolveToken()
    if (!found) throw new Error('Non connecté. Lancez « gitdrop login ».')
    const user = await getUser(found.token)
    console.log(`${pc.bold('@' + user.login)}${user.name ? ` (${user.name})` : ''}`)
    log.dim(found.source === 'env' ? 'Token : variable d’environnement' : 'Token : stocké localement')
  })
