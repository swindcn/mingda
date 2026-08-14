import { apiRequest } from '../services/api'

export type CoreTaskStatus = 'PENDING_DISPATCH' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED'
export type CoreBatchStatus = 'UNDRIED' | 'AVAILABLE' | 'WARNING' | 'EXPIRED' | 'LOCKED' | 'SCRAPPED' | 'CONSUMED'
export type CoreReadinessStatus = 'READY' | 'PARTIAL' | 'SHORTAGE'

export interface CoreTaskInput {
  coreBoxCode: string
  expectedScrapRate?: number
  routingNodeId?: string
  equipmentCode?: string
  teamCode?: string
  plannedStartAt?: string
  remark?: string
}

export interface CoreTaskPreviewRow {
  coreBoxCode: string
  coreBoxName: string
  moldCode: string
  moldName: string
  quantityPerProduct: number
  cavityCount: number
  shelfLifeHours: number | null
  expectedScrapRate: number
  plannedQuantity: number
  plannedPressCount: number
}

export interface CoreTaskRoutingNode {
  id: string
  seqNo: number
  operationCode: string
  operationName: string
  equipment: Array<{
    code: string
    name: string
    status: string
    workshopCode: string
    workshopName: string
  }>
}

export interface CoreTaskPreview {
  workOrderId: string
  workOrderCode: string
  requiresCoremaking: boolean
  canGenerateCoreTasks: boolean
  rows: CoreTaskPreviewRow[]
  routingNodes: CoreTaskRoutingNode[]
}

export interface CoreTaskRecord {
  id: string
  code: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  bomVersionId: string
  bomCode: string
  bomVersion: string
  routingNodeId: string
  routingCode: string
  routingVersion: string
  operationCode: string
  operationName: string
  coreBoxCode: string
  coreBoxName: string
  moldCode: string
  moldName: string
  quantityPerProduct: number
  cavityCount: number
  shelfLifeHours: number | null
  expectedScrapRate: number
  plannedQuantity: number
  plannedPressCount: number
  equipmentCode: string
  equipmentName: string
  teamCode: string
  teamName: string
  plannedStartAt: string
  qualifiedQuantity: number
  scrapQuantity: number
  status: CoreTaskStatus
  versionNo: number
  reportCount: number
  remark: string
  cancelReason: string
  startedAt: string
  completedAt: string
  canceledByName: string
  canceledAt: string
  createdByName: string
  createdAt: string
  updatedAt: string
  canDispatch: boolean
  canStart: boolean
  canReport: boolean
  canCancel: boolean
}

export interface CoreTaskCreatePayload {
  rows: CoreTaskInput[]
}

export interface CoreTaskDispatchPayload {
  versionNo: number
  equipmentCode: string
  teamCode: string
  plannedStartAt: string
  remark?: string
}

export interface CoreTaskCancelPayload {
  versionNo: number
  reason: string
}

export interface CoreTaskStartPayload {
  versionNo: number
}

export interface CoreTaskReportPayload {
  versionNo: number
  qualifiedQuantity: number
  scrapQuantity: number
  shiftCode: string
  sandBatchCode?: string
  dryingRequired: boolean
  defectReason?: string
  remark?: string
}

export interface CoreProductionReport {
  id: string
  taskId: string
  equipmentCode: string
  equipmentName: string
  teamCode: string
  teamName: string
  shiftCode: string
  operatorName: string
  sandBatchCode: string
  qualifiedQuantity: number
  scrapQuantity: number
  defectReason: string
  dryingRequired: boolean
  remark: string
  reportedAt: string
  createdAt: string
}

export interface CoreInventoryLedger {
  id: string
  action: string
  quantityChange: number
  quantityAfter: number
  operatorName: string
  reason: string
  createdAt: string
}

export interface CoreBatchRecord {
  id: string
  code: string
  qrContent: string
  reportId: string
  taskId: string
  taskCode: string
  workOrderId: string
  coreBoxCode: string
  coreBoxName: string
  productCode: string
  productName: string
  workOrderCode: string
  initialQuantity: number
  currentQuantity: number
  dryingRequired: boolean
  driedAt: string
  driedByName: string
  dryingEquipmentCode: string
  dryingEquipmentName: string
  shelfLifeHours: number | null
  shelfLifeStartedAt: string
  expiresAt: string
  status: CoreBatchStatus
  versionNo: number
  lockedByName: string
  lockedAt: string
  lockReason: string
  scrappedByName: string
  scrappedAt: string
  scrapReason: string
  createdAt: string
  updatedAt: string
  ledgers?: CoreInventoryLedger[]
}

export interface CoreTaskReportResult {
  task: CoreTaskRecord
  report: CoreProductionReport
  batch: CoreBatchRecord
}

export interface CoreReadinessRow {
  coreBoxCode: string
  coreBoxName: string
  quantityPerProduct: number
  requiredQuantity: number
  availableQuantity: number
  undriedQuantity: number
  shortageQuantity: number
  minRemainingHours: number | null
  readinessStatus: CoreReadinessStatus
}

export interface CoreReadiness {
  workOrderId: string
  workOrderCode: string
  rows: CoreReadinessRow[]
  totalRequiredQuantity: number
  totalAvailableQuantity: number
  totalUndriedQuantity: number
  totalShortageQuantity: number
  readinessRate: number
}

export interface CoreInventoryPage {
  items: CoreBatchRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface CoreBatchDryPayload {
  versionNo: number
  equipmentCode: string
}

export interface CoreBatchLockPayload {
  versionNo: number
  reason: string
}

export interface CoreBatchUnlockPayload {
  versionNo: number
}

export interface CoreBatchScrapPayload {
  versionNo: number
  reason: string
}

function encodeId(id: string) {
  return encodeURIComponent(id)
}

function queryPath(base: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  return `${base}${query.size ? `?${query}` : ''}`
}

function jsonRequest<T>(path: string, method: 'POST' | 'PUT', body: unknown) {
  return apiRequest<T>(path, { method, body: JSON.stringify(body) })
}

export function fetchCoreReadiness(workOrderId: string) {
  return apiRequest<CoreReadiness>(`/admin/production/work-orders/${encodeId(workOrderId)}/core-readiness`)
}

export function previewCoreTasks(workOrderId: string, payload: CoreTaskCreatePayload) {
  return jsonRequest<CoreTaskPreview>(`/admin/production/work-orders/${encodeId(workOrderId)}/core-tasks/preview`, 'POST', payload)
}

export function createCoreTasks(workOrderId: string, payload: CoreTaskCreatePayload) {
  return jsonRequest<CoreTaskRecord[]>(`/admin/production/work-orders/${encodeId(workOrderId)}/core-tasks`, 'POST', payload)
}

export function fetchCoreTasks(params: { keyword?: string; status?: CoreTaskStatus | 'ALL'; workOrderId?: string } = {}) {
  return apiRequest<CoreTaskRecord[]>(queryPath('/admin/production/core-tasks', params))
}

export function fetchCoreTask(id: string) {
  return apiRequest<CoreTaskRecord>(`/admin/production/core-tasks/${encodeId(id)}`)
}

export function dispatchCoreTask(id: string, payload: CoreTaskDispatchPayload) {
  return jsonRequest<CoreTaskRecord>(`/admin/production/core-tasks/${encodeId(id)}/dispatch`, 'PUT', payload)
}

export function cancelCoreTask(id: string, payload: CoreTaskCancelPayload) {
  return jsonRequest<CoreTaskRecord>(`/admin/production/core-tasks/${encodeId(id)}/cancel`, 'POST', payload)
}

export function startCoreTask(id: string, payload: CoreTaskStartPayload) {
  return jsonRequest<CoreTaskRecord>(`/admin/production/core-tasks/${encodeId(id)}/start`, 'POST', payload)
}

export function reportCoreTask(id: string, payload: CoreTaskReportPayload) {
  return jsonRequest<CoreTaskReportResult>(`/admin/production/core-tasks/${encodeId(id)}/report`, 'POST', payload)
}

export function fetchCoreInventory(params: { page?: number; pageSize?: number; status?: CoreBatchStatus | 'ALL'; keyword?: string } = {}) {
  return apiRequest<CoreInventoryPage>(queryPath('/admin/production/core-inventory', params))
}

export function fetchCoreInventoryBatch(id: string) {
  return apiRequest<CoreBatchRecord>(`/admin/production/core-inventory/${encodeId(id)}`)
}

export function dryCoreBatch(id: string, payload: CoreBatchDryPayload) {
  return jsonRequest<CoreBatchRecord>(`/admin/production/core-batches/${encodeId(id)}/dry`, 'POST', payload)
}

export function lockCoreBatch(id: string, payload: CoreBatchLockPayload) {
  return jsonRequest<CoreBatchRecord>(`/admin/production/core-batches/${encodeId(id)}/lock`, 'POST', payload)
}

export function unlockCoreBatch(id: string, payload: CoreBatchUnlockPayload) {
  return jsonRequest<CoreBatchRecord>(`/admin/production/core-batches/${encodeId(id)}/unlock`, 'POST', payload)
}

export function scrapCoreBatch(id: string, payload: CoreBatchScrapPayload) {
  return jsonRequest<CoreBatchRecord>(`/admin/production/core-batches/${encodeId(id)}/scrap`, 'POST', payload)
}
