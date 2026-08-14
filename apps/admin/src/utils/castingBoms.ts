import { apiRequest } from '../services/api'

export type BomStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED'

export interface BomItem {
  id?: string
  itemCode: string
  itemName?: string
  itemType?: string
  standardQuantity: number
  unit: string
  lossRate: number
  remark?: string
}

export interface BomRecord {
  id: string
  bomId: string
  bomCode: string
  productCode: string
  productName: string
  materialGradeCode: string
  materialGradeName: string
  netWeightKg: number
  grossWeightKg: number
  yieldRate: number
  returnWeightKg: number
  version: string
  status: BomStatus
  sourceVersionId?: string
  createdByUserId?: string
  createdByName?: string
  remark?: string
  createdAt: string
  updatedAt: string
  moldCodes: string[]
  coreBoxCodes: string[]
  molds: Array<{ code: string; name: string; itemCode: string; itemName?: string }>
  coreBoxes: Array<{ code: string; name: string; moldCode: string }>
  items: BomItem[]
}

export interface BomOptions {
  products: Array<{ code: string; name: string; type: string; materialGradeCode: string }>
  materials: Array<{ code: string; name: string }>
  physicalItems: Array<{ code: string; name: string; type: string; unit: string }>
  creators: Array<{ id: string; name: string }>
  molds: Array<{ code: string; name: string; itemCode: string; itemName?: string }>
  coreBoxes: Array<{ code: string; name: string; moldCode: string }>
  activeRecipes: Array<{
    code: string
    name: string
    version: string
    materialGradeCode: string
    furnaceNames: string[]
    items: Array<{ itemName: string; ratio: number; quantity: number; unit: string }>
  }>
}

export interface BomPayload {
  productCode: string
  materialGradeCode: string
  moldCodes: string[]
  coreBoxCodes: string[]
  netWeightKg: number
  grossWeightKg: number
  items: BomItem[]
  remark?: string
}

function queryString(params: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value) })
  return query.toString() ? `?${query}` : ''
}

export function fetchBoms(params: Record<string, string | undefined>) {
  return apiRequest<BomRecord[]>(`/admin/modeling/boms${queryString(params)}`)
}

export function fetchBomOptions() {
  return apiRequest<BomOptions>('/admin/modeling/boms/options')
}

export function fetchBomDetail(id: string) {
  return apiRequest<BomRecord>(`/admin/modeling/boms/${id}`)
}

export function createBom(payload: BomPayload) {
  return apiRequest<BomRecord>('/admin/modeling/boms', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateBom(id: string, payload: BomPayload) {
  return apiRequest<BomRecord>(`/admin/modeling/boms/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function deleteBom(id: string) {
  return apiRequest<{ id: string }>(`/admin/modeling/boms/${id}`, { method: 'DELETE' })
}

export function activateBom(id: string) {
  return apiRequest<BomRecord>(`/admin/modeling/boms/${id}/activate`, { method: 'POST' })
}

export function disableBom(id: string) {
  return apiRequest<BomRecord>(`/admin/modeling/boms/${id}/disable`, { method: 'POST' })
}

export function createBomVersion(id: string) {
  return apiRequest<BomRecord>(`/admin/modeling/boms/${id}/new-version`, { method: 'POST' })
}

export function cloneBom(id: string, targetProductCode: string) {
  return apiRequest<BomRecord>(`/admin/modeling/boms/${id}/clone`, { method: 'POST', body: JSON.stringify({ targetProductCode }) })
}
