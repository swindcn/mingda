export interface ShakeCleanQueueCandidate {
  id: string
  remainingQuantity: number
  availableAt: Date | string
}

export interface ShakeCleanQueueAllocation {
  batchId: string
  quantity: number
}

export interface CoolingState {
  requiredMinutes: number
  actualMinutes: number
  remainingMinutes: number
  early: boolean
}

const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/

function nonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}必须为非负整数`)
  return value
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}必须为正整数`)
  return value
}

function timestamp(value: Date | string, label: string) {
  if (value instanceof Date) {
    const result = value.getTime()
    if (Number.isNaN(result)) throw new Error(`${label}无效`)
    return result
  }

  const match = ISO_DATE_TIME_PATTERN.exec(value)
  if (!match) throw new Error(`${label}无效`)
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
  ) throw new Error(`${label}无效`)

  const result = Date.parse(value)
  if (Number.isNaN(result)) throw new Error(`${label}无效`)
  return result
}

export function calculateShakePieces(goodBoxes: number, cavityCount: number): number {
  const boxes = nonNegativeInteger(goodBoxes, '合格箱数')
  const cavities = nonNegativeInteger(cavityCount, '型腔数')
  const pieces = boxes * cavities
  if (!Number.isSafeInteger(pieces)) throw new Error('落砂件数超出安全整数范围')
  return pieces
}

export function calculateCoolingState(
  pouredAt: Date | string,
  checkedAt: Date | string,
  requiredMinutes: number,
): CoolingState {
  const pouredTimestamp = timestamp(pouredAt, '浇注时间')
  const checkedTimestamp = timestamp(checkedAt, '检查时间')
  const required = nonNegativeInteger(requiredMinutes, '冷却分钟')
  if (checkedTimestamp < pouredTimestamp) throw new Error('检查时间不能早于浇注时间')

  const actualMinutes = Math.floor((checkedTimestamp - pouredTimestamp) / 60_000)
  const remainingMinutes = Math.max(0, required - actualMinutes)
  return {
    requiredMinutes: required,
    actualMinutes,
    remainingMinutes,
    early: remainingMinutes > 0,
  }
}

export function allocateQueueBatches(
  quantity: number,
  candidates: ShakeCleanQueueCandidate[],
): ShakeCleanQueueAllocation[] {
  const required = positiveInteger(quantity, '分配数量')
  const sorted = candidates
    .map((candidate) => ({
      ...candidate,
      remainingQuantity: nonNegativeInteger(candidate.remainingQuantity, '待处理数量'),
      availableTimestamp: timestamp(candidate.availableAt, '可处理时间'),
    }))
    .sort((left, right) => left.availableTimestamp - right.availableTimestamp || left.id.localeCompare(right.id))

  let remaining = required
  const allocations: ShakeCleanQueueAllocation[] = []
  for (const candidate of sorted) {
    if (remaining === 0) break
    const allocated = Math.min(remaining, candidate.remainingQuantity)
    if (allocated === 0) continue
    allocations.push({ batchId: candidate.id, quantity: allocated })
    remaining -= allocated
  }

  if (remaining > 0) throw new Error(`待处理数量不足，缺少 ${remaining}`)
  return allocations
}
