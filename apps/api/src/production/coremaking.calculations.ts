import { Prisma } from '@prisma/client'

export type CalculatedCoreBatchStatus = 'AVAILABLE' | 'WARNING' | 'EXPIRED'
const DATABASE_INT_MAX = 2_147_483_647
const DECIMAL_SCALE = 10_000

function finiteNumber(value: unknown, label: string) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) throw new Error(`${label}必须为有限数值`)
  return numberValue
}

function scaledDecimal(value: number, label: string, maxScaled: number) {
  const decimalValue = new Prisma.Decimal(value)
  if (decimalValue.decimalPlaces() > 4 || decimalValue.abs().mul(DECIMAL_SCALE).greaterThan(maxScaled)) {
    throw new Error(`${label}超出可存储范围或小数位超过 4 位`)
  }
  return BigInt(decimalValue.mul(DECIMAL_SCALE).toFixed(0))
}

export function calculateCoreDemand(
  workOrderQuantity: number,
  quantityPerProduct: number,
  expectedScrapRate: number,
) {
  const orderQuantity = finiteNumber(workOrderQuantity, '工单计划数量')
  const ratio = finiteNumber(quantityPerProduct, '芯件比')
  const scrapRate = finiteNumber(expectedScrapRate, '预计废品率')
  if (!Number.isInteger(orderQuantity) || orderQuantity <= 0) throw new Error('工单计划数量必须为正整数')
  if (orderQuantity > DATABASE_INT_MAX) throw new Error('工单计划数量超出可存储范围')
  if (ratio <= 0) throw new Error('芯件比必须大于 0')
  if (scrapRate < 0) throw new Error('预计废品率不能小于 0')
  const scale = BigInt(DECIMAL_SCALE)
  const ratioScaled = scaledDecimal(ratio, '芯件比', 999_999_999_999)
  const scrapRateScaled = scaledDecimal(scrapRate, '预计废品率', 99_999_999)
  if (ratioScaled <= 0n) throw new Error('芯件比最小为 0.0001')
  const numerator = BigInt(orderQuantity) * ratioScaled * (scale + scrapRateScaled)
  const denominator = scale * scale
  const result = (numerator + denominator - 1n) / denominator
  if (result > BigInt(DATABASE_INT_MAX)) throw new Error('砂芯计划需求量超出可存储范围')
  return Number(result)
}

export function calculatePressCount(plannedQuantity: number, cavityCount: number) {
  const quantity = finiteNumber(plannedQuantity, '砂芯计划需求量')
  const cavities = finiteNumber(cavityCount, '芯盒穴数')
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('砂芯计划需求量必须为正整数')
  if (!Number.isInteger(cavities) || cavities <= 0) throw new Error('芯盒穴数必须为正整数')
  if (quantity > DATABASE_INT_MAX || cavities > DATABASE_INT_MAX) throw new Error('压盒次数计算参数超出可存储范围')
  const result = Math.ceil(quantity / cavities)
  if (result > DATABASE_INT_MAX) throw new Error('计划压盒次数超出可存储范围')
  return result
}

export function calculateCoreExpiresAt(baseTime: Date, shelfLifeHours: number | null | undefined) {
  if (!(baseTime instanceof Date) || Number.isNaN(baseTime.getTime())) throw new Error('保质期起算时间无效')
  if (shelfLifeHours === null || shelfLifeHours === undefined) return null
  const hours = finiteNumber(shelfLifeHours, '保质期')
  if (hours <= 0) throw new Error('保质期必须大于 0')
  scaledDecimal(hours, '保质期', 999_999_999_999)
  const result = new Date(baseTime.getTime() + hours * 60 * 60 * 1000)
  if (Number.isNaN(result.getTime())) throw new Error('保质期失效时间超出有效范围')
  return result
}

export function calculateCoreBatchExpiresAt(
  dryingRequired: boolean,
  reportedAt: Date,
  driedAt: Date | null,
  shelfLifeHours: number | null | undefined,
) {
  if (dryingRequired && driedAt === null) return null
  return calculateCoreExpiresAt(dryingRequired ? driedAt! : reportedAt, shelfLifeHours)
}

export function coreBatchStatus(now: Date, expiresAt: Date | null): CalculatedCoreBatchStatus {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('当前时间无效')
  if (expiresAt === null) return 'AVAILABLE'
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) throw new Error('失效时间无效')
  const remainingMs = expiresAt.getTime() - now.getTime()
  if (remainingMs <= 0) return 'EXPIRED'
  if (remainingMs <= 24 * 60 * 60 * 1000) return 'WARNING'
  return 'AVAILABLE'
}
