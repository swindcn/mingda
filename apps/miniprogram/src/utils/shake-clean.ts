export function normalizeNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

export function normalizeNonNegativeWeight(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function validateReportQuantities(goodValue: unknown, scrapValue: unknown, remaining: number) {
  const good = normalizeNonNegativeInteger(goodValue)
  const scrap = normalizeNonNegativeInteger(scrapValue)
  if (good === null || scrap === null) return { ok: false as const, message: '合格数和废品数必须是非负整数' }
  if (!Number.isSafeInteger(remaining) || remaining < 0) return { ok: false as const, message: '剩余数量数据无效，请刷新后重试' }
  const total = good + scrap
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false as const, message: '本次报工数量必须大于 0' }
  if (total > remaining) return { ok: false as const, message: `本次报工数量不能超过剩余 ${remaining}` }
  return { ok: true as const, good, scrap, total }
}

export function mergeUniqueById<T extends { id: string }>(current: T[], next: T[]) {
  const seen = new Set(current.map((item) => item.id))
  const result = [...current]
  for (const item of next) if (!seen.has(item.id)) { seen.add(item.id); result.push(item) }
  return result
}

export function canExecuteAction(actions: { shakeReport: boolean; cleanReport: boolean }, action: 'shakeReport' | 'cleanReport') {
  return actions[action] === true
}

export function canSubmitReport(submitting: boolean, completed: boolean, allowed: boolean) {
  return !submitting && !completed && allowed
}

export function createShakeCleanLifecycle() {
  let unloaded = false
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    markUnloaded() { unloaded = true; if (timer) clearTimeout(timer); timer = undefined },
    isUnloaded() { return unloaded },
    canContinue() { return !unloaded },
    setTimer(callback: () => void, delay: number) { if (unloaded) return; if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = undefined; if (!unloaded) callback() }, delay) },
    clearTimer() { if (timer) clearTimeout(timer); timer = undefined },
  }
}
