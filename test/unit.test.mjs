import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { suggestCommitMessage } from '../src/core/commitmsg.ts'
import { detectDeploy, pagesBase, pagesWorkflow } from '../src/core/deploy.ts'
import { buildEnvExample, envExampleName } from '../src/core/envexample.ts'
import { entropy, matchContent } from '../src/core/secrets.ts'

const reasons = (text) => matchContent(text).map((h) => h.reason)
const providers = (text) => matchContent(text).map((h) => h.provider?.name).filter(Boolean)

describe('secret rules', () => {
  test('detects well-known provider keys and names the provider to revoke', () => {
    assert.deepEqual(providers('key = "AKIAABCDEFGHIJKLMNOP"'), ['AWS'])
    assert.deepEqual(providers('ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'), ['Anthropic'])
    assert.deepEqual(providers('openai: sk-proj-abcdefghijklmnopqrstuvwxyz0123'), ['OpenAI'])
    assert.deepEqual(providers('const s = "' + 'sk_live_' + 'a1b2c3d4e5f6g7h8i9j0k1l2' + '"'), ['Stripe'])
    assert.deepEqual(providers('token ghp_' + 'A'.repeat(36)), ['GitHub'])
    assert.deepEqual(providers('SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(43)), ['SendGrid'])
    assert.ok(reasons('-----BEGIN RSA PRIVATE KEY-----').includes('Clé privée intégrée'))
    assert.ok(reasons('postgres://admin:s3cr3tpass@db.example.com/app').includes('URL de base de données avec mot de passe'))
  })

  test('flags a high-entropy value assigned to a sensitive name', () => {
    const r = reasons('const clientSecret = "q8Zk2Lw9PxV3nT7bR5mY1cHd4Ja6"')
    assert.ok(r.includes('Chaîne à forte entropie affectée à un nom sensible'), r.join())
  })

  test('does not flag placeholders, env lookups or low-entropy values', () => {
    for (const text of [
      'password: "your_password_here"',
      'API_KEY=<your key>',
      'const token = process.env.API_TOKEN',
      'SECRET_KEY=changeme-please',
      'DATABASE_URL=postgres://user:${DB_PASSWORD}@localhost/db',
      'postgres://user:password@localhost:5432/db'.replace('password', 'changeme'),
    ]) {
      assert.deepEqual(reasons(text), [], text)
    }
  })

  test('a repetitive literal is a hard-coded secret but not a high-entropy one', () => {
    const r = reasons('const secret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"')
    assert.ok(r.includes('Secret en dur détecté'))
    assert.ok(!r.includes('Chaîne à forte entropie affectée à un nom sensible'))
  })

  test('entropy sanity', () => {
    assert.ok(entropy('aaaaaaaa') < 1)
    assert.ok(entropy('q8Zk2Lw9PxV3nT7bR5mY1cHd4Ja6') > 4)
  })
})

describe('.env.example', () => {
  test('keeps names, drops values and risky comments', () => {
    const out = buildEnvExample('# Database\nDB_URL=postgres://u:p@h/db\nexport API_KEY="abc123"\n\n# key=abc\nPORT=3000\n')
    assert.equal(out, '# Database\nDB_URL=\nAPI_KEY=\n\nPORT=\n')
    assert.ok(!out.includes('abc') && !out.includes('postgres'))
  })
  test('names', () => {
    assert.equal(envExampleName('.env'), '.env.example')
    assert.equal(envExampleName('api/.env.local'), 'api/.env.local.example')
    assert.equal(envExampleName('.env.example'), null)
    assert.equal(envExampleName('src/app.ts'), null)
  })
})

describe('GitHub Pages deploy', () => {
  const mk = (files) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gd-unit-'))
    for (const [f, c] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
      writeFileSync(path.join(dir, f), c)
    }
    return dir
  }

  test('detects static, Vite and CRA; rejects SSR frameworks', async () => {
    assert.equal((await detectDeploy(mk({ 'index.html': '<h1>x</h1>' })))?.kind, 'static')
    assert.equal((await detectDeploy(mk({ 'package.json': '{"scripts":{"build":"vite build"},"devDependencies":{"vite":"5"}}' })))?.kind, 'vite')
    assert.equal((await detectDeploy(mk({ 'package.json': '{"scripts":{"build":"x"},"dependencies":{"react-scripts":"5"}}' })))?.kind, 'cra')
    assert.equal(await detectDeploy(mk({ 'package.json': '{"scripts":{"build":"next build"},"dependencies":{"next":"15"}}' })), null)
    assert.equal(await detectDeploy(mk({ 'README.md': 'x' })), null)
  })

  test('base path: project pages vs user site', () => {
    assert.equal(pagesBase('tester', 'my-app'), '/my-app/')
    assert.equal(pagesBase('Tester', 'tester.github.io'), '/')
  })

  test('workflows carry the right base path, folder and package manager', async () => {
    const vite = await detectDeploy(mk({ 'package.json': '{"scripts":{"build":"vite build"},"devDependencies":{"vite":"5"}}', 'package-lock.json': '{}' }))
    const y = pagesWorkflow(vite, 'tester', 'my-app')
    assert.match(y, /- run: npm ci/)
    assert.match(y, /- run: npm run build -- --base=\/my-app\//)
    assert.match(y, /path: dist/)
    assert.match(y, /actions\/deploy-pages@v4/)

    const cra = await detectDeploy(mk({ 'package.json': '{"scripts":{"build":"x"},"dependencies":{"react-scripts":"5"}}', 'yarn.lock': '' }))
    const c = pagesWorkflow(cra, 'tester', 'my-app')
    assert.match(c, /- run: yarn install --frozen-lockfile/)
    assert.match(c, /PUBLIC_URL: \/my-app\n/)
    assert.match(c, /path: build/)

    const st = pagesWorkflow(await detectDeploy(mk({ 'index.html': 'x' })), 'tester', 'site')
    assert.ok(!st.includes('setup-node'))
    assert.match(st, /path: \.\n/)
  })
})

describe('commit message suggestion', () => {
  const repo = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gd-msg-'))
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' })
    g('init', '-q')
    writeFileSync(path.join(dir, 'a.js'), '1')
    writeFileSync(path.join(dir, 'README.md'), '1')
    g('add', '-A')
    g('commit', '-qm', 'init')
    return dir
  }
  test('picks the type from what changed', async () => {
    const dir = repo()
    writeFileSync(path.join(dir, 'README.md'), '2')
    assert.equal(await suggestCommitMessage(dir), 'docs: update README.md')
    writeFileSync(path.join(dir, 'a.js'), '2')
    assert.equal(await suggestCommitMessage(dir), 'chore: update README.md, a.js')
    const d2 = repo()
    writeFileSync(path.join(d2, 'new1.js'), '1')
    writeFileSync(path.join(d2, 'new2.js'), '1')
    assert.equal(await suggestCommitMessage(d2), 'feat: add new1.js, new2.js')
    const d3 = repo()
    writeFileSync(path.join(d3, 'package.json'), '{}')
    assert.equal(await suggestCommitMessage(d3), 'chore(deps): update dependencies')
  })
})
