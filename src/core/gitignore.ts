// Smart .gitignore generation and a pragmatic gitignore matcher.

export const ALWAYS_LINES = [
  '.env',
  '.env.*',
  '!.env.example',
  '!.env.sample',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '.idea/',
  '!.gitkeep',
]

const TEMPLATES: Record<string, string[]> = {
  nextjs: ['node_modules/', '.next/', 'out/', 'build/', 'dist/', 'coverage/', '.turbo/', '.vercel/', '*.tsbuildinfo', 'next-env.d.ts'],
  react: ['node_modules/', 'build/', 'dist/', 'coverage/', '.vite/', '*.local'],
  vue: ['node_modules/', 'dist/', 'coverage/', '*.local'],
  nuxt: ['node_modules/', '.nuxt/', '.output/', 'dist/', 'coverage/'],
  'react-native': ['node_modules/', '.expo/', 'ios/Pods/', 'android/build/', 'android/.gradle/'],
  svelte: ['node_modules/', '.svelte-kit/', 'build/', 'dist/', 'coverage/'],
  angular: ['node_modules/', 'dist/', 'coverage/', '.angular/'],
  astro: ['node_modules/', 'dist/', '.astro/'],
  node: ['node_modules/', 'dist/', 'build/', 'coverage/', '.npm/'],
  'node-api': ['node_modules/', 'dist/', 'build/', 'coverage/', '.env.local'],
  python: ['__pycache__/', '*.py[cod]', 'venv/', '.venv/', 'env/', '.pytest_cache/', '*.egg-info/', 'dist/', 'build/', '.mypy_cache/', 'htmlcov/'],
  django: ['__pycache__/', '*.py[cod]', 'venv/', '.venv/', 'db.sqlite3', 'media/', 'staticfiles/', '.pytest_cache/'],
  laravel: ['/vendor/', '/node_modules/', '/storage/*.key', '/public/hot', '.env.backup', '/bootstrap/cache/*.php', '.phpunit.result.cache'],
  php: ['/vendor/', '*.cache', '.phpunit.result.cache'],
  flutter: ['build/', '.dart_tool/', '.flutter-plugins', '.flutter-plugins-dependencies', '.packages', '.pub-cache/'],
  go: ['bin/', '*.exe', '*.test', '/vendor/'],
  rust: ['target/', 'Cargo.lock'],
  java: ['target/', 'build/', '*.class', '*.jar', '*.war', '.gradle/'],
  ruby: ['coverage/', '.bundle/', 'vendor/bundle', '*.gem', '.ruby-version'],
  static: ['.cache/', 'dist/'],
  unknown: [],
}

/** Turns a project-relative path into an exact, anchored gitignore pattern. */
export function ignorePattern(relPath: string): string {
  const escaped = relPath.replace(/[\\*?[\]]/g, '\\$&').replace(/ $/, '\\ ')
  return `/${escaped}`
}

export function buildGitignore(stackId: string, extraPaths: string[] = []): string {
  const lines = [...ALWAYS_LINES, ...(TEMPLATES[stackId] ?? []), ...extraPaths.map(ignorePattern)]
  const unique = [...new Set(lines)]
  const date = new Date().toISOString().slice(0, 10)
  return `# .gitignore généré par Gitdrop 🪂 (${date})\n# Drop your project. Push to GitHub.\n\n${unique.join('\n')}\n`
}

export function parseIgnoreRules(content: string): string[] {
  return content.split(/\r?\n/)
}

function globToRegex(pattern: string, anchored: boolean, dirOnly: boolean): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
        if (pattern[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  const suffix = dirOnly ? '(?:/.*)?$' : '$'
  if (anchored) return new RegExp('^' + re + suffix)
  return new RegExp('(?:^|.*/)' + re + suffix)
}

/**
 * Simplified gitignore matcher: supports plain names, `*`/`**` wildcards,
 * directory rules (trailing `/`), anchored rules (containing `/`) and
 * negations (`!`). Good enough for generated templates and classic repos.
 */
export function isIgnored(relPath: string, rules: string[]): boolean {
  let ignored = false
  const parts = relPath.split('/')
  for (let depth = 0; depth < parts.length; depth++) {
    const prefix = parts.slice(0, depth + 1).join('/')
    for (const raw of rules) {
      const rule = raw.trim()
      if (!rule || rule.startsWith('#') || rule === '/') continue
      const negated = rule.startsWith('!')
      const body = negated ? rule.slice(1) : rule
      if (!body) continue
      const dirOnly = body.endsWith('/')
      const clean = dirOnly ? body.slice(0, -1) : body
      if (!clean) continue
      const anchored = clean.startsWith('/') || clean.includes('/')
      const anchoredClean = clean.startsWith('/') ? clean.slice(1) : clean
      const re = globToRegex(anchoredClean, anchored, dirOnly)
      if (re.test(prefix)) {
        ignored = !negated
      }
    }
  }
  return ignored
}
