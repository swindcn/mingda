const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('造型下芯页面注册并构建到 dist', () => {
  const app = JSON.parse(read('dist/app.json'))
  assert.ok(app.pages.includes('pages/molding/list/index'))
  assert.ok(app.pages.includes('pages/molding/detail/index'))
  assert.ok(app.pages.includes('pages/molding/report/index'))
})

test('列表支持扫码、查询和下拉刷新', () => {
  const source = read('dist/pages/molding/list/index.js')
  const markup = read('dist/pages/molding/list/index.wxml')
  assert.match(source, /onPullDownRefresh/)
  assert.match(source, /scanCode/)
  assert.match(source, /getMoldingTaskByCode/)
  assert.match(source, /DISPATCHED/)
  assert.match(source, /已派工/)
  assert.match(source, /待派工/)
  assert.match(source, /部分齐套/)
  assert.doesNotMatch(source, /WAITING_CORE/)
  assert.match(markup, /砂芯齐套/)
})

test('详情按钮只使用后端 allowedActions', () => {
  const markup = read('dist/pages/molding/detail/index.wxml')
  assert.match(markup, /task\.allowedActions\.start/)
  assert.match(markup, /task\.allowedActions\.report/)
  assert.match(markup, /task\.startBlockedReason/)
  assert.doesNotMatch(markup, /撤销/)
})

test('模具开发入口由独立小程序权限控制', () => {
  const source = read('dist/pages/home/index.js')
  const markup = read('dist/pages/home/index.wxml')
  assert.match(source, /mini\.mold\.development\.view/)
  assert.match(markup, /wx:if="\{\{canViewMolds\}\}"/)
})

test('报工包含快捷数量、缺陷明细、结束选择和防重复提交', () => {
  const source = read('dist/pages/molding/report/index.js')
  const markup = read('dist/pages/molding/report/index.wxml')
  assert.match(markup, /-10/)
  assert.match(markup, /\+10/)
  assert.match(markup, /填入当前可生产数量/)
  assert.match(markup, /缺陷明细/)
  assert.match(markup, /本任务已结束/)
  assert.match(source, /requestId/)
  assert.match(source, /submitting/)
  assert.match(source, /零数量报工仅用于结束任务/)
  assert.match(source, /零数量结束任务必须填写结束原因/)
  assert.match(markup, /补充关闭任务/)
  assert.match(markup, /goodQty \+ scrapQty === 0 \|\| task\.completedGoodQty \+ goodQty < task\.planBoxQty/)
})
