import { apiRequest } from '../services/api'

export const CUSTOMER_STORAGE_KEY = 'mingda-customers'
export const SUPPLIER_STORAGE_KEY = 'mingda-suppliers'
export const PRODUCT_STORAGE_KEY = 'mingda-products'
export const MASTER_DATA_EVENT = 'mingda-master-data-updated'

export interface PartnerRecord {
  id: string
  dbId?: string
  name: string
  address: string
  contact: string
  phone: string
  createdAt: string
}

export type ProductSource = '自制件' | '外购件'

export interface UnitConversionRule {
  sourceQuantity?: number
  sourceUnit?: string
  targetQuantity?: number
  targetUnit?: string
  floating?: boolean
}

export interface ProductRecord {
  id: string
  dbId?: string
  name: string
  code: string
  spec: string
  unit: string
  type: string
  source: ProductSource
  workshop: string
  purchaseUnit?: string
  salesUnit?: string
  inventoryUnit?: string
  unitConversions?: UnitConversionRule[]
  salePrice: number
  costPrice: number
  stockMax: number
  stockMin: number
  minPurchase: number
  dailyCapacity: number
  remark?: string
  createdAt: string
}

export const initialCustomers: PartnerRecord[] = []
export const initialSuppliers: PartnerRecord[] = []
export const initialProducts: ProductRecord[] = []

function loadArray<T>(storageKey: string, fallback: T[]) {
  const raw = window.localStorage.getItem(storageKey)
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as T[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function saveArray<T>(storageKey: string, records: T[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(records))
  window.dispatchEvent(new CustomEvent(MASTER_DATA_EVENT, { detail: { storageKey } }))
}

export function loadCustomers() {
  return loadArray(CUSTOMER_STORAGE_KEY, initialCustomers)
}

export function saveCustomers(records: PartnerRecord[]) {
  saveArray(CUSTOMER_STORAGE_KEY, records)
}

export async function fetchCustomersFromApi() {
  const records = await apiRequest<PartnerRecord[]>('/admin/customers')
  saveCustomers(records)
  return records
}

export async function createCustomerOnApi(record: Partial<PartnerRecord>) {
  await apiRequest<PartnerRecord>('/admin/customers', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  return fetchCustomersFromApi()
}

export async function updateCustomerOnApi(id: string, record: Partial<PartnerRecord>) {
  await apiRequest<PartnerRecord>(`/admin/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  })
  return fetchCustomersFromApi()
}

export async function deleteCustomerOnApi(id: string) {
  await apiRequest<{ id: string }>(`/admin/customers/${id}`, { method: 'DELETE' })
  return fetchCustomersFromApi()
}

export function loadSuppliers() {
  return loadArray(SUPPLIER_STORAGE_KEY, initialSuppliers)
}

export function saveSuppliers(records: PartnerRecord[]) {
  saveArray(SUPPLIER_STORAGE_KEY, records)
}

export async function fetchSuppliersFromApi() {
  const records = await apiRequest<PartnerRecord[]>('/admin/suppliers')
  saveSuppliers(records)
  return records
}

export async function createSupplierOnApi(record: Partial<PartnerRecord>) {
  await apiRequest<PartnerRecord>('/admin/suppliers', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  return fetchSuppliersFromApi()
}

export async function updateSupplierOnApi(id: string, record: Partial<PartnerRecord>) {
  await apiRequest<PartnerRecord>(`/admin/suppliers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  })
  return fetchSuppliersFromApi()
}

export async function deleteSupplierOnApi(id: string) {
  await apiRequest<{ id: string }>(`/admin/suppliers/${id}`, { method: 'DELETE' })
  return fetchSuppliersFromApi()
}

export function loadProducts() {
  return loadArray(PRODUCT_STORAGE_KEY, initialProducts)
}

export function saveProducts(records: ProductRecord[]) {
  saveArray(PRODUCT_STORAGE_KEY, records)
}

export async function fetchProductsFromApi() {
  const records = await apiRequest<ProductRecord[]>('/admin/products')
  saveProducts(records)
  return records
}

export async function createProductOnApi(record: Partial<ProductRecord>) {
  await apiRequest<ProductRecord>('/admin/products', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  return fetchProductsFromApi()
}

export async function updateProductOnApi(id: string, record: Partial<ProductRecord>) {
  await apiRequest<ProductRecord>(`/admin/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  })
  return fetchProductsFromApi()
}

export async function deleteProductOnApi(id: string) {
  await apiRequest<{ id: string }>(`/admin/products/${id}`, { method: 'DELETE' })
  return fetchProductsFromApi()
}
