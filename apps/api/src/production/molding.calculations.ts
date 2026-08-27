import { Prisma } from '@prisma/client'

const DATABASE_INT_MAX = 2_147_483_647

export type DecimalLike = Prisma.Decimal | string | number

export interface CoreBatchCandidate {
  id: string
  quantity: number
  status: 'AVAILABLE' | 'WARNING'
  expiresAt?: Date | string | null
  producedAt?: Date | string | null
}

export interface TraceableCoreBatchCandidate {
  id: string
  quantity: number
  status: 'UNDRIED' | 'AVAILABLE' | 'WARNING' | 'EXPIRED' | 'LOCKED' | 'SCRAPPED' | 'CONSUMED'
  expiresAt?: Date | string | null
  producedAt?: Date | string | null
}

export interface CoreBatchAllocation {
  batchId: string
  quantity: number
}

export interface MoldingStartRequirement {
  coreTaskCompleted: boolean
  available: number
  quantityPerBox: number
  shortage: number
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}必须为正整数`)
  if (value > DATABASE_INT_MAX) throw new Error(`${label}超出可存储范围`)
  return value
}

function nonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须为整数且不能小于 0`)
  if (value > DATABASE_INT_MAX) throw new Error(`${label}超出可存储范围`)
  return value
}

function decimal(value: DecimalLike, label: string) {
  try {
    const result = new Prisma.Decimal(value)
    if (!result.isFinite()) throw new Error()
    return result
  } catch {
    throw new Error(`${label}必须为有效数值`)
  }
}

export function calculatePlannedBoxes(plannedPieces: number, cavityCount: number) {
  const pieces = positiveInteger(plannedPieces, '工单计划数量')
  const cavities = positiveInteger(cavityCount, '模具型腔数')
  return Math.ceil(pieces / cavities)
}

export function calculateCoreDemandPerBox(quantityPerProduct: DecimalLike, cavityCount: number) {
  const ratio = decimal(quantityPerProduct, '芯件比')
  const cavities = positiveInteger(cavityCount, '模具型腔数')
  if (ratio.lessThanOrEqualTo(0)) throw new Error('芯件比必须大于 0')
  const demand = ratio.mul(cavities)
  if (!demand.isInteger()) throw new Error('每箱砂芯需求必须为整数')
  if (demand.greaterThan(DATABASE_INT_MAX)) throw new Error('每箱砂芯需求超出可存储范围')
  return demand.toNumber()
}

export function calculateReportCoreDemand(
  goodBoxes: number,
  scrapBoxes: number,
  coreDemandPerBox: DecimalLike,
) {
  const good = nonNegativeInteger(goodBoxes, '本次合格箱数')
  const scrap = nonNegativeInteger(scrapBoxes, '本次废品箱数')
  const perBox = decimal(coreDemandPerBox, '每箱砂芯需求')
  if (perBox.lessThan(0)) throw new Error('每箱砂芯需求不能小于 0')
  const total = perBox.mul(good + scrap)
  if (!total.isInteger()) throw new Error('本次砂芯需求必须为整数')
  if (total.greaterThan(DATABASE_INT_MAX)) throw new Error('本次砂芯需求超出可存储范围')
  return total.toNumber()
}

export function calculateOverproduction(plannedBoxes: number, cumulativeGoodBoxes: number) {
  const planned = positiveInteger(plannedBoxes, '计划箱数')
  const completed = nonNegativeInteger(cumulativeGoodBoxes, '累计合格箱数')
  return Math.max(0, completed - planned)
}

export function calculateMoldingStartReadiness(requirements: MoldingStartRequirement[]) {
  if (!requirements.length) {
    return { startable: true, maxProducibleBoxQty: null as number | null, blockedReason: '' }
  }
  if (requirements.some((item) => !item.coreTaskCompleted)) {
    return { startable: false, maxProducibleBoxQty: 0, blockedReason: '关联制芯任务尚未完成' }
  }
  const maxProducibleBoxQty = Math.min(...requirements.map((item) => {
    if (!Number.isFinite(item.available) || !Number.isFinite(item.quantityPerBox) || item.quantityPerBox <= 0) return 0
    return Math.max(0, Math.floor(item.available / item.quantityPerBox))
  }))
  if (maxProducibleBoxQty < 1) {
    return { startable: false, maxProducibleBoxQty: 0, blockedReason: '当前砂芯不足以生产一箱' }
  }
  return { startable: true, maxProducibleBoxQty, blockedReason: '' }
}

function timestamp(value?: Date | string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(result) ? Number.POSITIVE_INFINITY : result
}

function compareTimestamp(left?: Date | string | null, right?: Date | string | null) {
  const leftTime = timestamp(left)
  const rightTime = timestamp(right)
  if (leftTime === rightTime) return 0
  return leftTime < rightTime ? -1 : 1
}

export function allocateCoreBatches(requiredQuantity: number, candidates: CoreBatchCandidate[]) {
  const required = nonNegativeInteger(requiredQuantity, '砂芯需求数量')
  if (required === 0) return []

  const sorted = [...candidates]
    .filter((candidate) => candidate.status === 'AVAILABLE' || candidate.status === 'WARNING')
    .filter((candidate) => Number.isInteger(candidate.quantity) && candidate.quantity > 0)
    .sort((left, right) => {
      const statusOrder = Number(right.status === 'WARNING') - Number(left.status === 'WARNING')
      if (statusOrder !== 0) return statusOrder
      const expiryOrder = compareTimestamp(left.expiresAt, right.expiresAt)
      if (expiryOrder !== 0) return expiryOrder
      const productionOrder = compareTimestamp(left.producedAt, right.producedAt)
      if (productionOrder !== 0) return productionOrder
      return left.id.localeCompare(right.id)
    })

  let remaining = required
  const allocations: CoreBatchAllocation[] = []
  for (const candidate of sorted) {
    if (remaining === 0) break
    const quantity = Math.min(remaining, candidate.quantity)
    allocations.push({ batchId: candidate.id, quantity })
    remaining -= quantity
  }
  if (remaining > 0) throw new Error(`砂芯库存不足，缺少 ${remaining}`)
  return allocations
}

export function allocateCoreBatchesWithOverdraft(requiredQuantity: number, candidates: TraceableCoreBatchCandidate[]) {
  const required = nonNegativeInteger(requiredQuantity, '砂芯需求数量')
  if (required === 0) return []

  const available = candidates.filter((candidate): candidate is CoreBatchCandidate =>
    (candidate.status === 'AVAILABLE' || candidate.status === 'WARNING')
      && Number.isInteger(candidate.quantity)
      && candidate.quantity > 0,
  )
  const availableTotal = available.reduce((sum, candidate) => sum + candidate.quantity, 0)
  const normallyAllocated = Math.min(required, availableTotal)
  const allocations = normallyAllocated > 0 ? allocateCoreBatches(normallyAllocated, available) : []
  const overdraft = required - normallyAllocated
  if (overdraft === 0) return allocations

  if (allocations.length) {
    const last = allocations[allocations.length - 1]
    return allocations.map((allocation, index) => index === allocations.length - 1
      ? { ...last, quantity: last.quantity + overdraft }
      : allocation)
  }

  const fallback = candidates
    .filter((candidate) => ['AVAILABLE', 'WARNING', 'CONSUMED'].includes(candidate.status))
    .sort((left, right) => {
      const producedOrder = compareTimestamp(right.producedAt, left.producedAt)
      return producedOrder || right.id.localeCompare(left.id)
    })[0]
  if (!fallback) throw new Error('未找到可追溯的砂芯来源批次')
  return [{ batchId: fallback.id, quantity: overdraft }]
}
