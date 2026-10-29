import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface DetectedStack {
  id: string
  label: string
  emoji: string
  details: string[]
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T
  } catch {
    return null
  }
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))]
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** Detects the project stack from marker files and package.json dependencies. */
export async function detectStack(projectDir: string): Promise<DetectedStack> {
  const pkg = await readJson<PackageJson>(path.join(projectDir, 'package.json'))
  const deps: Record<string, string> = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  }

  const details: string[] = []
  if (await exists(path.join(projectDir, 'tsconfig.json'))) details.push('TypeScript')
  else if (pkg) details.push('JavaScript')

  if (pkg) {
    if (deps['next']) return { id: 'nextjs', label: 'Next.js', emoji: '▲', details: uniq(['React', ...details]) }
    if (deps['nuxt']) return { id: 'nuxt', label: 'Nuxt', emoji: '🟩', details: uniq(['Vue', ...details]) }
    if (deps['expo'] || deps['react-native'])
      return { id: 'react-native', label: 'React Native', emoji: '📱', details: uniq(['React', ...details]) }
    if (deps['vue']) return { id: 'vue', label: 'Vue.js', emoji: '💚', details }
    if (deps['svelte'] || deps['@sveltejs/kit']) return { id: 'svelte', label: 'Svelte', emoji: '🧡', details }
    if (deps['@angular/core']) return { id: 'angular', label: 'Angular', emoji: '🅰️', details }
    if (deps['astro']) return { id: 'astro', label: 'Astro', emoji: '🚀', details }
    if (deps['react']) return { id: 'react', label: 'React', emoji: '⚛️', details }
    if (deps['express'] || deps['fastify'] || deps['@nestjs/core'] || deps['koa'])
      return { id: 'node-api', label: 'API Node.js', emoji: '🟢', details }
    return { id: 'node', label: 'Node.js', emoji: '🟢', details }
  }

  if (await exists(path.join(projectDir, 'pubspec.yaml')))
    return { id: 'flutter', label: 'Flutter', emoji: '🐦', details: uniq(['Dart', ...details]) }
  if ((await exists(path.join(projectDir, 'artisan'))) && (await exists(path.join(projectDir, 'composer.json'))))
    return { id: 'laravel', label: 'Laravel', emoji: '🔴', details: ['PHP'] }
  if (await exists(path.join(projectDir, 'composer.json')))
    return { id: 'php', label: 'PHP', emoji: '🐘', details }
  if (await exists(path.join(projectDir, 'manage.py')))
    return { id: 'django', label: 'Django', emoji: '🎸', details: ['Python'] }
  if (
    (await exists(path.join(projectDir, 'requirements.txt'))) ||
    (await exists(path.join(projectDir, 'pyproject.toml'))) ||
    (await exists(path.join(projectDir, 'main.py')))
  )
    return { id: 'python', label: 'Python', emoji: '🐍', details }
  if (await exists(path.join(projectDir, 'go.mod')))
    return { id: 'go', label: 'Go', emoji: '🐹', details }
  if (await exists(path.join(projectDir, 'Cargo.toml')))
    return { id: 'rust', label: 'Rust', emoji: '🦀', details }
  if ((await exists(path.join(projectDir, 'pom.xml'))) || (await exists(path.join(projectDir, 'build.gradle'))))
    return { id: 'java', label: 'Java', emoji: '☕', details }
  if (await exists(path.join(projectDir, 'Gemfile')))
    return { id: 'ruby', label: 'Ruby', emoji: '💎', details }
  if (await exists(path.join(projectDir, 'index.html')))
    return { id: 'static', label: 'Site statique', emoji: '🌐', details: uniq(['HTML', ...details]) }

  return { id: 'unknown', label: 'Projet générique', emoji: '📦', details }
}
