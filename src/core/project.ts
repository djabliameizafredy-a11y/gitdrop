import { existsSync } from 'node:fs'
import path from 'node:path'
import { detectStack } from './detect.js'
import { detectCi, detectDeploy } from './deploy.js'
import { scanHistory } from './history.js'
import { buildGitignore } from './gitignore.js'
import { scanSecrets } from './secrets.js'
import { slugifyRepoName } from './types.js'
import type { Analysis } from './types.js'
import { MAX_FILE_BYTES, walkProject } from './walk.js'

export const README_VARIANTS = ['README.md', 'readme.md', 'Readme.md', 'README.MD']

export const hasLicense = (dir: string) =>
  ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'license', 'License'].some((n) => existsSync(path.join(dir, n)))

export const hasReadme = (dir: string) => README_VARIANTS.some((n) => existsSync(path.join(dir, n)))

/** Inspects a project folder: stack, what would be pushed, sensitive files, warnings. */
export async function analyzeProject(projectDir: string, nameHint?: string): Promise<Analysis> {
  const stack = await detectStack(projectDir)
  const walk = await walkProject(projectDir)
  const sensitiveFiles = await scanSecrets(walk.files)

  const hasGitignore = existsSync(path.join(projectDir, '.gitignore'))
  const hasGit = existsSync(path.join(projectDir, '.git'))
  const history = hasGit ? await scanHistory(projectDir).catch(() => null) : null
  const deployPlan = await detectDeploy(projectDir)

  const warnings: string[] = []
  const skipped = [...new Set(walk.skippedDirs.filter((d) => d !== '.git').map((d) => d.split('/').pop()!))]
  if (skipped.length) {
    warnings.push(`Dossiers techniques ignorés automatiquement : ${skipped.slice(0, 6).join(', ')}`)
  }
  if (walk.oversized.length) {
    const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024)
    warnings.push(
      `${walk.oversized.length} fichier(s) dépassent ${mb} Mo et seront ignorés : ${walk.oversized
        .slice(0, 3)
        .map((f) => f.relPath)
        .join(', ')}`
    )
  }
  if (hasGit) {
    warnings.push('Un dépôt Git existe déjà dans ce dossier : tout son historique sera poussé.')
  }
  if (history?.findings.length) {
    warnings.push(`${history.findings.length} secret(s) trouvé(s) dans l’historique Git : ils seraient publiés.`)
  }
  if (walk.files.length === 0) warnings.push('Aucun fichier éligible au push n’a été détecté.')

  return {
    fileCount: walk.files.length,
    totalSize: walk.totalSize,
    stack,
    hasReadme: hasReadme(projectDir),
    hasGitignore,
    hasGit,
    hasLicense: hasLicense(projectDir),
    sensitiveFiles,
    history,
    deploy: deployPlan ? { kind: deployPlan.kind, label: deployPlan.label } : null,
    canCi: await detectCi(projectDir),
    suggestedName: slugifyRepoName(nameHint || path.basename(path.resolve(projectDir))),
    gitignoreContent: hasGitignore ? '' : buildGitignore(stack.id),
    warnings,
  }
}
