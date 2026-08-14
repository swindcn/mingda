import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Request } from 'express'
import { getAdminContext, hasAdminPermission, type RequestWithAdmin } from '../shared/admin-context'

function permissionFor(request: Request) {
  const path = request.path
  const isMiniProgram = path.includes('/mini/production/')
  if (/\/work-orders\/[^/]+\/core-readiness$/.test(path)) return 'production.work_order.view'
  if (path.includes('/core-tasks')) {
    if (/\/work-orders\/[^/]+\/core-tasks\/preview$/.test(path)) return 'production.core_task.create'
    if (/\/work-orders\/[^/]+\/core-tasks$/.test(path) && request.method === 'POST') return 'production.core_task.create'
    if (/\/core-tasks\/[^/]+\/dispatch$/.test(path)) return 'production.core_task.dispatch'
    if (/\/core-tasks\/[^/]+\/cancel$/.test(path)) return 'production.core_task.cancel'
    const corePermissionPrefix = isMiniProgram ? 'mini.production.core' : 'production.core_task'
    if (/\/core-tasks\/[^/]+\/start$/.test(path)) return `${corePermissionPrefix}.start`
    if (/\/core-tasks\/[^/]+\/report$/.test(path)) return `${corePermissionPrefix}.report`
    return `${corePermissionPrefix}.view`
  }
  if (path.includes('/core-batches')) {
    if (/\/core-batches\/[^/]+\/dry$/.test(path)) {
      return isMiniProgram ? 'mini.production.core.dry' : 'production.core_inventory.dry'
    }
    if (/\/core-batches\/[^/]+\/(?:lock|unlock)$/.test(path)) return 'production.core_inventory.lock'
    if (/\/core-batches\/[^/]+\/scrap$/.test(path)) return 'production.core_inventory.scrap'
    return 'production.core_inventory.view'
  }
  if (path.includes('/core-inventory')) return 'production.core_inventory.view'
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
