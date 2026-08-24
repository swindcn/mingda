import assert from 'node:assert/strict'
import {
  allocateQueueBatches,
  calculateCoolingState,
  calculateShakePieces,
} from '../dist/production/shake-clean.calculations.js'

assert.equal(calculateShakePieces(120, 2), 240)
assert.equal(calculateShakePieces(0, 2), 0)
assert.throws(() => calculateShakePieces(-1, 2), /非负整数/)
assert.throws(() => calculateShakePieces(1, 1.5), /非负整数/)

assert.deepEqual(
  calculateCoolingState('2026-08-24T08:00:00Z', '2026-08-24T09:30:00Z', 120),
  { requiredMinutes: 120, actualMinutes: 90, remainingMinutes: 30, early: true },
)
assert.deepEqual(
  calculateCoolingState('2026-08-24T08:00:00Z', '2026-08-24T09:30:59Z', 120),
  { requiredMinutes: 120, actualMinutes: 90, remainingMinutes: 30, early: true },
)
assert.deepEqual(
  calculateCoolingState('2026-08-24T08:00:00Z', '2026-08-24T10:00:00Z', 120),
  { requiredMinutes: 120, actualMinutes: 120, remainingMinutes: 0, early: false },
)
assert.deepEqual(
  calculateCoolingState('2026-08-24T08:00:00Z', '2026-08-24T10:01:00Z', 120),
  { requiredMinutes: 120, actualMinutes: 121, remainingMinutes: 0, early: false },
)
assert.deepEqual(
  calculateCoolingState('2024-02-29T08:00:00+08:00', '2024-02-29T01:00:00Z', 60),
  { requiredMinutes: 60, actualMinutes: 60, remainingMinutes: 0, early: false },
)
assert.deepEqual(
  calculateCoolingState('2000-02-29T00:00:00Z', '2000-02-29T01:00:00Z', 60),
  { requiredMinutes: 60, actualMinutes: 60, remainingMinutes: 0, early: false },
)
assert.throws(
  () => calculateCoolingState('invalid', '2026-08-24T09:30:00Z', 120),
  /时间.*无效/,
)
assert.throws(
  () => calculateCoolingState('2026-02-30T08:00:00Z', '2026-08-24T09:30:00Z', 120),
  /时间.*无效/,
)
assert.throws(
  () => calculateCoolingState('1900-02-29T00:00:00Z', '1900-03-01T00:00:00Z', 60),
  /时间.*无效/,
)
assert.throws(
  () => calculateCoolingState('2026-08-24 08:00:00Z', '2026-08-24T09:30:00Z', 120),
  /时间.*无效/,
)
assert.throws(
  () => calculateCoolingState(new Date('invalid'), '2026-08-24T09:30:00Z', 120),
  /时间.*无效/,
)
assert.throws(
  () => calculateCoolingState('2026-08-24T09:30:00Z', '2026-08-24T08:00:00Z', 120),
  /检查时间不能早于浇注时间/,
)
assert.throws(
  () => calculateCoolingState('2026-08-24T08:00:00Z', '2026-08-24T09:30:00Z', -1),
  /非负整数/,
)

const candidates = [
  { id: 'b', remainingQuantity: 10, availableAt: '2026-08-24T09:00:00Z' },
  { id: 'a', remainingQuantity: 5, availableAt: '2026-08-24T08:00:00Z' },
]
assert.deepEqual(
  allocateQueueBatches(12, candidates),
  [{ batchId: 'a', quantity: 5 }, { batchId: 'b', quantity: 7 }],
)
assert.deepEqual(
  allocateQueueBatches(2, [
    { id: 'b', remainingQuantity: 1, availableAt: '2026-08-24T08:00:00Z' },
    { id: 'a', remainingQuantity: 1, availableAt: '2026-08-24T08:00:00Z' },
  ]),
  [{ batchId: 'a', quantity: 1 }, { batchId: 'b', quantity: 1 }],
)
const immutableCandidates = Object.freeze([
  Object.freeze({ id: 'b', remainingQuantity: 10, availableAt: '2026-08-24T09:00:00Z' }),
  Object.freeze({ id: 'a', remainingQuantity: 5, availableAt: '2026-08-24T08:00:00Z' }),
])
const immutableSnapshot = structuredClone(immutableCandidates)
assert.deepEqual(
  allocateQueueBatches(12, immutableCandidates),
  [{ batchId: 'a', quantity: 5 }, { batchId: 'b', quantity: 7 }],
)
assert.deepEqual(immutableCandidates, immutableSnapshot)
assert.throws(() => allocateQueueBatches(16, candidates), /待处理数量不足/)
assert.throws(() => allocateQueueBatches(0, candidates), /正整数/)
assert.throws(
  () => allocateQueueBatches(1, [{ id: 'a', remainingQuantity: -1, availableAt: '2026-08-24T08:00:00Z' }]),
  /非负整数/,
)
assert.throws(
  () => allocateQueueBatches(1, [{ id: 'a', remainingQuantity: 1, availableAt: 'invalid' }]),
  /时间.*无效/,
)

console.log(JSON.stringify({ ok: true, suite: 'shake-clean-calculations' }))
