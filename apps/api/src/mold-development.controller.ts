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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  MoldDevelopmentStatus,
  MoldFlowKey,
  MoldProductionRecordType,
  Prisma,
} from '@prisma/client'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { PrismaService } from './prisma/prisma.service'
import {
  getAdminContext,
  hasAdminPermission,
  upsertOwnership,
  visibleOwnershipEntityIds,
  type RequestWithAdmin,
} from './shared/admin-context'
import { AdminAuthGuard } from './shared/admin-auth.guard'
import { ADMIN_DEFAULT_PERMISSIONS } from './shared/admin-default-permissions'
import { extractBearerToken, signAdminToken, verifyAdminToken } from './shared/auth-token'

interface LoginBody {
  username?: string
  password?: string
}

interface ViewerOptions {
  viewer?: string
  authorization?: string
  user?: MobileViewerUser | null
}

interface MobileViewerUser {
  id: string
  name: string
  userType: string
  belongsTo: string | null
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
  productImages?: string[]
  destructiveImages?: string[]
}

interface EvaluationBody {
  operator?: string
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
  moldName?: string
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

function frontendDataScopes(value: unknown, fallback: string) {
  const scopes = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return (scopes.length ? scopes : [fallback]).map(frontendDataScope)
}

function authUserPayload(user: Prisma.UserGetPayload<{ include: { roles: { include: { role: true } } } }>) {
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
    id: user.id,
    name: user.name,
    phone: user.phone,
    userType: user.userType,
    username: user.username,
    isSupplierEmployee: user.userType === 'SUPPLIER',
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      dataScope: frontendDataScope(role.dataScope),
      dataScopes: frontendDataScopes(role.dataScopes, role.dataScope),
    })),
    permissions,
    dataScope: frontendDataScope(roles[0]?.dataScope || 'OWN'),
    dataScopes: Array.from(new Set(roles.flatMap((role) => frontendDataScopes(role.dataScopes, role.dataScope)))),
    columnPermissions,
  }
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

function objectFromJson(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function productionImagesFromJson(value: Prisma.JsonValue | null | undefined) {
  const objectValue = objectFromJson(value)
  if (!objectValue) {
    const images = arrayFromJson(value)
    return { images, productImages: images, destructiveImages: [] }
  }

  const imagePayload = objectValue as Record<string, Prisma.JsonValue>
  const productImages = arrayFromJson(imagePayload.productImages)
  const destructiveImages = arrayFromJson(imagePayload.destructiveImages)
  const images = arrayFromJson(imagePayload.images)
  return {
    images: images.length ? images : [...productImages, ...destructiveImages],
    productImages,
    destructiveImages,
  }
}

function parseTerminationRecord(remark?: string | null) {
  if (!remark?.includes('中止理由：')) return null

  const reason = remark.split('中止理由：').pop()?.trim() || ''
  const operator = remark.match(/中止人：(.+)/)?.[1]?.split('\n')[0]?.trim()
  const time = remark.match(/中止时间：(.+)/)?.[1]?.split('\n')[0]?.trim()
  return {
    operator: operator || undefined,
    time: time || undefined,
    reason,
  }
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
  if (verifyAdminToken(extractBearerToken(authorization))) return false
  const token = extractBearerToken(authorization)
  return token.startsWith('mock-token-')
}

function isSupplierUser(user?: MobileViewerUser | null): user is MobileViewerUser & { userType: 'SUPPLIER' } {
  return user?.userType === 'SUPPLIER'
}

function toMobileMold(record: MoldWithRelations, options: ViewerOptions = {}) {
  const status = mobileStatus(record.status)
  const counts = { TRIAL: 0, BATCH: 0, EVALUATION: 0 }
  const shouldMaskSupplierFields = isSupplierEmployeeViewer(options) || isSupplierUser(options.user)
  const isFollower = Boolean(options.user && record.followerName && options.user.name === record.followerName)
  const canSupplierOperate =
    isSupplierUser(options.user) &&
    Boolean(options.user.belongsTo) &&
    (record.supplier.code === options.user.belongsTo || record.supplier.name === options.user.belongsTo)

  return {
    id: record.code,
    code: record.code,
    customerId: record.customer.code,
    customerName: shouldMaskSupplierFields ? '' : record.customer.name,
    productCode: shouldMaskSupplierFields ? '' : record.product.code,
    productName: record.product.name,
    moldName: record.moldName || '',
    moldType: record.moldType,
    archivedMoldCode: record.archivedMoldCode || '',
    isArchived: Boolean(record.archivedMoldCode),
    status,
    statusTone: statusTone(status),
    supplierId: record.supplier.code,
    supplierName: record.supplier.name,
    followerName: record.followerName || '',
    notifiedDate: formatDate(record.customerNotifyDate),
    expectedDate: formatDate(record.expectedDate),
    issuedDate: formatDate(record.createdAt),
    trackingNumber: record.trackingNumber || '',
    remark: record.remark || '',
    images: arrayFromJson(record.attachments),
    permissions: {
      canConfirmDrawing: canSupplierOperate && status === '待确认',
      canShip: canSupplierOperate && status === '待发货',
      canReceive: isFollower && status === '待收货',
      canTrial: isFollower && (status === '待试产' || status === '试产中'),
      canBatch: isFollower && (status === '待试产' || status === '试产中'),
      canEvaluate: isFollower && (status === '待试产' || status === '试产中'),
    },
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
      const productionImages = productionImagesFromJson(production.images)
      return {
        id: production.id,
        type: productionType(production.type),
        title: production.title || productionTitle(production.type, counts[production.type]),
        operator: production.operator || undefined,
        time: formatDateTime(production.createdAt) || '',
        images: productionImages.images,
        productImages: productionImages.productImages,
        destructiveImages: productionImages.destructiveImages,
        result: production.result || undefined,
        isComplete: production.isComplete ?? undefined,
        reason: production.reason || undefined,
      }
    }),
    terminationRecord: parseTerminationRecord(record.remark),
  }
}

function todoFromMold(record: MoldWithRelations, user?: MobileViewerUser | null) {
  const status = mobileStatus(record.status)
  let title = ''

  if (isSupplierUser(user)) {
    const matchedSupplier = Boolean(
      user.belongsTo && (record.supplier.code === user.belongsTo || record.supplier.name === user.belongsTo),
    )
    if (matchedSupplier && status === '待确认') title = '模具图纸确认'
    if (matchedSupplier && status === '待发货') title = '模具发货确认'
  }

  const followerName = user?.userType !== 'SUPPLIER' ? user?.name : undefined
  if (followerName && record.followerName === followerName && status === '待收货') {
    title = '模具收货确认'
  }

  if (!title) return null

  return {
    id: `todo-${record.code}`,
    title,
    priority: '高',
    priorityTone: 'high',
    moduleName: '模具开发',
    stateText: '待处理',
    dueText: '今天',
    moldId: record.code,
  }
}

function requireSupplierEmployee(authorization?: string) {
  if (!verifyAdminToken(extractBearerToken(authorization)) && !isSupplierEmployeeViewer({ authorization })) {
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

      return {
        token: signAdminToken(user.id),
        user: authUserPayload(user),
      }
    }

    throw new ForbiddenException('账号或密码错误')
  }

  private async ensureAdminAccount() {
    const passwordHash = hashPassword('13665068911')
    const adminByPhone = await this.prisma.user.findUnique({
      where: { phone: '13665068911' },
      select: { id: true },
    })
    const adminByUsername = await this.prisma.user.findUnique({
      where: { username: 'admin' },
      select: { id: true },
    })

    const adminRole = await this.prisma.role.upsert({
      where: { name_app: { name: '系统管理员', app: '管理端' } },
      update: {
        organizationName: '摩尔元数（福建）科技有限公司',
        dataScope: 'ALL',
        permissions: ADMIN_DEFAULT_PERMISSIONS,
      },
      create: {
        name: '系统管理员',
        organizationName: '摩尔元数（福建）科技有限公司',
        app: '管理端',
        description: '系统内置管理员角色，拥有全部管理端权限。',
        dataScope: 'ALL',
        permissions: ADMIN_DEFAULT_PERMISSIONS,
      },
    })

    const existing = adminByPhone || adminByUsername
    if (existing) {
      if (adminByPhone && adminByUsername && adminByPhone.id !== adminByUsername.id) {
        await this.prisma.user.update({
          where: { id: adminByUsername.id },
          data: { username: null },
        })
      }
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          username: 'admin',
          phone: '13665068911',
          passwordHash,
          userType: 'SUPER_ADMIN',
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
        userType: 'SUPER_ADMIN',
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
  @UseGuards(AdminAuthGuard)
  async home(@Req() request: RequestWithAdmin, @Headers('authorization') authorization?: string) {
    const viewerUser = await this.getViewerUser(authorization)
    const canViewMolds = hasAdminPermission(getAdminContext(request), 'mini.mold.development.view')
    const records = canViewMolds ? await this.findMoldsForViewer(viewerUser, request) : []
    const todos = records
      .map((record) => todoFromMold(record, viewerUser))
      .filter((todo): todo is NonNullable<typeof todo> => Boolean(todo))

    return {
      todos: todos.slice(0, 10),
      todoCount: todos.length,
      moldCount: records.length,
    }
  }

  @Get('auth/me')
  @UseGuards(AdminAuthGuard)
  async me(@Headers('authorization') authorization?: string) {
    const verifiedToken = verifyAdminToken(extractBearerToken(authorization))
    if (!verifiedToken) throw new NotFoundException('登录状态已失效')
    const user = await this.prisma.user.findUnique({
      where: { id: verifiedToken.userId },
      include: { roles: { include: { role: true } } },
    })
    if (!user) throw new NotFoundException('登录状态已失效')
    return authUserPayload(user)
  }

  @Get('mobile/todos')
  @UseGuards(AdminAuthGuard)
  async todoList(@Req() request: RequestWithAdmin, @Headers('authorization') authorization?: string) {
    this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.getViewerUser(authorization)
    return (await this.findMoldsForViewer(viewerUser, request))
      .map((record) => todoFromMold(record, viewerUser))
      .filter((todo): todo is NonNullable<typeof todo> => Boolean(todo))
  }

  @Get('mobile/molds')
  @UseGuards(AdminAuthGuard)
  async moldList(
    @Req() request: RequestWithAdmin,
    @Query('keyword') keyword?: string,
    @Query('viewer') viewer?: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (viewer === 'admin') this.requireMoldPermission(request, 'mold.development.view')
    else this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.getViewerUser(authorization)
    const records = await this.findMoldsForViewer(viewerUser, request)
    const normalized = keyword?.trim()
    const archiveMap = await this.findArchiveMap(records.map((record) => record.code))
    const mapped = records.map((record) => {
      const item = toMobileMold(record, { viewer, authorization, user: viewerUser })
      const archivedMoldCode = item.archivedMoldCode || archiveMap.get(record.code) || ''
      return { ...item, archivedMoldCode, isArchived: Boolean(archivedMoldCode) }
    })

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
  @UseGuards(AdminAuthGuard)
  async moldDetail(
    @Req() request: RequestWithAdmin,
    @Param('id') id: string,
    @Query('viewer') viewer?: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (viewer === 'admin') this.requireMoldPermission(request, 'mold.development.view')
    else this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.getViewerUser(authorization)
    const mold = await this.findMoldForViewer(id, viewerUser, request)
    const archiveMap = await this.findArchiveMap([mold.code])
    const item = toMobileMold(mold, { viewer, authorization, user: viewerUser })
    const archivedMoldCode = item.archivedMoldCode || archiveMap.get(mold.code) || ''
    return { ...item, archivedMoldCode, isArchived: Boolean(archivedMoldCode) }
  }

  @Post('admin/molds')
  @UseGuards(AdminAuthGuard)
  async createMold(@Body() body: CreateMoldBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.create')
    const customer = await this.upsertCustomer(body.customerId || 'CUS_CUSTOM', body.customerName || body.customerId || '')
    const product = await this.upsertProduct(body.productCode, body.productName || body.productCode)
    const supplier = await this.upsertSupplier(body.supplierId || 'SUP_CUSTOM', body.supplierName || body.supplierId || '')
    const code = await this.createNextMoldCode()
    const images = body.attachments || []
    const now = new Date()

    const mold = await this.prisma.moldDevelopment.create({
      data: {
        code,
        customerId: customer.id,
        productId: product.id,
        supplierId: supplier.id,
        customerNotifyDate: toDate(body.customerNotifyDate),
        moldName: body.moldName,
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
    await upsertOwnership(this.prisma, request.adminUser, 'mold:development', mold.code)

    return toMobileMold(mold, { viewer: 'admin' })
  }

  @Delete('admin/molds/:id')
  @UseGuards(AdminAuthGuard)
  async deleteMold(@Param('id') id: string, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.delete')
    await this.assertMoldVisible(id, request)
    const mold = await this.findMold(id)
    if (mold.status !== 'CANCELLED') {
      throw new BadRequestException('仅已中止的模具开发单可以删除')
    }

    await this.prisma.moldDevelopment.delete({
      where: { id: mold.id },
    })

    return { id: mold.code }
  }

  @Put('admin/molds/:id')
  @UseGuards(AdminAuthGuard)
  async updateMold(@Param('id') id: string, @Body() body: CreateMoldBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    const mold = await this.findMold(id)
    const customer = await this.upsertCustomer(body.customerId || 'CUS_CUSTOM', body.customerName || body.customerId || '')
    const product = await this.upsertProduct(body.productCode, body.productName || body.productCode)
    const supplier = await this.upsertSupplier(body.supplierId || 'SUP_CUSTOM', body.supplierName || body.supplierId || '')
    const images = body.attachments || arrayFromJson(mold.attachments)

    await this.prisma.moldDevelopment.update({
      where: { id: mold.id },
      data: {
        customerId: customer.id,
        productId: product.id,
        supplierId: supplier.id,
        customerNotifyDate: toDate(body.customerNotifyDate),
        moldName: body.moldName,
        moldType: body.moldType,
        followerName: body.followerName,
        expectedDate: body.expectedDate ? toDate(body.expectedDate) : null,
        attachments: images,
        remark: body.remark,
      },
    })

    await this.prisma.moldDevelopmentFlowRecord.updateMany({
      where: { moldDevelopmentId: mold.id, key: 'ISSUE' },
      data: { images },
    })

    return toMobileMold(await this.findMold(id), { viewer: 'admin' })
  }

  @Post('admin/molds/:id/cancel')
  @UseGuards(AdminAuthGuard)
  async cancelMold(@Param('id') id: string, @Body() body: CancelMoldBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    const mold = await this.findMold(id)
    if (mold.status === 'COMPLETED') {
      throw new BadRequestException('已完成的模具开发单不能中止')
    }

    await this.prisma.moldDevelopment.update({
      where: { id: mold.id },
      data: {
        status: 'CANCELLED',
        remark: body.reason
          ? `${mold.remark || ''}\n中止人：${body.operator || '当前用户'}\n中止时间：${formatDateTime(new Date())}\n中止理由：${body.reason}`.trim()
          : mold.remark,
      },
    })

    return toMobileMold(await this.findMold(id), { viewer: 'admin' })
  }

  @Post('admin/molds/:id/confirm-drawing')
  @UseGuards(AdminAuthGuard)
  async adminConfirmDrawing(@Param('id') id: string, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    return this.confirmDrawingRecord(id, '管理员', { viewer: 'admin' })
  }

  @Post('admin/molds/:id/shipping')
  @UseGuards(AdminAuthGuard)
  async adminShipping(@Param('id') id: string, @Body() body: ShippingBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    return this.shippingRecord(id, body, { viewer: 'admin' })
  }

  @Post('admin/molds/:id/receive')
  @UseGuards(AdminAuthGuard)
  async adminReceive(@Param('id') id: string, @Body() body: ReceiveBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    return this.receiveRecord(id, body, { viewer: 'admin' })
  }

  @Post('admin/molds/:id/trial')
  @UseGuards(AdminAuthGuard)
  async adminTrial(@Param('id') id: string, @Body() body: ProductionBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    return this.productionRecord(id, 'TRIAL', body, { viewer: 'admin' })
  }

  @Post('admin/molds/:id/batch')
  @UseGuards(AdminAuthGuard)
  async adminBatch(@Param('id') id: string, @Body() body: ProductionBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    return this.productionRecord(id, 'BATCH', body, { viewer: 'admin' })
  }

  @Post('admin/molds/:id/evaluation')
  @UseGuards(AdminAuthGuard)
  async adminEvaluation(@Param('id') id: string, @Body() body: EvaluationBody, @Req() request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mold.development.edit')
    await this.assertMoldVisible(id, request)
    return this.evaluationRecord(id, body, { viewer: 'admin' })
  }

  @Post('mobile/molds/:id/confirm-drawing')
  @UseGuards(AdminAuthGuard)
  async confirmDrawing(@Param('id') id: string, @Req() request: RequestWithAdmin, @Headers('authorization') authorization?: string) {
    this.requireMobileMoldViewPermission(request)
    requireSupplierEmployee(authorization)
    const viewerUser = await this.requireSupplierViewer(authorization)
    return this.confirmDrawingRecord(id, viewerUser.name || '当前用户', { authorization, user: viewerUser })
  }

  @Post('mobile/molds/:id/shipping')
  @UseGuards(AdminAuthGuard)
  async shipping(
    @Param('id') id: string,
    @Body() body: ShippingBody,
    @Req() request: RequestWithAdmin,
    @Headers('authorization') authorization?: string,
  ) {
    this.requireMobileMoldViewPermission(request)
    requireSupplierEmployee(authorization)
    const viewerUser = await this.requireSupplierViewer(authorization)
    return this.shippingRecord(id, body, { authorization, user: viewerUser })
  }

  @Post('mobile/molds/:id/receive')
  @UseGuards(AdminAuthGuard)
  async receive(
    @Param('id') id: string,
    @Body() body: ReceiveBody,
    @Req() request: RequestWithAdmin,
    @Headers('authorization') authorization?: string,
  ) {
    this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.requireFollowerViewer(id, authorization)
    return this.receiveRecord(id, { ...body, operator: body.operator || viewerUser.name }, { authorization, user: viewerUser })
  }

  @Post('mobile/molds/:id/trial')
  @UseGuards(AdminAuthGuard)
  async trial(
    @Param('id') id: string,
    @Body() body: ProductionBody,
    @Req() request: RequestWithAdmin,
    @Headers('authorization') authorization?: string,
  ) {
    this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.requireFollowerViewer(id, authorization)
    return this.productionRecord(id, 'TRIAL', { ...body, operator: body.operator || viewerUser.name }, { authorization, user: viewerUser })
  }

  @Post('mobile/molds/:id/batch')
  @UseGuards(AdminAuthGuard)
  async batch(
    @Param('id') id: string,
    @Body() body: ProductionBody,
    @Req() request: RequestWithAdmin,
    @Headers('authorization') authorization?: string,
  ) {
    this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.requireFollowerViewer(id, authorization)
    return this.productionRecord(id, 'BATCH', { ...body, operator: body.operator || viewerUser.name }, { authorization, user: viewerUser })
  }

  @Post('mobile/molds/:id/evaluation')
  @UseGuards(AdminAuthGuard)
  async evaluation(
    @Param('id') id: string,
    @Body() body: EvaluationBody,
    @Req() request: RequestWithAdmin,
    @Headers('authorization') authorization?: string,
  ) {
    this.requireMobileMoldViewPermission(request)
    const viewerUser = await this.requireFollowerViewer(id, authorization)
    return this.evaluationRecord(id, { ...body, operator: body.operator || viewerUser.name }, { authorization, user: viewerUser })
  }

  private async confirmDrawingRecord(id: string, operator: string, options: ViewerOptions = {}) {
    const mold = await this.findMold(id)
    await this.prisma.$transaction([
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'SUPPLIER_CONFIRMED' },
      }),
      this.prisma.moldDevelopmentFlowRecord.update({
        where: { moldDevelopmentId_key: { moldDevelopmentId: mold.id, key: 'CONFIRM' } },
        data: { done: true, operator, operatedAt: new Date() },
      }),
    ])
    return toMobileMold(await this.findMold(id), options)
  }

  private async shippingRecord(id: string, body: ShippingBody, options: ViewerOptions = {}) {
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
    return toMobileMold(await this.findMold(id), options)
  }

  private async receiveRecord(id: string, body: ReceiveBody, options: ViewerOptions = {}) {
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
    return toMobileMold(await this.findMold(id), options)
  }

  private async productionRecord(
    id: string,
    type: 'TRIAL' | 'BATCH',
    body: ProductionBody,
    options: ViewerOptions = {},
  ) {
    const mold = await this.findMold(id)
    const count = await this.prisma.moldProductionRecord.count({
      where: { moldDevelopmentId: mold.id, type },
    })
    await this.prisma.$transaction([
      this.prisma.moldProductionRecord.create({
        data: {
          moldDevelopmentId: mold.id,
          type,
          title: productionTitle(type, count + 1),
          operator: body.operator || '当前用户',
          images: {
            productImages: body.productImages || body.images || [],
            destructiveImages: body.destructiveImages || [],
            images: body.images?.length ? body.images : [...(body.productImages || []), ...(body.destructiveImages || [])],
          },
        },
      }),
      this.prisma.moldDevelopment.update({
        where: { id: mold.id },
        data: { status: 'TRIAL_PRODUCTION' },
      }),
    ])
    return toMobileMold(await this.findMold(id), options)
  }

  private async evaluationRecord(id: string, body: EvaluationBody, options: ViewerOptions = {}) {
    const mold = await this.findMold(id)
    await this.prisma.$transaction([
      this.prisma.moldProductionRecord.create({
        data: {
          moldDevelopmentId: mold.id,
          type: 'EVALUATION',
          title: '模具评判记录',
          operator: body.operator || '当前用户',
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
    return toMobileMold(await this.findMold(id), options)
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

  private async findArchiveMap(developmentCodes: string[]) {
    const codes = developmentCodes.filter(Boolean)
    if (!codes.length) return new Map<string, string>()
    const records = await this.prisma.moldMaster.findMany({
      where: {
        sourceMoldDevelopmentCode: { in: codes },
      },
      select: { code: true, sourceMoldDevelopmentCode: true },
    })
    return new Map(
      records
        .map((record) => {
          const sourceCode = record.sourceMoldDevelopmentCode || ''
          return [sourceCode, record.code] as const
        })
        .filter(([sourceCode]) => codes.includes(sourceCode)),
    )
  }

  private async findMoldsForViewer(user?: MobileViewerUser | null, request?: RequestWithAdmin) {
    if (!isSupplierUser(user)) {
      const followerName = user?.name || ''
      const visibleCodes = request ? await this.visibleMoldCodes(request) : null
      const records = await this.findMolds()
      return visibleCodes
        ? records.filter((record) => visibleCodes.includes(record.code) || Boolean(followerName && record.followerName === followerName))
        : records
    }
    if (!user.belongsTo) return []
    return this.prisma.moldDevelopment.findMany({
      where: { supplier: { OR: [{ code: user.belongsTo }, { name: user.belongsTo }] } },
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

  private async findMoldForViewer(id: string, user?: MobileViewerUser | null, request?: RequestWithAdmin) {
    const record = await this.findMold(id)
    if (isSupplierUser(user) && record.supplier.name !== user.belongsTo && record.supplier.code !== user.belongsTo) {
      throw new NotFoundException('模具开发任务不存在')
    }
    const followerName = !isSupplierUser(user) ? user?.name || '' : ''
    if (request && !isSupplierUser(user) && (!followerName || record.followerName !== followerName)) {
      await this.assertMoldVisible(record.code, request)
    }
    return record
  }

  private requireMoldPermission(request: RequestWithAdmin, permission: string) {
    if (!hasAdminPermission(getAdminContext(request), permission)) {
      throw new ForbiddenException('无权执行当前操作')
    }
  }

  private requireMobileMoldViewPermission(request: RequestWithAdmin) {
    this.requireMoldPermission(request, 'mini.mold.development.view')
  }

  private async visibleMoldCodes(request: RequestWithAdmin) {
    return visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'mold:development')
  }

  private async assertMoldVisible(id: string, request: RequestWithAdmin) {
    const mold = await this.findMold(id)
    const visibleCodes = await this.visibleMoldCodes(request)
    if (visibleCodes && !visibleCodes.includes(mold.code)) {
      throw new NotFoundException('模具开发任务不存在')
    }
  }

  private async getViewerUser(authorization?: string): Promise<MobileViewerUser | null> {
    const verifiedToken = verifyAdminToken(extractBearerToken(authorization))
    if (!verifiedToken) return null
    const user = await this.prisma.user.findFirst({
      where: { id: verifiedToken.userId, deletedAt: null },
      select: { id: true, name: true, userType: true, belongsTo: true, status: true, lockStatus: true },
    })
    if (!user) throw new ForbiddenException('登录已失效')
    if (user.status !== 'ENABLED' || user.lockStatus !== 'NORMAL') {
      throw new ForbiddenException('账号已禁用或锁定')
    }
    return user
  }

  private async requireSupplierViewer(authorization?: string): Promise<MobileViewerUser> {
    const user = await this.getViewerUser(authorization)
    if (!isSupplierUser(user)) {
      throw new ForbiddenException('仅供应商员工可以执行该操作')
    }
    return user
  }

  private async requireFollowerViewer(id: string, authorization?: string): Promise<MobileViewerUser> {
    const user = await this.getViewerUser(authorization)
    if (!user) throw new ForbiddenException('请先登录')
    const mold = await this.findMoldForViewer(id, user)
    if (!mold.followerName || mold.followerName !== user.name) {
      throw new ForbiddenException('仅跟单人可以执行该操作')
    }
    return user
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
      moldName: '英沃保险柜门板内板模具',
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
      moldName: '球墨铸铁泵体模具',
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
    moldName?: string
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
        moldName: data.moldName,
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
