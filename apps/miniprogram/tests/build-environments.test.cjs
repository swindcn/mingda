const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const appDirectory = path.resolve(__dirname, '..')
const buildScript = path.join(appDirectory, 'scripts', 'build.mjs')

function runBuild(mode, outputDirectory) {
  return spawnSync(process.execPath, [buildScript, mode], {
    cwd: appDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      MINGDA_MINIPROGRAM_DIST_DIR: outputDirectory,
    },
  })
}

test('environment builds use isolated output directories', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mingda-builds-'))

  try {
    await t.test('dev build embeds the local API URL', () => {
      const outputDirectory = path.join(temporaryRoot, 'dev-dist')
      const result = runBuild('dev', outputDirectory)

      assert.equal(result.status, 0, result.stderr)
      const bundle = fs.readFileSync(path.join(outputDirectory, 'app.js'), 'utf8')
      assert.match(bundle, /http:\/\/127\.0\.0\.1:3000\/api/)
      assert.doesNotMatch(bundle, /https:\/\/www\.mindajixie\.cn\/mes\/api/)
      assert.doesNotMatch(bundle, /__MINGDA_API_BASE_URL__/)
    })

    await t.test('prod build embeds the production API URL', () => {
      const outputDirectory = path.join(temporaryRoot, 'prod-dist')
      const result = runBuild('prod', outputDirectory)

      assert.equal(result.status, 0, result.stderr)
      const bundle = fs.readFileSync(path.join(outputDirectory, 'app.js'), 'utf8')
      assert.match(bundle, /https:\/\/www\.mindajixie\.cn\/mes\/api/)
      assert.doesNotMatch(bundle, /127\.0\.0\.1/)
      assert.doesNotMatch(bundle, /localhost/)
      assert.doesNotMatch(bundle, /__MINGDA_API_BASE_URL__/)
    })

    await t.test('unknown build mode exits with a clear error', () => {
      const result = runBuild('staging', path.join(temporaryRoot, 'invalid-dist'))

      assert.notEqual(result.status, 0)
      assert.match(`${result.stdout}${result.stderr}`, /Unsupported miniprogram build mode: staging/)
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('validator rejects leakage in a non-app source map', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mingda-build-'))

  try {
    await mkdir(path.join(temporaryDirectory, 'nested'), { recursive: true })
    await writeFile(
      path.join(temporaryDirectory, 'nested', 'leak.map'),
      'unexpected http://127.0.0.1:3000/api reference',
    )

    const { validateBuildArtifacts } = await import(buildScript)
    await assert.rejects(
      validateBuildArtifacts(temporaryDirectory, 'prod'),
      /nested[\\/]leak\.map contains local host address/,
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})
