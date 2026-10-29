import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': path.resolve(here, '../src/core'),
      '@': path.resolve(here, 'src'),
    },
  },
  build: { outDir: path.resolve(here, '../dist/ui'), emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    // `npm run dev:ui` proxies the API to a running `gitdrop ui --port 3737`.
    proxy: { '/api': 'http://localhost:3737' },
  },
})
