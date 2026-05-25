import { apiRequest } from '../services/api'

export const DEPARTMENT_STORAGE_KEY = 'mingda-departments'
export const DEPARTMENT_STORAGE_EVENT = 'mingda-departments-updated'

export interface DepartmentRecord {
  key: string
  name: string
  code: string
  createdAt: string
  source: '本地' | '钉钉' | '企业微信' | '飞书'
  children?: DepartmentRecord[]
}

export const initialDepartments: DepartmentRecord[] = [
  {
    key: '1',
    name: '摩尔元数（福建）科技有限公司',
    code: '1',
    createdAt: '2022-06-09 09:47:40',
    source: '本地',
    children: [
      {
        key: '100',
        name: '总经办',
        code: '100',
        createdAt: '2022-06-09 09:47:40',
        source: '本地',
      },
      {
        key: '101',
        name: '生产中心',
        code: '101',
        createdAt: '2022-06-09 09:47:40',
        source: '本地',
        children: [
          {
            key: '101-1',
            name: '产品一部',
            code: '101-1',
            createdAt: '2022-06-09 09:47:40',
            source: '本地',
          },
        ],
      },
      {
        key: '102',
        name: '技术支持中心',
        code: '102',
        createdAt: '2022-06-09 09:47:40',
        source: '本地',
      },
      {
        key: '158',
        name: '军工事业部',
        code: '158',
        createdAt: '2023-11-30 17:53:46',
        source: '本地',
      },
      {
        key: '159',
        name: '交付中心',
        code: '159',
        createdAt: '2023-12-01 09:18:17',
        source: '本地',
        children: [
          {
            key: '160',
            name: '项目管理部',
            code: '160',
            createdAt: '2023-12-01 09:37:07',
            source: '本地',
          },
          {
            key: '171',
            name: '项目交付部',
            code: '171',
            createdAt: '2025-02-07 13:55:34',
            source: '本地',
          },
        ],
      },
      {
        key: '119',
        name: '人力资源中心',
        code: '119',
        createdAt: '2023-02-02 17:02:11',
        source: '本地',
        children: [
          {
            key: '19',
            name: '人力资源部',
            code: '19',
            createdAt: '2022-06-09 09:47:40',
            source: '本地',
          },
        ],
      },
      {
        key: '10',
        name: '生态发展中心',
        code: '10',
        createdAt: '2022-06-09 09:47:40',
        source: '本地',
        children: [
          {
            key: '46',
            name: '生态发展部',
            code: '46',
            createdAt: '2022-06-09 09:47:40',
            source: '本地',
          },
          {
            key: '11',
            name: '福建销售部',
            code: '11',
            createdAt: '2022-06-09 09:47:40',
            source: '本地',
          },
        ],
      },
      {
        key: '13',
        name: '厦门子公司',
        code: '13',
        createdAt: '2022-06-09 09:47:40',
        source: '本地',
        children: [
          {
            key: '50',
            name: '人力资源部',
            code: '50',
            createdAt: '2022-06-09 09:47:40',
            source: '本地',
          },
          {
            key: '51',
            name: '财务部',
            code: '51',
            createdAt: '2022-06-09 09:47:40',
            source: '本地',
          },
        ],
      },
      {
        key: '200',
        name: '培训学员组织',
        code: '200',
        createdAt: '2022-06-09 09:47:40',
        source: '本地',
      },
    ],
  },
]

export function loadDepartments(): DepartmentRecord[] {
  const raw = window.localStorage.getItem(DEPARTMENT_STORAGE_KEY)
  if (!raw) return initialDepartments

  try {
    const parsed = JSON.parse(raw) as DepartmentRecord[]
    return Array.isArray(parsed) ? parsed : initialDepartments
  } catch {
    return initialDepartments
  }
}

export function saveDepartments(departments: DepartmentRecord[]) {
  window.localStorage.setItem(DEPARTMENT_STORAGE_KEY, JSON.stringify(departments))
  window.dispatchEvent(new Event(DEPARTMENT_STORAGE_EVENT))
}

export async function fetchDepartmentsFromApi() {
  const departments = await apiRequest<DepartmentRecord[]>('/admin/departments')
  saveDepartments(departments)
  return departments
}

export async function createDepartmentOnApi(input: {
  name: string
  code: string
  parentKey?: string
}) {
  await apiRequest<DepartmentRecord>('/admin/departments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return fetchDepartmentsFromApi()
}

export async function updateDepartmentOnApi(
  id: string,
  input: {
    name: string
    code: string
  },
) {
  await apiRequest<DepartmentRecord>(`/admin/departments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return fetchDepartmentsFromApi()
}

export async function deleteDepartmentOnApi(id: string) {
  await apiRequest<{ id: string; removedIds: string[] }>(`/admin/departments/${id}`, {
    method: 'DELETE',
  })
  return fetchDepartmentsFromApi()
}

export function walkDepartments(
  records: DepartmentRecord[],
  depth = 0,
): Array<DepartmentRecord & { depth: number }> {
  return records.flatMap((record) => [
    { ...record, depth },
    ...walkDepartments(record.children || [], depth + 1),
  ])
}

export function getDepartmentOptions(records = loadDepartments()) {
  return walkDepartments(records).map((department) => ({
    label: `${'　'.repeat(department.depth)}${department.name}`,
    value: department.key,
    name: department.name,
    depth: department.depth,
  }))
}

export function appendDepartment(
  records: DepartmentRecord[],
  parentKey: string | undefined,
  nextRecord: DepartmentRecord,
): DepartmentRecord[] {
  if (!parentKey) {
    return [...records, nextRecord]
  }

  return records.map((record) => {
    if (record.key === parentKey) {
      return {
        ...record,
        children: [...(record.children || []), nextRecord],
      }
    }

    return {
      ...record,
      children: record.children ? appendDepartment(record.children, parentKey, nextRecord) : undefined,
    }
  })
}

export function updateDepartmentByKey(
  records: DepartmentRecord[],
  targetKey: string,
  values: { name: string; code: string; createdAt: string },
): DepartmentRecord[] {
  return records.map((record) => {
    if (record.key === targetKey) {
      return {
        ...record,
        name: values.name,
        code: values.code,
        createdAt: values.createdAt,
      }
    }

    return {
      ...record,
      children: record.children ? updateDepartmentByKey(record.children, targetKey, values) : undefined,
    }
  })
}

export function collectDepartmentNames(records: DepartmentRecord[]) {
  return walkDepartments(records).map((department) => department.name)
}

export function collectDepartmentNamesByKey(
  records: DepartmentRecord[],
  targetKey: string,
  includeChildren = true,
): string[] {
  const target = walkDepartments(records).find((department) => department.key === targetKey)
  if (!target) return []
  const names = new Set<string>([target.name])
  if (!includeChildren) return Array.from(names)

  const findInTree = (items: DepartmentRecord[]): DepartmentRecord | undefined => {
    for (const item of items) {
      if (item.key === targetKey) return item
      const child = item.children ? findInTree(item.children) : undefined
      if (child) return child
    }
    return undefined
  }

  const targetTree = findInTree(records)
  if (targetTree?.children) {
    walkDepartments(targetTree.children).forEach((department) => names.add(department.name))
  }
  return Array.from(names)
}

export function collectDepartmentNamesByName(
  records: DepartmentRecord[],
  targetName: string,
  includeChildren = true,
): string[] {
  const names = new Set<string>()

  const collect = (items: DepartmentRecord[]) => {
    items.forEach((item) => {
      if (item.name === targetName) {
        names.add(item.name)
        if (includeChildren) {
          walkDepartments(item.children || []).forEach((department) => names.add(department.name))
        }
      }
      collect(item.children || [])
    })
  }

  collect(records)
  return Array.from(names)
}

export function removeDepartmentByKey(
  records: DepartmentRecord[],
  targetKey: string,
): { nextDepartments: DepartmentRecord[]; removedNames: string[] } {
  const removedNames = collectDepartmentNamesByKey(records, targetKey, true)
  const nextDepartments: DepartmentRecord[] = records
    .filter((record) => record.key !== targetKey)
    .map((record) => ({
      ...record,
      children: record.children ? removeDepartmentByKey(record.children, targetKey).nextDepartments : undefined,
    }))

  return { nextDepartments, removedNames }
}
