export interface InspectionQuantities {
  goodQty: number
  reworkQty: number
  scrapQty: number
}

export interface InspectionQueueCandidate {
  id: string
  remainingQuantity: number
  availableAt: Date | string
}

export interface InspectionAllocation {
  batchId: string
  quantity: number
}

export interface FinalInspectionCompletionState {
  upstreamOpen: boolean
  pendingInspectionQty: number
  openReworkQty: number
}

const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负整数`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数`)
  return value
}

function nonNegativeFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负有限数`)
  return value
}

function timestamp(value: Date | string): number {
  if (value instanceof Date) {
    const result = value.getTime()
    if (Number.isNaN(result)) throw new Error('可检时间无效')
    return result
  }

  const match = ISO_DATE_TIME_PATTERN.exec(value)
  if (!match) throw new Error('可检时间无效')
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) throw new Error('可检时间无效')

  const result = Date.parse(value)
  if (Number.isNaN(result)) throw new Error('可检时间无效')
  return result
}

export function validateInspectionQuantities(
  input: InspectionQuantities,
  remaining: number,
): { total: number } {
  const goodQty = nonNegativeInteger(input.goodQty, '合格数量')
  const reworkQty = nonNegativeInteger(input.reworkQty, '返修数量')
  const scrapQty = nonNegativeInteger(input.scrapQty, '报废数量')
  const remainingQty = nonNegativeInteger(remaining, '待检数量')
  const total = goodQty + reworkQty + scrapQty

  if (!Number.isSafeInteger(total)) throw new Error('报检总数量超出安全整数范围')
  if (total === 0) throw new Error('报检总数量必须大于 0')
  if (total > remainingQty) throw new Error('报检总数量超过待检数量')
  return { total }
}

export function calculateDefaultScrapWeightKg(scrapQty: number, netWeightKg: number): number {
  const quantity = nonNegativeInteger(scrapQty, '报废数量')
  const unitWeight = nonNegativeFiniteNumber(netWeightKg, '毛坯净重')
  const totalWeight = quantity * unitWeight
  if (!Number.isFinite(totalWeight)) throw new Error('默认回炉重量超出有限数范围')
  return Number(totalWeight.toFixed(4))
}

export function allocateInspectionBatches(
  quantity: number,
  batches: InspectionQueueCandidate[],
): InspectionAllocation[] {
  const required = positiveInteger(quantity, '分配数量')
  const sorted = batches
    .map((batch) => ({
      ...batch,
      remainingQuantity: nonNegativeInteger(batch.remainingQuantity, '待检数量'),
      availableTimestamp: timestamp(batch.availableAt),
    }))
    .sort((left, right) => left.availableTimestamp - right.availableTimestamp || left.id.localeCompare(right.id))

  let remaining = required
  const allocations: InspectionAllocation[] = []
  for (const batch of sorted) {
    if (remaining === 0) break
    const allocated = Math.min(remaining, batch.remainingQuantity)
    if (allocated === 0) continue
    allocations.push({ batchId: batch.id, quantity: allocated })
    remaining -= allocated
  }

  if (remaining > 0) throw new Error(`待检数量不足，缺少 ${remaining}`)
  return allocations
}

export function canCompleteFinalInspection(input: FinalInspectionCompletionState): boolean {
  const pendingInspectionQty = nonNegativeInteger(input.pendingInspectionQty, '待检数量')
  const openReworkQty = nonNegativeInteger(input.openReworkQty, '未完成返修数量')
  return !input.upstreamOpen && pendingInspectionQty === 0 && openReworkQty === 0
}
