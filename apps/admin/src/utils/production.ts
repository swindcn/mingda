import { apiRequest } from '../services/api'

export type WorkOrderScheduleStatus = 'PENDING' | 'PARTIAL' | 'FULL'
export type WorkOrderProductionStatus = 'RELEASED' | 'IN_PRODUCTION' | 'MELT_COMPLETED' | 'COMPLETED' | 'CLOSED'
export type HeatOrderStatus = 'WAITING' | 'IN_PROGRESS' | 'TRANSFERRING' | 'COMPLETED' | 'CANCELED'

export interface RoutingNodePreview {
  id: string
  seqNo: number
  operationCode: string
  operationName: string
  standardCycleSeconds?: number
  equipment: Array<{ code: string; name: string }>
}

export interface WorkOrderRecord {
  id: string
  code: string
  productCode: string
  productName: string
  bomVersionId: string
  bomCode: string
  bomVersion: string
  routingVersionId: string
  routingCode: string
  routingName: string
  routingVersion: string
  materialGradeCode: string
  materialGradeName: string
  plannedQuantity: number
  plannedStartDate: string
  plannedDeliveryDate: string
  priority: string
  unitNetWeightKg: number
  unitGrossWeightKg: number
  yieldRate: number
  unitReturnWeightKg: number
  totalNetWeightKg: number
  totalMeltWeightKg: number
  expectedReturnWeightKg: number
  scheduledQuantity: number
  meltCompletedQuantity: number
  meltCompletedWeightKg: number
  completedQuantity: number
  remainingQuantity: number
  remainingWeightKg: number
  scheduleStatus: WorkOrderScheduleStatus
  productionStatus: WorkOrderProductionStatus
  displayStatus: string
  versionNo: number
  remark: string
  createdByName: string
  createdAt: string
  updatedAt: string
  canEdit: boolean
  requiresCoremaking: boolean
  canGenerateCoreTasks: boolean
  coreTaskCount: number
  coreTaskSummary: {
    total: number
    pendingDispatch: number
    waiting: number
    inProgress: number
    completed: number
    canceled: number
  }
  routingNodes: RoutingNodePreview[]
  heatOrders: Array<{ allocationId: string; heatOrderId: string; heatOrderCode: string; status: HeatOrderStatus; allocatedQuantity: number; plannedWeightKg: number; actualWeightKg: number | null; furnaceCode: string; furnaceName: string; actualFurnaceCode: string; actualFurnaceName: string; transferTotalWeightKg: number; startedByName: string; startedAt: string; completedByName: string; completedAt: string }>
}

export interface WorkOrderPreview {
  productCode: string
  productName: string
  bomVersionId: string
  bomCode: string
  bomVersion: string
  routingVersionId: string
  routingCode: string
  routingName: string
  routingVersion: string
  materialGradeCode: string
  materialGradeName: string
  unitNetWeightKg: number
  unitGrossWeightKg: number
  yieldRate: number
  unitReturnWeightKg: number
  routingNodes: RoutingNodePreview[]
}

export interface WorkOrderPayload {
  productCode: string
  bomVersionId: string
  routingVersionId: string
  plannedQuantity: number
  plannedStartDate?: string
  plannedDeliveryDate: string
  priority?: string
  remark?: string
  versionNo?: number
}

export interface HeatOrderRecord {
  id: string
  code: string
  materialGradeCode: string
  materialGradeName: string
  furnaceCode: string
  furnaceName: string
  actualFurnaceCode: string
  actualFurnaceName: string
  furnaceCapacityKg: number
  workshopCode: string
  workshopName: string
  recipeCode: string
  recipeName: string
  recipeVersion: string
  teamCode: string
  teamName: string
  plannedOutputAt: string
  plannedStartAt: string
  calculatedFinishAt: string
  plannedFinishAt: string
  meltingDurationMinutes: number | null
  transferDurationMinutes: number | null
  cleaningDurationMinutes: number | null
  occupancyDurationMinutes: number | null
  finishTimeAdjusted: boolean
  hasScheduleConflict: boolean
  confirmedScheduleConflicts: HeatScheduleConflict[]
  targetWeightKg: number
  actualOutputWeightKg: number | null
  deviationWeightKg: number | null
  status: HeatOrderStatus
  versionNo: number
  startedByName: string
  startedAt: string
  completedByName: string
  completedAt: string
  canceledByName: string
  canceledAt: string
  cancelReason: string
  createdByName: string
  createdAt: string
  canStart: boolean
  canTransfer: boolean
  canComplete: boolean
  canCancel: boolean
  allocations: Array<{ id: string; workOrderId: string; workOrderCode: string; productCode: string; productName: string; allocatedQuantity: number; plannedWeightKg: number; actualWeightKg: number | null }>
  recipeItems: Array<{ itemCode: string; itemName: string; materialCategory: string; ratio: number | null; quantity: number | null; unit: string }>
  records: Array<{ id: string; action: string; fromStatus: string; toStatus: string; operatorName: string; remark: string; createdAt: string }>
  transferTotalWeightKg: number
  transfers: Array<{ id: string; transferDeviceCode: string; transferDeviceName: string; equipmentType: string; weightKg: number; weightSource: string; operatorName: string; remark: string; createdAt: string }>
}

export interface MeltPoolGroup {
  materialGradeCode: string
  materialGradeName: string
  remainingWeightKg: number
  orders: WorkOrderRecord[]
}

export function fetchWorkOrderOptions() {
  return apiRequest<{ products: Array<{ code: string; name: string; type?: string; unit?: string }> }>('/admin/production/work-orders/options')
}

export function fetchWorkOrderPreview(productCode: string) {
  return apiRequest<WorkOrderPreview>(`/admin/production/work-orders/product-preview/${encodeURIComponent(productCode)}`)
}

export function fetchWorkOrders(params: { keyword?: string; status?: string } = {}) {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.status) query.set('status', params.status)
  return apiRequest<WorkOrderRecord[]>(`/admin/production/work-orders${query.size ? `?${query}` : ''}`)
}

export function fetchWorkOrder(id: string) {
  return apiRequest<WorkOrderRecord>(`/admin/production/work-orders/${id}`)
}

export function createWorkOrder(payload: WorkOrderPayload) {
  return apiRequest<WorkOrderRecord>('/admin/production/work-orders', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateWorkOrder(id: string, payload: WorkOrderPayload) {
  return apiRequest<WorkOrderRecord>(`/admin/production/work-orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function closeWorkOrder(id: string, versionNo: number, reason: string) {
  return apiRequest<WorkOrderRecord>(`/admin/production/work-orders/${id}/close`, { method: 'POST', body: JSON.stringify({ versionNo, reason }) })
}

export function fetchMeltPool() {
  return apiRequest<{ groups: MeltPoolGroup[] }>('/admin/production/melt-pool')
}

export function fetchMeltPoolOptions(materialGradeCode: string) {
  return apiRequest<{
    recipes: Array<{ code: string; name: string; version: string; furnaceCodes: string[]; meltingDurationMinutes: number; transferDurationMinutes: number; cleaningDurationMinutes: number; occupancyDurationMinutes: number; durationConfigured: boolean }>
    workshops: Array<{ code: string; name: string }>
    furnaces: Array<{ code: string; name: string; workshopCode: string; workshopName: string; capacity: number; capacityUnit: string; capacityKg: number }>
    teams: Array<{ code: string; name: string; workshopCode: string; workshopName: string }>
    unavailableReason: string
  }>(`/admin/production/melt-pool/options?materialGradeCode=${encodeURIComponent(materialGradeCode)}`)
}

export interface HeatScheduleConflict {
  id: string
  code: string
  status: HeatOrderStatus
  plannedStartAt: string
  plannedFinishAt: string
}

export function checkHeatOrderConflicts(payload: { furnaceCode: string; plannedStartAt: string; plannedFinishAt: string }) {
  return apiRequest<{ conflicts: HeatScheduleConflict[] }>('/admin/production/heat-orders/check-conflicts', { method: 'POST', body: JSON.stringify(payload) })
}

export function createHeatOrder(payload: { materialGradeCode: string; workshopCode: string; furnaceCode: string; recipeCode: string; teamCode: string; plannedStartAt: string; plannedFinishAt: string; confirmScheduleConflict?: boolean; allocations: Array<{ workOrderId: string; quantity: number }> }) {
  return apiRequest<HeatOrderRecord>('/admin/production/heat-orders', { method: 'POST', body: JSON.stringify(payload) })
}

export interface EquipmentScheduleHeat {
  id: string
  code: string
  status: HeatOrderStatus
  versionNo: number
  furnaceCode: string
  materialGradeCode: string
  materialGradeName: string
  recipeCode: string
  recipeName: string
  compatibleFurnaceCodes: string[]
  targetWeightKg: number
  capacityUtilizationPercent: number
  plannedStartAt: string
  plannedFinishAt: string
  visibleStartAt: string
  visibleFinishAt: string
  workOrders: Array<{ code: string; plannedWeightKg: number }>
}

export interface EquipmentScheduleDevice {
  code: string
  name: string
  capacity: number
  capacityUnit: string
  capacityKg: number
  status: 'IDLE' | 'WAITING' | 'IN_PROGRESS' | 'TRANSFERRING' | 'SCHEDULED'
  hasConflict: boolean
  conflictHeatCodes: string[]
  summary: EquipmentScheduleHeat | null
  heats: EquipmentScheduleHeat[]
}

export interface EquipmentScheduleResult {
  workshop: { code: string; name: string }
  date: string
  windowStart: string
  windowFinish: string
  serverNow: string
  isToday: boolean
  devices: EquipmentScheduleDevice[]
}

export function fetchEquipmentSchedule(workshopCode: string, date: string) {
  const query = new URLSearchParams({ workshopCode, date })
  return apiRequest<EquipmentScheduleResult>(`/admin/production/equipment-schedule?${query}`)
}

export interface AdjustHeatSchedulePayload {
  versionNo: number
  furnaceCode: string
  plannedStartAt: string
  confirmScheduleConflict?: boolean
  remark?: string
}

export function adjustHeatOrderSchedule(id: string, payload: AdjustHeatSchedulePayload) {
  return apiRequest<HeatOrderRecord>(`/admin/production/heat-orders/${id}/schedule`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function fetchEquipmentScheduleWorkshops() {
  return apiRequest<Array<{ code: string; name: string }>>('/admin/production/equipment-schedule/workshops')
}

export function fetchHeatOrders(status?: HeatOrderStatus) {
  return apiRequest<HeatOrderRecord[]>(`/admin/production/heat-orders${status ? `?status=${status}` : ''}`)
}

export function fetchHeatOrder(id: string) {
  return apiRequest<HeatOrderRecord>(`/admin/production/heat-orders/${id}`)
}

export function cancelHeatOrder(id: string, versionNo: number, reason: string) {
  return apiRequest<HeatOrderRecord>(`/admin/production/heat-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ versionNo, reason }) })
}

export interface HeatExecutionOptions {
  plannedFurnaceCode: string
  plannedFurnaceName: string
  actualFurnaceCode: string
  targetWeightKg: number
  transferTotalWeightKg: number
  remainingTransferWeightKg: number
  furnaces: Array<{ code: string; name: string; equipmentType: string; capacity: number | null; capacityUnit: string; isPlanned: boolean }>
  transferDevices: Array<{ code: string; name: string; equipmentType: string }>
}

export function fetchHeatExecutionOptions(id: string) {
  return apiRequest<HeatExecutionOptions>(`/admin/production/heat-orders/${id}/execution-options`)
}

export function startHeatOrder(id: string, payload: { versionNo: number; actualFurnaceCode: string; confirmFurnaceChange?: boolean; remark?: string }) {
  return apiRequest<HeatOrderRecord>(`/admin/production/heat-orders/${id}/start`, { method: 'POST', body: JSON.stringify(payload) })
}

export function transferHeatOrder(id: string, payload: { versionNo: number; transferDeviceCode: string; weightKg: number; remark?: string }) {
  return apiRequest<HeatOrderRecord>(`/admin/production/heat-orders/${id}/transfer`, { method: 'POST', body: JSON.stringify(payload) })
}

export function completeHeatOrder(id: string, versionNo: number, actualOutputWeightKg: number, remark?: string) {
  return apiRequest<HeatOrderRecord>(`/admin/production/heat-orders/${id}/complete`, { method: 'POST', body: JSON.stringify({ versionNo, actualOutputWeightKg, remark }) })
}

export const heatStatusLabels: Record<HeatOrderStatus, string> = { WAITING: '待生产', IN_PROGRESS: '熔炼中', TRANSFERRING: '转运中', COMPLETED: '已完成', CANCELED: '已撤销' }
export const heatStatusColors: Record<HeatOrderStatus, string> = { WAITING: 'gold', IN_PROGRESS: 'blue', TRANSFERRING: 'cyan', COMPLETED: 'green', CANCELED: 'default' }
