import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type WorkOrderProductionStatus, type WorkOrderScheduleStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  getAdminContext,
  hasAdminPermission,
  visibleOwnershipEntityIds,
  type AdminContext,
  type RequestWithAdmin,
} from '../shared/admin-context'
import {
  allocateActualWeight,
  allocationWeightKg,
  CapacityConfigurationError,
  calculateFinishAt,
  capacityToKg,
  clipInterval,
  displayWorkOrderStatus,
  roundWeight,
  recipeOccupancyMinutes,
} from './production.calculations'
import type { AdjustHeatScheduleBody, CompleteHeatOrderBody, HeatConflictBody, HeatOrderBody, StartHeatOrderBody, TransferHeatOrderBody, VersionedActionBody, WorkOrderBody } from './production.types'

const enabledProductTypes = ['成品', '半成品']
type ProductionDatabaseClient = PrismaService | Prisma.TransactionClient

type WorkOrderMasterSnapshot = {
  productCode: string
  productName: string
  bomVersionId: string
  bomCode: string
  bomVersion: string
  routingVersionId: string
  routingCode: string
  routingName: string
  routingVersion: string
  materialGradeCode: string
  materialGradeName: string
  unitNetWeightKg: number
  unitGrossWeightKg: number
  yieldRate: number
  unitReturnWeightKg: number
}

type MeltPoolFurnaceOption = {
  code: string
  name: string
  workshopCode: string
  workshopName: string
  capacity: number
  capacityUnit: string
  capacityKg: number
}

function isSerializableConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2034') return true
  return error.code === 'P2010' && String(error.meta?.code || '') === '40001'
}

function dateOnly(value: unknown, required: boolean) {
  const text = String(value || '').trim()
  if (!text) {
    if (required) throw new BadRequestException('请选择计划交期')
    return null
  }
  const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new BadRequestException('日期格式不正确')
  return date
}

function decimal(value: Prisma.Decimal | number | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value)
}

function currentBusinessDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const key = `${values.year}${values.month}${values.day}`
  return { key, date: new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`) }
}

function dateTime(value: unknown, label: string) {
  const result = new Date(String(value || ''))
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`请选择${label}`)
  return result
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  private async lockWorkOrder(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "WorkOrder" WHERE "id" = ${id} FOR UPDATE
    `)
    if (!rows.length) throw new NotFoundException('生产工单不存在')
  }

  private workOrderInclude() {
    return {
      createdBy: { select: { id: true, name: true } },
      bomVersion: { include: { bom: true, coreBoxes: { select: { coreBoxCode: true } } } },
      routingVersion: {
        include: {
          routing: true,
          nodes: {
            include: {
              operation: true,
              equipmentLinks: { include: { equipment: true } },
            },
            orderBy: { seqNo: 'asc' as const },
          },
          edges: true,
        },
      },
      allocations: {
        include: { heatOrder: { include: { actualFurnace: true, transfers: true, startedBy: true, completedBy: true } } },
        orderBy: { createdAt: 'asc' as const },
      },
      coreTasks: { select: { id: true, status: true, coreBoxCode: true } },
    }
  }

  private heatOrderInclude() {
    return {
      materialGrade: true,
      furnace: { include: { workshop: true } },
      actualFurnace: true,
      recipe: { include: { recipeItems: { include: { item: true } } } },
      team: { include: { members: true, workshop: true } },
      createdBy: { select: { id: true, name: true } },
      startedBy: { select: { id: true, name: true } },
      completedBy: { select: { id: true, name: true } },
      canceledBy: { select: { id: true, name: true } },
      allocations: {
        include: { workOrder: true },
        orderBy: { createdAt: 'asc' as const },
      },
      records: { orderBy: { createdAt: 'asc' as const } },
      transfers: { include: { transferDevice: true, operator: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
    }
  }

  private heatOrderDto(record: any, user?: AdminContext, mobile = false) {
    const isTeamMember = Boolean(user && record.team?.members?.some((member: any) => member.userId === user.id))
    const allAccess = Boolean(user && (user.username === 'admin' || user.userType === 'SUPER_ADMIN'))
    const latestSchedulePayload = [...record.records].reverse().find((item: any) => ['CREATED', 'SCHEDULE_ADJUSTED'].includes(item.action))?.payload
    const confirmedConflicts = latestSchedulePayload && typeof latestSchedulePayload === 'object' && Array.isArray(latestSchedulePayload.confirmedScheduleConflicts)
      ? latestSchedulePayload.confirmedScheduleConflicts
      : []
    const transferTotalWeightKg = roundWeight(record.transfers.reduce((sum: number, item: any) => sum + decimal(item.weightKg), 0))
    return {
      id: record.id,
      code: record.code,
      materialGradeCode: record.materialGradeCode,
      materialGradeName: record.materialGradeNameSnapshot,
      furnaceCode: record.furnaceCode,
      furnaceName: record.furnaceNameSnapshot,
      actualFurnaceCode: record.actualFurnaceCode || '',
      actualFurnaceName: record.actualFurnaceNameSnapshot || record.actualFurnace?.name || '',
      furnaceCapacityKg: decimal(record.furnaceCapacityKgSnapshot),
      workshopCode: record.workshopCodeSnapshot || record.furnace?.workshopCode || '',
      workshopName: record.workshopNameSnapshot || record.furnace?.workshop?.name || '',
      recipeCode: record.recipeCode,
      recipeName: record.recipeNameSnapshot,
      recipeVersion: record.recipeVersionSnapshot,
      teamCode: record.teamCode,
      teamName: record.teamNameSnapshot,
      shiftCode: record.shiftCode || '',
      plannedOutputAt: record.plannedOutputAt.toISOString(),
      plannedStartAt: record.plannedStartAt?.toISOString() || '',
      calculatedFinishAt: record.calculatedFinishAt?.toISOString() || '',
      plannedFinishAt: record.plannedFinishAt?.toISOString() || record.plannedOutputAt.toISOString(),
      meltingDurationMinutes: record.meltingDurationMinutesSnapshot ?? null,
      transferDurationMinutes: record.transferDurationMinutesSnapshot ?? null,
      cleaningDurationMinutes: record.cleaningDurationMinutesSnapshot ?? null,
      occupancyDurationMinutes: record.occupancyDurationMinutesSnapshot ?? null,
      finishTimeAdjusted: Boolean(record.finishTimeAdjusted),
      hasScheduleConflict: confirmedConflicts.length > 0,
      confirmedScheduleConflicts: confirmedConflicts,
      targetWeightKg: decimal(record.targetWeightKg),
      actualOutputWeightKg: record.actualOutputWeightKg === null ? null : decimal(record.actualOutputWeightKg),
      deviationWeightKg: record.actualOutputWeightKg === null ? null : roundWeight(decimal(record.actualOutputWeightKg) - decimal(record.targetWeightKg)),
      status: record.status,
      versionNo: record.versionNo,
      startedByName: record.startedBy?.name || '',
      startedAt: record.startedAt?.toISOString() || '',
      completedByName: record.completedBy?.name || '',
      completedAt: record.completedAt?.toISOString() || '',
      canceledByName: record.canceledBy?.name || '',
      canceledAt: record.canceledAt?.toISOString() || '',
      cancelReason: record.cancelReason || '',
      createdByName: record.createdBy?.name || '',
      createdAt: record.createdAt.toISOString(),
      transferTotalWeightKg,
      transfers: record.transfers.map((item: any) => ({
        id: item.id,
        transferDeviceCode: item.transferDeviceCode,
        transferDeviceName: item.transferDeviceNameSnapshot,
        equipmentType: item.equipmentTypeSnapshot,
        weightKg: decimal(item.weightKg),
        weightSource: item.weightSource,
        operatorName: item.operatorNameSnapshot,
        remark: item.remark || '',
        createdAt: item.createdAt.toISOString(),
      })),
      allocations: record.allocations.map((allocation: any) => ({
        id: allocation.id,
        workOrderId: allocation.workOrderId,
        workOrderCode: allocation.workOrder.code,
        productCode: allocation.workOrder.productCodeSnapshot,
        productName: allocation.workOrder.productNameSnapshot,
        allocatedQuantity: allocation.allocatedQuantity,
        plannedWeightKg: decimal(allocation.plannedWeightKg),
        actualWeightKg: allocation.actualWeightKg === null ? null : decimal(allocation.actualWeightKg),
      })),
      recipeItems: record.recipe.recipeItems.map((item: any) => ({
        itemCode: item.itemCode,
        itemName: item.item.name,
        materialCategory: item.materialCategory,
        ratio: item.ratio === null ? null : decimal(item.ratio),
        quantity: item.quantity === null ? null : decimal(item.quantity),
        unit: item.unit || '',
      })),
      records: record.records.map((item: any) => ({
        id: item.id,
        action: item.action,
        fromStatus: item.fromStatus || '',
        toStatus: item.toStatus,
        operatorName: item.operatorNameSnapshot,
        remark: item.remark || '',
        createdAt: item.createdAt.toISOString(),
      })),
      canStart: record.status === 'WAITING' && (allAccess || isTeamMember) && Boolean(user && hasAdminPermission(user, mobile ? 'mini.production.heat.start' : 'production.heat.start')),
      canTransfer: ['IN_PROGRESS', 'TRANSFERRING'].includes(record.status) && (allAccess || isTeamMember) && Boolean(user && hasAdminPermission(user, mobile ? 'mini.production.heat.transfer' : 'production.heat.transfer')),
      canComplete: record.status === 'TRANSFERRING' && transferTotalWeightKg > 0 && (allAccess || isTeamMember) && Boolean(user && hasAdminPermission(user, mobile ? 'mini.production.heat.complete' : 'production.heat.complete')),
      canCancel: record.status === 'WAITING' && Boolean(user && hasAdminPermission(user, 'production.schedule.cancel')),
    }
  }

  private workOrderDto(record: any) {
    const remainingQuantity = Math.max(0, record.plannedQuantity - record.scheduledQuantity)
    const requiresCoremaking = Boolean(record.routingVersion?.nodes?.some((node: any) => node.operation.section === '制芯'))
    const coreTasks = record.coreTasks || []
    const coreBoxCount = record.bomVersion?.coreBoxes?.length || 0
    const coreTaskSummary = {
      total: coreTasks.length,
      pendingDispatch: coreTasks.filter((task: any) => task.status === 'PENDING_DISPATCH').length,
      waiting: coreTasks.filter((task: any) => task.status === 'WAITING').length,
      inProgress: coreTasks.filter((task: any) => task.status === 'IN_PROGRESS').length,
      completed: coreTasks.filter((task: any) => task.status === 'COMPLETED').length,
      canceled: coreTasks.filter((task: any) => task.status === 'CANCELED').length,
    }
    return {
      id: record.id,
      code: record.code,
      source: record.source,
      externalNo: record.externalNo || '',
      productCode: record.productCode,
      productName: record.productNameSnapshot,
      bomVersionId: record.bomVersionId,
      bomCode: record.bomCodeSnapshot,
      bomVersion: record.bomVersionSnapshot,
      routingVersionId: record.routingVersionId,
      routingCode: record.routingCodeSnapshot,
      routingName: record.routingNameSnapshot,
      routingVersion: record.routingVersionSnapshot,
      materialGradeCode: record.materialGradeCode,
      materialGradeName: record.materialGradeNameSnapshot,
      plannedQuantity: record.plannedQuantity,
      plannedStartDate: record.plannedStartDate?.toISOString().slice(0, 10) || '',
      plannedDeliveryDate: record.plannedDeliveryDate.toISOString().slice(0, 10),
      priority: record.priority,
      unitNetWeightKg: decimal(record.unitNetWeightKg),
      unitGrossWeightKg: decimal(record.unitGrossWeightKg),
      yieldRate: decimal(record.yieldRate),
      unitReturnWeightKg: decimal(record.unitReturnWeightKg),
      totalNetWeightKg: decimal(record.totalNetWeightKg),
      totalMeltWeightKg: decimal(record.totalMeltWeightKg),
      expectedReturnWeightKg: decimal(record.expectedReturnWeightKg),
      scheduledQuantity: record.scheduledQuantity,
      meltCompletedQuantity: record.meltCompletedQuantity,
      meltCompletedWeightKg: decimal(record.meltCompletedWeightKg),
      completedQuantity: record.completedQuantity,
      remainingQuantity,
      remainingWeightKg: roundWeight(remainingQuantity * decimal(record.unitGrossWeightKg)),
      scheduleStatus: record.scheduleStatus,
      productionStatus: record.productionStatus,
      displayStatus: displayWorkOrderStatus(record.scheduleStatus, record.productionStatus),
      meltCompletedAt: record.meltCompletedAt?.toISOString() || '',
      completedAt: record.completedAt?.toISOString() || '',
      closedAt: record.closedAt?.toISOString() || '',
      closeReason: record.closeReason || '',
      versionNo: record.versionNo,
      remark: record.remark || '',
      createdByUserId: record.createdByUserId || '',
      createdByName: record.createdBy?.name || '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      canEdit: record.scheduledQuantity === 0 && record.productionStatus === 'RELEASED',
      requiresCoremaking,
      canGenerateCoreTasks: requiresCoremaking
        && !['COMPLETED', 'CLOSED'].includes(record.productionStatus)
        && (coreBoxCount === 0 || coreTasks.length < coreBoxCount),
      coreTaskCount: coreTasks.length,
      coreTaskSummary,
      routingNodes: record.routingVersion?.nodes?.map((node: any) => ({
        id: node.id,
        seqNo: node.seqNo,
        operationCode: node.operationCode,
        operationName: node.operation.name,
        standardCycleSeconds: node.standardCycleSeconds ?? undefined,
        equipment: node.equipmentLinks.map((link: any) => ({ code: link.equipmentCode, name: link.equipment.name })),
      })) || [],
      routingEdges: record.routingVersion?.edges?.map((edge: any) => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })) || [],
      heatOrders: record.allocations?.map((allocation: any) => ({
        allocationId: allocation.id,
        heatOrderId: allocation.heatOrderId,
        heatOrderCode: allocation.heatOrder.code,
        status: allocation.heatOrder.status,
        allocatedQuantity: allocation.allocatedQuantity,
        plannedWeightKg: decimal(allocation.plannedWeightKg),
        actualWeightKg: allocation.actualWeightKg === null ? null : decimal(allocation.actualWeightKg),
        furnaceCode: allocation.heatOrder.furnaceCode,
        furnaceName: allocation.heatOrder.furnaceNameSnapshot,
        actualFurnaceCode: allocation.heatOrder.actualFurnaceCode || '',
        actualFurnaceName: allocation.heatOrder.actualFurnaceNameSnapshot || allocation.heatOrder.actualFurnace?.name || '',
        transferTotalWeightKg: roundWeight(allocation.heatOrder.transfers.reduce((sum: number, item: any) => sum + decimal(item.weightKg), 0)),
        startedByName: allocation.heatOrder.startedBy?.name || '',
        startedAt: allocation.heatOrder.startedAt?.toISOString() || '',
        completedByName: allocation.heatOrder.completedBy?.name || '',
        completedAt: allocation.heatOrder.completedAt?.toISOString() || '',
      })) || [],
    }
  }

  private async findWorkOrder(id: string) {
    const record = await this.prisma.workOrder.findUnique({ where: { id }, include: this.workOrderInclude() })
    if (!record) throw new NotFoundException('生产工单不存在')
    return record
  }

  private async assertVisible(request: RequestWithAdmin, id: string) {
    const ids = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:work-orders')
    if (ids !== null && !ids.includes(id)) throw new NotFoundException('生产工单不存在')
  }

  async workOrderOptions() {
    const products = await this.prisma.product.findMany({
      where: {
        OR: enabledProductTypes.map((type) => ({ type: { startsWith: type } })),
      },
      select: { code: true, name: true, type: true, unit: true },
      orderBy: { code: 'asc' },
    })
    return { products }
  }

  async productPreview(productCode: string, bomVersionId?: string, routingVersionId?: string, client: ProductionDatabaseClient = this.prisma) {
    const product = await client.product.findUnique({ where: { code: productCode } })
    if (!product || !enabledProductTypes.some((type) => product.type === type || product.type?.startsWith(`${type}/`))) {
      throw new BadRequestException('请选择启用的成品或半成品')
    }
    const bomVersion = await client.castingBomVersion.findFirst({
      where: {
        ...(bomVersionId ? { id: bomVersionId } : {}),
        status: 'ACTIVE',
        bom: { productCode },
      },
      include: { bom: true, materialGrade: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (!bomVersion) throw new BadRequestException('该产品没有已生效的铸造 BOM')

    let routingVersion = routingVersionId
      ? await client.processRoutingVersion.findFirst({
          where: { id: routingVersionId, status: 'ACTIVE', products: { some: { productCode } } },
          include: { routing: true, nodes: { include: { operation: true, equipmentLinks: { include: { equipment: true } } }, orderBy: { seqNo: 'asc' } }, edges: true },
        })
      : null
    if (!routingVersion) {
      const defaultRouting = await client.productDefaultRouting.findUnique({
        where: { productCode },
        include: { routingVersion: { include: { routing: true, nodes: { include: { operation: true, equipmentLinks: { include: { equipment: true } } }, orderBy: { seqNo: 'asc' } }, edges: true } } },
      })
      if (defaultRouting?.routingVersion.status === 'ACTIVE') routingVersion = defaultRouting.routingVersion
    }
    if (!routingVersion) {
      routingVersion = await client.processRoutingVersion.findFirst({
        where: { status: 'ACTIVE', products: { some: { productCode } } },
        include: { routing: true, nodes: { include: { operation: true, equipmentLinks: { include: { equipment: true } } }, orderBy: { seqNo: 'asc' } }, edges: true },
        orderBy: { updatedAt: 'desc' },
      })
    }
    if (!routingVersion) throw new BadRequestException('该产品没有可用的已生效工艺路线')
    const recipeCount = await client.meltRecipe.count({ where: { materialGradeCode: bomVersion.materialGradeCode, status: 'ACTIVE' } })
    if (!recipeCount) throw new BadRequestException('该材质没有已生效的熔炼配方')

    return {
      productCode: product.code,
      productName: product.name,
      bomVersionId: bomVersion.id,
      bomCode: bomVersion.bom.code,
      bomVersion: bomVersion.version,
      routingVersionId: routingVersion.id,
      routingCode: routingVersion.routing.code,
      routingName: routingVersion.routing.name,
      routingVersion: routingVersion.version,
      materialGradeCode: bomVersion.materialGradeCode,
      materialGradeName: bomVersion.materialGrade.name,
      unitNetWeightKg: decimal(bomVersion.netWeightKg),
      unitGrossWeightKg: decimal(bomVersion.grossWeightKg),
      yieldRate: decimal(bomVersion.yieldRate),
      unitReturnWeightKg: decimal(bomVersion.returnWeightKg),
      routingNodes: routingVersion.nodes.map((node) => ({
        id: node.id,
        seqNo: node.seqNo,
        operationCode: node.operationCode,
        operationName: node.operation.name,
        standardCycleSeconds: node.standardCycleSeconds ?? undefined,
        equipment: node.equipmentLinks.map((link) => ({ code: link.equipmentCode, name: link.equipment.name })),
      })),
      routingEdges: routingVersion.edges.map((edge) => ({ sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId })),
    }
  }

  private async preparedWorkOrder(body: WorkOrderBody, client: ProductionDatabaseClient = this.prisma) {
    const productCode = String(body.productCode || '').trim()
    const preview = await this.productPreview(productCode, String(body.bomVersionId || ''), String(body.routingVersionId || ''), client)
    return { preview, data: this.workOrderData(body, preview) }
  }

  private workOrderData(body: WorkOrderBody, preview: WorkOrderMasterSnapshot) {
    const plannedQuantity = Number(body.plannedQuantity)
    if (!Number.isInteger(plannedQuantity) || plannedQuantity <= 0) throw new BadRequestException('计划件数必须为大于 0 的整数')
    const plannedStartDate = dateOnly(body.plannedStartDate, false)
    const plannedDeliveryDate = dateOnly(body.plannedDeliveryDate, true)!
    return {
      productCode: preview.productCode,
      productCodeSnapshot: preview.productCode,
      productNameSnapshot: preview.productName,
      bomVersionId: preview.bomVersionId,
      bomCodeSnapshot: preview.bomCode,
      bomVersionSnapshot: preview.bomVersion,
      routingVersionId: preview.routingVersionId,
      routingCodeSnapshot: preview.routingCode,
      routingNameSnapshot: preview.routingName,
      routingVersionSnapshot: preview.routingVersion,
      materialGradeCode: preview.materialGradeCode,
      materialGradeNameSnapshot: preview.materialGradeName,
      plannedQuantity,
      plannedStartDate,
      plannedDeliveryDate,
      priority: String(body.priority || 'NORMAL').trim() || 'NORMAL',
      unitNetWeightKg: preview.unitNetWeightKg,
      unitGrossWeightKg: preview.unitGrossWeightKg,
      yieldRate: preview.yieldRate,
      unitReturnWeightKg: preview.unitReturnWeightKg,
      totalNetWeightKg: roundWeight(plannedQuantity * preview.unitNetWeightKg),
      totalMeltWeightKg: roundWeight(plannedQuantity * preview.unitGrossWeightKg),
      expectedReturnWeightKg: roundWeight(plannedQuantity * preview.unitReturnWeightKg),
      remark: String(body.remark || '').trim() || null,
    }
  }

  private async lockRequestedBom(tx: Prisma.TransactionClient, body: WorkOrderBody) {
    const requestedBomVersionId = String(body.bomVersionId || '').trim()
    const productCode = String(body.productCode || '').trim()
    const identity = requestedBomVersionId
      ? await tx.castingBomVersion.findUnique({ where: { id: requestedBomVersionId }, select: { id: true, bomId: true } })
      : await tx.castingBomVersion.findFirst({
          where: { status: 'ACTIVE', bom: { productCode } },
          select: { id: true, bomId: true },
          orderBy: { updatedAt: 'desc' },
        })
    if (!identity) return null
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casting-bom:${identity.bomId}`}))`
    return identity.id
  }

  private async nextCode(tx: Prisma.TransactionClient, type: 'WORK_ORDER' | 'HEAT_ORDER') {
    const business = currentBusinessDate()
    const prefix = type === 'WORK_ORDER' ? `WO${business.key}` : `HEAT-${business.key}-`
    const documents = type === 'WORK_ORDER'
      ? await tx.workOrder.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
      : await tx.heatOrder.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
    const currentDocumentValue = documents.reduce((max, document) => {
      const value = Number(document.code.slice(prefix.length))
      return Number.isInteger(value) ? Math.max(max, value) : max
    }, 0)
    const [sequence] = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "DocumentSequence" ("documentType", "businessDate", "currentValue", "updatedAt")
      VALUES (${type}, ${business.date}, ${currentDocumentValue + 1}, CURRENT_TIMESTAMP)
      ON CONFLICT ("documentType", "businessDate") DO UPDATE
      SET "currentValue" = GREATEST(
        "DocumentSequence"."currentValue" + 1,
        EXCLUDED."currentValue"
      ),
      "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "currentValue"
    `)
    return `${prefix}${String(sequence.currentValue).padStart(type === 'WORK_ORDER' ? 3 : 2, '0')}`
  }

  async createWorkOrder(request: RequestWithAdmin, body: WorkOrderBody) {
    const user = getAdminContext(request)
    const id = await this.prisma.$transaction(async (tx) => {
      const lockedBomVersionId = await this.lockRequestedBom(tx, body)
      const prepared = await this.preparedWorkOrder({ ...body, bomVersionId: String(body.bomVersionId || '').trim() || lockedBomVersionId || undefined }, tx)
      const code = await this.nextCode(tx, 'WORK_ORDER')
      const record = await tx.workOrder.create({ data: { code, ...prepared.data, createdByUserId: user.id } })
      await tx.businessDataOwnership.create({
        data: {
          entityType: 'production:work-orders',
          entityId: record.id,
          createdByUserId: user.id,
          createdByDepartmentId: user.departmentId,
          ownerUserId: user.id,
          ownerDepartmentId: user.departmentId,
        },
      })
      return record.id
    })
    return this.workOrderDto(await this.findWorkOrder(id))
  }

  async listWorkOrders(request: RequestWithAdmin, keyword?: string, status?: string) {
    const ids = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:work-orders')
    if (ids?.length === 0) return []
    const records = await this.prisma.workOrder.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(keyword ? { OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { productCodeSnapshot: { contains: keyword, mode: 'insensitive' } }, { productNameSnapshot: { contains: keyword, mode: 'insensitive' } }] } : {}),
        ...(status && status !== 'ALL' ? { OR: [{ scheduleStatus: status as WorkOrderScheduleStatus }, { productionStatus: status as WorkOrderProductionStatus }] } : {}),
      },
      include: this.workOrderInclude(),
      orderBy: { createdAt: 'desc' },
    })
    return records.map((record) => this.workOrderDto(record))
  }

  async getWorkOrder(request: RequestWithAdmin, id: string) {
    await this.assertVisible(request, id)
    return this.workOrderDto(await this.findWorkOrder(id))
  }

  async updateWorkOrder(request: RequestWithAdmin, id: string, body: WorkOrderBody) {
    await this.assertVisible(request, id)
    const versionNo = Number(body.versionNo)
    if (!Number.isInteger(versionNo)) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
    await this.prisma.$transaction(async (tx) => {
      await this.lockWorkOrder(tx, id)
      const current = await tx.workOrder.findUnique({
        where: { id },
        select: {
          productCode: true,
          productNameSnapshot: true,
          bomVersionId: true,
          bomCodeSnapshot: true,
          bomVersionSnapshot: true,
          routingVersionId: true,
          routingCodeSnapshot: true,
          routingNameSnapshot: true,
          routingVersionSnapshot: true,
          materialGradeCode: true,
          materialGradeNameSnapshot: true,
          unitNetWeightKg: true,
          unitGrossWeightKg: true,
          yieldRate: true,
          unitReturnWeightKg: true,
          plannedQuantity: true,
          _count: { select: { coreTasks: true } },
        },
      })
      if (!current) throw new NotFoundException('生产工单不存在')
      const keepsLockedMasterData = String(body.productCode || '').trim() === current.productCode
        && String(body.bomVersionId || '').trim() === current.bomVersionId
        && String(body.routingVersionId || '').trim() === current.routingVersionId
      const prepared = keepsLockedMasterData
        ? {
            data: this.workOrderData(body, {
              productCode: current.productCode,
              productName: current.productNameSnapshot,
              bomVersionId: current.bomVersionId,
              bomCode: current.bomCodeSnapshot,
              bomVersion: current.bomVersionSnapshot,
              routingVersionId: current.routingVersionId,
              routingCode: current.routingCodeSnapshot,
              routingName: current.routingNameSnapshot,
              routingVersion: current.routingVersionSnapshot,
              materialGradeCode: current.materialGradeCode,
              materialGradeName: current.materialGradeNameSnapshot,
              unitNetWeightKg: decimal(current.unitNetWeightKg),
              unitGrossWeightKg: decimal(current.unitGrossWeightKg),
              yieldRate: decimal(current.yieldRate),
              unitReturnWeightKg: decimal(current.unitReturnWeightKg),
            }),
          }
        : await (async () => {
            const lockedBomVersionId = await this.lockRequestedBom(tx, body)
            return this.preparedWorkOrder({ ...body, bomVersionId: String(body.bomVersionId || '').trim() || lockedBomVersionId || undefined }, tx)
          })()
      const activeAllocations = await tx.heatOrderAllocation.count({
        where: { workOrderId: id, heatOrder: { status: { not: 'CANCELED' } } },
      })
      if (activeAllocations) throw new BadRequestException('工单已产生炉次分配，请先撤销待生产炉次')
      const structuralChanges = [
        current.productCode !== prepared.data.productCode ? '产品' : '',
        current.bomVersionId !== prepared.data.bomVersionId ? 'BOM 版本' : '',
        current.routingVersionId !== prepared.data.routingVersionId ? '工艺路线' : '',
        current.plannedQuantity !== prepared.data.plannedQuantity ? '计划数量' : '',
      ].filter(Boolean)
      if (current._count.coreTasks > 0 && structuralChanges.length) {
        throw new BadRequestException(`工单已生成制芯任务，不能修改${structuralChanges.join('、')}`)
      }
      const updateData = current._count.coreTasks > 0
        ? {
            plannedStartDate: prepared.data.plannedStartDate,
            plannedDeliveryDate: prepared.data.plannedDeliveryDate,
            priority: prepared.data.priority,
            remark: prepared.data.remark,
          }
        : { ...prepared.data, scheduledQuantity: 0, scheduleStatus: 'PENDING' as const }
      const result = await tx.workOrder.updateMany({
        where: { id, versionNo, productionStatus: 'RELEASED' },
        data: { ...updateData, versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('数据已被其他用户更新，请刷新后重试')
    })
    return this.workOrderDto(await this.findWorkOrder(id))
  }

  async closeWorkOrder(request: RequestWithAdmin, id: string, versionNo: number, reason: string) {
    await this.assertVisible(request, id)
    if (!reason.trim()) throw new BadRequestException('请填写关闭原因')
    await this.prisma.$transaction(async (tx) => {
      await this.lockWorkOrder(tx, id)
      const activeCoreTaskCount = await tx.coreProductionTask.count({
        where: { workOrderId: id, status: { notIn: ['COMPLETED', 'CANCELED'] } },
      })
      if (activeCoreTaskCount) throw new BadRequestException('请先完成或取消该工单的制芯任务')
      const activeHeatCount = await tx.heatOrderAllocation.count({
        where: { workOrderId: id, heatOrder: { status: { in: ['WAITING', 'IN_PROGRESS', 'TRANSFERRING'] } } },
      })
      if (activeHeatCount) throw new BadRequestException('请先撤销待生产炉次，生产中炉次不能关闭')
      const result = await tx.workOrder.updateMany({
        where: { id, versionNo, productionStatus: { notIn: ['CLOSED', 'COMPLETED'] } },
        data: { productionStatus: 'CLOSED', closedAt: new Date(), closeReason: reason.trim(), versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('数据已被其他用户更新，请刷新后重试')
    })
    return this.workOrderDto(await this.findWorkOrder(id))
  }

  async meltPool(request: RequestWithAdmin) {
    const records = (await this.listWorkOrders(request)).filter((order) => order.productionStatus !== 'CLOSED' && order.remainingQuantity > 0)
    const groups = new Map<string, { materialGradeCode: string; materialGradeName: string; remainingWeightKg: number; orders: any[] }>()
    for (const order of records) {
      const group: { materialGradeCode: string; materialGradeName: string; remainingWeightKg: number; orders: any[] } = groups.get(order.materialGradeCode) || {
        materialGradeCode: order.materialGradeCode,
        materialGradeName: order.materialGradeName,
        remainingWeightKg: 0,
        orders: [],
      }
      group.orders.push(order)
      group.remainingWeightKg = roundWeight(group.remainingWeightKg + order.remainingWeightKg)
      groups.set(order.materialGradeCode, group)
    }
    return { groups: Array.from(groups.values()).sort((a, b) => a.materialGradeCode.localeCompare(b.materialGradeCode)) }
  }

  async meltPoolOptions(materialGradeCode: string) {
    if (!materialGradeCode) throw new BadRequestException('请选择材质牌号')
    const recipes = await this.prisma.meltRecipe.findMany({
      where: { materialGradeCode, status: 'ACTIVE' },
      include: {
        applicableFurnaces: {
          where: { furnace: { status: '启用', equipmentType: '熔炼炉' } },
          include: { furnace: { include: { workshop: true } } },
        },
      },
      orderBy: { code: 'asc' },
    })
    const furnaceMap = new Map<string, MeltPoolFurnaceOption>()
    for (const recipe of recipes) {
      for (const link of recipe.applicableFurnaces) {
        const furnace = link.furnace
        if (furnace.capacity === null || !furnace.capacityUnit) continue
        try {
          furnaceMap.set(furnace.code, {
            code: furnace.code,
            name: furnace.name,
            workshopCode: furnace.workshopCode || '',
            workshopName: furnace.workshop?.name || '',
            capacity: decimal(furnace.capacity),
            capacityUnit: furnace.capacityUnit,
            capacityKg: capacityToKg(decimal(furnace.capacity), furnace.capacityUnit),
          })
        } catch (error) {
          if (!(error instanceof CapacityConfigurationError)) throw error
        }
      }
    }
    const workshopCodes = Array.from(furnaceMap.values()).map((furnace) => furnace.workshopCode).filter(Boolean)
    const teams = await this.prisma.team.findMany({
      where: { status: '启用', workshopCode: { in: workshopCodes } },
      include: { workshop: true },
      orderBy: { code: 'asc' },
    })
    return {
      recipes: recipes.map((recipe) => ({
        code: recipe.code,
        name: recipe.name,
        version: recipe.version,
        furnaceCodes: recipe.applicableFurnaces.map((link) => link.furnaceCode).filter((code) => furnaceMap.has(code)),
        meltingDurationMinutes: recipe.meltingDurationMinutes,
        transferDurationMinutes: recipe.transferDurationMinutes,
        cleaningDurationMinutes: recipe.cleaningDurationMinutes,
        occupancyDurationMinutes: recipe.meltingDurationMinutes + recipe.transferDurationMinutes + recipe.cleaningDurationMinutes,
        durationConfigured: recipe.meltingDurationMinutes + recipe.transferDurationMinutes + recipe.cleaningDurationMinutes > 0,
      })),
      workshops: Array.from(new Map(Array.from(furnaceMap.values()).filter((item) => item.workshopCode).map((item) => [item.workshopCode, { code: item.workshopCode, name: item.workshopName }])).values()).sort((a, b) => a.code.localeCompare(b.code)),
      furnaces: Array.from(furnaceMap.values()).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
      teams: teams.map((team) => ({ code: team.code, name: team.name, workshopCode: team.workshopCode, workshopName: team.workshop.name })),
      unavailableReason: furnaceMap.size
        ? ''
        : '当前材质暂无可用熔炼设备，请检查已生效配方和设备容量配置',
    }
  }

  private async heatConflicts(client: Prisma.TransactionClient | PrismaService, body: HeatConflictBody, excludeHeatOrderId?: string) {
    const furnaceCode = String(body.furnaceCode || '').trim()
    const plannedStartAt = dateTime(body.plannedStartAt, '计划开始时间')
    const plannedFinishAt = dateTime(body.plannedFinishAt, '预计完成时间')
    if (!furnaceCode) throw new BadRequestException('请选择目标熔炼设备')
    if (plannedFinishAt <= plannedStartAt) throw new BadRequestException('预计完成时间必须晚于计划开始时间')
    const timeFilters: Prisma.HeatOrderWhereInput[] = [
      { plannedStartAt: { lt: plannedFinishAt }, plannedFinishAt: { gt: plannedStartAt } },
    ]
    const now = new Date()
    if (plannedStartAt < now) {
      timeFilters.push({ status: { in: ['IN_PROGRESS', 'TRANSFERRING'] }, plannedStartAt: { lt: plannedFinishAt }, plannedFinishAt: { lte: now } })
    }
    const records = await client.heatOrder.findMany({
      where: {
        id: excludeHeatOrderId ? { not: excludeHeatOrderId } : undefined,
        AND: [
          {
            OR: [
              { status: 'WAITING', furnaceCode },
              { status: { in: ['IN_PROGRESS', 'TRANSFERRING'] }, OR: [{ actualFurnaceCode: furnaceCode }, { actualFurnaceCode: null, furnaceCode }] },
            ],
          },
          { OR: timeFilters },
        ],
      },
      orderBy: [{ plannedStartAt: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, status: true, plannedStartAt: true, plannedFinishAt: true },
    })
    return records.map((record) => ({
      id: record.id,
      code: record.code,
      status: record.status,
      plannedStartAt: record.plannedStartAt!.toISOString(),
      plannedFinishAt: record.plannedFinishAt!.toISOString(),
    }))
  }

  private visibleHeatConflicts(conflicts: Array<Record<string, any>>, visibleIds: string[] | null) {
    if (visibleIds === null) return conflicts
    const visible = new Set(visibleIds)
    return conflicts.map((item) => visible.has(item.id)
      ? item
      : { id: '', code: '其他排程占用', status: 'OCCUPIED', plannedStartAt: '', plannedFinishAt: '' })
  }

  async checkHeatOrderConflicts(request: RequestWithAdmin, body: HeatConflictBody) {
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:heat-orders')
    return { conflicts: this.visibleHeatConflicts(await this.heatConflicts(this.prisma, body), visibleIds) }
  }

  async adjustHeatOrderSchedule(request: RequestWithAdmin, id: string, body: AdjustHeatScheduleBody) {
    await this.assertHeatAccess(request, id, false)
    const user = getAdminContext(request)
    const visibleHeatIds = await visibleOwnershipEntityIds(this.prisma, user, 'production:heat-orders')
    const versionNo = Number(body.versionNo)
    const furnaceCode = String(body.furnaceCode || '').trim()
    const plannedStartAt = dateTime(body.plannedStartAt, '计划开始时间')
    if (!Number.isInteger(versionNo)) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
    if (!furnaceCode) throw new BadRequestException('请选择目标熔炼设备')
    if (plannedStartAt.getUTCMinutes() % 15 !== 0 || plannedStartAt.getUTCSeconds() !== 0 || plannedStartAt.getUTCMilliseconds() !== 0) {
      throw new BadRequestException('计划开始时间必须按 15 分钟设置')
    }

    await this.transactionWithRetry(async (tx) => {
      const record = await tx.heatOrder.findUnique({
        where: { id },
        include: { recipe: { include: { applicableFurnaces: true } } },
      })
      if (!record) throw new NotFoundException('熔炼任务不存在')
      if (record.status !== 'WAITING' || record.versionNo !== versionNo) {
        throw new ConflictException('仅待生产炉次可以调整排程，或数据已被其他用户更新')
      }
      if (!record.plannedStartAt || !record.plannedFinishAt) throw new BadRequestException('炉次缺少有效的计划时间')
      const plannedDurationMs = record.plannedFinishAt.getTime() - record.plannedStartAt.getTime()
      if (plannedDurationMs <= 0) throw new BadRequestException('炉次原计划占用时长无效')

      const furnace = await tx.furnace.findFirst({ where: { code: furnaceCode, status: '启用' }, include: { workshop: true } })
      if (!furnace || furnace.equipmentType !== '熔炼炉' || furnace.capacity === null || !furnace.capacityUnit) {
        throw new BadRequestException('熔炼设备不存在或未配置能力')
      }
      if (!record.workshopCodeSnapshot || furnace.workshopCode !== record.workshopCodeSnapshot || furnace.workshop?.status !== '启用' || furnace.workshop.type !== '熔炼') {
        throw new BadRequestException('目标熔炼设备不属于炉次当前启用熔炼车间')
      }
      if (!record.recipe.applicableFurnaces.some((item) => item.furnaceCode === furnaceCode)) {
        throw new BadRequestException('目标设备不适用于当前配方')
      }
      let capacityKg: number
      try {
        capacityKg = capacityToKg(decimal(furnace.capacity), furnace.capacityUnit)
      } catch (error) {
        if (!(error instanceof CapacityConfigurationError)) throw error
        throw new BadRequestException(error.message)
      }
      if (decimal(record.targetWeightKg) > capacityKg) throw new BadRequestException('目标设备容量不足，无法承载当前炉次')

      const plannedFinishAt = new Date(plannedStartAt.getTime() + plannedDurationMs)
      const occupancyMinutes = record.occupancyDurationMinutesSnapshot || Math.round(plannedDurationMs / 60_000)
      const calculatedFinishAt = calculateFinishAt(plannedStartAt, occupancyMinutes)
      const conflicts = this.visibleHeatConflicts(await this.heatConflicts(tx, {
        furnaceCode,
        plannedStartAt: plannedStartAt.toISOString(),
        plannedFinishAt: plannedFinishAt.toISOString(),
      }, id), visibleHeatIds)
      if (conflicts.length && !body.confirmScheduleConflict) {
        throw new ConflictException({ message: '目标设备在调整后的时间段已有排程，请确认是否继续调整', conflictCode: 'HEAT_SCHEDULE_CONFLICT', data: { conflicts } })
      }

      const result = await tx.heatOrder.updateMany({
        where: { id, status: 'WAITING', versionNo },
        data: {
          furnaceCode,
          furnaceNameSnapshot: furnace.name,
          furnaceCapacityKgSnapshot: capacityKg,
          plannedStartAt,
          calculatedFinishAt,
          plannedFinishAt,
          plannedOutputAt: plannedFinishAt,
          finishTimeAdjusted: plannedFinishAt.getTime() !== calculatedFinishAt.getTime(),
          versionNo: { increment: 1 },
        },
      })
      if (!result.count) throw new ConflictException('炉次排程已被其他用户更新，请刷新后重试')
      await tx.heatOrderRecord.create({
        data: {
          heatOrderId: id,
          action: 'SCHEDULE_ADJUSTED',
          fromStatus: 'WAITING',
          toStatus: 'WAITING',
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
          remark: String(body.remark || '').trim() || null,
          payload: {
            fromFurnaceCode: record.furnaceCode,
            fromFurnaceName: record.furnaceNameSnapshot,
            toFurnaceCode: furnace.code,
            toFurnaceName: furnace.name,
            fromPlannedStartAt: record.plannedStartAt.toISOString(),
            fromPlannedFinishAt: record.plannedFinishAt.toISOString(),
            toPlannedStartAt: plannedStartAt.toISOString(),
            toPlannedFinishAt: plannedFinishAt.toISOString(),
            furnaceChanged: record.furnaceCode !== furnace.code,
            confirmedScheduleConflicts: conflicts,
          },
        },
      })
    })
    return this.getHeatOrder(request, id, false)
  }

  async equipmentScheduleWorkshops() {
    const workshops = await this.prisma.workshop.findMany({
      where: { status: '启用', type: '熔炼', furnaces: { some: { status: '启用', equipmentType: '熔炼炉' } } },
      include: { furnaces: { where: { status: '启用', equipmentType: '熔炼炉' }, orderBy: { code: 'asc' } } },
      orderBy: { code: 'asc' },
    })
    return workshops.flatMap((workshop) => {
      const hasValidFurnace = workshop.furnaces.some((furnace) => {
        try {
          return furnace.capacity !== null && Boolean(furnace.capacityUnit) && capacityToKg(decimal(furnace.capacity), furnace.capacityUnit!) > 0
        } catch {
          return false
        }
      })
      return hasValidFurnace ? [{ code: workshop.code, name: workshop.name }] : []
    })
  }

  async equipmentSchedule(request: RequestWithAdmin, workshopCode: string, date: string) {
    if (!workshopCode) throw new BadRequestException('请选择熔炼车间')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('日期格式必须为 YYYY-MM-DD')
    const windowStart = new Date(`${date}T00:00:00+08:00`)
    const windowFinish = new Date(`${date}T24:00:00+08:00`)
    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowFinish.getTime())) throw new BadRequestException('查询日期无效')
    const workshop = await this.prisma.workshop.findFirst({ where: { code: workshopCode, status: '启用', type: '熔炼' } })
    if (!workshop) throw new BadRequestException('熔炼车间不存在或未启用')
    const furnaceRecords = await this.prisma.furnace.findMany({ where: { workshopCode, status: '启用', equipmentType: '熔炼炉' }, orderBy: { code: 'asc' } })
    const furnaces = furnaceRecords.flatMap((furnace) => {
      try {
        if (furnace.capacity === null || !furnace.capacityUnit) return []
        return [{ ...furnace, capacityKg: capacityToKg(decimal(furnace.capacity), furnace.capacityUnit) }]
      } catch {
        return []
      }
    })
    const furnaceCodes = furnaces.map((furnace) => furnace.code)
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:heat-orders')
    const now = new Date()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now) === date
    const timeFilters: Prisma.HeatOrderWhereInput[] = [
      { plannedStartAt: { lt: windowFinish }, plannedFinishAt: { gt: windowStart } },
    ]
    if (today) timeFilters.push({ status: { in: ['IN_PROGRESS', 'TRANSFERRING'] } })
    const heats = furnaceCodes.length ? await this.prisma.heatOrder.findMany({
      where: {
        ...(visibleIds ? { id: { in: visibleIds } } : {}),
        status: { not: 'CANCELED' },
        AND: [
          {
            OR: [
              { status: 'WAITING', furnaceCode: { in: furnaceCodes } },
              { status: { not: 'WAITING' }, OR: [{ actualFurnaceCode: { in: furnaceCodes } }, { actualFurnaceCode: null, furnaceCode: { in: furnaceCodes } }] },
            ],
          },
          { OR: timeFilters },
        ],
      },
      include: { allocations: { include: { workOrder: true } }, recipe: { include: { applicableFurnaces: true } } },
      orderBy: [{ plannedStartAt: 'asc' }, { code: 'asc' }],
    }) : []
    const heatDto = (heat: typeof heats[number], capacityKg: number) => {
      const displayFinishAt = ['IN_PROGRESS', 'TRANSFERRING'].includes(heat.status) && now > heat.plannedFinishAt! ? now : heat.plannedFinishAt!
      const clipped = clipInterval(heat.plannedStartAt!, displayFinishAt, windowStart, windowFinish) || [windowStart, windowFinish]
      const targetWeightKg = decimal(heat.targetWeightKg)
      return {
        id: heat.id,
        code: heat.code,
        status: heat.status,
        versionNo: heat.versionNo,
        furnaceCode: heat.furnaceCode,
        materialGradeCode: heat.materialGradeCode,
        materialGradeName: heat.materialGradeNameSnapshot,
        recipeCode: heat.recipeCode,
        recipeName: heat.recipeNameSnapshot,
        compatibleFurnaceCodes: heat.recipe.applicableFurnaces.map((item) => item.furnaceCode),
        targetWeightKg,
        capacityUtilizationPercent: Math.round(targetWeightKg / capacityKg * 1000) / 10,
        plannedStartAt: heat.plannedStartAt!.toISOString(),
        plannedFinishAt: heat.plannedFinishAt!.toISOString(),
        visibleStartAt: clipped[0].toISOString(),
        visibleFinishAt: clipped[1].toISOString(),
        workOrders: heat.allocations.map((item) => ({ code: item.workOrder.code, plannedWeightKg: decimal(item.plannedWeightKg) })),
      }
    }
    return {
      workshop: { code: workshop.code, name: workshop.name },
      date,
      windowStart: windowStart.toISOString(),
      windowFinish: windowFinish.toISOString(),
      serverNow: now.toISOString(),
      isToday: today,
      devices: furnaces.map((furnace) => {
        const deviceHeats = heats.filter((heat) => (heat.status === 'WAITING' ? heat.furnaceCode : heat.actualFurnaceCode || heat.furnaceCode) === furnace.code)
        const conflictCodes = new Set<string>()
        const effectiveFinishAt = (heat: typeof deviceHeats[number]) => ['IN_PROGRESS', 'TRANSFERRING'].includes(heat.status) && now > heat.plannedFinishAt! ? now : heat.plannedFinishAt!
        for (let left = 0; left < deviceHeats.length; left += 1) {
          for (let right = left + 1; right < deviceHeats.length; right += 1) {
            if (deviceHeats[left].plannedStartAt! < effectiveFinishAt(deviceHeats[right]) && effectiveFinishAt(deviceHeats[left]) > deviceHeats[right].plannedStartAt!) {
              conflictCodes.add(deviceHeats[left].code)
              conflictCodes.add(deviceHeats[right].code)
            }
          }
        }
        const current = today
          ? deviceHeats.find((heat) => ['IN_PROGRESS', 'TRANSFERRING'].includes(heat.status))
            || deviceHeats.find((heat) => heat.status === 'WAITING' && heat.plannedStartAt! <= now && heat.plannedFinishAt! > now)
            || deviceHeats.find((heat) => heat.status === 'WAITING' && heat.plannedStartAt! > now)
          : deviceHeats[0]
        const baseStatus = today && ['IN_PROGRESS', 'TRANSFERRING'].includes(current?.status || '') ? current!.status : today && current ? 'WAITING' : !today && current ? 'SCHEDULED' : 'IDLE'
        return {
          code: furnace.code,
          name: furnace.name,
          capacity: decimal(furnace.capacity),
          capacityUnit: furnace.capacityUnit || '',
          capacityKg: furnace.capacityKg,
          status: baseStatus,
          hasConflict: conflictCodes.size > 0,
          conflictHeatCodes: Array.from(conflictCodes),
          summary: current ? heatDto(current, furnace.capacityKg) : null,
          heats: deviceHeats.map((heat) => heatDto(heat, furnace.capacityKg)),
        }
      }),
    }
  }

  private async transactionWithRetry<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (isSerializableConflict(error)) {
          if (attempt < 2) continue
          throw new ConflictException('排产数据已变化，请刷新后重试')
        }
        throw error
      }
    }
    throw new ConflictException('排产数据已变化，请刷新后重试')
  }

  private async recomputeWorkOrders(tx: Prisma.TransactionClient, workOrderIds: string[]) {
    const uniqueIds = Array.from(new Set(workOrderIds))
    for (const id of uniqueIds) {
      const order = await tx.workOrder.findUnique({
        where: { id },
        include: { allocations: { include: { heatOrder: true } } },
      })
      if (!order) continue
      const active = order.allocations.filter((allocation) => allocation.heatOrder.status !== 'CANCELED')
      const scheduledQuantity = active.reduce((sum, allocation) => sum + allocation.allocatedQuantity, 0)
      const meltCompletedQuantity = active
        .filter((allocation) => allocation.heatOrder.status === 'COMPLETED')
        .reduce((sum, allocation) => sum + allocation.allocatedQuantity, 0)
      const meltCompletedWeightKg = roundWeight(active
        .filter((allocation) => allocation.heatOrder.status === 'COMPLETED')
        .reduce((sum, allocation) => sum + decimal(allocation.actualWeightKg), 0))
      const scheduleStatus: WorkOrderScheduleStatus = scheduledQuantity === 0
        ? 'PENDING'
        : scheduledQuantity >= order.plannedQuantity
          ? 'FULL'
          : 'PARTIAL'
      let productionStatus = order.productionStatus
      let meltCompletedAt = order.meltCompletedAt
      if (productionStatus !== 'CLOSED' && productionStatus !== 'COMPLETED') {
        if (scheduledQuantity >= order.plannedQuantity && meltCompletedQuantity >= order.plannedQuantity) {
          productionStatus = 'MELT_COMPLETED'
          meltCompletedAt ||= new Date()
        } else if (active.some((allocation) => ['IN_PROGRESS', 'TRANSFERRING', 'COMPLETED'].includes(allocation.heatOrder.status))) {
          productionStatus = 'IN_PRODUCTION'
          meltCompletedAt = null
        } else {
          productionStatus = 'RELEASED'
          meltCompletedAt = null
        }
      }
      await tx.workOrder.update({
        where: { id },
        data: {
          scheduledQuantity,
          meltCompletedQuantity,
          meltCompletedWeightKg,
          scheduleStatus,
          productionStatus,
          meltCompletedAt,
          versionNo: { increment: 1 },
        },
      })
    }
  }

  async createHeatOrder(request: RequestWithAdmin, body: HeatOrderBody) {
    const user = getAdminContext(request)
    const allocations = Array.isArray(body.allocations) ? body.allocations : []
    if (!allocations.length) throw new BadRequestException('请至少选择一张生产工单')
    const workOrderIds = allocations.map((item) => String(item.workOrderId || '').trim())
    if (new Set(workOrderIds).size !== workOrderIds.length || workOrderIds.some((id) => !id)) throw new BadRequestException('工单分配明细重复或无效')
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, user, 'production:work-orders')
    if (visibleIds && workOrderIds.some((id) => !visibleIds.includes(id))) throw new BadRequestException('包含不可见的生产工单')
    const visibleHeatIds = await visibleOwnershipEntityIds(this.prisma, user, 'production:heat-orders')

    const heatId = await this.transactionWithRetry(async (tx) => {
      const orders = await tx.workOrder.findMany({ where: { id: { in: workOrderIds }, productionStatus: { not: 'CLOSED' } } })
      if (orders.length !== workOrderIds.length) throw new BadRequestException('生产工单不存在或已关闭')
      const orderById = new Map(orders.map((order) => [order.id, order]))
      const materialCodes = new Set(orders.map((order) => order.materialGradeCode))
      if (materialCodes.size !== 1) throw new BadRequestException('不同材质牌号禁止合炉')
      const materialGradeCode = orders[0].materialGradeCode
      if (body.materialGradeCode && body.materialGradeCode !== materialGradeCode) throw new BadRequestException('排产材质与工单材质不一致')

      const activeAllocations = await tx.heatOrderAllocation.groupBy({
        by: ['workOrderId'],
        where: { workOrderId: { in: workOrderIds }, heatOrder: { status: { not: 'CANCELED' } } },
        _sum: { allocatedQuantity: true },
      })
      const scheduledByOrder = new Map(activeAllocations.map((row) => [row.workOrderId, row._sum.allocatedQuantity || 0]))
      const preparedAllocations = allocations.map((allocation) => {
        const order = orderById.get(String(allocation.workOrderId))!
        const quantity = Number(allocation.quantity)
        const remaining = order.plannedQuantity - (scheduledByOrder.get(order.id) || 0)
        if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException('本炉分配件数必须为大于 0 的整数')
        if (quantity > remaining) throw new ConflictException(`${order.code} 分配件数超过剩余件数，请刷新排产池后重试`)
        return { workOrderId: order.id, allocatedQuantity: quantity, plannedWeightKg: allocationWeightKg(quantity, decimal(order.unitGrossWeightKg)) }
      })
      const targetWeightKg = roundWeight(preparedAllocations.reduce((sum, item) => sum + item.plannedWeightKg, 0))
      const workshopCode = String(body.workshopCode || '').trim()
      const furnaceCode = String(body.furnaceCode || '').trim()
      const recipeCode = String(body.recipeCode || '').trim()
      const teamCode = String(body.teamCode || '').trim()
      const [furnace, recipe, team, material] = await Promise.all([
        tx.furnace.findFirst({ where: { code: furnaceCode, status: '启用' }, include: { workshop: true } }),
        tx.meltRecipe.findFirst({ where: { code: recipeCode, status: 'ACTIVE', materialGradeCode }, include: { applicableFurnaces: true } }),
        tx.team.findFirst({ where: { code: teamCode, status: '启用' } }),
        tx.materialGrade.findUnique({ where: { code: materialGradeCode } }),
      ])
      if (!furnace || furnace.equipmentType !== '熔炼炉' || furnace.capacity === null || !furnace.capacityUnit) throw new BadRequestException('熔炼设备不存在或未配置能力')
      if (!workshopCode || furnace.workshopCode !== workshopCode || furnace.workshop?.status !== '启用' || furnace.workshop?.type !== '熔炼') {
        throw new BadRequestException('目标熔炼设备不属于所选启用熔炼车间')
      }
      if (!recipe || !recipe.applicableFurnaces.some((link) => link.furnaceCode === furnace.code)) throw new BadRequestException('配方与材质或熔炼设备不匹配')
      if (!team || !furnace.workshopCode || team.workshopCode !== furnace.workshopCode) throw new BadRequestException('执行班组必须属于设备所在车间')
      if (!material) throw new BadRequestException('材质牌号不存在')
      let occupancyDurationMinutes: number
      try {
        occupancyDurationMinutes = recipeOccupancyMinutes(recipe.meltingDurationMinutes, recipe.transferDurationMinutes, recipe.cleaningDurationMinutes)
      } catch {
        throw new BadRequestException('所选配方未维护有效的熔炼、转运和清炉时长')
      }
      let capacityKg: number
      try {
        capacityKg = capacityToKg(decimal(furnace.capacity), furnace.capacityUnit)
      } catch (error) {
        if (!(error instanceof CapacityConfigurationError)) throw error
        throw new BadRequestException(error.message)
      }
      if (targetWeightKg > capacityKg) {
        const excessKg = roundWeight(targetWeightKg - capacityKg)
        throw new BadRequestException(
          `${furnace.name} 单炉容量 capacityKg=${capacityKg} kg，目标重量 targetWeightKg=${targetWeightKg} kg，超出重量 excessKg=${excessKg} kg`,
        )
      }
      const plannedStartAt = dateTime(body.plannedStartAt, '计划开始时间')
      const calculatedFinishAt = calculateFinishAt(plannedStartAt, occupancyDurationMinutes)
      const plannedFinishAt = dateTime(body.plannedFinishAt, '预计完成时间')
      if (plannedFinishAt <= plannedStartAt) throw new BadRequestException('预计完成时间必须晚于计划开始时间')
      const conflicts = this.visibleHeatConflicts(await this.heatConflicts(tx, { furnaceCode, plannedStartAt: plannedStartAt.toISOString(), plannedFinishAt: plannedFinishAt.toISOString() }), visibleHeatIds)
      if (conflicts.length && !body.confirmScheduleConflict) {
        throw new ConflictException({ message: '目标设备在所选时间段已有排程，请确认是否继续下达', conflictCode: 'HEAT_SCHEDULE_CONFLICT', data: { conflicts } })
      }
      const shiftCode = String(body.shiftCode || '').trim() || null
      if (shiftCode && !(await tx.shiftMaster.count({ where: { code: shiftCode, status: '启用' } }))) throw new BadRequestException('班次不存在或已停用')

      const code = await this.nextCode(tx, 'HEAT_ORDER')
      const heat = await tx.heatOrder.create({
        data: {
          code,
          materialGradeCode,
          materialGradeNameSnapshot: material.name,
          furnaceCode,
          furnaceNameSnapshot: furnace.name,
          furnaceCapacityKgSnapshot: capacityKg,
          workshopCodeSnapshot: furnace.workshopCode,
          workshopNameSnapshot: furnace.workshop.name,
          recipeCode,
          recipeNameSnapshot: recipe.name,
          recipeVersionSnapshot: recipe.version,
          teamCode,
          teamNameSnapshot: team.name,
          shiftCode,
          plannedOutputAt: plannedFinishAt,
          plannedStartAt,
          calculatedFinishAt,
          plannedFinishAt,
          meltingDurationMinutesSnapshot: recipe.meltingDurationMinutes,
          transferDurationMinutesSnapshot: recipe.transferDurationMinutes,
          cleaningDurationMinutesSnapshot: recipe.cleaningDurationMinutes,
          occupancyDurationMinutesSnapshot: occupancyDurationMinutes,
          finishTimeAdjusted: plannedFinishAt.getTime() !== calculatedFinishAt.getTime(),
          targetWeightKg,
          createdByUserId: user.id,
          allocations: { create: preparedAllocations },
          records: {
            create: {
              action: 'CREATED',
              toStatus: 'WAITING',
              operatorUserId: user.id,
              operatorNameSnapshot: user.name,
              payload: { targetWeightKg, allocationCount: preparedAllocations.length, confirmedScheduleConflicts: conflicts },
            },
          },
        },
      })
      await tx.businessDataOwnership.create({
        data: {
          entityType: 'production:heat-orders',
          entityId: heat.id,
          createdByUserId: user.id,
          createdByDepartmentId: user.departmentId,
          ownerUserId: user.id,
          ownerDepartmentId: user.departmentId,
        },
      })
      await this.recomputeWorkOrders(tx, workOrderIds)
      return heat.id
    })
    return this.getHeatOrder(request, heatId, false)
  }

  private async findHeatOrder(id: string) {
    const record = await this.prisma.heatOrder.findUnique({ where: { id }, include: this.heatOrderInclude() })
    if (!record) throw new NotFoundException('熔炼任务不存在')
    return record
  }

  private async assertHeatAccess(request: RequestWithAdmin, id: string, mobile: boolean) {
    const user = getAdminContext(request)
    if (user.username === 'admin' || user.userType === 'SUPER_ADMIN') return
    if (mobile) {
      const membership = await this.prisma.heatOrder.count({ where: { id, team: { members: { some: { userId: user.id } } } } })
      if (!membership) throw new NotFoundException('熔炼任务不存在')
      return
    }
    const ids = await visibleOwnershipEntityIds(this.prisma, user, 'production:heat-orders')
    if (ids !== null && !ids.includes(id)) throw new NotFoundException('熔炼任务不存在')
  }

  async listHeatOrders(request: RequestWithAdmin, status?: string, mobile = false) {
    const user = getAdminContext(request)
    const visibleIds = mobile
      ? null
      : await visibleOwnershipEntityIds(this.prisma, user, 'production:heat-orders')
    if (!mobile && visibleIds?.length === 0) return []
    const records = await this.prisma.heatOrder.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status: status as any } : {}),
        ...(mobile && user.username !== 'admin' && user.userType !== 'SUPER_ADMIN' ? { team: { members: { some: { userId: user.id } } } } : {}),
        ...(!mobile && visibleIds ? { id: { in: visibleIds } } : {}),
      },
      include: this.heatOrderInclude(),
      orderBy: [{ plannedOutputAt: 'desc' }, { createdAt: 'desc' }],
    })
    return records.map((record) => this.heatOrderDto(record, user, mobile))
  }

  async getHeatOrder(request: RequestWithAdmin, id: string, mobile: boolean) {
    await this.assertHeatAccess(request, id, mobile)
    return this.heatOrderDto(await this.findHeatOrder(id), getAdminContext(request), mobile)
  }

  async cancelHeatOrder(request: RequestWithAdmin, id: string, body: VersionedActionBody) {
    await this.assertHeatAccess(request, id, false)
    const user = getAdminContext(request)
    const versionNo = Number(body.versionNo)
    const reason = String(body.remark || '').trim()
    if (!Number.isInteger(versionNo)) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
    if (!reason) throw new BadRequestException('请填写撤销原因')
    await this.transactionWithRetry(async (tx) => {
      const record = await tx.heatOrder.findUnique({ where: { id }, include: { allocations: true } })
      if (!record) throw new NotFoundException('熔炼任务不存在')
      const result = await tx.heatOrder.updateMany({
        where: { id, status: 'WAITING', versionNo },
        data: { status: 'CANCELED', canceledByUserId: user.id, canceledAt: new Date(), cancelReason: reason, versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('仅待生产炉次可以撤销，或数据已被其他用户更新')
      await tx.heatOrderRecord.create({ data: { heatOrderId: id, action: 'CANCELED', fromStatus: 'WAITING', toStatus: 'CANCELED', operatorUserId: user.id, operatorNameSnapshot: user.name, remark: reason } })
      await this.recomputeWorkOrders(tx, record.allocations.map((item) => item.workOrderId))
    })
    return this.getHeatOrder(request, id, false)
  }

  private async assertTeamOperator(user: AdminContext, heatOrderId: string) {
    const context = await this.prisma.heatOrder.findUnique({
      where: { id: heatOrderId },
      select: {
        workshopCodeSnapshot: true,
        team: { select: { status: true, workshopCode: true, workshop: { select: { status: true, type: true } }, members: { where: { userId: user.id }, select: { userId: true } } } },
      },
    })
    if (!context
      || context.team.status !== '启用'
      || context.team.workshop.status !== '启用'
      || context.team.workshop.type !== '熔炼'
      || context.team.workshopCode !== context.workshopCodeSnapshot) {
      throw new BadRequestException('执行班组或熔炼车间已停用或归属已变化，请重新排产')
    }
    if (user.username === 'admin' || user.userType === 'SUPER_ADMIN') return
    if (!context.team.members.length) throw new NotFoundException('熔炼任务不存在')
  }

  private compatibleFurnace(record: any, furnace: any) {
    if (!furnace || furnace.status !== '启用' || furnace.equipmentType !== '熔炼炉') return false
    if (!record.workshopCodeSnapshot || furnace.workshopCode !== record.workshopCodeSnapshot) return false
    if (furnace.workshop && (furnace.workshop.status !== '启用' || furnace.workshop.type !== '熔炼')) return false
    if (furnace.capacity === null || !furnace.capacityUnit) return false
    try {
      return capacityToKg(decimal(furnace.capacity), furnace.capacityUnit) >= decimal(record.targetWeightKg)
    } catch {
      return false
    }
  }

  async heatExecutionOptions(request: RequestWithAdmin, id: string, mobile: boolean) {
    await this.assertHeatAccess(request, id, mobile)
    const user = getAdminContext(request)
    await this.assertTeamOperator(user, id)
    const record = await this.prisma.heatOrder.findUnique({
      where: { id },
      include: { recipe: { include: { applicableFurnaces: true } }, transfers: true },
    })
    if (!record) throw new NotFoundException('熔炼任务不存在')
    const targetWeightKg = decimal(record.targetWeightKg)
    const transferTotalWeightKg = roundWeight(record.transfers.reduce((sum, item) => sum + decimal(item.weightKg), 0))
    const remainingTransferWeightKg = Math.max(0, roundWeight(targetWeightKg - transferTotalWeightKg))
    const recipeFurnaceCodes = record.recipe.applicableFurnaces.map((item) => item.furnaceCode)
    const [furnaces, activeHeats, transferDevices] = await Promise.all([
      this.prisma.furnace.findMany({
        where: { code: { in: recipeFurnaceCodes }, workshopCode: record.workshopCodeSnapshot || undefined, status: '启用', equipmentType: '熔炼炉' },
        include: { workshop: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.heatOrder.findMany({
        where: { id: { not: id }, status: { in: ['IN_PROGRESS', 'TRANSFERRING'] } },
        select: { actualFurnaceCode: true, furnaceCode: true },
      }),
      this.prisma.furnace.findMany({
        where: { workshopCode: record.workshopCodeSnapshot || undefined, status: '启用', equipmentType: { in: ['浇注包', '球化包'] } },
        orderBy: [{ equipmentType: 'asc' }, { code: 'asc' }],
      }),
    ])
    const occupied = new Set(activeHeats.map((item) => item.actualFurnaceCode || item.furnaceCode).filter(Boolean))
    return {
      plannedFurnaceCode: record.furnaceCode,
      plannedFurnaceName: record.furnaceNameSnapshot,
      actualFurnaceCode: record.actualFurnaceCode || '',
      targetWeightKg,
      transferTotalWeightKg,
      remainingTransferWeightKg,
      furnaces: furnaces.filter((item) => this.compatibleFurnace(record, item) && (!occupied.has(item.code) || item.code === record.actualFurnaceCode)).map((item) => ({
        code: item.code,
        name: item.name,
        equipmentType: item.equipmentType,
        capacity: item.capacity === null ? null : decimal(item.capacity),
        capacityUnit: item.capacityUnit || '',
        isPlanned: item.code === record.furnaceCode,
      })),
      transferDevices: transferDevices.map((item) => ({ code: item.code, name: item.name, equipmentType: item.equipmentType })),
    }
  }

  async startHeatOrder(request: RequestWithAdmin, id: string, body: StartHeatOrderBody, mobile: boolean) {
    await this.assertHeatAccess(request, id, mobile)
    const user = getAdminContext(request)
    await this.assertTeamOperator(user, id)
    const versionNo = Number(body.versionNo)
    const actualFurnaceCode = String(body.actualFurnaceCode || '').trim()
    if (!Number.isInteger(versionNo)) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
    if (!actualFurnaceCode) throw new BadRequestException('请选择实际熔炼设备')
    await this.transactionWithRetry(async (tx) => {
      const record = await tx.heatOrder.findUnique({ where: { id }, include: { allocations: true, recipe: { include: { applicableFurnaces: true } } } })
      if (!record) throw new NotFoundException('熔炼任务不存在')
      const furnace = await tx.furnace.findUnique({ where: { code: actualFurnaceCode }, include: { workshop: true } })
      if (!this.compatibleFurnace(record, furnace) || !record.recipe.applicableFurnaces.some((item) => item.furnaceCode === actualFurnaceCode)) {
        throw new BadRequestException('所选熔炼设备与车间、配方或目标重量不匹配')
      }
      const occupied = await tx.heatOrder.count({ where: {
        id: { not: id },
        status: { in: ['IN_PROGRESS', 'TRANSFERRING'] },
        OR: [{ actualFurnaceCode }, { actualFurnaceCode: null, furnaceCode: actualFurnaceCode }],
      } })
      if (occupied) throw new ConflictException('所选熔炼设备正在被其他炉次占用')
      if (actualFurnaceCode !== record.furnaceCode && !body.confirmFurnaceChange) {
        throw new ConflictException({
          message: `实际熔炉与计划熔炉不一致，是否改用 ${furnace!.name}？`,
          conflictCode: 'FURNACE_CHANGE_CONFIRMATION_REQUIRED',
          data: { plannedFurnaceCode: record.furnaceCode, actualFurnaceCode, actualFurnaceName: furnace!.name },
        })
      }
      const result = await tx.heatOrder.updateMany({
        where: { id, status: 'WAITING', versionNo },
        data: { status: 'IN_PROGRESS', actualFurnaceCode, actualFurnaceNameSnapshot: furnace!.name, startedByUserId: user.id, startedAt: new Date(), versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('仅待生产炉次可以开始，或数据已被其他用户更新')
      await tx.heatOrderRecord.create({ data: { heatOrderId: id, action: 'STARTED', fromStatus: 'WAITING', toStatus: 'IN_PROGRESS', operatorUserId: user.id, operatorNameSnapshot: user.name, remark: String(body.remark || '').trim() || null, payload: { plannedFurnaceCode: record.furnaceCode, actualFurnaceCode, furnaceChanged: actualFurnaceCode !== record.furnaceCode } } })
      await this.recomputeWorkOrders(tx, record.allocations.map((item) => item.workOrderId))
    })
    return this.getHeatOrder(request, id, mobile)
  }

  async transferHeatOrder(request: RequestWithAdmin, id: string, body: TransferHeatOrderBody, mobile: boolean) {
    await this.assertHeatAccess(request, id, mobile)
    const user = getAdminContext(request)
    await this.assertTeamOperator(user, id)
    const versionNo = Number(body.versionNo)
    const transferDeviceCode = String(body.transferDeviceCode || '').trim()
    const weightKg = Number(body.weightKg)
    const weightSource = body.weightSource === 'DEVICE' ? 'DEVICE' : 'MANUAL'
    if (!Number.isInteger(versionNo)) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
    if (!transferDeviceCode) throw new BadRequestException('请选择转运包设备')
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new BadRequestException('转运重量必须大于 0')
    await this.transactionWithRetry(async (tx) => {
      const record = await tx.heatOrder.findUnique({ where: { id }, include: { allocations: true, transfers: true } })
      if (!record) throw new NotFoundException('熔炼任务不存在')
      if (!['IN_PROGRESS', 'TRANSFERRING'].includes(record.status)) throw new ConflictException('仅熔炼中或转运中的炉次可以转运')
      const transferredWeightKg = roundWeight(record.transfers.reduce((sum, item) => sum + decimal(item.weightKg), 0))
      const remainingTransferWeightKg = Math.max(0, roundWeight(decimal(record.targetWeightKg) - transferredWeightKg))
      if (weightKg > remainingTransferWeightKg) {
        throw new BadRequestException(`本次转运重量不能超过剩余可转运数量 ${remainingTransferWeightKg} kg`)
      }
      const transferDevice = await tx.furnace.findFirst({ where: { code: transferDeviceCode, status: '启用', equipmentType: { in: ['浇注包', '球化包'] } } })
      if (!transferDevice || transferDevice.workshopCode !== record.workshopCodeSnapshot) throw new BadRequestException('转运包设备不存在、未启用或不属于当前车间')
      const result = await tx.heatOrder.updateMany({
        where: { id, status: { in: ['IN_PROGRESS', 'TRANSFERRING'] }, versionNo },
        data: { status: 'TRANSFERRING', versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('炉次状态或数据版本已变化，请刷新后重试')
      await tx.heatOrderTransfer.create({ data: {
        heatOrderId: id,
        transferDeviceCode,
        transferDeviceNameSnapshot: transferDevice.name,
        equipmentTypeSnapshot: transferDevice.equipmentType,
        weightKg,
        weightSource,
        operatorUserId: user.id,
        operatorNameSnapshot: user.name,
        remark: String(body.remark || '').trim() || null,
      } })
      await tx.heatOrderRecord.create({ data: {
        heatOrderId: id,
        action: 'TRANSFERRED',
        fromStatus: record.status,
        toStatus: 'TRANSFERRING',
        operatorUserId: user.id,
        operatorNameSnapshot: user.name,
        remark: String(body.remark || '').trim() || null,
        payload: { transferDeviceCode, transferDeviceName: transferDevice.name, equipmentType: transferDevice.equipmentType, weightKg, weightSource },
      } })
      await this.recomputeWorkOrders(tx, record.allocations.map((item) => item.workOrderId))
    })
    return this.getHeatOrder(request, id, mobile)
  }

  async completeHeatOrder(request: RequestWithAdmin, id: string, body: CompleteHeatOrderBody, mobile: boolean) {
    await this.assertHeatAccess(request, id, mobile)
    const user = getAdminContext(request)
    await this.assertTeamOperator(user, id)
    const versionNo = Number(body.versionNo)
    if (!Number.isInteger(versionNo)) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
    await this.transactionWithRetry(async (tx) => {
      const record = await tx.heatOrder.findUnique({ where: { id }, include: { allocations: true, transfers: true } })
      if (!record) throw new NotFoundException('熔炼任务不存在')
      const transferTotalWeightKg = roundWeight(record.transfers.reduce((sum, item) => sum + decimal(item.weightKg), 0))
      const actualOutputWeightKg = body.actualOutputWeightKg === undefined || body.actualOutputWeightKg === null
        ? transferTotalWeightKg
        : Number(body.actualOutputWeightKg)
      if (!Number.isFinite(actualOutputWeightKg) || actualOutputWeightKg <= 0) throw new BadRequestException('实际出炉重量必须大于 0')
      const result = await tx.heatOrder.updateMany({
        where: { id, status: 'TRANSFERRING', versionNo },
        data: { status: 'COMPLETED', actualOutputWeightKg, completedByUserId: user.id, completedAt: new Date(), versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('仅已发生转运的炉次可以完成，或数据已被其他用户更新')
      const allocated = allocateActualWeight(
        record.allocations.map((item) => ({ id: item.id, plannedWeightKg: decimal(item.plannedWeightKg) })),
        actualOutputWeightKg,
      )
      for (const item of allocated) await tx.heatOrderAllocation.update({ where: { id: item.id }, data: { actualWeightKg: item.actualWeightKg } })
      await tx.heatOrderRecord.create({
        data: {
          heatOrderId: id,
          action: 'COMPLETED',
          fromStatus: 'TRANSFERRING',
          toStatus: 'COMPLETED',
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
          remark: String(body.remark || '').trim() || null,
          payload: { actualOutputWeightKg, transferTotalWeightKg },
        },
      })
      await this.recomputeWorkOrders(tx, record.allocations.map((item) => item.workOrderId))
    })
    return this.getHeatOrder(request, id, mobile)
  }
}
