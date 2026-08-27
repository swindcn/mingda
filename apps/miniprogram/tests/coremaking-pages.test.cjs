const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const dist = path.resolve(__dirname, '../dist')
const src = path.resolve(__dirname, '../src')

function read(file) {
  return fs.readFileSync(path.join(dist, file), 'utf8')
}

function readSource(file) {
  return fs.readFileSync(path.join(src, file), 'utf8')
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function pageInstance(definition) {
  const instance = {
    ...definition,
    data: structuredClone(definition.data),
    postUnloadSetData: 0,
    afterUnload: false,
    setData(values) {
      if (this.afterUnload) this.postUnloadSetData += 1
      Object.assign(this.data, values)
    },
  }
  return instance
}

test('registers all coremaking pages with pull-down refresh where data is loaded', () => {
  const app = JSON.parse(read('app.json'))
  for (const page of ['list', 'detail', 'report', 'dry', 'label']) {
    assert.ok(app.pages.includes(`pages/core/${page}/index`))
  }
  for (const page of ['list', 'detail', 'dry']) {
    const config = JSON.parse(read(`pages/core/${page}/index.json`))
    assert.equal(config.enablePullDownRefresh, true)
  }
})

test('uses only real mini coremaking APIs and exposes execution options', () => {
  const api = readSource('services/api.ts')
  assert.match(api, /\/mini\/production\/core-tasks/)
  assert.match(api, /\/execution-options/)
  assert.match(api, /\/drying-batches/)
  assert.match(api, /\/mini\/production\/core-batches/)
  assert.doesNotMatch(api, /\/admin\/production\/core-tasks/)
})

test('core report exposes and submits the dispatched team', () => {
  const logic = read('pages/core/report/index.js')
  const view = read('pages/core/report/index.wxml')
  const types = readSource('types/business.ts')
  assert.match(types, /interface CoreExecutionOptions[\s\S]*teams:/)
  assert.match(logic, /teamIndex/)
  assert.match(logic, /teamCode/)
  assert.match(logic, /请选择班组/)
  assert.match(view, /班组/)
  assert.match(view, /options\.teams/)
})

test('core report hides the unplanned sand batch field for phase one', () => {
  const view = read('pages/core/report/index.wxml')
  assert.doesNotMatch(view, /混砂批次/)
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

  const unloading = gate.next()
  gate.invalidate()
  assert.equal(gate.isCurrent(unloading), false)

  for (const page of ['list', 'detail', 'report', 'dry', 'label']) {
    const logic = read(`pages/core/${page}/index.js`)
    assert.match(logic, /createLatestRequestGate/)
    assert.match(logic, /isCurrent\(requestId\)/)
    assert.match(logic, /onUnload/)
    assert.match(logic, /invalidate/)
    assert.doesNotMatch(logic, /const latestRequest = .*createLatestRequestGate/)
    assert.match(logic, /onLoad[\s\S]*?createLatestRequestGate/)
  }
})

test('an unloaded action conflict cannot invalidate a new page instance load', async () => {
  const apiPath = require.resolve(path.join(dist, 'services/api.js'))
  const detailPath = require.resolve(path.join(dist, 'pages/core/detail/index.js'))
  const requestPath = require.resolve(path.join(dist, 'utils/request.js'))
  const originalApiCache = require.cache[apiPath]
  const originalPage = global.Page
  const originalWx = global.wx
  const oldAction = deferred()
  const actionStarted = deferred()
  const newLoad = deferred()
  const detailCalls = []
  const toasts = []
  let definition

  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      startCoreTask() {
        actionStarted.resolve()
        return oldAction.promise
      },
      getCoreTaskDetail(id) {
        detailCalls.push(id)
        if (id === 'new-task') return newLoad.promise
        throw new Error(`unexpected detail reload for ${id}`)
      },
    },
    children: [],
    paths: [],
  }
  global.Page = (value) => { definition = value }
  global.wx = {
    showModal: async () => ({ confirm: true, cancel: false }),
    showToast: (value) => { toasts.push(value) },
    stopPullDownRefresh() {},
    navigateTo() {},
  }

  try {
    delete require.cache[detailPath]
    require(detailPath)
    const oldPage = pageInstance(definition)
    oldPage.onLoad({ id: 'old-task' })
    oldPage.data.record = { id: 'old-task', code: 'CORE-OLD', canStart: true, versionNo: 1 }
    const actionPromise = oldPage.startTask()
    await actionStarted.promise
    oldPage.onUnload()
    oldPage.afterUnload = true

    const newPage = pageInstance(definition)
    newPage.onLoad({ id: 'new-task' })
    newPage.onShow()
    oldAction.reject(new (require(requestPath).RequestError)('版本冲突', 409))
    await actionPromise
    newLoad.resolve({
      id: 'new-task', code: 'CORE-NEW', status: 'WAITING', plannedStartAt: '', createdAt: '',
      reports: [], batches: [], canStart: true, canReport: false, canDry: false, versionNo: 2,
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(detailCalls, ['new-task'])
    assert.equal(oldPage.postUnloadSetData, 0)
    assert.deepEqual(toasts, [])
    assert.equal(newPage.data.record.id, 'new-task')
    assert.equal(newPage.data.loading, false)
  } finally {
    delete require.cache[detailPath]
    if (originalApiCache) require.cache[apiPath] = originalApiCache
    else delete require.cache[apiPath]
    global.Page = originalPage
    global.wx = originalWx
  }
})

test('renders protected batch labels with a deterministic QR matrix', () => {
  const detail = read('pages/core/detail/index.wxml')
  const labelLogic = read('pages/core/label/index.js')
  const labelView = read('pages/core/label/index.wxml')
  assert.match(detail, /标签/)
  assert.match(labelLogic, /getCoreTaskDetail/)
  assert.match(labelLogic, /qrContent/)
  assert.match(labelLogic, /createQrMatrix/)
  assert.doesNotMatch(labelLogic, /\/labels?\b|base64/)
  assert.match(labelView, /canvas type="2d" id="labelQr"/)
  for (const label of ['批次', '芯盒', '产品', '数量', '生产时间', '烘干状态', '失效时间']) {
    assert.match(labelView, new RegExp(label))
  }

  const qrPath = path.join(dist, 'utils/qr-code.js')
  assert.ok(fs.existsSync(qrPath), 'QR matrix generator output must exist')
  const { createQrMatrix } = require(qrPath)
  const first = createQrMatrix('CORE-BATCH-001')
  const second = createQrMatrix('CORE-BATCH-001')
  assert.deepEqual(first, second)
  assert.ok(first.length >= 21)
  assert.ok(first.every((row) => row.length === first.length && row.every((cell) => typeof cell === 'boolean')))
  assert.deepEqual(first.slice(0, 7).map((row) => row.slice(0, 7)), [
    [true, true, true, true, true, true, true],
    [true, false, false, false, false, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, false, false, false, false, true],
    [true, true, true, true, true, true, true],
  ])
})

test('preserves request status for unified conflict handling and refreshes in place', () => {
  const requestPath = path.join(dist, 'utils/request.js')
  const { RequestError, isConflict } = require(requestPath)
  assert.equal(isConflict(new RequestError('版本冲突', 409)), true)
  assert.equal(isConflict(new RequestError('普通失败', 400)), false)
  assert.equal(isConflict(new Error('409')), false)

  for (const page of ['detail', 'report', 'dry']) {
    const source = readSource(`pages/core/${page}/index.ts`)
    assert.match(source, /isConflict\(error\)/)
    assert.match(source, /await this\.load(?:Detail|Data)\(\)/)
    const catches = [...source.matchAll(/catch \(error\) \{([\s\S]*?)\n    \} finally/g)]
    const actionCatch = catches.at(-1)?.[1] || ''
    assert.match(actionCatch, /if \(state\.unloaded\) return[\s\S]*if \(isConflict\(error\)\) \{[\s\S]*await this\.load(?:Detail|Data)\(\)[\s\S]*if \(state\.unloaded\) return[\s\S]*wx\.showToast/)
    assert.doesNotMatch(actionCatch, /navigateBack|navigateTo|redirectTo/)
    assert.match(source, /finally \{\s*if \(!state\.unloaded\) this\.setData\(\{ (?:starting|submitting): false \}\)/)
  }
})

test('safely decodes scanned batch values without throwing on malformed escapes', () => {
  const scanPath = path.join(dist, 'utils/scan-code.js')
  assert.ok(fs.existsSync(scanPath), 'safe scan-code output must exist')
  const { extractScannedCode } = require(scanPath)
  assert.equal(extractScannedCode('https://example.test?a=1&code=SAND%20001'), 'SAND 001')
  assert.equal(extractScannedCode('https://example.test?batch=%E0%A4%A'), '%E0%A4%A')
  assert.equal(extractScannedCode('  SAND-002  '), 'SAND-002')
})

test('uses split mobile task DTOs and includes protected label fields on batches', () => {
  const types = readSource('types/business.ts')
  const api = readSource('services/api.ts')
  assert.match(types, /interface MobileCoreTaskSummary/)
  assert.match(types, /interface MobileCoreTaskDetail extends MobileCoreTaskSummary/)
  assert.match(types, /qrContent:\s*string/)
  assert.match(types, /reportedAt:\s*string/)
  assert.match(api, /request<MobileCoreTaskSummary\[]>/)
  assert.match(api, /request<MobileCoreTaskDetail>/)
  assert.doesNotMatch(api, /\bMobileCoreTask\b/)
})

test('report uses current user, two quantity inputs and the real shift', () => {
  const logic = read('pages/core/report/index.js')
  const view = read('pages/core/report/index.wxml')
  const api = readSource('services/api.ts')
  assert.match(logic, /mingda_display_name/)
  assert.match(logic, /getCoreExecutionOptions/)
  assert.match(logic, /defectRows/)
  assert.match(logic, /chooseDefect/)
  assert.match(logic, /defects:/)
  assert.match(api, /defects:\s*Array/)
  assert.match(view, /合格数/)
  assert.match(view, /报废数/)
  assert.match(view, /废品原因/)
  assert.match(view, /options\.defects/)
  assert.match(view, /选择缺陷/)
  assert.doesNotMatch(view, /混砂批次/)
  assert.match(view, /是否烘干/)
  assert.equal((view.match(/type="number"/g) || []).length, 2)
})

test('dry supports selecting many batches and carries every batch version', () => {
  const logic = read('pages/core/dry/index.js')
  const view = read('pages/core/dry/index.wxml')
  const api = read('services/api.js')
  assert.match(logic, /getCoreExecutionOptions/)
  assert.match(logic, /versionNo/)
  assert.match(logic, /selectedBatchIds/)
  assert.match(logic, /toggleBatch/)
  assert.match(logic, /dryCoreBatches/)
  assert.match(api, /\/mini\/production\/core-batches\/dry/)
  assert.match(view, /烘干设备/)
  assert.match(view, /已选 \{\{selectedCount\}\}/)
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
