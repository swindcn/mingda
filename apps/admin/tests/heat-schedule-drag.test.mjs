import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helperPath = path.join(root, 'src/pages/production/heatScheduleDrag.ts')

test('snaps timeline positions to 15-minute boundaries', async () => {
  assert.equal(fs.existsSync(helperPath), true)
  const { snapMinutesToQuarter, minutesFromTrackX } = await import(helperPath)
  assert.equal(snapMinutesToQuarter(7), 0)
  assert.equal(snapMinutesToQuarter(8), 15)
  assert.equal(snapMinutesToQuarter(1439), 1425)
  assert.equal(minutesFromTrackX(250, 100, 600), 360)
})

test('preserves duration while moving a heat order', async () => {
  assert.equal(fs.existsSync(helperPath), true)
  const { scheduleStartAt, finishAtPreservingDuration, isDragMovement } = await import(helperPath)
  const start = scheduleStartAt('2026-08-29T16:00:00.000Z', 585)
  assert.equal(start, '2026-08-30T01:45:00.000Z')
  assert.equal(finishAtPreservingDuration(start, '2026-08-30T00:15:00.000Z', '2026-08-30T01:45:00.000Z'), '2026-08-30T03:15:00.000Z')
  assert.equal(isDragMovement(10, 10, 13, 13), false)
  assert.equal(isDragMovement(10, 10, 16, 10), true)
})

test('equipment timeline uses permission-gated pointer capture and shared adjustment', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/production/EquipmentScheduleOverview.tsx'), 'utf8')
  const productionSource = fs.readFileSync(path.join(root, 'src/utils/production.ts'), 'utf8')
  assert.match(source, /production\.schedule\.adjust/)
  assert.match(source, /setPointerCapture/)
  assert.match(source, /onPointerMove/)
  assert.match(source, /openHeatScheduleAdjustment/)
  assert.match(source, /compatibleFurnaceCodes/)
  assert.match(source, /TRANSFERRING:\s*\{\s*label:\s*'转运中'/)
  assert.match(productionSource, /status:\s*'IDLE'\s*\|\s*'WAITING'\s*\|\s*'IN_PROGRESS'\s*\|\s*'TRANSFERRING'\s*\|\s*'SCHEDULED'/)
})
