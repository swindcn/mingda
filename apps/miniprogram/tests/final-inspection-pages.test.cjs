const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('成品终检页面注册并构建到 dist', () => {
  const app = JSON.parse(read('dist/app.json'))
  for (const page of ['list', 'detail', 'report', 'rework-report']) {
    const route = `pages/inspection/${page}/index`
    assert.ok(app.pages.includes(route))
    assert.ok(fs.existsSync(path.join(root, `dist/${route}.js`)))
    assert.ok(fs.existsSync(path.join(root, `dist/${route}.wxml`)))
  }
})

test('首页入口由成品终检查看权限控制', () => {
  assert.match(read('dist/pages/home/index.js'), /mini\.production\.inspection\.view/)
  assert.match(read('dist/pages/home/index.wxml'), /canViewInspectionTasks/)
})

test('列表支持状态查询、扫码、下拉刷新和分页', () => {
  const api = read('dist/services/api.js')
  const source = read('dist/pages/inspection/list/index.js')
  assert.match(api, /\/mini\/production\/inspection-tasks/)
  assert.match(source, /onPullDownRefresh/)
  assert.match(source, /onReachBottom/)
  assert.match(source, /scanCode/)
  for (const status of ['WAITING', 'INSPECTING', 'REWORKING', 'COMPLETED']) assert.match(source, new RegExp(status))
})

test('终检报工携带稳定幂等键、批次版本、缺陷及一张图片', () => {
  const source = read('dist/pages/inspection/report/index.js')
  const markup = read('dist/pages/inspection/report/index.wxml')
  assert.match(source, /reportFinalInspection/)
  assert.match(source, /batchVersions/)
  assert.match(source, /requestId/)
  assert.match(source, /isConflict/)
  assert.match(source, /count: 1/)
  assert.match(markup, /合格件数/)
  assert.match(markup, /返修件数/)
  assert.match(markup, /报废件数/)
  assert.match(markup, /选择照片或拍照/)
})

test('清理返修只选择路线设备并按版本提交', () => {
  const source = read('dist/pages/inspection/rework-report/index.js')
  const markup = read('dist/pages/inspection/rework-report/index.wxml')
  assert.match(source, /getCleaningReworkTask/)
  assert.match(source, /reportCleaningRework/)
  assert.match(source, /versionNo/)
  assert.match(source, /isConflict/)
  assert.match(markup, /请选择路线绑定的清理设备/)
})
