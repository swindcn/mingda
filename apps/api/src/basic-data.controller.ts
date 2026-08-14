import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { DataScope, Prisma, SyncProvider } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaService } from './prisma/prisma.service'
import { getAdminContext, upsertOwnership, visibleOwnershipEntityIds, type RequestWithAdmin } from './shared/admin-context'
import { AdminAuthGuard } from './shared/admin-auth.guard'
import { AdminPermissionGuard } from './shared/admin-permission.guard'

interface DepartmentBody {
  name?: string
  code?: string
  parentKey?: string
}

interface UserBody {
  name?: string
  phone?: string
  password?: string
  userType?: '超管' | '员工' | '供应商' | '客户'
  organization?: string
  department?: string
  departmentId?: string
  position?: string
  role?: string
  status?: '启用' | '禁用'
  lockStatus?: '正常' | '锁定'
  belongsTo?: string
}

interface SyncDepartmentsBody {
  provider?: 'dingtalk' | 'wechat-work' | 'lark'
  syncMode?: 'merge' | 'overwrite'
  departments?: DepartmentBody[]
}

interface DictionaryBody {
  moldTypes?: string[]
  productUnits?: string[]
  productTypes?: unknown[]
  positions?: string[]
  workshopTypes?: string[]
  operationSections?: string[]
  materialTypes?: string[]
  equipmentTypes?: string[]
  chemicalElements?: Array<{ name?: string; unit?: string }>
  mechanicalProperties?: Array<{ name?: string; unit?: string; testMethod?: string }>
  processRequirements?: Array<{ name?: string; unit?: string; valueType?: 'number' | 'text' }>
}

interface ProductTypeNode {
  name: string
  children?: ProductTypeNode[]
}

interface PartnerBody {
  name?: string
  address?: string
  contact?: string
  phone?: string
}

interface ProductBody {
  name?: string
  code?: string
  spec?: string
  unit?: string
  type?: string
  source?: string
  workshop?: string
  purchaseUnit?: string
  salesUnit?: string
  inventoryUnit?: string
  unitConversions?: unknown
  salePrice?: number
  costPrice?: number
  stockMax?: number
  stockMin?: number
  minPurchase?: number
  dailyCapacity?: number
  remark?: string
}

interface RoleBody {
  name?: string
  organization?: string
  app?: string
  description?: string
  permissions?: string[]
  dataScope?: 'self' | 'department' | 'department_tree' | 'organization' | 'custom_departments'
  dataScopes?: Array<'self' | 'department' | 'department_tree' | 'organization' | 'custom_departments'>
  customDepartments?: Array<{ departmentId: string; includeChildren: boolean }>
  columnPermissions?: string[]
  userIds?: string[]
}

interface SyncUsersBody {
  provider?: 'dingtalk' | 'wechat-work' | 'lark'
  users?: UserBody[]
}

interface DepartmentTreeNode {
  id: string
  name: string
  code: string
  parentId: string | null
  source: SyncProvider
  createdAt: Date
  children: DepartmentTreeNode[]
}

interface DepartmentDto {
  key: string
  name: string
  code: string
  createdAt: string
  source: '本地' | '钉钉' | '企业微信' | '飞书'
  children?: DepartmentDto[]
}

const organizationName = '闽大铸件'

const defaultDictionaries = {
  moldTypes: ['压铸模', '砂型模', '注塑模', '冲压模', '其他'],
  productUnits: ['片', '个', '套', '台', '件'],
  productTypes: [
    { name: '成品' },
    { name: '半成品', children: [{ name: '砂芯' }] },
    { name: '原材料' },
    {
      name: '模具工装',
      children: [{ name: '磨边工装' }, { name: '铝模具' }, { name: '砂芯模具' }],
    },
    { name: '辅助材料' },
    { name: '铸造辅材' },
    { name: '工装耗材' },
    { name: '零辅配件' },
  ],
  positions: ['生产主管', '销售经理', '运营负责人', '产品经理', '会计', '项目成员'],
  workshopTypes: ['熔炼', '造型', '制芯', '清理', '机加工', '检验'],
  operationSections: ['熔炼', '制芯', '造型', '浇注', '清理', '后处理', '质检'],
  materialTypes: ['球铁', '灰铁', '碳钢'],
  equipmentTypes: ['熔炼炉', '浇注包', '球化包', '其他设备'],
  chemicalElements: [
    { name: 'C', unit: '%' },
    { name: 'Si', unit: '%' },
    { name: 'Mn', unit: '%' },
    { name: 'P', unit: '%' },
    { name: 'S', unit: '%' },
  ],
  mechanicalProperties: [
    { name: '抗拉强度', unit: 'MPa', testMethod: 'GB/T 228.1' },
    { name: '屈服强度', unit: 'MPa', testMethod: 'GB/T 228.1' },
    { name: '伸长率', unit: '%', testMethod: 'GB/T 228.1' },
    { name: '硬度', unit: 'HB', testMethod: 'GB/T 231.1' },
  ],
  processRequirements: [
    { name: '熔炼温度', unit: '℃', valueType: 'number' as const },
    { name: '浇注温度', unit: '℃', valueType: 'number' as const },
    { name: '热处理方式', unit: '', valueType: 'text' as const },
    { name: '保温时间', unit: 'min', valueType: 'number' as const },
  ],
}

const adminPermissions = [
  'admin',
  'basic',
  'basic.department',
  'basic.department.create',
  'basic.department.edit',
  'basic.department.delete',
  'basic.department.sync',
  'basic.user',
  'basic.user.create',
  'basic.user.edit',
  'basic.user.delete',
  'basic.user.sync',
  'basic.role',
  'basic.role.create',
  'basic.role.edit',
  'basic.role.delete',
  'basic.role.config',
  'basic.role.users',
  'basic.role.copy',
  'basic.customer',
  'basic.customer.create',
  'basic.customer.edit',
  'basic.customer.delete',
  'basic.supplier',
  'basic.supplier.create',
  'basic.supplier.edit',
  'basic.supplier.delete',
  'basic.product',
  'basic.product.create',
  'basic.product.edit',
  'basic.product.delete',
  'basic.product.view_synced_public',
  'basic.dictionary',
  'basic.dictionary.edit',
  'mold',
  'mold.development.view',
  'mold.development.create',
  'mold.development.edit',
  'mold.development.delete',
  'mold.model.view',
  'mold.model.create',
  'mold.model.edit',
  'mold.model.delete',
  'mold.corebox.view',
  'mold.corebox.create',
  'mold.corebox.edit',
  'mold.corebox.delete',
  'model',
  'model.workshop-line.view',
  'model.workshop-line.create',
  'model.workshop-line.edit',
  'model.workshop-line.delete',
  'model.team.view',
  'model.team.create',
  'model.team.edit',
  'model.team.delete',
  'model.equipment.view',
  'model.equipment.create',
  'model.equipment.edit',
  'model.equipment.delete',
  'model.material.view',
  'model.material.create',
  'model.material.edit',
  'model.material.delete',
  'model.recipe.view',
  'model.recipe.create',
  'model.recipe.edit',
  'model.recipe.delete',
  'model.recipe.clone',
  'model.recipe.activate',
  'model.recipe.disable',
  'model.bom.view',
  'model.bom.create',
  'model.bom.edit',
  'model.bom.delete',
  'model.bom.clone',
  'model.bom.activate',
  'model.bom.disable',
  'model.bom.new_version',
  'model.operation.view',
  'model.operation.create',
  'model.operation.edit',
  'model.operation.disable',
  'model.routing.view',
  'model.routing.create',
  'model.routing.edit',
  'model.routing.delete',
  'model.routing.version',
  'model.routing.clone',
  'model.routing.activate',
  'model.routing.disable',
  'model.routing.default',
  'model.calendar.view',
  'model.calendar.create',
  'model.calendar.edit',
  'model.calendar.delete',
  'model.schedule.view',
  'model.schedule.create',
  'model.schedule.edit',
  'model.schedule.delete',
  'model.schedule.batch',
  'model.defect.view',
  'model.defect.create',
  'model.defect.edit',
  'model.defect.delete',
  'production',
  'production.work_order.view',
  'production.work_order.create',
  'production.work_order.edit',
  'production.work_order.close',
  'production.work_order.view_synced_public',
  'production.schedule.view',
  'production.schedule.create',
  'production.schedule.adjust',
  'production.schedule.cancel',
  'production.heat.view',
  'production.heat.start',
  'production.heat.transfer',
  'production.heat.complete',
  'mini',
  'mini.production',
  'mini.production.heat.view',
  'mini.production.heat.start',
  'mini.production.heat.transfer',
  'mini.production.heat.complete',
]


function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

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

function sourceLabel(source: SyncProvider) {
  const map: Record<SyncProvider, '本地' | '钉钉' | '企业微信' | '飞书'> = {
    LOCAL: '本地',
    DINGTALK: '钉钉',
    WECHAT_WORK: '企业微信',
    LARK: '飞书',
  }
  return map[source]
}

function userTypeLabel(value: string) {
  const map: Record<string, '超管' | '员工' | '供应商' | '客户'> = {
    SUPER_ADMIN: '超管',
    EMPLOYEE: '员工',
    SUPPLIER: '供应商',
    CUSTOMER: '客户',
  }
  return map[value] || '员工'
}

function userTypeValue(value?: UserBody['userType']) {
  const map = {
    超管: 'SUPER_ADMIN',
    员工: 'EMPLOYEE',
    供应商: 'SUPPLIER',
    客户: 'CUSTOMER',
  } as const
  return value ? map[value] : undefined
}

function frontendScope(scope: DataScope) {
  const map: Record<DataScope, RoleBody['dataScope']> = {
    ALL: 'organization',
    OWN: 'self',
    OWN_DEPARTMENT: 'department',
    OWN_AND_CHILD_DEPARTMENTS: 'department_tree',
    CUSTOM_DEPARTMENTS: 'custom_departments',
  }
  return map[scope] || 'self'
}

function prismaScope(scope?: RoleBody['dataScope']) {
  const map: Record<NonNullable<RoleBody['dataScope']>, DataScope> = {
    organization: 'ALL',
    self: 'OWN',
    department: 'OWN_DEPARTMENT',
    department_tree: 'OWN_AND_CHILD_DEPARTMENTS',
    custom_departments: 'CUSTOM_DEPARTMENTS',
  }
  return scope ? map[scope] : undefined
}

function frontendScopes(value: Prisma.JsonValue | null | undefined, fallback: DataScope): NonNullable<RoleBody['dataScopes']> {
  const dataScopeValues = new Set(Object.values(DataScope))
  const scopes = Array.isArray(value)
    ? value.filter((item): item is DataScope => typeof item === 'string' && dataScopeValues.has(item as DataScope))
    : []
  return (scopes.length ? scopes : [fallback]).map((scope) => frontendScope(scope)).filter(Boolean) as NonNullable<RoleBody['dataScopes']>
}

function prismaScopes(scopes?: RoleBody['dataScopes'], fallback?: RoleBody['dataScope']) {
  const nextScopes = scopes?.length ? scopes : fallback ? [fallback] : []
  return Array.from(new Set(nextScopes.map((scope) => prismaScope(scope)).filter((scope): scope is DataScope => Boolean(scope))))
}

function providerValue(provider?: SyncDepartmentsBody['provider'] | SyncUsersBody['provider']) {
  const map: Record<string, SyncProvider> = {
    dingtalk: 'DINGTALK',
    'wechat-work': 'WECHAT_WORK',
    lark: 'LARK',
  }
  return provider ? map[provider] || 'LOCAL' : 'LOCAL'
}

function toNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function toInteger(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : undefined
}

function stringArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

type DictionaryOption = { name: string; unit?: string; testMethod?: string; valueType?: 'number' | 'text' }

function dictionaryOptions(value: Prisma.JsonValue | null | undefined, fallback: DictionaryOption[]): DictionaryOption[] {
  if (!Array.isArray(value)) return fallback
  const result = value
    .map((item) => {
      if (typeof item === 'string') return { name: item.trim() }
      if (!item || typeof item !== 'object' || !('name' in item)) return null
      const record = item as { name?: unknown; unit?: unknown; testMethod?: unknown; valueType?: unknown }
      const name = String(record.name || '').trim()
      if (!name) return null
      return {
        name,
        unit: String(record.unit || ''),
        ...(record.testMethod ? { testMethod: String(record.testMethod) } : {}),
        ...(record.valueType === 'text' ? { valueType: 'text' as const } : record.valueType === 'number' ? { valueType: 'number' as const } : {}),
      }
    })
    .filter((item): item is DictionaryOption => Boolean(item))
  return result.length ? result : fallback
}

function normalizeDictionaryOptions(value: unknown, fallback: DictionaryOption[]): DictionaryOption[] {
  return dictionaryOptions(Array.isArray(value) ? value as Prisma.JsonValue : undefined, fallback)
}

function productTypeTree(
  value: Prisma.JsonValue | null | undefined,
  fallback: ProductTypeNode[] = defaultDictionaries.productTypes,
): ProductTypeNode[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value
    .map((item) => {
      if (typeof item === 'string') {
        const name = item.trim()
        return name ? { name } : null
      }
      if (typeof item !== 'object' || !item || !('name' in item)) return null
      const name = String((item as { name?: unknown }).name || '').trim()
      if (!name) return null
      const children = productTypeTree((item as { children?: Prisma.JsonValue }).children || [], []).filter(Boolean)
      return children.length ? { name, children } : { name }
    })
    .filter((item): item is ProductTypeNode => Boolean(item))
  return normalized.length ? normalized : fallback
}

function customDepartments(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { departmentId: string; includeChildren: boolean } => {
      return (
        typeof item === 'object' &&
        item !== null &&
        'departmentId' in item &&
        typeof item.departmentId === 'string'
      )
    })
    .map((item) => ({
      departmentId: item.departmentId,
      includeChildren: Boolean(item.includeChildren),
    }))
}

@Controller('admin')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class BasicDataController {
  constructor(private readonly prisma: PrismaService) {}


  @Get('dictionaries')
  async dictionaries() {
    return this.getDictionaries()
  }

  @Put('dictionaries')
  async updateDictionaries(@Body() body: DictionaryBody) {
    const next = {
      moldTypes: body.moldTypes?.length ? body.moldTypes : defaultDictionaries.moldTypes,
      productUnits: body.productUnits?.length ? body.productUnits : defaultDictionaries.productUnits,
      productTypes: productTypeTree(body.productTypes as Prisma.JsonValue),
      positions: body.positions?.length ? body.positions : defaultDictionaries.positions,
      workshopTypes: body.workshopTypes?.length ? body.workshopTypes : defaultDictionaries.workshopTypes,
      operationSections: body.operationSections?.length ? body.operationSections : defaultDictionaries.operationSections,
      materialTypes: body.materialTypes?.length ? body.materialTypes : defaultDictionaries.materialTypes,
      equipmentTypes: body.equipmentTypes?.length ? body.equipmentTypes : defaultDictionaries.equipmentTypes,
      chemicalElements: normalizeDictionaryOptions(body.chemicalElements, defaultDictionaries.chemicalElements),
      mechanicalProperties: normalizeDictionaryOptions(body.mechanicalProperties, defaultDictionaries.mechanicalProperties),
      processRequirements: normalizeDictionaryOptions(body.processRequirements, defaultDictionaries.processRequirements),
    }
    await Promise.all(
      Object.entries(next).map(([key, values]) => {
        const jsonValues = values as Prisma.InputJsonValue
        return this.prisma.dictionarySetting.upsert({
          where: { key },
          update: { values: jsonValues },
          create: { key, values: jsonValues },
        })
      }),
    )
    return next
  }

  @Put('users/:id/restore')
  async restoreUser(@Param('id') id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'ENABLED', deletedAt: null },
    })
    return { id }
  }

  @Delete('users/:id/permanent')
  async permanentlyDeleteUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('用户不存在')
    if (user.userType === 'SUPER_ADMIN') {
      throw new BadRequestException('超管用户不允许删除，请先修改为其他用户类型')
    }
    await this.prisma.userRole.deleteMany({ where: { userId: id } })
    await this.prisma.user.delete({ where: { id } })
    return { id }
  }

  @Get('departments')
  async departments() {
    await this.ensureBasicSeed()
    const records = await this.prisma.department.findMany({
      orderBy: [{ parentId: 'asc' }, { createdAt: 'asc' }],
    })
    return this.buildDepartmentTree(records)
  }

  @Post('departments')
  async createDepartment(@Body() body: DepartmentBody) {
    if (!body.name?.trim() || !body.code?.trim()) {
      throw new BadRequestException('请输入部门名称和编号')
    }

    const record = await this.prisma.department.create({
      data: {
        name: body.name.trim(),
        code: body.code.trim(),
        parentId: body.parentKey || null,
        source: 'LOCAL',
      },
    })
    return this.toDepartment(record)
  }

  @Patch('departments/:id')
  async updateDepartment(@Param('id') id: string, @Body() body: DepartmentBody) {
    const record = await this.prisma.department.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        code: body.code?.trim(),
      },
    })
    return this.toDepartment(record)
  }

  @Delete('departments/:id')
  async deleteDepartment(@Param('id') id: string) {
    const target = await this.prisma.department.findUnique({ where: { id } })
    if (!target) throw new NotFoundException('部门不存在')
    const ids = await this.collectDepartmentIds(id)

    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { departmentId: { in: ids } },
        data: { departmentId: null },
      }),
      this.prisma.user.updateMany({
        where: { ownerDepartmentId: { in: ids } },
        data: { ownerDepartmentId: null },
      }),
      this.prisma.businessDataOwnership.updateMany({
        where: { createdByDepartmentId: { in: ids } },
        data: { createdByDepartmentId: null },
      }),
      this.prisma.businessDataOwnership.updateMany({
        where: { ownerDepartmentId: { in: ids } },
        data: { ownerDepartmentId: null },
      }),
      this.prisma.department.deleteMany({
        where: { id: { in: ids } },
      }),
    ])

    return { id, removedIds: ids }
  }

  @Post('departments/sync')
  async syncDepartments(@Body() body: SyncDepartmentsBody) {
    const departments = Array.isArray(body.departments) ? body.departments : []
    if (!departments.length) throw new BadRequestException('没有可同步的部门数据')
    const source = providerValue(body.provider)

    if (body.syncMode === 'overwrite') {
      await this.prisma.$transaction([
        this.prisma.user.updateMany({
          where: {},
          data: { departmentId: null, ownerDepartmentId: null },
        }),
        this.prisma.businessDataOwnership.updateMany({
          where: {},
          data: { createdByDepartmentId: null, ownerDepartmentId: null },
        }),
        this.prisma.department.deleteMany(),
      ])
    }

    for (const department of departments) {
      await this.upsertDepartmentTree(department, null, source)
    }

    return this.departments()
  }


  @Get('customers')
  async customers(@Req() request: RequestWithAdmin) {
    const visibleCodes = await this.visibleEntityIds(request, 'basic:customers')
    const records = await this.prisma.customer.findMany({
      where: visibleCodes ? { code: { in: visibleCodes } } : {},
      orderBy: { createdAt: 'asc' },
    })
    return records.map((record) => this.toPartner(record))
  }

  @Post('customers')
  async createCustomer(@Body() body: PartnerBody, @Req() request: RequestWithAdmin) {
    if (!body.name?.trim()) throw new BadRequestException('请输入客户名称')
    const code = await this.createNextPartnerCode('CUS', 'customer')
    const record = await this.prisma.customer.create({
      data: {
        code,
        name: body.name.trim(),
        address: body.address,
        contact: body.contact,
        phone: body.phone,
      },
    })
    await upsertOwnership(this.prisma, request.adminUser, 'basic:customers', record.code)
    return this.toPartner(record)
  }

  @Put('customers/:id')
  async updateCustomer(@Param('id') id: string, @Body() body: PartnerBody) {
    const record = await this.prisma.customer.update({
      where: { code: id },
      data: {
        name: body.name?.trim(),
        address: body.address,
        contact: body.contact,
        phone: body.phone,
      },
    })
    return this.toPartner(record)
  }

  @Delete('customers/:id')
  async deleteCustomer(@Param('id') id: string) {
    await this.prisma.customer.delete({ where: { code: id } })
    return { id }
  }

  @Get('suppliers')
  async suppliers(@Req() request: RequestWithAdmin) {
    const visibleCodes = await this.visibleEntityIds(request, 'basic:suppliers')
    const records = await this.prisma.supplier.findMany({
      where: visibleCodes ? { code: { in: visibleCodes } } : {},
      orderBy: { createdAt: 'asc' },
    })
    return records.map((record) => this.toPartner(record))
  }

  @Post('suppliers')
  async createSupplier(@Body() body: PartnerBody, @Req() request: RequestWithAdmin) {
    if (!body.name?.trim()) throw new BadRequestException('请输入供应商名称')
    const code = await this.createNextPartnerCode('SUP', 'supplier')
    const record = await this.prisma.supplier.create({
      data: {
        code,
        name: body.name.trim(),
        address: body.address,
        contact: body.contact,
        phone: body.phone,
      },
    })
    await upsertOwnership(this.prisma, request.adminUser, 'basic:suppliers', record.code)
    return this.toPartner(record)
  }

  @Put('suppliers/:id')
  async updateSupplier(@Param('id') id: string, @Body() body: PartnerBody) {
    const record = await this.prisma.supplier.update({
      where: { code: id },
      data: {
        name: body.name?.trim(),
        address: body.address,
        contact: body.contact,
        phone: body.phone,
      },
    })
    return this.toPartner(record)
  }

  @Delete('suppliers/:id')
  async deleteSupplier(@Param('id') id: string) {
    await this.prisma.supplier.delete({ where: { code: id } })
    return { id }
  }

  @Get('products')
  async products(@Req() request: RequestWithAdmin) {
    const visibleCodes = await this.visibleEntityIds(request, 'basic:products')
    const records = await this.prisma.product.findMany({
      where: visibleCodes ? { code: { in: visibleCodes } } : {},
      orderBy: { createdAt: 'asc' },
    })
    return records.map((record) => this.toProduct(record))
  }

  @Post('products')
  async createProduct(@Body() body: ProductBody, @Req() request: RequestWithAdmin) {
    if (!body.name?.trim() || !body.code?.trim()) throw new BadRequestException('请输入产品名称和编码')
    const record = await this.prisma.product.create({
      data: {
        code: body.code.trim(),
        name: body.name.trim(),
        spec: body.spec,
        unit: body.unit,
        type: body.type,
        source: body.source,
        workshop: body.workshop,
        purchaseUnit: body.purchaseUnit,
        salesUnit: body.salesUnit,
        inventoryUnit: body.inventoryUnit,
        unitConversions: (body.unitConversions ?? []) as Prisma.InputJsonValue,
        salePrice: toNumber(body.salePrice),
        costPrice: toNumber(body.costPrice),
        stockMax: toInteger(body.stockMax),
        stockMin: toInteger(body.stockMin),
        minPurchase: toInteger(body.minPurchase),
        dailyCapacity: toInteger(body.dailyCapacity),
        remark: body.remark,
      },
    })
    await upsertOwnership(this.prisma, request.adminUser, 'basic:products', record.code)
    return this.toProduct(record)
  }

  @Put('products/:id')
  async updateProduct(@Param('id') id: string, @Body() body: ProductBody) {
    const record = await this.prisma.product.update({
      where: { code: id },
      data: {
        code: body.code?.trim(),
        name: body.name?.trim(),
        spec: body.spec,
        unit: body.unit,
        type: body.type,
        source: body.source,
        workshop: body.workshop,
        purchaseUnit: body.purchaseUnit,
        salesUnit: body.salesUnit,
        inventoryUnit: body.inventoryUnit,
        unitConversions: (body.unitConversions ?? []) as Prisma.InputJsonValue,
        salePrice: toNumber(body.salePrice),
        costPrice: toNumber(body.costPrice),
        stockMax: toInteger(body.stockMax),
        stockMin: toInteger(body.stockMin),
        minPurchase: toInteger(body.minPurchase),
        dailyCapacity: toInteger(body.dailyCapacity),
        remark: body.remark,
      },
    })
    return this.toProduct(record)
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string) {
    const counts = await Promise.all([
      this.prisma.moldDevelopment.count({ where: { product: { code: id } } }),
      this.prisma.moldMaster.count({ where: { itemCode: id } }),
      this.prisma.routingApplicableProduct.count({ where: { productCode: id } }),
      this.prisma.meltRecipeItem.count({ where: { itemCode: id } }),
    ])
    if (counts.some((count) => count > 0)) {
      throw new BadRequestException('当前物料已被业务数据引用，不能删除')
    }
    await this.prisma.product.delete({ where: { code: id } })
    return { id }
  }

  @Get('users')
  async users(@Req() request: RequestWithAdmin) {
    await this.ensureBasicSeed()
    const adminUser = getAdminContext(request)
    const userWhere = await this.userScopeWhere(request)
    const records = await this.prisma.user.findMany({
      where: adminUser.dataScopes?.includes('ALL') || adminUser.dataScope === 'ALL' ? { deletedAt: null } : { deletedAt: null, ...userWhere },
      orderBy: { createdAt: 'asc' },
      include: {
        department: true,
        roles: { include: { role: true } },
      },
    })
    return records.map((record) => this.toUser(record))
  }

  @Get('users/recycled')
  async recycledUsers() {
    const records = await this.prisma.user.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { updatedAt: 'desc' },
      include: {
        department: true,
        roles: { include: { role: true } },
      },
    })
    return records.map((record) => this.toUser(record))
  }

  @Post('users/sync')
  async syncUsers(@Body() body: SyncUsersBody, @Req() request: RequestWithAdmin) {
    const users = Array.isArray(body.users) ? body.users : []
    if (!users.length) throw new BadRequestException('没有可同步的用户数据')
    const source = providerValue(body.provider)

    for (const user of users) {
      if (!user.name?.trim() || !user.phone?.trim()) continue
      const department = await this.findDepartment(user)
      const existing = await this.prisma.user.findUnique({ where: { phone: user.phone.trim() } })
      const data = {
        name: user.name.trim(),
        userType: userTypeValue(user.userType) || 'EMPLOYEE',
        organizationName: user.organization || organizationName,
        departmentId: department?.id || null,
        ownerDepartmentId: department?.id || null,
        position: user.position,
        status: user.status === '禁用' ? 'DISABLED' : 'ENABLED',
        lockStatus: user.lockStatus === '锁定' ? 'LOCKED' : 'NORMAL',
        belongsTo: user.userType === '供应商' || user.userType === '客户' ? user.belongsTo || null : null,
        source,
        deletedAt: null,
      } as const

      if (existing) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data,
        })
        await this.applyUserRole(existing.id, user.role)
      } else {
        const created = await this.prisma.user.create({
          data: {
            ...data,
            phone: user.phone.trim(),
            passwordHash: user.password ? hashPassword(user.password) : null,
          },
        })
        await this.applyUserRole(created.id, user.role)
      }
    }

    return this.users(request)
  }

  @Post('users')
  async createUser(@Body() body: UserBody) {
    if (!body.name?.trim() || !body.phone?.trim()) {
      throw new BadRequestException('请输入姓名和手机号')
    }

    const department = await this.findDepartment(body)
    const user = await this.prisma.user.create({
      data: {
        name: body.name.trim(),
        phone: body.phone.trim(),
        passwordHash: body.password ? hashPassword(body.password) : null,
        userType: userTypeValue(body.userType) || 'EMPLOYEE',
        organizationName: body.organization || organizationName,
        departmentId: department?.id,
        ownerDepartmentId: department?.id,
        position: body.position,
        status: body.status === '禁用' ? 'DISABLED' : 'ENABLED',
        lockStatus: body.lockStatus === '锁定' ? 'LOCKED' : 'NORMAL',
        belongsTo: body.userType === '供应商' || body.userType === '客户' ? body.belongsTo || null : null,
        source: 'LOCAL',
      },
    })
    await this.applyUserRole(user.id, body.role)
    return this.toUser(
      await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { department: true, roles: { include: { role: true } } },
      }),
    )
  }

  @Put('users/:id')
  async updateUser(@Param('id') id: string, @Body() body: UserBody) {
    const department = await this.findDepartment(body)
    await this.prisma.user.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        phone: body.phone?.trim(),
        passwordHash: body.password ? hashPassword(body.password) : undefined,
        userType: userTypeValue(body.userType),
        organizationName: body.organization,
        departmentId: body.department || body.departmentId ? department?.id || null : undefined,
        ownerDepartmentId: body.department || body.departmentId ? department?.id || null : undefined,
        position: body.position,
        belongsTo:
          body.userType === '供应商' || body.userType === '客户'
            ? body.belongsTo || null
            : body.userType === '员工' || body.userType === '超管'
              ? null
              : undefined,
        status: body.status === '禁用' ? 'DISABLED' : body.status === '启用' ? 'ENABLED' : undefined,
        lockStatus: body.lockStatus === '锁定' ? 'LOCKED' : body.lockStatus === '正常' ? 'NORMAL' : undefined,
      },
    })
    if (body.role) await this.applyUserRole(id, body.role)

    return this.toUser(
      await this.prisma.user.findUniqueOrThrow({
        where: { id },
        include: { department: true, roles: { include: { role: true } } },
      }),
    )
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('用户不存在')
    if (user.userType === 'SUPER_ADMIN') {
      throw new BadRequestException('超管用户不允许删除，请先修改为其他用户类型')
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        status: 'DISABLED',
        deletedAt: new Date(),
      },
    })
    return { id }
  }

  @Get('roles')
  async roles() {
    await this.ensureBasicSeed()
    const records = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { users: true },
    })
    return records.map((record) => this.toRole(record))
  }

  @Post('roles')
  async createRole(@Body() body: RoleBody) {
    if (!body.name?.trim()) throw new BadRequestException('请输入角色名称')
    const role = await this.prisma.role.create({
      data: {
        name: body.name.trim(),
        organizationName: body.organization || organizationName,
        description: body.description,
        app: body.app || '管理端',
        dataScope: prismaScope(body.dataScope) || 'OWN',
        dataScopes: prismaScopes(body.dataScopes, body.dataScope),
        permissions: body.permissions || [],
        columnPermissions: body.columnPermissions || [],
        customDepartments: body.customDepartments || [],
      },
    })
    await this.applyRoleUsers(role.id, body.userIds || [])
    return this.toRole(
      await this.prisma.role.findUniqueOrThrow({ where: { id: role.id }, include: { users: true } }),
    )
  }

  @Put('roles/:id')
  async updateRole(@Param('id') id: string, @Body() body: RoleBody) {
    const role = await this.prisma.role.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        organizationName: body.organization,
        description: body.description,
        app: body.app,
        dataScope: prismaScope(body.dataScope),
        dataScopes: body.dataScopes ? prismaScopes(body.dataScopes, body.dataScope) : undefined,
        permissions: body.permissions,
        columnPermissions: body.columnPermissions,
        customDepartments: body.customDepartments,
      },
    })
    if (body.userIds) await this.applyRoleUsers(role.id, body.userIds)
    return this.toRole(
      await this.prisma.role.findUniqueOrThrow({ where: { id: role.id }, include: { users: true } }),
    )
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string) {
    await this.prisma.role.delete({ where: { id } })
    return { id }
  }



  private async getDictionaries() {
    const records = await this.prisma.dictionarySetting.findMany()
    const map = new Map(records.map((record) => [record.key, record.values]))
    return {
      moldTypes: stringArray(map.get('moldTypes')).length ? stringArray(map.get('moldTypes')) : defaultDictionaries.moldTypes,
      productUnits: stringArray(map.get('productUnits')).length ? stringArray(map.get('productUnits')) : defaultDictionaries.productUnits,
      productTypes: productTypeTree(records.find((record) => record.key === 'productTypes')?.values),
      positions: stringArray(map.get('positions')).length ? stringArray(map.get('positions')) : defaultDictionaries.positions,
      workshopTypes: stringArray(map.get('workshopTypes')).length ? stringArray(map.get('workshopTypes')) : defaultDictionaries.workshopTypes,
      operationSections: stringArray(map.get('operationSections')).length ? stringArray(map.get('operationSections')) : defaultDictionaries.operationSections,
      materialTypes: stringArray(map.get('materialTypes')).length ? stringArray(map.get('materialTypes')) : defaultDictionaries.materialTypes,
      equipmentTypes: stringArray(map.get('equipmentTypes')).length ? stringArray(map.get('equipmentTypes')) : defaultDictionaries.equipmentTypes,
      chemicalElements: dictionaryOptions(map.get('chemicalElements'), defaultDictionaries.chemicalElements),
      mechanicalProperties: dictionaryOptions(map.get('mechanicalProperties'), defaultDictionaries.mechanicalProperties),
      processRequirements: dictionaryOptions(map.get('processRequirements'), defaultDictionaries.processRequirements),
    }
  }

  private toPartner(record: {
    id: string
    code: string
    name: string
    address: string | null
    contact: string | null
    phone: string | null
    createdAt: Date
  }) {
    return {
      id: record.code,
      dbId: record.id,
      name: record.name,
      address: record.address || '',
      contact: record.contact || '',
      phone: record.phone || '',
      createdAt: formatDateTime(record.createdAt).slice(0, 10),
    }
  }

  private toProduct(record: Prisma.ProductGetPayload<object>) {
    return {
      id: record.code,
      dbId: record.id,
      name: record.name,
      code: record.code,
      spec: record.spec || '',
      unit: record.unit || '',
      type: record.type || '',
      source: (record.source || '自制件') as '自制件' | '外购件',
      workshop: record.workshop || '',
      purchaseUnit: record.purchaseUnit || '',
      salesUnit: record.salesUnit || '',
      inventoryUnit: record.inventoryUnit || '',
      unitConversions: Array.isArray(record.unitConversions) ? record.unitConversions : [],
      salePrice: Number(record.salePrice || 0),
      costPrice: Number(record.costPrice || 0),
      stockMax: record.stockMax || 0,
      stockMin: record.stockMin || 0,
      minPurchase: record.minPurchase || 0,
      dailyCapacity: record.dailyCapacity || 0,
      remark: record.remark || '',
      createdAt: formatDateTime(record.createdAt).slice(0, 10),
    }
  }

  private async createNextPartnerCode(prefix: 'CUS' | 'SUP', model: 'customer' | 'supplier') {
    const records =
      model === 'customer'
        ? await this.prisma.customer.findMany({ select: { code: true } })
        : await this.prisma.supplier.findMany({ select: { code: true } })
    const nextNumber =
      records.reduce((max, record) => {
        const numericPart = Number(record.code.replace(prefix, ''))
        return Number.isFinite(numericPart) ? Math.max(max, numericPart) : max
      }, 0) + 1
    return `${prefix}${String(nextNumber).padStart(3, '0')}`
  }

  private toDepartment(record: {
    id: string
    name: string
    code: string
    source: SyncProvider
    createdAt: Date
    children?: DepartmentTreeNode[]
  }): DepartmentDto {
    return {
      key: record.id,
      name: record.name,
      code: record.code,
      createdAt: formatDateTime(record.createdAt),
      source: sourceLabel(record.source),
      children: record.children?.map((item) => this.toDepartment(item)),
    }
  }

  private buildDepartmentTree(
    records: Array<{
      id: string
      name: string
      code: string
      parentId: string | null
      source: SyncProvider
      createdAt: Date
    }>,
  ) {
    const map = new Map<string, DepartmentTreeNode>()
    const roots: DepartmentTreeNode[] = []

    records.forEach((record) => {
      map.set(record.id, { ...record, children: [] })
    })
    records.forEach((record) => {
      const current = map.get(record.id)
      if (!current) return
      if (record.parentId && map.has(record.parentId)) {
        map.get(record.parentId)?.children.push(current)
      } else {
        roots.push(current)
      }
    })

    return roots.map((record) => this.toDepartment(record))
  }

  private toUser(
    record: Prisma.UserGetPayload<{
      include: { department: true; roles: { include: { role: true } } }
    }>,
  ) {
    const role = record.roles[0]?.role
    return {
      id: record.id,
      name: record.name,
      phone: record.phone,
      userType: userTypeLabel(record.userType),
      organization: record.organizationName || organizationName,
      department: record.department?.name || '',
      departmentId: record.departmentId || '',
      position: record.position || '',
      role: role?.name || '普通用户',
      status: record.status === 'ENABLED' ? '启用' : '禁用',
      lockStatus: record.lockStatus === 'NORMAL' ? '正常' : '锁定',
      source: sourceLabel(record.source),
      belongsTo: record.belongsTo || undefined,
      createdBy: '管理员',
      createdAt: formatDateTime(record.createdAt),
      updatedBy: '管理员',
      updatedAt: formatDateTime(record.updatedAt),
    }
  }

  private toRole(record: Prisma.RoleGetPayload<{ include: { users: true } }>) {
    return {
      id: record.id,
      name: record.name,
      organization: record.organizationName || organizationName,
      app: record.app,
      description: record.description || '',
      createdBy: record.name === '系统管理员' ? '系统' : '管理员',
      createdAt: formatDateTime(record.createdAt),
      permissions: stringArray(record.permissions),
      dataScope: frontendScope(record.dataScope),
      dataScopes: frontendScopes(record.dataScopes, record.dataScope),
      customDepartments: customDepartments(record.customDepartments),
      columnPermissions: stringArray(record.columnPermissions),
      userIds: record.users.map((userRole) => userRole.userId),
    }
  }

  private async findDepartment(body: UserBody) {
    if (body.departmentId) {
      return this.prisma.department.findUnique({ where: { id: body.departmentId } })
    }
    if (body.department) {
      return this.prisma.department.findFirst({ where: { name: body.department } })
    }
    return null
  }

  private async applyUserRole(userId: string, roleName?: string) {
    if (!roleName) return
    const role = await this.prisma.role.findFirst({ where: { name: roleName } })
    if (!role) return
    await this.prisma.userRole.deleteMany({ where: { userId } })
    await this.prisma.userRole.create({ data: { userId, roleId: role.id } })
  }

  private async applyRoleUsers(roleId: string, userIds: string[]) {
    await this.prisma.userRole.deleteMany({ where: { roleId } })
    if (!userIds.length) return
    await this.prisma.userRole.createMany({
      data: userIds.map((userId) => ({ roleId, userId })),
      skipDuplicates: true,
    })
  }

  private async visibleEntityIds(request: RequestWithAdmin, entityType: string) {
    return visibleOwnershipEntityIds(this.prisma, getAdminContext(request), entityType)
  }

  private async userScopeWhere(request: RequestWithAdmin): Promise<Prisma.UserWhereInput> {
    const user = getAdminContext(request)
    const scopes = user.dataScopes?.length ? user.dataScopes : [user.dataScope]
    if (scopes.includes('ALL')) return {}
    const orConditions: Prisma.UserWhereInput[] = []
    if (scopes.includes('OWN')) orConditions.push({ id: user.id })
    if (scopes.includes('OWN_DEPARTMENT') && user.departmentId) orConditions.push({ departmentId: user.departmentId })
    if (scopes.includes('OWN_AND_CHILD_DEPARTMENTS') && user.departmentId) {
      const departmentIds = await this.collectDepartmentIds(user.departmentId)
      orConditions.push({ departmentId: { in: departmentIds } })
    }
    if (scopes.includes('CUSTOM_DEPARTMENTS')) {
      const departmentIds = new Set<string>()
      for (const item of user.customDepartments) {
        ;(await this.collectDepartmentIds(item.departmentId, item.includeChildren)).forEach((id) => departmentIds.add(id))
      }
      if (departmentIds.size) orConditions.push({ departmentId: { in: Array.from(departmentIds) } })
    }
    return orConditions.length ? { OR: orConditions } : { id: '__none__' }
  }

  private async upsertDepartmentTree(department: DepartmentBody, parentId: string | null, source: SyncProvider) {
    if (!department.name?.trim() || !department.code?.trim()) return null
    const record = await this.prisma.department.upsert({
      where: { code: department.code.trim() },
      update: {
        name: department.name.trim(),
        parentId,
        source,
        externalId: department.code.trim(),
      },
      create: {
        name: department.name.trim(),
        code: department.code.trim(),
        parentId,
        source,
        externalId: department.code.trim(),
      },
    })

    const children = (department as DepartmentBody & { children?: DepartmentBody[] }).children || []
    for (const child of children) {
      await this.upsertDepartmentTree(child, record.id, source)
    }
    return record
  }

  private async collectDepartmentIds(id: string, includeChildren = true): Promise<string[]> {
    if (!includeChildren) return [id]
    const children = await this.prisma.department.findMany({
      where: { parentId: id },
      select: { id: true },
    })
    const childIds = (
      await Promise.all(children.map((child) => this.collectDepartmentIds(child.id)))
    ).flat()
    return [id, ...childIds]
  }

  private async ensureBasicSeed() {
    const adminRole = await this.prisma.role.upsert({
      where: { name_app: { name: '系统管理员', app: '管理端' } },
      update: {
        organizationName,
        dataScope: 'ALL',
        permissions: adminPermissions,
      },
      create: {
        name: '系统管理员',
        organizationName,
        app: '管理端',
        description: '系统内置管理员角色，拥有全部管理端权限。',
        dataScope: 'ALL',
        permissions: adminPermissions,
      },
    })
    const admin = await this.prisma.user.findFirst({
      where: { OR: [{ username: 'admin' }, { phone: '13665068911' }] },
    })
    if (admin) {
      await this.prisma.user.update({
        where: { id: admin.id },
        data: { userType: 'SUPER_ADMIN' },
      })
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
        update: {},
        create: { userId: admin.id, roleId: adminRole.id },
      })
    }
  }
}
