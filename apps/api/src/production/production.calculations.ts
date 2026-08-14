import type { WorkOrderProductionStatus, WorkOrderScheduleStatus } from './production.types'

export class CapacityConfigurationError extends Error {}

function finitePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于 0`)
  return value
}

export function roundWeight(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function capacityToKg(value: number, unit: string) {
  if (!Number.isFinite(value)) throw new CapacityConfigurationError('单炉重量必须为有限数值')
  if (value <= 0) throw new CapacityConfigurationError('单炉重量必须大于 0')
  const normalized = unit.replace(/\s+/gu, '').toLowerCase()
  if (['kg', '千克', 'kg/炉', '千克/炉'].includes(normalized)) return roundWeight(value)
  if (['t', '吨', 't/炉', '吨/炉'].includes(normalized)) return roundWeight(value * 1000)
  throw new CapacityConfigurationError('单炉重量单位仅支持 kg、千克、t、吨及其 /炉 表示')
}

export function allocationWeightKg(quantity: number, unitGrossWeightKg: number) {
  if (!Number.isInteger(quantity)) throw new Error('分配件数必须为整数')
  finitePositive(quantity, '分配件数')
  finitePositive(unitGrossWeightKg, '单件浇注毛重')
  return roundWeight(quantity * unitGrossWeightKg)
}

export function maxAllocatableQuantity(remainingCapacityKg: number, unitGrossWeightKg: number) {
  if (!Number.isFinite(remainingCapacityKg) || remainingCapacityKg <= 0) return 0
  finitePositive(unitGrossWeightKg, '单件浇注毛重')
  return Math.max(0, Math.floor(remainingCapacityKg / unitGrossWeightKg))
}

export function recipeOccupancyMinutes(melting: number, transfer: number, cleaning: number) {
  const values = [melting, transfer, cleaning]
  if (values.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('配方时长必须为非负整数')
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) throw new Error('配方总占用时长必须大于 0')
  return total
}

export function calculateFinishAt(start: Date, durationMinutes: number) {
  if (Number.isNaN(start.getTime())) throw new Error('计划开始时间无效')
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) throw new Error('设备占用时长必须为正整数')
  return new Date(start.getTime() + durationMinutes * 60_000)
}

export function intervalsOverlap(startA: Date, finishA: Date, startB: Date, finishB: Date) {
  return startA < finishB && finishA > startB
}

export function clipInterval(start: Date, finish: Date, windowStart: Date, windowFinish: Date): [Date, Date] | null {
  const visibleStart = new Date(Math.max(start.getTime(), windowStart.getTime()))
  const visibleFinish = new Date(Math.min(finish.getTime(), windowFinish.getTime()))
  return visibleStart < visibleFinish ? [visibleStart, visibleFinish] : null
}

export function allocateActualWeight<T extends { id: string; plannedWeightKg: number }>(rows: T[], actualWeightKg: number) {
  finitePositive(actualWeightKg, '实际出炉重量')
  const totalPlanned = rows.reduce((sum, row) => sum + finitePositive(row.plannedWeightKg, '计划铁水重量'), 0)
  let allocated = 0
  return rows.map((row, index) => {
    const actual = index === rows.length - 1
      ? roundWeight(actualWeightKg - allocated)
      : roundWeight((actualWeightKg * row.plannedWeightKg) / totalPlanned)
    allocated = roundWeight(allocated + actual)
    return { ...row, actualWeightKg: actual }
  })
}

export function displayWorkOrderStatus(
  scheduleStatus: WorkOrderScheduleStatus,
  productionStatus: WorkOrderProductionStatus,
) {
  if (productionStatus === 'CLOSED') return '已关闭'
  if (productionStatus === 'COMPLETED') return '已完工'
  if (productionStatus === 'MELT_COMPLETED') return '熔炼完成'
  if (productionStatus === 'IN_PRODUCTION') return '生产中'
  if (scheduleStatus === 'FULL') return '已排产'
  if (scheduleStatus === 'PARTIAL') return '部分排产'
  return '待排产'
}
