import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const distRoot = join(appRoot, 'dist')
const buildMode = process.argv[2]
const apiBaseUrls = {
  dev: 'http://127.0.0.1:3000/api',
  prod: 'https://www.mindajixie.cn/mes/api',
}
const apiBaseUrl = Object.hasOwn(apiBaseUrls, buildMode) ? apiBaseUrls[buildMode] : undefined

if (!apiBaseUrl) {
  console.error(`Unsupported miniprogram build mode: ${buildMode ?? '(missing)'}`)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

await rm(distRoot, { recursive: true, force: true })
run(process.execPath, [join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'])
run(process.execPath, [join(appRoot, 'scripts', 'copy-static.mjs')])

const appBundlePath = join(distRoot, 'app.js')
const appBundle = await readFile(appBundlePath, 'utf8')
const placeholder = '__MINGDA_API_BASE_URL__'
const placeholderCount = appBundle.split(placeholder).length - 1

if (placeholderCount !== 1) {
  throw new Error(`Expected exactly one ${placeholder} occurrence, found ${placeholderCount}`)
}

const configuredBundle = appBundle.replace(placeholder, apiBaseUrl)
if (configuredBundle.includes(placeholder)) {
  throw new Error(`Build output still contains ${placeholder}`)
}

if (buildMode === 'dev' && configuredBundle.includes(apiBaseUrls.prod)) {
  throw new Error('Development build output contains the production API URL')
}

if (buildMode === 'prod' && (/127\.0\.0\.1|localhost/).test(configuredBundle)) {
  throw new Error('Production build output contains a local API URL')
}

await writeFile(appBundlePath, configuredBundle)
