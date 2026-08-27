import { Prisma } from '@prisma/client'

export type PouringHoldLevelValue = 'NORMAL' | 'WARNING' | 'CRITICAL'

export interface PouringMoldBatchCandidate {
  id: string
  remainingQuantity: number
  closingTime: Date | string
}

export interface PouringMoldBatchAllocation {
  batchId: string
  quantity: number
}

function nonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须为非负整数`)
  return value
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}必须为正整数`)
  return value
}

function nonNegativeDecimal(value: number | string | Prisma.Decimal, label: string) {
  try {
    const result = new Prisma.Decimal(value)
    if (!result.isFinite() || result.lessThan(0)) throw new Error()
    return result
  } catch {
    throw new Error(`${label}必须为非负数值`)
  }
}

function timestamp(value: Date | string, label: string) {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (Number.isNaN(result)) throw new Error(`${label}无效`)
  return result
}

export function calculateTheoreticalPouringWeight(
  goodQty: number,
  scrapQty: number,
  cavityCount: number,
  unitGrossWeightKg: number | string | Prisma.Decimal,
) {
  const totalBoxes = nonNegativeInteger(goodQty, '合格箱数') + nonNegativeInteger(scrapQty, '废品箱数')
  const cavities = positiveInteger(cavityCount, '型腔数')
  const unitWeight = nonNegativeDecimal(unitGrossWeightKg, '单件浇注毛重')
  return unitWeight.mul(totalBoxes).mul(cavities).toDecimalPlaces(2).toNumber()
}

export function calculateTransferBalance(
  transferWeightKg: number | string | Prisma.Decimal,
  consumedWeightsKg: Array<number | string | Prisma.Decimal>,
) {
  const initial = nonNegativeDecimal(transferWeightKg, '转运重量')
  const consumed = consumedWeightsKg.reduce<Prisma.Decimal>(
    (sum, value) => sum.add(nonNegativeDecimal(value, '浇注重量')),
    new Prisma.Decimal(0),
  )
  return initial.sub(consumed).toDecimalPlaces(2).toNumber()
}

export function pouringHoldLevel(holdMinutes: number): PouringHoldLevelValue {
  if (!Number.isFinite(holdMinutes) || holdMinutes < 0) throw new Error('合型停留时长必须为非负数值')
  if (holdMinutes > 120) return 'CRITICAL'
  if (holdMinutes >= 90) return 'WARNING'
  return 'NORMAL'
}

export function allocatePouringMoldBatches(
  requiredQuantity: number,
  candidates: PouringMoldBatchCandidate[],
) {
  const required = nonNegativeInteger(requiredQuantity, '浇注箱数')
  if (required === 0) return []

  const sorted = candidates
    .filter((candidate) => Number.isInteger(candidate.remainingQuantity) && candidate.remainingQuantity > 0)
    .map((candidate) => ({ ...candidate, closingTimestamp: timestamp(candidate.closingTime, '合型完成时间') }))
    .sort((left, right) => left.closingTimestamp - right.closingTimestamp || left.id.localeCompare(right.id))

  let remaining = required
  const allocations: PouringMoldBatchAllocation[] = []
  for (const candidate of sorted) {
    if (remaining === 0) break
    const quantity = Math.min(remaining, candidate.remainingQuantity)
    allocations.push({ batchId: candidate.id, quantity })
    remaining -= quantity
  }
  if (remaining > 0) throw new Error(`待浇箱数不足，缺少 ${remaining} 箱`)
  return allocations
}
