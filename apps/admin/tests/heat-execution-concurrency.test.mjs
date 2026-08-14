import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('heat execution actions refresh stale records and recover from version conflicts', () => {
  const actions = fs.readFileSync(path.join(root, 'src/pages/production/HeatExecutionActions.tsx'), 'utf8')

  assert.match(actions, /fetchHeatOrder/)
  assert.match(actions, /ApiRequestError/)
  assert.match(actions, /status === 409/)
  assert.match(actions, /数据已被其他终端更新/)
  assert.match(actions, /await refresh\(\)/)
})

test('heat detail refreshes when the browser regains focus', () => {
  const detail = fs.readFileSync(path.join(root, 'src/pages/production/HeatOrderDetailPage.tsx'), 'utf8')

  assert.match(detail, /addEventListener\(['"]focus['"]/)
  assert.match(detail, /removeEventListener\(['"]focus['"]/)
})

test('heat schedule adjustment is permission gated and handles conflicts centrally', () => {
  const detail = fs.readFileSync(path.join(root, 'src/pages/production/HeatOrderDetailPage.tsx'), 'utf8')
  const adjustmentPath = path.join(root, 'src/pages/production/HeatScheduleAdjustment.tsx')
  assert.equal(fs.existsSync(adjustmentPath), true)
  const adjustment = fs.existsSync(adjustmentPath) ? fs.readFileSync(adjustmentPath, 'utf8') : ''

  assert.match(detail, /production\.schedule\.adjust/)
  assert.match(detail, /openHeatScheduleAdjustment/)
  assert.match(adjustment, /fetchHeatOrder/)
  assert.match(adjustment, /HEAT_SCHEDULE_CONFLICT/)
  assert.match(adjustment, /数据已被其他终端更新/)
})
