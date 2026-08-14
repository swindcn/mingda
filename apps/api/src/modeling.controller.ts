import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  hasAdminPermission,
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
    search: ['code', 'name', 'type', 'spec', 'unit', 'materialGradeCode'],
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
    required: ['name', 'materialGradeCode'],
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

function positiveInteger(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return 1
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new BadRequestException(`${label}必须为大于 0 的整数`)
  }
  return numberValue
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

  @Get('recipe-options')
  async recipeOptions() {
    const [materials, furnaces, rawMaterials] = await Promise.all([
      this.prisma.materialGrade.findMany({
        where: { status: '启用' },
        include: { elements: { orderBy: { elementName: 'asc' } } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.furnace.findMany({
        where: { status: '启用', equipmentType: '熔炼炉', workshop: { type: '熔炼' } },
        include: { workshop: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { type: { startsWith: '原材料' } },
        orderBy: { code: 'asc' },
      }),
    ])
    const decimal = (value: unknown) => value === null || value === undefined ? value : Number(value)
    return {
      materials: materials.map((material) => ({
        code: material.code,
        name: material.name,
        elements: material.elements.map((item) => ({
          elementName: item.elementName,
          minValue: decimal(item.minValue),
          maxValue: decimal(item.maxValue),
          unit: item.unit,
          remark: item.remark || '',
        })),
      })),
      furnaces: furnaces.map((furnace) => ({
        code: furnace.code,
        name: furnace.name,
        capacity: decimal(furnace.capacity),
        capacityUnit: furnace.capacityUnit || '',
        workshopName: furnace.workshop?.name || '',
      })),
      rawMaterials: rawMaterials.map((item) => ({
        code: item.code,
        name: item.name,
        type: item.type || '',
        unit: item.unit || '',
      })),
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
    @Query('materialGradeCode') materialGradeCode?: string,
    @Query('furnaceCode') furnaceCode?: string,
    @Query('status') status?: string,
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
    if (resource === 'recipes') {
      if (materialGradeCode) where.materialGradeCode = materialGradeCode
      if (furnaceCode) where.applicableFurnaces = { some: { furnaceCode } }
      if (status) where.status = status
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

    if (resource === 'materials') {
      const record = await this.createMaterialGrade(body)
      await upsertOwnership(this.prisma, request.adminUser, this.entityType(resource), this.recordCode(resource, record))
      return this.toDto(resource, record)
    }

    if (resource === 'recipes') {
      const record = await this.createRecipe(request, body)
      await upsertOwnership(this.prisma, request.adminUser, this.entityType(resource), record.code)
      return this.toDto(resource, record)
    }

    const normalizedBody = await this.withDevelopmentReceiveImages(resource, body)
    if (resource === 'molds') {
      await this.assertNestedCoreBoxPermissions(request, undefined, normalizedBody)
      const record = await this.createMoldWithCoreBoxes(normalizedBody, getAdminContext(request))
      return this.toDto(resource, record)
    }

    const delegate = getDelegate(this.prisma, resource)
    const record = await delegate.create({ data: this.normalize(resource, normalizedBody), include: this.includeFor(resource) })
    await upsertOwnership(this.prisma, request.adminUser, this.entityType(resource), this.recordCode(resource, record))
    await this.syncMultiRelations(resource, this.recordCode(resource, record), normalizedBody)
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

    if (resource === 'materials') {
      const record = await this.updateMaterialGrade(id, body)
      return this.toDto(resource, record)
    }

    if (resource === 'recipes') {
      const record = await this.updateRecipe(id, body)
      return this.toDto(resource, record)
    }

    if (resource === 'molds') {
      await this.assertNestedCoreBoxPermissions(request, id, body)
      const record = await this.updateMoldWithCoreBoxes(id, body, getAdminContext(request))
      return this.toDto(resource, record)
    }

    const delegate = getDelegate(this.prisma, resource)
    const record = await delegate.update({
      where: this.whereById(resource, id),
      data: this.normalize(resource, body),
      include: this.includeFor(resource),
    })
    await this.syncMultiRelations(resource, this.recordCode(resource, record), body)
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
    if (resource === 'recipes') {
      const recipe = await this.prisma.meltRecipe.findUnique({ where: { code: id }, select: { status: true } })
      if (!recipe) throw new NotFoundException('配方不存在')
      if (recipe.status !== 'DRAFT') throw new BadRequestException('仅草稿配方可以删除')
    }
    const delegate = getDelegate(this.prisma, resource)
    await delegate.delete({ where: this.whereById(resource, id) })
    return { id }
  }

  @Post('recipes/:id/activate')
  async activateRecipe(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, 'recipes', id)
    const recipe = await this.prisma.meltRecipe.findUnique({ where: { code: id }, include: this.recipeInclude() })
    if (!recipe) throw new NotFoundException('配方不存在')
    if (recipe.status !== 'DRAFT') throw new BadRequestException('仅草稿配方可以提交生效')
    this.assertRecipeCanActivate(recipe)
    const record = await this.prisma.meltRecipe.update({ where: { code: id }, data: { status: 'ACTIVE' }, include: this.recipeInclude() })
    return this.toDto('recipes', record)
  }

  @Post('recipes/:id/disable')
  async disableRecipe(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, 'recipes', id)
    const recipe = await this.prisma.meltRecipe.findUnique({ where: { code: id }, select: { status: true } })
    if (!recipe) throw new NotFoundException('配方不存在')
    if (recipe.status !== 'ACTIVE') throw new BadRequestException('仅已生效配方可以停用')
    const record = await this.prisma.meltRecipe.update({ where: { code: id }, data: { status: 'DISABLED' }, include: this.recipeInclude() })
    return this.toDto('recipes', record)
  }

  @Post('recipes/:id/clone')
  async cloneRecipe(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    await this.assertVisible(request, 'recipes', id)
    const source = await this.prisma.meltRecipe.findUnique({ where: { code: id }, include: this.recipeInclude() })
    if (!source) throw new NotFoundException('配方不存在')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = await this.nextRecipeCode()
      try {
        const record = await this.prisma.meltRecipe.create({
          data: {
            code,
            name: `${source.name}-副本`,
            materialGradeCode: source.materialGradeCode,
            version: 'V1.0',
            baseWeightKg: source.baseWeightKg,
            meltingDurationMinutes: source.meltingDurationMinutes,
            transferDurationMinutes: source.transferDurationMinutes,
            cleaningDurationMinutes: source.cleaningDurationMinutes,
            sourceRecipeCode: source.code,
            createdByUserId: getAdminContext(request).id,
            status: 'DRAFT',
            remark: source.remark,
            applicableFurnaces: { create: source.applicableFurnaces.map((item) => ({ furnaceCode: item.furnaceCode })) },
            targetElements: { create: source.targetElements.map((item) => ({ elementName: item.elementName, minValue: item.minValue, maxValue: item.maxValue, unit: item.unit, remark: item.remark })) },
            recipeItems: { create: source.recipeItems.map((item) => ({ itemCode: item.itemCode, materialCategory: item.materialCategory, ratio: item.ratio, quantity: item.quantity, unit: item.unit, remark: item.remark })) },
          },
          include: this.recipeInclude(),
        })
        await upsertOwnership(this.prisma, request.adminUser, this.entityType('recipes'), code)
        return this.toDto('recipes', record)
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 2) throw error
      }
    }
    throw new BadRequestException('配方编码生成失败，请重试')
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
        materialGradeCode: stringValue(body.materialGradeCode),
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
        category: stringValue(body.category),
        materialType: stringValue(body.materialType),
        standard: stringValue(body.standard),
        standardVersion: stringValue(body.standardVersion),
        elementLimits: toJsonArray(body.elementLimits),
      }
    }
    if (resource === 'equipment') {
      const workshopCode = stringValue(body.workshopCode)
      return {
        ...common,
        equipmentType: stringValue(body.equipmentType) || '熔炼炉',
        capacity: toDecimal(body.capacity),
        capacityUnit: stringValue(body.capacityUnit),
        ...(workshopCode ? { workshop: { connect: { code: workshopCode } } } : {}),
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
        cavityCount: positiveInteger(body.cavityCount, '芯盒穴数'),
        maxLife: toInt(body.maxLife),
        usedLife: toInt(body.usedLife) ?? 0,
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

  private materialGradeDetails(body: Record<string, unknown>) {
    const elements = toJsonArray(body.elements || body.elementLimits)
      .map((item) => {
        const value = item as Record<string, unknown>
        return {
          elementName: stringValue(value.elementName || value.name),
          valueMode: stringValue(value.valueMode) === 'fixed' ? 'fixed' : 'range',
          fixedValue: toDecimal(value.fixedValue ?? value.value),
          minValue: toDecimal(value.valueMode === 'fixed' ? value.fixedValue ?? value.value : value.minValue ?? value.min),
          maxValue: toDecimal(value.valueMode === 'fixed' ? value.fixedValue ?? value.value : value.maxValue ?? value.max),
          unit: stringValue(value.unit) || '%',
          remark: stringValue(value.remark),
        }
      })
      .filter((item) => Boolean(item.elementName))
    const properties = toJsonArray(body.properties)
      .map((item) => {
        const value = item as Record<string, unknown>
        return {
          propertyName: stringValue(value.propertyName || value.name),
          valueMode: stringValue(value.valueMode) === 'fixed' ? 'fixed' : 'range',
          fixedValue: toDecimal(value.fixedValue ?? value.value),
          minValue: toDecimal(value.valueMode === 'fixed' ? value.fixedValue ?? value.value : value.minValue ?? value.min),
          maxValue: toDecimal(value.valueMode === 'fixed' ? value.fixedValue ?? value.value : value.maxValue ?? value.max),
          unit: stringValue(value.unit),
          testMethod: stringValue(value.testMethod),
          remark: stringValue(value.remark),
        }
      })
      .filter((item) => Boolean(item.propertyName))
    const processRules = toJsonArray(body.processRules)
      .map((item) => {
        const value = item as Record<string, unknown>
        return {
          parameterName: stringValue(value.parameterName || value.name),
          valueMode: stringValue(value.valueMode) === 'fixed' ? 'fixed' : 'range',
          fixedValue: toDecimal(value.fixedValue ?? value.value),
          minValue: toDecimal(value.valueMode === 'fixed' ? value.fixedValue ?? value.value : value.minValue ?? value.min),
          maxValue: toDecimal(value.valueMode === 'fixed' ? value.fixedValue ?? value.value : value.maxValue ?? value.max),
          unit: stringValue(value.unit),
          textValue: stringValue(value.valueMode === 'fixed' ? value.fixedValue ?? value.textValue ?? value.value : value.textValue || value.value),
          remark: stringValue(value.remark),
        }
      })
      .filter((item) => Boolean(item.parameterName))
    const standardVersions = toJsonArray(body.standardVersions)
      .map((item) => {
        const value = item as Record<string, unknown>
        return {
          version: stringValue(value.version),
          standard: stringValue(value.standard),
          effectiveDate: value.effectiveDate ? toDate(value.effectiveDate) : undefined,
          expiryDate: value.expiryDate ? toDate(value.expiryDate) : undefined,
          status: stringValue(value.status) || '生效',
          remark: stringValue(value.remark),
        }
      })
      .filter((item) => Boolean(item.version && item.standard))
    const names = [
      ['元素', elements.map((item) => item.elementName)],
      ['性能指标', properties.map((item) => item.propertyName)],
      ['工艺参数', processRules.map((item) => item.parameterName)],
      ['标准版本', standardVersions.map((item) => item.version)],
    ] as Array<[string, string[]]>
    for (const item of [...elements, ...properties, ...processRules]) {
      if (item.minValue !== undefined && item.maxValue !== undefined && Number(item.minValue) > Number(item.maxValue)) {
        throw new BadRequestException('标准下限不能大于上限')
      }
    }
    for (const [label, values] of names) {
      if (new Set(values).size !== values.length) throw new BadRequestException(`${label}不能重复`)
    }
    return { elements, properties, processRules, standardVersions }
  }

  private materialGradeInclude() {
    return {
      elements: { orderBy: { elementName: 'asc' as const } },
      properties: { orderBy: { propertyName: 'asc' as const } },
      processRules: { orderBy: { parameterName: 'asc' as const } },
      standardVersions: { orderBy: { version: 'desc' as const } },
    }
  }

  private async createMaterialGrade(body: Record<string, unknown>) {
    const details = this.materialGradeDetails(body)
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.materialGrade.create({
        data: this.normalize('materials', body) as Prisma.MaterialGradeUncheckedCreateInput,
      })
      const code = record.code
      if (details.elements.length) await tx.materialGradeElement.createMany({ data: details.elements.map((item) => ({ ...item, materialGradeCode: code })) as Prisma.MaterialGradeElementCreateManyInput[] })
      if (details.properties.length) await tx.materialGradeProperty.createMany({ data: details.properties.map((item) => ({ ...item, materialGradeCode: code })) as Prisma.MaterialGradePropertyCreateManyInput[] })
      if (details.processRules.length) await tx.materialGradeProcessRule.createMany({ data: details.processRules.map((item) => ({ ...item, materialGradeCode: code })) as Prisma.MaterialGradeProcessRuleCreateManyInput[] })
      if (details.standardVersions.length) await tx.materialGradeStandardVersion.createMany({ data: details.standardVersions.map((item) => ({ ...item, materialGradeCode: code })) as Prisma.MaterialGradeStandardVersionCreateManyInput[] })
      return tx.materialGrade.findUniqueOrThrow({ where: { code }, include: this.materialGradeInclude() })
    })
  }

  private async updateMaterialGrade(id: string, body: Record<string, unknown>) {
    const details = this.materialGradeDetails(body)
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.materialGrade.update({ where: { code: id }, data: this.normalize('materials', body) as Prisma.MaterialGradeUncheckedUpdateInput })
      await tx.materialGradeElement.deleteMany({ where: { materialGradeCode: id } })
      await tx.materialGradeProperty.deleteMany({ where: { materialGradeCode: id } })
      await tx.materialGradeProcessRule.deleteMany({ where: { materialGradeCode: id } })
      if (details.elements.length) await tx.materialGradeElement.createMany({ data: details.elements.map((item) => ({ ...item, materialGradeCode: record.code })) as Prisma.MaterialGradeElementCreateManyInput[] })
      if (details.properties.length) await tx.materialGradeProperty.createMany({ data: details.properties.map((item) => ({ ...item, materialGradeCode: record.code })) as Prisma.MaterialGradePropertyCreateManyInput[] })
      if (details.processRules.length) await tx.materialGradeProcessRule.createMany({ data: details.processRules.map((item) => ({ ...item, materialGradeCode: record.code })) as Prisma.MaterialGradeProcessRuleCreateManyInput[] })
      for (const item of details.standardVersions) {
        await tx.materialGradeStandardVersion.upsert({
          where: { materialGradeCode_version: { materialGradeCode: record.code, version: item.version as string } },
          update: { standard: item.standard, effectiveDate: item.effectiveDate, expiryDate: item.expiryDate, status: item.status, remark: item.remark },
          create: { ...item, materialGradeCode: record.code } as Prisma.MaterialGradeStandardVersionCreateManyInput,
        })
      }
      return tx.materialGrade.findUniqueOrThrow({ where: { code: record.code }, include: this.materialGradeInclude() })
    })
  }

  private recipeInclude() {
    return {
      materialGrade: true,
      createdBy: { select: { id: true, name: true } },
      applicableFurnaces: { include: { furnace: true }, orderBy: { furnaceCode: 'asc' as const } },
      targetElements: { orderBy: { elementName: 'asc' as const } },
      recipeItems: { include: { item: true }, orderBy: { createdAt: 'asc' as const } },
    }
  }

  private async nextRecipeCode() {
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const prefix = `REC-${date}-`
    const latest = await this.prisma.meltRecipe.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    })
    const sequence = latest ? Number(latest.code.slice(prefix.length)) + 1 : 1
    return `${prefix}${String(sequence).padStart(3, '0')}`
  }

  private async normalizeRecipeBody(body: Record<string, unknown>) {
    const name = stringValue(body.name)
    const materialGradeCode = stringValue(body.materialGradeCode)
    const furnaceCodes = Array.from(new Set(toStringArray(body.furnaceCodes)))
    const baseWeightKg = toNullableNumber(body.baseWeightKg) ?? 1000
    const meltingDurationMinutes = Number(body.meltingDurationMinutes)
    const transferDurationMinutes = Number(body.transferDurationMinutes)
    const cleaningDurationMinutes = Number(body.cleaningDurationMinutes)
    const targetElements = toRecipeTargetElements(body.targetElements)
    const items = toRecipeItems(body.items).map((item) => ({
      ...item,
      quantity: item.materialCategory === 'ADDITIVE'
        ? item.quantity
        : item.ratio === undefined ? item.quantity : baseWeightKg * item.ratio / 100,
      unit: item.unit || 'kg',
    }))
    if (!name || !materialGradeCode || !furnaceCodes.length) throw new BadRequestException('请填写配方名称、材质牌号和适用炉型')
    if (baseWeightKg <= 0) throw new BadRequestException('配方基准重量必须大于 0')
    const durations = [meltingDurationMinutes, transferDurationMinutes, cleaningDurationMinutes]
    if (durations.some((value) => !Number.isInteger(value) || value < 0)) throw new BadRequestException('配方时长必须为非负整数分钟')
    if (durations.reduce((sum, value) => sum + value, 0) <= 0) throw new BadRequestException('配方总占用时长必须大于 0')
    if (new Set(targetElements.map((item) => item.elementName)).size !== targetElements.length) throw new BadRequestException('目标化学元素不能重复')
    if (new Set(items.map((item) => item.itemCode)).size !== items.length) throw new BadRequestException('配料物料不能重复')
    for (const item of targetElements) {
      if ((item.minValue !== undefined && item.minValue < 0) || (item.maxValue !== undefined && item.maxValue < 0)) throw new BadRequestException('目标成分不能为负数')
      if (item.minValue !== undefined && item.maxValue !== undefined && item.minValue > item.maxValue) throw new BadRequestException('目标成分下限不能大于上限')
    }
    for (const item of items) {
      if ((item.ratio !== undefined && item.ratio < 0) || (item.quantity !== undefined && item.quantity < 0)) throw new BadRequestException('投料比例和标准用量不能为负数')
    }
    const [material, furnaces, products] = await Promise.all([
      this.prisma.materialGrade.findFirst({ where: { code: materialGradeCode, status: '启用' } }),
      this.prisma.furnace.findMany({ where: { code: { in: furnaceCodes }, status: '启用', workshop: { type: '熔炼' } }, select: { code: true } }),
      this.prisma.product.findMany({ where: { code: { in: items.map((item) => item.itemCode) }, type: { startsWith: '原材料' } }, select: { code: true } }),
    ])
    if (!material) throw new BadRequestException('材质牌号不存在或未启用')
    if (furnaces.length !== furnaceCodes.length) throw new BadRequestException('适用炉型不存在、未启用或不属于熔炼车间')
    if (products.length !== items.length) throw new BadRequestException('配料只能选择物料管理中的原材料')
    return {
      name,
      materialGradeCode,
      furnaceCodes,
      version: stringValue(body.version) || 'V1.0',
      baseWeightKg,
      meltingDurationMinutes,
      transferDurationMinutes,
      cleaningDurationMinutes,
      targetElements,
      items,
      remark: stringValue(body.remark),
    }
  }

  private async createRecipe(request: RequestWithAdmin, body: Record<string, unknown>) {
    const input = await this.normalizeRecipeBody(body)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = await this.nextRecipeCode()
      try {
        return await this.prisma.meltRecipe.create({
          data: {
            code,
            name: input.name,
            materialGradeCode: input.materialGradeCode,
            version: input.version,
            baseWeightKg: input.baseWeightKg,
            meltingDurationMinutes: input.meltingDurationMinutes,
            transferDurationMinutes: input.transferDurationMinutes,
            cleaningDurationMinutes: input.cleaningDurationMinutes,
            createdByUserId: getAdminContext(request).id,
            status: 'DRAFT',
            remark: input.remark,
            applicableFurnaces: { create: input.furnaceCodes.map((furnaceCode) => ({ furnaceCode })) },
            targetElements: { create: input.targetElements },
            recipeItems: { create: input.items },
          },
          include: this.recipeInclude(),
        })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 2) throw error
      }
    }
    throw new BadRequestException('配方编码生成失败，请重试')
  }

  private async updateRecipe(code: string, body: Record<string, unknown>) {
    const existing = await this.prisma.meltRecipe.findUnique({ where: { code }, select: { status: true, version: true } })
    if (!existing) throw new NotFoundException('配方不存在')
    if (existing.status === 'ACTIVE') throw new BadRequestException('已生效配方请先停用后再修改')
    if (existing.status !== 'DRAFT' && existing.status !== 'DISABLED') throw new BadRequestException('当前配方状态不允许编辑')
    const input = await this.normalizeRecipeBody(body)
    const version = existing.status === 'DISABLED' ? this.nextRecipeVersion(existing.version) : existing.version
    return this.prisma.meltRecipe.update({
      where: { code },
      data: {
        name: input.name,
        materialGradeCode: input.materialGradeCode,
        version,
        status: existing.status === 'DISABLED' ? 'DRAFT' : existing.status,
        baseWeightKg: input.baseWeightKg,
        meltingDurationMinutes: input.meltingDurationMinutes,
        transferDurationMinutes: input.transferDurationMinutes,
        cleaningDurationMinutes: input.cleaningDurationMinutes,
        remark: input.remark,
        applicableFurnaces: { deleteMany: {}, create: input.furnaceCodes.map((furnaceCode) => ({ furnaceCode })) },
        targetElements: { deleteMany: {}, create: input.targetElements },
        recipeItems: { deleteMany: {}, create: input.items },
      },
      include: this.recipeInclude(),
    })
  }

  private nextRecipeVersion(version: string) {
    const matched = /^V(\d+)\.0$/.exec(version)
    if (!matched) throw new BadRequestException('配方版本格式不正确，无法自动升级')
    return `V${Number(matched[1]) + 1}.0`
  }

  private assertRecipeCanActivate(recipe: Prisma.MeltRecipeGetPayload<{ include: ReturnType<ModelingController['recipeInclude']> }>) {
    if (recipe.meltingDurationMinutes + recipe.transferDurationMinutes + recipe.cleaningDurationMinutes <= 0) {
      throw new BadRequestException('请先维护熔炼、转运和清炉时长')
    }
    if (!recipe.targetElements.length) throw new BadRequestException('至少维护一个目标化学成分')
    if (!recipe.recipeItems.length) throw new BadRequestException('至少维护一条配料')
    if (recipe.targetElements.some((item) => item.minValue === null || item.maxValue === null)) {
      throw new BadRequestException('目标化学成分必须填写下限和上限')
    }
    if (recipe.recipeItems.some((item) => item.materialCategory !== 'ADDITIVE' && (item.ratio === null || Number(item.ratio) <= 0))) {
      throw new BadRequestException('原材料与回炉料必须填写大于 0 的投料比例')
    }
    if (recipe.recipeItems.some((item) => item.materialCategory === 'ADDITIVE' && (item.quantity === null || Number(item.quantity) <= 0))) {
      throw new BadRequestException('辅料/合金必须填写大于 0 的标准用量')
    }
    const ratio = recipe.recipeItems
      .filter((item) => item.materialCategory === 'RAW' || item.materialCategory === 'RETURN')
      .reduce((total, item) => total + Number(item.ratio || 0), 0)
    if (Math.abs(ratio - 100) > 0.0001) throw new BadRequestException('原材料与回炉料投料比例合计必须为 100%')
  }

  private async assertRelations(resource: ResourceName, body: Record<string, unknown>) {
    const checks: Array<[unknown, string, (code: string) => Promise<unknown | null>]> = [
      [body.workshopCode, '车间不存在', (code) => this.prisma.workshop.findUnique({ where: { code } })],
      [body.materialGradeCode, '材质牌号不存在', (code) => this.prisma.materialGrade.findUnique({ where: { code } })],
      [body.itemCode, '物料不存在', (code) => this.prisma.product.findUnique({ where: { code } })],
      [body.materialGradeCode, '材质牌号不存在', (code) => this.prisma.materialGrade.findUnique({ where: { code } })],
      [body.moldCode, '模具不存在', (code) => this.prisma.moldMaster.findUnique({ where: { code } })],
      [body.supplierCode, '供应商不存在', (code) => this.prisma.supplier.findUnique({ where: { code } })],
      [body.shiftCode, '班次不存在', (code) => this.prisma.shiftMaster.findUnique({ where: { code } })],
      [body.teamCode, '班组不存在', (code) => this.prisma.team.findUnique({ where: { code } })],
    ]
    if (resource === 'lines') {
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
        () => this.prisma.shiftSchedule.count({ where: { workshopCode: id } }),
      ],
      lines: [],
      teams: [() => this.prisma.shiftSchedule.count({ where: { teamCode: id } })],
      items: [
        () => this.prisma.moldMaster.count({ where: { itemCode: id } }),
        () => this.prisma.routingApplicableProduct.count({ where: { productCode: id } }),
        () => this.prisma.meltRecipeItem.count({ where: { itemCode: id } }),
      ],
      materials: [
        () => this.prisma.meltRecipe.count({ where: { materialGradeCode: id } }),
        () => this.prisma.furnaceAllowedMaterial.count({ where: { materialGradeCode: id } }),
        () => this.prisma.product.count({ where: { materialGradeCode: id } }),
      ],
      equipment: [],
      recipes: [],
      molds: [
        () => this.prisma.coreBoxMaster.count({ where: { moldCode: id } }),
        () => this.prisma.castingBomVersionMold.count({ where: { moldCode: id } }),
      ],
      coreboxes: [() => this.prisma.castingBomVersionCoreBox.count({ where: { coreBoxCode: id } })],
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
        capacityUnit: value.capacityUnit || '',
        allowedMaterialCodes: Array.isArray(value.allowedMaterials)
          ? value.allowedMaterials.map((item) => (item as { materialGradeCode: string }).materialGradeCode)
          : toStringArray(value.allowedMaterialCodes),
      }
    }
    if (resource === 'materials') {
      const decimal = (value: unknown) => value === null || value === undefined ? value : Number(value)
      return {
        ...base,
        elements: Array.isArray(value.elements)
          ? value.elements.map((item) => ({ ...(item as Record<string, unknown>), fixedValue: decimal((item as { fixedValue?: unknown }).fixedValue), minValue: decimal((item as { minValue?: unknown }).minValue), maxValue: decimal((item as { maxValue?: unknown }).maxValue) }))
          : toJsonArray(value.elementLimits),
        properties: Array.isArray(value.properties)
          ? value.properties.map((item) => ({ ...(item as Record<string, unknown>), fixedValue: decimal((item as { fixedValue?: unknown }).fixedValue), minValue: decimal((item as { minValue?: unknown }).minValue), maxValue: decimal((item as { maxValue?: unknown }).maxValue) }))
          : [],
        processRules: Array.isArray(value.processRules)
          ? value.processRules.map((item) => ({ ...(item as Record<string, unknown>), fixedValue: decimal((item as { fixedValue?: unknown }).fixedValue), minValue: decimal((item as { minValue?: unknown }).minValue), maxValue: decimal((item as { maxValue?: unknown }).maxValue) }))
          : [],
        standardVersions: value.standardVersions || [],
      }
    }
    if (resource === 'recipes') {
      const decimal = (next: unknown) => next === null || next === undefined ? next : Number(next)
      return {
        ...base,
        status: value.status === '启用' ? 'ACTIVE' : value.status === '停用' ? 'DISABLED' : value.status,
        baseWeightKg: decimal(value.baseWeightKg) || 1000,
        meltingDurationMinutes: Number(value.meltingDurationMinutes || 0),
        transferDurationMinutes: Number(value.transferDurationMinutes || 0),
        cleaningDurationMinutes: Number(value.cleaningDurationMinutes || 0),
        occupancyDurationMinutes: Number(value.meltingDurationMinutes || 0) + Number(value.transferDurationMinutes || 0) + Number(value.cleaningDurationMinutes || 0),
        materialGradeName: value.materialGrade && typeof value.materialGrade === 'object'
          ? String((value.materialGrade as { name?: unknown }).name || '')
          : '',
        createdByName: value.createdBy && typeof value.createdBy === 'object'
          ? String((value.createdBy as { name?: unknown }).name || '')
          : '',
        furnaceCodes: Array.isArray(value.applicableFurnaces)
          ? value.applicableFurnaces.map((item) => String((item as { furnaceCode?: unknown }).furnaceCode || ''))
          : [],
        furnaceNames: Array.isArray(value.applicableFurnaces)
          ? value.applicableFurnaces.map((item) => {
              const furnace = (item as { furnace?: { name?: unknown } }).furnace
              return String(furnace?.name || '')
            }).filter(Boolean)
          : [],
        targetElements: Array.isArray(value.targetElements)
          ? value.targetElements.map((item) => ({
              ...(item as Record<string, unknown>),
              minValue: decimal((item as { minValue?: unknown }).minValue),
              maxValue: decimal((item as { maxValue?: unknown }).maxValue),
            }))
          : [],
        items: Array.isArray(value.recipeItems)
          ? value.recipeItems.map((item) => {
              const recipeItem = item as Record<string, unknown>
              const product = recipeItem.item as { name?: unknown; type?: unknown } | undefined
              return {
                itemCode: recipeItem.itemCode,
                itemName: String(product?.name || ''),
                itemType: String(product?.type || ''),
                materialCategory: recipeItem.materialCategory || 'RAW',
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
    if (resource === 'recipes') return this.recipeInclude()
    if (resource === 'calendars') return { shifts: true }
    if (resource === 'molds') return { supplier: true, coreBoxes: true }
    if (resource === 'materials') return this.materialGradeInclude()
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

  private coreBoxesFromBody(body: Record<string, unknown>, moldCode: string, moldName: string) {
    let source: Record<string, unknown>[] | null = null
    if (Array.isArray(body.coreBoxes)) {
      source = body.coreBoxes.map((item) => item as Record<string, unknown>)
    } else if (body.hasCoreBox === true) {
      source = [{
        code: stringValue(body.coreBoxCode) || `${moldCode}-COREBOX`,
        name: stringValue(body.coreBoxName) || `${moldName}芯盒`,
        images: toJsonArray(body.coreBoxImages).length ? body.coreBoxImages : body.images,
        maxLife: body.coreBoxMaxLife ?? body.maxLife,
        usedLife: body.coreBoxUsedLife,
        status: body.coreBoxStatus ?? body.status,
        remark: body.coreBoxRemark ?? body.remark,
      }]
    } else if (body.hasCoreBox === false) {
      source = []
    }
    if (source === null) return null

    const codes = new Set<string>()
    return source.map((item) => {
      const code = stringValue(item.code)
      if (!code) throw new BadRequestException('芯盒编码不能为空')
      if (!codePattern.test(code)) throw new BadRequestException(`芯盒编码 ${code} 不能包含中文或空格`)
      if (codes.has(code)) throw new BadRequestException(`芯盒编码 ${code} 在本次请求中重复`)
      codes.add(code)
      return {
        code,
        name: stringValue(item.name) || code,
        images: toJsonArray(item.images),
        cavityCount: positiveInteger(item.cavityCount, '芯盒穴数'),
        maxLife: toInt(item.maxLife),
        usedLife: toInt(item.usedLife) ?? 0,
        status: stringValue(item.status) || '启用',
        remark: stringValue(item.remark),
      }
    })
  }

  private async syncMoldCoreBoxes(
    tx: Prisma.TransactionClient,
    moldCode: string,
    coreBoxes: ReturnType<ModelingController['coreBoxesFromBody']>,
    user: ReturnType<typeof getAdminContext>,
  ) {
    if (coreBoxes === null) {
      const enabledCount = await tx.coreBoxMaster.count({ where: { moldCode, status: '启用' } })
      await tx.moldMaster.update({ where: { code: moldCode }, data: { hasCoreBox: enabledCount > 0 } })
      return
    }

    const requestedCodes = coreBoxes.map((item) => item.code)
    if (requestedCodes.length) {
      const conflicts = await tx.coreBoxMaster.findMany({
        where: { code: { in: requestedCodes }, moldCode: { not: moldCode } },
        select: { code: true, moldCode: true },
      })
      if (conflicts.length) {
        const conflict = conflicts[0]
        throw new BadRequestException(`芯盒编码 ${conflict.code} 已属于其他模具 ${conflict.moldCode}`)
      }
    }

    for (const coreBox of coreBoxes) {
      const data = { ...coreBox, moldCode }
      await tx.coreBoxMaster.upsert({
        where: { code: coreBox.code },
        create: data,
        update: data,
      })
      await upsertOwnership(tx, user, this.entityType('coreboxes'), coreBox.code)
    }
    await tx.coreBoxMaster.updateMany({
      where: { moldCode, ...(requestedCodes.length ? { code: { notIn: requestedCodes } } : {}) },
      data: { status: '停用' },
    })
    const enabledCount = await tx.coreBoxMaster.count({ where: { moldCode, status: '启用' } })
    await tx.moldMaster.update({ where: { code: moldCode }, data: { hasCoreBox: enabledCount > 0 } })
  }

  private async assertNestedCoreBoxPermissions(
    request: RequestWithAdmin,
    moldCode: string | undefined,
    body: Record<string, unknown>,
  ) {
    const coreBoxes = this.coreBoxesFromBody(body, moldCode || stringValue(body.code) || '', stringValue(body.name) || '')
    if (coreBoxes === null) return

    const user = getAdminContext(request)
    const existingCodes = moldCode
      ? new Set((await this.prisma.coreBoxMaster.findMany({ where: { moldCode }, select: { code: true } })).map((item) => item.code))
      : new Set<string>()
    const hasNewCoreBox = coreBoxes.some((item) => !existingCodes.has(item.code))
    if (hasNewCoreBox && !hasAdminPermission(user, 'mold.corebox.create')) {
      throw new ForbiddenException('无权新增芯盒档案')
    }
    if (existingCodes.size && !hasAdminPermission(user, 'mold.corebox.edit')) {
      throw new ForbiddenException('无权修改或停用芯盒档案')
    }
  }

  private async syncMoldDevelopmentArchive(
    tx: Prisma.TransactionClient,
    moldCode: string,
    previousSourceCode: string | null,
    nextSourceCode: string | null,
  ) {
    if (previousSourceCode && previousSourceCode !== nextSourceCode) {
      await tx.moldDevelopment.updateMany({
        where: { code: previousSourceCode, archivedMoldCode: moldCode },
        data: { archivedMoldCode: null },
      })
    }
    if (!nextSourceCode) return

    const linked = await tx.moldDevelopment.updateMany({
      where: {
        code: nextSourceCode,
        status: 'COMPLETED',
        OR: [{ archivedMoldCode: null }, { archivedMoldCode: moldCode }],
      },
      data: { archivedMoldCode: moldCode },
    })
    if (linked.count === 1) return

    const development = await tx.moldDevelopment.findUnique({
      where: { code: nextSourceCode },
      select: { status: true, archivedMoldCode: true },
    })
    if (!development) throw new BadRequestException('来源开发单不存在')
    if (development.status !== 'COMPLETED') throw new BadRequestException('仅已完成的模具开发单可以建档')
    throw new BadRequestException(`开发单 ${nextSourceCode} 已建档`)
  }

  private async createMoldWithCoreBoxes(body: Record<string, unknown>, user: ReturnType<typeof getAdminContext>) {
    return this.prisma.$transaction(async (tx) => {
      const moldCode = stringValue(body.code) as string
      const moldName = stringValue(body.name) || moldCode
      const coreBoxes = this.coreBoxesFromBody(body, moldCode, moldName)
      await tx.moldMaster.create({
        data: { ...(this.normalize('molds', body) as Prisma.MoldMasterUncheckedCreateInput), hasCoreBox: false },
      })
      await upsertOwnership(tx, user, this.entityType('molds'), moldCode)
      await this.syncMoldCoreBoxes(tx, moldCode, coreBoxes, user)
      await this.syncMoldDevelopmentArchive(tx, moldCode, null, stringValue(body.sourceMoldDevelopmentCode) || null)
      return tx.moldMaster.findUniqueOrThrow({ where: { code: moldCode }, include: { supplier: true, coreBoxes: true } })
    })
  }

  private async updateMoldWithCoreBoxes(id: string, body: Record<string, unknown>, user: ReturnType<typeof getAdminContext>) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.moldMaster.findUniqueOrThrow({ where: { code: id }, select: { sourceMoldDevelopmentCode: true } })
      const sourceWasProvided = Object.prototype.hasOwnProperty.call(body, 'sourceMoldDevelopmentCode')
      const nextSourceCode = sourceWasProvided
        ? stringValue(body.sourceMoldDevelopmentCode) || null
        : existing.sourceMoldDevelopmentCode
      const data = this.normalize('molds', body) as Prisma.MoldMasterUncheckedUpdateInput
      if (sourceWasProvided) data.sourceMoldDevelopmentCode = nextSourceCode
      const record = await tx.moldMaster.update({
        where: { code: id },
        data,
      })
      const coreBoxes = this.coreBoxesFromBody(body, record.code, record.name)
      await this.syncMoldCoreBoxes(tx, record.code, coreBoxes, user)
      await this.syncMoldDevelopmentArchive(tx, record.code, existing.sourceMoldDevelopmentCode, nextSourceCode)
      return tx.moldMaster.findUniqueOrThrow({ where: { code: record.code }, include: { supplier: true, coreBoxes: true } })
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
        materialCategory: ['RAW', 'RETURN', 'ADDITIVE'].includes(String(record.materialCategory))
          ? String(record.materialCategory)
          : 'RAW',
        ratio: toNullableNumber(record.ratio),
        quantity: toNullableNumber(record.quantity),
        unit: stringValue(record.unit),
        remark: stringValue(record.remark),
      }
    })
    .filter((item): item is { itemCode: string; materialCategory: string; ratio?: number; quantity?: number; unit?: string; remark?: string } =>
      Boolean(item.itemCode),
    )
}

function toRecipeTargetElements(value: unknown) {
  return toJsonArray(value)
    .flatMap((item) => {
      const record = item as Record<string, unknown>
      const elementName = stringValue(record.elementName || record.name)
      if (!elementName) return []
      return [{
        elementName,
        minValue: toNullableNumber(record.minValue),
        maxValue: toNullableNumber(record.maxValue),
        unit: stringValue(record.unit) || '%',
        remark: stringValue(record.remark),
      }]
    })
}
