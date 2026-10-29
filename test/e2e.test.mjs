import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { TOKEN, startMock } from './mock-github.mjs'

const run = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = process.env.GITDROP_CLI ?? path.join(ROOT, 'dist', 'cli.js')
const cliCmd = (args) => (CLI.endsWith('.js') ? ['node', [CLI, ...args]] : [CLI, args])

let tmp, remotes, mock, env
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const bare = (name) => path.join(remotes, 'tester', `${name}.git`)
const tree = (name) => sh(bare(name), 'ls-tree', '-r', 'main').split('\n').filter(Boolean)
const names = (name) => tree(name).map((l) => l.split('\t')[1])
const count = (name, ref = 'main') => Number(sh(bare(name), 'rev-list', '--count', ref))
const show = (name, file) => sh(bare(name), 'show', `main:${file}`)
const gitIn = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  })

async function gitdrop(args, opts = {}) {
  try {
    const [cmd, argv] = cliCmd(args)
    const r = await run(cmd, argv, { env: { ...env, ...opts.env }, cwd: opts.cwd ?? tmp })
    return { code: 0, out: r.stdout + r.stderr }
  } catch (e) {
    return { code: e.code ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

function makeProject(name) {
  const dir = path.join(tmp, name)
  mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true })
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, dependencies: { next: '15' } }))
  writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log("hi")\n')
  writeFileSync(path.join(dir, '.env'), 'API_KEY=sk-abcdefghijklmnopqrstuvwx\n')
  writeFileSync(path.join(dir, 'node_modules', 'dep', 'x.js'), 'x')
  writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\necho ok\n')
  chmodSync(path.join(dir, 'run.sh'), 0o755)
  return dir
}

function makeStatic(name) {
  const dir = path.join(tmp, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), '<h1>hello</h1>')
  return dir
}

before(async () => {
  assert.ok(existsSync(CLI), 'build the CLI first (npm run build:cli)')
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gitdrop-e2e-'))
  remotes = path.join(tmp, 'remotes')
  mkdirSync(remotes)
  mock = await startMock(remotes)
  env = {
    ...process.env,
    HOME: tmp,
    GITDROP_HOME: path.join(tmp, 'cfg'),
    GITDROP_GITHUB_API: mock.url,
    GITDROP_GITHUB_WEB: mock.url,
    GITDROP_GIT_BASE: `file://${remotes}`,
    GITDROP_TOKEN: '',
    GH_TOKEN: '',
    GITHUB_TOKEN: '',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  }
})
after(async () => mock.close())

describe('auth', () => {
  test('login --token stores the token with 0600 permissions, whoami and logout work', async () => {
    const bad = await gitdrop(['login', '--token', 'ghp_' + 'b'.repeat(36)])
    assert.notEqual(bad.code, 0)
    assert.match(bad.out, /invalide|expiré/)

    const ok = await gitdrop(['login', '--token', TOKEN])
    assert.equal(ok.code, 0, ok.out)
    assert.match(ok.out, /@tester/)
    const cfg = path.join(tmp, 'cfg', 'config.json')
    assert.equal(statSync(cfg).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).token, TOKEN)

    assert.match((await gitdrop(['whoami'])).out, /@tester/)
    assert.equal((await gitdrop(['logout'])).code, 0)
    assert.notEqual((await gitdrop(['whoami'])).code, 0)
  })

  test('device flow login (client id configured)', async () => {
    const r = await gitdrop(['login'], { env: { GITDROP_CLIENT_ID: 'Iv1.test' } })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /ABCD-1234/)
    assert.match(r.out, /@tester/)
    await gitdrop(['logout'])
  })
})

describe('push', () => {
  before(async () => {
    await gitdrop(['login', '--token', TOKEN])
  })

  test('folder: secrets and junk excluded, README/.gitignore generated, exec bit kept', async () => {
    const dir = makeProject('my-app')
    const r = await gitdrop(['push', dir, '--yes', '--private'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /github\.com\/tester\/my-app/)

    const files = names('my-app')
    assert.ok(files.includes('src/index.js'))
    assert.ok(files.includes('README.md'), 'README generated')
    assert.ok(files.includes('.gitignore'), '.gitignore generated')
    assert.ok(!files.includes('.env'), '.env must not be pushed')
    assert.ok(!files.some((f) => f.startsWith('node_modules/')), 'node_modules must not be pushed')
    assert.match(tree('my-app').find((l) => l.endsWith('run.sh')), /^100755/)

    assert.match(sh(dir, 'remote', 'get-url', 'origin'), /my-app\.git$/)
    assert.equal(sh(dir, 'rev-parse', '--abbrev-ref', '@{u}').length > 0, true)
    assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.env$/m)
    assert.match(sh(bare('my-app'), 'log', '-1', '--format=%s', 'main'), /Initial commit/)
    assert.match((await gitdrop(['history'])).out, /my-app/)
  })

  test('secrets are excluded even with --no-gitignore', async () => {
    const dir = makeProject('no-ignore')
    const r = await gitdrop(['push', dir, '--yes', '--no-gitignore', '--no-readme'])
    assert.equal(r.code, 0, r.out)
    const files = names('no-ignore')
    assert.ok(!files.includes('.env'))
    assert.ok(!files.includes('.gitignore'))
    assert.ok(!files.includes('README.md'))
  })

  test('assets/vendor in a website is pushed; the root vendor/ of a Composer project is not', async () => {
    const site = makeStatic('site-vendor')
    mkdirSync(path.join(site, 'assets', 'vendor'), { recursive: true })
    writeFileSync(path.join(site, 'assets', 'vendor', 'lib.min.js'), 'var x=1')
    assert.equal((await gitdrop(['push', site, '--yes'])).code, 0)
    assert.ok(names('site-vendor').includes('assets/vendor/lib.min.js'), 'nested vendor/ must be kept')

    const php = path.join(tmp, 'php-app')
    mkdirSync(path.join(php, 'vendor', 'acme'), { recursive: true })
    mkdirSync(path.join(php, 'public', 'vendor'), { recursive: true })
    writeFileSync(path.join(php, 'composer.json'), '{"name":"a/b"}')
    writeFileSync(path.join(php, 'index.php'), '<?php echo 1;')
    writeFileSync(path.join(php, 'vendor', 'acme', 'dep.php'), '<?php')
    writeFileSync(path.join(php, 'public', 'vendor', 'ui.js'), 'var y=2')
    assert.equal((await gitdrop(['push', php, '--yes'])).code, 0)
    const files = names('php-app')
    assert.ok(!files.includes('vendor/acme/dep.php'), 'Composer vendor/ must be excluded')
    assert.ok(files.includes('public/vendor/ui.js'), 'public/vendor/ must be kept')
  })

  test('zip: root folder is stripped and content pushed', async () => {
    const zip = new AdmZip()
    zip.addFile('proj/index.html', Buffer.from('<h1>hi</h1>'))
    zip.addFile('proj/css/site.css', Buffer.from('body{}'))
    zip.addFile('__MACOSX/proj/._index.html', Buffer.from('junk'))
    const file = path.join(tmp, 'proj.zip')
    zip.writeZip(file)
    const r = await gitdrop(['push', file, '--yes', '--name', 'from zip!'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /from-zip/)
    const files = names('from-zip')
    assert.ok(files.includes('index.html') && files.includes('css/site.css'), files.join())
    assert.ok(!files.some((f) => f.includes('MACOSX')))
  })

  test('existing non-empty repo name is refused; an empty one is reused', async () => {
    const dir = makeProject('dup')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    const again = await gitdrop(['push', makeProject('dup2'), '--yes', '--name', 'dup'])
    assert.notEqual(again.code, 0)
    assert.match(again.out, /existe déjà/)

    mock.precreate('empty-one')
    const r = await gitdrop(['push', makeProject('empty-src'), '--yes', '--name', 'empty-one'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /réutilisé/)
    assert.ok(names('empty-one').includes('src/index.js'))
  })

  test('not logged in (non interactive) fails clearly', async () => {
    const r = await gitdrop(['push', makeProject('nologin'), '--yes'], { env: { GITDROP_HOME: path.join(tmp, 'other') } })
    assert.notEqual(r.code, 0)
    assert.match(r.out, /Non connecté/)
  })
})

describe('update', () => {
  test('commits and pushes changes; blocks sensitive files unless --force', async () => {
    await gitdrop(['login', '--token', TOKEN])
    const dir = makeProject('upd')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)

    writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log("v2")\n')
    const ok = await gitdrop(['update', 'fix: v2', '-C', dir])
    assert.equal(ok.code, 0, ok.out)
    assert.match(sh(bare('upd'), 'log', '-1', '--format=%s', 'main'), /fix: v2/)

    writeFileSync(path.join(dir, 'secrets.json'), '{"password":"hunter2hunter2"}')
    writeFileSync(path.join(dir, 'credentials.json'), '{}')
    const blocked = await gitdrop(['update', 'oops', '-C', dir])
    assert.notEqual(blocked.code, 0)
    assert.match(blocked.out, /sensibles|Annulé/)
    assert.equal(sh(bare('upd'), 'rev-list', '--count', 'main'), '2')

    const forced = await gitdrop(['update', 'forced', '-C', dir, '--force'])
    assert.equal(forced.code, 0, forced.out)
    assert.equal(sh(bare('upd'), 'rev-list', '--count', 'main'), '3')
  })
})

describe('security: history, .env.example', () => {
  before(async () => {
    await gitdrop(['login', '--token', TOKEN])
  })

  function repoWithLeakedHistory(name) {
    const dir = path.join(tmp, name)
    mkdirSync(dir, { recursive: true })
    gitIn(dir, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(dir, 'app.js'), 'console.log(1)\n')
    writeFileSync(path.join(dir, 'config.js'), 'const k = "AKIAABCDEFGHIJKLMNOP"\n')
    writeFileSync(path.join(dir, '.env'), 'STRIPE=' + 'sk_live_' + 'a1b2c3d4e5f6g7h8i9j0k1l2\n')
    gitIn(dir, 'add', '-A')
    gitIn(dir, 'commit', '-qm', 'first')
    rmSync(path.join(dir, '.env'))
    writeFileSync(path.join(dir, 'config.js'), 'const k = process.env.K\n')
    gitIn(dir, 'add', '-A')
    gitIn(dir, 'commit', '-qm', 'remove secrets')
    return dir
  }

  test('secrets in the Git history block a non-interactive push and name where to revoke', async () => {
    const dir = repoWithLeakedHistory('leaky')
    const r = await gitdrop(['push', dir, '--yes'])
    assert.notEqual(r.code, 0)
    assert.match(r.out, /historique Git/)
    assert.match(r.out, /console\.aws\.amazon\.com/)
    assert.match(r.out, /--fresh-history/)
    assert.ok(!existsSync(bare('leaky')), 'no repository must be created')
  })

  test('--fresh-history publishes one clean commit and leaves the local history alone', async () => {
    const dir = repoWithLeakedHistory('leaky-fresh')
    const r = await gitdrop(['push', dir, '--yes', '--fresh-history'])
    assert.equal(r.code, 0, r.out)
    assert.equal(count('leaky-fresh'), 1)
    const files = names('leaky-fresh')
    assert.ok(files.includes('app.js') && !files.includes('.env'))
    // 2 original commits + the one Gitdrop made for the generated .gitignore / README.
    assert.equal(Number(gitIn(dir, 'rev-list', '--count', 'HEAD').trim()), 3, 'local history preserved')
    assert.equal(gitIn(dir, 'remote').trim(), '', 'origin is not wired to a diverging history')
    assert.match(r.out, /un seul commit propre/)
  })

  test('--force pushes the whole history', async () => {
    const dir = repoWithLeakedHistory('leaky-full')
    const r = await gitdrop(['push', dir, '--yes', '--force'])
    assert.equal(r.code, 0, r.out)
    assert.equal(count('leaky-full'), 3, 'full local history (2 + Gitdrop commit) is published')
  })

  test('excluded .env produces a value-free .env.example', async () => {
    const dir = makeProject('envx')
    writeFileSync(path.join(dir, '.env'), '# db\nAPI_KEY=sk-abcdefghijklmnopqrstuvwx\nPORT=3000\n')
    const r = await gitdrop(['push', dir, '--yes'])
    assert.equal(r.code, 0, r.out)
    const files = names('envx')
    assert.ok(files.includes('.env.example') && !files.includes('.env'))
    const example = show('envx', '.env.example')
    assert.equal(example, '# db\nAPI_KEY=\nPORT=')
    assert.ok(!example.includes('sk-'))
  })
})

describe('repo setup: license, topics, CI', () => {
  before(async () => {
    await gitdrop(['login', '--token', TOKEN])
  })

  test('--license mit, --topics and --ci', async () => {
    const dir = makeProject('setup')
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'setup', scripts: { build: 'x', test: 'y' }, dependencies: { next: '15' } }))
    const before = mock.calls.length
    const r = await gitdrop(['push', dir, '--yes', '--license', 'mit', '--ci', '--topics', 'cli, My Tool'])
    assert.equal(r.code, 0, r.out)
    assert.match(show('setup', 'LICENSE'), /MIT License\n\nCopyright \(c\) \d{4} Test User/)
    const ci = show('setup', '.github/workflows/ci.yml')
    assert.match(ci, /npm run build/)
    assert.match(ci, /npm run test/)
    const topics = mock.calls.slice(before).find((c) => c.method === 'PUT' && c.path.endsWith('/topics'))
    assert.ok(topics, 'topics were set')
    assert.ok(topics.body.names.includes('nextjs') && topics.body.names.includes('cli') && topics.body.names.includes('my-tool'), topics.body.names.join())
  })

  test('unknown license is rejected before anything happens', async () => {
    const r = await gitdrop(['push', makeProject('badlic'), '--yes', '--license', 'wtfpl'])
    assert.notEqual(r.code, 0)
    assert.match(r.out, /Licence inconnue/)
  })
})

describe('deploy to GitHub Pages', () => {
  before(async () => {
    await gitdrop(['login', '--token', TOKEN])
  })

  test('static site: Pages enabled, workflow added in a second commit, URL returned', async () => {
    const dir = makeStatic('static-site')
    const before = mock.calls.length
    const r = await gitdrop(['push', dir, '--yes', '--public', '--deploy'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /https:\/\/tester\.github\.io\/static-site\//)
    assert.equal(count('static-site'), 2)
    assert.match(sh(bare('static-site'), 'log', '-1', '--format=%s', 'main'), /deploy to GitHub Pages/)
    const wf = show('static-site', '.github/workflows/gitdrop-pages.yml')
    assert.match(wf, /upload-pages-artifact@v3/)
    assert.match(wf, /path: \.\n/)
    const seq = mock.calls.slice(before).map((c) => `${c.method} ${c.path}`)
    assert.ok(seq.includes('POST /repos/tester/static-site/pages'), seq.join('\n'))
    assert.equal(gitIn(dir, 'rev-parse', 'HEAD').trim(), sh(bare('static-site'), 'rev-parse', 'main'))
  })

  test('Vite project gets the repository base path in its build command', async () => {
    const dir = makeProject('vite-site')
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'v', scripts: { build: 'vite build' }, devDependencies: { vite: '5' } }))
    const r = await gitdrop(['push', dir, '--yes', '--public', '--deploy'])
    assert.equal(r.code, 0, r.out)
    const wf = show('vite-site', '.github/workflows/gitdrop-pages.yml')
    assert.match(wf, /npm run build -- --base=\/vite-site\//)
    assert.match(wf, /path: dist/)
  })

  test('private repo on a free plan: the push succeeds, the site is reported as not deployed', async () => {
    const r = await gitdrop(['push', makeStatic('private-site'), '--yes', '--private', '--deploy'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /pas le site/)
    assert.match(r.out, /plan payant/)
    assert.equal(count('private-site'), 1)
    assert.ok(!/en ligne dans/.test(r.out), 'no site URL is announced')
  })

  test('--deploy on an unsupported project fails before creating anything', async () => {
    const dir = makeProject('ssr')
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'next build' }, dependencies: { next: '15' } }))
    const r = await gitdrop(['push', dir, '--yes', '--public', '--deploy'])
    assert.notEqual(r.code, 0)
    assert.match(r.out, /ne peut pas être publié/)
    assert.ok(!existsSync(bare('ssr')))
  })

  test('gitdrop deploy publishes an already pushed repository', async () => {
    const dir = makeStatic('late-deploy')
    assert.equal((await gitdrop(['push', dir, '--yes', '--public'])).code, 0)
    assert.equal(count('late-deploy'), 1)
    const r = await gitdrop(['deploy', '-C', dir])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /github\.io\/late-deploy/)
    assert.equal(count('late-deploy'), 2)
    assert.ok(names('late-deploy').includes('.github/workflows/gitdrop-pages.yml'))
  })
})

describe('after the first push: messages, branch + PR, undo, watch', () => {
  before(async () => {
    await gitdrop(['login', '--token', TOKEN])
  })

  test('update without a message writes a Conventional Commit from the diff', async () => {
    const dir = makeProject('automsg')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log("changed")\n')
    const r = await gitdrop(['update', '-C', dir])
    assert.equal(r.code, 0, r.out)
    assert.equal(sh(bare('automsg'), 'log', '-1', '--format=%s', 'main'), 'chore: update index.js')
  })

  test('--branch --pr pushes the branch and opens a pull request against main', async () => {
    const dir = makeProject('prflow')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    writeFileSync(path.join(dir, 'feature.js'), 'export const x = 1\n')
    const before = mock.calls.length
    const r = await gitdrop(['update', 'feat: add feature', '-C', dir, '--branch', 'feat/x', '--pr'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /github\.com\/tester\/prflow\/pull\/1/)
    assert.match(sh(bare('prflow'), 'branch', '--list'), /feat\/x/)
    assert.equal(count('prflow', 'main'), 1, 'main is untouched')
    const pr = mock.calls.slice(before).find((c) => c.path.endsWith('/pulls'))
    assert.deepEqual({ head: pr.body.head, base: pr.body.base, title: pr.body.title }, { head: 'feat/x', base: 'main', title: 'feat: add feature' })
  })

  test('--pr from the default branch is refused with a clear message', async () => {
    const dir = makeProject('prmain')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    writeFileSync(path.join(dir, 'z.js'), '1')
    const r = await gitdrop(['update', 'x', '-C', dir, '--pr'])
    assert.notEqual(r.code, 0)
    assert.match(r.out, /--branch/)
    assert.equal(count('prmain'), 1)
  })

  test('undo reverts the last pushed commit without rewriting history', async () => {
    const dir = makeProject('undoable')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    const original = show('undoable', 'src/index.js')
    writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log("oops")\n')
    assert.equal((await gitdrop(['update', 'oops', '-C', dir])).code, 0)
    assert.equal(count('undoable'), 2)
    const r = await gitdrop(['undo', '-C', dir, '--yes'])
    assert.equal(r.code, 0, r.out)
    assert.equal(count('undoable'), 3)
    assert.equal(show('undoable', 'src/index.js'), original)
    assert.match(sh(bare('undoable'), 'log', '-1', '--format=%s', 'main'), /^Revert/)

    const first = makeProject('undo-first')
    assert.equal((await gitdrop(['push', first, '--yes'])).code, 0)
    const bad = await gitdrop(['undo', '-C', first, '--yes'])
    assert.notEqual(bad.code, 0)
    assert.match(bad.out, /premier commit/)
  })

  test('watch pushes a change automatically with a generated message', async () => {
    const dir = makeProject('watched')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    const [cmd, argv] = cliCmd(['watch', dir, '--delay', '1'])
    const child = spawn(cmd, argv, { env })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    try {
      await new Promise((r) => setTimeout(r, 1500))
      writeFileSync(path.join(dir, 'brand-new.js'), 'export {}\n')
      const deadline = Date.now() + 20000
      while (count('watched') < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
      assert.equal(count('watched'), 2, out)
      assert.equal(sh(bare('watched'), 'log', '-1', '--format=%s', 'main'), 'feat: add brand-new.js')
    } finally {
      child.kill()
    }
  })

  test('watch holds back a push that would publish a secret', async () => {
    const dir = makeProject('watch-guard')
    assert.equal((await gitdrop(['push', dir, '--yes'])).code, 0)
    const [cmd, argv] = cliCmd(['watch', dir, '--delay', '1'])
    const child = spawn(cmd, argv, { env })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    try {
      await new Promise((r) => setTimeout(r, 1500))
      writeFileSync(path.join(dir, 'credentials.json'), '{}')
      await new Promise((r) => setTimeout(r, 4000))
      assert.equal(count('watch-guard'), 1)
      assert.match(out, /Push suspendu/)
    } finally {
      child.kill()
    }
  })
})

describe('local UI server', () => {
  let child, base, key

  before(async () => {
    const uiDir = path.join(tmp, 'ui')
    mkdirSync(uiDir)
    writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><title>gitdrop</title>')
    await gitdrop(['login', '--token', TOKEN])
    const [cmd, argv] = cliCmd(['ui', '--no-open', '--port', '39517'])
    child = spawn(cmd, argv, { env: { ...env, GITDROP_UI_DIR: uiDir } })
    const url = await new Promise((resolve, reject) => {
      let buf = ''
      child.stdout.on('data', (d) => {
        buf += d
        const m = /http:\/\/localhost:\d+\/#k=[0-9a-f]+/.exec(buf)
        if (m) resolve(m[0])
      })
      child.on('exit', () => reject(new Error('server exited: ' + buf)))
      setTimeout(() => reject(new Error('timeout: ' + buf)), 8000)
    })
    base = url.split('#')[0].replace(/\/$/, '')
    key = url.split('#k=')[1]
  })
  after(() => child?.kill())

  const api = (p, init = {}) =>
    fetch(base + p, { ...init, headers: { 'x-gitdrop-key': key, ...(init.headers ?? {}) } })

  test('serves the UI, rejects API calls without the key', async () => {
    assert.equal((await fetch(base + '/')).status, 200)
    assert.equal((await fetch(base + '/api/state')).status, 401)
    assert.equal((await fetch(base + '/api/state', { headers: { 'x-gitdrop-key': 'nope' } })).status, 401)
    const state = await (await api('/api/state')).json()
    assert.equal(state.connected, true)
    assert.equal(state.user.login, 'tester')
    assert.equal(state.git, true)
  })

  test('rejects foreign Host headers (DNS rebinding) and foreign origins', async () => {
    const status = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: 39517, path: '/api/state', headers: { host: 'evil.example.com', 'x-gitdrop-key': key } },
        (res) => resolve(res.statusCode)
      )
      req.end()
    })
    assert.equal(status, 403)
    const r = await api('/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example.com' } })
    assert.equal(r.status, 403)
  })

  test('does not escape the UI directory', async () => {
    const r = await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')
    const text = await r.text()
    assert.ok(!text.includes('root:'))
  })

  test('upload → analyze → push (NDJSON stream) → history', async () => {
    const zip = new AdmZip()
    zip.addFile('site/index.html', Buffer.from('<h1>ui</h1>'))
    zip.addFile('site/.env', Buffer.from('SECRET_TOKEN=abcdefghijkl123456\n'))
    zip.addFile('site/package.json', Buffer.from('{"dependencies":{"react":"19"}}'))
    const up = await api('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/zip', 'x-filename': encodeURIComponent('site.zip') },
      body: zip.toBuffer(),
    })
    assert.equal(up.status, 200)
    const { workspaceId, rootName } = await up.json()
    assert.equal(rootName, 'site')

    const analysis = await (await api(`/api/analyze?ws=${workspaceId}`)).json()
    assert.equal(analysis.stack.id, 'react')
    assert.deepEqual(analysis.sensitiveFiles.map((f) => f.path), ['.env'])
    assert.equal(analysis.suggestedName, 'site')
    assert.equal(analysis.history, null)

    const res = await api('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        name: 'ui-site',
        visibility: 'private',
        readme: true,
        addGitignore: true,
        commitMessage: 'From UI',
        excludePaths: ['.env'],
      }),
    })
    assert.equal(res.status, 200)
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    const done = events.find((e) => e.type === 'done')
    assert.ok(done, JSON.stringify(events))
    assert.equal(done.fullName, 'tester/ui-site')
    assert.deepEqual(
      events.filter((e) => e.type === 'step' && e.status === 'done').map((e) => e.id),
      ['files', 'commit', 'repo', 'push']
    )
    const files = names('ui-site')
    assert.ok(files.includes('index.html') && !files.includes('.env'))
    assert.ok(files.includes('.env.example'), 'env example generated through the UI too')

    const hist = await (await api('/api/history')).json()
    assert.equal(hist.history[0].repoName, 'ui-site')
    assert.equal((await api(`/api/analyze?ws=${workspaceId}`)).status, 404, 'workspace purged after success')
  })

  test('UI push options: license, deploy (static site) and fresh history are honoured', async () => {
    const zip = new AdmZip()
    zip.addFile('page/index.html', Buffer.from('<h1>x</h1>'))
    const up = await api('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/zip', 'x-filename': 'page.zip' },
      body: zip.toBuffer(),
    })
    const { workspaceId } = await up.json()
    const analysis = await (await api(`/api/analyze?ws=${workspaceId}`)).json()
    assert.equal(analysis.deploy.kind, 'static')
    assert.equal(analysis.canCi, false)

    const res = await api('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, name: 'ui-page', visibility: 'public', license: 'isc', deploy: true }),
    })
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    const done = events.find((e) => e.type === 'done')
    assert.ok(done, JSON.stringify(events))
    assert.equal(done.siteUrl, 'https://tester.github.io/ui-page/')
    assert.ok(names('ui-page').includes('LICENSE'))
    assert.match(show('ui-page', 'LICENSE'), /ISC License/)
    assert.ok(events.some((e) => e.type === 'step' && e.id === 'deploy' && e.status === 'done'))
  })

  test('upload of a non-zip is refused cleanly', async () => {
    const r = await api('/api/upload', { method: 'POST', body: Buffer.from('not a zip') })
    assert.equal(r.status, 400)
  })
})

describe('gitdrop ui <path> (analyse in place)', () => {
  let child, base, key, dir

  before(async () => {
    await gitdrop(['login', '--token', TOKEN])
    dir = path.join(tmp, 'inplace')
    mkdirSync(dir, { recursive: true })
    gitIn(dir, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(dir, 'app.js'), 'console.log(1)\n')
    writeFileSync(path.join(dir, '.env'), 'GH=ghp_' + 'A'.repeat(36) + '\n')
    gitIn(dir, 'add', '-A')
    gitIn(dir, 'commit', '-qm', 'oops env')
    rmSync(path.join(dir, '.env'))
    gitIn(dir, 'add', '-A')
    gitIn(dir, 'commit', '-qm', 'remove env')
    const uiDir = path.join(tmp, 'ui2')
    mkdirSync(uiDir, { recursive: true })
    writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><title>x</title>')
    const [cmd, argv] = cliCmd(['ui', dir, '--no-open', '--port', '39518'])
    child = spawn(cmd, argv, { env: { ...env, GITDROP_UI_DIR: uiDir } })
    const url = await new Promise((resolve, reject) => {
      let buf = ''
      child.stdout.on('data', (d) => {
        buf += d
        const m = /http:\/\/localhost:\d+\/#k=[0-9a-f]+/.exec(buf)
        if (m) resolve(m[0])
      })
      child.on('exit', () => reject(new Error('server exited: ' + buf)))
      setTimeout(() => reject(new Error('timeout: ' + buf)), 8000)
    })
    base = url.split('#')[0].replace(/\/$/, '')
    key = url.split('#k=')[1]
  })
  after(() => child?.kill())

  const api = (p, init = {}) => fetch(base + p, { ...init, headers: { 'x-gitdrop-key': key, ...(init.headers ?? {}) } })

  test('the folder is exposed as preload and its Git history is scanned', async () => {
    const state = await (await api('/api/state')).json()
    assert.equal(state.preload.name, 'inplace')
    const a = await (await api(`/api/analyze?ws=${state.preload.workspaceId}`)).json()
    assert.equal(a.hasGit, true)
    assert.deepEqual(a.history.findings.map((f) => f.path), ['.env'])
    assert.equal(a.history.findings[0].stillPresent, false)
    assert.equal(a.history.findings[0].providers[0].name, 'GitHub')
    assert.equal(a.suggestedName, 'inplace')
  })

  test('pushing with a clean history leaves the local folder and its history untouched', async () => {
    const { preload } = await (await api('/api/state')).json()
    const res = await api('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: preload.workspaceId, name: 'inplace', visibility: 'private', freshHistory: true }),
    })
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    assert.ok(events.some((e) => e.type === 'done'), JSON.stringify(events))
    assert.equal(count('inplace'), 1)
    assert.ok(!names('inplace').includes('.env'))
    assert.ok(existsSync(dir), 'the user folder must not be deleted')
    assert.ok(Number(gitIn(dir, 'rev-list', '--count', 'HEAD').trim()) >= 2)
    assert.equal((await api(`/api/analyze?ws=${preload.workspaceId}`)).status, 200, 'still analysable afterwards')
  })

  test('an unknown workspace id is rejected', async () => {
    const r = await api('/api/analyze?ws=00000000-0000-4000-8000-000000000000')
    assert.equal(r.status, 404)
  })
})
