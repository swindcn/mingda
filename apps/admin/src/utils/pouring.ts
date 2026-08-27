import { apiRequest } from '../services/api'

export type PouringExecutionStatus = 'WAITING' | 'PARTIAL' | 'WAITING_MOLDING' | 'COMPLETED'
export type PouringHoldLevel = 'NORMAL' | 'WARNING' | 'CRITICAL'

export interface PouringTask {
  moldingTaskId: string
  moldingTaskCode: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  moldName: string
  pouringRoutingNodeId: string
  pouringOperationName: string
  moldedQuantity: number
  pouredQuantity: number
  remainingQuantity: number
  earliestClosingTime: string | null
  holdMinutes: number
  holdLevel: PouringHoldLevel
  moldingTaskStatus: string
  executionStatus: PouringExecutionStatus
}

export interface PouringOptions {
  moldingTaskId: string
  moldingTaskCode: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  materialGradeCode: string
  materialGradeName: string
  remainingQuantity: number
  earliestClosingTime: string | null
  holdMinutes: number
  stations: Array<{ code: string; name: string; equipmentType: string }>
  transfers: Array<{ id: string; versionNo: number; heatOrderId: string; heatOrderCode: string; transferDeviceCode: string; transferDeviceName: string; equipmentType: string; materialGradeCode: string; materialGradeName: string; transferWeightKg: number; balanceKg: number; createdAt: string }>
}

export interface PouringCheck {
  moldingTaskId: string
  heatOrderTransferId: string
  transferVersionNo: number
  pendingQuantity: number
  theoreticalWeightKg: number
  actualWeightKg: number
  transferBalanceBeforeKg: number
  transferBalanceAfterKg: number
  overdrawWeightKg: number
  holdMinutes: number
  holdLevel: PouringHoldLevel
  warningCodes: string[]
}

export interface PouringReport {
  id: string
  code: string
  heatOrderCodeSnapshot: string
  transferDeviceNameSnapshot: string
  stationEquipmentNameSnapshot: string
  goodQty: number
  scrapQty: number
  theoreticalWeightKg: number
  actualWeightKg: number
  transferBalanceBeforeKg: number
  transferBalanceAfterKg: number
  overdrawWeightKg: number
  holdMinutesSnapshot: number
  holdLevelSnapshot: PouringHoldLevel
  warningCodes: string[]
  operatorNameSnapshot: string
  remark: string
  status: 'ACTIVE' | 'REVERSED'
  reportedAt: string
  reverseReason: string
  transferVersionNo: number
  defects: Array<{ id: string; defectCodeSnapshot: string; defectNameSnapshot: string; quantity: number; remark: string }>
}

export interface PouringDefectOption { code: string; name: string; category: string }
export interface PouringInput { moldingTaskId: string; heatOrderTransferId: string; stationEquipmentCode: string; goodQty: number; scrapQty: number; actualWeightKg?: number }

export const pouringStatusLabels: Record<PouringExecutionStatus, string> = { WAITING: '待浇注', PARTIAL: '浇注中', WAITING_MOLDING: '等待后续造型', COMPLETED: '已完成' }
export const pouringStatusColors: Record<PouringExecutionStatus, string> = { WAITING: 'orange', PARTIAL: 'processing', WAITING_MOLDING: 'default', COMPLETED: 'green' }
export const holdLabels: Record<PouringHoldLevel, string> = { NORMAL: '正常', WARNING: '优先浇注', CRITICAL: '严重超时' }
export const holdColors: Record<PouringHoldLevel, string> = { NORMAL: 'green', WARNING: 'gold', CRITICAL: 'red' }

export function fetchPouringTasks(params: { keyword?: string; status?: string; workOrderId?: string } = {}) {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.status && params.status !== 'ALL') query.set('status', params.status)
  if (params.workOrderId) query.set('workOrderId', params.workOrderId)
  return apiRequest<PouringTask[]>(`/admin/production/pouring-tasks${query.size ? `?${query}` : ''}`)
}
export function fetchPouringOptions(id: string) { return apiRequest<PouringOptions>(`/admin/production/pouring-tasks/${encodeURIComponent(id)}/options`) }
export function fetchPouringReports(id: string) { return apiRequest<PouringReport[]>(`/admin/production/pouring-tasks/${encodeURIComponent(id)}/reports`) }
export function fetchPouringDefects(id: string) { return apiRequest<PouringDefectOption[]>(`/admin/production/pouring-tasks/${encodeURIComponent(id)}/defect-options`) }
export function checkPouring(data: PouringInput) { return apiRequest<PouringCheck>('/admin/production/pouring/check', { method: 'POST', body: JSON.stringify(data) }) }
export function reportPouring(data: PouringInput & { requestId: string; transferVersionNo: number; confirmedWarningCodes: string[]; defects: Array<{ defectCode: string; quantity: number; remark?: string }>; remark?: string }) { return apiRequest<PouringReport>('/admin/production/pouring/reports', { method: 'POST', body: JSON.stringify(data) }) }
export function reversePouringReport(id: string, transferVersionNo: number, reason: string) { return apiRequest<PouringReport>(`/admin/production/pouring-reports/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ transferVersionNo, reason }) }) }
