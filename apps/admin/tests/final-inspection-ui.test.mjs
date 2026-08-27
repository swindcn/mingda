import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('成品终检路由、菜单和权限树完整', () => {
  const app = read('src/App.tsx')
  const layout = read('src/layouts/AppLayout.tsx')
  const roles = read('src/utils/roles.ts')
  assert.match(app, /production\/inspection-tasks/)
  assert.match(app, /production\.inspection\.view/)
  assert.match(layout, /成品终检/)
  for (const permission of ['production.inspection.view', 'production.inspection.report', 'production.inspection.reverse', 'production.cleaning_rework.view', 'production.cleaning_rework.report']) assert.match(roles, new RegExp(permission.replaceAll('.', '\\.')))
})

test('终检列表遵循查询、可调列宽和固定操作列标准', () => {
  const source = read('src/pages/production/FinalInspectionTaskListPage.tsx')
  assert.match(source, /className="page-header"/)
  assert.match(source, />查询</)
  assert.match(source, /ResizableTable/)
  assert.match(source, /fixed: 'right'/)
  assert.match(source, /TableActions/)
  assert.match(source, /useSearchParams/)
})

test('终检详情按后端动作与按钮权限控制，并处理并发冲突', () => {
  const source = read('src/pages/production/FinalInspectionTaskDetailPage.tsx')
  assert.match(source, /options\.allowedActions\.report/)
  assert.match(source, /production\.inspection\.report/)
  assert.match(source, /production\.inspection\.reverse/)
  assert.match(source, /production\.cleaning_rework\.report/)
  assert.match(source, /error\.status === 409/)
  assert.match(source, /batchVersions/)
  assert.match(source, /maxCount=\{1\}/)
  assert.match(source, /scrapWeightKg === undefined/)
  assert.match(source, /row\.allowedActions\?\.report/)
  assert.match(source, /<Image/)
})
