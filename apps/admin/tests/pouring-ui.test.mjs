import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('合型浇注查询与页面操作遵循独立权限', () => {
  const list = read('src/pages/production/PouringTaskListPage.tsx')
  const detail = read('src/pages/production/PouringTaskDetailPage.tsx')
  assert.match(list, /page-header/)
  assert.match(list, /ResizableTable/)
  assert.match(list, /fixed: 'right'/)
  assert.match(detail, /production\.pouring\.report/)
  assert.match(detail, /production\.pouring\.reverse/)
})

test('浇注报工先检查再提交并处理并发冲突', () => {
  const detail = read('src/pages/production/PouringTaskDetailPage.tsx')
  assert.ok(detail.indexOf('await checkPouring') < detail.indexOf('await reportPouring'))
  assert.match(detail, /TRANSFER_OVERDRAW/)
  assert.match(detail, /CRITICAL_HOLD/)
  assert.match(detail, /error\.status === 409/)
})
