import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { extractBearerToken, verifyAdminToken } from './auth-token'

const resourcePermissions: Record<string, string> = {
  workshops: 'model.workshop-line',
  lines: 'model.workshop-line',
  teams: 'model.team',
  equipment: 'model.equipment',
  items: 'basic.product',
  materials: 'model.material',
  recipes: 'model.recipe',
  boms: 'model.bom',
  operations: 'model.operation',
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
  if (request.path.endsWith('/admin/modeling/recipe-options')) return 'view'
  if (request.path.endsWith('/admin/modeling/boms/options')) return 'view'
  if (request.path.endsWith('/admin/modeling/operations/options')) return 'view'
  if (request.path.endsWith('/admin/modeling/routings/options')) return 'view'
  if (request.path.endsWith('/admin/modeling/schedules/batch-generate')) return 'batch'
  if (/\/admin\/modeling\/recipes\/[^/]+\/clone$/.test(request.path)) return 'clone'
  if (/\/admin\/modeling\/recipes\/[^/]+\/activate$/.test(request.path)) return 'activate'
  if (/\/admin\/modeling\/recipes\/[^/]+\/disable$/.test(request.path)) return 'disable'
  if (/\/admin\/modeling\/boms\/[^/]+\/new-version$/.test(request.path)) return 'new_version'
  if (/\/admin\/modeling\/boms\/[^/]+\/clone$/.test(request.path)) return 'clone'
  if (/\/admin\/modeling\/boms\/[^/]+\/activate$/.test(request.path)) return 'activate'
  if (/\/admin\/modeling\/boms\/[^/]+\/disable$/.test(request.path)) return 'disable'
  if (/\/admin\/modeling\/operations\/[^/]+\/disable$/.test(request.path)) return 'disable'
  if (/\/admin\/modeling\/operations\/[^/]+\/enable$/.test(request.path)) return 'disable'
  if (/\/admin\/modeling\/routings\/[^/]+\/new-version$/.test(request.path)) return 'version'
  if (/\/admin\/modeling\/routings\/[^/]+\/clone$/.test(request.path)) return 'clone'
  if (/\/admin\/modeling\/routings\/[^/]+\/activate$/.test(request.path)) return 'activate'
  if (/\/admin\/modeling\/routings\/[^/]+\/disable$/.test(request.path)) return 'disable'
  if (/\/admin\/modeling\/routings\/[^/]+\/(recycle|restore)$/.test(request.path)) return 'recycle'
  if (/\/admin\/modeling\/routings\/[^/]+\/default-products$/.test(request.path)) return 'default'
  if (/\/admin\/modeling\/routings\/[^/]+\/applicable-products$/.test(request.path)) return 'edit'
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
    const verifiedToken = verifyAdminToken(extractBearerToken(request.headers.authorization))
    if (!verifiedToken) throw new UnauthorizedException('登录已过期，请重新登录')

    if (request.path.endsWith('/admin/modeling/options') && request.method === 'GET') {
      return true
    }

    const resource = String(
      request.params.resource ||
        (request.path.endsWith('/admin/modeling/options') ? 'items' : '') ||
        (request.path.endsWith('/admin/modeling/recipe-options') ? 'recipes' : '') ||
        (request.path.includes('/recipes/') ? 'recipes' : '') ||
        (request.path.includes('/boms') ? 'boms' : '') ||
        (request.path.includes('/operations') ? 'operations' : '') ||
        (request.path.includes('/routings') ? 'routings' : '') ||
        (request.path.includes('/schedules/') ? 'schedules' : ''),
    )
    const permissionPrefix = resourcePermissions[resource]
    if (!permissionPrefix) throw new NotFoundException('资源不存在')

    const action = actionFromRequest(request)
    const requiredPermission = `${permissionPrefix}.${action}`

    const user = await this.prisma.user.findUnique({
      where: { id: verifiedToken.userId },
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
