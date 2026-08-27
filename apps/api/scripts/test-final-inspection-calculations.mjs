import assert from 'node:assert/strict'
import {
  allocateInspectionBatches,
  calculateDefaultScrapWeightKg,
  canCompleteFinalInspection,
  validateInspectionQuantities,
} from '../dist/production/final-inspection.calculations.js'

assert.deepEqual(
  validateInspectionQuantities({ goodQty: 80, reworkQty: 10, scrapQty: 10 }, 100),
  { total: 100 },
)
assert.deepEqual(
  validateInspectionQuantities({ goodQty: 1, reworkQty: 0, scrapQty: 0 }, 10),
  { total: 1 },
)
assert.throws(
  () => validateInspectionQuantities({ goodQty: 80, reworkQty: 20, scrapQty: 1 }, 100),
  /超过待检数量/,
)
assert.throws(
  () => validateInspectionQuantities({ goodQty: 0, reworkQty: 0, scrapQty: 0 }, 100),
  /必须大于 0/,
)
for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => validateInspectionQuantities({ goodQty: invalid, reworkQty: 0, scrapQty: 0 }, 100),
    /非负整数/,
  )
}
assert.throws(
  () => validateInspectionQuantities({ goodQty: 1, reworkQty: 0, scrapQty: 0 }, -1),
  /非负整数/,
)

assert.equal(calculateDefaultScrapWeightKg(3, 45), 135)
assert.equal(calculateDefaultScrapWeightKg(0, 45), 0)
assert.equal(calculateDefaultScrapWeightKg(3, 0.1), 0.3)
assert.equal(calculateDefaultScrapWeightKg(1, 1.23456), 1.2346)
assert.throws(() => calculateDefaultScrapWeightKg(-1, 45), /非负整数/)
assert.throws(() => calculateDefaultScrapWeightKg(1.5, 45), /非负整数/)
for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => calculateDefaultScrapWeightKg(1, invalid), /非负有限数/)
}

const batches = [
  { id: 'b', remainingQuantity: 10, availableAt: '2026-08-26T09:00:00Z' },
  { id: 'a', remainingQuantity: 5, availableAt: '2026-08-26T08:00:00Z' },
]
assert.deepEqual(
  allocateInspectionBatches(12, batches),
  [{ batchId: 'a', quantity: 5 }, { batchId: 'b', quantity: 7 }],
)
assert.deepEqual(
  allocateInspectionBatches(2, [
    { id: 'b', remainingQuantity: 1, availableAt: '2026-08-26T08:00:00Z' },
    { id: 'a', remainingQuantity: 1, availableAt: '2026-08-26T08:00:00Z' },
  ]),
  [{ batchId: 'a', quantity: 1 }, { batchId: 'b', quantity: 1 }],
)
assert.throws(() => allocateInspectionBatches(0, batches), /正整数/)
assert.deepEqual(batches, [
  { id: 'b', remainingQuantity: 10, availableAt: '2026-08-26T09:00:00Z' },
  { id: 'a', remainingQuantity: 5, availableAt: '2026-08-26T08:00:00Z' },
])
assert.throws(() => allocateInspectionBatches(16, batches), /待检数量不足/)
assert.throws(() => allocateInspectionBatches(-1, batches), /正整数/)
assert.throws(
  () => allocateInspectionBatches(1, [{ id: 'a', remainingQuantity: -1, availableAt: '2026-08-26T08:00:00Z' }]),
  /非负整数/,
)
assert.throws(
  () => allocateInspectionBatches(1, [{ id: 'a', remainingQuantity: 1, availableAt: 'invalid' }]),
  /可检时间无效/,
)
assert.deepEqual(
  allocateInspectionBatches(1, [{ id: 'a', remainingQuantity: 1, availableAt: '2026-08-26T16:00:00+08:00' }]),
  [{ batchId: 'a', quantity: 1 }],
)
assert.throws(
  () => allocateInspectionBatches(1, [{ id: 'a', remainingQuantity: 1, availableAt: '2026-08-26T08:00:00' }]),
  /可检时间无效/,
)
assert.throws(
  () => allocateInspectionBatches(1, [{ id: 'a', remainingQuantity: 1, availableAt: '2026-02-30T08:00:00Z' }]),
  /可检时间无效/,
)
assert.throws(
  () => allocateInspectionBatches(1, [{ id: 'a', remainingQuantity: 1, availableAt: new Date('invalid') }]),
  /可检时间无效/,
)

assert.equal(
  canCompleteFinalInspection({ upstreamOpen: false, pendingInspectionQty: 0, openReworkQty: 0 }),
  true,
)
assert.equal(
  canCompleteFinalInspection({ upstreamOpen: true, pendingInspectionQty: 0, openReworkQty: 0 }),
  false,
)
assert.equal(
  canCompleteFinalInspection({ upstreamOpen: false, pendingInspectionQty: 1, openReworkQty: 0 }),
  false,
)
assert.equal(
  canCompleteFinalInspection({ upstreamOpen: false, pendingInspectionQty: 0, openReworkQty: 1 }),
  false,
)
assert.throws(
  () => canCompleteFinalInspection({ upstreamOpen: false, pendingInspectionQty: -1, openReworkQty: 0 }),
  /非负整数/,
)

console.log(JSON.stringify({ ok: true, suite: 'final-inspection-calculations' }))
