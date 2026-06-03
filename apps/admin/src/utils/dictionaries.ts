import { apiRequest } from '../services/api'

export const DICTIONARY_STORAGE_KEY = 'mingda-dictionaries'
export const DICTIONARY_STORAGE_EVENT = 'mingda-dictionaries-updated'

export interface ProductTypeNode {
  name: string
  children?: ProductTypeNode[]
}

export interface DictionaryState {
  moldTypes: string[]
  productUnits: string[]
  productTypes: ProductTypeNode[]
  positions: string[]
  workshopTypes: string[]
}

export const defaultDictionaries: DictionaryState = {
  moldTypes: ['压铸模', '砂型模', '注塑模', '冲压模', '其他'],
  productUnits: ['片', '个', '套', '台', '件'],
  productTypes: [
    { name: '成品' },
    { name: '半成品' },
    { name: '原材料' },
    {
      name: '模具工装',
      children: [{ name: '磨边工装' }, { name: '铝模具' }, { name: '砂芯模具' }],
    },
    { name: '辅助材料' },
    { name: '零辅配件' },
  ],
  positions: ['生产主管', '销售经理', '运营负责人', '产品经理', '会计', '项目成员'],
  workshopTypes: ['熔炼', '造型', '制芯', '清理', '机加工', '检验'],
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
