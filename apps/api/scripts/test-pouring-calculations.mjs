import assert from 'node:assert/strict'
import {
  allocatePouringMoldBatches,
  calculateTheoreticalPouringWeight,
  calculateTransferBalance,
  pouringHoldLevel,
} from '../dist/production/pouring.calculations.js'

assert.equal(calculateTheoreticalPouringWeight(30, 2, 2, 65), 4160)
assert.equal(calculateTheoreticalPouringWeight(0, 0, 2, 65), 0)
assert.throws(() => calculateTheoreticalPouringWeight(-1, 0, 2, 65), /合格箱数/)
assert.throws(() => calculateTheoreticalPouringWeight(1, 0, 0, 65), /型腔数/)

assert.equal(calculateTransferBalance(4000, [1200, 3000]), -200)
assert.equal(calculateTransferBalance(4000, []), 4000)

assert.equal(pouringHoldLevel(89), 'NORMAL')
assert.equal(pouringHoldLevel(90), 'WARNING')
assert.equal(pouringHoldLevel(120), 'WARNING')
assert.equal(pouringHoldLevel(121), 'CRITICAL')

const candidates = [
  { id: 'b', remainingQuantity: 10, closingTime: '2026-08-24T09:00:00Z' },
  { id: 'a', remainingQuantity: 5, closingTime: '2026-08-24T08:00:00Z' },
]
assert.deepEqual(
  allocatePouringMoldBatches(12, candidates),
  [{ batchId: 'a', quantity: 5 }, { batchId: 'b', quantity: 7 }],
)
assert.deepEqual(allocatePouringMoldBatches(0, candidates), [])
assert.throws(() => allocatePouringMoldBatches(16, candidates), /待浇箱数不足/)

console.log(JSON.stringify({ ok: true, suite: 'pouring-calculations' }))
