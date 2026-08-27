const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('合型浇注页面注册并构建到 dist', () => {
  const app = JSON.parse(read('dist/app.json'))
  assert.ok(app.pages.includes('pages/pouring/list/index'))
  assert.ok(app.pages.includes('pages/pouring/detail/index'))
  assert.ok(app.pages.includes('pages/pouring/report/index'))
})

test('合型浇注入口由独立小程序权限控制', () => {
  assert.match(read('dist/pages/home/index.js'), /mini\.production\.pouring\.view/)
  assert.match(read('dist/pages/home/index.wxml'), /canViewPouringTasks/)
})

test('待浇队列支持归档状态与下拉刷新', () => {
  const source = read('dist/pages/pouring/list/index.js')
  assert.match(source, /onPullDownRefresh/)
  assert.match(source, /WAITING_MOLDING/)
  assert.match(source, /COMPLETED/)
  assert.match(read('dist/pages/pouring/list/index.wxml'), /合型停留/)
})

test('浇注报工绑定具体包次、工位、重量、缺陷和警告确认', () => {
  const source = read('dist/pages/pouring/report/index.js')
  const markup = read('dist/pages/pouring/report/index.wxml')
  assert.match(source, /checkPouring/)
  assert.match(source, /reportPouring/)
  assert.match(source, /CRITICAL_HOLD/)
  assert.match(source, /TRANSFER_OVERDRAW/)
  assert.match(source, /requestId/)
  assert.match(markup, /选择铁水包次/)
  assert.match(markup, /选择浇注工位/)
  assert.match(markup, /实际浇注重量/)
  assert.match(markup, /浇注缺陷/)
  assert.match(markup, /bindtap="scanTransfer"/)
})
