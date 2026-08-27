import { apiRequest } from '../services/api'

export const DICTIONARY_STORAGE_KEY = 'mingda-dictionaries'
export const DICTIONARY_STORAGE_EVENT = 'mingda-dictionaries-updated'

export interface ProductTypeNode {
  name: string
  children?: ProductTypeNode[]
}

export interface DictionaryOption {
  name: string
  unit?: string
  testMethod?: string
  valueType?: 'number' | 'text'
}

export interface DictionaryState {
  moldTypes: string[]
  productUnits: string[]
  productTypes: ProductTypeNode[]
  positions: string[]
  workshopTypes: string[]
  operationSections: string[]
  materialTypes: string[]
  equipmentTypes: string[]
  chemicalElements: DictionaryOption[]
  mechanicalProperties: DictionaryOption[]
  processRequirements: DictionaryOption[]
}

export const defaultDictionaries: DictionaryState = {
  moldTypes: ['压铸模', '砂型模', '注塑模', '冲压模', '其他'],
  productUnits: ['片', '个', '套', '台', '件'],
  productTypes: [
    { name: '成品' },
    { name: '半成品', children: [{ name: '砂芯' }] },
    { name: '原材料' },
    {
      name: '模具工装',
      children: [{ name: '磨边工装' }, { name: '铝模具' }, { name: '砂芯模具' }],
    },
    { name: '辅助材料' },
    { name: '铸造辅材' },
    { name: '工装耗材' },
    { name: '零辅配件' },
  ],
  positions: ['生产主管', '销售经理', '运营负责人', '产品经理', '会计', '项目成员'],
  workshopTypes: ['熔炼', '造型', '制芯', '清理', '机加工', '检验'],
  operationSections: ['熔炼', '制芯', '造型', '浇注', '清理', '后处理', '质检'],
  materialTypes: ['球铁', '灰铁', '碳钢'],
  equipmentTypes: ['熔炼炉', '浇注包', '球化包', '烘干设备', '其他设备'],
  chemicalElements: [
    { name: 'C', unit: '%' },
    { name: 'Si', unit: '%' },
    { name: 'Mn', unit: '%' },
    { name: 'P', unit: '%' },
    { name: 'S', unit: '%' },
  ],
  mechanicalProperties: [
    { name: '抗拉强度', unit: 'MPa', testMethod: 'GB/T 228.1' },
    { name: '屈服强度', unit: 'MPa', testMethod: 'GB/T 228.1' },
    { name: '伸长率', unit: '%', testMethod: 'GB/T 228.1' },
    { name: '硬度', unit: 'HB', testMethod: 'GB/T 231.1' },
  ],
  processRequirements: [
    { name: '熔炼温度', unit: '℃', valueType: 'number' },
    { name: '浇注温度', unit: '℃', valueType: 'number' },
    { name: '热处理方式', unit: '', valueType: 'text' },
    { name: '保温时间', unit: 'min', valueType: 'number' },
  ],
}

function normalizeProductTypes(value: unknown, fallback = defaultDictionaries.productTypes): ProductTypeNode[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value
    .map((item): ProductTypeNode | null => {
      if (typeof item === 'string') {
        const name = item.trim()
        return name ? { name } : null
      }
      if (typeof item !== 'object' || !item || !('name' in item)) return null
      const name = String(item.name || '').trim()
      if (!name) return null
      const children = normalizeProductTypes((item as ProductTypeNode).children || [], []).filter(Boolean)
      return children.length ? { name, children } : { name }
    })
    .filter((item): item is ProductTypeNode => Boolean(item))
  return normalized.length ? normalized : fallback
}

export function loadDictionaries(): DictionaryState {
  const raw = window.localStorage.getItem(DICTIONARY_STORAGE_KEY)
  if (!raw) return defaultDictionaries

  try {
    const parsed = JSON.parse(raw) as Partial<DictionaryState>
    return {
      moldTypes: parsed.moldTypes?.length ? parsed.moldTypes : defaultDictionaries.moldTypes,
      productUnits: parsed.productUnits?.length ? parsed.productUnits : defaultDictionaries.productUnits,
      productTypes: normalizeProductTypes(parsed.productTypes),
      positions: parsed.positions?.length ? parsed.positions : defaultDictionaries.positions,
      workshopTypes: parsed.workshopTypes?.length ? parsed.workshopTypes : defaultDictionaries.workshopTypes,
      operationSections: parsed.operationSections?.length ? parsed.operationSections : defaultDictionaries.operationSections,
      materialTypes: parsed.materialTypes?.length ? parsed.materialTypes : defaultDictionaries.materialTypes,
      equipmentTypes: parsed.equipmentTypes?.length ? parsed.equipmentTypes : defaultDictionaries.equipmentTypes,
      chemicalElements: parsed.chemicalElements?.length ? parsed.chemicalElements : defaultDictionaries.chemicalElements,
      mechanicalProperties: parsed.mechanicalProperties?.length ? parsed.mechanicalProperties : defaultDictionaries.mechanicalProperties,
      processRequirements: parsed.processRequirements?.length ? parsed.processRequirements : defaultDictionaries.processRequirements,
    }
  } catch {
    return defaultDictionaries
  }
}

export function saveDictionaries(next: DictionaryState) {
  window.localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(DICTIONARY_STORAGE_EVENT))
}

export async function fetchDictionariesFromApi() {
  const dictionaries = await apiRequest<DictionaryState>('/admin/dictionaries')
  saveDictionaries(dictionaries)
  return dictionaries
}

export async function updateDictionariesOnApi(next: DictionaryState) {
  const dictionaries = await apiRequest<DictionaryState>('/admin/dictionaries', {
    method: 'PUT',
    body: JSON.stringify(next),
  })
  saveDictionaries(dictionaries)
  return dictionaries
}
