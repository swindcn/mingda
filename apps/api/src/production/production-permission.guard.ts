import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Request } from 'express'
import { getAdminContext, hasAdminPermission, type RequestWithAdmin } from '../shared/admin-context'

function permissionFor(request: Request): string | string[] {
  const path = request.path.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  const method = request.method.toUpperCase()
  const isMiniProgram = path.includes('/mini/production/')
  if (path.includes('/inspection-task') || path.includes('/inspection-report') || path.includes('/inspection/')) {
    const prefix = isMiniProgram ? 'mini.production.inspection' : 'production.inspection'
    if (!isMiniProgram && /\/inspection-reports\/[^/]+\/reverse$/.test(path)) return 'production.inspection.reverse'
    if (method === 'POST' && /\/inspection\/reports$/.test(path)) return `${prefix}.report`
    if (method === 'GET' && /\/inspection-tasks(?:\/[^/]+(?:\/(?:options|defect-options|trace))?)?$/.test(path)) return `${prefix}.view`
    throw new NotFoundException('生产管理资源不存在')
  }
  if (path.includes('/cleaning-rework-task') || path.includes('/cleaning-rework/')) {
    const prefix = isMiniProgram ? 'mini.production.cleaning_rework' : 'production.cleaning_rework'
    if (method === 'POST' && /\/cleaning-rework\/reports$/.test(path)) return `${prefix}.report`
    if (method === 'GET' && /\/cleaning-rework-tasks(?:\/[^/]+)?$/.test(path)) return `${prefix}.view`
    throw new NotFoundException('生产管理资源不存在')
  }
  if (path.includes('/shake-clean-task') || path.includes('/shake-clean/') || path.includes('/shake-reports/') || path.includes('/cleaning-reports/')) {
    const prefix = isMiniProgram ? 'mini.production.shake_clean' : 'production.shake_clean'
    if (!isMiniProgram && /\/(?:shake|cleaning)-reports\/[^/]+\/reverse$/.test(path)) return 'production.shake_clean.reverse'
    if (method === 'POST' && /\/shake-clean\/shake\/check$/.test(path)) return `${prefix}.shake_report`
    if (method === 'POST' && /\/shake-clean\/shake\/reports$/.test(path)) return `${prefix}.shake_report`
    if (method === 'POST' && /\/shake-clean\/cleaning\/reports$/.test(path)) return `${prefix}.clean_report`
    if (method === 'GET' && /\/shake-clean-tasks(?:\/[^/]+\/(?:options|reports|trace|defect-options))?$/.test(path)) return `${prefix}.view`
    throw new NotFoundException('生产管理资源不存在')
  }
  if (path.includes('/pouring-task') || path.includes('/pouring-report') || path.includes('/pouring/')) {
    const prefix = isMiniProgram ? 'mini.production.pouring' : 'production.pouring'
    if (/\/pouring-reports\/[^/]+\/reverse$/.test(path)) return 'production.pouring.reverse'
    if (method === 'POST' && (/\/pouring\/reports$/.test(path) || /\/pouring\/check$/.test(path))) return `${prefix}.report`
    if (method === 'GET' && /\/pouring-tasks(?:\/[^/]+\/(?:options|reports|defect-options))?$/.test(path)) return `${prefix}.view`
    throw new NotFoundException('生产管理资源不存在')
  }
  if (path.includes('/molding-task') || path.includes('/molding-report')) {
    const prefix = isMiniProgram ? 'mini.production.molding' : 'production.molding'
    if (/\/work-orders\/[^/]+\/molding-task\/preview$/.test(path)) return 'production.molding.create'
    if (/\/work-orders\/[^/]+\/molding-task$/.test(path)) return 'production.molding.create'
    if (/\/molding-tasks\/[^/]+\/dispatch$/.test(path)) return 'production.molding.dispatch'
    if (/\/molding-tasks\/[^/]+\/start$/.test(path)) return `${prefix}.start`
    if (/\/molding-tasks\/[^/]+\/report$/.test(path)) return `${prefix}.report`
    if (/\/molding-tasks\/[^/]+\/cancel$/.test(path)) return 'production.molding.cancel'
    if (/\/molding-reports\/[^/]+\/reverse$/.test(path)) return 'production.molding.reverse'
    if (method === 'GET' && /\/molding-tasks(?:\/by-code\/[^/]+|\/[^/]+(?:\/defect-options)?)?$/.test(path)) return `${prefix}.view`
    throw new NotFoundException('生产管理资源不存在')
  }
  if (/\/work-orders\/[^/]+\/core-readiness$/.test(path)) return 'production.work_order.view'
  if (path.includes('/core-tasks')) {
    if (/\/work-orders\/[^/]+\/core-tasks\/preview$/.test(path)) {
      if (method === 'POST') return 'production.core_task.create'
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/work-orders\/[^/]+\/core-tasks$/.test(path)) {
      if (method === 'POST') return 'production.core_task.create'
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-tasks\/[^/]+\/dispatch$/.test(path)) {
      if (method === 'PUT') return 'production.core_task.dispatch'
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-tasks\/[^/]+\/cancel$/.test(path)) {
      if (method === 'POST') return 'production.core_task.cancel'
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-tasks\/[^/]+\/(?:options|execution-options|drying-batches|defect-options)$/.test(path)) {
      if (method === 'GET') return isMiniProgram ? 'mini.production.core.view' : 'production.core_task.view'
      throw new NotFoundException('生产管理资源不存在')
    }
    const corePermissionPrefix = isMiniProgram ? 'mini.production.core' : 'production.core_task'
    if (/\/core-tasks\/[^/]+\/start$/.test(path)) {
      if (method === 'POST') return `${corePermissionPrefix}.start`
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-tasks\/[^/]+\/report$/.test(path)) {
      if (method === 'POST') return `${corePermissionPrefix}.report`
      throw new NotFoundException('生产管理资源不存在')
    }
    if (method === 'GET' && /\/core-tasks(?:\/[^/]+)?$/.test(path)) return `${corePermissionPrefix}.view`
    throw new NotFoundException('生产管理资源不存在')
  }
  if (path.includes('/core-batches')) {
    if (/\/core-batches\/dry$/.test(path)) {
      if (method === 'POST') return isMiniProgram
        ? 'mini.production.core.dry'
        : ['production.core_task.dry', 'production.core_inventory.dry']
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-batches\/[^/]+\/dry$/.test(path)) {
      if (method === 'POST') return isMiniProgram
        ? 'mini.production.core.dry'
        : ['production.core_task.dry', 'production.core_inventory.dry']
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-batches\/[^/]+\/(?:lock|unlock)$/.test(path)) {
      if (method === 'POST') return 'production.core_inventory.lock'
      throw new NotFoundException('生产管理资源不存在')
    }
    if (/\/core-batches\/[^/]+\/scrap$/.test(path)) {
      if (method === 'POST') return 'production.core_inventory.scrap'
      throw new NotFoundException('生产管理资源不存在')
    }
    throw new NotFoundException('生产管理资源不存在')
  }
  if (path.includes('/core-inventory')) {
    if (method === 'GET' && /\/core-inventory(?:\/[^/]+)?$/.test(path)) return 'production.core_inventory.view'
    throw new NotFoundException('生产管理资源不存在')
  }
  // These work-order subroutes must be resolved before the generic work-order method mapping.
  if (/\/work-orders\/[^/]+\/routing-execution$/.test(path)) {
    if (method === 'GET') return 'production.work_order.view'
    throw new NotFoundException('生产管理资源不存在')
  }
  if (/\/work-orders\/[^/]+\/melt-release$/.test(path)) {
    if (method === 'POST') return 'production.schedule.release'
    throw new NotFoundException('生产管理资源不存在')
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

function hasAnyProductionPermission(user: ReturnType<typeof getAdminContext>, requirement: string | string[]) {
  const permissions = Array.isArray(requirement) ? requirement : [requirement]
  return permissions.some((permission) => hasAdminPermission(user, permission))
}

@Injectable()
export class ProductionPermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>()
    const user = getAdminContext(request)
    const permission = permissionFor(request)
    if (!hasAnyProductionPermission(user, permission)) throw new ForbiddenException('无权执行当前操作')
    return true
  }
}
