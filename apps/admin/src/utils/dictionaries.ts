import { apiRequest } from '../services/api'

export const DICTIONARY_STORAGE_KEY = 'mingda-dictionaries'
export const DICTIONARY_STORAGE_EVENT = 'mingda-dictionaries-updated'

export interface DictionaryState {
  moldTypes: string[]
  productUnits: string[]
  productTypes: string[]
  positions: string[]
  workshopTypes: string[]
}

export const defaultDictionaries: DictionaryState = {
  moldTypes: ['压铸模', '砂型模', '注塑模', '冲压模', '其他'],
  productUnits: ['片', '个', '套', '台', '件'],
  productTypes: ['自制件', '外购件', '半成品', '成品'],
  positions: ['生产主管', '销售经理', '运营负责人', '产品经理', '会计', '项目成员'],
  workshopTypes: ['熔炼', '造型', '制芯', '清理', '机加工', '检验'],
}

export function loadDictionaries(): DictionaryState {
  const raw = window.localStorage.getItem(DICTIONARY_STORAGE_KEY)
  if (!raw) return defaultDictionaries

  try {
    const parsed = JSON.parse(raw) as Partial<DictionaryState>
    return {
      moldTypes: parsed.moldTypes?.length ? parsed.moldTypes : defaultDictionaries.moldTypes,
      productUnits: parsed.productUnits?.length ? parsed.productUnits : defaultDictionaries.productUnits,
      productTypes: parsed.productTypes?.length ? parsed.productTypes : defaultDictionaries.productTypes,
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
