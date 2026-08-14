import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { CoreTaskStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAdminContext, hasAdminPermission, visibleOwnershipEntityIds, type AdminContext, type RequestWithAdmin } from '../shared/admin-context'
import { calculateCoreDemand, calculatePressCount } from './coremaking.calculations'
import type { CancelCoreTaskBody, CoreTaskInput, CoreTaskPreviewBody, CreateCoreTasksBody, DispatchCoreTaskBody } from './coremaking.types'

type DatabaseClient = PrismaService | Prisma.TransactionClient

function decimal(value: Prisma.Decimal | number | null | undefined) {
  return value === null || value === undefined ? null : Number(value)
}

function requiredVersion(value: unknown) {
  const versionNo = Number(value)
  if (!Number.isInteger(versionNo) || versionNo <= 0) throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
  return versionNo
}

function optionalDateTime(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return null
  const result = new Date(text)
  if (Number.isNaN(result.getTime())) throw new BadRequestException('计划开始时间格式不正确')
  return result
}

function businessDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    key: `${values.year}${values.month}${values.day}`,
    date: new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`),
  }
}

function isSerializableConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2034') return true
  return error.code === 'P2010' && String(error.meta?.code || '') === '40001'
}

function requestBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求体格式不正确')
  return value as Record<string, unknown>
}

function taskRows(value: unknown, required: boolean) {
  const body = requestBody(value)
  if (body.rows !== undefined && !Array.isArray(body.rows)) throw new BadRequestException('rows 必须为数组')
  const rows = (body.rows || []) as unknown[]
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new BadRequestException('rows 中的制芯任务必须为对象')
  }
  if (required && !rows.length) throw new BadRequestException('请选择需要生成的芯盒任务')
  return rows as CoreTaskInput[]
}

@Injectable()
export class CoremakingService {
  constructor(private readonly prisma: PrismaService) {}

  private taskInclude() {
    return {
      workOrder: { select: { id: true, code: true, productionStatus: true } },
      routingNode: { include: { operation: true, equipmentLinks: { include: { equipment: true } } } },
      coreBox: { include: { mold: true } },
      equipment: { include: { workshop: true } },
      team: { include: { workshop: true } },
      createdBy: { select: { id: true, name: true } },
      canceledBy: { select: { id: true, name: true } },
      _count: { select: { reports: true } },
    }
  }

  private workOrderInclude() {
    return {
      bomVersion: { include: { bom: true, coreBoxes: { include: { coreBox: { include: { mold: true } } } } } },
      routingVersion: {
        include: {
          routing: true,
          nodes: {
            include: { operation: true, equipmentLinks: { include: { equipment: { include: { workshop: true } } } } },
            orderBy: { seqNo: 'asc' as const },
          },
        },
      },
      coreTasks: { select: { id: true, coreBoxCode: true, status: true } },
    }
  }

  private async assertWorkOrderVisible(request: RequestWithAdmin, id: string) {
    const ids = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:work-orders')
    if (ids !== null && !ids.includes(id)) throw new NotFoundException('生产工单不存在')
  }

  private async assertTaskVisible(request: RequestWithAdmin, id: string) {
    const ids = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:core_tasks')
    if (ids !== null && !ids.includes(id)) throw new NotFoundException('制芯任务不存在')
  }

  private async loadWorkOrder(client: DatabaseClient, id: string) {
    const record = await client.workOrder.findUnique({ where: { id }, include: this.workOrderInclude() })
    if (!record) throw new NotFoundException('生产工单不存在')
    return record
  }

  private async lockWorkOrder(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "WorkOrder" WHERE "id" = ${id} FOR UPDATE
    `)
    if (!rows.length) throw new NotFoundException('生产工单不存在')
  }

  private coreNodes(workOrder: Awaited<ReturnType<CoremakingService['loadWorkOrder']>>) {
    return workOrder.routingVersion.nodes.filter((node) => node.operation.section === '制芯')
  }

  private expectedScrapRate(value: unknown) {
    const rate = value === null || value === undefined || value === '' ? 0 : Number(value)
    if (!Number.isFinite(rate) || rate < 0) throw new BadRequestException('预计废品率不能小于 0')
    return rate
  }

  private calculatedQuantities(workOrderQuantity: number, quantityPerProduct: Prisma.Decimal, cavityCount: number, expectedScrapRate: number) {
    try {
      const plannedQuantity = calculateCoreDemand(workOrderQuantity, Number(quantityPerProduct), expectedScrapRate)
      return { plannedQuantity, plannedPressCount: calculatePressCount(plannedQuantity, cavityCount) }
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '制芯计划数量计算失败')
    }
  }

  private previewRow(workOrder: Awaited<ReturnType<CoremakingService['loadWorkOrder']>>, item: any, input?: CoreTaskInput) {
    const expectedScrapRate = this.expectedScrapRate(input?.expectedScrapRate)
    const quantities = this.calculatedQuantities(
      workOrder.plannedQuantity,
      item.quantityPerProduct,
      item.coreBox.cavityCount,
      expectedScrapRate,
    )
    return {
      coreBoxCode: item.coreBoxCode,
      coreBoxName: item.coreBoxNameSnapshot || item.coreBox.name,
      moldCode: item.moldCodeSnapshot || item.coreBox.moldCode,
      moldName: item.coreBox.mold.name,
      quantityPerProduct: Number(item.quantityPerProduct),
      cavityCount: item.coreBox.cavityCount,
      shelfLifeHours: decimal(item.shelfLifeHours),
      expectedScrapRate,
      ...quantities,
    }
  }

  private validateGenerationContext(workOrder: Awaited<ReturnType<CoremakingService['loadWorkOrder']>>) {
    const nodes = this.coreNodes(workOrder)
    if (!nodes.length) throw new BadRequestException('该工单锁定的工艺路线无需制芯')
    if (!workOrder.bomVersion.coreBoxes.length) throw new BadRequestException('当前 BOM 未配置芯盒，无法生成制芯任务')
    if (['CLOSED', 'COMPLETED'].includes(workOrder.productionStatus)) throw new BadRequestException('已关闭或已完成工单不能生成制芯任务')
    return nodes
  }

  async previewTasks(request: RequestWithAdmin, workOrderId: string, body: CoreTaskPreviewBody | unknown) {
    await this.assertWorkOrderVisible(request, workOrderId)
    const inputs = taskRows(body, false)
    const workOrder = await this.loadWorkOrder(this.prisma, workOrderId)
    const nodes = this.validateGenerationContext(workOrder)
    const existingCodes = new Set(workOrder.coreTasks.map((task) => task.coreBoxCode))
    const inputByCode = new Map(inputs.map((row) => [String(row.coreBoxCode || '').trim(), row]))
    for (const row of inputs) {
      if (String(row.routingNodeId || '').trim()) await this.validateAssignment(this.prisma, workOrder, row)
    }
    const rows = workOrder.bomVersion.coreBoxes
      .filter((item) => !existingCodes.has(item.coreBoxCode))
      .map((item) => this.previewRow(workOrder, item, inputByCode.get(item.coreBoxCode)))
    return {
      workOrderId,
      workOrderCode: workOrder.code,
      requiresCoremaking: true,
      canGenerateCoreTasks: rows.length > 0,
      rows,
      routingNodes: nodes.map((node) => ({
        id: node.id,
        seqNo: node.seqNo,
        operationCode: node.operationCode,
        operationName: node.operation.name,
        equipment: node.equipmentLinks.map((link) => ({
          code: link.equipment.code,
          name: link.equipment.name,
          status: link.equipment.status,
          workshopCode: link.equipment.workshopCode || '',
          workshopName: link.equipment.workshop?.name || '',
        })),
      })),
    }
  }

  private async validateAssignment(client: DatabaseClient, workOrder: Awaited<ReturnType<CoremakingService['loadWorkOrder']>>, input: CoreTaskInput) {
    const routingNodeId = String(input.routingNodeId || '').trim()
    if (!routingNodeId) throw new BadRequestException('请选择制芯工序节点')
    const node = workOrder.routingVersion.nodes.find((item) => item.id === routingNodeId)
    if (!node || node.operation.section !== '制芯') throw new BadRequestException('所选节点不属于工单锁定路线的制芯工序')
    if (!node.equipmentLinks.some((item) => item.equipment.status === '启用')) {
      throw new BadRequestException('所选制芯工序节点未绑定启用设备')
    }

    const equipmentCode = String(input.equipmentCode || '').trim() || null
    const teamCode = String(input.teamCode || '').trim() || null
    const plannedStartAt = optionalDateTime(input.plannedStartAt)
    let equipment: any = null
    let team: any = null

    if (equipmentCode) {
      const link = node.equipmentLinks.find((item) => item.equipmentCode === equipmentCode)
      if (!link) throw new BadRequestException('所选设备未绑定当前制芯工序节点')
      equipment = link.equipment
      if (equipment.status !== '启用') throw new BadRequestException('所选制芯设备已停用')
    }
    if (teamCode) {
      if (!equipment) throw new BadRequestException('选择班组前请先选择制芯设备')
      team = await client.team.findUnique({ where: { code: teamCode }, include: { workshop: true } })
      if (!team || team.status !== '启用') throw new BadRequestException('所选班组不存在或已停用')
      if (!equipment.workshopCode || team.workshopCode !== equipment.workshopCode) {
        throw new BadRequestException('所选班组与制芯设备不属于同一车间')
      }
    }
    return { node, equipment, team, equipmentCode, teamCode, plannedStartAt }
  }

  private async nextTaskCode(tx: Prisma.TransactionClient) {
    const current = businessDate()
    const [sequence] = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "DocumentSequence" ("documentType", "businessDate", "currentValue", "updatedAt")
      VALUES ('CORE_TASK', ${current.date}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("documentType", "businessDate") DO UPDATE
      SET "currentValue" = "DocumentSequence"."currentValue" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "currentValue"
    `)
    return `CORE-${current.key}-${String(sequence.currentValue).padStart(3, '0')}`
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (isSerializableConflict(error)) {
          if (attempt < 2) continue
          throw new ConflictException('数据并发冲突，请重试')
        }
        throw error
      }
    }
    throw new ConflictException('并发生成制芯任务失败，请重试')
  }

  async createTasks(request: RequestWithAdmin, workOrderId: string, body: CreateCoreTasksBody | unknown) {
    await this.assertWorkOrderVisible(request, workOrderId)
    const rows = taskRows(body, true)
    const coreBoxCodes = rows.map((row) => String(row.coreBoxCode || '').trim())
    if (coreBoxCodes.some((code) => !code)) throw new BadRequestException('制芯任务缺少芯盒编码')
    if (new Set(coreBoxCodes).size !== coreBoxCodes.length) throw new BadRequestException('同一芯盒不能重复提交')
    const user = getAdminContext(request)

    try {
      const ids = await this.serializable(async (tx) => {
        await this.lockWorkOrder(tx, workOrderId)
        const workOrder = await this.loadWorkOrder(tx, workOrderId)
        this.validateGenerationContext(workOrder)
        const existing = await tx.coreProductionTask.findMany({ where: { workOrderId, coreBoxCode: { in: coreBoxCodes } }, select: { coreBoxCode: true } })
        if (existing.length) throw new ConflictException(`芯盒 ${existing.map((item) => item.coreBoxCode).join('、')} 已生成任务，不能重复生成`)
        const bomItems = new Map(workOrder.bomVersion.coreBoxes.map((item) => [item.coreBoxCode, item]))
        const createdIds: string[] = []
        for (const row of rows) {
          const coreBoxCode = String(row.coreBoxCode).trim()
          const item = bomItems.get(coreBoxCode)
          if (!item) throw new BadRequestException(`芯盒 ${coreBoxCode} 不属于工单锁定 BOM`)
          const assignment = await this.validateAssignment(tx, workOrder, row)
          const expectedScrapRate = this.expectedScrapRate(row.expectedScrapRate)
          const quantities = this.calculatedQuantities(workOrder.plannedQuantity, item.quantityPerProduct, item.coreBox.cavityCount, expectedScrapRate)
          const fullyDispatched = Boolean(assignment.equipmentCode && assignment.teamCode && assignment.plannedStartAt)
          const record = await tx.coreProductionTask.create({
            data: {
              code: await this.nextTaskCode(tx),
              workOrderId,
              bomVersionId: workOrder.bomVersionId,
              routingNodeId: assignment.node.id,
              coreBoxCode,
              productCodeSnapshot: workOrder.productCodeSnapshot,
              productNameSnapshot: workOrder.productNameSnapshot,
              workOrderCodeSnapshot: workOrder.code,
              bomCodeSnapshot: workOrder.bomCodeSnapshot,
              bomVersionSnapshot: workOrder.bomVersionSnapshot,
              routingCodeSnapshot: workOrder.routingCodeSnapshot,
              routingVersionSnapshot: workOrder.routingVersionSnapshot,
              operationCodeSnapshot: assignment.node.operationCode,
              operationNameSnapshot: assignment.node.operation.name,
              coreBoxNameSnapshot: item.coreBoxNameSnapshot || item.coreBox.name,
              moldCodeSnapshot: item.moldCodeSnapshot || item.coreBox.moldCode,
              moldNameSnapshot: item.coreBox.mold.name,
              quantityPerProductSnapshot: item.quantityPerProduct,
              cavityCountSnapshot: item.coreBox.cavityCount,
              shelfLifeHoursSnapshot: item.shelfLifeHours,
              expectedScrapRate,
              ...quantities,
              equipmentCode: assignment.equipmentCode,
              equipmentNameSnapshot: assignment.equipment?.name || null,
              teamCode: assignment.teamCode,
              teamNameSnapshot: assignment.team?.name || null,
              plannedStartAt: assignment.plannedStartAt,
              status: fullyDispatched ? 'WAITING' : 'PENDING_DISPATCH',
              remark: String(row.remark || '').trim() || null,
              createdByUserId: user.id,
            },
          })
          await tx.businessDataOwnership.create({
            data: {
              entityType: 'production:core_tasks', entityId: record.id,
              createdByUserId: user.id, createdByDepartmentId: user.departmentId,
              ownerUserId: user.id, ownerDepartmentId: user.departmentId,
            },
          })
          createdIds.push(record.id)
        }
        return createdIds
      })
      const records = await this.prisma.coreProductionTask.findMany({ where: { id: { in: ids } }, include: this.taskInclude(), orderBy: { code: 'asc' } })
      return records.map((record) => this.taskDto(record, user))
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('制芯任务重复生成，请刷新后重试')
      }
      throw error
    }
  }

  private taskDto(record: any, user: AdminContext) {
    const hasReports = Number(record._count?.reports || 0) > 0
    const adjustable = ['PENDING_DISPATCH', 'WAITING'].includes(record.status) && !hasReports
    const cancelable = !['COMPLETED', 'CANCELED'].includes(record.status) && !hasReports
    return {
      id: record.id,
      code: record.code,
      workOrderId: record.workOrderId,
      workOrderCode: record.workOrderCodeSnapshot,
      productCode: record.productCodeSnapshot,
      productName: record.productNameSnapshot,
      bomVersionId: record.bomVersionId,
      bomCode: record.bomCodeSnapshot,
      bomVersion: record.bomVersionSnapshot,
      routingNodeId: record.routingNodeId,
      routingCode: record.routingCodeSnapshot,
      routingVersion: record.routingVersionSnapshot,
      operationCode: record.operationCodeSnapshot,
      operationName: record.operationNameSnapshot,
      coreBoxCode: record.coreBoxCode,
      coreBoxName: record.coreBoxNameSnapshot,
      moldCode: record.moldCodeSnapshot,
      moldName: record.moldNameSnapshot,
      quantityPerProduct: Number(record.quantityPerProductSnapshot),
      cavityCount: record.cavityCountSnapshot,
      shelfLifeHours: decimal(record.shelfLifeHoursSnapshot),
      expectedScrapRate: Number(record.expectedScrapRate),
      plannedQuantity: record.plannedQuantity,
      plannedPressCount: record.plannedPressCount,
      equipmentCode: record.equipmentCode || '',
      equipmentName: record.equipmentNameSnapshot || '',
      teamCode: record.teamCode || '',
      teamName: record.teamNameSnapshot || '',
      plannedStartAt: record.plannedStartAt?.toISOString() || '',
      qualifiedQuantity: record.qualifiedQuantity,
      scrapQuantity: record.scrapQuantity,
      status: record.status,
      versionNo: record.versionNo,
      reportCount: Number(record._count?.reports || 0),
      remark: record.remark || '',
      cancelReason: record.cancelReason || '',
      canceledByName: record.canceledBy?.name || '',
      canceledAt: record.canceledAt?.toISOString() || '',
      createdByName: record.createdBy?.name || '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      canDispatch: adjustable && hasAdminPermission(user, 'production.core_task.dispatch'),
      canStart: false,
      canReport: false,
      canCancel: cancelable && hasAdminPermission(user, 'production.core_task.cancel'),
    }
  }

  async listTasks(request: RequestWithAdmin, filters: { keyword?: string; status?: string; workOrderId?: string }) {
    const user = getAdminContext(request)
    const ids = await visibleOwnershipEntityIds(this.prisma, user, 'production:core_tasks')
    if (ids?.length === 0) return []
    const status = filters.status && filters.status !== 'ALL' && Object.values(CoreTaskStatus).includes(filters.status as CoreTaskStatus)
      ? filters.status as CoreTaskStatus
      : undefined
    const records = await this.prisma.coreProductionTask.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
        ...(status ? { status } : {}),
        ...(filters.keyword ? { OR: [
          { code: { contains: filters.keyword, mode: 'insensitive' } },
          { workOrderCodeSnapshot: { contains: filters.keyword, mode: 'insensitive' } },
          { productNameSnapshot: { contains: filters.keyword, mode: 'insensitive' } },
          { coreBoxNameSnapshot: { contains: filters.keyword, mode: 'insensitive' } },
        ] } : {}),
      },
      include: this.taskInclude(),
      orderBy: [{ plannedStartAt: 'asc' }, { createdAt: 'desc' }],
    })
    return records.map((record) => this.taskDto(record, user))
  }

  private async findTask(id: string) {
    const record = await this.prisma.coreProductionTask.findUnique({ where: { id }, include: this.taskInclude() })
    if (!record) throw new NotFoundException('制芯任务不存在')
    return record
  }

  async getTask(request: RequestWithAdmin, id: string) {
    await this.assertTaskVisible(request, id)
    return this.taskDto(await this.findTask(id), getAdminContext(request))
  }

  async dispatchTask(request: RequestWithAdmin, id: string, value: DispatchCoreTaskBody | unknown) {
    await this.assertTaskVisible(request, id)
    const body = requestBody(value) as DispatchCoreTaskBody
    const versionNo = requiredVersion(body.versionNo)
    await this.serializable(async (tx) => {
      const current = await tx.coreProductionTask.findUnique({
        where: { id },
        select: { id: true, workOrderId: true, routingNodeId: true, status: true, versionNo: true, _count: { select: { reports: true } } },
      })
      if (!current) throw new NotFoundException('制芯任务不存在')
      if (current.versionNo !== versionNo) throw new ConflictException('制芯任务已被其他用户更新，请刷新后重试')
      if (!['PENDING_DISPATCH', 'WAITING'].includes(current.status) || current._count.reports > 0) {
        throw new ConflictException('仅未报工的待派工或待生产任务可以调整派工')
      }
      const workOrder = await this.loadWorkOrder(tx, current.workOrderId)
      if (['COMPLETED', 'CLOSED'].includes(workOrder.productionStatus)) throw new BadRequestException('父生产工单已完成或关闭，不能继续派工')
      const assignment = await this.validateAssignment(tx, workOrder, { ...body, routingNodeId: current.routingNodeId })
      if (!assignment.equipmentCode || !assignment.teamCode || !assignment.plannedStartAt) throw new BadRequestException('请完整选择设备、班组和计划开始时间')
      const result = await tx.coreProductionTask.updateMany({
        where: { id, versionNo, status: { in: ['PENDING_DISPATCH', 'WAITING'] }, reports: { none: {} } },
        data: {
          equipmentCode: assignment.equipmentCode,
          equipmentNameSnapshot: assignment.equipment.name,
          teamCode: assignment.teamCode,
          teamNameSnapshot: assignment.team.name,
          plannedStartAt: assignment.plannedStartAt,
          remark: body.remark === undefined ? undefined : String(body.remark || '').trim() || null,
          status: 'WAITING',
          versionNo: { increment: 1 },
        },
      })
      if (!result.count) throw new ConflictException('制芯任务已被其他用户更新，请刷新后重试')
    })
    return this.taskDto(await this.findTask(id), getAdminContext(request))
  }

  async cancelTask(request: RequestWithAdmin, id: string, value: CancelCoreTaskBody | unknown) {
    await this.assertTaskVisible(request, id)
    const body = requestBody(value) as CancelCoreTaskBody
    const versionNo = requiredVersion(body.versionNo)
    const reason = String(body.reason || '').trim()
    if (!reason) throw new BadRequestException('请填写取消原因')
    const user = getAdminContext(request)
    const result = await this.prisma.coreProductionTask.updateMany({
      where: { id, versionNo, status: { in: ['PENDING_DISPATCH', 'WAITING', 'IN_PROGRESS'] }, reports: { none: {} } },
      data: {
        status: 'CANCELED', canceledByUserId: user.id, canceledAt: new Date(), cancelReason: reason,
        versionNo: { increment: 1 },
      },
    })
    if (!result.count) throw new ConflictException('仅未报工且未完成、未取消的制芯任务可以取消，或数据已被更新')
    return this.taskDto(await this.findTask(id), user)
  }
}
