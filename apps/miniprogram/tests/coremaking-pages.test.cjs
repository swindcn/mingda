const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const dist = path.resolve(__dirname, '../dist')

function read(file) {
  return fs.readFileSync(path.join(dist, file), 'utf8')
}

test('registers all coremaking pages with pull-down refresh where data is loaded', () => {
  const app = JSON.parse(read('app.json'))
  for (const page of ['list', 'detail', 'report', 'dry']) {
    assert.ok(app.pages.includes(`pages/core/${page}/index`))
  }
  for (const page of ['list', 'detail', 'dry']) {
    const config = JSON.parse(read(`pages/core/${page}/index.json`))
    assert.equal(config.enablePullDownRefresh, true)
  }
})

test('uses only real mini coremaking APIs and exposes execution options', () => {
  const api = read('services/api.js')
  assert.match(api, /\/mini\/production\/core-tasks/)
  assert.match(api, /\/execution-options/)
  assert.match(api, /\/drying-batches/)
  assert.match(api, /\/mini\/production\/core-batches/)
  assert.doesNotMatch(api, /\/admin\/production\/core-tasks/)
})

test('shows the coremaking home entry only from its mini permission', () => {
  const homeLogic = read('pages/home/index.js')
  const home = read('pages/home/index.wxml')
  assert.match(homeLogic, /mini\.production\.core\.view/)
  assert.match(home, /wx:if="\{\{canViewCoreTasks\}\}"/)
  assert.match(home, /制芯任务/)
})

test('renders three task tabs, planned time ordering, cards and empty state', () => {
  const logic = read('pages/core/list/index.js')
  const view = read('pages/core/list/index.wxml')
  assert.match(logic, /WAITING/)
  assert.match(logic, /IN_PROGRESS/)
  assert.match(logic, /COMPLETED/)
  assert.match(logic, /plannedStartAt/)
  assert.match(logic, /待生产/)
  assert.match(logic, /生产中/)
  assert.match(logic, /已完成/)
  assert.match(view, /计划时间/)
  assert.match(view, /暂无制芯任务/)
})

test('detail actions trust backend flags without a second local permission gate', () => {
  const logic = read('pages/core/detail/index.js')
  const view = read('pages/core/detail/index.wxml')
  assert.match(view, /wx:if="\{\{record\.canStart\}\}"/)
  assert.match(view, /wx:if="\{\{record\.canReport\}\}"/)
  assert.match(view, /wx:if="\{\{record\.canDry\}\}"/)
  assert.doesNotMatch(view, /can(?:Start|Report|Dry)Local/)
  assert.doesNotMatch(logic, /SUPER_ADMIN|mingda_permissions|can(?:Start|Report|Dry)Local/)
  assert.match(view, /报工记录/)
  assert.match(view, /砂芯批次/)
})

test('latest request gate prevents delayed responses from replacing records or loading', async () => {
  const gatePath = path.join(dist, 'utils/latest-request.js')
  assert.ok(fs.existsSync(gatePath), 'latest request gate output must exist')
  const { createLatestRequestGate } = require(gatePath)
  const gate = createLatestRequestGate()
  const state = { records: [], loading: false }

  async function load(label, delay) {
    const requestId = gate.next()
    state.loading = true
    try {
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (!gate.isCurrent(requestId)) return
      state.records = [label]
    } finally {
      if (gate.isCurrent(requestId)) state.loading = false
    }
  }

  const stale = load('WAITING', 20)
  const current = load('COMPLETED', 0)
  await current
  assert.deepEqual(state, { records: ['COMPLETED'], loading: false })
  await stale
  assert.deepEqual(state, { records: ['COMPLETED'], loading: false })

  const list = read('pages/core/list/index.js')
  assert.match(list, /createLatestRequestGate/)
  assert.match(list, /isCurrent\(requestId\)/)
})

test('report uses current user, two quantity inputs, real shift and scannable sand batch', () => {
  const logic = read('pages/core/report/index.js')
  const view = read('pages/core/report/index.wxml')
  assert.match(logic, /mingda_display_name/)
  assert.match(logic, /scanCode/)
  assert.match(logic, /getCoreExecutionOptions/)
  assert.match(view, /合格数/)
  assert.match(view, /报废数/)
  assert.match(view, /废品原因/)
  assert.match(view, /混砂批次/)
  assert.match(view, /是否烘干/)
  assert.equal((view.match(/type="number"/g) || []).length, 2)
})

test('dry selects a real drying device and carries batch version', () => {
  const logic = read('pages/core/dry/index.js')
  const view = read('pages/core/dry/index.wxml')
  assert.match(logic, /getCoreExecutionOptions/)
  assert.match(logic, /versionNo/)
  assert.match(logic, /dryCoreBatch/)
  assert.match(view, /烘干设备/)
  assert.match(view, /预计失效时间/)
})

test('core action buttons are compact and right aligned', () => {
  for (const page of ['detail', 'report', 'dry']) {
    const style = read(`pages/core/${page}/index.wxss`)
    assert.match(style, /margin-left:\s*auto/)
    assert.doesNotMatch(style, /width:\s*100%/)
  }
})

test('request layer reports timeouts and redirects expired authorization', () => {
  const request = read('utils/request.js')
  assert.match(request, /timeout:\s*15000/)
  assert.match(request, /statusCode\s*===\s*401/)
  assert.match(request, /登录已失效/)
  assert.match(request, /请求超时/)
})
