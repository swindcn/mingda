import { apiRequest } from '../services/api'

export type RoutingStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED'
export type RouteType = 'MELT_BRANCH' | 'CORE_BRANCH' | 'MOLD_MAIN' | 'MERGE_POINT' | 'AFTER_MERGE'

export interface RoutingNodeRecord {
  id: string
  operationCode: string
  operationName?: string
  section?: string
  reportMode?: 'BATCH' | 'SINGLE'
  pouringMergePoint?: boolean
  seqNo?: number
  routeType: RouteType
  reportEnabled?: boolean
  qualityControlEnabled?: boolean
  qualityRequirement?: string
  requireFurnaceBatch?: boolean
  requireLadle?: boolean
  requireCoreBatch?: boolean
  standardCycleSeconds?: number
  positionX: number
  positionY: number
  equipmentCodes: string[]
  remark?: string
}

export interface RoutingEdgeRecord {
  id?: string
  sourceNodeId: string
  targetNodeId: string
}

export interface ProcessRoutingRecord {
  id: string
  routingId: string
  code: string
  name: string
  version: string
  status: RoutingStatus
  sourceVersionId?: string
  createdByName?: string
  remark?: string
  createdAt: string
  updatedAt: string
  productCodes: string[]
  products: Array<{ code: string; name: string; type: string; materialGradeCode: string; materialGradeName: string }>
  materialGrades: Array<{ code: string; name: string }>
  defaultProductCodes: string[]
  nodeCount: number
  defaultProductCount: number
  nodes: RoutingNodeRecord[]
  edges: RoutingEdgeRecord[]
}

export interface RoutingOptions {
  products: Array<{ code: string; name: string; type: string; materialGradeCode: string; materialGradeName: string }>
  operations: Array<{
    code: string
    name: string
    section: string
    reportMode: 'BATCH' | 'SINGLE'
    qualityControlPoint: boolean
    pouringMergePoint: boolean
  }>
  equipment: Array<{ code: string; name: string; workshopCode: string; workshopName: string }>
}

export interface ProcessRoutingPayload {
  code?: string
  name: string
  productCodes: string[]
  nodes: RoutingNodeRecord[]
  edges: RoutingEdgeRecord[]
  remark?: string
}

function queryString(params: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value) })
  return query.size ? `?${query}` : ''
}

export function fetchProcessRoutings(params: Record<string, string | undefined>) {
  return apiRequest<ProcessRoutingRecord[]>(`/admin/modeling/routings${queryString(params)}`)
}

export function fetchProcessRoutingOptions() {
  return apiRequest<RoutingOptions>('/admin/modeling/routings/options')
}

export function fetchProcessRouting(id: string) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}`)
}

export function createProcessRouting(payload: ProcessRoutingPayload) {
  return apiRequest<ProcessRoutingRecord>('/admin/modeling/routings', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateProcessRouting(id: string, payload: ProcessRoutingPayload) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function deleteProcessRouting(id: string) {
  return apiRequest<{ id: string }>(`/admin/modeling/routings/${id}`, { method: 'DELETE' })
}

export function activateProcessRouting(id: string) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}/activate`, { method: 'POST' })
}

export function disableProcessRouting(id: string) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}/disable`, { method: 'POST' })
}

export function createProcessRoutingVersion(id: string) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}/new-version`, { method: 'POST' })
}

export function cloneProcessRouting(id: string, payload: { code: string; name: string }) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}/clone`, { method: 'POST', body: JSON.stringify(payload) })
}

export function setDefaultRoutingProducts(id: string, productCodes: string[]) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}/default-products`, { method: 'PUT', body: JSON.stringify({ productCodes }) })
}

export function updateRoutingApplicableProducts(id: string, productCodes: string[]) {
  return apiRequest<ProcessRoutingRecord>(`/admin/modeling/routings/${id}/applicable-products`, { method: 'PUT', body: JSON.stringify({ productCodes }) })
}
