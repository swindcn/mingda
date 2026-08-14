import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Request } from 'express'
import { getAdminContext, hasAdminPermission, type RequestWithAdmin } from '../shared/admin-context'

function permissionFor(request: Request) {
  const path = request.path
  const isMiniProgram = path.includes('/mini/production/')
  if (path.includes('/core-tasks')) {
    if (/\/work-orders\/[^/]+\/core-tasks\/preview$/.test(path)) return 'production.core_task.create'
    if (/\/work-orders\/[^/]+\/core-tasks$/.test(path) && request.method === 'POST') return 'production.core_task.create'
    if (/\/core-tasks\/[^/]+\/dispatch$/.test(path)) return 'production.core_task.dispatch'
    if (/\/core-tasks\/[^/]+\/cancel$/.test(path)) return 'production.core_task.cancel'
    return 'production.core_task.view'
  }
  if (path.includes('/work-orders')) {
    if (/\/work-orders\/[^/]+\/close$/.test(path)) return 'production.work_order.close'
    if (request.method === 'POST') return 'production.work_order.create'
    if (request.method === 'PUT' || request.method === 'PATCH') return 'production.work_order.edit'
    return 'production.work_order.view'
  }
  if (path.includes('/melt-pool')) return 'production.schedule.view'
  if (path.includes('/equipment-schedule')) return 'production.schedule.view'
  if (path.includes('/heat-orders')) {
    const heatPermissionPrefix = isMiniProgram ? 'mini.production.heat' : 'production.heat'
    if (/\/heat-orders\/check-conflicts$/.test(path)) return 'production.schedule.view'
    if (/\/heat-orders\/[^/]+\/schedule$/.test(path)) return 'production.schedule.adjust'
    if (/\/heat-orders\/[^/]+\/cancel$/.test(path)) return 'production.schedule.cancel'
    if (/\/heat-orders\/[^/]+\/start$/.test(path)) return `${heatPermissionPrefix}.start`
    if (/\/heat-orders\/[^/]+\/transfer$/.test(path)) return `${heatPermissionPrefix}.transfer`
    if (/\/heat-orders\/[^/]+\/complete$/.test(path)) return `${heatPermissionPrefix}.complete`
    if (request.method === 'POST') return 'production.schedule.create'
    return `${heatPermissionPrefix}.view`
  }
  throw new NotFoundException('生产管理资源不存在')
}

@Injectable()
export class ProductionPermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>()
    const user = getAdminContext(request)
    const permission = permissionFor(request)
    if (!hasAdminPermission(user, permission)) throw new ForbiddenException('无权执行当前操作')
    return true
  }
}
