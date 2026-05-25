import { apiRequest } from '../services/api'

export const USER_STORAGE_KEY = 'mingda-users'
export const USER_STORAGE_EVENT = 'mingda-users-updated'

export type UserType = '员工' | '供应商' | '客户'
export type UserStatus = '启用' | '禁用'
export type LockStatus = '正常' | '锁定'
export type UserSource = '本地' | '钉钉' | '企业微信' | '飞书'

export interface UserRecord {
  id: string
  name: string
  phone: string
  userType: UserType
  organization: string
  department: string
  position: string
  role: string
  status: UserStatus
  lockStatus: LockStatus
  source: UserSource
  belongsTo?: string
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export const initialUsers: UserRecord[] = [
  {
    id: 'U001',
    name: '张三',
    phone: '13800138001',
    userType: '员工',
    organization: '摩尔元数（福建）科技有限公司',
    department: '生产中心',
    position: '生产主管',
    role: '管理员',
    status: '启用',
    lockStatus: '正常',
    source: '本地',
    createdBy: '管理员',
    createdAt: '2026-05-22 09:00:00',
    updatedBy: '管理员',
    updatedAt: '2026-05-22 09:00:00',
  },
  {
    id: 'U002',
    name: '李四',
    phone: '13800138002',
    userType: '供应商',
    organization: '摩尔元数（福建）科技有限公司',
    department: '技术支持中心',
    position: '销售经理',
    role: '普通用户',
    status: '启用',
    lockStatus: '正常',
    source: '本地',
    belongsTo: '鑫源材料',
    createdBy: '管理员',
    createdAt: '2026-05-22 09:10:00',
    updatedBy: '管理员',
    updatedAt: '2026-05-22 09:10:00',
  },
]

export function loadUsers(): UserRecord[] {
  const raw = window.localStorage.getItem(USER_STORAGE_KEY)
  if (!raw) return initialUsers

  try {
    const parsed = JSON.parse(raw) as UserRecord[]
    return Array.isArray(parsed) ? parsed : initialUsers
  } catch {
    return initialUsers
  }
}

export function saveUsers(users: UserRecord[]) {
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(users))
  window.dispatchEvent(new Event(USER_STORAGE_EVENT))
}

export async function fetchUsersFromApi() {
  const users = await apiRequest<UserRecord[]>('/admin/users')
  saveUsers(users)
  return users
}

export async function createUserOnApi(user: Partial<UserRecord>) {
  const created = await apiRequest<UserRecord>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(user),
  })
  await fetchUsersFromApi()
  return created
}

export async function updateUserOnApi(id: string, user: Partial<UserRecord>) {
  const updated = await apiRequest<UserRecord>(`/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(user),
  })
  await fetchUsersFromApi()
  return updated
}

export async function deleteUserOnApi(id: string) {
  const result = await apiRequest<{ id: string }>(`/admin/users/${id}`, {
    method: 'DELETE',
  })
  await fetchUsersFromApi()
  return result
}

export function loadInternalEmployees() {
  return loadUsers().filter(
    (user) => user.userType === '员工' && user.status === '启用' && user.lockStatus === '正常',
  )
}
