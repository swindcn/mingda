export const HEAT_DRAG_THRESHOLD_PX = 5
export const HEAT_SNAP_MINUTES = 15
export const DAY_MINUTES = 24 * 60

export function snapMinutesToQuarter(minutes: number) {
  const snapped = Math.round(minutes / HEAT_SNAP_MINUTES) * HEAT_SNAP_MINUTES
  return Math.min(DAY_MINUTES - HEAT_SNAP_MINUTES, Math.max(0, snapped))
}

export function minutesFromTrackX(clientX: number, trackLeft: number, trackWidth: number) {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0
  return snapMinutesToQuarter((clientX - trackLeft) / trackWidth * DAY_MINUTES)
}

export function scheduleStartAt(windowStart: string, minutes: number) {
  return new Date(new Date(windowStart).getTime() + snapMinutesToQuarter(minutes) * 60_000).toISOString()
}

export function finishAtPreservingDuration(nextStartAt: string, currentStartAt: string, currentFinishAt: string) {
  const duration = new Date(currentFinishAt).getTime() - new Date(currentStartAt).getTime()
  return new Date(new Date(nextStartAt).getTime() + duration).toISOString()
}

export function isDragMovement(startX: number, startY: number, currentX: number, currentY: number) {
  return Math.hypot(currentX - startX, currentY - startY) > HEAT_DRAG_THRESHOLD_PX
}
