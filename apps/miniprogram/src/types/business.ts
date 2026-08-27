export type TodoPriority = '高' | '中' | '低'
export type MoldStatus = '待确认' | '待发货' | '待收货' | '待试产' | '试产中' | '已完成' | '已中止'

export interface TodoItem {
  id: string
  title: string
  priority: TodoPriority
  priorityTone: 'high' | 'middle' | 'low'
  moduleName: string
  stateText: string
  dueText: string
  moldId?: string
}

export interface FlowRecord {
  key: string
  title: string
  done: boolean
  operator?: string
  time?: string
  trackingNumber?: string
  images?: string[]
}

export interface ProductionRecord {
  id: string
  type: 'trial' | 'batch' | 'evaluation'
  title: string
  operator?: string
  time: string
  images?: string[]
  productImages?: string[]
  destructiveImages?: string[]
  result?: '通过' | '不通过'
  isComplete?: boolean
  reason?: string
}

export interface TerminationRecord {
  operator?: string
  time?: string
  reason?: string
}

export interface MoldDevelopmentItem {
  id: string
  code: string
  customerName: string
  productCode: string
  productName: string
  moldType: string
  status: MoldStatus
  statusTone: 'pending' | 'active' | 'done'
  supplierName: string
  followerName: string
  notifiedDate: string
  expectedDate: string
  issuedDate: string
  remark: string
  images: string[]
  permissions?: {
    canConfirmDrawing: boolean
    canShip: boolean
    canReceive: boolean
    canTrial: boolean
    canBatch: boolean
    canEvaluate: boolean
  }
  flowRecords: FlowRecord[]
  productionRecords: ProductionRecord[]
  terminationRecord?: TerminationRecord | null
  hideSupplierSensitiveFields?: boolean
}

export type HeatOrderStatus = 'WAITING' | 'IN_PROGRESS' | 'TRANSFERRING' | 'COMPLETED' | 'CANCELED'

export interface MobileHeatOrder {
  id: string
  code: string
  materialGradeCode: string
  materialGradeName: string
  furnaceCode: string
  furnaceName: string
  actualFurnaceCode: string
  actualFurnaceName: string
  furnaceCapacityKg: number
  workshopName: string
  recipeCode: string
  recipeName: string
  recipeVersion: string
  teamCode: string
  teamName: string
  plannedOutputAt: string
  plannedStartAt: string
  targetWeightKg: number
  actualOutputWeightKg: number | null
  deviationWeightKg: number | null
  status: HeatOrderStatus
  versionNo: number
  startedByName: string
  startedAt: string
  completedByName: string
  completedAt: string
  canStart: boolean
  canTransfer: boolean
  canComplete: boolean
  allocations: Array<{ id: string; workOrderCode: string; productCode: string; productName: string; allocatedQuantity: number; plannedWeightKg: number; actualWeightKg: number | null }>
  recipeItems: Array<{ itemCode: string; itemName: string; materialCategory: string; ratio: number | null; quantity: number | null; unit: string }>
  records: Array<{ id: string; action: string; operatorName: string; remark: string; createdAt: string }>
  transferTotalWeightKg: number
  transfers: Array<{ id: string; transferDeviceCode: string; transferDeviceName: string; equipmentType: string; weightKg: number; weightSource: string; operatorName: string; remark: string; createdAt: string }>
  statusText?: string
  statusTone?: string
  plannedStartText?: string
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

export type CoreTaskStatus = 'PENDING_DISPATCH' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED'
export type CoreBatchStatus = 'UNDRIED' | 'AVAILABLE' | 'WARNING' | 'EXPIRED' | 'LOCKED' | 'SCRAPPED' | 'CONSUMED'

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
  defects: Array<{ code: string; name: string; quantity: number; remark: string }>
  dryingRequired: boolean
  remark: string
  reportedAt: string
  createdAt: string
  batch: { id: string; code: string; status: CoreBatchStatus; versionNo: number; dryingRequired: boolean } | null
}

export interface CoreInventoryBatch {
  id: string
  code: string
  qrContent: string
  taskId: string
  taskCode: string
  coreBoxCode: string
  coreBoxName: string
  productCode: string
  productName: string
  reportedAt: string
  initialQuantity: number
  currentQuantity: number
  dryingRequired: boolean
  driedAt: string
  dryingEquipmentCode: string
  dryingEquipmentName: string
  shelfLifeHours: number | null
  shelfLifeStartedAt: string
  expiresAt: string
  status: CoreBatchStatus
  versionNo: number
  createdAt: string
  canDry: boolean
  statusText?: string
  createdAtText?: string
  expiresAtText?: string
}

export interface MobileCoreTaskSummary {
  id: string
  code: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  operationName: string
  coreBoxCode: string
  coreBoxName: string
  moldCode: string
  moldName: string
  quantityPerProduct: number
  cavityCount: number
  shelfLifeHours: number | null
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
  remark: string
  startedAt: string
  completedAt: string
  createdAt: string
  canStart: boolean
  canReport: boolean
  canDry: boolean
  statusText?: string
  statusTone?: string
  plannedStartText?: string
}

export interface MobileCoreTaskDetail extends MobileCoreTaskSummary {
  reports: CoreProductionReport[]
  batches: CoreInventoryBatch[]
}

export interface CoreExecutionOptions {
  teams: Array<{ code: string; name: string; status: string }>
  shifts: Array<{ code: string; name: string; status: string }>
  dryingEquipment: Array<{ code: string; name: string; equipmentType: string; workshopCode: string; workshopName: string }>
  defects: Array<{ code: string; name: string; category: string }>
}

export interface CoreReportResult {
  task: MobileCoreTaskSummary
  report: CoreProductionReport
  batch: CoreInventoryBatch
}

export type MoldingTaskStatus = 'PENDING' | 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED'
export type MoldingDisplayStatus = MoldingTaskStatus

export interface MobileMoldingTask {
  id: string
  code: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  operationName: string
  routingNodeId: string
  moldCode: string
  moldName: string
  cavityCount: number
  productionLineName: string
  workshopName: string
  teamName: string
  planPieceQty: number
  planBoxQty: number
  completedGoodQty: number
  completedScrapQty: number
  overproductionQty: number
  status: MoldingTaskStatus
  displayStatus: MoldingDisplayStatus
  versionNo: number
  plannedStartAt: string
  startedAt: string
  completedAt: string
  remark: string
  readiness: {
    ready: boolean
    code: 'READY' | 'WAITING_CORE_TASK' | 'INSUFFICIENT_CORE'
    startable: boolean
    maxProducibleBoxQty: number | null
    blockedReason: string
    requirements: Array<{ coreBoxCode: string; coreBoxName: string; quantityPerBox: number; requiredQuantity: number; remainingRequiredQuantity?: number; available: number; shortage: number; coreTaskCompleted: boolean }>
  }
  coreRequirements: Array<{ coreBoxCode: string; coreBoxName: string; quantityPerProduct: number; quantityPerBox: number; requiredQuantity: number }>
  allowedActions: { start: boolean; report: boolean }
  startBlockedReason: string
  startWarning: string
  reports?: Array<{ id: string; reportCode: string; goodQty: number; scrapQty: number; operatorName: string; status: string; reportedAt: string }>
  statusText?: string
  statusTone?: string
}

export interface MoldingDefectOption { code: string; name: string; category: string }

export type PouringExecutionStatus = 'WAITING' | 'PARTIAL' | 'WAITING_MOLDING' | 'COMPLETED'
export type PouringHoldLevel = 'NORMAL' | 'WARNING' | 'CRITICAL'

export interface MobilePouringTask {
  moldingTaskId: string
  moldingTaskCode: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  moldName: string
  pouringOperationName: string
  moldedQuantity: number
  pouredQuantity: number
  remainingQuantity: number
  earliestClosingTime: string | null
  holdMinutes: number
  holdLevel: PouringHoldLevel
  moldingTaskStatus: string
  executionStatus: PouringExecutionStatus
  statusText?: string
  statusTone?: string
  holdText?: string
  holdTone?: string
}

export interface MobilePouringOptions {
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
  transfers: Array<{ id: string; versionNo: number; heatOrderCode: string; transferDeviceCode: string; transferDeviceName: string; equipmentType: string; materialGradeCode: string; materialGradeName: string; transferWeightKg: number; balanceKg: number; createdAt: string }>
}

export interface MobilePouringCheck {
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

export interface MobilePouringReport {
  id: string
  code: string
  heatOrderCodeSnapshot: string
  transferDeviceNameSnapshot: string
  stationEquipmentNameSnapshot: string
  goodQty: number
  scrapQty: number
  theoreticalWeightKg: number
  actualWeightKg: number
  transferBalanceAfterKg: number
  holdMinutesSnapshot: number
  holdLevelSnapshot: PouringHoldLevel
  operatorNameSnapshot: string
  status: 'ACTIVE' | 'REVERSED'
  reportedAt: string
}

export interface PouringDefectOption { code: string; name: string; category: string }

export type ShakeCleanExecutionStatus = 'WAITING_SHAKE' | 'SHAKING' | 'WAITING_CLEANING' | 'CLEANING' | 'WAITING_POURING' | 'COMPLETED'
export interface ShakeCleanAllowedActions { shakeReport: boolean; cleanReport: boolean; reverse: boolean }
export interface ShakeCleanCooling { earlyShake: boolean; remainingCoolingMinutes: number; requiredCoolingMinutes: number; actualCoolingMinutes: number }
export interface ShakeCleanBatchVersion { id: string; versionNo: number; remainingQuantity: number; pouredAt?: string; availableAt?: string }
export interface ShakeCleanEquipment { code: string; name: string; equipmentType: string }
export interface MobileShakeCleanTask {
  id: string
  code: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  operationName: string
  earliestPouredAt: string | null
  cooling: ShakeCleanCooling | null
  shakeOriginal: number
  shakeRemaining: number
  cleaningOriginal: number
  cleaningRemaining: number
  blankOutputQuantity: number
  upstreamComplete: boolean
  executionStatus: ShakeCleanExecutionStatus
  allowedActions: ShakeCleanAllowedActions
  statusText?: string
  statusTone?: string
}
export interface ShakeCleanListResponse { records: MobileShakeCleanTask[]; total: number; page: number; pageSize: number; nextCursor?: string | null }
export interface MobileShakeCleanOptions {
  moldingTaskId: string
  moldingTaskCode: string
  workOrderId: string
  workOrderCode: string
  productCode: string
  productName: string
  shakeOriginal: number
  shakeRemaining: number
  cleaningOriginal: number
  cleaningRemaining: number
  upstreamComplete: boolean
  executionStatus: ShakeCleanExecutionStatus
  cooling: ({ code: 'EARLY_SHAKE' | 'READY' } & ShakeCleanCooling) | null
  shakeBatchVersions: ShakeCleanBatchVersion[]
  cleaningBatchVersions: ShakeCleanBatchVersion[]
  shakeEquipment: ShakeCleanEquipment[]
  cleaningEquipment: ShakeCleanEquipment[]
  allowedActions: ShakeCleanAllowedActions
}
export interface ShakeCleanDefectOption { code: string; name: string; category: string }
export interface ShakeCleanCheck { code: 'EARLY_SHAKE' | 'READY'; earlyShake: boolean; requiredCoolingMinutes: number; actualCoolingMinutes: number; remainingCoolingMinutes: number }
export interface ShakeCleanReports { shakeReports: Array<Record<string, unknown>>; cleaningReports: Array<Record<string, unknown>> }
export interface ShakeCleanTrace { shakeBatches: Array<Record<string, unknown>>; cleaningBatches: Array<Record<string, unknown>>; blankOutputBatches: Array<Record<string, unknown>> }

export type InspectionTaskStatus = 'WAITING' | 'INSPECTING' | 'REWORKING' | 'COMPLETED'
export interface InspectionTaskSummary {
  id: string
  code: string
  productCode: string
  productName: string
  materialGradeName: string
  originalQuantity: number
  remainingQuantity: number
  openReworkQuantity: number
  qualifiedQuantity: number
  status: InspectionTaskStatus
  updatedAt: string
  allowedActions: { report: boolean; reverse: boolean }
  statusText?: string
  statusTone?: string
}
export interface InspectionTaskListResponse { records: InspectionTaskSummary[]; total: number; page: number; pageSize: number }
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
export interface InspectionDefectOption { id: string; code: string; name: string; category: string }
export interface CleaningReworkTask {
  id: string
  code: string
  workOrderId: string
  productCodeSnapshot: string
  productNameSnapshot: string
  originalQuantity: number
  remainingQuantity: number
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED'
  versionNo: number
  operationNameSnapshot: string
  reports?: Array<{ id: string; code: string; goodQty: number; scrapQty: number; equipmentNameSnapshot: string; operatorNameSnapshot: string; reportedAt: string }>
  equipment?: Array<{ code: string; name: string; equipmentType: string }>
  allowedActions?: { report: boolean }
}
export interface InspectionReportRecord {
  id: string
  code: string
  goodQty: number
  reworkQty: number
  scrapQty: number
  scrapWeightKg: number
  operatorNameSnapshot: string
  reportedAt: string
  status: 'ACTIVE' | 'REVERSED'
  defects: Array<{ id: string; defectCodeSnapshot: string; defectNameSnapshot: string; quantity: number }>
  image?: { imageUrl: string } | null
  blankWarehouseReceipt?: { code: string; quantity: number } | null
}
export interface InspectionTaskDetail {
  id: string
  code: string
  productCodeSnapshot: string
  productNameSnapshot: string
  materialGradeNameSnapshot: string
  plannedQuantity: number
  completedQuantity: number
  productionStatus: string
  unitNetWeightKg: number
  inspectionReports: InspectionReportRecord[]
  cleaningReworkTasks: CleaningReworkTask[]
  options: InspectionOptions
}
