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
