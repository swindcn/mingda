import type { DataNode } from 'antd/es/tree'
import { apiRequest } from '../services/api'
import { loadUsers } from './users'

export const ROLE_STORAGE_KEY = 'mingda-roles'
export const ROLE_STORAGE_EVENT = 'mingda-roles-updated'

export type DataScope = 'self' | 'department' | 'department_tree' | 'organization' | 'custom_departments'

export interface RoleRecord {
  id: string
  name: string
  organization: string
  app: string
  description?: string
  createdBy: string
  createdAt: string
  permissions: string[]
  dataScope: DataScope
  customDepartments: Array<{ departmentId: string; includeChildren: boolean }>
  columnPermissions: string[]
  userIds: string[]
}

export interface AdminUser {
  id: string
  name: string
  userType: string
  username?: string
  permissions?: string[]
  dataScope?: DataScope
  columnPermissions?: string[]
}

export const permissionTree: DataNode[] = [
  {
    title: '管理端',
    key: 'admin',
    children: [
      {
        title: '基础资料',
        key: 'basic',
        children: [
          { title: '部门管理', key: 'basic.department' },
          { title: '用户管理', key: 'basic.user' },
          { title: '角色权限', key: 'basic.role' },
          { title: '客户管理', key: 'basic.customer' },
          { title: '供应商管理', key: 'basic.supplier' },
          { title: '产品管理', key: 'basic.product' },
          { title: '字典设置', key: 'basic.dictionary' },
        ],
      },
      {
        title: '模具业务',
        key: 'mold',
        children: [
          { title: '模具开发-查看', key: 'mold.development.view' },
          { title: '模具开发-下达', key: 'mold.development.create' },
          { title: '模具开发-编辑', key: 'mold.development.edit' },
          { title: '模具开发-删除', key: 'mold.development.delete' },
        ],
      },
    ],
  },
]

export const dataScopeLabels: Record<DataScope, string> = {
  self: '本人数据',
  department: '本部门数据',
  department_tree: '本部门及下级部门',
  organization: '全组织数据',
  custom_departments: '自定义部门',
}

export const initialRoles: RoleRecord[] = [
  {
    id: 'R000',
    name: '系统管理员',
    organization: '摩尔元数（福建）科技有限公司',
    app: '管理端',
    description: '系统内置管理员角色，拥有全部管理端权限。',
    createdBy: '系统',
    createdAt: '2026-05-25 00:00:00',
    permissions: [
      'admin',
      'basic',
      'basic.department',
      'basic.user',
      'basic.role',
      'basic.customer',
      'basic.supplier',
      'basic.product',
      'basic.dictionary',
      'mold',
      'mold.development.view',
      'mold.development.create',
      'mold.development.edit',
      'mold.development.delete',
    ],
    dataScope: 'organization',
    customDepartments: [],
    columnPermissions: [],
    userIds: [],
  },
]

export function loadRoles() {
  const raw = window.localStorage.getItem(ROLE_STORAGE_KEY)
  if (!raw) return initialRoles

  try {
    const parsed = JSON.parse(raw) as RoleRecord[]
    return Array.isArray(parsed) ? parsed : initialRoles
  } catch {
    return initialRoles
  }
}

export function saveRoles(roles: RoleRecord[]) {
  window.localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(roles))
  window.dispatchEvent(new Event(ROLE_STORAGE_EVENT))
}

export async function fetchRolesFromApi() {
  const roles = await apiRequest<RoleRecord[]>('/admin/roles')
  saveRoles(roles)
  return roles
}

export async function createRoleOnApi(role: Partial<RoleRecord>) {
  const created = await apiRequest<RoleRecord>('/admin/roles', {
    method: 'POST',
    body: JSON.stringify(role),
  })
  await fetchRolesFromApi()
  return created
}

export async function updateRoleOnApi(id: string, role: Partial<RoleRecord>) {
  const updated = await apiRequest<RoleRecord>(`/admin/roles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(role),
  })
  await fetchRolesFromApi()
  return updated
}

export async function deleteRoleOnApi(id: string) {
  const result = await apiRequest<{ id: string }>(`/admin/roles/${id}`, {
    method: 'DELETE',
  })
  await fetchRolesFromApi()
  return result
}

export function getCurrentAdminUser(): AdminUser | null {
  const raw = window.localStorage.getItem('mingda-admin-user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdminUser
  } catch {
    return null
  }
}

export function isSystemAdmin(user = getCurrentAdminUser()) {
  return user?.username === 'admin' || user?.name === '系统管理员'
}

export function getEffectiveRoles(user = getCurrentAdminUser()) {
  const roles = loadRoles()
  if (isSystemAdmin(user)) return roles.filter((role) => role.name === '系统管理员')
  if (!user) return []

  const localUser = loadUsers().find((item) => item.id === user.id || item.name === user.name)
  return roles.filter(
    (role) =>
      role.userIds.includes(user.id) ||
      (localUser ? role.userIds.includes(localUser.id) || role.name === localUser.role : false),
  )
}

export function hasPermission(permission: string) {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return true
  if (Array.isArray(user?.permissions)) return user.permissions.includes(permission)
  return getEffectiveRoles().some((role) => role.permissions.includes(permission))
}

export function getCurrentDataScope(): DataScope {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return 'organization'
  if (user?.dataScope) return user.dataScope
  return getEffectiveRoles()[0]?.dataScope || 'self'
}

export function getCurrentColumnPermissions() {
  const user = getCurrentAdminUser()
  if (isSystemAdmin(user)) return []
  if (Array.isArray(user?.columnPermissions)) return user.columnPermissions
  return Array.from(new Set(getEffectiveRoles().flatMap((role) => role.columnPermissions)))
}
