export interface LatestRequestHandlers<T> {
  success: (value: T) => void
  error?: (reason: unknown) => void
  settled?: () => void
}

export function createLatestRequestGate() {
  let sequence = 0

  return {
    async run<T>(request: () => Promise<T>, handlers: LatestRequestHandlers<T>) {
      const requestSequence = ++sequence
      try {
        const value = await request()
        if (requestSequence !== sequence) return false
        handlers.success(value)
        return true
      } catch (reason) {
        if (requestSequence !== sequence) return false
        handlers.error?.(reason)
        return false
      } finally {
        if (requestSequence === sequence) handlers.settled?.()
      }
    },
    invalidate() {
      sequence += 1
    },
  }
}
