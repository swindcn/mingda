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

export const modelingPermissionKeys = [
  'model',
  'model.workshop-line.view',
  'model.workshop-line.create',
  'model.workshop-line.edit',
  'model.workshop-line.delete',
  'model.team.view',
  'model.team.create',
  'model.team.edit',
  'model.team.delete',
  'model.equipment.view',
  'model.equipment.create',
  'model.equipment.edit',
  'model.equipment.delete',
  'model.material.view',
  'model.material.create',
  'model.material.edit',
  'model.material.delete',
  'model.recipe.view',
  'model.recipe.create',
  'model.recipe.edit',
  'model.recipe.delete',
  'model.routing.view',
  'model.routing.create',
  'model.routing.edit',
  'model.routing.delete',
  'model.calendar.view',
  'model.calendar.create',
  'model.calendar.edit',
  'model.calendar.delete',
  'model.schedule.view',
  'model.schedule.create',
  'model.schedule.edit',
  'model.schedule.delete',
  'model.schedule.batch',
  'model.defect.view',
  'model.defect.create',
  'model.defect.edit',
  'model.defect.delete',
  'mold.model.view',
  'mold.model.create',
  'mold.model.edit',
  'mold.model.delete',
  'mold.corebox.view',
  'mold.corebox.create',
  'mold.corebox.edit',
  'mold.corebox.delete',
] as const

export const permissionTree: DataNode[] = [
  {
    title: '管理端',
    key: 'admin',
    children: [
      {
        title: '基础资料',
        key: 'basic',
        children: [
          {
            title: '部门管理',
            key: 'basic.department',
            children: [
              { title: '部门管理-新增', key: 'basic.department.create' },
              { title: '部门管理-编辑', key: 'basic.department.edit' },
              { title: '部门管理-删除', key: 'basic.department.delete' },
            ],
          },
          { title: '用户管理', key: 'basic.user' },
          { title: '角色权限', key: 'basic.role' },
          { title: '客户管理', key: 'basic.customer' },
          { title: '供应商管理', key: 'basic.supplier' },
          { title: '物料管理', key: 'basic.product' },
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
          {
            title: '模具档案',
            key: 'mold.model.view',
            children: [
              { title: '模具档案-新增', key: 'mold.model.create' },
              { title: '模具档案-编辑', key: 'mold.model.edit' },
              { title: '模具档案-删除', key: 'mold.model.delete' },
            ],
          },
          {
            title: '芯盒档案',
            key: 'mold.corebox.view',
            children: [
              { title: '芯盒档案-新增', key: 'mold.corebox.create' },
              { title: '芯盒档案-编辑', key: 'mold.corebox.edit' },
              { title: '芯盒档案-删除', key: 'mold.corebox.delete' },
            ],
          },
        ],
      },
      {
        title: '生产建模',
        key: 'model',
        children: [
          {
            title: '车间与产线',
            key: 'model.workshop-line.view',
            children: [
              { title: '车间与产线-新增', key: 'model.workshop-line.create' },
              { title: '车间与产线-编辑', key: 'model.workshop-line.edit' },
              { title: '车间与产线-删除', key: 'model.workshop-line.delete' },
            ],
          },
          {
            title: '班组配置',
            key: 'model.team.view',
            children: [
              { title: '班组配置-新增', key: 'model.team.create' },
              { title: '班组配置-编辑', key: 'model.team.edit' },
              { title: '班组配置-删除', key: 'model.team.delete' },
            ],
          },
          {
            title: '设备配置',
            key: 'model.equipment.view',
            children: [
              { title: '设备配置-新增', key: 'model.equipment.create' },
              { title: '设备配置-编辑', key: 'model.equipment.edit' },
              { title: '设备配置-删除', key: 'model.equipment.delete' },
            ],
          },
          {
            title: '材质牌号',
            key: 'model.material.view',
            children: [
              { title: '材质牌号-新增', key: 'model.material.create' },
              { title: '材质牌号-编辑', key: 'model.material.edit' },
              { title: '材质牌号-删除', key: 'model.material.delete' },
            ],
          },
          {
            title: '熔炼配方',
            key: 'model.recipe.view',
            children: [
              { title: '熔炼配方-新增', key: 'model.recipe.create' },
              { title: '熔炼配方-编辑', key: 'model.recipe.edit' },
              { title: '熔炼配方-删除', key: 'model.recipe.delete' },
            ],
          },
          {
            title: '工艺路线',
            key: 'model.routing.view',
            children: [
              { title: '工艺路线-新增', key: 'model.routing.create' },
              { title: '工艺路线-编辑', key: 'model.routing.edit' },
              { title: '工艺路线-删除', key: 'model.routing.delete' },
            ],
          },
          {
            title: '工厂日历',
            key: 'model.calendar.view',
            children: [
              { title: '工厂日历-新增', key: 'model.calendar.create' },
              { title: '工厂日历-编辑', key: 'model.calendar.edit' },
              { title: '工厂日历-删除', key: 'model.calendar.delete' },
            ],
          },
          {
            title: '动态排班表',
            key: 'model.schedule.view',
            children: [
              { title: '动态排班表-新增', key: 'model.schedule.create' },
              { title: '动态排班表-编辑', key: 'model.schedule.edit' },
              { title: '动态排班表-删除', key: 'model.schedule.delete' },
              { title: '动态排班表-一键生成', key: 'model.schedule.batch' },
            ],
          },
          {
            title: '缺陷代码库',
            key: 'model.defect.view',
            children: [
              { title: '缺陷代码库-新增', key: 'model.defect.create' },
              { title: '缺陷代码库-编辑', key: 'model.defect.edit' },
              { title: '缺陷代码库-删除', key: 'model.defect.delete' },
            ],
          },
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
      'basic.department.create',
      'basic.department.edit',
      'basic.department.delete',
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
      ...modelingPermissionKeys,
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
