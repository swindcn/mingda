export interface RoutingNodeBody {
  id?: string
  operationCode?: string
  routeType?: string
  reportEnabled?: boolean
  qualityControlEnabled?: boolean
  qualityRequirement?: string
  requireFurnaceBatch?: boolean
  requireLadle?: boolean
  requireCoreBatch?: boolean
  standardCycleSeconds?: number
  coolingDurationMinutes?: number
  positionX?: number
  positionY?: number
  equipmentCodes?: string[]
  remark?: string
}

export interface RoutingEdgeBody {
  sourceNodeId?: string
  targetNodeId?: string
}

export interface RoutingBody {
  code?: string
  name?: string
  productCodes?: string[]
  nodes?: RoutingNodeBody[]
  edges?: RoutingEdgeBody[]
  remark?: string
}

export interface NormalizedRoutingNode extends RoutingNodeBody {
  id: string
  operationCode: string
  routeType: string
  equipmentCodes: string[]
  seqNo: number
  positionX: number
  positionY: number
}

export interface NormalizedRoutingEdge {
  sourceNodeId: string
  targetNodeId: string
}
