import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const distRoot = join(appRoot, 'dist')
const apiBaseUrls = {
  dev: 'http://127.0.0.1:3000/api',
  prod: 'https://www.mindajixie.cn/mes/api',
}
const placeholder = '__MINGDA_API_BASE_URL__'
const textualExtensions = new Set(['.js', '.json', '.wxml', '.wxss', '.svg', '.html', '.txt'])

async function findTextualArtifacts(directoryPath, rootPath = directoryPath) {
  const artifacts = []
  const entries = await readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    const artifactPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      artifacts.push(...await findTextualArtifacts(artifactPath, rootPath))
      continue
    }

    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (textualExtensions.has(extension)) {
      artifacts.push({ path: artifactPath, relativePath: relative(rootPath, artifactPath) })
    }
  }

  return artifacts
}

export async function validateBuildArtifacts(directoryPath, mode) {
  const forbiddenPatterns = mode === 'prod'
    ? [
        ['127.0.0.1', 'local host address'],
        ['localhost', 'local host name'],
        [placeholder, 'build placeholder'],
      ]
    : mode === 'dev'
      ? [
          [apiBaseUrls.prod, 'production API URL'],
          [placeholder, 'build placeholder'],
        ]
      : null

  if (!forbiddenPatterns) {
    throw new Error(`Unsupported miniprogram build mode: ${mode ?? '(missing)'}`)
  }

  const violations = []
  for (const artifact of await findTextualArtifacts(directoryPath)) {
    const contents = await readFile(artifact.path, 'utf8')
    for (const [pattern, label] of forbiddenPatterns) {
      if (contents.includes(pattern)) {
        violations.push(`${artifact.relativePath} contains ${label}`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Environment build leakage detected: ${violations.join('; ')}`)
  }
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

async function build(buildMode) {
  const apiBaseUrl = Object.prototype.hasOwnProperty.call(apiBaseUrls, buildMode)
    ? apiBaseUrls[buildMode]
    : undefined

  if (!apiBaseUrl) {
    throw new Error(`Unsupported miniprogram build mode: ${buildMode ?? '(missing)'}`)
  }

  await rm(distRoot, { recursive: true, force: true })
  run(process.execPath, [join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'])
  run(process.execPath, [join(appRoot, 'scripts', 'copy-static.mjs')])

  const appBundlePath = join(distRoot, 'app.js')
  const appBundle = await readFile(appBundlePath, 'utf8')
  const placeholderCount = appBundle.split(placeholder).length - 1

  if (placeholderCount !== 1) {
    throw new Error(`Expected exactly one ${placeholder} occurrence, found ${placeholderCount}`)
  }

  const configuredBundle = appBundle.replace(placeholder, apiBaseUrl)
  if (configuredBundle.includes(placeholder)) {
    throw new Error(`Build output still contains ${placeholder}`)
  }

  await writeFile(appBundlePath, configuredBundle)
  await validateBuildArtifacts(distRoot, buildMode)
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainModule) {
  build(process.argv[2]).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
