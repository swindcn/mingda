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
  UseGuards,
} from '@nestjs/common'
import { DataScope, Prisma, SyncProvider } from '@prisma/client'
import { PrismaService } from './prisma/prisma.service'
import { AdminAuthGuard } from './shared/admin-auth.guard'

interface DepartmentBody {
  name?: string
  code?: string
  parentKey?: string
}

interface UserBody {
  name?: string
  phone?: string
  userType?: '员工' | '供应商' | '客户'
  organization?: string
  department?: string
  departmentId?: string
  position?: string
  role?: string
  status?: '启用' | '禁用'
  lockStatus?: '正常' | '锁定'
  belongsTo?: string
}

interface RoleBody {
  name?: string
  organization?: string
  app?: string
  description?: string
  permissions?: string[]
  dataScope?: 'self' | 'department' | 'department_tree' | 'organization' | 'custom_departments'
  customDepartments?: Array<{ departmentId: string; includeChildren: boolean }>
  columnPermissions?: string[]
  userIds?: string[]
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

const organizationName = '摩尔元数（福建）科技有限公司'

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
  const map: Record<string, '员工' | '供应商' | '客户'> = {
    EMPLOYEE: '员工',
    SUPPLIER: '供应商',
    CUSTOMER: '客户',
  }
  return map[value] || '员工'
}

function userTypeValue(value?: UserBody['userType']) {
  const map = {
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

function stringArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
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
@UseGuards(AdminAuthGuard)
export class BasicDataController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Get('users')
  async users() {
    await this.ensureBasicSeed()
    const records = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        department: true,
        roles: { include: { role: true } },
      },
    })
    return records.map((record) => this.toUser(record))
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
        userType: userTypeValue(body.userType) || 'EMPLOYEE',
        organizationName: body.organization || organizationName,
        departmentId: department?.id,
        ownerDepartmentId: department?.id,
        position: body.position,
        status: body.status === '禁用' ? 'DISABLED' : 'ENABLED',
        lockStatus: body.lockStatus === '锁定' ? 'LOCKED' : 'NORMAL',
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
        userType: userTypeValue(body.userType),
        organizationName: body.organization,
        departmentId: body.department || body.departmentId ? department?.id || null : undefined,
        ownerDepartmentId: body.department || body.departmentId ? department?.id || null : undefined,
        position: body.position,
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
        description: body.description,
        app: body.app || '管理端',
        dataScope: prismaScope(body.dataScope) || 'OWN',
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
        description: body.description,
        app: body.app,
        dataScope: prismaScope(body.dataScope),
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
      organization: organizationName,
      app: record.app,
      description: record.description || '',
      createdBy: record.name === '系统管理员' ? '系统' : '管理员',
      createdAt: formatDateTime(record.createdAt),
      permissions: stringArray(record.permissions),
      dataScope: frontendScope(record.dataScope),
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

  private async collectDepartmentIds(id: string): Promise<string[]> {
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
        dataScope: 'ALL',
        permissions: [
          'admin',
          'basic',
          'basic.department',
          'basic.department.create',
          'basic.department.edit',
          'basic.department.delete',
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
          'basic.department.create',
          'basic.department.edit',
          'basic.department.delete',
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
    const admin = await this.prisma.user.findFirst({
      where: { OR: [{ username: 'admin' }, { phone: '13665068911' }] },
    })
    if (admin) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
        update: {},
        create: { userId: admin.id, roleId: adminRole.id },
      })
    }
  }
}
