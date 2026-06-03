import { DataScope, type PrismaClient } from '@prisma/client'
import type { Request } from 'express'

export interface AdminContext {
  id: string
  name: string
  username: string | null
  userType: string
  departmentId: string | null
  permissions: string[]
  dataScope: DataScope
  dataScopes: DataScope[]
  customDepartments: Array<{ departmentId: string; includeChildren: boolean }>
}

export type RequestWithAdmin = Request & { adminUser?: AdminContext }

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function customDepartmentArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is { departmentId: string; includeChildren?: boolean } =>
        typeof item === 'object' &&
        item !== null &&
        'departmentId' in item &&
        typeof item.departmentId === 'string',
    )
    .map((item) => ({ departmentId: item.departmentId, includeChildren: Boolean(item.includeChildren) }))
}

function strongestScope(scopes: DataScope[]): DataScope {
  if (scopes.includes('ALL')) return 'ALL'
  if (scopes.includes('OWN_AND_CHILD_DEPARTMENTS')) return 'OWN_AND_CHILD_DEPARTMENTS'
  if (scopes.includes('OWN_DEPARTMENT')) return 'OWN_DEPARTMENT'
  if (scopes.includes('CUSTOM_DEPARTMENTS')) return 'CUSTOM_DEPARTMENTS'
  return 'OWN'
}

function dataScopeArray(value: unknown, fallback: DataScope) {
  const dataScopeValues = new Set(Object.values(DataScope))
  const scopes = Array.isArray(value)
    ? value.filter((item): item is DataScope => typeof item === 'string' && dataScopeValues.has(item as DataScope))
    : []
  return scopes.length ? scopes : [fallback]
}

export async function buildAdminContext(prisma: PrismaClient, userId: string): Promise<AdminContext | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      username: true,
      userType: true,
      departmentId: true,
      roles: { include: { role: true } },
    },
  })
  if (!user) return null

  const roles = user.roles.map((item) => item.role)
  const roleScopes = roles.flatMap((role) => dataScopeArray(role.dataScopes, role.dataScope))
  const dataScopes = user.username === 'admin' || user.userType === 'SUPER_ADMIN' ? ['ALL' as DataScope] : Array.from(new Set(roleScopes))
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    userType: user.userType,
    departmentId: user.departmentId,
    permissions: Array.from(new Set(roles.flatMap((role) => stringArray(role.permissions)))),
    dataScope: strongestScope(dataScopes),
    dataScopes,
    customDepartments: roles.flatMap((role) => customDepartmentArray(role.customDepartments)),
  }
}

export function getAdminContext(request: Request): AdminContext {
  const user = (request as RequestWithAdmin).adminUser
  if (!user) throw new Error('Admin context is missing')
  return user
}

export function hasAdminPermission(user: AdminContext, permission: string) {
  if (user.username === 'admin' || user.userType === 'SUPER_ADMIN') return true
  return user.permissions.includes(permission)
}

export async function collectDepartmentIds(prisma: PrismaClient, rootId: string, includeChildren: boolean) {
  if (!includeChildren) return [rootId]

  const records = await prisma.department.findMany({ select: { id: true, parentId: true } })
  const childrenByParent = new Map<string, string[]>()
  records.forEach((record) => {
    if (!record.parentId) return
    childrenByParent.set(record.parentId, [...(childrenByParent.get(record.parentId) || []), record.id])
  })

  const result = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()
    if (!current) continue
    for (const child of childrenByParent.get(current) || []) {
      if (result.has(child)) continue
      result.add(child)
      queue.push(child)
    }
  }
  return Array.from(result)
}

const publicSyncEntityPermissions: Record<string, string> = {
  'basic:products': 'basic.product.view_synced_public',
  'modeling:items': 'basic.product.view_synced_public',
}

export async function visibleOwnershipEntityIds(prisma: PrismaClient, user: AdminContext, entityType: string) {
  const scopes = user.dataScopes?.length ? user.dataScopes : [user.dataScope]
  if (scopes.includes('ALL')) return null

  const orConditions: Array<Record<string, unknown>> = []
  if (scopes.includes('OWN')) {
    orConditions.push({ createdByUserId: user.id }, { ownerUserId: user.id })
  }
  if (scopes.includes('OWN_DEPARTMENT') && user.departmentId) {
    const departmentIds = await collectDepartmentIds(prisma, user.departmentId, false)
    orConditions.push({ createdByDepartmentId: { in: departmentIds } }, { ownerDepartmentId: { in: departmentIds } })
  }
  if (scopes.includes('OWN_AND_CHILD_DEPARTMENTS') && user.departmentId) {
    const departmentIds = await collectDepartmentIds(prisma, user.departmentId, true)
    orConditions.push({ createdByDepartmentId: { in: departmentIds } }, { ownerDepartmentId: { in: departmentIds } })
  }
  if (scopes.includes('CUSTOM_DEPARTMENTS')) {
    const departmentIds = Array.from(
      new Set(
        (
          await Promise.all(
            user.customDepartments.map((item) => collectDepartmentIds(prisma, item.departmentId, item.includeChildren)),
          )
        ).flat(),
      ),
    )
    if (departmentIds.length) {
      orConditions.push({ createdByDepartmentId: { in: departmentIds } }, { ownerDepartmentId: { in: departmentIds } })
    }
  }
  const publicPermission = publicSyncEntityPermissions[entityType]
  if (publicPermission && hasAdminPermission(user, publicPermission)) {
    orConditions.push({
      createdByUserId: null,
      ownerUserId: null,
      createdByDepartmentId: null,
      ownerDepartmentId: null,
    })
  }

  if (!orConditions.length) return []
  const records = await prisma.businessDataOwnership.findMany({
    where: { entityType, OR: orConditions },
    select: { entityId: true },
  })
  return records.map((record) => record.entityId)
}

export async function upsertOwnership(
  prisma: PrismaClient,
  user: AdminContext | undefined,
  entityType: string,
  entityId: string,
) {
  if (!user) return
  await prisma.businessDataOwnership.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    update: {
      ownerUserId: user.id,
      ownerDepartmentId: user.departmentId,
    },
    create: {
      entityType,
      entityId,
      createdByUserId: user.id,
      createdByDepartmentId: user.departmentId,
      ownerUserId: user.id,
      ownerDepartmentId: user.departmentId,
    },
  })
}
