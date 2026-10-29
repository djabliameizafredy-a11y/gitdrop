import { stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import { Command } from 'commander'
import pc from 'picocolors'
import { detectStack } from '../core/detect.js'
import { addHistory } from '../core/config.js'
import { analyzeProject } from '../core/project.js'
import { runPush } from '../core/push.js'
import { LICENSES, isLicenseId } from '../core/license.js'
import type { LicenseId } from '../core/license.js'
import { slugifyRepoName } from '../core/types.js'
import type { PushEvent } from '../core/types.js'
import { extractZipToWorkspace, removeWorkspace } from '../core/workspace.js'
import { ensureAuth } from './auth.js'
import { Spinner, formatBytes, isInteractive, log } from './term.js'

interface PushOptions {
  name?: string
  public?: boolean
  private?: boolean
  readme?: boolean
  gitignore: boolean
  message?: string
  description?: string
  yes?: boolean
  license?: string
  ci?: boolean
  deploy?: boolean
  freshHistory?: boolean
  force?: boolean
  topics?: string
  envExample: boolean
}

export const pushCommand = new Command('push')
  .description('Crée un dépôt GitHub et y pousse un dossier ou un .zip')
  .argument('[path]', 'dossier ou fichier .zip du projet', '.')
  .option('-n, --name <name>', 'nom du dépôt')
  .option('--public', 'dépôt public')
  .option('--private', 'dépôt privé (défaut)')
  .option('--readme', 'ajouter un README si absent')
  .option('--no-readme', 'ne pas ajouter de README')
  .option('--no-gitignore', 'ne pas générer de .gitignore')
  .option('-m, --message <message>', 'message du commit', undefined)
  .option('-d, --description <text>', 'description du dépôt')
  .option('-y, --yes', 'ne pas demander de confirmation')
  .option('--license <id>', `ajouter une licence (${LICENSES.map((l) => l.id).join(', ')})`)
  .option('--ci', 'générer un workflow CI (build/test) pour un projet Node')
  .option('--deploy', 'publier le site sur GitHub Pages (site statique, Vite, CRA)')
  .option('--fresh-history', 'ne pousser qu’un seul commit propre (sans l’historique Git existant)')
  .option('--force', 'continuer malgré des secrets trouvés dans l’historique Git')
  .option('--topics <list>', 'topics GitHub supplémentaires, séparés par des virgules')
  .option('--no-env-example', 'ne pas créer de .env.example')
  .action(async (target: string, o: PushOptions) => {
    if (o.public && o.private) throw new Error('Choisissez --public ou --private, pas les deux.')
    if (o.license && !isLicenseId(o.license)) {
      throw new Error(`Licence inconnue « ${o.license} » (${LICENSES.map((l) => l.id).join(', ')}).`)
    }

    const abs = path.resolve(target)
    const info = await stat(abs).catch(() => null)
    if (!info) throw new Error(`Introuvable : ${abs}`)

    let projectDir = abs
    let workspaceId: string | null = null
    let nameHint: string | undefined
    if (info.isFile()) {
      if (!/\.zip$/i.test(abs)) throw new Error('Donnez un dossier ou un fichier .zip.')
      const spinner = new Spinner()
      spinner.start('Extraction de l’archive…')
      try {
        const ws = await extractZipToWorkspace(await readFile(abs), path.basename(abs))
        projectDir = ws.projectDir
        workspaceId = ws.id
        nameHint = ws.meta.rootName || path.basename(abs).replace(/\.zip$/i, '')
        spinner.succeed(`Archive extraite (${ws.meta.fileCount} fichiers)`)
      } catch (e) {
        spinner.fail('Extraction impossible')
        throw e
      }
    }

    try {
      await run(projectDir, nameHint, o)
    } finally {
      if (workspaceId) await removeWorkspace(workspaceId)
    }
  })

async function run(projectDir: string, nameHint: string | undefined, o: PushOptions): Promise<void> {
  const { token, user } = await ensureAuth()
  const interactive = isInteractive()

  const spin = new Spinner()
  spin.start('Analyse du projet…')
  const analysis = await analyzeProject(projectDir, nameHint)
  spin.succeed(
    `Projet analysé : ${analysis.stack.emoji} ${pc.bold(analysis.stack.label)} — ${analysis.fileCount} fichiers (${formatBytes(analysis.totalSize)})`
  )
  for (const w of analysis.warnings) log.warn(w)
  if (analysis.fileCount === 0) throw new Error('Rien à pousser dans ce dossier.')

  // Sensitive files: excluded by default, the user can keep some explicitly.
  let excludePaths = analysis.sensitiveFiles.map((f) => f.path)
  if (analysis.sensitiveFiles.length) {
    if (interactive && !o.yes) {
      excludePaths = await checkbox({
        message: `${analysis.sensitiveFiles.length} fichier(s) sensible(s) détecté(s). Cochés = exclus du push :`,
        choices: analysis.sensitiveFiles.map((f) => ({
          name: `${f.path} ${pc.dim('— ' + f.reasons.join(', '))}`,
          value: f.path,
          checked: true,
        })),
      })
    } else {
      log.warn(`Fichiers sensibles exclus : ${excludePaths.join(', ')}`)
    }
  } else {
    log.ok('Aucun secret détecté')
  }

  // Secrets already present in the Git history would be published with it.
  let freshHistory = !!o.freshHistory
  const hist = analysis.history?.findings ?? []
  if (hist.length && !freshHistory) {
    console.log('')
    log.warn(pc.bold(`${hist.length} secret(s) dans l’historique Git — ils seraient publiés avec lui :`))
    for (const f of hist.slice(0, 8)) {
      console.log(`   ${pc.bold(f.path)} ${pc.dim(`(commit ${f.commit} — ${f.reasons.join(', ')})`)}`)
      for (const p of f.providers) console.log(`   ${pc.dim('↳ révoquer :')} ${pc.cyan(p.url)}`)
    }
    if (hist.length > 8) log.dim(`   … et ${hist.length - 8} autre(s)`)
    log.dim('   Une clé déjà commitée doit être considérée comme compromise : révoquez-la, même après publication propre.')
    console.log('')
    if (interactive && !o.yes) {
      const choice = await select({
        message: 'Que faire de l’historique ?',
        choices: [
          { name: 'Repartir d’un historique propre (1 seul commit) — recommandé', value: 'fresh' },
          { name: 'Pousser tout l’historique quand même', value: 'full' },
          { name: 'Annuler', value: 'cancel' },
        ],
      })
      if (choice === 'cancel') return log.info('Annulé. Rien n’a été envoyé.')
      freshHistory = choice === 'fresh'
    } else if (!o.force) {
      throw new Error('Secrets dans l’historique Git : utilisez --fresh-history (recommandé) ou --force.')
    }
  }

  const rawName =
    o.name ??
    (interactive && !o.yes
      ? await input({ message: 'Nom du dépôt GitHub :', default: analysis.suggestedName })
      : analysis.suggestedName)
  const repoName = slugifyRepoName(rawName)
  if (repoName !== rawName) log.info(`Nom normalisé pour GitHub : ${pc.bold(repoName)}`)

  const visibility: 'public' | 'private' = o.public
    ? 'public'
    : o.private
      ? 'private'
      : interactive && !o.yes
        ? await select({
            message: 'Visibilité :',
            default: 'private',
            choices: [
              { name: 'Privé', value: 'private' as const },
              { name: 'Public', value: 'public' as const },
            ],
          })
        : 'private'

  const addReadme =
    analysis.hasReadme
      ? false
      : (o.readme ??
        (interactive && !o.yes ? await confirm({ message: 'Ajouter un README ?', default: true }) : true))

  const wantsDeploy =
    o.deploy ??
    (analysis.deploy && visibility === 'public' && interactive && !o.yes
      ? await confirm({ message: `Publier le site en ligne ? (${analysis.deploy.label})`, default: true })
      : false)
  if (wantsDeploy && !analysis.deploy) throw new Error('Ce projet ne peut pas être publié automatiquement (site statique, Vite ou CRA).')
  if (wantsDeploy && visibility === 'private') {
    log.warn('GitHub Pages sur un dépôt privé exige un plan payant : la publication du site peut échouer.')
  }

  let license: LicenseId | undefined = o.license as LicenseId | undefined
  let ci = !!o.ci
  if (interactive && !o.yes && o.license === undefined && o.ci === undefined && (!analysis.hasLicense || analysis.canCi)) {
    if (await confirm({ message: 'Configurer des options avancées (licence, CI) ?', default: false })) {
      if (!analysis.hasLicense) {
        const pick = await select({
          message: 'Licence :',
          default: 'none',
          choices: [{ name: 'Aucune', value: 'none' }, ...LICENSES.map((l) => ({ name: l.label, value: l.id }))],
        })
        license = pick === 'none' ? undefined : (pick as LicenseId)
      }
      if (analysis.canCi) ci = await confirm({ message: 'Ajouter un workflow CI (build + tests) ?', default: true })
    }
  }
  if (ci && !analysis.canCi) {
    log.warn('Pas de script « build » ou « test » dans package.json : pas de workflow CI généré.')
    ci = false
  }

  const commitMessage =
    o.message ??
    (interactive && !o.yes ? await input({ message: 'Message du commit :', default: 'Initial commit' }) : 'Initial commit')

  if (interactive && !o.yes) {
    console.log(
      `\n  ${pc.bold(`${user.login}/${repoName}`)} · ${visibility === 'public' ? 'public' : 'privé'} · ${analysis.fileCount - excludePaths.length} fichiers\n`
    )
    if (!(await confirm({ message: 'Confirmer le push ?', default: true }))) {
      log.info('Annulé. Rien n’a été envoyé.')
      return
    }
  }

  const stack = await detectStack(projectDir)
  const spinner = new Spinner()
  const labels: Record<string, string> = {}
  const emit = (ev: PushEvent) => {
    if (ev.type === 'step') {
      labels[ev.id] = ev.label
      if (ev.status === 'running') spinner.start(ev.label)
      else if (ev.status === 'done') spinner.succeed(ev.label)
      else spinner.fail(ev.label)
    } else if (ev.type === 'progress') {
      spinner.update(`${labels.push ?? 'Envoi'} ${ev.percent}%`)
    } else if (ev.type === 'warning') {
      spinner.stop()
      log.warn(ev.message)
    }
  }

  const outcome = await runPush({
    token,
    user: { login: user.login, id: user.id, name: user.name },
    projectDir,
    stack,
    config: {
      repoName,
      visibility,
      description: o.description,
      addReadme,
      addGitignore: o.gitignore,
      commitMessage,
      excludePaths,
      license,
      envExample: o.envExample,
      freshHistory,
      ci,
      deploy: wantsDeploy,
      topics: o.topics?.split(',').map((t) => t.trim()).filter(Boolean),
    },
    emit,
  })

  addHistory({
    username: user.login,
    repoName,
    repoUrl: outcome.url,
    visibility,
    stack: stack.id,
    fileCount: outcome.fileCount,
  })
  console.log(`\n🔗 ${pc.bold(pc.cyan(outcome.url))}  ${pc.dim(`(${outcome.fileCount} fichiers)`)}`)
  if (outcome.siteUrl) {
    console.log(`🌐 ${pc.bold(pc.cyan(outcome.siteUrl))}  ${pc.dim('(en ligne dans ~1 minute)')}`)
  }
  if (freshHistory && analysis.hasGit) log.dim('Historique local conservé ; GitHub n’a reçu qu’un seul commit propre.')
  console.log('')
}
