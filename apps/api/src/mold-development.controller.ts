import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  MoldDevelopmentStatus,
  MoldFlowKey,
  MoldProductionRecordType,
  Prisma,
} from '@prisma/client'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { PrismaService } from './prisma/prisma.service'

interface LoginBody {
  username?: string
  password?: string
}

interface ViewerOptions {
  viewer?: string
  authorization?: string
}

interface ShippingBody {
  trackingNumber?: string
  images?: string[]
  operator?: string
}

interface ReceiveBody {
  images?: string[]
  operator?: string
}

interface ProductionBody {
  operator?: string
  images?: string[]
}

interface EvaluationBody {
  result?: '通过' | '不通过'
  isComplete?: boolean
  reason?: string
}

interface CreateMoldBody {
  customerId?: string
  customerName?: string
  productCode: string
  productName?: string
  customerNotifyDate: string
  moldType: string
  supplierId?: string
  supplierName?: string
  followerName?: string
  expectedDate?: string
  attachments?: string[]
  remark?: string
}

interface CancelMoldBody {
  reason?: string
  operator?: string
}

type MoldWithRelations = Prisma.MoldDevelopmentGetPayload<{
  include: {
    customer: true
    product: true
    supplier: true
    flowRecords: { orderBy: { createdAt: 'asc' } }
    productionRecords: { orderBy: { createdAt: 'asc' } }
  }
}>

const imageFallbacks = [
  '/assets/mock/mold-drawing.svg',
  '/assets/mock/product-drawing.svg',
  '/assets/mock/effect-drawing.svg',
]

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function verifyPassword(password: string, passwordHash?: string | null) {
  if (!passwordHash) return false
  const [algorithm, salt, storedHash] = passwordHash.split(':')
  if (algorithm !== 'scrypt' || !salt || !storedHash) return false

  const currentHash = Buffer.from(scryptSync(password, salt, 64).toString('hex'), 'hex')
  const expectedHash = Buffer.from(storedHash, 'hex')
  return currentHash.length === expectedHash.length && timingSafeEqual(currentHash, expectedHash)
}

function frontendDataScope(scope: string) {
  const map: Record<string, 'organization' | 'self' | 'department' | 'department_tree' | 'custom_departments'> = {
    ALL: 'organization',
    OWN: 'self',
    OWN_DEPARTMENT: 'department',
    OWN_AND_CHILD_DEPARTMENTS: 'department_tree',
    CUSTOM_DEPARTMENTS: 'custom_departments',
  }
  return map[scope] || 'self'
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000+08:00`)
}

function formatDate(value?: Date | null) {
  if (!value) return ''
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(value?: Date | null) {
  if (!value) return undefined
  const date = formatDate(value)
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  return `${date} ${hour}:${minute}`
}

function arrayFromJson(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function mobileStatus(status: MoldDevelopmentStatus) {
  const map: Record<MoldDevelopmentStatus, '待确认' | '待发货' | '待收货' | '待试产' | '试产中' | '已完成' | '已中止'> = {
    WAITING_SUPPLIER_CONFIRM: '待确认',
    SUPPLIER_CONFIRMED: '待发货',
    MAKING: '待发货',
    FINISHED_WAITING_SHIPMENT: '待发货',
    SHIPPED: '待收货',
    RECEIVED: '待试产',
    TRIAL_PRODUCTION: '试产中',
    COMPLETED: '已完成',
    CANCELLED: '已中止',
  }
  return map[status]
}

function statusTone(status: ReturnType<typeof mobileStatus>) {
  if (status === '待确认' || status === '待发货' || status === '待收货' || status === '待试产') return 'pending'
  if (status === '已完成') return 'done'
  return 'active'
}

function flowTitle(key: MoldFlowKey) {
  const map: Record<MoldFlowKey, string> = {
    ISSUE: '开发下达',
    CONFIRM: '供应商确认',
    SHIPPING: '供应商发货',
    RECEIVE: '收货确认',
  }
  return map[key]
}

function flowKey(key: MoldFlowKey) {
  const map: Record<MoldFlowKey, 'issue' | 'confirm' | 'shipping' | 'receive'> = {
    ISSUE: 'issue',
    CONFIRM: 'confirm',
    SHIPPING: 'shipping',
    RECEIVE: 'receive',
  }
  return map[key]
}

function productionType(type: MoldProductionRecordType) {
  const map: Record<MoldProductionRecordType, 'trial' | 'batch' | 'evaluation'> = {
    TRIAL: 'trial',
    BATCH: 'batch',
    EVALUATION: 'evaluation',
  }
  return map[type]
}

function productionTitle(type: MoldProductionRecordType, count: number) {
  if (type === 'EVALUATION') return '模具评判记录'
  return `${type === 'TRIAL' ? '试模记录' : '量产记录'}（${count}次）`
}

function isSupplierEmployeeViewer({ viewer, authorization }: ViewerOptions = {}) {
  if (viewer === 'admin') return false
  const token = authorization?.replace(/^Bearer\s+/i, '') || ''
  return token.startsWith('mock-token-')
}

function toMobileMold(record: MoldWithRelations, options: ViewerOptions = {}) {
  const status = mobileStatus(record.status)
  const counts = { TRIAL: 0, BATCH: 0, EVALUATION: 0 }
  const shouldMaskSupplierFields = isSupplierEmployeeViewer(options)

  return {
    id: record.code,
    code: record.code,
    customerName: shouldMaskSupplierFields ? '' : record.customer.name,
    productCode: shouldMaskSupplierFields ? '' : record.product.code,
    productName: record.product.name,
    moldType: record.moldType,
    status,
    statusTone: statusTone(status),
    supplierName: record.supplier.name,
    followerName: record.followerName || '',
    notifiedDate: formatDate(record.customerNotifyDate),
    expectedDate: formatDate(record.expectedDate),
    issuedDate: formatDate(record.createdAt),
    remark: record.remark || '',
    images: arrayFromJson(record.attachments),
    flowRecords: record.flowRecords.map((flow) => ({
      key: flowKey(flow.key),
      title: flow.title || flowTitle(flow.key),
      done: flow.done,
      operator: flow.operator || undefined,
      time: formatDateTime(flow.operatedAt),
      trackingNumber: flow.trackingNumber || undefined,
      images: arrayFromJson(flow.images),
    })),
    productionRecords: record.productionRecords.map((production) => {
      counts[production.type] += 1
      return {
        id: production.id,
        type: productionType(production.type),
        title: production.title || productionTitle(production.type, counts[production.type]),
        operator: production.operator || undefined,
        time: formatDateTime(production.createdAt) || '',
        images: arrayFromJson(production.images),
        result: production.result || undefined,
        isComplete: production.isComplete ?? undefined,
        reason: production.reason || undefined,
      }
    }),
  }
}

function supplierTodoFromMold(record: MoldWithRelations) {
  const status = mobileStatus(record.status)
  if (status !== '待确认' && status !== '待发货') return null

  return {
    id: `todo-${record.code}`,
    title: status === '待确认' ? '模具图纸确认' : '模具发货确认',
    priority: '高',
    priorityTone: 'high',
    moduleName: '模具开发',
    stateText: '待处理',
    dueText: '今天',
    moldId: record.code,
  }
}

function requireSupplierEmployee(authorization?: string) {
  if (!isSupplierEmployeeViewer({ authorization })) {
    throw new ForbiddenException('仅供应商员工可以执行该操作')
  }
}

@Controller()
export class MoldDevelopmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('auth/login')
  async login(@Body() body: LoginBody) {
    const username = body.username?.trim()
    const password = body.password || ''

    if (!username || !password) {
      throw new BadRequestException('请输入账号和密码')
    }

    await this.ensureAdminAccount()
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username }, { phone: username }],
        deletedAt: null,
      },
      include: {
        roles: { include: { role: true } },
      },
    })

    if (user) {
      if (user.status !== 'ENABLED' || user.lockStatus !== 'NORMAL') {
        throw new ForbiddenException('账号已禁用或锁定')
      }
      if (!verifyPassword(password, user.passwordHash)) {
        throw new ForbiddenException('账号或密码错误')
      }

      const roles = user.roles.map((item) => item.role)
      const permissions = Array.from(
        new Set(
          roles.flatMap((role) =>
            Array.isArray(role.permissions)
              ? role.permissions.filter((permission): permission is string => typeof permission === 'string')
              : [],
          ),
        ),
      )
      const columnPermissions = Array.from(
        new Set(
          roles.flatMap((role) =>
            Array.isArray(role.columnPermissions)
              ? role.columnPermissions.filter((permission): permission is string => typeof permission === 'string')
              : [],
          ),
        ),
      )

      return {
        token: `db-token-${user.id}`,
        user: {
          id: user.id,
          name: user.name,
          userType: user.userType,
          username: user.username,
          isSupplierEmployee: user.userType === 'SUPPLIER',
          roles: roles.map((role) => ({
            id: role.id,
            name: role.name,
            dataScope: frontendDataScope(role.dataScope),
          })),
          permissions,
          dataScope: frontendDataScope(roles[0]?.dataScope || 'OWN'),
          columnPermissions,
        },
      }
    }

    if (username !== 'admin') {
      return {
        token: `mock-token-${username}`,
        user: {
          id: 'supplier-demo-user',
          name: username,
          userType: 'SUPPLIER_EMPLOYEE',
          isSupplierEmployee: true,
        },
      }
    }

    throw new ForbiddenException('账号或密码错误')
  }

  private async ensureAdminAccount() {
    const passwordHash = hashPassword('13665068911')
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: 'admin' }, { phone: '13665068911' }],
      },
      select: { id: true },
    })

    const adminRole = await this.prisma.role.upsert({
      where: { name_app: { name: '系统管理员', app: '管理端' } },
      update: {
        dataScope: 'ALL',
        permissions: [
          'admin',
          'basic',
          'basic.department',
          'basic.user',
          'basic.role',
          'basic.customer',
          'basic.supplier',
          'basic.product',
          'basic.dictionary',
          'mold',
          'mold.development.view',
          'mold.development.create',
          'mold.development.edit',
          'mold.development.delete',
        ],
      },
      create: {
        name: '系统管理员',
        app: '管理端',
        description: '系统内置管理员角色，拥有全部管理端权限。',
        dataScope: 'ALL',
        permissions: [
          'admin',
          'basic',
          'basic.department',
          'basic.user',
          'basic.role',
          'basic.customer',
          'basic.supplier',
          'basic.product',
          'basic.dictionary',
          'mold',
          'mold.development.view',
          'mold.development.create',
          'mold.development.edit',
          'mold.development.delete',
        ],
      },
    })

    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          username: 'admin',
          name: '系统管理员',
          phone: '13665068911',
          passwordHash,
          userType: 'EMPLOYEE',
          status: 'ENABLED',
          lockStatus: 'NORMAL',
          source: 'LOCAL',
          deletedAt: null,
        },
      })
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: existing.id, roleId: adminRole.id } },
        update: {},
        create: { userId: existing.id, roleId: adminRole.id },
      })
      return
    }

    const admin = await this.prisma.user.create({
      data: {
        username: 'admin',
        name: '系统管理员',
        phone: '13665068911',
        passwordHash,
        userType: 'EMPLOYEE',
        status: 'ENABLED',
        lockStatus: 'NORMAL',
        source: 'LOCAL',
        deletedAt: null,
      },
    })
    await this.prisma.userRole.create({
      data: { userId: admin.id, roleId: adminRole.id },
    })
  }

  @Get('mobile/home')
  async home() {
    await this.ensureSeedData()
    const records = await this.findMolds()
    const todos = records
      .map(supplierTodoFromMold)
      .filter((todo): todo is NonNullable<typeof todo> => Boolean(todo))

    return {
      todos: todos.slice(0, 10),
      todoCount: todos.length,
      moldCount: records.length,
    }
  }

  @Get('mobile/todos')
  async todoList() {
    await this.ensureSeedData()
    return (await this.findMolds())
      .map(supplierTodoFromMold)
      .filter((todo): todo is NonNullable<typeof todo> => Boolean(todo))
  }

  @Get('mobile/molds')
  async moldList(
    @Query('keyword') keyword?: string,
    @Query('viewer') viewer?: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.ensureSeedData()
    const records = await this.findMolds()
    const normalized = keyword?.trim()
    const mapped = records.map((record) => toMobileMold(record, { viewer, authorization }))

    if (!normalized) return mapped
    return mapped.filter((item) =>
      [
        item.code,
        item.customerName,
        item.productCode,
        item.productName,
        item.supplierName,
        item.status,
      ].some((value) => value.includes(normalized)),
    )
  }

  @Get('mobile/molds/:id')
  async moldDetail(
    @Param('id') id: string,
    @Query('viewer') viewer?: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.ensureSeedData()
    return toMobileMold(await this.findMold(id), { viewer, authorization })
  }

  @Post('admin/molds')
  async createMold(@Body() body: CreateMoldBody) {
    await this.ensureSeedData()
    const customer = await this.upsertCustomer(body.customerId || 'CUS_CUSTOM', body.customerName || body.customerId || '')
    const product = await this.upsertProduct(body.productCode, body.productName || body.productCode)
    const supplier = await this.upsertSupplier(body.supplierId || 'SUP_CUSTOM', body.supplierName || body.supplierId || '')
    const code = await this.createNextMoldCode()
    const images = body.attachments?.length
      ? body.attachments.map((_item, index) => imageFallbacks[index % imageFallbacks.length])
      : []
    const now = new Date()

    const mold = await this.prisma.moldDevelopment.create({
      data: {
        code,
        customerId: customer.id,
        productId: product.id,
        supplierId: supplier.id,
        customerNotifyDate: toDate(body.customerNotifyDate),
        moldType: body.moldType,
        followerName: body.followerName,
        expectedDate: body.expectedDate ? toDate(body.expectedDate) : undefined,
        status: 'WAITING_SUPPLIER_CONFIRM',
        attachments: images,
        remark: body.remark,
        flowRecords: {
          create: [
            {
              key: 'ISSUE',
              title: '开发下达',
              done: true,
              operator: '管理员',
              operatedAt: now,
              images,
            },
            { key: 'CONFIRM', title: '供应商确认', done: false },
            { key: 'SHIPPING', title: '供应商发货', done: false },
            { key: 'RECEIVE', title: '收货确认', done: false },
          ],
        },
      },
      include: this.moldInclude(),
    })

    return toMobileMold(mold, { viewer: 'admin' })
  }

  @Delete('admin/molds/:id')
  async deleteMold(@Param('id') id: string) {
    const mold = await this.findMold(id)
    if (mold.status !== 'CANCELLED') {
      throw new BadRequestException('仅已中止的模具开发单可以删除')
    }

    await this.prisma.moldDevelopment.delete({
      where: { id: mold.id },
    })

    return { id: mold.code }
  }

  @Post('admin/molds/:id/cancel')
  async cancelMold(@Param('id') id: string, @Body() body: CancelMoldBody) {
    const mold = await this.findMold(id)
    if (mold.status === 'COMPLETED') {
      throw new BadRequestException('已完成的模具开发单不能中止')
    }

    await this.prisma.moldDevelopment.update({
      where: { id: mold.id },
      data: {
        status: 'CANCELLED',
        remark: body.reason ? `${mold.remark || ''}\n中止理由：${body.reason}`.trim() : mold.remark,
      },
    })

    return toMobileMold(await this.findMold(id), { viewer: 'admin' })
  }

  @Post('mobile/molds/:id/confirm-drawing')
  async confirmDrawing(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    requireSupplierEmployee(authorization)
    const mold = await this.findMold(id)
    await this.prisma.$transaction([
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'SUPPLIER_CONFIRMED' },
      }),
      this.prisma.moldDevelopmentFlowRecord.update({
        where: { moldDevelopmentId_key: { moldDevelopmentId: mold.id, key: 'CONFIRM' } },
        data: { done: true, operator: '当前用户', operatedAt: new Date() },
      }),
    ])
    return toMobileMold(await this.findMold(id), { authorization })
  }

  @Post('mobile/molds/:id/shipping')
  async shipping(
    @Param('id') id: string,
    @Body() body: ShippingBody,
    @Headers('authorization') authorization?: string,
  ) {
    requireSupplierEmployee(authorization)
    const mold = await this.findMold(id)
    await this.prisma.$transaction([
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'SHIPPED', trackingNumber: body.trackingNumber, shippedAt: new Date() },
      }),
      this.prisma.moldDevelopmentFlowRecord.update({
        where: { moldDevelopmentId_key: { moldDevelopmentId: mold.id, key: 'SHIPPING' } },
        data: {
          done: true,
          operator: body.operator || '当前用户',
          operatedAt: new Date(),
          trackingNumber: body.trackingNumber,
          images: body.images || [],
        },
      }),
    ])
    return toMobileMold(await this.findMold(id), { authorization })
  }

  @Post('mobile/molds/:id/receive')
  async receive(@Param('id') id: string, @Body() body: ReceiveBody) {
    const mold = await this.findMold(id)
    await this.prisma.$transaction([
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'RECEIVED' },
      }),
      this.prisma.moldDevelopmentFlowRecord.update({
        where: { moldDevelopmentId_key: { moldDevelopmentId: mold.id, key: 'RECEIVE' } },
        data: {
          done: true,
          operator: body.operator || '当前用户',
          operatedAt: new Date(),
          images: body.images || [],
        },
      }),
    ])
    return toMobileMold(await this.findMold(id))
  }

  @Post('mobile/molds/:id/trial')
  async trial(@Param('id') id: string, @Body() body: ProductionBody) {
    const mold = await this.findMold(id)
    const count = await this.prisma.moldProductionRecord.count({
      where: { moldDevelopmentId: mold.id, type: 'TRIAL' },
    })
    await this.prisma.$transaction([
      this.prisma.moldProductionRecord.create({
        data: {
          moldDevelopmentId: mold.id,
          type: 'TRIAL',
          title: productionTitle('TRIAL', count + 1),
          operator: body.operator || '当前用户',
          images: body.images || [],
        },
      }),
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'TRIAL_PRODUCTION' },
      }),
    ])
    return toMobileMold(await this.findMold(id))
  }

  @Post('mobile/molds/:id/batch')
  async batch(@Param('id') id: string, @Body() body: ProductionBody) {
    const mold = await this.findMold(id)
    const count = await this.prisma.moldProductionRecord.count({
      where: { moldDevelopmentId: mold.id, type: 'BATCH' },
    })
    await this.prisma.$transaction([
      this.prisma.moldProductionRecord.create({
        data: {
          moldDevelopmentId: mold.id,
          type: 'BATCH',
          title: productionTitle('BATCH', count + 1),
          operator: body.operator || '当前用户',
          images: body.images || [],
        },
      }),
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'TRIAL_PRODUCTION' },
      }),
    ])
    return toMobileMold(await this.findMold(id))
  }

  @Post('mobile/molds/:id/evaluation')
  async evaluation(@Param('id') id: string, @Body() body: EvaluationBody) {
    const mold = await this.findMold(id)
    await this.prisma.$transaction([
      this.prisma.moldProductionRecord.create({
        data: {
          moldDevelopmentId: mold.id,
          type: 'EVALUATION',
          title: '模具评判记录',
          result: body.result || '通过',
          isComplete: body.isComplete ?? true,
          reason: body.reason,
        },
      }),
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: body.isComplete ?? true ? 'COMPLETED' : 'TRIAL_PRODUCTION' },
      }),
    ])
    return toMobileMold(await this.findMold(id))
  }

  private moldInclude() {
    return {
      customer: true,
      product: true,
      supplier: true,
      flowRecords: { orderBy: { createdAt: 'asc' as const } },
      productionRecords: { orderBy: { createdAt: 'asc' as const } },
    }
  }

  private findMolds() {
    return this.prisma.moldDevelopment.findMany({
      orderBy: { createdAt: 'desc' },
      include: this.moldInclude(),
    })
  }

  private async findMold(id: string) {
    const record = await this.prisma.moldDevelopment.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: this.moldInclude(),
    })
    if (!record) {
      throw new NotFoundException('模具开发任务不存在')
    }
    return record
  }

  private async createNextMoldCode() {
    const records = await this.prisma.moldDevelopment.findMany({
      select: { code: true },
    })
    const nextNumber =
      records.reduce((max, record) => {
        const numericPart = Number(record.code.replace('MD', ''))
        return Number.isFinite(numericPart) ? Math.max(max, numericPart) : max
      }, 0) + 1
    return `MD${String(nextNumber).padStart(3, '0')}`
  }

  private upsertCustomer(code: string, name: string) {
    return this.prisma.customer.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    })
  }

  private upsertProduct(code: string, name: string) {
    return this.prisma.product.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    })
  }

  private upsertSupplier(code: string, name: string) {
    return this.prisma.supplier.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    })
  }

  private async ensureSeedData() {
    const count = await this.prisma.moldDevelopment.count()
    if (count > 0) return

    const customer1 = await this.upsertCustomer('CUS001', '长城汽车股份有限公司')
    const customer2 = await this.upsertCustomer('CUS002', '比亚迪汽车工业有限公司')
    const product1 = await this.upsertProduct('P001', '英沃保险柜门板内板')
    const product2 = await this.upsertProduct('P002', '球墨铸铁泵体')
    const supplier1 = await this.upsertSupplier('SUP001', '鑫源材料有限公司')
    const supplier2 = await this.upsertSupplier('SUP002', '华泰金属制品厂')

    await this.createSeedMold({
      code: 'MD001',
      customerId: customer1.id,
      productId: product1.id,
      supplierId: supplier1.id,
      customerNotifyDate: '2026-04-17',
      moldType: '压铸模',
      followerName: '王五',
      expectedDate: '2026-05-31',
      status: 'SHIPPED',
      trackingNumber: 'SF1234567890',
      attachments: imageFallbacks,
      remark: '急件，优先处理',
      issueAt: new Date('2026-04-15T14:30:00+08:00'),
      confirmAt: new Date('2026-04-16T09:20:00+08:00'),
      shippingAt: new Date('2026-04-20T15:10:00+08:00'),
    })
    await this.createSeedMold({
      code: 'MD002',
      customerId: customer2.id,
      productId: product2.id,
      supplierId: supplier2.id,
      customerNotifyDate: '2026-05-18',
      moldType: '砂型模',
      followerName: '赵六',
      expectedDate: '2026-06-20',
      status: 'WAITING_SUPPLIER_CONFIRM',
      attachments: [imageFallbacks[0], imageFallbacks[1]],
      remark: '按图纸要求开发',
      issueAt: new Date('2026-05-18T10:00:00+08:00'),
    })
  }

  private async createSeedMold(data: {
    code: string
    customerId: string
    productId: string
    supplierId: string
    customerNotifyDate: string
    moldType: string
    followerName: string
    expectedDate: string
    status: MoldDevelopmentStatus
    trackingNumber?: string
    attachments: string[]
    remark: string
    issueAt: Date
    confirmAt?: Date
    shippingAt?: Date
  }) {
    await this.prisma.moldDevelopment.create({
      data: {
        code: data.code,
        customerId: data.customerId,
        productId: data.productId,
        supplierId: data.supplierId,
        customerNotifyDate: toDate(data.customerNotifyDate),
        moldType: data.moldType,
        followerName: data.followerName,
        expectedDate: toDate(data.expectedDate),
        status: data.status,
        trackingNumber: data.trackingNumber,
        shippedAt: data.shippingAt,
        attachments: data.attachments,
        remark: data.remark,
        createdAt: data.issueAt,
        flowRecords: {
          create: [
            {
              key: 'ISSUE',
              title: '开发下达',
              done: true,
              operator: '张三',
              operatedAt: data.issueAt,
              images: data.attachments.slice(0, 2),
            },
            {
              key: 'CONFIRM',
              title: '供应商确认',
              done: Boolean(data.confirmAt),
              operator: data.confirmAt ? '李四' : undefined,
              operatedAt: data.confirmAt,
            },
            {
              key: 'SHIPPING',
              title: '供应商发货',
              done: Boolean(data.shippingAt),
              operator: data.shippingAt ? '李四' : undefined,
              operatedAt: data.shippingAt,
              trackingNumber: data.trackingNumber,
              images: data.shippingAt ? ['/assets/mock/express.svg'] : [],
            },
            { key: 'RECEIVE', title: '收货确认', done: false },
          ],
        },
      },
    })
  }
}
