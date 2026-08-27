import { apiRequest } from '../services/api'
import type { LatestRequestGate, LatestRequestHandlers } from './latestRequest'

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
  teams: CoreOption[]
}

export interface CoreOption {
  code: string
  name: string
  status?: string
  workshopCode?: string
  workshopName?: string
  equipmentType?: string
}

export interface CoreTaskOptions {
  equipment: CoreOption[]
  teams: CoreOption[]
  shifts: CoreOption[]
  dryingEquipment: CoreOption[]
}

export interface CoreInventoryOptions {
  dryingEquipment: CoreOption[]
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
  reports?: CoreProductionReport[]
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
  batch: null | {
    id: string
    code: string
    status: CoreBatchStatus
    versionNo: number
    dryingRequired: boolean
  }
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
  reportedAt: string
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
  consumedQuantity: number
  remainingRequiredQuantity: number
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
  totalConsumedQuantity: number
  totalCoveredQuantity: number
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

export type CoreTaskGenerationRow = CoreTaskPreviewRow & CoreTaskInput

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

export function calculateCorePlan(workOrderQuantity: number, quantityPerProduct: number, expectedScrapRate: number, cavityCount: number) {
  if (!Number.isInteger(workOrderQuantity) || workOrderQuantity <= 0) throw new Error('工单计划数量必须为正整数')
  if (!Number.isFinite(quantityPerProduct) || quantityPerProduct <= 0) throw new Error('芯件比必须大于 0')
  if (!Number.isFinite(expectedScrapRate) || expectedScrapRate < 0) throw new Error('预计废品率不能小于 0')
  if (!Number.isInteger(cavityCount) || cavityCount <= 0) throw new Error('芯盒穴数必须为正整数')
  const scale = 10_000n
  const ratio = BigInt(Math.round(quantityPerProduct * Number(scale)))
  const scrapRate = BigInt(Math.round(expectedScrapRate * Number(scale)))
  const numerator = BigInt(workOrderQuantity) * ratio * (scale + scrapRate)
  const plannedQuantity = Number((numerator + scale * scale - 1n) / (scale * scale))
  return { plannedQuantity, plannedPressCount: Math.ceil(plannedQuantity / cavityCount) }
}

export function buildCoreTaskGenerationRows(preview: Pick<CoreTaskPreview, 'rows' | 'routingNodes'>): CoreTaskGenerationRow[] {
  const routingNodeId = preview.routingNodes.length === 1 ? preview.routingNodes[0].id : undefined
  return preview.rows.map((row) => ({
    ...row,
    routingNodeId,
    equipmentCode: undefined,
    teamCode: undefined,
    plannedStartAt: undefined,
    remark: '',
  }))
}

export function changeCoreTaskRoutingNode(row: CoreTaskGenerationRow, routingNodeId: string): CoreTaskGenerationRow {
  return {
    ...row,
    routingNodeId,
    equipmentCode: undefined,
    teamCode: undefined,
    plannedStartAt: undefined,
  }
}

export function validateCoreTaskGenerationRows(rows: CoreTaskGenerationRow[]) {
  return rows.reduce<Record<string, string>>((errors, row) => {
    if (!row.routingNodeId) errors[row.coreBoxCode] = '请选择制芯工序'
    else if ((row.equipmentCode || row.teamCode || row.plannedStartAt) && !(row.equipmentCode && row.teamCode && row.plannedStartAt)) {
      errors[row.coreBoxCode] = '设备、班组和计划时间需要完整填写'
    }
    return errors
  }, {})
}

export function resolveCoreInventoryPage(requestedPage: number, itemCount: number, totalPages: number) {
  const lastPage = Math.max(1, totalPages)
  if (requestedPage > lastPage) return lastPage
  if (itemCount === 0 && requestedPage > 1) return lastPage
  return requestedPage
}

export function resolveCoreTaskEntry(
  workOrder: { requiresCoremaking?: boolean; canGenerateCoreTasks?: boolean; coreTaskCount?: number },
  canCreate: boolean,
  canView: boolean,
) {
  if (!workOrder.requiresCoremaking) return 'NOT_REQUIRED' as const
  if (workOrder.canGenerateCoreTasks && canCreate) return 'GENERATE' as const
  if ((workOrder.coreTaskCount || 0) > 0 && canView) return 'VIEW' as const
  return 'NONE' as const
}

export function remainingCoreHours(expiresAt: string, now = new Date()) {
  if (!expiresAt) return null
  const expiration = new Date(expiresAt).getTime()
  if (!Number.isFinite(expiration)) return null
  return Number(Math.max((expiration - now.getTime()) / 3_600_000, 0).toFixed(1))
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

export function fetchCoreTaskOptions(id: string) {
  return apiRequest<CoreTaskOptions>(`/admin/production/core-tasks/${encodeId(id)}/options`)
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

export function loadLatestCoreBatchLabel(
  gate: LatestRequestGate,
  id: string,
  handlers: LatestRequestHandlers<CoreBatchRecord>,
  request: (batchId: string) => Promise<CoreBatchRecord> = fetchCoreInventoryBatch,
) {
  return gate.run(() => request(id), handlers)
}

export function fetchCoreInventoryOptions() {
  return apiRequest<CoreInventoryOptions>('/admin/production/core-inventory/options')
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
