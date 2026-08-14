import assert from 'node:assert/strict'
import {
  calculateCoreDemand,
  calculateCoreBatchExpiresAt,
  calculateCoreExpiresAt,
  calculatePressCount,
  coreBatchStatus,
} from '../dist/production/coremaking.calculations.js'

assert.equal(calculateCoreDemand(100, 2, 0), 200)
assert.equal(calculateCoreDemand(100, 2, 0.03), 206)
assert.equal(calculateCoreDemand(3, 1.5, 0), 5)
assert.equal(calculateCoreDemand(100, 1.1, 0), 110)
assert.equal(calculateCoreDemand(1, 12_345_678.1234, 0), 12_345_679)
assert.throws(() => calculateCoreDemand(0, 1, 0), /工单计划数量必须为正整数/)
assert.throws(() => calculateCoreDemand(10, 0, 0), /芯件比必须大于 0/)
assert.throws(() => calculateCoreDemand(10, 1, -0.01), /预计废品率不能小于 0/)
assert.throws(() => calculateCoreDemand(2_147_483_647, 2, 0), /计划需求量超出可存储范围/)
assert.throws(() => calculateCoreDemand(10, Number.MAX_VALUE, 0), /芯件比超出可存储范围/)
assert.throws(() => calculateCoreDemand(1, 100_000_000, 0), /芯件比超出可存储范围/)
assert.throws(() => calculateCoreDemand(1, 1, 10_000), /预计废品率超出可存储范围/)
assert.throws(() => calculateCoreDemand(1, 0.00001, 0), /小数位超过 4 位/)
assert.throws(() => calculateCoreDemand(2_147_483_648, 0.0001, 0), /工单计划数量超出可存储范围/)

assert.equal(calculatePressCount(206, 4), 52)
assert.equal(calculatePressCount(3, 2), 2)
assert.throws(() => calculatePressCount(10, 0), /芯盒穴数必须为正整数/)
assert.throws(() => calculatePressCount(10, 1.5), /芯盒穴数必须为正整数/)
assert.throws(() => calculatePressCount(2_147_483_648, 1), /超出可存储范围/)

const base = new Date('2026-08-14T08:00:00.000Z')
assert.equal(calculateCoreExpiresAt(base, null), null)
assert.equal(calculateCoreExpiresAt(base, undefined), null)
assert.equal(calculateCoreExpiresAt(base, 8.5)?.toISOString(), '2026-08-14T16:30:00.000Z')
assert.throws(() => calculateCoreExpiresAt(base, 0), /保质期必须大于 0/)
assert.throws(() => calculateCoreExpiresAt(base, 100_000_000), /保质期超出可存储范围/)
assert.throws(() => calculateCoreExpiresAt(base, 0.00001), /小数位超过 4 位/)
assert.throws(() => calculateCoreExpiresAt(new Date(8.64e15), 1), /失效时间超出有效范围/)

const reportedAt = new Date('2026-08-14T08:00:00.000Z')
const driedAt = new Date('2026-08-14T10:00:00.000Z')
assert.equal(calculateCoreBatchExpiresAt(false, reportedAt, null, 8)?.toISOString(), '2026-08-14T16:00:00.000Z')
assert.equal(calculateCoreBatchExpiresAt(true, reportedAt, null, 8), null)
assert.equal(calculateCoreBatchExpiresAt(true, reportedAt, driedAt, 8)?.toISOString(), '2026-08-14T18:00:00.000Z')

assert.equal(coreBatchStatus(base, null), 'AVAILABLE')
assert.equal(coreBatchStatus(base, new Date('2026-08-15T08:00:00.000Z')), 'WARNING')
assert.equal(coreBatchStatus(base, new Date('2026-08-15T08:00:00.001Z')), 'AVAILABLE')
assert.equal(coreBatchStatus(base, new Date('2026-08-14T08:00:00.000Z')), 'EXPIRED')
assert.equal(coreBatchStatus(base, new Date('2026-08-14T07:59:59.999Z')), 'EXPIRED')

console.log(JSON.stringify({ ok: true, suite: 'coremaking-calculations' }))
