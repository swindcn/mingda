import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteConfigPath = path.join(root, 'vite.config.ts')
const mainPath = path.join(root, 'src/main.tsx')
const indexPath = path.join(root, 'index.html')

test('admin build supports a configurable subpath for static assets', () => {
  const viteConfig = fs.readFileSync(viteConfigPath, 'utf8')

  assert.match(viteConfig, /VITE_APP_BASE_PATH/)
  assert.match(viteConfig, /base:\s*appBasePath/)
})

test('admin router uses the same configurable subpath', () => {
  const main = fs.readFileSync(mainPath, 'utf8')

  assert.match(main, /VITE_APP_BASE_PATH/)
  assert.match(main, /<BrowserRouter basename=\{routerBasename\}>/)
})

test('admin does not reference a missing favicon asset', () => {
  const index = fs.readFileSync(indexPath, 'utf8')

  assert.doesNotMatch(index, /rel="icon"/)
})
