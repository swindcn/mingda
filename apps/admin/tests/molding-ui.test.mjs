import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const detail = fs.readFileSync(path.join(root, 'src/pages/production/MoldingTaskDetailPage.tsx'), 'utf8')

test('已派工任务的派工按钮显示为调整派工', () => {
  assert.match(detail, /task\.status === 'DISPATCHED' \? '调整派工' : '派工'/)
})
