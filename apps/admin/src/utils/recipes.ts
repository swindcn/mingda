import { apiRequest } from '../services/api'

export type RecipeStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED'
export type RecipeMaterialCategory = 'RAW' | 'RETURN' | 'ADDITIVE'

export interface RecipeTargetElement {
  elementName: string
  minValue?: number
  maxValue?: number
  unit?: string
  remark?: string
}

export interface RecipeItem {
  itemCode: string
  itemName?: string
  itemType?: string
  materialCategory: RecipeMaterialCategory
  ratio?: number
  quantity?: number
  unit?: string
  remark?: string
}

export interface RecipeRecord {
  id: string
  code: string
  name: string
  materialGradeCode: string
  materialGradeName?: string
  furnaceCodes: string[]
  furnaceNames: string[]
  version: string
  baseWeightKg: number
  meltingDurationMinutes: number
  transferDurationMinutes: number
  cleaningDurationMinutes: number
  occupancyDurationMinutes: number
  sourceRecipeCode?: string
  status: RecipeStatus
  createdByName?: string
  targetElements: RecipeTargetElement[]
  items: RecipeItem[]
  remark?: string
  createdAt?: string
  updatedAt?: string
}

export interface RecipeOptions {
  materials: Array<{
    code: string
    name: string
    elements: RecipeTargetElement[]
  }>
  furnaces: Array<{
    code: string
    name: string
    capacity?: number
    capacityUnit?: string
    workshopName?: string
  }>
  rawMaterials: Array<{
    code: string
    name: string
    type: string
    unit?: string
  }>
}

export interface RecipePayload {
  name: string
  materialGradeCode: string
  furnaceCodes: string[]
  version: string
  baseWeightKg: number
  meltingDurationMinutes: number
  transferDurationMinutes: number
  cleaningDurationMinutes: number
  targetElements: RecipeTargetElement[]
  items: RecipeItem[]
  remark?: string
}

function queryString(params: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  return query.toString() ? `?${query}` : ''
}

export function fetchRecipes(params: Record<string, string | undefined>) {
  return apiRequest<RecipeRecord[]>(`/admin/modeling/recipes${queryString(params)}`)
}

export function fetchRecipeDetail(code: string) {
  return apiRequest<RecipeRecord>(`/admin/modeling/recipes/${encodeURIComponent(code)}`)
}

export function fetchRecipeOptions() {
  return apiRequest<RecipeOptions>('/admin/modeling/recipe-options')
}

export function createRecipe(payload: RecipePayload) {
  return apiRequest<RecipeRecord>('/admin/modeling/recipes', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateRecipe(code: string, payload: RecipePayload) {
  return apiRequest<RecipeRecord>(`/admin/modeling/recipes/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function activateRecipe(code: string) {
  return apiRequest<RecipeRecord>(`/admin/modeling/recipes/${encodeURIComponent(code)}/activate`, { method: 'POST' })
}

export function cloneRecipe(code: string) {
  return apiRequest<RecipeRecord>(`/admin/modeling/recipes/${encodeURIComponent(code)}/clone`, { method: 'POST' })
}

export function disableRecipe(code: string) {
  return apiRequest<RecipeRecord>(`/admin/modeling/recipes/${encodeURIComponent(code)}/disable`, { method: 'POST' })
}

export function deleteRecipe(code: string) {
  return apiRequest<{ id: string }>(`/admin/modeling/recipes/${encodeURIComponent(code)}`, { method: 'DELETE' })
}
