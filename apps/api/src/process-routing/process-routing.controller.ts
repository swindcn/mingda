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
import { PrismaService } from '../prisma/prisma.service'
import {
  getAdminContext,
  upsertOwnership,
  visibleOwnershipEntityIds,
  type RequestWithAdmin,
} from '../shared/admin-context'
import { AdminAuthGuard } from '../shared/admin-auth.guard'
import { ModelingPermissionGuard } from '../shared/modeling-permission.guard'
import { validateAndOrderGraph } from './process-routing.graph'
import type { NormalizedRoutingEdge, NormalizedRoutingNode, RoutingBody } from './process-routing.types'

const codePattern = /^[^\s\u4e00-\u9fff]+$/
const allowedProductTypes = ['成品', '半成品']
const postgresIntMax = 2_147_483_647

type PreparedRouting = {
  name: string
  productCodes: string[]
  nodes: NormalizedRoutingNode[]
  edges: NormalizedRoutingEdge[]
  remark: string | null
}

@Controller('admin/modeling/routings')
@UseGuards(AdminAuthGuard, ModelingPermissionGuard)
export class ProcessRoutingController {
  constructor(private readonly prisma: PrismaService) {}

  private include() {
    return {
      routing: true,
      createdBy: { select: { id: true, name: true } },
      products: {
        include: { product: { include: { materialGrade: true } } },
        orderBy: { productCode: 'asc' as const },
      },
      defaultProducts: { orderBy: { productCode: 'asc' as const } },
      nodes: {
        include: {
          operation: true,
          equipmentLinks: {
            include: { equipment: { include: { workshop: true } } },
            orderBy: { equipmentCode: 'asc' as const },
          },
        },
        orderBy: { seqNo: 'asc' as const },
      },
      edges: { orderBy: { createdAt: 'asc' as const } },
    }
  }

  private dto(record: Prisma.ProcessRoutingVersionGetPayload<{ include: ReturnType<ProcessRoutingController['include']> }>) {
    const materialGrades = Array.from(
      new Map(
        record.products
          .map((item) => item.product.materialGrade)
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => [item.code, { code: item.code, name: item.name }]),
      ).values(),
    )
    return {
      id: record.id,
      routingId: record.routingId,
      code: record.routing.code,
      name: record.routing.name,
      version: record.version,
      status: record.status,
      sourceVersionId: record.sourceVersionId || undefined,
      createdByUserId: record.createdByUserId || undefined,
      createdByName: record.createdBy?.name || '',
      remark: record.remark || '',
      recycledAt: record.recycledAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      productCodes: record.products.map((item) => item.productCode),
      products: record.products.map((item) => ({
        code: item.productCode,
        name: item.product.name,
        type: item.product.type || '',
        materialGradeCode: item.product.materialGradeCode || '',
        materialGradeName: item.product.materialGrade?.name || '',
      })),
      materialGrades,
      defaultProductCodes: record.defaultProducts.map((item) => item.productCode),
      nodeCount: record.nodes.length,
      defaultProductCount: record.defaultProducts.length,
      nodes: record.nodes.map((node) => ({
        id: node.id,
        operationCode: node.operationCode,
        operationName: node.operation.name,
        section: node.operation.section,
        reportMode: node.operation.reportMode,
        pouringMergePoint: node.operation.pouringMergePoint,
        seqNo: node.seqNo,
        routeType: node.routeType,
        reportEnabled: node.reportEnabled,
        qualityControlEnabled: node.qualityControlEnabled,
        qualityRequirement: node.qualityRequirement || '',
        requireFurnaceBatch: node.requireFurnaceBatch,
        requireLadle: node.requireLadle,
        requireCoreBatch: node.requireCoreBatch,
        standardCycleSeconds: node.standardCycleSeconds ?? undefined,
        coolingDurationMinutes: node.coolingDurationMinutes,
        positionX: Number(node.positionX),
        positionY: Number(node.positionY),
        equipmentCodes: node.equipmentLinks.map((item) => item.equipmentCode),
        equipment: node.equipmentLinks.map((item) => ({
          code: item.equipmentCode,
          name: item.equipment.name,
          workshopName: item.equipment.workshop?.name || '',
        })),
        remark: node.remark || '',
      })),
      edges: record.edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
    }
  }

  private async findVersion(id: string) {
    const record = await this.prisma.processRoutingVersion.findUnique({ where: { id }, include: this.include() })
    if (!record) throw new NotFoundException('工艺路线版本不存在')
    return record
  }

  private async assertVisible(request: RequestWithAdmin, id: string) {
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:routings')
    if (visibleIds === null || visibleIds.includes(id)) return
    throw new NotFoundException('工艺路线版本不存在')
  }

  private async visibleVersion(request: RequestWithAdmin, id: string) {
    await this.assertVisible(request, id)
    return this.findVersion(id)
  }

  private assertNotRecycled(record: { recycledAt: Date | null }) {
    if (record.recycledAt) throw new BadRequestException('该工艺路线已在回收站，请先恢复')
  }

  private async prepare(body: RoutingBody, publishing: boolean): Promise<PreparedRouting> {
    const name = String(body.name || '').trim()
    if (!name) throw new BadRequestException('请输入路线名称')
    const productCodes = Array.from(new Set((body.productCodes || []).map((code) => String(code).trim()).filter(Boolean)))
    if (publishing && !productCodes.length) throw new BadRequestException('发布路线前至少选择一个产品或半成品')
    const products = await this.prisma.product.findMany({ where: { code: { in: productCodes } } })
    if (products.length !== productCodes.length) throw new BadRequestException('关联产品或半成品不存在')
    if (products.some((product) => !allowedProductTypes.some((type) => product.type === type || product.type?.startsWith(`${type}/`)))) {
      throw new BadRequestException('工艺路线只能关联成品或半成品')
    }

    const graph = validateAndOrderGraph(body.nodes, body.edges, publishing)
    const operationCodes = Array.from(new Set(graph.nodes.map((node) => node.operationCode)))
    const equipmentCodes = Array.from(new Set(graph.nodes.flatMap((node) => node.equipmentCodes)))
    const [operations, equipment] = await Promise.all([
      this.prisma.operationMaster.findMany({ where: { code: { in: operationCodes } } }),
      this.prisma.furnace.findMany({ where: { code: { in: equipmentCodes } } }),
    ])
    if (operations.length !== operationCodes.length) throw new BadRequestException('路线引用了不存在的标准工序')
    if (equipment.length !== equipmentCodes.length) throw new BadRequestException('路线引用了不存在的设备')
    if (publishing && operations.some((operation) => operation.status !== 'ENABLED')) throw new BadRequestException('路线包含已禁用工序，不能发布')
    if (publishing && equipment.some((item) => item.status !== '启用')) throw new BadRequestException('路线包含已停用设备，不能发布')
    const operationByCode = new Map(operations.map((operation) => [operation.code, operation]))
    const nodes = graph.nodes.map((node) => {
      const operation = operationByCode.get(node.operationCode)!
      const pouring = operation.pouringMergePoint
      const rawCoolingDurationMinutes: unknown = node.coolingDurationMinutes
      const coolingDurationMinutes = rawCoolingDurationMinutes === undefined ? 0 : rawCoolingDurationMinutes
      if (
        typeof coolingDurationMinutes !== 'number'
        || !Number.isSafeInteger(coolingDurationMinutes)
        || coolingDurationMinutes < 0
        || coolingDurationMinutes > postgresIntMax
      ) {
        throw new BadRequestException(`节点 ${node.operationCode} 的要求冷却时长必须是非负整数`)
      }
      return {
        ...node,
        routeType: pouring ? 'MERGE_POINT' : node.routeType,
        reportEnabled: node.reportEnabled ?? true,
        qualityControlEnabled: node.qualityControlEnabled ?? operation.qualityControlPoint,
        qualityRequirement: String(node.qualityRequirement || '').trim() || undefined,
        requireFurnaceBatch: pouring || Boolean(node.requireFurnaceBatch),
        requireLadle: pouring || Boolean(node.requireLadle),
        requireCoreBatch: pouring || Boolean(node.requireCoreBatch),
        coolingDurationMinutes: node.operationCode === 'OP-SHAKE' || operation.section === '清理' ? coolingDurationMinutes : 0,
        remark: String(node.remark || '').trim() || undefined,
      }
    })
    if (publishing) validateAndOrderGraph(nodes, graph.edges, true)
    return { name, productCodes, nodes, edges: graph.edges, remark: String(body.remark || '').trim() || null }
  }

  private async createVersionData(
    tx: Prisma.TransactionClient,
    routingId: string,
    version: string,
    prepared: PreparedRouting,
    createdByUserId: string,
    sourceVersionId?: string,
  ) {
    await this.assertProductsAvailable(tx, prepared.productCodes, routingId)
    const versionRecord = await tx.processRoutingVersion.create({
      data: {
        routingId,
        version,
        sourceVersionId,
        createdByUserId,
        remark: prepared.remark,
        products: { create: prepared.productCodes.map((productCode) => ({ productCode })) },
      },
    })
    const nodeIdMap = new Map<string, string>()
    for (const node of prepared.nodes) {
      const created = await tx.processRoutingNode.create({
        data: {
          routingVersionId: versionRecord.id,
          operationCode: node.operationCode,
          seqNo: node.seqNo,
          routeType: node.routeType,
          reportEnabled: Boolean(node.reportEnabled),
          qualityControlEnabled: Boolean(node.qualityControlEnabled),
          qualityRequirement: node.qualityRequirement || null,
          requireFurnaceBatch: Boolean(node.requireFurnaceBatch),
          requireLadle: Boolean(node.requireLadle),
          requireCoreBatch: Boolean(node.requireCoreBatch),
          standardCycleSeconds: node.standardCycleSeconds,
          coolingDurationMinutes: node.coolingDurationMinutes ?? 0,
          positionX: node.positionX,
          positionY: node.positionY,
          remark: node.remark || null,
          equipmentLinks: { create: node.equipmentCodes.map((equipmentCode) => ({ equipmentCode })) },
        },
      })
      nodeIdMap.set(node.id, created.id)
    }
    if (prepared.edges.length) {
      await tx.processRoutingEdge.createMany({
        data: prepared.edges.map((edge) => ({
          routingVersionId: versionRecord.id,
          sourceNodeId: nodeIdMap.get(edge.sourceNodeId)!,
          targetNodeId: nodeIdMap.get(edge.targetNodeId)!,
        })),
      })
    }
    return versionRecord.id
  }

  private async assertProductsAvailable(
    tx: Prisma.TransactionClient,
    productCodes: string[],
    routingId: string,
  ) {
    const codes = Array.from(new Set(productCodes)).sort()
    for (const productCode of codes) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-routing-product:${productCode}`}))`
    }
    if (!codes.length) return

    const conflicts = await tx.routingApplicableProduct.findMany({
      where: {
        productCode: { in: codes },
        routingVersion: {
          status: { in: ['DRAFT', 'ACTIVE'] },
          routingId: { not: routingId },
        },
      },
      include: { routingVersion: { include: { routing: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const conflict = conflicts[0]
    if (conflict) {
      throw new BadRequestException(
        `产品 ${conflict.productCode} 已关联工艺路线 ${conflict.routingVersion.routing.code}（${conflict.routingVersion.routing.name}），一个产品只能对应一条工艺路线`,
      )
    }
  }

  private preparedFromRecord(record: Awaited<ReturnType<ProcessRoutingController['findVersion']>>) {
    return {
      name: record.routing.name,
      productCodes: record.products.map((item) => item.productCode),
      remark: record.remark || undefined,
      nodes: record.nodes.map((node) => ({
        id: node.id,
        operationCode: node.operationCode,
        routeType: node.routeType,
        reportEnabled: node.reportEnabled,
        qualityControlEnabled: node.qualityControlEnabled,
        qualityRequirement: node.qualityRequirement || undefined,
        requireFurnaceBatch: node.requireFurnaceBatch,
        requireLadle: node.requireLadle,
        requireCoreBatch: node.requireCoreBatch,
        standardCycleSeconds: node.standardCycleSeconds ?? undefined,
        coolingDurationMinutes: node.coolingDurationMinutes,
        positionX: Number(node.positionX),
        positionY: Number(node.positionY),
        equipmentCodes: node.equipmentLinks.map((item) => item.equipmentCode),
        remark: node.remark || undefined,
      })),
      edges: record.edges.map((edge) => ({ sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })),
    }
  }

  @Get('options')
  async options() {
    const [products, assignments, operations, equipment] = await Promise.all([
      this.prisma.product.findMany({
        where: { OR: allowedProductTypes.map((type) => ({ type: { startsWith: type } })) },
        include: { materialGrade: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.routingApplicableProduct.findMany({
        where: { routingVersion: { status: { in: ['DRAFT', 'ACTIVE'] } } },
        select: {
          productCode: true,
          routingVersion: { select: { routing: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.operationMaster.findMany({ where: { status: 'ENABLED' }, orderBy: [{ section: 'asc' }, { code: 'asc' }] }),
      this.prisma.furnace.findMany({ where: { status: '启用' }, include: { workshop: true }, orderBy: { code: 'asc' } }),
    ])
    const assignmentByProduct = new Map(assignments.map((item) => [item.productCode, item.routingVersion.routing]))
    return {
      products: products.map((product) => {
        const assignment = assignmentByProduct.get(product.code)
        return {
          code: product.code,
          name: product.name,
          type: product.type || '',
          materialGradeCode: product.materialGradeCode || '',
          materialGradeName: product.materialGrade?.name || '',
          assignedRoutingCode: assignment?.code || '',
          assignedRoutingName: assignment?.name || '',
        }
      }),
      operations,
      equipment: equipment.map((item) => ({ code: item.code, name: item.name, workshopCode: item.workshopCode || '', workshopName: item.workshop?.name || '' })),
    }
  }

  @Get()
  async list(
    @Req() request: RequestWithAdmin,
    @Query('keyword') keyword?: string,
    @Query('productCode') productCode?: string,
    @Query('materialGradeCode') materialGradeCode?: string,
    @Query('version') version?: string,
    @Query('status') status?: string,
    @Query('recycled') recycled?: string,
  ) {
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'modeling:routings')
    const where: Prisma.ProcessRoutingVersionWhereInput = {
      ...(visibleIds === null ? {} : { id: { in: visibleIds } }),
      ...(status ? { status } : {}),
      ...(recycled === 'true' ? { recycledAt: { not: null } } : { recycledAt: null }),
      ...(version ? { version } : {}),
      ...(productCode ? { products: { some: { productCode } } } : {}),
      ...(materialGradeCode ? { products: { some: { product: { materialGradeCode } } } } : {}),
      ...(keyword?.trim()
        ? { OR: [
            { routing: { code: { contains: keyword.trim(), mode: 'insensitive' } } },
            { routing: { name: { contains: keyword.trim(), mode: 'insensitive' } } },
            { products: { some: { product: { code: { contains: keyword.trim(), mode: 'insensitive' } } } } },
            { products: { some: { product: { name: { contains: keyword.trim(), mode: 'insensitive' } } } } },
          ] }
        : {}),
    }
    const records = await this.prisma.processRoutingVersion.findMany({ where, include: this.include(), orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }] })
    return records.map((record) => this.dto(record))
  }

  @Get(':id')
  async detail(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    return this.dto(await this.visibleVersion(request, id))
  }

  @Post()
  async create(@Req() request: RequestWithAdmin, @Body() body: RoutingBody) {
    const code = String(body.code || '').trim()
    if (!code || !codePattern.test(code)) throw new BadRequestException('路线编号不能为空，且不能包含中文或空格')
    const prepared = await this.prepare(body, false)
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const routing = await tx.processRouting.create({ data: { code, name: prepared.name } })
        return this.createVersionData(tx, routing.id, 'V1.0', prepared, getAdminContext(request).id)
      })
      await upsertOwnership(this.prisma, getAdminContext(request), 'modeling:routings', id)
      return this.dto(await this.findVersion(id))
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('路线编号已存在')
      throw error
    }
  }

  @Put(':id')
  async update(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: RoutingBody) {
    const existing = await this.visibleVersion(request, id)
    if (existing.status !== 'DRAFT') throw new BadRequestException('只有草稿路线可以编辑')
    const prepared = await this.prepare({ ...body, code: existing.routing.code }, false)
    await this.prisma.$transaction(async (tx) => {
      await this.assertProductsAvailable(tx, prepared.productCodes, existing.routingId)
      await tx.processRouting.update({ where: { id: existing.routingId }, data: { name: prepared.name } })
      await tx.processRoutingEdge.deleteMany({ where: { routingVersionId: id } })
      await tx.processRoutingNode.deleteMany({ where: { routingVersionId: id } })
      await tx.routingApplicableProduct.deleteMany({ where: { routingVersionId: id } })
      await tx.processRoutingVersion.update({ where: { id }, data: { remark: prepared.remark, products: { create: prepared.productCodes.map((productCode) => ({ productCode })) } } })
      const nodeIdMap = new Map<string, string>()
      for (const node of prepared.nodes) {
        const created = await tx.processRoutingNode.create({
          data: {
            routingVersionId: id, operationCode: node.operationCode, seqNo: node.seqNo, routeType: node.routeType,
            reportEnabled: Boolean(node.reportEnabled), qualityControlEnabled: Boolean(node.qualityControlEnabled),
            qualityRequirement: node.qualityRequirement || null, requireFurnaceBatch: Boolean(node.requireFurnaceBatch),
            requireLadle: Boolean(node.requireLadle), requireCoreBatch: Boolean(node.requireCoreBatch),
            standardCycleSeconds: node.standardCycleSeconds, positionX: node.positionX, positionY: node.positionY,
            coolingDurationMinutes: node.coolingDurationMinutes ?? 0,
            remark: node.remark || null, equipmentLinks: { create: node.equipmentCodes.map((equipmentCode) => ({ equipmentCode })) },
          },
        })
        nodeIdMap.set(node.id, created.id)
      }
      if (prepared.edges.length) await tx.processRoutingEdge.createMany({ data: prepared.edges.map((edge) => ({ routingVersionId: id, sourceNodeId: nodeIdMap.get(edge.sourceNodeId)!, targetNodeId: nodeIdMap.get(edge.targetNodeId)! })) })
    })
    await upsertOwnership(this.prisma, getAdminContext(request), 'modeling:routings', id)
    return this.dto(await this.findVersion(id))
  }

  @Put(':id/applicable-products')
  async updateApplicableProducts(
    @Req() request: RequestWithAdmin,
    @Param('id') id: string,
    @Body() body: { productCodes?: string[] },
  ) {
    await this.assertVisible(request, id)
    const productCodes = Array.from(new Set((body.productCodes || []).map((code) => String(code).trim()).filter(Boolean)))
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.processRoutingVersion.findUnique({
        where: { id },
        select: { routingId: true, status: true, products: { select: { productCode: true } } },
      })
      if (!version) throw new NotFoundException('工艺路线版本不存在')
      if (version.status === 'DISABLED') throw new BadRequestException('已停用路线不能维护适用产品')

      const products = await tx.product.findMany({ where: { code: { in: productCodes } }, select: { code: true, type: true } })
      if (products.length !== productCodes.length) throw new BadRequestException('关联产品或半成品不存在')
      if (products.some((product) => !allowedProductTypes.some((type) => product.type === type || product.type?.startsWith(`${type}/`)))) {
        throw new BadRequestException('工艺路线只能关联成品或半成品')
      }
      await this.assertProductsAvailable(tx, productCodes, version.routingId)

      const selected = new Set(productCodes)
      const removed = version.products.map((item) => item.productCode).filter((code) => !selected.has(code))
      if (removed.length) {
        await tx.productDefaultRouting.deleteMany({ where: { routingVersionId: id, productCode: { in: removed } } })
      }
      await tx.routingApplicableProduct.deleteMany({ where: { routingVersionId: id } })
      if (productCodes.length) {
        await tx.routingApplicableProduct.createMany({ data: productCodes.map((productCode) => ({ routingVersionId: id, productCode })) })
      }
      await tx.processRoutingVersion.update({ where: { id }, data: { updatedAt: new Date() } })
    })
    return this.dto(await this.findVersion(id))
  }

  @Delete(':id')
  async remove(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.visibleVersion(request, id)
    if (existing.status !== 'DRAFT') throw new BadRequestException('只有草稿路线可以删除')
    await this.prisma.$transaction(async (tx) => {
      await tx.businessDataOwnership.deleteMany({ where: { entityType: 'modeling:routings', entityId: id } })
      await tx.processRoutingVersion.delete({ where: { id } })
      if ((await tx.processRoutingVersion.count({ where: { routingId: existing.routingId } })) === 0) await tx.processRouting.delete({ where: { id: existing.routingId } })
    })
    return { id }
  }

  @Post(':id/activate')
  async activate(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.visibleVersion(request, id)
    if (existing.status !== 'DRAFT') throw new BadRequestException('只有草稿路线可以发布')
    await this.prepare(this.preparedFromRecord(existing), true)
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-routing:${existing.routing.code}`}))`
      const oldActive = await tx.processRoutingVersion.findFirst({ where: { routingId: existing.routingId, status: 'ACTIVE', id: { not: id } } })
      const oldDefaults = oldActive ? await tx.productDefaultRouting.findMany({ where: { routingVersionId: oldActive.id } }) : []
      if (oldActive) await tx.processRoutingVersion.update({ where: { id: oldActive.id }, data: { status: 'DISABLED' } })
      await tx.processRoutingVersion.update({ where: { id }, data: { status: 'ACTIVE' } })
      const currentProducts = new Set(existing.products.map((item) => item.productCode))
      for (const relation of oldDefaults) {
        if (currentProducts.has(relation.productCode)) await tx.productDefaultRouting.update({ where: { productCode: relation.productCode }, data: { routingVersionId: id } })
        else await tx.productDefaultRouting.delete({ where: { productCode: relation.productCode } })
      }
    })
    return this.dto(await this.findVersion(id))
  }

  @Post(':id/disable')
  async disable(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.visibleVersion(request, id)
    if (existing.status !== 'ACTIVE') throw new BadRequestException('只有已生效路线可以停用')
    await this.prisma.$transaction([
      this.prisma.productDefaultRouting.deleteMany({ where: { routingVersionId: id } }),
      this.prisma.processRoutingVersion.update({ where: { id }, data: { status: 'DISABLED' } }),
    ])
    return this.dto(await this.findVersion(id))
  }

  @Post(':id/recycle')
  async recycle(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.visibleVersion(request, id)
    if (existing.status !== 'DISABLED') throw new BadRequestException('只有已停用路线可以移入回收站')
    if (existing.recycledAt) throw new BadRequestException('该工艺路线已在回收站')
    await this.prisma.processRoutingVersion.update({ where: { id }, data: { recycledAt: new Date() } })
    return this.dto(await this.findVersion(id))
  }

  @Post(':id/restore')
  async restore(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const existing = await this.visibleVersion(request, id)
    if (!existing.recycledAt) throw new BadRequestException('该工艺路线不在回收站')
    if (existing.status !== 'DISABLED') throw new BadRequestException('只有已停用路线可以恢复')
    await this.prisma.processRoutingVersion.update({ where: { id }, data: { recycledAt: null } })
    return this.dto(await this.findVersion(id))
  }

  @Post(':id/new-version')
  async newVersion(@Req() request: RequestWithAdmin, @Param('id') id: string) {
    const source = await this.visibleVersion(request, id)
    this.assertNotRecycled(source)
    if (source.status === 'DRAFT') throw new BadRequestException('草稿路线不能创建新版本')
    const prepared = await this.prepare(this.preparedFromRecord(source), false)
    const newId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-routing:${source.routing.code}`}))`
      const existingDraft = await tx.processRoutingVersion.findFirst({ where: { routingId: source.routingId, status: 'DRAFT' } })
      if (existingDraft) throw new BadRequestException('当前路线已有待编辑草稿')
      const versions = await tx.processRoutingVersion.findMany({ where: { routingId: source.routingId }, select: { version: true } })
      const max = versions.reduce((value, item) => Math.max(value, Number(/^V(\d+)\.0$/.exec(item.version)?.[1] || 0)), 0)
      return this.createVersionData(tx, source.routingId, `V${max + 1}.0`, prepared, getAdminContext(request).id, source.id)
    })
    await upsertOwnership(this.prisma, getAdminContext(request), 'modeling:routings', newId)
    return this.dto(await this.findVersion(newId))
  }

  @Post(':id/clone')
  async clone(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    const source = await this.visibleVersion(request, id)
    this.assertNotRecycled(source)
    const code = String(body.code || '').trim()
    if (!code || !codePattern.test(code)) throw new BadRequestException('请输入有效的新路线编号')
    const prepared = await this.prepare({
      ...this.preparedFromRecord(source),
      name: String(body.name || `${source.routing.name}复制`),
      productCodes: [],
    }, false)
    try {
      const newId = await this.prisma.$transaction(async (tx) => {
        const routing = await tx.processRouting.create({ data: { code, name: prepared.name } })
        return this.createVersionData(tx, routing.id, 'V1.0', prepared, getAdminContext(request).id, source.id)
      })
      await upsertOwnership(this.prisma, getAdminContext(request), 'modeling:routings', newId)
      return this.dto(await this.findVersion(newId))
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('新路线编号已存在')
      throw error
    }
  }

  @Put(':id/default-products')
  async setDefaultProducts(@Req() request: RequestWithAdmin, @Param('id') id: string, @Body() body: { productCodes?: string[] }) {
    const existing = await this.visibleVersion(request, id)
    if (existing.status !== 'ACTIVE') throw new BadRequestException('只有已生效路线可以设置默认产品')
    const selected = Array.from(new Set((body.productCodes || []).map((code) => String(code).trim()).filter(Boolean)))
    const allowed = new Set(existing.products.map((item) => item.productCode))
    if (selected.some((code) => !allowed.has(code))) throw new BadRequestException('默认产品必须属于当前路线适用产品')
    await this.prisma.$transaction(async (tx) => {
      await tx.productDefaultRouting.deleteMany({ where: { routingVersionId: id, productCode: { notIn: selected } } })
      for (const productCode of selected) {
        await tx.productDefaultRouting.upsert({ where: { productCode }, update: { routingVersionId: id }, create: { productCode, routingVersionId: id } })
      }
    })
    return this.dto(await this.findVersion(id))
  }
}
