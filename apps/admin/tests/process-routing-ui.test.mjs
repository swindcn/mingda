import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('routing save reports form validation and unknown failures', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/ProcessRoutingWorkbenchPage.tsx'), 'utf8')

  assert.match(page, /message\.error\(error instanceof Error \? error\.message : '工艺路线保存失败，请检查必填项和路线配置'\)/)
})

test('routing product picker excludes products assigned to another routing master', () => {
  const component = fs.readFileSync(path.join(root, 'src/pages/modeling/routing/RoutingApplicableProducts.tsx'), 'utf8')

  assert.match(component, /assignedRoutingCode/)
  assert.match(component, /currentRoutingCode/)
})

test('routing list exposes a permission-controlled recycle bin for disabled versions', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/ProcessRoutingListPage.tsx'), 'utf8')
  const client = fs.readFileSync(path.join(root, 'src/utils/processRoutings.ts'), 'utf8')
  const roles = fs.readFileSync(path.join(root, 'src/utils/roles.ts'), 'utf8')

  assert.match(page, /model\.routing\.recycle/)
  assert.match(page, /回收站/)
  assert.match(page, /recycleProcessRouting/)
  assert.match(page, /restoreProcessRouting/)
  assert.match(client, /recycledAt/)
  assert.match(client, /\/recycle/)
  assert.match(client, /\/restore/)
  assert.match(roles, /工艺路线-回收与恢复/)
})

test('routing list does not treat material grade as a routing field and shows applicable product count', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/ProcessRoutingListPage.tsx'), 'utf8')

  assert.doesNotMatch(page, /placeholder="材质牌号"/)
  assert.doesNotMatch(page, /title: '材质牌号'/)
  assert.doesNotMatch(page, /materialGradeCode/)
  assert.match(page, /title: '关联产品数'/)
  assert.match(page, /record\.products\.length/)
})

test('routing node drawer only configures cooling duration for shake or cleaning nodes', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/modeling/ProcessRoutingWorkbenchPage.tsx'), 'utf8')
  const client = fs.readFileSync(path.join(root, 'src/utils/processRoutings.ts'), 'utf8')

  assert.match(client, /coolingDurationMinutes\?: number/)
  assert.match(page, /const lastInitializedNodeId = useRef<string \| undefined>\(undefined\)/)
  assert.match(page, /if \(lastInitializedNodeId\.current === selectedNodeId\) return/)
  assert.match(page, /lastInitializedNodeId\.current = selectedNodeId/)
  assert.match(page, /nodeForm\.resetFields\(\)/)
  assert.match(page, /coolingDurationMinutes: selectedNode\.coolingDurationMinutes \?\? 0/)
  assert.match(page, /\}, \[nodeForm, nodes, selectedNodeId\]\)/)
  assert.match(page, /selectedNode\.operationCode === 'OP-SHAKE' \|\| selectedNode\.section === '清理'/)
  assert.match(page, /isShakeCleaningNode && <Form\.Item name="coolingDurationMinutes" label="要求冷却时长（分钟）">/)
  assert.match(page, /<InputNumber min=\{0\} precision=\{0\}/)
  assert.match(page, /const payload: ProcessRoutingPayload = \{ \.\.\.values, productCodes, nodes, edges \}/)
})
