import type { DetectedStack } from './detect.js'

const INSTALL: Record<string, string[]> = {
  nextjs: ['npm install', 'npm run dev'],
  react: ['npm install', 'npm start'],
  vue: ['npm install', 'npm run dev'],
  nuxt: ['npm install', 'npm run dev'],
  svelte: ['npm install', 'npm run dev'],
  angular: ['npm install', 'npm start'],
  astro: ['npm install', 'npm run dev'],
  node: ['npm install', 'npm start'],
  'node-api': ['npm install', 'npm run dev'],
  'react-native': ['npm install', 'npx expo start'],
  python: ['pip install -r requirements.txt', 'python main.py'],
  django: ['pip install -r requirements.txt', 'python manage.py migrate', 'python manage.py runserver'],
  laravel: ['composer install', 'cp .env.example .env', 'php artisan key:generate', 'php artisan serve'],
  php: ['composer install'],
  flutter: ['flutter pub get', 'flutter run'],
  go: ['go mod tidy', 'go run .'],
  rust: ['cargo build', 'cargo run'],
  java: ['mvn install'],
  ruby: ['bundle install', 'ruby app.rb'],
  static: ['Ouvrez `index.html` dans votre navigateur.'],
}

export function generateReadme(opts: {
  repoName: string
  description?: string
  stack: DetectedStack
  username: string
}): string {
  const { repoName, description, stack, username } = opts
  const desc =
    description?.trim() ||
    'Projet poussé sur GitHub avec **Gitdrop** — Drop your project. Push to GitHub. 🪂'
  const stackList = [stack.label, ...stack.details]
  const badge = `![Stack](https://img.shields.io/badge/stack-${encodeURIComponent(stack.label)}-10b981)`
  const installSteps = (INSTALL[stack.id] ?? [])
    .map((c) => '```bash\n' + c + '\n```')
    .join('\n\n')

  return `# ${repoName}

${desc}

${badge}

## 📖 À propos

Ce dépôt a été créé automatiquement avec **Gitdrop**.
Stack détectée : **${stack.label}** ${stack.emoji}

## 🧰 Stack technique

${stackList.map((d) => `- ${d}`).join('\n')}

## 🚀 Démarrage rapide

\`\`\`bash
git clone https://github.com/${username}/${repoName}.git
cd ${repoName}
\`\`\`

### Installation

${installSteps || '```bash\n# À adapter selon votre projet\n```'}

## 🤝 Contribuer

Les contributions sont les bienvenues ! Ouvrez une *issue* ou une *pull request*.

---

<p align="center">Créé avec 🪂 <strong>Gitdrop</strong> — Drop your project. Push to GitHub.</p>
`
}
