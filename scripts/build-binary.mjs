// Builds the standalone executable (Node SEA) for the current platform.
// Run `npm run build` first. Output: dist/bin/gitdrop-<os>-<arch>[.exe] + .sha256
import { execFileSync } from 'node:child_process'
import { copyFileSync, createReadStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
process.chdir(root)

const os = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]
if (!os) throw new Error(`Unsupported platform: ${process.platform}`)
const exe = process.platform === 'win32' ? '.exe' : ''
const name = `gitdrop-${os}-${process.arch}${exe}`

const uiDir = 'dist/ui'
const bundle = 'dist/sea/cli.cjs'
statSync(uiDir)
statSync(bundle)

// Every UI file becomes an embedded asset: key "ui/<relative path>".
const assets = {}
const walk = (dir, rel = '') => {
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(dir, r)
    else assets[`ui/${r}`] = `${uiDir}/${r}`
  }
}
walk(uiDir)

mkdirSync('dist/bin', { recursive: true })
const blob = 'dist/sea/gitdrop.blob'
writeFileSync(
  'dist/sea/sea-config.json',
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, assets }, null, 2)
)
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea/sea-config.json'], { stdio: 'inherit' })

const out = path.join('dist/bin', name)
rmSync(out, { force: true })
copyFileSync(process.execPath, out)
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', out], { stdio: 'inherit' })

const postject = createRequire(import.meta.url).resolve('postject/dist/cli.js')
const args = [postject, out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA')
execFileSync(process.execPath, args, { stdio: 'inherit' })
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', out], { stdio: 'inherit' })
if (process.platform !== 'win32') chmodSync(out, 0o755)

const hash = createHash('sha256')
await new Promise((resolve, reject) => createReadStream(out).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject))
writeFileSync(`${out}.sha256`, `${hash.digest('hex')}  ${name}\n`)
console.log(`✔ ${out} (${(statSync(out).size / 1024 / 1024).toFixed(0)} MB)`)
