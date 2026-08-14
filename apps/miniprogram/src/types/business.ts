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
