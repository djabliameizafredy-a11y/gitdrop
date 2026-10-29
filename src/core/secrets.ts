import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProviderLink } from './types.js'

export interface SensitiveFinding {
  path: string
  reasons: string[]
  size: number
  providers: ProviderLink[]
}

interface Rule {
  reason: string
  re: RegExp
  provider?: ProviderLink
  /** Extra check on the match (placeholder filtering, entropy…). */
  accept?: (m: RegExpExecArray) => boolean
}

const PLACEHOLDER = /your[_-]|example|changeme|change[_-]me|placeholder|dummy|sample|xxxx|<[^>]+>|\$\{|\{\{|process\.env|os\.environ|getenv/i

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

const link = (name: string, url: string): ProviderLink => ({ name, url })

export const CONTENT_RULES: Rule[] = [
  { reason: 'Clé d’accès AWS', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, provider: link('AWS', 'https://console.aws.amazon.com/iam/home#/security_credentials') },
  { reason: 'Token GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/, provider: link('GitHub', 'https://github.com/settings/tokens') },
  { reason: 'Clé API Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, provider: link('Anthropic', 'https://console.anthropic.com/settings/keys') },
  { reason: 'Clé API OpenAI', re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/, provider: link('OpenAI', 'https://platform.openai.com/api-keys') },
  { reason: 'Clé secrète Stripe', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/, provider: link('Stripe', 'https://dashboard.stripe.com/apikeys') },
  { reason: 'Token Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, provider: link('Slack', 'https://api.slack.com/apps') },
  { reason: 'Clé API Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/, provider: link('Google Cloud', 'https://console.cloud.google.com/apis/credentials') },
  { reason: 'Clé API SendGrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/, provider: link('SendGrid', 'https://app.sendgrid.com/settings/api_keys') },
  { reason: 'Token npm', re: /\bnpm_[A-Za-z0-9]{36}\b/, provider: link('npm', 'https://www.npmjs.com/settings/~/tokens') },
  { reason: 'Clé API Twilio', re: /\bSK[0-9a-f]{32}\b/, provider: link('Twilio', 'https://console.twilio.com/') },
  { reason: 'Token de bot Discord', re: /\b[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/, provider: link('Discord', 'https://discord.com/developers/applications') },
  { reason: 'Token de bot Telegram', re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, provider: link('Telegram', 'https://t.me/BotFather') },
  { reason: 'Clé privée intégrée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    reason: 'URL de base de données avec mot de passe',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s:@/]+:([^\s:@/]+)@/,
    accept: (m) => !PLACEHOLDER.test(m[1]) && m[1].length >= 4,
  },
  {
    reason: 'Secret en dur détecté',
    re: /\b(?:api[_-]?key|apikey|secret|password|passwd|token)\b\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    accept: (m) => !PLACEHOLDER.test(m[1]),
  },
  {
    reason: 'Variable sensible renseignée',
    re: /^[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*["']?([^\s"']{8,})/m,
    accept: (m) => !PLACEHOLDER.test(m[1]),
  },
  {
    reason: 'Chaîne à forte entropie affectée à un nom sensible',
    re: /\b[\w.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|credential)[\w.-]*\s*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/i,
    accept: (m) => !PLACEHOLDER.test(m[1]) && entropy(m[1]) >= 3.6,
  },
]

const NAME_RULES: { test: (name: string) => boolean; reason: string }[] = [
  {
    test: (n) => /^\.env(\..+)?$/.test(n) && !/^\.env\.(example|sample|template|dist)$/.test(n),
    reason: 'Variables d’environnement (config locale)',
  },
  { test: (n) => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(n), reason: 'Clé privée / certificat' },
  { test: (n) => /^id_(rsa|dsa|ecdsa|ed25519)/.test(n), reason: 'Clé SSH privée' },
  {
    test: (n) => /^credentials(\..+)?$/i.test(n) || /serviceaccountkey/i.test(n),
    reason: 'Fichier d’identifiants de service',
  },
  { test: (n) => n === '.npmrc', reason: 'Peut contenir un token npm' },
  { test: (n) => n === '.netrc' || n === '.htpasswd', reason: 'Fichier d’authentification' },
  { test: (n) => n === 'auth.json', reason: 'Authentification (auth/composer)' },
]

const TEXT_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.py', '.php', '.rb', '.go', '.java', '.kt', '.swift',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env', '.txt', '.sh', '.bash', '.zsh',
  '.xml', '.sql', '.md', '.html', '.css', '.scss', '.vue', '.svelte', '.dart', '.properties',
  '.gradle', '.pl', '.lua', '.r', '.tf', '.cs',
])

const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Cargo.lock', 'poetry.lock'])
const isExampleName = (n: string) => /\.(example|sample|template|dist)$/.test(n)

export interface RuleHit {
  reason: string
  provider?: ProviderLink
}

/** Runs every content rule on a piece of text. */
export function matchContent(text: string): RuleHit[] {
  const hits: RuleHit[] = []
  for (const r of CONTENT_RULES) {
    const m = r.re.exec(text)
    if (m && (!r.accept || r.accept(m)) && !hits.some((h) => h.reason === r.reason)) {
      hits.push({ reason: r.reason, provider: r.provider })
    }
  }
  return hits
}

export function matchName(name: string): string[] {
  return NAME_RULES.filter((r) => r.test(name)).map((r) => r.reason)
}

export const isSensitiveName = (name: string): boolean => matchName(path.basename(name)).length > 0

function addProvider(list: ProviderLink[], p?: ProviderLink) {
  if (p && !list.some((x) => x.name === p.name)) list.push(p)
}

export interface ScanCandidate {
  relPath: string
  absPath: string
  size: number
}

/** Scans project files for sensitive names and embedded secrets. */
export async function scanSecrets(candidates: ScanCandidate[], max = 25): Promise<SensitiveFinding[]> {
  const out: SensitiveFinding[] = []
  for (const f of candidates) {
    const name = path.basename(f.relPath)
    const reasons: string[] = [...matchName(name)]
    const providers: ProviderLink[] = []
    if (!isExampleName(name) && !LOCKFILES.has(name) && f.size <= 512 * 1024) {
      const ext = path.extname(name).toLowerCase()
      const envLike = name.startsWith('.env') || name === '.npmrc'
      if (TEXT_EXT.has(ext) || envLike) {
        try {
          const content = await readFile(f.absPath, 'utf8')
          for (const hit of matchContent(content)) {
            if (!reasons.includes(hit.reason)) reasons.push(hit.reason)
            addProvider(providers, hit.provider)
          }
        } catch {
          // Unreadable file — skip content scan.
        }
      }
    }
    if (reasons.length) {
      out.push({ path: f.relPath, reasons, size: f.size, providers })
      if (out.length >= max) break
    }
  }
  return out
}
