import { apiRequest } from '../services/api'

export type ModelingResource =
  | 'workshops'
  | 'lines'
  | 'teams'
  | 'items'
  | 'materials'
  | 'equipment'
  | 'recipes'
  | 'molds'
  | 'coreboxes'
  | 'routings'
  | 'shifts'
  | 'calendars'
  | 'schedules'
  | 'defects'

export interface ModelingRecord {
  id: string
  dbId?: string
  code?: string
  name?: string
  status?: string
  remark?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface ModelingOptions {
  workshops: ModelingRecord[]
  lines: ModelingRecord[]
  teams: ModelingRecord[]
  items: ModelingRecord[]
  materials: ModelingRecord[]
  molds: ModelingRecord[]
  shifts: ModelingRecord[]
  employees: Array<{ id: string; name: string; phone: string; department: string }>
}

export async function fetchModelingRecords(resource: ModelingResource, params?: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  const suffix = query.toString() ? `?${query}` : ''
  return apiRequest<ModelingRecord[]>(`/admin/modeling/${resource}${suffix}`)
}

export async function createModelingRecord(resource: ModelingResource, record: Partial<ModelingRecord>) {
  return apiRequest<ModelingRecord>(`/admin/modeling/${resource}`, {
    method: 'POST',
    body: JSON.stringify(record),
  })
}

export async function updateModelingRecord(
  resource: ModelingResource,
  id: string,
  record: Partial<ModelingRecord>,
) {
  return apiRequest<ModelingRecord>(`/admin/modeling/${resource}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  })
}

export async function deleteModelingRecord(resource: ModelingResource, id: string) {
  return apiRequest<{ id: string }>(`/admin/modeling/${resource}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function fetchModelingOptions() {
  return apiRequest<ModelingOptions>('/admin/modeling/options')
}

export async function batchGenerateSchedules(record: {
  startDate?: string
  endDate?: string
  workshopCode?: string
  shiftCodes?: string[]
  teamCodes?: string[]
}) {
  return apiRequest<ModelingRecord[]>('/admin/modeling/schedules/batch-generate', {
    method: 'POST',
    body: JSON.stringify(record),
  })
}
