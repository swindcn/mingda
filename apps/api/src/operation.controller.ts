import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from './prisma/prisma.service'
import {
  getAdminContext,
  upsertOwnership,
  visibleOwnershipEntityIds,
  type RequestWithAdmin,
} from './shared/admin-context'
import { AdminAuthGuard } from './shared/admin-auth.guard'
import { ModelingPermissionGuard } from './shared/modeling-permission.guard'

const codePattern = /^[^\s\u4e00-\u9fff]+$/
const defaultSections = ['熔炼', '制芯', '造型', '浇注', '清理', '后处理', '质检']
const defaultOperations = [
  { code: 'OP-MELT', name: '电炉熔炼', section: '熔炼', reportMode: 'BATCH' },
  { code: 'OP-CORE', name: '射芯制芯', section: '制芯', reportMode: 'BATCH' },
  { code: 'OP-MOLD', name: '造型下芯', section: '造型', reportMode: 'BATCH' },
  { code: 'OP-POUR', name: '合型浇注', section: '浇注', reportMode: 'BATCH', pouringMergePoint: true },
  { code: 'OP-SHAKE', name: '落砂清理', section: '清理', reportMode: 'BATCH' },
  { code: 'OP-INSP', name: '成品终检', section: '质检', reportMode: 'SINGLE', qualityControlPoint: true },
]

interface OperationBody {
  code?: string
  name?: string
  section?: string
  reportMode?: string
  qualityControlPoint?: boolean
  pouringMergePoint?: boolean
  remark?: string
}

@Controller('admin/modeling/operations')
@UseGuards(AdminAuthGuard, ModelingPermissionGuard)
export class OperationController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertVisible(request: RequestWithAdmin, code: string) {
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:operations')
    if (visibleIds === null || visibleIds.includes(code) || defaultOperations.some((item) => item.code === code)) return
    throw new NotFoundException('工序不存在')
  }

  private async ensureDefaults() {
    await this.prisma.dictionarySetting.upsert({
      where: { key: 'operationSections' },
      update: {},
      create: { key: 'operationSections', values: defaultSections },
    })
    await Promise.all(
      defaultOperations.map((operation) =>
        this.prisma.operationMaster.upsert({
          where: { code: operation.code },
          update: {},
          create: operation,
        }),
      ),
    )
  }

  private async sections() {
    const setting = await this.prisma.dictionarySetting.findUnique({ where: { key: 'operationSections' } })
    const values = Array.isArray(setting?.values) ? setting.values.filter((item): item is string => typeof item === 'string') : []
    return values.length ? values : defaultSections
  }

  private async normalize(body: OperationBody, includeCode = true) {
    const code = String(body.code || '').trim()
    const name = String(body.name || '').trim()
    const section = String(body.section || '').trim()
    const reportMode = String(body.reportMode || 'BATCH').trim()
    if (includeCode && (!code || !codePattern.test(code))) throw new BadRequestException('工序编码不能为空，且不能包含中文或空格')
    if (!name) throw new BadRequestException('请输入工序名称')
    if (!(await this.sections()).includes(section)) throw new BadRequestException('请选择有效的所属工段')
    if (!['BATCH', 'SINGLE'].includes(reportMode)) throw new BadRequestException('请选择有效的报工采集模式')
    return {
      ...(includeCode ? { code } : {}),
      name,
      section,
      reportMode,
      qualityControlPoint: Boolean(body.qualityControlPoint),
      pouringMergePoint: Boolean(body.pouringMergePoint),
      remark: String(body.remark || '').trim() || null,
    }
  }

  @Get('options')
  async options(@Req() request: RequestWithAdmin) {
    await this.ensureDefaults()
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:operations')
    const operations = await this.prisma.operationMaster.findMany({
      where: { status: 'ENABLED', ...(visibleIds === null ? {} : { OR: [{ code: { in: visibleIds } }, { code: { in: defaultOperations.map((item) => item.code) } }] }) },
      orderBy: [{ section: 'asc' }, { code: 'asc' }],
    })
    return { sections: await this.sections(), operations }
  }

  @Get()
  async list(@Req() request: RequestWithAdmin, @Query('keyword') keyword?: string, @Query('status') status?: string) {
    await this.ensureDefaults()
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:operations')
    const where: Prisma.OperationMasterWhereInput = {
      ...(status ? { status } : {}),
      ...(keyword?.trim()
        ? { OR: [{ code: { contains: keyword.trim(), mode: 'insensitive' } }, { name: { contains: keyword.trim(), mode: 'insensitive' } }, { section: { contains: keyword.trim(), mode: 'insensitive' } }] }
        : {}),
      ...(visibleIds === null ? {} : { AND: [{ OR: [{ code: { in: visibleIds } }, { code: { in: defaultOperations.map((item) => item.code) } }] }] }),
    }
    return this.prisma.operationMaster.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }] })
  }

  @Post()
  async create(@Req() request: RequestWithAdmin, @Body() body: OperationBody) {
    const data = { ...(await this.normalize(body)), code: String(body.code).trim() }
    try {
      const record = await this.prisma.operationMaster.create({ data })
      await upsertOwnership(this.prisma, getAdminContext(request), 'modeling:operations', record.code)
      return record
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('工序编码已存在')
      throw error
    }
  }

  @Put(':id')
  async update(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: OperationBody) {
    const existing = await this.prisma.operationMaster.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('工序不存在')
    await this.assertVisible(request, existing.code)
    return this.prisma.operationMaster.update({ where: { id }, data: await this.normalize(body, false) })
  }

  @Post(':id/disable')
  async disable(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.prisma.operationMaster.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('工序不存在')
    await this.assertVisible(request, existing.code)
    return this.prisma.operationMaster.update({ where: { id }, data: { status: 'DISABLED' } })
  }

  @Post(':id/enable')
  async enable(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.prisma.operationMaster.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('工序不存在')
    await this.assertVisible(request, existing.code)
    return this.prisma.operationMaster.update({ where: { id }, data: { status: 'ENABLED' } })
  }
}
