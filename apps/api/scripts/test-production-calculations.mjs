import assert from 'node:assert/strict'
import {
  allocateActualWeight,
  allocationWeightKg,
  capacityToKg,
  calculateFinishAt,
  clipInterval,
  displayWorkOrderStatus,
  intervalsOverlap,
  maxAllocatableQuantity,
  recipeOccupancyMinutes,
} from '../dist/production/production.calculations.js'

for (const unit of ['kg', '千克', 'kg/炉', '千克/炉', ' K G ', '千 克', ' K G / 炉 ', '千 克 / 炉']) {
  assert.equal(capacityToKg(8500, unit), 8500, `${unit} 应换算为 kg`)
}
for (const unit of ['t', '吨', 't/炉', '吨/炉', ' T ', ' 吨 ', ' T / 炉 ', '吨 / 炉']) {
  assert.equal(capacityToKg(10, unit), 10000, `${unit} 应换算为 kg`)
}
for (const unit of ['\tK\tG\t/\t炉\t', '\u00a0T\u00a0/\u00a0炉\u00a0', '\u3000千\u3000克\u3000/\u3000炉\u3000']) {
  const expected = unit.toLowerCase().includes('t') ? 10000 : 10
  assert.equal(capacityToKg(10, unit), expected, `${JSON.stringify(unit)} 应忽略 Unicode 空白`)
}
for (const unit of ['件/班', 'kg/h', '吨/小时']) {
  assert.throws(() => capacityToKg(10, unit), /单炉重量/, `${unit} 不应作为单炉容量单位`)
}
for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  assert.throws(() => capacityToKg(value, 'kg/炉'), /单炉重量必须为有限数值/)
}
for (const value of [0, -1]) {
  assert.throws(() => capacityToKg(value, 'kg/炉'), /单炉重量必须大于 0/)
}

assert.equal(allocationWeightKg(3, 65), 195)
assert.throws(() => allocationWeightKg(1.5, 65), /整数/)
assert.throws(() => allocationWeightKg(0, 65), /大于 0/)
assert.equal(maxAllocatableQuantity(3000, 65), 46)

const allocated = allocateActualWeight(
  [
    { id: 'a', plannedWeightKg: 6500 },
    { id: 'b', plannedWeightKg: 3200 },
  ],
  9601,
)
assert.equal(allocated.length, 2)
assert.equal(allocated.reduce((sum, row) => sum + row.actualWeightKg, 0), 9601)
assert.equal(allocated[0].actualWeightKg, 6433.66)
assert.equal(allocated[1].actualWeightKg, 3167.34)

assert.equal(displayWorkOrderStatus('PENDING', 'RELEASED'), '待排产')
assert.equal(displayWorkOrderStatus('PARTIAL', 'RELEASED'), '部分排产')
assert.equal(displayWorkOrderStatus('FULL', 'RELEASED'), '已排产')
assert.equal(displayWorkOrderStatus('FULL', 'IN_PRODUCTION'), '生产中')
assert.equal(displayWorkOrderStatus('FULL', 'MELT_COMPLETED'), '熔炼完成')
assert.equal(displayWorkOrderStatus('FULL', 'COMPLETED'), '已完工')
assert.equal(displayWorkOrderStatus('PENDING', 'CLOSED'), '已关闭')

assert.equal(recipeOccupancyMinutes(60, 15, 15), 90)
assert.throws(() => recipeOccupancyMinutes(-1, 15, 15), /非负整数/)
assert.throws(() => recipeOccupancyMinutes(1.5, 15, 15), /非负整数/)
assert.throws(() => recipeOccupancyMinutes(0, 0, 0), /必须大于 0/)
assert.equal(calculateFinishAt(new Date('2026-08-13T08:00:00+08:00'), 90).toISOString(), '2026-08-13T01:30:00.000Z')
assert.equal(intervalsOverlap(
  new Date('2026-08-13T08:00:00+08:00'),
  new Date('2026-08-13T09:30:00+08:00'),
  new Date('2026-08-13T09:00:00+08:00'),
  new Date('2026-08-13T10:00:00+08:00'),
), true)
assert.equal(intervalsOverlap(
  new Date('2026-08-13T08:00:00+08:00'),
  new Date('2026-08-13T09:30:00+08:00'),
  new Date('2026-08-13T09:30:00+08:00'),
  new Date('2026-08-13T10:00:00+08:00'),
), false)
assert.deepEqual(
  clipInterval(
    new Date('2026-08-12T23:00:00+08:00'),
    new Date('2026-08-13T01:30:00+08:00'),
    new Date('2026-08-13T00:00:00+08:00'),
    new Date('2026-08-14T00:00:00+08:00'),
  )?.map((value) => value.toISOString()),
  ['2026-08-12T16:00:00.000Z', '2026-08-12T17:30:00.000Z'],
)
assert.equal(clipInterval(
  new Date('2026-08-12T22:00:00+08:00'),
  new Date('2026-08-13T00:00:00+08:00'),
  new Date('2026-08-13T00:00:00+08:00'),
  new Date('2026-08-14T00:00:00+08:00'),
), null)

console.log(JSON.stringify({ ok: true, suite: 'production-calculations' }))
