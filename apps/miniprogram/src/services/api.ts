import {
  MoldDevelopmentItem,
  HeatExecutionOptions,
  CoreExecutionOptions,
  CoreInventoryBatch,
  CoreReportResult,
  MobileCoreTask,
  MobileHeatOrder,
  TodoItem,
} from '../types/business'
import { request } from '../utils/request'
import { uploadFile } from '../utils/request'

export interface LoginUser {
  id: string
  name: string
  phone?: string
  username?: string
  userType: string
  isSupplierEmployee?: boolean
  permissions?: string[]
}

export interface LoginResponse {
  token: string
  user: LoginUser
}

export interface HomeResponse {
  todos: TodoItem[]
  todoCount: number
  moldCount: number
}

export function login(data: { username: string; password: string }) {
  return request<LoginResponse>({
    url: '/auth/login',
    method: 'POST',
    data,
  })
}

export function getCurrentUser() {
  return request<LoginUser>({ url: '/auth/me' })
}

export function getMobileHome() {
  return request<HomeResponse>({ url: '/mobile/home' })
}

export function getTodos() {
  return request<TodoItem[]>({ url: '/mobile/todos' })
}

export function getMolds(keyword?: string) {
  const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
  return request<MoldDevelopmentItem[]>({ url: `/mobile/molds${query}` })
}

export function getMoldDetail(id: string) {
  return request<MoldDevelopmentItem>({ url: `/mobile/molds/${id}` })
}

export function confirmDrawing(id: string) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/confirm-drawing`,
    method: 'POST',
  })
}

export function submitShipping(
  id: string,
  data: { trackingNumber?: string; operator?: string; images?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/shipping`,
    method: 'POST',
    data,
  })
}

export function submitReceive(
  id: string,
  data: { operator?: string; images?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/receive`,
    method: 'POST',
    data,
  })
}

export function submitTrial(
  id: string,
  data: { operator?: string; images?: string[]; productImages?: string[]; destructiveImages?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/trial`,
    method: 'POST',
    data,
  })
}

export function submitBatch(
  id: string,
  data: { operator?: string; images?: string[]; productImages?: string[]; destructiveImages?: string[] },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/batch`,
    method: 'POST',
    data,
  })
}

export function submitEvaluation(
  id: string,
  data: { result?: '通过' | '不通过'; isComplete?: boolean; reason?: string },
) {
  return request<MoldDevelopmentItem>({
    url: `/mobile/molds/${id}/evaluation`,
    method: 'POST',
    data,
  })
}

export function uploadImage(filePath: string) {
  return uploadFile<{ url: string }>({
    url: '/admin/uploads/images',
    filePath,
    name: 'file',
  })
}

export function getHeatOrders(status?: string) {
  return request<MobileHeatOrder[]>({ url: `/mini/production/heat-orders${status ? `?status=${status}` : ''}` })
}

export function getHeatOrderDetail(id: string) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}` })
}

export function getHeatExecutionOptions(id: string) {
  return request<HeatExecutionOptions>({ url: `/mini/production/heat-orders/${id}/execution-options` })
}

export function startHeatProduction(id: string, data: { versionNo: number; actualFurnaceCode: string; confirmFurnaceChange?: boolean }) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}/start`, method: 'POST', data })
}

export function transferHeatProduction(id: string, data: { versionNo: number; transferDeviceCode: string; weightKg: number; remark?: string }) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}/transfer`, method: 'POST', data })
}

export function completeHeatProduction(id: string, data: { versionNo: number; actualOutputWeightKg: number; remark?: string }) {
  return request<MobileHeatOrder>({ url: `/mini/production/heat-orders/${id}/complete`, method: 'POST', data })
}

export function getCoreTasks(status?: string) {
  return request<MobileCoreTask[]>({ url: `/mini/production/core-tasks${status ? `?status=${encodeURIComponent(status)}` : ''}` })
}

export function getCoreTaskDetail(id: string) {
  return request<MobileCoreTask>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}` })
}

export function getCoreExecutionOptions(id: string) {
  return request<CoreExecutionOptions>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/execution-options` })
}

export function startCoreTask(id: string, data: { versionNo: number }) {
  return request<MobileCoreTask>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/start`, method: 'POST', data })
}

export function reportCoreTask(id: string, data: {
  versionNo: number
  qualifiedQuantity: number
  scrapQuantity: number
  shiftCode: string
  sandBatchCode?: string
  dryingRequired: boolean
  defectReason?: string
  remark?: string
}) {
  return request<CoreReportResult>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/report`, method: 'POST', data })
}

export function getCoreDryingBatches(id: string) {
  return request<CoreInventoryBatch[]>({ url: `/mini/production/core-tasks/${encodeURIComponent(id)}/drying-batches` })
}

export function dryCoreBatch(id: string, data: { versionNo: number; equipmentCode: string }) {
  return request<CoreInventoryBatch>({ url: `/mini/production/core-batches/${encodeURIComponent(id)}/dry`, method: 'POST', data })
}
