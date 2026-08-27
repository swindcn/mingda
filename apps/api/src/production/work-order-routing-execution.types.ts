export const EXECUTION_MODULES = ['CORE', 'MELT', 'MOLDING', 'POURING', 'SHAKE_CLEAN', 'INSPECTION', 'UNSUPPORTED'] as const
export type ExecutionModule = (typeof EXECUTION_MODULES)[number]

export const DISPATCH_STATUSES = ['PENDING', 'PARTIAL', 'RELEASED', 'WAITING_UPSTREAM', 'UNSUPPORTED'] as const
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number]

export const ROUTING_NODE_ACTIONS = ['CREATE', 'RELEASE_MELT', 'VIEW', 'WAIT', 'NONE'] as const
export type RoutingNodeAction = (typeof ROUTING_NODE_ACTIONS)[number]

export interface WorkOrderRoutingExecutionWarning {
  code: 'CORE_INCOMPLETE' | 'CORE_DRYING_PENDING'
  message: string
}

export interface MeltReleaseResult {
  released: boolean
  alreadyReleased: boolean
  routingNodeId: string
  meltReleasedAt: string
  meltReleasedByUserId: string
  warnings: WorkOrderRoutingExecutionWarning[]
  nodes: WorkOrderRoutingExecutionNode[]
}

export interface WorkOrderRoutingExecutionNode {
  nodeId: string
  seqNo: number
  operationCode: string
  operationName: string
  module: ExecutionModule
  dispatchStatus: DispatchStatus
  dispatchLabel: string
  progressStatus: string
  progressLabel: string
  progressText: string
  progressCurrent: number | null
  progressTotal: number | null
  progressUnit: string
  equipmentNames: string[]
  teamNames: string[]
  taskCount: number
  action: RoutingNodeAction
  actionEnabled: boolean
  actionPermission: string
  actionHint: string
}

export interface RoutingExecutionOperation {
  name?: string | null
  section?: string | null
}

export interface RoutingExecutionNodeContext {
  id: string
  seqNo: number
  operationCode: string
  operation?: RoutingExecutionOperation | null
}

export interface RoutingExecutionTaskContext {
  id: string
  routingNodeId?: string | null
  status?: string | null
  plannedQuantity?: number | null
  planPieceQty?: number | null
  planBoxQty?: number | null
  qualifiedQuantity?: number | null
  completedGoodQty?: number | null
  scrapQuantity?: number | null
  completedScrapQty?: number | null
  coreBoxCode?: string | null
  equipmentCode?: string | null
  equipmentNameSnapshot?: string | null
  productionLineCode?: string | null
  productionLineNameSnapshot?: string | null
  teamCode?: string | null
  teamNameSnapshot?: string | null
}

export interface RoutingExecutionHeatContext {
  status?: string | null
  furnaceCode?: string | null
  furnaceNameSnapshot?: string | null
  actualFurnaceCode?: string | null
  actualFurnaceNameSnapshot?: string | null
  teamCode?: string | null
  teamNameSnapshot?: string | null
  allocations?: Array<{ allocatedQuantity?: number | null; actualWeightKg?: number | null }> | null
}

export interface RoutingExecutionAllocationContext {
  workOrderId?: string | null
  routingNodeId?: string | null
  allocatedQuantity?: number | null
  actualWeightKg?: number | null
  heatOrder?: RoutingExecutionHeatContext | null
}

export interface RoutingExecutionMeltReleaseContext {
  routingNodeId: string
  releasedAt?: Date | string | null
  releasedByUserId?: string | null
}

export interface RoutingExecutionQueueContext {
  id?: string
  status?: string | null
  originalQuantity?: number | null
  remainingQuantity?: number | null
  routingNodeId?: string | null
  pouringRoutingNodeId?: string | null
  shakeRoutingNodeId?: string | null
  inspectionRoutingNodeId?: string | null
  goodQty?: number | null
  scrapQty?: number | null
  stationEquipmentNameSnapshot?: string | null
  stationEquipmentCode?: string | null
}

export interface WorkOrderExecutionContext {
  id: string
  plannedQuantity: number
  meltCompletedQuantity?: number | null
  meltReleasedAt?: Date | string | null
  routingVersion: { nodes: RoutingExecutionNodeContext[] }
  bomVersion?: { coreBoxes?: Array<{ coreBoxCode?: string | null }> | null } | null
  coreTasks?: RoutingExecutionTaskContext[] | null
  allocations?: RoutingExecutionAllocationContext[] | null
  meltReleases?: RoutingExecutionMeltReleaseContext[] | null
  moldingTasks?: RoutingExecutionTaskContext[] | null
  pouringMoldBatches?: RoutingExecutionQueueContext[] | null
  pouringReports?: RoutingExecutionQueueContext[] | null
  shakeBatches?: RoutingExecutionQueueContext[] | null
  shakeReports?: RoutingExecutionQueueContext[] | null
  cleaningBatches?: RoutingExecutionQueueContext[] | null
  cleaningReports?: RoutingExecutionQueueContext[] | null
  inspectionBatches?: RoutingExecutionQueueContext[] | null
  inspectionReports?: RoutingExecutionQueueContext[] | null
}
