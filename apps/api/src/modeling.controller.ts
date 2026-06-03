import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  collectDepartmentIds,
  getAdminContext,
  upsertOwnership,
  visibleOwnershipEntityIds,
  type RequestWithAdmin,
} from './shared/admin-context'
import { AdminAuthGuard } from './shared/admin-auth.guard'
import { ModelingPermissionGuard } from './shared/modeling-permission.guard'

type ResourceName =
  | 'workshops'
  | 'lines'
  | 'teams'
  | 'items'
  | 'materials'
  | 'equipment'
  | 'recipes'
  | 'molds'
  | 'coreboxes'
  | 'routings'
  | 'shifts'
  | 'calendars'
  | 'schedules'
  | 'defects'

interface BatchScheduleBody {
  startDate?: string
  endDate?: string
  workshopCode?: string
  shiftCodes?: string[]
  teamCodes?: string[]
  overwrite?: boolean
}

const resourceMap = {
  workshops: {
    delegate: 'workshop',
    unique: 'code',
    search: ['code', 'name', 'type', 'status'],
    required: ['code', 'name'],
    orderBy: [{ createdAt: 'desc' }],
  },
  lines: {
    delegate: 'productionLine',
    unique: 'code',
    search: ['code', 'name', 'workshopCode', 'status'],
    required: ['code', 'name', 'workshopCode'],
    orderBy: [{ createdAt: 'desc' }],
  },
  teams: {
    delegate: 'team',
    unique: 'code',
    search: ['code', 'name', 'workshopCode', 'status'],
    required: ['code', 'name', 'workshopCode'],
    orderBy: [{ createdAt: 'desc' }],
  },
  items: {
    delegate: 'product',
    unique: 'code',
    search: ['code', 'name', 'type', 'spec', 'unit'],
    required: ['code', 'name'],
    orderBy: [{ createdAt: 'desc' }],
  },
  materials: {
    delegate: 'materialGrade',
    unique: 'code',
    search: ['code', 'name', 'standard', 'status'],
    required: ['code', 'name'],
    orderBy: [{ createdAt: 'desc' }],
  },
  equipment: {
    delegate: 'furnace',
    unique: 'code',
    search: ['code', 'name', 'workshopCode', 'status'],
    required: ['code', 'name'],
    orderBy: [{ createdAt: 'desc' }],
  },
  recipes: {
    delegate: 'meltRecipe',
    unique: 'code',
    search: ['code', 'name', 'materialGradeCode', 'version', 'status'],
    required: ['code', 'name', 'materialGradeCode'],
    orderBy: [{ createdAt: 'desc' }],
  },
  molds: {
    delegate: 'moldMaster',
    unique: 'code',
    search: ['code', 'name', 'itemCode', 'moldType', 'supplierCode', 'specModel', 'sourceMoldDevelopmentCode', 'status'],
    required: ['code', 'name', 'itemCode'],
    orderBy: [{ createdAt: 'desc' }],
  },
  coreboxes: {
    delegate: 'coreBoxMaster',
    unique: 'code',
    search: ['code', 'name', 'moldCode', 'status'],
    required: ['code', 'name', 'moldCode'],
    orderBy: [{ createdAt: 'desc' }],
  },
  routings: {
    delegate: 'processRouting',
    unique: 'code',
    search: ['code', 'name', 'itemCode', 'version', 'status'],
    required: ['code', 'name', 'itemCode'],
    orderBy: [{ createdAt: 'desc' }],
  },
  shifts: {
    delegate: 'shiftMaster',
    unique: 'code',
    search: ['code', 'name', 'startTime', 'endTime', 'status'],
    required: ['code', 'name', 'startTime', 'endTime'],
    orderBy: [{ createdAt: 'desc' }],
  },
  calendars: {
    delegate: 'factoryCalendar',
    unique: 'date',
    search: ['dayType', 'remark'],
    required: ['date'],
    orderBy: [{ date: 'desc' }],
  },
  schedules: {
    delegate: 'shiftSchedule',
    unique: 'id',
    search: ['workshopCode', 'shiftCode', 'teamCode', 'remark'],
    required: ['date', 'workshopCode', 'shiftCode', 'teamCode'],
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  },
  defects: {
    delegate: 'defectCode',
    unique: 'code',
    search: ['code', 'name', 'category', 'sourceOperation', 'status'],
    required: ['code', 'name', 'category'],
    orderBy: [{ createdAt: 'desc' }],
  },
} as const

const codePattern = /^[^\s\u4e00-\u9fff]+$/

function formatDateTime(value?: Date | null) {
  if (!value) return ''
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  const second = String(value.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function formatDate(value?: Date | null) {
  return value ? formatDateTime(value).slice(0, 10) : ''
}

function toDate(value: unknown) {
  if (!value) return undefined
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new BadRequestException('日期格式不正确')
  return date
}

function toJsonArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function toStringArray(value: unknown) {
  return toJsonArray(value)
    .map((item) => String(item).trim())
    .filter(Boolean)
}

function toDecimal(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function toInt(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : undefined
}

function getDelegate(prisma: PrismaService, resource: ResourceName) {
  return prisma[resourceMap[resource].delegate as keyof PrismaService] as {
    findMany: (args?: unknown) => Promise<unknown[]>
    findUnique: (args: unknown) => Promise<unknown | null>
    findFirst: (args: unknown) => Promise<unknown | null>
    create: (args: unknown) => Promise<unknown>
    update: (args: unknown) => Promise<unknown>
    delete: (args: unknown) => Promise<unknown>
    upsert?: (args: unknown) => Promise<unknown>
  }
}

@Controller('admin/modeling')
@UseGuards(AdminAuthGuard, ModelingPermissionGuard)
export class ModelingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('options')
  async options(@Req() request: RequestWithAdmin) {
    const [workshops, lines, teams, items, materials, molds, shifts, suppliers, employees] = await Promise.all([
      this.prisma.workshop.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.productionLine.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.team.findMany({ orderBy: { createdAt: 'desc' }, include: { members: true } }),
      this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.materialGrade.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.moldMaster.findMany({ orderBy: { createdAt: 'desc' }, include: { supplier: true } }),
      this.prisma.shiftMaster.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.supplier.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findMany({
        where: { userType: 'EMPLOYEE', status: 'ENABLED', lockStatus: 'NORMAL', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, phone: true, department: { select: { name: true } } },
      }),
    ])
    const usedDevelopmentCodes = new Set(
      molds
        .map((record) => record.sourceMoldDevelopmentCode)
        .filter((code): code is string => Boolean(code)),
    )
    const moldDevelopments = await this.prisma.moldDevelopment.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ archivedMoldCode: null }, { archivedMoldCode: '' }],
      },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })
    const visible = {
      workshops: await this.visibleEntityIds(request, 'workshops'),
      lines: await this.visibleEntityIds(request, 'lines'),
      teams: await this.visibleEntityIds(request, 'teams'),
      items: await this.visibleEntityIds(request, 'items'),
      materials: await this.visibleEntityIds(request, 'materials'),
      molds: await this.visibleEntityIds(request, 'molds'),
      shifts: await this.visibleEntityIds(request, 'shifts'),
    }
    const visibleSuppliers = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'basic:suppliers')
    const visibleEmployeeIds = await this.visibleEmployeeIds(request)
    const filterByCode = <T extends { code: string }>(resource: keyof typeof visible, records: T[]) =>
      visible[resource] ? records.filter((record) => visible[resource]?.includes(record.code)) : records

    return {
      workshops: filterByCode('workshops', workshops).map((record) => this.toDto('workshops', record)),
      lines: filterByCode('lines', lines).map((record) => this.toDto('lines', record)),
      teams: filterByCode('teams', teams).map((record) => this.toDto('teams', record)),
      items: filterByCode('items', items).map((record) => this.toDto('items', record)),
      materials: filterByCode('materials', materials).map((record) => this.toDto('materials', record)),
      molds: filterByCode('molds', molds).map((record) => this.toDto('molds', record)),
      moldDevelopments: moldDevelopments
        .filter((record) => !usedDevelopmentCodes.has(record.code))
        .map((record) => ({
          id: record.code,
          dbId: record.id,
          code: record.code,
          name: `${record.code} / ${record.moldName || record.product.name}`,
        })),
      shifts: filterByCode('shifts', shifts).map((record) => this.toDto('shifts', record)),
      suppliers: (visibleSuppliers ? suppliers.filter((record) => visibleSuppliers.includes(record.code)) : suppliers).map((record) => ({
        id: record.code,
        dbId: record.id,
        code: record.code,
        name: record.name,
      })),
      employees: (visibleEmployeeIds ? employees.filter((record) => visibleEmployeeIds.includes(record.id)) : employees).map(
        (record) => ({
          id: record.id,
          name: record.name,
          phone: record.phone,
          department: record.department?.name || '',
        }),
      ),
    }
  }

  @Get(':resource')
  async list(
    @Req() request: RequestWithAdmin,
    @Param('resource') resource: ResourceName,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('workshopCode') workshopCode?: string,
  ) {
    this.assertResource(resource)
    const config = resourceMap[resource]
    const delegate = getDelegate(this.prisma, resource)
    const where: Record<string, unknown> = {}
    const normalizedKeyword = keyword?.trim()

    if (normalizedKeyword) {
      where.OR = config.search.map((field) => ({
        [field]: { contains: normalizedKeyword, mode: 'insensitive' },
      }))
    }
    if ((resource === 'calendars' || resource === 'schedules') && (startDate || endDate)) {
      where.date = {
        ...(startDate ? { gte: toDate(startDate) } : {}),
        ...(endDate ? { lte: toDate(endDate) } : {}),
      }
    }
    if (resource === 'schedules' && workshopCode) {
      where.workshopCode = workshopCode
    }
    const visibleIds = await this.visibleEntityIds(request, resource)
    if (visibleIds) {
      Object.assign(where, this.scopeWhere(resource, visibleIds))
    }

    const include = this.includeFor(resource)
    const records = await delegate.findMany({ where, include, orderBy: config.orderBy })
    return records.map((record) => this.toDto(resource, record))
  }

  @Get(':resource/:id')
  async detail(@Req() request: RequestWithAdmin, @Param('resource') resource: ResourceName, @Param('id') id: string) {
    this.assertResource(resource)
    await this.assertVisible(request, resource, id)
    const delegate = getDelegate(this.prisma, resource)
    const where = this.whereById(resource, id)
    const include = this.includeFor(resource)
    const record = await delegate.findUnique({ where, include })
    if (!record) throw new NotFoundException('数据不存在')
    return this.toDto(resource, record)
  }

  @Post(':resource')
  async create(
    @Req() request: RequestWithAdmin,
    @Param('resource') resource: ResourceName,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertResource(resource)
    this.assertRequired(resource, body)
    await this.assertRelations(resource, body)

    if (resource === 'routings') {
      const record = await this.prisma.processRouting.create({
        data: {
          ...(this.normalize(resource, body) as Prisma.ProcessRoutingUncheckedCreateInput),
          steps: { create: this.normalizeRoutingSteps(body.steps) },
        },
        include: { steps: { orderBy: { seqNo: 'asc' } } },
      })
      await upsertOwnership(this.prisma, request.adminUser, this.entityType(resource), this.recordCode(resource, record))
      return this.toDto(resource, record)
    }

    const delegate = getDelegate(this.prisma, resource)
    const normalizedBody = await this.withDevelopmentReceiveImages(resource, body)
    const record = await delegate.create({ data: this.normalize(resource, normalizedBody), include: this.includeFor(resource) })
    await upsertOwnership(this.prisma, request.adminUser, this.entityType(resource), this.recordCode(resource, record))
    await this.syncMultiRelations(resource, this.recordCode(resource, record), normalizedBody)
    await this.syncCoreBoxForMold(resource, this.recordCode(resource, record), normalizedBody)
    if (resource === 'molds' && normalizedBody.sourceMoldDevelopmentCode) {
      await this.prisma.moldDevelopment.updateMany({
        where: { code: stringValue(normalizedBody.sourceMoldDevelopmentCode) },
        data: { archivedMoldCode: this.recordCode(resource, record) },
      })
    }
    if (this.hasMultiRelations(resource)) {
      return this.detail(request, resource, this.recordCode(resource, record))
    }
    return this.toDto(resource, record)
  }

  @Put(':resource/:id')
  async update(
    @Req() request: RequestWithAdmin,
    @Param('resource') resource: ResourceName,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertResource(resource)
    await this.assertVisible(request, resource, id)
    await this.assertRelations(resource, body)
    const existing = await this.findExistingRecord(resource, id)
    if (!existing) throw new NotFoundException('数据不存在或已被删除，请刷新后重试')

    if (resource === 'routings') {
      await this.prisma.$transaction([
        this.prisma.processRoutingStep.deleteMany({ where: { routingId: String((existing as { id: string }).id) } }),
        this.prisma.processRouting.update({
          where: { id: String((existing as { id: string }).id) },
          data: {
            ...(this.normalize(resource, body) as Prisma.ProcessRoutingUncheckedUpdateInput),
            steps: { create: this.normalizeRoutingSteps(body.steps) },
          },
        }),
      ])
      const record = await this.prisma.processRouting.findUniqueOrThrow({
        where: { id: String((existing as { id: string }).id) },
        include: { steps: { orderBy: { seqNo: 'asc' } } },
      })
      return this.toDto(resource, record)
    }

    const delegate = getDelegate(this.prisma, resource)
    const record = await delegate.update({
      where: this.whereById(resource, id),
      data: this.normalize(resource, body),
      include: this.includeFor(resource),
    })
    await this.syncMultiRelations(resource, this.recordCode(resource, record), body)
    await this.syncCoreBoxForMold(resource, this.recordCode(resource, record), body)
    if (this.hasMultiRelations(resource)) {
      return this.detail(request, resource, this.recordCode(resource, record))
    }
    return this.toDto(resource, record)
  }

  @Delete(':resource/:id')
  async delete(@Req() request: RequestWithAdmin, @Param('resource') resource: ResourceName, @Param('id') id: string) {
    this.assertResource(resource)
    await this.assertVisible(request, resource, id)
    await this.assertCanDelete(resource, id)
    const delegate = getDelegate(this.prisma, resource)
    await delegate.delete({ where: this.whereById(resource, id) })
    return { id }
  }

  @Post('schedules/batch-generate')
  async batchGenerateSchedules(@Req() request: RequestWithAdmin, @Body() body: BatchScheduleBody) {
    const startDate = toDate(body.startDate)
    const endDate = toDate(body.endDate)
    if (!startDate || !endDate || !body.workshopCode || !body.shiftCodes?.length || !body.teamCodes?.length) {
      throw new BadRequestException('请选择日期范围、车间、班次和班组')
    }
    if (startDate > endDate) throw new BadRequestException('开始日期不能晚于结束日期')
    await this.assertRelations('schedules', {
      workshopCode: body.workshopCode,
      shiftCode: body.shiftCodes[0],
      teamCode: body.teamCodes[0],
    })

    const operations: Prisma.PrismaPromise<unknown>[] = []
    let cursor = new Date(startDate)
    let index = 0
    while (cursor <= endDate) {
      for (const shiftCode of body.shiftCodes) {
        const teamCode = body.teamCodes[index % body.teamCodes.length]
        operations.push(
          this.prisma.shiftSchedule.upsert({
            where: {
              date_workshopCode_shiftCode: {
                date: cursor,
                workshopCode: body.workshopCode,
                shiftCode,
              },
            },
            update: { teamCode, remark: '一键生成排班' },
            create: {
              date: cursor,
              workshopCode: body.workshopCode,
              shiftCode,
              teamCode,
              remark: '一键生成排班',
            },
          }),
        )
        index += 1
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    }
    const records = (await this.prisma.$transaction(operations)) as Array<{ id?: string }>
    await Promise.all(
      records
        .map((record) => record.id)
        .filter((id): id is string => Boolean(id))
        .map((id) => upsertOwnership(this.prisma, request.adminUser, this.entityType('schedules'), id)),
    )
    return this.list(request, 'schedules', undefined, body.startDate, body.endDate, body.workshopCode)
  }

  private assertResource(resource: string): asserts resource is ResourceName {
    if (!(resource in resourceMap)) throw new NotFoundException('资源不存在')
  }

  private assertRequired(resource: ResourceName, body: Record<string, unknown>) {
    for (const field of resourceMap[resource].required) {
      if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
        throw new BadRequestException(`缺少必填字段：${field}`)
      }
    }
    const code = stringValue(body.code)
    if (code && !codePattern.test(code)) {
      throw new BadRequestException('编码不能包含中文或空格')
    }
  }

  private whereById(resource: ResourceName, id: string) {
    if (resource === 'schedules') return { id }
    if (resource === 'calendars') return { date: toDate(id) }
    return { code: id }
  }

  private entityType(resource: ResourceName) {
    return `modeling:${resource}`
  }

  private async visibleEntityIds(request: RequestWithAdmin, resource: ResourceName) {
    return visibleOwnershipEntityIds(this.prisma, getAdminContext(request), this.entityType(resource))
  }

  private async visibleEmployeeIds(request: RequestWithAdmin) {
    const user = getAdminContext(request)
    const scopes = user.dataScopes?.length ? user.dataScopes : [user.dataScope]
    if (scopes.includes('ALL')) return null
    const userIds = new Set<string>()
    if (scopes.includes('OWN')) userIds.add(user.id)
    if (scopes.includes('OWN_DEPARTMENT') && user.departmentId) {
      const records = await this.prisma.user.findMany({ where: { departmentId: user.departmentId }, select: { id: true } })
      records.forEach((record) => userIds.add(record.id))
    }
    if (scopes.includes('OWN_AND_CHILD_DEPARTMENTS') && user.departmentId) {
      const departmentIds = await collectDepartmentIds(this.prisma, user.departmentId, true)
      const records = await this.prisma.user.findMany({ where: { departmentId: { in: departmentIds } }, select: { id: true } })
      records.forEach((record) => userIds.add(record.id))
    }
    if (scopes.includes('CUSTOM_DEPARTMENTS')) {
      const departmentIds = Array.from(
        new Set(
          (
            await Promise.all(
              user.customDepartments.map((item) => collectDepartmentIds(this.prisma, item.departmentId, item.includeChildren)),
            )
          ).flat(),
        ),
      )
      if (departmentIds.length) {
        const records = await this.prisma.user.findMany({ where: { departmentId: { in: departmentIds } }, select: { id: true } })
        records.forEach((record) => userIds.add(record.id))
      }
    }
    return Array.from(userIds)
  }

  private scopeWhere(resource: ResourceName, visibleIds: string[]) {
    if (!visibleIds.length) return { id: '__none__' }
    if (resource === 'schedules') return { id: { in: visibleIds } }
    if (resource === 'calendars') return { date: { in: visibleIds.map((id) => toDate(id)).filter(Boolean) } }
    return { code: { in: visibleIds } }
  }

  private async assertVisible(request: RequestWithAdmin, resource: ResourceName, id: string) {
    const visibleIds = await this.visibleEntityIds(request, resource)
    if (!visibleIds) return
    if (!visibleIds.includes(id)) throw new NotFoundException('数据不存在或无权访问')
  }

  private async findExistingRecord(resource: ResourceName, id: string) {
    const delegate = getDelegate(this.prisma, resource)
    if (resource === 'schedules') return delegate.findUnique({ where: { id } })
    if (resource === 'calendars') {
      const date = toDate(id)
      return date ? delegate.findUnique({ where: { date } }) : null
    }
    return delegate.findUnique({ where: { code: id } })
  }

  private normalize(resource: ResourceName, body: Record<string, unknown>) {
    const common = {
      code: stringValue(body.code),
      name: stringValue(body.name),
      status: stringValue(body.status) || '启用',
      remark: stringValue(body.remark),
    }

    if (resource === 'workshops') return { ...common, type: stringValue(body.type) }
    if (resource === 'lines') {
      return {
        ...common,
        workshopCode: stringValue(body.workshopCode),
        isBottleneck: Boolean(body.isBottleneck),
      }
    }
    if (resource === 'teams') {
      return {
        ...common,
        workshopCode: stringValue(body.workshopCode),
        leaderUserId: stringValue(body.leaderUserId),
        memberUserIds: toStringArray(body.memberUserIds),
      }
    }
    if (resource === 'items') {
      return {
        ...common,
        type: stringValue(body.type),
        spec: stringValue(body.spec),
        unit: stringValue(body.unit),
        source: stringValue(body.source),
        workshop: stringValue(body.workshop),
        salePrice: toDecimal(body.salePrice),
        costPrice: toDecimal(body.costPrice),
        stockMax: toInt(body.stockMax),
        stockMin: toInt(body.stockMin),
        minPurchase: toInt(body.minPurchase),
        dailyCapacity: toInt(body.dailyCapacity),
      }
    }
    if (resource === 'materials') {
      return {
        ...common,
        standard: stringValue(body.standard),
        elementLimits: toJsonArray(body.elementLimits),
      }
    }
    if (resource === 'equipment') {
      return {
        ...common,
        workshopCode: stringValue(body.workshopCode),
        capacity: toDecimal(body.capacity),
        allowedMaterialCodes: toStringArray(body.allowedMaterialCodes),
      }
    }
    if (resource === 'recipes') {
      return {
        ...common,
        materialGradeCode: stringValue(body.materialGradeCode),
        version: stringValue(body.version),
        items: toRecipeItems(body.items),
      }
    }
    if (resource === 'molds') {
      return {
        ...common,
        itemCode: stringValue(body.itemCode),
        moldType: stringValue(body.moldType),
        supplierCode: stringValue(body.supplierCode),
        specModel: stringValue(body.specModel),
        sourceMoldDevelopmentCode: stringValue(body.sourceMoldDevelopmentCode),
        hasCoreBox: Boolean(body.hasCoreBox),
        images: toJsonArray(body.images),
        cavityCount: toInt(body.cavityCount),
        maxLife: toInt(body.maxLife),
        usedLife: toInt(body.usedLife) ?? 0,
      }
    }
    if (resource === 'coreboxes') {
      return {
        ...common,
        moldCode: stringValue(body.moldCode),
        images: toJsonArray(body.images),
        maxLife: toInt(body.maxLife),
        usedLife: toInt(body.usedLife) ?? 0,
      }
    }
    if (resource === 'routings') {
      return {
        ...common,
        itemCode: stringValue(body.itemCode),
        version: stringValue(body.version),
      }
    }
    if (resource === 'shifts') {
      return {
        ...common,
        startTime: stringValue(body.startTime),
        endTime: stringValue(body.endTime),
        crossDay: Boolean(body.crossDay),
      }
    }
    if (resource === 'calendars') {
      return {
        date: toDate(body.date),
        dayType: stringValue(body.dayType) || '工作日',
        shiftCodes: toStringArray(body.shiftCodes),
        remark: stringValue(body.remark),
      }
    }
    if (resource === 'schedules') {
      return {
        date: toDate(body.date),
        workshopCode: stringValue(body.workshopCode),
        shiftCode: stringValue(body.shiftCode),
        teamCode: stringValue(body.teamCode),
        remark: stringValue(body.remark),
      }
    }
    return {
      ...common,
      category: stringValue(body.category),
      sourceOperation: stringValue(body.sourceOperation),
    }
  }

  private normalizeRoutingSteps(value: unknown) {
    const steps = Array.isArray(value) ? value : []
    return steps
      .map((step, index) => {
        const record = step as Record<string, unknown>
        const operationName = stringValue(record.operationName)
        const workshopCode = stringValue(record.workshopCode)
        if (!operationName || !workshopCode) return null
        return {
          seqNo: toInt(record.seqNo) ?? index + 1,
          operationName,
          workshopCode,
          productionLineCode: stringValue(record.productionLineCode),
          standardHours: toDecimal(record.standardHours),
          remark: stringValue(record.remark),
        }
      })
      .filter((step): step is NonNullable<typeof step> => Boolean(step))
  }

  private async assertRelations(resource: ResourceName, body: Record<string, unknown>) {
    const checks: Array<[unknown, string, (code: string) => Promise<unknown | null>]> = [
      [body.workshopCode, '车间不存在', (code) => this.prisma.workshop.findUnique({ where: { code } })],
      [body.materialGradeCode, '材质牌号不存在', (code) => this.prisma.materialGrade.findUnique({ where: { code } })],
      [body.itemCode, '物料不存在', (code) => this.prisma.product.findUnique({ where: { code } })],
      [body.moldCode, '模具不存在', (code) => this.prisma.moldMaster.findUnique({ where: { code } })],
      [body.supplierCode, '供应商不存在', (code) => this.prisma.supplier.findUnique({ where: { code } })],
      [body.shiftCode, '班次不存在', (code) => this.prisma.shiftMaster.findUnique({ where: { code } })],
      [body.teamCode, '班组不存在', (code) => this.prisma.team.findUnique({ where: { code } })],
    ]
    if (resource === 'lines' || resource === 'routings') {
      checks.push([
        body.productionLineCode,
        '产线不存在',
        (code) => this.prisma.productionLine.findUnique({ where: { code } }),
      ])
    }

    for (const [value, message, lookup] of checks) {
      if (!value) continue
      const record = await lookup(String(value))
      if (!record) throw new BadRequestException(message)
    }

    for (const userId of toStringArray(body.memberUserIds)) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, userType: 'EMPLOYEE', deletedAt: null },
      })
      if (!user) throw new BadRequestException('班组成员不存在或不是内部员工')
    }
    if (resource === 'teams' && body.leaderUserId) {
      const memberUserIds = toStringArray(body.memberUserIds)
      const leaderUserId = stringValue(body.leaderUserId)
      if (leaderUserId && !memberUserIds.includes(leaderUserId)) {
        throw new BadRequestException('班组长必须从班组成员中选择')
      }
    }
    for (const materialGradeCode of toStringArray(body.allowedMaterialCodes)) {
      const material = await this.prisma.materialGrade.findUnique({ where: { code: materialGradeCode } })
      if (!material) throw new BadRequestException('允许材质不存在')
    }
    for (const shiftCode of toStringArray(body.shiftCodes)) {
      const shift = await this.prisma.shiftMaster.findUnique({ where: { code: shiftCode } })
      if (!shift) throw new BadRequestException('启用班次不存在')
    }
    for (const item of toRecipeItems(body.items)) {
      const material = await this.prisma.product.findUnique({ where: { code: item.itemCode } })
      if (!material) throw new BadRequestException('配料物料不存在')
    }
  }

  private async assertCanDelete(resource: ResourceName, id: string) {
    const checks: Record<ResourceName, Array<() => Promise<number>>> = {
      workshops: [
        () => this.prisma.productionLine.count({ where: { workshopCode: id } }),
        () => this.prisma.team.count({ where: { workshopCode: id } }),
        () => this.prisma.furnace.count({ where: { workshopCode: id } }),
        () => this.prisma.processRoutingStep.count({ where: { workshopCode: id } }),
        () => this.prisma.shiftSchedule.count({ where: { workshopCode: id } }),
      ],
      lines: [() => this.prisma.processRoutingStep.count({ where: { productionLineCode: id } })],
      teams: [() => this.prisma.shiftSchedule.count({ where: { teamCode: id } })],
      items: [
        () => this.prisma.moldMaster.count({ where: { itemCode: id } }),
        () => this.prisma.processRouting.count({ where: { itemCode: id } }),
        () => this.prisma.meltRecipeItem.count({ where: { itemCode: id } }),
      ],
      materials: [
        () => this.prisma.meltRecipe.count({ where: { materialGradeCode: id } }),
        () => this.prisma.furnaceAllowedMaterial.count({ where: { materialGradeCode: id } }),
      ],
      equipment: [],
      recipes: [],
      molds: [() => this.prisma.coreBoxMaster.count({ where: { moldCode: id } })],
      coreboxes: [],
      routings: [],
      shifts: [
        () => this.prisma.shiftSchedule.count({ where: { shiftCode: id } }),
        () => this.prisma.factoryCalendarShift.count({ where: { shiftCode: id } }),
      ],
      calendars: [],
      schedules: [],
      defects: [],
    }
    const counts = await Promise.all(checks[resource].map((check) => check()))
    if (counts.some((count) => count > 0)) {
      throw new BadRequestException('当前数据已被其他资料引用，不能删除')
    }
  }

  private toDto(resource: ResourceName, record: unknown) {
    const value = record as Record<string, unknown>
    const base = {
      ...value,
      id: resource === 'schedules' ? value.id : resource === 'calendars' ? formatDate(value.date as Date) : value.code,
      dbId: value.id,
      date: value.date instanceof Date ? formatDate(value.date) : value.date,
      createdAt: value.createdAt instanceof Date ? formatDateTime(value.createdAt) : value.createdAt,
      updatedAt: value.updatedAt instanceof Date ? formatDateTime(value.updatedAt) : value.updatedAt,
    }
    if (resource === 'teams') {
      return {
        ...base,
        memberUserIds: Array.isArray(value.members)
          ? value.members.map((member) => (member as { userId: string }).userId)
          : toStringArray(value.memberUserIds),
      }
    }
    if (resource === 'equipment') {
      return {
        ...base,
        capacity: Number(value.capacity || 0),
        allowedMaterialCodes: Array.isArray(value.allowedMaterials)
          ? value.allowedMaterials.map((item) => (item as { materialGradeCode: string }).materialGradeCode)
          : toStringArray(value.allowedMaterialCodes),
      }
    }
    if (resource === 'recipes') {
      return {
        ...base,
        items: Array.isArray(value.recipeItems)
          ? value.recipeItems.map((item) => {
              const recipeItem = item as Record<string, unknown>
              return {
                itemCode: recipeItem.itemCode,
                ratio: Number(recipeItem.ratio || 0),
                quantity: Number(recipeItem.quantity || 0),
                unit: recipeItem.unit || '',
                remark: recipeItem.remark || '',
              }
            })
          : toRecipeItems(value.items),
      }
    }
    if (resource === 'calendars') {
      return {
        ...base,
        shiftCodes: Array.isArray(value.shifts)
          ? value.shifts.map((item) => (item as { shiftCode: string }).shiftCode)
          : toStringArray(value.shiftCodes),
      }
    }
    if (resource === 'routings') {
      return {
        ...base,
        steps: Array.isArray(value.steps)
          ? value.steps.map((step) => ({
              ...(step as Record<string, unknown>),
              standardHours: Number((step as { standardHours?: unknown }).standardHours || 0),
            }))
          : [],
      }
    }
    if (resource === 'molds') {
      return {
        ...base,
        hasCoreBox: Boolean(value.hasCoreBox),
        images: toJsonArray(value.images),
        coreBoxes: Array.isArray(value.coreBoxes)
          ? value.coreBoxes.map((coreBox) => ({
              ...(coreBox as Record<string, unknown>),
              id: (coreBox as { code?: string }).code,
              images: toJsonArray((coreBox as { images?: unknown }).images),
            }))
          : [],
        supplierName:
          value.supplier && typeof value.supplier === 'object'
            ? String((value.supplier as { name?: unknown }).name || '')
            : '',
      }
    }
    if ('capacity' in base) return { ...base, capacity: Number(base.capacity || 0) }
    return base
  }

  private includeFor(resource: ResourceName) {
    if (resource === 'teams') return { members: true }
    if (resource === 'equipment') return { allowedMaterials: true }
    if (resource === 'recipes') return { recipeItems: { orderBy: { createdAt: 'asc' } } }
    if (resource === 'calendars') return { shifts: true }
    if (resource === 'routings') return { steps: { orderBy: { seqNo: 'asc' } } }
    if (resource === 'molds') return { supplier: true, coreBoxes: true }
    return undefined
  }

  private recordCode(resource: ResourceName, record: unknown) {
    const value = record as Record<string, unknown>
    if (resource === 'schedules') return String(value.id)
    if (resource === 'calendars') return formatDate(value.date as Date)
    return String(value.code)
  }

  private hasMultiRelations(resource: ResourceName) {
    return resource === 'teams' || resource === 'equipment' || resource === 'recipes' || resource === 'calendars'
  }

  private async syncMultiRelations(resource: ResourceName, code: string, body: Record<string, unknown>) {
    if (resource === 'teams') {
      await this.prisma.teamMember.deleteMany({ where: { teamCode: code } })
      const userIds = toStringArray(body.memberUserIds)
      if (userIds.length) {
        await this.prisma.teamMember.createMany({
          data: userIds.map((userId) => ({ teamCode: code, userId })),
          skipDuplicates: true,
        })
      }
    }
    if (resource === 'equipment') {
      await this.prisma.furnaceAllowedMaterial.deleteMany({ where: { furnaceCode: code } })
      const materialGradeCodes = toStringArray(body.allowedMaterialCodes)
      if (materialGradeCodes.length) {
        await this.prisma.furnaceAllowedMaterial.createMany({
          data: materialGradeCodes.map((materialGradeCode) => ({ furnaceCode: code, materialGradeCode })),
          skipDuplicates: true,
        })
      }
    }
    if (resource === 'recipes') {
      await this.prisma.meltRecipeItem.deleteMany({ where: { recipeCode: code } })
      const items = toRecipeItems(body.items)
      if (items.length) {
        await this.prisma.meltRecipeItem.createMany({
          data: items.map((item) => ({
            recipeCode: code,
            itemCode: item.itemCode,
            ratio: item.ratio,
            quantity: item.quantity,
            unit: item.unit,
            remark: item.remark,
          })),
        })
      }
    }
    if (resource === 'calendars') {
      const date = toDate(code)
      await this.prisma.factoryCalendarShift.deleteMany({ where: { date } })
      const shiftCodes = toStringArray(body.shiftCodes)
      if (date && shiftCodes.length) {
        await this.prisma.factoryCalendarShift.createMany({
          data: shiftCodes.map((shiftCode) => ({ date, shiftCode })),
          skipDuplicates: true,
        })
      }
    }
  }

  private async syncCoreBoxForMold(resource: ResourceName, moldCode: string, body: Record<string, unknown>) {
    if (resource !== 'molds') return
    const coreBoxCode = stringValue(body.coreBoxCode) || `${moldCode}-COREBOX`

    if (!body.hasCoreBox) {
      await this.prisma.coreBoxMaster.deleteMany({ where: { moldCode } })
      return
    }

    const moldName = stringValue(body.name) || moldCode
    const coreBoxName = stringValue(body.coreBoxName) || `${moldName}芯盒`
    const payload = {
      name: coreBoxName,
      moldCode,
      images: toJsonArray(body.coreBoxImages).length ? toJsonArray(body.coreBoxImages) : toJsonArray(body.images),
      maxLife: toInt(body.coreBoxMaxLife) ?? toInt(body.maxLife),
      usedLife: toInt(body.coreBoxUsedLife) ?? 0,
      status: stringValue(body.status) || '启用',
      remark: stringValue(body.coreBoxRemark) || stringValue(body.remark),
    }

    await this.prisma.coreBoxMaster.upsert({
      where: { code: coreBoxCode },
      update: payload,
      create: { code: coreBoxCode, ...payload },
    })
  }

  private async withDevelopmentReceiveImages(resource: ResourceName, body: Record<string, unknown>) {
    if (resource !== 'molds' || !body.sourceMoldDevelopmentCode) return body
    if (toJsonArray(body.images).length) return body

    const receiveRecord = await this.prisma.moldDevelopmentFlowRecord.findFirst({
      where: {
        moldDevelopment: { code: stringValue(body.sourceMoldDevelopmentCode) },
        key: 'RECEIVE',
        done: true,
      },
    })
    const images = toJsonArray(receiveRecord?.images)
    if (!images.length) return body

    return {
      ...body,
      images,
      coreBoxImages: toJsonArray(body.coreBoxImages).length ? body.coreBoxImages : images,
    }
  }
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

function toRecipeItems(value: unknown) {
  return toJsonArray(value)
    .map((item) => {
      if (typeof item === 'string') return { itemCode: item }
      const record = item as Record<string, unknown>
      return {
        itemCode: stringValue(record.itemCode || record.code),
        ratio: toNullableNumber(record.ratio),
        quantity: toNullableNumber(record.quantity),
        unit: stringValue(record.unit),
        remark: stringValue(record.remark),
      }
    })
    .filter((item): item is { itemCode: string; ratio?: number; quantity?: number; unit?: string; remark?: string } =>
      Boolean(item.itemCode),
    )
}
