import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { buildAdminContext, type RequestWithAdmin } from './admin-context'
import { extractBearerToken, verifyAdminToken } from './auth-token'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>()
    const verifiedToken = verifyAdminToken(extractBearerToken(request.headers.authorization))

    if (!verifiedToken) {
      throw new UnauthorizedException('登录已过期，请重新登录')
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: verifiedToken.userId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        lockStatus: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException('登录状态已失效')
    }
    if (user.status !== 'ENABLED' || user.lockStatus !== 'NORMAL') {
      throw new ForbiddenException('账号已禁用或锁定')
    }

    const adminContext = await buildAdminContext(this.prisma, verifiedToken.userId)
    if (!adminContext) {
      throw new UnauthorizedException('登录状态已失效')
    }
    request.adminUser = adminContext

    return true
  }
}
