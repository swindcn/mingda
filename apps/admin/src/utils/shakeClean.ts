import { apiRequest } from '../services/api'

export type ShakeCleanExecutionStatus =
  | 'WAITING_SHAKE'
  | 'SHAKING'
  | 'WAITING_CLEANING'
  | 'CLEANING'
  | 'WAITING_POURING'
  | 'COMPLETED'

export interface ShakeCleanAllowedActions {
  shakeReport: boolean
  cleanReport: boolean
  reverse: boolean
}

export interface ShakeCleanTask {
  id: string
  code: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  operationName: string
  earliestPouredAt: string | null
  shakeOriginal: number
  shakeRemaining: number
  cleaningOriginal: number
  cleaningRemaining: number
  blankOutputQuantity: number
  upstreamComplete: boolean
  executionStatus: ShakeCleanExecutionStatus
  allowedActions: ShakeCleanAllowedActions
  cooling: {
    earlyShake: boolean
    remainingCoolingMinutes: number
    requiredCoolingMinutes: number
    actualCoolingMinutes: number
  } | null
}

export interface ShakeCleanTaskPage {
  records: ShakeCleanTask[]
  total: number
  page: number
  pageSize: number
}

export interface ShakeCleanBatchVersion {
  id: string
  versionNo: number
  remainingQuantity: number
  pouredAt?: string
  availableAt?: string
}

export interface CoolingCheck {
  code: 'READY' | 'EARLY_SHAKE'
  earlyShake: boolean
  requiredCoolingMinutes: number
  actualCoolingMinutes: number
  remainingCoolingMinutes: number
  allocations: Array<{
    batchId: string
    quantity: number
    requiredMinutes: number
    actualMinutes: number
    remainingMinutes: number
    early: boolean
  }>
}

export interface ShakeCleanEquipmentOption {
  code: string
  name: string
  equipmentType: string
}

export interface ShakeCleanOptions extends Omit<ShakeCleanTask, 'id' | 'code' | 'operationName' | 'earliestPouredAt' | 'blankOutputQuantity'> {
  moldingTaskId: string
  moldingTaskCode: string
  cooling: CoolingCheck | null
  shakeBatchVersions: ShakeCleanBatchVersion[]
  cleaningBatchVersions: ShakeCleanBatchVersion[]
  shakeEquipment: ShakeCleanEquipmentOption[]
  cleaningEquipment: ShakeCleanEquipmentOption[]
}

export interface ShakeCleanDefectOption {
  id: string
  code: string
  name: string
  category: string
}

export interface ShakeCleanDefect {
  id: string
  defectCodeSnapshot: string
  defectNameSnapshot: string
  quantity: number
  remark?: string | null
}

export interface ShakeReport {
  id: string
  code: string
  goodQty: number
  scrapQty: number
  requiredCoolingMinutesSnapshot: number
  actualCoolingMinutesSnapshot: number
  earlyShake: boolean
  stationEquipmentNameSnapshot: string
  operatorNameSnapshot: string
  reportedAt: string
  remark?: string | null
  status: 'ACTIVE' | 'REVERSED'
  reverseReason?: string | null
  versionNo: number
  defects: ShakeCleanDefect[]
}

export interface CleaningReport {
  id: string
  code: string
  goodQty: number
  scrapQty: number
  riseringScrapWeightKg: number
  stationEquipmentNameSnapshot: string
  operatorNameSnapshot: string
  reportedAt: string
  remark?: string | null
  status: 'ACTIVE' | 'REVERSED'
  reverseReason?: string | null
  versionNo: number
  defects: ShakeCleanDefect[]
}

export interface ShakeCleanReports {
  shakeReports: ShakeReport[]
  cleaningReports: CleaningReport[]
}

export interface ShakeCleanTrace {
  shakeBatches: Array<Record<string, unknown> & { id: string; originalQuantity: number; remainingQuantity: number; pouredAt: string; status: string }>
  cleaningBatches: Array<Record<string, unknown> & { id: string; originalQuantity: number; remainingQuantity: number; availableAt: string; status: string }>
  blankOutputBatches: Array<Record<string, unknown> & { id: string; code: string; quantity: number; status: string; nextOperationNameSnapshot?: string | null; createdAt: string }>
}

export interface ShakeCleanDefectInput {
  defectCode: string
  quantity: number
  remark?: string
}

export const shakeCleanStatusLabels: Record<ShakeCleanExecutionStatus, string> = {
  WAITING_SHAKE: '待落砂',
  SHAKING: '落砂中',
  WAITING_CLEANING: '待清理',
  CLEANING: '清理中',
  WAITING_POURING: '等待后续浇注',
  COMPLETED: '已完成',
}

export const shakeCleanStatusColors: Record<ShakeCleanExecutionStatus, string> = {
  WAITING_SHAKE: 'orange',
  SHAKING: 'processing',
  WAITING_CLEANING: 'gold',
  CLEANING: 'cyan',
  WAITING_POURING: 'default',
  COMPLETED: 'green',
}

export function fetchShakeCleanTasks(params: { page?: number; pageSize?: number; keyword?: string; status?: string; workOrderId?: string } = {}) {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.status && params.status !== 'ALL') query.set('status', params.status)
  if (params.workOrderId) query.set('workOrderId', params.workOrderId)
  return apiRequest<ShakeCleanTaskPage>(`/admin/production/shake-clean-tasks${query.size ? `?${query}` : ''}`)
}

export function normalizeShakeCleanDefects(scrapQty: number, defects: ShakeCleanDefectInput[] | null | undefined) {
  return scrapQty > 0 ? (defects || []) : []
}

const taskPath = (id: string, suffix: string) => `/admin/production/shake-clean-tasks/${encodeURIComponent(id)}/${suffix}`

export function fetchShakeCleanOptions(id: string) { return apiRequest<ShakeCleanOptions>(taskPath(id, 'options')) }
export function fetchShakeCleanReports(id: string) { return apiRequest<ShakeCleanReports>(taskPath(id, 'reports')) }
export function fetchShakeCleanTrace(id: string) { return apiRequest<ShakeCleanTrace>(taskPath(id, 'trace')) }
export function fetchShakeCleanDefects(id: string) { return apiRequest<ShakeCleanDefectOption[]>(taskPath(id, 'defect-options')) }
export function checkShake(data: { moldingTaskId: string; quantity: number }) {
  return apiRequest<CoolingCheck>('/admin/production/shake-clean/shake/check', { method: 'POST', body: JSON.stringify(data) })
}
export function reportShake(data: {
  moldingTaskId: string
  requestId: string
  stationEquipmentCode: string
  goodQty: number
  scrapQty: number
  batchVersions: Array<{ id: string; versionNo: number }>
  confirmedEarlyShake: boolean
  defects: ShakeCleanDefectInput[]
  remark?: string
}) {
  return apiRequest<ShakeReport>('/admin/production/shake-clean/shake/reports', { method: 'POST', body: JSON.stringify(data) })
}
export function reportCleaning(data: {
  moldingTaskId: string
  requestId: string
  stationEquipmentCode: string
  goodQty: number
  scrapQty: number
  riseringScrapWeightKg?: number
  batchVersions: Array<{ id: string; versionNo: number }>
  defects: ShakeCleanDefectInput[]
  remark?: string
}) {
  return apiRequest<CleaningReport>('/admin/production/shake-clean/cleaning/reports', { method: 'POST', body: JSON.stringify(data) })
}
export function reverseShakeReport(id: string, versionNo: number, reason: string) {
  return apiRequest<ShakeReport>(`/admin/production/shake-clean/shake-reports/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ versionNo, reason }) })
}
export function reverseCleaningReport(id: string, versionNo: number, reason: string) {
  return apiRequest<CleaningReport>(`/admin/production/shake-clean/cleaning-reports/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ versionNo, reason }) })
}
