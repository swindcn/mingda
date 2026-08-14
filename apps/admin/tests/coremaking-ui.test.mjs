import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(adminRoot, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function compileCoremakingClient() {
  const filePath = path.join(adminRoot, 'src/utils/coremaking.ts')
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const calls = []
  const apiRequest = (requestPath, options) => {
    calls.push({ path: requestPath, options })
    return { requestPath, options }
  }
  const module = { exports: {} }
  const require = (specifier) => {
    assert.equal(specifier, '../services/api')
    return { apiRequest }
  }
  Function('require', 'module', 'exports', output)(require, module, module.exports)
  return { client: module.exports, calls }
}

test('core plan preview calculation follows backend decimal scrap-rate semantics', () => {
  const { client } = compileCoremakingClient()
  assert.deepEqual(client.calculateCorePlan(100, 1.5, 0.03, 4), {
    plannedQuantity: 155,
    plannedPressCount: 39,
  })
  assert.deepEqual(client.calculateCorePlan(1, 0.25, 0, 2), {
    plannedQuantity: 1,
    plannedPressCount: 1,
  })
})

test('work order coremaking entry never offers generation when coremaking is not required', () => {
  const { client } = compileCoremakingClient()
  assert.equal(client.resolveCoreTaskEntry({ requiresCoremaking: false, canGenerateCoreTasks: true, coreTaskCount: 0 }, true, true), 'NOT_REQUIRED')
  assert.equal(client.resolveCoreTaskEntry({ requiresCoremaking: true, canGenerateCoreTasks: true, coreTaskCount: 0 }, true, true), 'GENERATE')
  assert.equal(client.resolveCoreTaskEntry({ requiresCoremaking: true, canGenerateCoreTasks: false, coreTaskCount: 2 }, true, true), 'VIEW')
  assert.equal(client.resolveCoreTaskEntry({ requiresCoremaking: true, canGenerateCoreTasks: true, coreTaskCount: 0 }, false, true), 'NONE')
})

test('remaining shelf-life calculation handles undried, permanent and expired batches', () => {
  const { client } = compileCoremakingClient()
  const now = new Date('2026-08-14T08:00:00.000Z')
  assert.equal(client.remainingCoreHours('', now), null)
  assert.equal(client.remainingCoreHours('2026-08-14T20:30:00.000Z', now), 12.5)
  assert.equal(client.remainingCoreHours('2026-08-14T07:00:00.000Z', now), 0)
})

test('coremaking pages use the shared industrial table and operation patterns', () => {
  const files = [
    'apps/admin/src/pages/production/CoreTaskListPage.tsx',
    'apps/admin/src/pages/production/CoreTaskDetailPage.tsx',
    'apps/admin/src/pages/production/CoreTaskGenerationModal.tsx',
    'apps/admin/src/pages/production/CoreInventoryPage.tsx',
    'apps/admin/src/pages/production/CoreBatchLabel.tsx',
    'apps/admin/src/pages/production/CoreReadinessPanel.tsx',
  ]
  for (const file of files) assert.equal(fs.existsSync(path.join(repoRoot, file)), true, `${file} should exist`)

  const taskList = read(files[0])
  const inventory = read(files[3])
  for (const source of [taskList, inventory]) {
    assert.match(source, /<ResizableTable/)
    assert.match(source, /<TableActions/)
    assert.match(source, /fixed:\s*['"]right['"]/)
  }
  assert.match(taskList, /production\.core_task\.view/)
  assert.match(taskList, /production\.core_task\.dispatch/)
  assert.match(taskList, /production\.core_task\.cancel/)
  assert.match(taskList, /production\.core_task\.start/)
  assert.match(taskList, /production\.core_task\.report/)
  assert.match(taskList, /message\.error/, 'task-list action launch failures should be visible')
  assert.match(inventory, /production\.core_inventory\.view/)
  assert.match(inventory, /production\.core_inventory\.dry/)
  assert.match(inventory, /production\.core_inventory\.lock/)
  assert.match(inventory, /production\.core_inventory\.scrap/)
  for (const label of ['全部', '待烘干', '可用', '临期', '过期', '冻结', '报废', '耗尽']) assert.match(inventory, new RegExp(label))
})

test('generation workbench and work-order detail expose the complete coremaking workflow', () => {
  const modal = read('apps/admin/src/pages/production/CoreTaskGenerationModal.tsx')
  for (const label of ['预计废品率', '需求量', '压盒次数', '工序', '设备', '班组', '计划时间', '备注']) assert.match(modal, new RegExp(label))
  assert.match(modal, /previewCoreTasks/)
  assert.match(modal, /createCoreTasks/)
  assert.match(modal, /calculateCorePlan/)
  assert.match(modal, /preview\?\.teams/)

  const workOrder = read('apps/admin/src/pages/production/WorkOrderWorkbenchPage.tsx')
  assert.match(workOrder, /resolveCoreTaskEntry/)
  assert.match(workOrder, /production\.core_task\.create/)
  assert.match(workOrder, /production\.core_task\.view/)
  assert.match(workOrder, /该工单无需制芯/)
  assert.match(workOrder, /<CoreReadinessPanel/)
})

test('task detail includes dispatch, reporting and batch actions guarded by capability and permission', () => {
  const detail = read('apps/admin/src/pages/production/CoreTaskDetailPage.tsx')
  for (const permission of ['dispatch', 'cancel', 'start', 'report']) {
    assert.match(detail, new RegExp(`production\\.core_task\\.${permission}`))
  }
  for (const field of ['合格数', '报废数', '班次', '混砂批次', '是否烘干', '缺陷原因', '备注']) assert.match(detail, new RegExp(field))
  assert.match(detail, /canDispatch/)
  assert.match(detail, /canCancel/)
  assert.match(detail, /canStart/)
  assert.match(detail, /canReport/)
  assert.match(detail, /派工记录/)
  assert.match(detail, /报工记录/)
  assert.match(detail, /fetchCoreTaskOptions/)
})

test('batch label renders a real QR code and print-only label styles', () => {
  const label = read('apps/admin/src/pages/production/CoreBatchLabel.tsx')
  const css = read('apps/admin/src/index.css')
  assert.match(label, /QRCode/)
  assert.match(label, /qrContent/)
  assert.match(label, /window\.print\(\)/)
  assert.match(css, /@media print/)
  assert.match(css, /core-batch-label/)
  assert.match(css, /body \*/)
})

test('coremaking operational option and detail APIs are backed by production endpoints', () => {
  const { client, calls } = compileCoremakingClient()
  client.fetchCoreTaskOptions('task/1')
  client.fetchCoreInventoryOptions()
  client.fetchCoreTask('task/1')
  assert.deepEqual(calls.map((call) => call.path), [
    '/admin/production/core-tasks/task%2F1/options',
    '/admin/production/core-inventory/options',
    '/admin/production/core-tasks/task%2F1',
  ])

  const controller = read('apps/api/src/production/coremaking.controller.ts')
  const service = read('apps/api/src/production/coremaking.service.ts')
  assert.match(controller, /@Get\('core-tasks\/:id\/options'\)/)
  assert.match(controller, /@Get\('core-inventory\/options'\)/)
  assert.match(service, /reports:/)
  assert.match(service, /dryingEquipment/)
})

test('app routes use concrete coremaking pages and the placeholder is removed', () => {
  const app = read('apps/admin/src/App.tsx')
  assert.match(app, /<CoreTaskListPage/)
  assert.match(app, /<CoreTaskDetailPage/)
  assert.match(app, /<CoreInventoryPage/)
  assert.doesNotMatch(app, /CoreTaskListPlaceholderPage|CoreTaskDetailPlaceholderPage|CoreInventoryPlaceholderPage/)
  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/admin/src/pages/production/CoremakingPlaceholderPages.tsx')), false)
})
