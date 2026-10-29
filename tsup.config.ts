import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }

const define = {
  __VERSION__: JSON.stringify(pkg.version),
  // Public OAuth App client id (Device Flow). Injected at build time, e.g. by CI.
  __CLIENT_ID__: JSON.stringify(process.env.GITDROP_CLIENT_ID ?? ''),
}

export default defineConfig([
  {
    // npm package: ESM, dependencies stay external (installed by npm).
    entry: { cli: 'src/cli.ts' },
    outDir: 'dist',
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    define,
  },
  {
    // Standalone binary: one self-contained CommonJS file (Node SEA requires CJS).
    entry: { cli: 'src/cli.ts' },
    outDir: 'dist/sea',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    clean: false,
    shims: true,
    noExternal: [/.*/],
    define,
  },
])
