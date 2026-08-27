import { apiRequest } from '../services/api'

export type MoldingTaskStatus = 'PENDING' | 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED'
export type MoldingDisplayStatus = MoldingTaskStatus

export interface MoldingCoreRequirement {
  coreBoxCode: string
  coreBoxName: string
  quantityPerProduct: number
  quantityPerBox: number
  requiredQuantity: number
  remainingRequiredQuantity?: number
  coreTaskCompleted?: boolean
  available?: number
  shortage?: number
}

export interface MoldingReadiness {
  ready: boolean
  code: 'READY' | 'WAITING_CORE_TASK' | 'INSUFFICIENT_CORE'
  startable: boolean
  maxProducibleBoxQty: number | null
  blockedReason: string
  requirements: MoldingCoreRequirement[]
}

export interface MoldingReport {
  id: string
  reportCode: string
  goodQty: number
  scrapQty: number
  finishTask: boolean
  operatorName: string
  remark: string
  status: 'ACTIVE' | 'REVERSED'
  reportedAt: string
  reversedByName: string
  reversedAt: string
  reverseReason: string
  defects: Array<{ code: string; name: string; quantity: number; remark: string }>
  coreConsumptions: Array<{ batchId: string; batchCode: string; coreBoxCode: string; quantity: number; quantityBefore: number; quantityAfter: number }>
}

export interface MoldingTask {
  id: string
  code: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  bomCode: string
  bomVersion: string
  routingCode: string
  routingName: string
  routingVersion: string
  operationCode: string
  operationName: string
  routingNodeId: string
  moldCode: string
  moldName: string
  cavityCount: number
  productionLineCode: string
  productionLineName: string
  workshopCode: string
  workshopName: string
  teamCode: string
  teamName: string
  planPieceQty: number
  planBoxQty: number
  completedGoodQty: number
  completedScrapQty: number
  overproductionQty: number
  coreRequirements: MoldingCoreRequirement[]
  readiness: MoldingReadiness
  status: MoldingTaskStatus
  displayStatus: MoldingDisplayStatus
  completionType: '' | 'NORMAL' | 'SHORT'
  earlyCompletionReason: string
  plannedStartAt: string
  startedAt: string
  completedAt: string
  canceledAt: string
  cancelReason: string
  versionNo: number
  remark: string
  createdByName: string
  createdAt: string
  updatedAt: string
  allowedActions: { dispatch: boolean; start: boolean; report: boolean; cancel: boolean; reverse: boolean }
  startBlockedReason: string
  startWarning: string
  reports?: MoldingReport[]
}

export interface MoldingTaskPreview {
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  planPieceQty: number
  routingNodes: Array<{ id: string; seqNo: number; operationCode: string; operationName: string }>
  selectedRoutingNodeId: string
  molds: Array<{ code: string; name: string; cavityCount: number }>
  selectedMoldCode: string
  cavityCount: number | null
  planBoxQty: number | null
  coreRequirements: MoldingCoreRequirement[]
  existingTask: { id: string; code: string; status: string } | null
  productionLines: Array<{ code: string; name: string; workshopCode: string; workshopName: string }>
  teams: Array<{ code: string; name: string; workshopCode: string; workshopName: string }>
}

export interface MoldingDefectOption { code: string; name: string; category: string }

export const moldingStatusLabels: Record<MoldingDisplayStatus, string> = {
  PENDING: '待派工',
  DISPATCHED: '已派工',
  IN_PROGRESS: '生产中',
  COMPLETED: '已完工',
  CANCELED: '已取消',
}

export const moldingStatusColors: Record<MoldingDisplayStatus, string> = {
  PENDING: 'default', DISPATCHED: 'blue', IN_PROGRESS: 'processing', COMPLETED: 'green', CANCELED: 'default',
}

export function previewMoldingTask(workOrderId: string, data: { moldCode?: string; routingNodeId?: string } = {}) {
  return apiRequest<MoldingTaskPreview>(`/admin/production/work-orders/${encodeURIComponent(workOrderId)}/molding-task/preview`, {
    method: 'POST', body: JSON.stringify(data),
  })
}

export function createMoldingTask(workOrderId: string, data: { moldCode: string; routingNodeId?: string; productionLineCode: string; teamCode?: string; plannedStartAt?: string; remark?: string }) {
  return apiRequest<MoldingTask>(`/admin/production/work-orders/${encodeURIComponent(workOrderId)}/molding-task`, {
    method: 'POST', body: JSON.stringify(data),
  })
}

export function fetchMoldingTasks(params: { keyword?: string; status?: string; workOrderId?: string } = {}) {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.status && params.status !== 'ALL') query.set('status', params.status)
  if (params.workOrderId) query.set('workOrderId', params.workOrderId)
  return apiRequest<MoldingTask[]>(`/admin/production/molding-tasks${query.size ? `?${query}` : ''}`)
}

export function fetchMoldingTask(id: string) {
  return apiRequest<MoldingTask>(`/admin/production/molding-tasks/${encodeURIComponent(id)}`)
}

export function fetchMoldingDefects(id: string) {
  return apiRequest<MoldingDefectOption[]>(`/admin/production/molding-tasks/${encodeURIComponent(id)}/defect-options`)
}

export function dispatchMoldingTask(id: string, data: { versionNo: number; productionLineCode: string; teamCode?: string; plannedStartAt?: string }) {
  return apiRequest<MoldingTask>(`/admin/production/molding-tasks/${encodeURIComponent(id)}/dispatch`, { method: 'PUT', body: JSON.stringify(data) })
}

export function startMoldingTask(id: string, versionNo: number) {
  return apiRequest<MoldingTask>(`/admin/production/molding-tasks/${encodeURIComponent(id)}/start`, { method: 'POST', body: JSON.stringify({ versionNo }) })
}

export function reportMoldingTask(id: string, data: { versionNo: number; requestId: string; goodQty: number; scrapQty: number; finishTask: boolean; earlyCompletionReason?: string; defects: Array<{ defectCode: string; quantity: number; remark?: string }>; remark?: string }) {
  return apiRequest<MoldingTask>(`/admin/production/molding-tasks/${encodeURIComponent(id)}/report`, { method: 'POST', body: JSON.stringify(data) })
}

export function reverseMoldingReport(id: string, data: { versionNo: number; reason: string }) {
  return apiRequest<MoldingTask>(`/admin/production/molding-reports/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify(data) })
}

export function cancelMoldingTask(id: string, data: { versionNo: number; reason: string }) {
  return apiRequest<MoldingTask>(`/admin/production/molding-tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify(data) })
}
