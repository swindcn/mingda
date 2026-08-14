export function createLatestRequestGate() {
  let requestId = 0

  return {
    next() {
      requestId += 1
      return requestId
    },
    isCurrent(candidate: number) {
      return candidate === requestId
    },
  }
}
