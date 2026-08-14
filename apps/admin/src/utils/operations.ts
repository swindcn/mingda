import { apiRequest } from '../services/api'

export interface OperationRecord {
  id: string
  code: string
  name: string
  section: string
  reportMode: 'BATCH' | 'SINGLE'
  qualityControlPoint: boolean
  pouringMergePoint: boolean
  status: 'ENABLED' | 'DISABLED'
  remark?: string
  createdAt: string
  updatedAt: string
}

export interface OperationPayload {
  code?: string
  name: string
  section: string
  reportMode: 'BATCH' | 'SINGLE'
  qualityControlPoint: boolean
  pouringMergePoint: boolean
  remark?: string
}

export function fetchOperations(params: { keyword?: string; status?: string } = {}) {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.status) query.set('status', params.status)
  return apiRequest<OperationRecord[]>(`/admin/modeling/operations${query.size ? `?${query}` : ''}`)
}

export function fetchOperationOptions() {
  return apiRequest<{ sections: string[]; operations: OperationRecord[] }>('/admin/modeling/operations/options')
}

export function createOperation(payload: OperationPayload) {
  return apiRequest<OperationRecord>('/admin/modeling/operations', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateOperation(id: string, payload: OperationPayload) {
  return apiRequest<OperationRecord>(`/admin/modeling/operations/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function disableOperation(id: string) {
  return apiRequest<OperationRecord>(`/admin/modeling/operations/${id}/disable`, { method: 'POST' })
}

export function enableOperation(id: string) {
  return apiRequest<OperationRecord>(`/admin/modeling/operations/${id}/enable`, { method: 'POST' })
}
