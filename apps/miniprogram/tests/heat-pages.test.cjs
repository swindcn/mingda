const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const dist = path.resolve(__dirname, '../dist')

test('registers all heat execution pages', () => {
  const app = JSON.parse(fs.readFileSync(path.join(dist, 'app.json'), 'utf8'))
  assert.ok(app.pages.includes('pages/heat/list/index'))
  assert.ok(app.pages.includes('pages/heat/detail/index'))
  assert.ok(app.pages.includes('pages/heat/start/index'))
  assert.ok(app.pages.includes('pages/heat/transfer/index'))
  assert.ok(app.pages.includes('pages/heat/complete/index'))
})

test('uses real mobile heat APIs and enables pull-down refresh', () => {
  const api = fs.readFileSync(path.join(dist, 'services/api.js'), 'utf8')
  assert.match(api, /\/mini\/production\/heat-orders/)
  assert.match(api, /\/start/)
  assert.match(api, /\/execution-options/)
  assert.match(api, /\/transfer/)
  assert.match(api, /\/complete/)
  const pageConfig = JSON.parse(fs.readFileSync(path.join(dist, 'pages/heat/list/index.json'), 'utf8'))
  assert.equal(pageConfig.enablePullDownRefresh, true)
})

test('renders start, transfer and completion actions from backend action flags', () => {
  const detail = fs.readFileSync(path.join(dist, 'pages/heat/detail/index.wxml'), 'utf8')
  assert.match(detail, /canStart/)
  assert.match(detail, /canTransfer/)
  assert.match(detail, /canComplete/)
  assert.match(detail, /开始生产/)
  assert.match(detail, /转运出炉/)
  assert.match(detail, /完成生产/)
})

test('shows planned start instead of planned output time', () => {
  const list = fs.readFileSync(path.join(dist, 'pages/heat/list/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(dist, 'pages/heat/detail/index.wxml'), 'utf8')
  assert.match(list, /计划开始/)
  assert.match(detail, /计划开始/)
  assert.doesNotMatch(list, /计划出炉/)
  assert.doesNotMatch(detail, /计划出炉/)
})

test('supports selecting and scanning furnace and transfer package', () => {
  const start = fs.readFileSync(path.join(dist, 'pages/heat/start/index.js'), 'utf8')
  const startView = fs.readFileSync(path.join(dist, 'pages/heat/start/index.wxml'), 'utf8')
  const transfer = fs.readFileSync(path.join(dist, 'pages/heat/transfer/index.js'), 'utf8')
  const transferView = fs.readFileSync(path.join(dist, 'pages/heat/transfer/index.wxml'), 'utf8')
  assert.match(start, /scanCode/)
  assert.match(startView, /选择熔炉/)
  assert.match(transfer, /scanCode/)
  assert.match(transferView, /转运重量/)
  assert.match(transferView, /可转运数量/)
  assert.match(transfer, /remainingTransferWeightKg/)
})

test('shows the heat entry only when login permissions allow it', () => {
  const login = fs.readFileSync(path.join(dist, 'pages/login/index.js'), 'utf8')
  const home = fs.readFileSync(path.join(dist, 'pages/home/index.wxml'), 'utf8')
  assert.match(login, /mingda_permissions/)
  assert.match(home, /wx:if="\{\{canViewHeats\}\}"/)
})
