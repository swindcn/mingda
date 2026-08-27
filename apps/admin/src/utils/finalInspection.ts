import { apiRequest } from '../services/api'

export type InspectionStatus = 'WAITING' | 'INSPECTING' | 'REWORKING' | 'COMPLETED'

export interface InspectionTaskRow {
  id: string
  code: string
  productCode: string
  productName: string
  materialGradeName: string
  originalQuantity: number
  remainingQuantity: number
  openReworkQuantity: number
  qualifiedQuantity: number
  status: InspectionStatus
  updatedAt: string
  allowedActions: { report: boolean; reverse: boolean }
}

export interface InspectionTaskPage { records: InspectionTaskRow[]; total: number; page: number; pageSize: number }
export interface InspectionBatchVersion { id: string; versionNo: number; remainingQuantity: number; availableAt: string }
export interface InspectionOptions {
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  remainingQuantity: number
  openReworkQuantity: number
  unitNetWeightKg: number
  batchVersions: InspectionBatchVersion[]
  allowedActions: { report: boolean; reverse: boolean }
}
export interface DefectOption { id: string; code: string; name: string; category: string }
export interface InspectionReport {
  id: string; code: string; goodQty: number; reworkQty: number; scrapQty: number; scrapWeightKg: number
  operatorNameSnapshot: string; reportedAt: string; status: 'ACTIVE' | 'REVERSED'; versionNo: number
  reverseReason?: string | null; image?: { imageUrl: string } | null
  defects: Array<{ id: string; defectCodeSnapshot: string; defectNameSnapshot: string; quantity: number }>
  blankWarehouseReceipt?: { code: string; quantity: number } | null
  reworkTask?: ReworkTask | null
}
export interface ReworkTask {
  id: string; code: string; workOrderId: string; productCodeSnapshot: string; productNameSnapshot: string
  originalQuantity: number; remainingQuantity: number; status: string; versionNo: number; operationNameSnapshot: string
  reports?: Array<{ id: string; code: string; goodQty: number; scrapQty: number; equipmentNameSnapshot: string; operatorNameSnapshot: string; reportedAt: string }>
  equipment?: Array<{ code: string; name: string; equipmentType: string }>
  allowedActions?: { report: boolean }
}
export interface InspectionTaskDetail {
  id: string; code: string; productCodeSnapshot: string; productNameSnapshot: string; materialGradeNameSnapshot: string
  plannedQuantity: number; completedQuantity: number; productionStatus: string; unitNetWeightKg: number
  inspectionReports: InspectionReport[]; cleaningReworkTasks: ReworkTask[]; options: InspectionOptions
}

export const inspectionStatusLabels: Record<InspectionStatus, string> = { WAITING: '待检验', INSPECTING: '检验中', REWORKING: '返修中', COMPLETED: '已完成' }
export const inspectionStatusColors: Record<InspectionStatus, string> = { WAITING: 'orange', INSPECTING: 'processing', REWORKING: 'gold', COMPLETED: 'green' }

export function fetchInspectionTasks(params: { page?: number; pageSize?: number; keyword?: string; status?: string; workOrderId?: string }) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value && value !== 'ALL') query.set(key, String(value)) })
  return apiRequest<InspectionTaskPage>(`/admin/production/inspection-tasks${query.size ? `?${query}` : ''}`)
}
export const fetchInspectionTask = (id: string) => apiRequest<InspectionTaskDetail>(`/admin/production/inspection-tasks/${encodeURIComponent(id)}`)
export const fetchInspectionOptions = (id: string) => apiRequest<InspectionOptions>(`/admin/production/inspection-tasks/${encodeURIComponent(id)}/options`)
export const fetchInspectionDefects = (id: string) => apiRequest<DefectOption[]>(`/admin/production/inspection-tasks/${encodeURIComponent(id)}/defect-options`)
export function reportInspection(data: Record<string, unknown>) { return apiRequest<InspectionReport>('/admin/production/inspection/reports', { method: 'POST', body: JSON.stringify(data) }) }
export function reverseInspection(id: string, versionNo: number, reason: string) { return apiRequest<InspectionReport>(`/admin/production/inspection-reports/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ versionNo, reason }) }) }
export const fetchReworkTask = (id: string) => apiRequest<ReworkTask>(`/admin/production/cleaning-rework-tasks/${encodeURIComponent(id)}`)
export function reportRework(data: Record<string, unknown>) { return apiRequest('/admin/production/cleaning-rework/reports', { method: 'POST', body: JSON.stringify(data) }) }
