import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pagePath = path.join(root, 'src/pages/production/WorkOrderWorkbenchPage.tsx')
const schedulingPagePath = path.join(root, 'src/pages/production/MeltSchedulingPage.tsx')
const utilsPath = path.join(root, 'src/utils/production.ts')

test('work order details load execution summary separately and expose the melt release client', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  const utils = fs.readFileSync(utilsPath, 'utf8')

  assert.match(page, /fetchWorkOrderRoutingExecution/)
  assert.equal((page.match(/await loadExecutionSummary\(id\)/g) || []).length, 2)
  assert.match(page, /releaseWorkOrderMelt/)
  assert.match(utils, /\/routing-execution/)
  assert.match(utils, /\/melt-release/)
})

test('melt release preserves the backend result and surfaces concrete warnings before and after confirmation', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  const utils = fs.readFileSync(utilsPath, 'utf8')

  assert.match(utils, /export interface WorkOrderRoutingExecutionWarning/)
  assert.match(utils, /export interface MeltReleaseResult/)
  assert.match(utils, /apiRequest<MeltReleaseResult>\(`\/admin\/production\/work-orders\/\$\{encodeURIComponent\(id\)\}\/melt-release`/)
  assert.match(page, /loadMeltReleaseWarnings\(record\.id\)/)
  assert.match(page, /warnings\.map\(/)
  assert.doesNotMatch(page, /node\.actionHint \|\| '确认将此工单下达至合炉排产池？'/)
})

test('routing execution table uses resizable fixed actions and short permission-aware actions', () => {
  const page = fs.readFileSync(pagePath, 'utf8')

  assert.match(page, /<ResizableTable<WorkOrderRoutingExecutionNode>/)
  assert.match(page, /title: '工序状态'/)
  assert.match(page, /title: '工序进度'/)
  assert.match(page, /title: '设备'/)
  assert.match(page, /title: '班组'/)
  assert.match(page, /<Tooltip title={values\.join\('、'\)}>/)
  assert.match(page, /等 \$\{values\.length - 2\} 项/)
  assert.match(page, /key: 'actions', fixed: 'right'/)
  assert.match(page, /<TableActions actions=\{\[/)
  assert.match(page, /hasPermission\(node\.actionPermission\)/)
  assert.match(page, /node\.action === 'RELEASE_MELT'/)
  assert.match(page, /releaseWorkOrderMelt\(record\.id, node\.nodeId\)/)
  assert.match(page, /等待上游/)
  assert.match(page, /暂未接入/)
})

test('work order execution copy describes manual route-based release and execution state', () => {
  const page = fs.readFileSync(pagePath, 'utf8')

  assert.match(page, /按工艺路线手动下达各工序任务/)
  assert.match(page, /<Card title="工艺路线执行"/)
})

test('task-specific scheduling buttons are removed from the work-order header', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  const header = page.slice(page.indexOf('<SubPageHeader'), page.indexOf('/>\n      <Form'))

  assert.doesNotMatch(header, /生成制芯任务/)
  assert.doesNotMatch(header, /生成造型下芯任务/)
  assert.doesNotMatch(header, /制芯任务/)
  assert.doesNotMatch(header, /造型任务/)
  assert.match(header, /提交排产/)
})

test('existing execution nodes navigate to module lists with the work-order filter', () => {
  const page = fs.readFileSync(pagePath, 'utf8')

  assert.match(page, /CORE: '\/dashboard\/production\/core-tasks'/)
  assert.match(page, /MELT: '\/dashboard\/production\/heat-orders'/)
  assert.match(page, /MOLDING: '\/dashboard\/production\/molding-tasks'/)
  assert.match(page, /POURING: '\/dashboard\/production\/pouring-tasks'/)
  assert.match(page, /SHAKE_CLEAN: '\/dashboard\/production\/shake-clean-tasks'/)
  assert.match(page, /INSPECTION: '\/dashboard\/production\/inspection-tasks'/)
  assert.match(page, /workOrderId=\$\{encodeURIComponent\(record\.id\)\}/)
})

test('melt pool keeps released routing nodes distinct when creating heat allocations', () => {
  const page = fs.readFileSync(schedulingPagePath, 'utf8')

  assert.match(page, /meltPoolOrderKey/)
  assert.match(page, /rowKey=\{meltPoolOrderKey\}/)
  assert.match(page, /routingNodeId: routingNodeFor\(order\)/)
  assert.match(page, /meltRoutingNodeId/)
})
