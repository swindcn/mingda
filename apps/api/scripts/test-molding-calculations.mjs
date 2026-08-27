import assert from 'node:assert/strict'
import {
  allocateCoreBatches,
  allocateCoreBatchesWithOverdraft,
  calculateCoreDemandPerBox,
  calculateOverproduction,
  calculatePlannedBoxes,
  calculateReportCoreDemand,
  calculateMoldingStartReadiness,
} from '../dist/production/molding.calculations.js'

assert.equal(calculatePlannedBoxes(101, 4), 26)
assert.equal(calculatePlannedBoxes(100, 4), 25)
assert.throws(() => calculatePlannedBoxes(0, 4), /工单计划数量必须为正整数/)
assert.throws(() => calculatePlannedBoxes(100, 0), /模具型腔数必须为正整数/)

assert.equal(calculateCoreDemandPerBox('1.5', 4), 6)
assert.equal(calculateCoreDemandPerBox(0.25, 4), 1)
assert.throws(() => calculateCoreDemandPerBox('1.25', 3), /必须为整数/)

assert.equal(calculateReportCoreDemand(10, 2, 6), 72)
assert.equal(calculateReportCoreDemand(0, 0, 6), 0)
assert.throws(() => calculateReportCoreDemand(-1, 0, 6), /不能小于 0/)

assert.equal(calculateOverproduction(26, 28), 2)
assert.equal(calculateOverproduction(26, 20), 0)

assert.deepEqual(
  calculateMoldingStartReadiness([
    { coreTaskCompleted: true, available: 50, quantityPerBox: 1, shortage: 2 },
    { coreTaskCompleted: true, available: 150, quantityPerBox: 3, shortage: 6 },
  ]),
  { startable: true, maxProducibleBoxQty: 50, blockedReason: '' },
)
assert.deepEqual(
  calculateMoldingStartReadiness([
    { coreTaskCompleted: false, available: 50, quantityPerBox: 1, shortage: 2 },
  ]),
  { startable: false, maxProducibleBoxQty: 0, blockedReason: '关联制芯任务尚未完成' },
)
assert.deepEqual(
  calculateMoldingStartReadiness([
    { coreTaskCompleted: true, available: 0, quantityPerBox: 1, shortage: 52 },
  ]),
  { startable: false, maxProducibleBoxQty: 0, blockedReason: '当前砂芯不足以生产一箱' },
)

assert.deepEqual(
  allocateCoreBatches(9, [
    { id: 'later', quantity: 8, status: 'AVAILABLE', expiresAt: '2026-08-20T00:00:00.000Z', producedAt: '2026-08-18T00:00:00.000Z' },
    { id: 'warning', quantity: 4, status: 'WARNING', expiresAt: '2026-08-19T00:00:00.000Z', producedAt: '2026-08-17T00:00:00.000Z' },
  ]),
  [{ batchId: 'warning', quantity: 4 }, { batchId: 'later', quantity: 5 }],
)
assert.deepEqual(
  allocateCoreBatches(3, [
    { id: 'newer', quantity: 2, status: 'AVAILABLE', expiresAt: null, producedAt: '2026-08-18T09:00:00.000Z' },
    { id: 'older', quantity: 2, status: 'AVAILABLE', expiresAt: null, producedAt: '2026-08-18T08:00:00.000Z' },
  ]),
  [{ batchId: 'older', quantity: 2 }, { batchId: 'newer', quantity: 1 }],
)
assert.throws(
  () => allocateCoreBatches(20, [{ id: 'only', quantity: 3, status: 'AVAILABLE', expiresAt: null, producedAt: null }]),
  /库存不足/,
)

assert.deepEqual(
  allocateCoreBatchesWithOverdraft(10, [
    { id: 'first', quantity: 4, status: 'AVAILABLE', expiresAt: null, producedAt: '2026-08-18T08:00:00.000Z' },
    { id: 'last', quantity: 3, status: 'AVAILABLE', expiresAt: null, producedAt: '2026-08-18T09:00:00.000Z' },
  ]),
  [{ batchId: 'first', quantity: 4 }, { batchId: 'last', quantity: 6 }],
)
assert.deepEqual(
  allocateCoreBatchesWithOverdraft(3, [
    { id: 'consumed', quantity: 0, status: 'CONSUMED', expiresAt: null, producedAt: '2026-08-18T08:00:00.000Z' },
  ]),
  [{ batchId: 'consumed', quantity: 3 }],
)
assert.throws(() => allocateCoreBatchesWithOverdraft(1, []), /未找到可追溯的砂芯来源批次/)

console.log(JSON.stringify({ ok: true, suite: 'molding-calculations' }))
