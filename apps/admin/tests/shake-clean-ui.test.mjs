import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const nodeRequire = createRequire(import.meta.url)
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const readApi = (file) => fs.readFileSync(path.join(root, '../api', file), 'utf8')

function compileLatestRequest() {
  const filePath = path.join(root, 'src/utils/latestRequest.ts')
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const module = { exports: {} }
  Function('module', 'exports', output)(module, module.exports)
  return module.exports
}

function compileShakeClean() {
  const filePath = path.join(root, 'src/utils/shakeClean.ts')
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const module = { exports: {} }
  const require = (specifier) => {
    if (specifier === '../services/api') return { apiRequest: () => Promise.resolve() }
    return nodeRequire(specifier)
  }
  Function('require', 'module', 'exports', output)(require, module, module.exports)
  return module.exports
}

test('落砂清理路由、菜单和列表权限完整', () => {
  const app = read('src/App.tsx')
  const layout = read('src/layouts/AppLayout.tsx')
  const list = read('src/pages/production/ShakeCleanTaskListPage.tsx')

  assert.match(app, /production\/shake-clean-tasks/)
  assert.match(app, /production\.shake_clean\.view/)
  assert.match(layout, /落砂清理/)
  assert.match(layout, /production\.shake_clean\.view/)
  assert.match(list, /className="page-header"/)
  assert.match(list, /<SearchOutlined/)
  assert.match(list, />查询</)
  assert.match(list, /<ResizableTable/)
  assert.match(list, /fixed:\s*'right'/)
  assert.match(list, /<TableActions/)
  assert.match(list, /cooling\.earlyShake/)
  assert.match(list, /<Tag color=\{.*earlyShake.*red.*green/s)
  assert.match(list, /无待落砂/)
  assert.match(list, /fetchShakeCleanTasks\(\{ page: nextPage, pageSize: nextPageSize/)
  assert.match(list, /pagination=\{\{ current: page, pageSize, total/)
  for (const label of ['待落砂', '落砂中', '待清理', '清理中', '等待后续浇注', '已完成']) {
    assert.match(list, new RegExp(label))
  }
})

test('落砂清理工具层只调用真实接口并覆盖完整 DTO', () => {
  const source = read('src/utils/shakeClean.ts')
  assert.match(source, /apiRequest/)
  for (const endpoint of [
    '/admin/production/shake-clean-tasks',
    '/admin/production/shake-clean/shake/check',
    '/admin/production/shake-clean/shake/reports',
    '/admin/production/shake-clean/cleaning/reports',
    '/reverse',
  ]) assert.match(source, new RegExp(endpoint.replaceAll('/', '\\/')))
  for (const suffix of ['options', 'reports', 'trace', 'defect-options']) assert.match(source, new RegExp(`taskPath\\(id, '${suffix}'\\)`))
  assert.match(source, /allowedActions/)
  assert.match(source, /batchVersions/)
  assert.match(source, /blankOutputQuantity: number/)
  assert.doesNotMatch(source, /tasks\.map\(\(task\) => fetchShakeCleanTrace\(task\.id\)/)
  assert.doesNotMatch(source, /mock|localStorage\.setItem\([^)]*shake/i)
})

test('详情页按权限和后端动作控制双阶段报工', () => {
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  assert.match(detail, /production\.shake_clean\.shake_report/)
  assert.match(detail, /production\.shake_clean\.clean_report/)
  assert.match(detail, /options\.allowedActions\.shakeReport/)
  assert.match(detail, /options\.allowedActions\.cleanReport/)
  assert.match(detail, /EARLY_SHAKE/)
  assert.match(detail, /Modal\.confirm/)
  assert.match(detail, /confirmedEarlyShake/)
  assert.match(detail, /ApiRequestError/)
  assert.match(detail, /error\.status === 409/)
  assert.match(detail, /刷新后重新提交/)
  for (const label of ['任务信息', '落砂记录', '清理记录', '批次追溯']) assert.match(detail, new RegExp(label))
})

test('落砂和清理弹窗包含生产型数量与质量控件', () => {
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  for (const label of ['-10', '-1', '+1', '+10', '一键拉满', '落砂设备', '清理设备', '缺陷', '切割浇冒口重量']) {
    assert.match(detail, new RegExp(label.replace('+', '\\+')))
  }
  assert.match(detail, /缺陷数量合计/)
  assert.match(detail, /requestId/)
  assert.match(detail, /shakeBatchVersions/)
  assert.match(detail, /cleaningBatchVersions/)
})

test('撤销报工要求权限、版本与必填原因', () => {
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  assert.match(detail, /production\.shake_clean\.reverse/)
  assert.match(detail, /report\.versionNo/)
  assert.match(detail, /撤销原因/)
  assert.match(detail, /rules=\{\[\{ required: true/)
  assert.match(detail, /reverseShakeReport/)
  assert.match(detail, /reverseCleaningReport/)
  assert.match(detail, /<TableActions/)
  assert.match(detail, /fixed: 'right'/)
})

test('隐藏缺陷字段在废品数归零时清空，并强制提交空数组', () => {
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  const service = readApi('src/production/shake-clean.service.ts')
  assert.match(detail, /scrapQty <= 0[\s\S]*?setFieldValue\(['"]defects['"], \[\]\)/)
  assert.match(detail, /useEffect\(/)
  assert.match(detail, /submittedDefects/)
  assert.match(service, /scrapQty === 0 && inputs\.length > 0/)
})

test('详情返回保留来源列表筛选状态', () => {
  const list = read('src/pages/production/ShakeCleanTaskListPage.tsx')
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  assert.match(list, /useSearchParams/)
  assert.match(list, /fromStatus/)
  assert.match(detail, /useSearchParams/)
  assert.match(detail, /fromStatus/)
  assert.match(detail, /SubPageHeader/)
})

test('列表和详情使用可执行的最新请求门控，且详情按任务 ID 清空旧数据', async () => {
  const list = read('src/pages/production/ShakeCleanTaskListPage.tsx')
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  assert.match(list, /createLatestRequestGate/)
  assert.match(list, /requestGate\.run/)
  assert.match(list, /requestGate\.invalidate\(\)/)
  assert.match(detail, /createLatestRequestGate/)
  assert.match(detail, /requestGate\.run/)
  assert.match(detail, /setOptions\(null\)/)
  assert.match(detail, /setReports\(\{ shakeReports: \[\], cleaningReports: \[\] \}\)/)
  assert.match(detail, /setTrace\(\{ shakeBatches: \[\], cleaningBatches: \[\], blankOutputBatches: \[\] \}\)/)
  assert.match(detail, /setDefects\(\[\]\)/)
  assert.match(detail, /requestGate\.invalidate\(\)/)

  const { createLatestRequestGate } = compileLatestRequest()
  const gate = createLatestRequestGate()
  const values = []
  let resolveOld
  let resolveNew
  const oldRequest = gate.run(() => new Promise((resolve) => { resolveOld = resolve }), { success: (value) => values.push(value) })
  const newRequest = gate.run(() => new Promise((resolve) => { resolveNew = resolve }), { success: (value) => values.push(value) })
  resolveNew('new')
  await newRequest
  resolveOld('old')
  await oldRequest
  assert.deepEqual(values, ['new'])
  let resolveUnmounted
  const unmounted = gate.run(() => new Promise((resolve) => { resolveUnmounted = resolve }), { success: (value) => values.push(value) })
  gate.invalidate()
  resolveUnmounted('unmounted')
  await unmounted
  assert.deepEqual(values, ['new'])
})

test('缺陷归一化先按废品数处理，废品为零时始终提交空数组', () => {
  const { normalizeShakeCleanDefects } = compileShakeClean()
  const defects = [{ defectCode: 'D-1', quantity: 1 }]
  assert.deepEqual(normalizeShakeCleanDefects(0, defects), [])
  assert.deepEqual(normalizeShakeCleanDefects(0, undefined), [])
  assert.deepEqual(normalizeShakeCleanDefects(2, defects), defects)
})

test('详情信息和缺陷明细在窄屏下使用响应式布局', () => {
  const detail = read('src/pages/production/ShakeCleanTaskDetailPage.tsx')
  assert.match(detail, /column=\{\{ xs: 1, sm: 2, xl: 4 \}\}/)
  assert.match(detail, /flexWrap: 'wrap'/)
})
