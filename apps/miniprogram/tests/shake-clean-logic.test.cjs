const assert = require('node:assert/strict')
const test = require('node:test')
const logic = require('../dist/utils/shake-clean.js')

test('数量校验拒绝 NaN、小数、负数和超出剩余量', () => {
  for (const value of [NaN, 'abc', 1.2, -1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(logic.normalizeNonNegativeInteger(value), null)
  assert.equal(logic.normalizeNonNegativeInteger(''), null)
  assert.equal(logic.validateReportQuantities(1, 0, 2).ok, true)
  assert.equal(logic.validateReportQuantities(1.2, 0, 2).ok, false)
  assert.equal(logic.validateReportQuantities(1, 2, 2).ok, false)
  assert.equal(logic.validateReportQuantities(0, 0, 2).ok, false)
})

test('浇冒口重量只接受有限非负数字', () => {
  assert.equal(logic.normalizeNonNegativeWeight('1.5'), 1.5)
  assert.equal(logic.normalizeNonNegativeWeight(''), null)
  assert.equal(logic.normalizeNonNegativeWeight('NaN'), null)
  assert.equal(logic.normalizeNonNegativeWeight(-1), null)
  assert.equal(logic.normalizeNonNegativeWeight(Infinity), null)
})

test('分页合并按后端顺序去重', () => {
  const merged = logic.mergeUniqueById([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }, { id: 'a' }])
  assert.deepEqual(merged.map((item) => item.id), ['a', 'b', 'c'])
})

test('操作权限仅由后端 allowedActions 决定', () => {
  assert.equal(logic.canExecuteAction({ shakeReport: true, cleanReport: false }, 'shakeReport'), true)
  assert.equal(logic.canExecuteAction({ shakeReport: true, cleanReport: false }, 'cleanReport'), false)
})

test('提交中或成功后禁止重复提交', () => {
  assert.equal(logic.canSubmitReport(false, false, true), true)
  assert.equal(logic.canSubmitReport(true, false, true), false)
  assert.equal(logic.canSubmitReport(false, true, true), false)
  assert.equal(logic.canSubmitReport(false, false, false), false)
})

test('卸载生命周期会清除定时器且卸载后不再允许导航', async () => {
  const lifecycle = logic.createShakeCleanLifecycle()
  let fired = false
  lifecycle.setTimer(() => { fired = true }, 15)
  lifecycle.markUnloaded()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(fired, false)
  assert.equal(lifecycle.isUnloaded(), true)
  assert.equal(lifecycle.canContinue(), false)
})
