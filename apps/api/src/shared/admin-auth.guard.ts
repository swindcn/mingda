import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>()
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')

    if (!token?.startsWith('db-token-')) {
      throw new UnauthorizedException('请先登录')
    }

    const userId = token.replace('db-token-', '')
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
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

    return true
  }
}
