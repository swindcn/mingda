import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Request } from 'express'
import { getAdminContext, hasAdminPermission } from './admin-context'

function hasBodyKey(request: Request, key: string) {
  const body = request.body as Record<string, unknown> | undefined
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key))
}

const basicPermissions: Record<string, string> = {
  dictionaries: 'basic.dictionary',
  departments: 'basic.department',
  users: 'basic.user',
  roles: 'basic.role',
  customers: 'basic.customer',
  suppliers: 'basic.supplier',
  products: 'basic.product',
}

function actionPermission(resource: string, method: string) {
  const basePermission = basicPermissions[resource]
  if (!basePermission) return undefined

  if (method === 'GET') return basePermission

  if (resource === 'departments' && method === 'POST') return 'basic.department.create'
  if (resource === 'users' && method === 'POST') return 'basic.user.create'
  if (resource === 'roles' && method === 'POST') return 'basic.role.create'

  if (resource === 'departments' && method === 'PATCH') return 'basic.department.edit'
  if (resource === 'departments' && method === 'DELETE') return 'basic.department.delete'
  if (resource === 'departments' && method === 'PUT') return 'basic.department.edit'

  if (resource === 'users' && (method === 'PUT' || method === 'PATCH')) return 'basic.user.edit'
  if (resource === 'users' && method === 'DELETE') return 'basic.user.delete'

  if (resource === 'roles' && (method === 'PUT' || method === 'PATCH')) return 'basic.role.edit'
  if (resource === 'roles' && method === 'DELETE') return 'basic.role.delete'

  if (['customers', 'suppliers', 'products'].includes(resource)) {
    if (method === 'POST') return `${basePermission}.create`
    if (method === 'PUT' || method === 'PATCH') return `${basePermission}.edit`
    if (method === 'DELETE') return `${basePermission}.delete`
  }

  if (resource === 'dictionaries' && method !== 'GET') return 'basic.dictionary.edit'

  return basePermission
}

function resourceFromPath(request: Request) {
  const parts = request.path.replace(/^\/+/, '').split('/')
  const adminIndex = parts.indexOf('admin')
  return adminIndex >= 0 ? parts[adminIndex + 1] : parts[0]
}

function permissionFromPath(request: Request) {
  if (request.path.endsWith('/departments/sync') && request.method === 'POST') return 'basic.department.sync'
  if (request.path.endsWith('/users/sync') && request.method === 'POST') return 'basic.user.sync'
  if (request.path.includes('/users/') && request.path.endsWith('/restore') && request.method === 'PUT') return 'basic.user.edit'
  if (request.path.includes('/users/') && request.path.endsWith('/permanent') && request.method === 'DELETE') return 'basic.user.delete'
  if (request.path.includes('/roles/') && request.method === 'PUT') {
    if (
      hasBodyKey(request, 'permissions') ||
      hasBodyKey(request, 'dataScope') ||
      hasBodyKey(request, 'dataScopes') ||
      hasBodyKey(request, 'customDepartments') ||
      hasBodyKey(request, 'columnPermissions')
    ) {
      return 'basic.role.config'
    }
    if (hasBodyKey(request, 'userIds')) return 'basic.role.users'
  }
  return undefined
}

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>()
    const user = getAdminContext(request)
    const resource = resourceFromPath(request)
    const permission = permissionFromPath(request) || actionPermission(resource, request.method)
    if (!permission) throw new NotFoundException('资源不存在')
    if (hasAdminPermission(user, permission)) return true
    throw new ForbiddenException('无权执行当前操作')
  }
}
