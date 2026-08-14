export type WorkOrderScheduleStatus = 'PENDING' | 'PARTIAL' | 'FULL'
export type WorkOrderProductionStatus = 'RELEASED' | 'IN_PRODUCTION' | 'MELT_COMPLETED' | 'COMPLETED' | 'CLOSED'
export type HeatOrderStatus = 'WAITING' | 'IN_PROGRESS' | 'TRANSFERRING' | 'COMPLETED' | 'CANCELED'

export interface WorkOrderBody {
  productCode?: string
  bomVersionId?: string
  routingVersionId?: string
  plannedQuantity?: number
  plannedStartDate?: string
  plannedDeliveryDate?: string
  priority?: string
  remark?: string
  versionNo?: number
}

export interface HeatOrderBody {
  materialGradeCode?: string
  workshopCode?: string
  furnaceCode?: string
  recipeCode?: string
  teamCode?: string
  shiftCode?: string
  plannedStartAt?: string
  plannedFinishAt?: string
  confirmScheduleConflict?: boolean
  allocations?: Array<{ workOrderId?: string; quantity?: number }>
}

export interface HeatConflictBody {
  furnaceCode?: string
  plannedStartAt?: string
  plannedFinishAt?: string
}

export interface AdjustHeatScheduleBody extends VersionedActionBody {
  furnaceCode?: string
  plannedStartAt?: string
  confirmScheduleConflict?: boolean
}

export interface VersionedActionBody {
  versionNo?: number
  remark?: string
}

export interface StartHeatOrderBody extends VersionedActionBody {
  actualFurnaceCode?: string
  confirmFurnaceChange?: boolean
}

export interface TransferHeatOrderBody extends VersionedActionBody {
  transferDeviceCode?: string
  weightKg?: number
  weightSource?: 'MANUAL' | 'DEVICE'
}

export interface CompleteHeatOrderBody extends VersionedActionBody {
  actualOutputWeightKg?: number
}
