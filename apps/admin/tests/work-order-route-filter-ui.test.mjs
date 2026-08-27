import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const listFiles = [
  ['src/pages/production/CoreTaskListPage.tsx', 'fetchCoreTasks', 'core-tasks'],
  ['src/pages/production/HeatOrderListPage.tsx', 'fetchHeatOrders', 'heat-orders'],
  ['src/pages/production/MoldingTaskListPage.tsx', 'fetchMoldingTasks', 'molding-tasks'],
  ['src/pages/production/PouringTaskListPage.tsx', 'fetchPouringTasks', 'pouring-tasks'],
  ['src/pages/production/ShakeCleanTaskListPage.tsx', 'fetchShakeCleanTasks', 'shake-clean-tasks'],
  ['src/pages/production/FinalInspectionTaskListPage.tsx', 'fetchInspectionTasks', 'inspection-tasks'],
]

test('六类任务列表读取并保留 workOrderId 上下文', () => {
  for (const [file, fetchName, route] of listFiles) {
    const source = read(file)
    assert.match(source, /useSearchParams/, `${file} must read URL search params`)
    assert.match(source, /searchParams\.get\(['"]workOrderId['"]\)|params\.get\(['"]workOrderId['"]\)/, `${file} must read workOrderId`)
    assert.match(source, new RegExp(`${fetchName}[\\s\\S]{0,1200}workOrderId`), `${file} must forward workOrderId to ${fetchName}`)
    assert.match(source, /fromWorkOrderId|searchParams\.toString\(\)|params\.toString\(\)/, `${file} must append filter context to detail navigation`)
    assert.match(source, /detailQuery\(\)/, `${file} must navigate with the preserved query context`)
    assert.match(source, new RegExp(`${route}/\\$\\{[^}]+\\}`), `${file} must navigate to its detail route`)
  }
})

test('查询、状态切换和分页写回 URL 时不丢失 workOrderId', () => {
  for (const file of listFiles.map(([source]) => source)) {
    const source = read(file)
    assert.match(source, /set(SearchParams|Params)\(/, `${file} must update URL state`)
    assert.match(source, /workOrderId/, `${file} must preserve workOrderId in URL state`)
  }
})

test('详情页返回时保留来源列表的 workOrderId', () => {
  const detailFiles = [
    'src/pages/production/CoreTaskDetailPage.tsx',
    'src/pages/production/HeatOrderDetailPage.tsx',
    'src/pages/production/MoldingTaskDetailPage.tsx',
    'src/pages/production/PouringTaskDetailPage.tsx',
    'src/pages/production/ShakeCleanTaskDetailPage.tsx',
    'src/pages/production/FinalInspectionTaskDetailPage.tsx',
  ]
  for (const file of detailFiles) {
    const source = read(file)
    assert.match(source, /useSearchParams|useLocation/, `${file} must read return context`)
    assert.match(source, /fromWorkOrderId|workOrderId/, `${file} must restore workOrderId on back`)
  }
})

test('清空关键字或选择全部状态时删除 URL 中的旧筛选参数', () => {
  for (const [file] of listFiles) {
    const source = read(file)
    if (/\bkeyword\b/.test(source)) {
      assert.match(source, /else\s+next\.delete\(['"]keyword['"]\)/, `${file} must remove keyword when empty`)
    }
    assert.match(source, /nextStatus\s*===\s*['"]ALL['"][\s\S]{0,120}next\.delete\(['"]status['"]\)|!nextStatus[\s\S]{0,120}next\.delete\(['"]status['"]\)|else\s+next\.delete\(['"]status['"]\)/, `${file} must remove status when selecting all`)
  }
})

test('四类任务列表使用 URL 持久化本地分页状态', () => {
  for (const file of listFiles.slice(0, 4).map(([source]) => source)) {
    const source = read(file)
    assert.match(source, /const \[page, setPage\]/, `${file} must keep current page locally`)
    assert.match(source, /const \[pageSize, setPageSize\]/, `${file} must keep page size locally`)
    assert.match(source, /pagination=\{\{[\s\S]{0,500}current:\s*page[\s\S]{0,500}pageSize[\s\S]{0,500}onChange:/, `${file} must control table pagination`)
    assert.match(source, /next\.set\(['"]page['"]|next\.delete\(['"]page['"]\)/, `${file} must persist page in URL`)
    assert.match(source, /next\.set\(['"]pageSize['"]|next\.delete\(['"]pageSize['"]\)/, `${file} must persist pageSize in URL`)
  }
})

test('列表从完整 URL 状态加载，支持浏览器前进后退同步筛选和分页', () => {
  for (const [file] of listFiles) {
    const source = read(file)
    assert.match(source, /const urlStateKey = (?:searchParams|params)\.toString\(\)/, `${file} must derive a stable URL state key`)
    assert.match(source, /useEffect\(\(\) => \{[\s\S]{0,1200}setStatus\(urlStatus\)[\s\S]{0,1200}\}, \[urlStateKey\]\)/, `${file} must reload when browser URL state changes`)
    assert.match(source, /setStatus\(urlStatus\)/, `${file} must sync status from URL`)
    if (/\bkeyword\b/.test(source)) assert.match(source, /setKeyword\(urlKeyword\)/, `${file} must sync keyword from URL`)
  }
})

test('详情页返回时恢复列表分页上下文', () => {
  const detailFiles = [
    'src/pages/production/CoreTaskDetailPage.tsx',
    'src/pages/production/HeatOrderDetailPage.tsx',
    'src/pages/production/MoldingTaskDetailPage.tsx',
    'src/pages/production/PouringTaskDetailPage.tsx',
    'src/pages/production/ShakeCleanTaskDetailPage.tsx',
    'src/pages/production/FinalInspectionTaskDetailPage.tsx',
  ]
  for (const file of detailFiles) {
    const source = read(file)
    assert.match(source, /fromPage/, `${file} must carry the source page context`)
    assert.match(source, /fromPageSize/, `${file} must carry the source page size context`)
    assert.match(source, /next\.set\(['"]page['"]/, `${file} must restore page on back`)
    assert.match(source, /next\.set\(['"]pageSize['"]/, `${file} must restore page size on back`)
  }
})
