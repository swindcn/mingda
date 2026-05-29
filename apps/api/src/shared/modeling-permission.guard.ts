import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'

const resourcePermissions: Record<string, string> = {
  workshops: 'model.workshop-line',
  lines: 'model.workshop-line',
  teams: 'model.team',
  equipment: 'model.equipment',
  items: 'basic.product',
  materials: 'model.material',
  recipes: 'model.recipe',
  molds: 'mold.model',
  coreboxes: 'mold.corebox',
  routings: 'model.routing',
  shifts: 'model.calendar',
  calendars: 'model.calendar',
  schedules: 'model.schedule',
  defects: 'model.defect',
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function actionFromRequest(request: Request) {
  if (request.path.endsWith('/admin/modeling/options')) return 'view'
  if (request.path.endsWith('/admin/modeling/schedules/batch-generate')) return 'batch'
  if (request.method === 'GET') return 'view'
  if (request.method === 'POST') return 'create'
  if (request.method === 'PUT' || request.method === 'PATCH') return 'edit'
  if (request.method === 'DELETE') return 'delete'
  return 'view'
}

@Injectable()
export class ModelingPermissionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>()
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
    const userId = token?.startsWith('db-token-') ? token.replace('db-token-', '') : ''
    if (!userId) throw new ForbiddenException('缺少权限')

    if (request.path.endsWith('/admin/modeling/options') && request.method === 'GET') {
      return true
    }

    const resource = String(
      request.params.resource ||
        (request.path.endsWith('/admin/modeling/options') ? 'items' : '') ||
        (request.path.includes('/schedules/') ? 'schedules' : ''),
    )
    const permissionPrefix = resourcePermissions[resource]
    if (!permissionPrefix) throw new NotFoundException('资源不存在')

    const action = actionFromRequest(request)
    const requiredPermission = `${permissionPrefix}.${action}`

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        userType: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    })
    if (!user) throw new ForbiddenException('缺少权限')
    if (user.username === 'admin' || user.userType === 'SUPER_ADMIN') return true

    const permissions = new Set(user.roles.flatMap((userRole) => stringArray(userRole.role.permissions)))
    if (permissions.has(requiredPermission)) return true
    throw new ForbiddenException('无权执行当前操作')
  }
}
