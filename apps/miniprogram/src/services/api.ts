import {
  MoldDevelopmentItem,
  HeatExecutionOptions,
  CoreExecutionOptions,
  CoreInventoryBatch,
  CoreReportResult,
  MobileCoreTaskDetail,
  MobileCoreTaskSummary,
  MobileHeatOrder,
  TodoItem,
  MobileMoldingTask,
  MoldingDefectOption,
  MobilePouringTask,
  MobilePouringOptions,
  MobilePouringCheck,
  MobilePouringReport,
  PouringDefectOption,
  MobileShakeCleanOptions,
  ShakeCleanCheck,
  ShakeCleanDefectOption,
  ShakeCleanListResponse,
  ShakeCleanReports,
  ShakeCleanTrace,
  InspectionTaskListResponse,
  InspectionTaskDetail,
  InspectionOptions,
  InspectionDefectOption,
  InspectionReportRecord,
  CleaningReworkTask,
} from '../types/business'
import { request } from '../utils/request'
import { uploadFile } from '../utils/request'

export interface LoginUser {
  id: string
  name: string
  phone?: string
  username?: string
  userType: string
  isSupplierEmployee?: boolean
  permissions?: string[]
}

export interface LoginResponse {
  token: string
  user: LoginUser
}

export interface HomeResponse {
  todos: TodoItem[]
  todoCount: number
  moldCount: number
}

export function login(data: { username: string; password: string }) {
  return request<LoginResponse>({
    url: '/auth/login',
    method: 'POST',
    data,
  })
}

export function getCurrentUser() {
  return request<LoginUser>({ url: '/auth/me' })
}

export function getMobileHome() {
  return request<HomeResponse>({ url: '/mobile/home' })
}

export function getTodos() {
  return request<TodoItem[]>({ url: '/mobile/todos' })
}

export function getMolds(keyword?: string) {
  const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
  return request<MoldDevelopmentItem[]>({ url: `/mobile/molds${query}` })
}

export function getMoldDetail(id: string) {
  return request<MoldDevelopmentItem>({ url: `/mobile/molds/${id}` })
}

export function confirmDrawing(id: string) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/confirm-drawing`,
    method: 'POST',
  })
}

export function submitShipping(
  id: string,
  data: { trackingNumber?: string; operator?: string; images?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/shipping`,
    method: 'POST',
    data,
  })
}

export function submitReceive(
  id: string,
  data: { operator?: string; images?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/receive`,
    method: 'POST',
    data,
  })
}

export function submitTrial(
  id: string,
  data: { operator?: string; images?: string[]; productImages?: string[]; destructiveImages?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/trial`,
    method: 'POST',
    data,
  })
}

export function submitBatch(
  id: string,
  data: { operator?: string; images?: string[]; productImages?: string[]; destructiveImages?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/batch`,
    method: 'POST',
    data,
  })
}

export function submitEvaluation(
  id: string,
  data: { result?: '通过' | '不通过'; isComplete?: boolean; reason?: string },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/evaluation`,
    method: 'POST',
    data,
  })
}

export function uploadImage(filePath: string) {
  return uploadFile<{ url: string }>({
    url: '/admin/uploads/images',
    filePath,
    name: 'file',
  })
}

export function getHeatOrders(status?: string) {
  return request<MobileHeatOrder[]>({ url: `/mini/production/heat-orders${status ? `?status=${status}` : ''}` })
}

export function getHeatOrderDetail(id: string) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}` })
}

export function getHeatExecutionOptions(id: string) {
  return request<HeatExecutionOptions>({ url: `/mini/production/heat-orders/${id}/execution-options` })
}

export function startHeatProduction(id: string, data: { versionNo: number; actualFurnaceCode: string; confirmFurnaceChange?: boolean }) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}/start`, method: 'POST', data })
}

export function transferHeatProduction(id: string, data: { versionNo: number; transferDeviceCode: string; weightKg: number; remark?: string }) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}/transfer`, method: 'POST', data })
}

export function completeHeatProduction(id: string, data: { versionNo: number; actualOutputWeightKg: number; remark?: string }) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}/complete`, method: 'POST', data })
}

export function getCoreTasks(status?: string) {
  return request<MobileCoreTaskSummary[]>({ url: `/mini/production/core-tasks${status ? `?status=${encodeURIComponent(status)}` : ''}` })
}

export function getCoreTaskDetail(id: string) {
  return request<MobileCoreTaskDetail>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}` })
}

export function getCoreExecutionOptions(id: string) {
  return request<CoreExecutionOptions>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/execution-options` })
}

export function startCoreTask(id: string, data: { versionNo: number }) {
  return request<MobileCoreTaskSummary>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/start`, method: 'POST', data })
}

export function reportCoreTask(id: string, data: {
  versionNo: number
  qualifiedQuantity: number
  scrapQuantity: number
  teamCode: string
  shiftCode: string
  sandBatchCode?: string
  dryingRequired: boolean
  defectReason?: string
  defects?: Array<{ defectCode: string; quantity: number; remark?: string }>
  remark?: string
}) {
  return request<CoreReportResult>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/report`, method: 'POST', data })
}

export function getCoreDryingBatches(id: string) {
  return request<CoreInventoryBatch[]>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/drying-batches` })
}

export function dryCoreBatch(id: string, data: { versionNo: number; equipmentCode: string }) {
  return request<CoreInventoryBatch>({ url: `/mini/production/core-batches/${encodeURIComponent(id)}/dry`, method: 'POST', data })
}

export function dryCoreBatches(data: { equipmentCode: string; batches: Array<{ id: string; versionNo: number }> }) {
  return request<CoreInventoryBatch[]>({ url: '/mini/production/core-batches/dry', method: 'POST', data })
}

export function getMoldingTasks(status?: string) {
  return request<MobileMoldingTask[]>({ url: `/mini/production/molding-tasks${status ? `?status=${encodeURIComponent(status)}` : ''}` })
}

export function getMoldingTaskDetail(id: string) {
  return request<MobileMoldingTask>({ url: `/mini/production/molding-tasks/${encodeURIComponent(id)}` })
}

export function getMoldingTaskByCode(code: string) {
  return request<MobileMoldingTask>({ url: `/mini/production/molding-tasks/by-code/${encodeURIComponent(code)}` })
}

export function getMoldingDefects(id: string) {
  return request<MoldingDefectOption[]>({ url: `/mini/production/molding-tasks/${encodeURIComponent(id)}/defect-options` })
}

export function startMoldingTask(id: string, versionNo: number) {
  return request<MobileMoldingTask>({ url: `/mini/production/molding-tasks/${encodeURIComponent(id)}/start`, method: 'POST', data: { versionNo } })
}

export function reportMoldingTask(id: string, data: {
  versionNo: number
  requestId: string
  goodQty: number
  scrapQty: number
  finishTask: boolean
  earlyCompletionReason?: string
  defects: Array<{ defectCode: string; quantity: number; remark?: string }>
  remark?: string
}) {
  return request<MobileMoldingTask>({ url: `/mini/production/molding-tasks/${encodeURIComponent(id)}/report`, method: 'POST', data })
}

export function getPouringTasks(status?: string) {
  return request<MobilePouringTask[]>({ url: `/mini/production/pouring-tasks${status ? `?status=${encodeURIComponent(status)}` : ''}` })
}

export function getPouringOptions(id: string) {
  return request<MobilePouringOptions>({ url: `/mini/production/pouring-tasks/${encodeURIComponent(id)}/options` })
}

export function getPouringReports(id: string) {
  return request<MobilePouringReport[]>({ url: `/mini/production/pouring-tasks/${encodeURIComponent(id)}/reports` })
}

export function getPouringDefects(id: string) {
  return request<PouringDefectOption[]>({ url: `/mini/production/pouring-tasks/${encodeURIComponent(id)}/defect-options` })
}

export interface PouringInput { moldingTaskId: string; heatOrderTransferId: string; stationEquipmentCode: string; goodQty: number; scrapQty: number; actualWeightKg?: number }

export function checkPouring(data: PouringInput) {
  return request<MobilePouringCheck>({ url: '/mini/production/pouring/check', method: 'POST', data })
}

export function reportPouring(data: PouringInput & { requestId: string; transferVersionNo: number; confirmedWarningCodes: string[]; defects: Array<{ defectCode: string; quantity: number; remark?: string }>; remark?: string }) {
  return request<MobilePouringReport>({ url: '/mini/production/pouring/reports', method: 'POST', data })
}

export function getShakeCleanTasks(params: { keyword?: string; status?: string; page?: number; pageSize?: number; cursor?: string }) {
  const query = Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')
  return request<ShakeCleanListResponse>({ url: `/mini/production/shake-clean-tasks${query ? `?${query}` : ''}` })
}
export function getShakeCleanOptions(id: string) { return request<MobileShakeCleanOptions>({ url: `/mini/production/shake-clean-tasks/${encodeURIComponent(id)}/options` }) }
export function getShakeCleanReports(id: string) { return request<ShakeCleanReports>({ url: `/mini/production/shake-clean-tasks/${encodeURIComponent(id)}/reports` }) }
export function getShakeCleanTrace(id: string) { return request<ShakeCleanTrace>({ url: `/mini/production/shake-clean-tasks/${encodeURIComponent(id)}/trace` }) }
export function getShakeCleanDefects(id: string) { return request<ShakeCleanDefectOption[]>({ url: `/mini/production/shake-clean-tasks/${encodeURIComponent(id)}/defect-options` }) }
export function checkShakeClean(data: { moldingTaskId: string; quantity: number }) { return request<ShakeCleanCheck>({ url: '/mini/production/shake-clean/shake/check', method: 'POST', data }) }
export interface ShakeCleanReportInput { moldingTaskId: string; requestId: string; stationEquipmentCode: string; goodQty: number; scrapQty: number; batchVersions: Array<{ id: string; versionNo: number }>; defects: Array<{ defectCode: string; quantity: number; remark?: string }>; remark?: string }
export function reportShakeClean(data: ShakeCleanReportInput & { confirmedEarlyShake: boolean }) { return request<Record<string, unknown>>({ url: '/mini/production/shake-clean/shake/reports', method: 'POST', data }) }
export function reportCleaning(data: ShakeCleanReportInput & { riseringScrapWeightKg?: number }) { return request<Record<string, unknown>>({ url: '/mini/production/shake-clean/cleaning/reports', method: 'POST', data }) }

export function getInspectionTasks(params: { keyword?: string; status?: string; page?: number; pageSize?: number }) {
  const query = Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== 'ALL').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')
  return request<InspectionTaskListResponse>({ url: `/mini/production/inspection-tasks${query ? `?${query}` : ''}` })
}
export function getInspectionTask(id: string) { return request<InspectionTaskDetail>({ url: `/mini/production/inspection-tasks/${encodeURIComponent(id)}` }) }
export function getInspectionOptions(id: string) { return request<InspectionOptions>({ url: `/mini/production/inspection-tasks/${encodeURIComponent(id)}/options` }) }
export function getInspectionDefects(id: string) { return request<InspectionDefectOption[]>({ url: `/mini/production/inspection-tasks/${encodeURIComponent(id)}/defect-options` }) }
export function reportFinalInspection(data: {
  workOrderId: string; requestId: string; goodQty: number; reworkQty: number; scrapQty: number; scrapWeightKg?: number
  batchVersions: Array<{ id: string; versionNo: number }>; defects: Array<{ defectCode: string; quantity: number; remark?: string }>; imageUrl?: string; remark?: string
}) { return request<InspectionReportRecord>({ url: '/mini/production/inspection/reports', method: 'POST', data }) }
export function getCleaningReworkTask(id: string) { return request<CleaningReworkTask>({ url: `/mini/production/cleaning-rework-tasks/${encodeURIComponent(id)}` }) }
export function reportCleaningRework(data: { taskId: string; requestId: string; goodQty: number; scrapQty: number; scrapWeightKg?: number; equipmentCode: string; versionNo: number; remark?: string }) {
  return request<Record<string, unknown>>({ url: '/mini/production/cleaning-rework/reports', method: 'POST', data })
}
