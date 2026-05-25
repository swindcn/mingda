export const CUSTOMER_STORAGE_KEY = 'mingda-customers'
export const SUPPLIER_STORAGE_KEY = 'mingda-suppliers'
export const PRODUCT_STORAGE_KEY = 'mingda-products'
export const MASTER_DATA_EVENT = 'mingda-master-data-updated'

export interface PartnerRecord {
  id: string
  name: string
  address: string
  contact: string
  phone: string
  createdAt: string
}

export type ProductSource = '自制件' | '外购件'

export interface ProductRecord {
  id: string
  name: string
  code: string
  spec: string
  unit: string
  type: string
  source: ProductSource
  workshop: string
  salePrice: number
  costPrice: number
  stockMax: number
  stockMin: number
  minPurchase: number
  dailyCapacity: number
  remark?: string
  createdAt: string
}

export const initialCustomers: PartnerRecord[] = [
  {
    id: 'CUS001',
    name: '长城汽车股份有限公司',
    address: '河北省保定市莲池区长城大街',
    contact: '张总监',
    phone: '13900139001',
    createdAt: '2026-05-10',
  },
  {
    id: 'CUS002',
    name: '比亚迪汽车工业有限公司',
    address: '广东省深圳市龙岗区宝龙工业城',
    contact: '刘经理',
    phone: '13900139002',
    createdAt: '2026-05-12',
  },
]

export const initialSuppliers: PartnerRecord[] = [
  {
    id: 'SUP001',
    name: '鑫源材料有限公司',
    address: '山东省济南市历城区工业园区',
    contact: '王经理',
    phone: '13800138001',
    createdAt: '2026-05-15',
  },
  {
    id: 'SUP002',
    name: '华泰金属制品厂',
    address: '河北省唐山市丰润区钢铁大道',
    contact: '李总',
    phone: '13800138002',
    createdAt: '2026-05-18',
  },
]

export const initialProducts: ProductRecord[] = [
  {
    id: 'P001',
    name: '英沃保险柜门板内板',
    code: 'mbnb0001',
    spec: '600x400x360',
    unit: '片',
    type: '自制件',
    source: '自制件',
    workshop: '英沃保险柜生产车间',
    salePrice: 100,
    costPrice: 50,
    stockMax: 500,
    stockMin: 100,
    minPurchase: 100,
    dailyCapacity: 0,
    remark: '',
    createdAt: '2026-05-15',
  },
  {
    id: 'P002',
    name: '球墨铸铁泵体',
    code: 'qtbt0002',
    spec: 'DN80',
    unit: '件',
    type: '成品',
    source: '自制件',
    workshop: '铸造一车间',
    salePrice: 680,
    costPrice: 420,
    stockMax: 300,
    stockMin: 40,
    minPurchase: 20,
    dailyCapacity: 35,
    remark: '常规泵体产品',
    createdAt: '2026-05-18',
  },
]

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

export function loadSuppliers() {
  return loadArray(SUPPLIER_STORAGE_KEY, initialSuppliers)
}

export function saveSuppliers(records: PartnerRecord[]) {
  saveArray(SUPPLIER_STORAGE_KEY, records)
}

export function loadProducts() {
  return loadArray(PRODUCT_STORAGE_KEY, initialProducts)
}

export function saveProducts(records: ProductRecord[]) {
  saveArray(PRODUCT_STORAGE_KEY, records)
}
