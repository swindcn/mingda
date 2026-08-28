const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appDirectory = path.resolve(__dirname, '..')
const buildScript = path.join(appDirectory, 'scripts', 'build.mjs')
const appBundle = path.join(appDirectory, 'dist', 'app.js')

function runBuild(mode) {
  return spawnSync(process.execPath, [buildScript, mode], {
    cwd: appDirectory,
    encoding: 'utf8',
  })
}

test('dev build embeds the local API URL', () => {
  const result = runBuild('dev')

  assert.equal(result.status, 0, result.stderr)
  const bundle = fs.readFileSync(appBundle, 'utf8')
  assert.match(bundle, /http:\/\/127\.0\.0\.1:3000\/api/)
  assert.doesNotMatch(bundle, /https:\/\/www\.mindajixie\.cn\/mes\/api/)
  assert.doesNotMatch(bundle, /__MINGDA_API_BASE_URL__/)
})

test('prod build embeds the production API URL', () => {
  const result = runBuild('prod')

  assert.equal(result.status, 0, result.stderr)
  const bundle = fs.readFileSync(appBundle, 'utf8')
  assert.match(bundle, /https:\/\/www\.mindajixie\.cn\/mes\/api/)
  assert.doesNotMatch(bundle, /127\.0\.0\.1/)
  assert.doesNotMatch(bundle, /localhost/)
  assert.doesNotMatch(bundle, /__MINGDA_API_BASE_URL__/)
})

test('unknown build mode exits with a clear error', () => {
  const result = runBuild('staging')

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /Unsupported miniprogram build mode: staging/)
})
