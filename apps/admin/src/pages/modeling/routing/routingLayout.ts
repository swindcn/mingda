import type { RouteType } from '../../../utils/processRoutings'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

export function defaultRouteType(section: string, pouringMergePoint?: boolean): RouteType {
  if (pouringMergePoint || section === '浇注') return 'MERGE_POINT'
  if (section === '熔炼') return 'MELT_BRANCH'
  if (section === '制芯') return 'CORE_BRANCH'
  if (section === '造型') return 'MOLD_MAIN'
  return 'AFTER_MERGE'
}

export function constrainCanvasPosition(position: { x: number; y: number }) {
  return {
    x: clamp(position.x, 24, 2180),
    y: clamp(position.y, 24, 434),
  }
}
