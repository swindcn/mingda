import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { CoreBatchStatus, CoreTaskStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAdminContext, hasAdminPermission, visibleOwnershipEntityIds, type AdminContext, type RequestWithAdmin } from '../shared/admin-context'
import { calculateCoreBatchExpiresAt, calculateCoreDemand, calculatePressCount, coreBatchStatus } from './coremaking.calculations'
import type {
  CancelCoreTaskBody,
  CoreInventoryQuery,
  CoreTaskInput,
  CoreTaskPreviewBody,
  CreateCoreTasksBody,
  DispatchCoreTaskBody,
  DryCoreBatchBody,
  LockCoreBatchBody,
  ReportCoreTaskBody,
  ScrapCoreBatchBody,
  StartCoreTaskBody,
  UnlockCoreBatchBody,
} from './coremaking.types'

type DatabaseClient = PrismaService | Prisma.TransactionClient

export type CoreConsumptionOperator = {
  id: string
  name: string
}

function decimal(value: Prisma.Decimal | number | null | undefined) {
  return value === null || value === undefined ? null : Number(value)
}

function requiredVersion(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException('缺少有效的数据版本，请刷新后重试')
  }
  return value
}

function requiredInteger(value: unknown, label: string, minimum: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2_147_483_647) {
    throw new BadRequestException(`${label}必须为${minimum > 0 ? '正' : '非负'}整数`)
  }
  return value
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new BadRequestException(`${label}必须为布尔值`)
  return value
}

function positiveInteger(value: unknown, fallback: number, maximum?: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return maximum === undefined ? parsed : Math.min(parsed, maximum)
}

function textValue(value: unknown, label: string, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new BadRequestException(`请填写${label}`)
    return ''
  }
  if (typeof value !== 'string') throw new BadRequestException(`${label}格式不正确`)
  const result = value.trim()
  if (required && !result) throw new BadRequestException(`请填写${label}`)
  return result
}

function optionalDateTime(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return null
  const result = new Date(text)
  if (Number.isNaN(result.getTime())) throw new BadRequestException('计划开始时间格式不正确')
  return result
}

function businessDate(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
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
      routingNode: { include: { operation: true, equipmentLinks: { include: { equipment: { include: { workshop: true } } } } } },
      coreBox: { include: { mold: true } },
      equipment: { include: { workshop: true } },
      team: { include: { workshop: true, members: { select: { userId: true } } } },
      createdBy: { select: { id: true, name: true } },
      canceledBy: { select: { id: true, name: true } },
      _count: { select: { reports: true } },
    }
  }

  private batchInclude(includeLedgers = true) {
    return {
      report: { include: { task: { select: { id: true, code: true, workOrderId: true, status: true, team: { select: { members: { select: { userId: true } } } } } } } },
      driedBy: { select: { id: true, name: true } },
      dryingEquipment: { select: { code: true, name: true, equipmentType: true } },
      lockedBy: { select: { id: true, name: true } },
      scrappedBy: { select: { id: true, name: true } },
      ...(includeLedgers ? { ledgers: { orderBy: { createdAt: 'asc' as const } } } : {}),
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

  private isAdministrator(user: AdminContext) {
    return user.username === 'admin' || user.userType === 'SUPER_ADMIN'
  }

  private async assertTaskAccess(request: RequestWithAdmin, id: string, mobile: boolean) {
    if (!mobile) return this.assertTaskVisible(request, id)
    const user = getAdminContext(request)
    if (this.isAdministrator(user)) return
    const membership = await this.prisma.coreProductionTask.count({
      where: { id, team: { members: { some: { userId: user.id } } } },
    })
    if (!membership) throw new NotFoundException('制芯任务不存在')
  }

  private async assertTaskOperator(client: DatabaseClient, user: AdminContext, id: string) {
    if (this.isAdministrator(user)) return
    const membership = await client.coreProductionTask.count({
      where: { id, team: { members: { some: { userId: user.id } } } },
    })
    if (!membership) throw new NotFoundException('制芯任务不存在')
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

  private async lockTask(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CoreProductionTask" WHERE "id" = ${id} FOR UPDATE
    `)
    if (!rows.length) throw new NotFoundException('制芯任务不存在')
  }

  private async lockBatchRecord(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CoreInventoryBatch" WHERE "id" = ${id} FOR UPDATE
    `)
    if (!rows.length) throw new NotFoundException('砂芯批次不存在')
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

  private assemblyCoreDemand(workOrderQuantity: number, quantityPerProduct: Prisma.Decimal) {
    try {
      return calculateCoreDemand(workOrderQuantity, Number(quantityPerProduct), 0)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '砂芯齐套需求量计算失败')
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
    const workshopCodes = Array.from(new Set(nodes.flatMap((node) => node.equipmentLinks
      .filter((link) => link.equipment.status === '启用' && link.equipment.workshopCode)
      .map((link) => link.equipment.workshopCode as string))))
    const teams = workshopCodes.length ? await this.prisma.team.findMany({
      where: { status: '启用', workshopCode: { in: workshopCodes } },
      include: { workshop: true },
      orderBy: { code: 'asc' },
    }) : []
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
      teams: teams.map((team) => ({
        code: team.code,
        name: team.name,
        status: team.status,
        workshopCode: team.workshopCode,
        workshopName: team.workshop.name,
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

  private async nextBatchCode(tx: Prisma.TransactionClient, coreBoxCode: string, shiftCode: string, reportedAt: Date) {
    const current = businessDate(reportedAt)
    const documentType = `CORE_BATCH:${coreBoxCode}:${shiftCode}`
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "DocumentSequence" ("documentType", "businessDate", "currentValue", "updatedAt")
      VALUES (${documentType}, ${current.date}, 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("documentType", "businessDate") DO NOTHING
    `)
    const [sequence] = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      SELECT "currentValue" FROM "DocumentSequence"
      WHERE "documentType" = ${documentType} AND "businessDate" = CAST(${current.date} AS date)
      FOR UPDATE
    `)
    if (!sequence) throw new ConflictException('砂芯批次流水不存在，请重试')
    const codePrefix = `CORE-${coreBoxCode}-${current.key}-${shiftCode}-`
    const occupied = await tx.coreInventoryBatch.findMany({
      where: { code: { startsWith: codePrefix } },
      select: { code: true },
    })
    const occupiedCodes = new Set(occupied.map((batch) => batch.code))
    let nextValue = sequence.currentValue + 1
    while (nextValue <= 999 && occupiedCodes.has(`${codePrefix}${String(nextValue).padStart(3, '0')}`)) nextValue += 1
    if (nextValue > 999) throw new ConflictException('当日砂芯批次三位流水已用尽')
    await tx.documentSequence.update({
      where: { documentType_businessDate: { documentType, businessDate: current.date } },
      data: { currentValue: nextValue },
    })
    return `${codePrefix}${String(nextValue).padStart(3, '0')}`
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (isSerializableConflict(error)) {
          if (attempt < maxAttempts - 1) continue
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

  private taskDto(record: any, user: AdminContext, mobile = false) {
    const hasReports = Number(record._count?.reports || 0) > 0
    const adjustable = ['PENDING_DISPATCH', 'WAITING'].includes(record.status) && !hasReports
    const cancelable = !['COMPLETED', 'CANCELED'].includes(record.status) && !hasReports
    const isTeamMember = Boolean(record.team?.members?.some((member: { userId: string }) => member.userId === user.id))
    const canOperate = !mobile || this.isAdministrator(user) || isTeamMember
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
      startedAt: record.startedAt?.toISOString() || '',
      completedAt: record.completedAt?.toISOString() || '',
      canceledByName: record.canceledBy?.name || '',
      canceledAt: record.canceledAt?.toISOString() || '',
      createdByName: record.createdBy?.name || '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      canDispatch: adjustable && hasAdminPermission(user, 'production.core_task.dispatch'),
      canStart: record.status === 'WAITING'
        && !['COMPLETED', 'CLOSED'].includes(record.workOrder.productionStatus)
        && canOperate
        && hasAdminPermission(user, mobile ? 'mini.production.core.start' : 'production.core_task.start'),
      canReport: record.status === 'IN_PROGRESS'
        && !['COMPLETED', 'CLOSED'].includes(record.workOrder.productionStatus)
        && canOperate
        && hasAdminPermission(user, mobile ? 'mini.production.core.report' : 'production.core_task.report'),
      canCancel: cancelable && hasAdminPermission(user, 'production.core_task.cancel'),
      canDry: false,
    }
  }

  async listTasks(request: RequestWithAdmin, filters: { keyword?: string; status?: string; workOrderId?: string }, mobile = false) {
    const user = getAdminContext(request)
    const ids = mobile ? null : await visibleOwnershipEntityIds(this.prisma, user, 'production:core_tasks')
    if (!mobile && ids?.length === 0) return []
    const status = filters.status && filters.status !== 'ALL' && Object.values(CoreTaskStatus).includes(filters.status as CoreTaskStatus)
      ? filters.status as CoreTaskStatus
      : undefined
    const records = await this.prisma.coreProductionTask.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(mobile && !this.isAdministrator(user) ? { team: { members: { some: { userId: user.id } } } } : {}),
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
      orderBy: mobile ? [{ plannedStartAt: 'desc' }, { createdAt: 'desc' }] : [{ plannedStartAt: 'asc' }, { createdAt: 'desc' }],
    })
    return records.map((record) => this.taskDto(record, user, mobile))
  }

  private async findTask(id: string, includeReports = false) {
    const record = await this.prisma.coreProductionTask.findUnique({
      where: { id },
      include: {
        ...this.taskInclude(),
        ...(includeReports ? { reports: { include: { batch: true }, orderBy: { reportedAt: 'desc' as const } } } : {}),
      },
    })
    if (!record) throw new NotFoundException('制芯任务不存在')
    return record
  }

  async getTask(request: RequestWithAdmin, id: string, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const record = await this.findTask(id, true)
    const user = getAdminContext(request)
    const batches = mobile ? await this.prisma.coreInventoryBatch.findMany({
      where: { report: { taskId: id } },
      include: this.batchInclude(false),
      orderBy: { createdAt: 'desc' },
    }) : []
    const batchDtos = batches.map((batch) => this.batchDto(batch, user, true))
    return {
      ...this.taskDto(record, user, mobile),
      reports: Array.isArray((record as any).reports) ? (record as any).reports.map((item: any) => this.reportDto(item)) : [],
      ...(mobile ? {
        batches: batchDtos,
        canDry: batchDtos.some((batch) => batch.canDry),
      } : {}),
    }
  }

  async getCoreTaskOptions(request: RequestWithAdmin, id: string, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const task = await this.findTask(id)
    const equipment = task.routingNode.equipmentLinks
      .map((link) => link.equipment)
      .filter((item, index, records) => item.status === '启用' && records.findIndex((record) => record.code === item.code) === index)
    const workshopCodes = Array.from(new Set(equipment.map((item) => item.workshopCode).filter((code): code is string => Boolean(code))))
    const [teams, shifts, dryingEquipment] = await Promise.all([
      workshopCodes.length ? this.prisma.team.findMany({
        where: { status: '启用', workshopCode: { in: workshopCodes } },
        include: { workshop: true },
        orderBy: { code: 'asc' },
      }) : [],
      this.prisma.shiftMaster.findMany({ where: { status: '启用' }, orderBy: { code: 'asc' } }),
      this.prisma.furnace.findMany({
        where: { status: '启用' },
        include: { workshop: true },
        orderBy: { code: 'asc' },
      }),
    ])
    return {
      equipment: equipment.map((item) => ({
        code: item.code,
        name: item.name,
        status: item.status,
        workshopCode: item.workshopCode || '',
        workshopName: item.workshop?.name || '',
        equipmentType: item.equipmentType,
      })),
      teams: teams.map((item) => ({
        code: item.code,
        name: item.name,
        status: item.status,
        workshopCode: item.workshopCode,
        workshopName: item.workshop.name,
      })),
      shifts: shifts.map((item) => ({ code: item.code, name: item.name, status: item.status })),
      dryingEquipment: dryingEquipment
        .filter((item) => /(芯|烘干)/.test(item.equipmentType))
        .map((item) => ({
          code: item.code,
          name: item.name,
          status: item.status,
          workshopCode: item.workshopCode || '',
          workshopName: item.workshop?.name || '',
          equipmentType: item.equipmentType,
        })),
    }
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

  private reportDto(record: any) {
    return {
      id: record.id,
      taskId: record.taskId,
      equipmentCode: record.equipmentCode,
      equipmentName: record.equipmentNameSnapshot,
      teamCode: record.teamCode,
      teamName: record.teamNameSnapshot,
      shiftCode: record.shiftCode || '',
      operatorName: record.operatorNameSnapshot,
      sandBatchCode: record.sandBatchCode || '',
      qualifiedQuantity: record.qualifiedQuantity,
      scrapQuantity: record.scrapQuantity,
      defectReason: record.defectReason || '',
      dryingRequired: record.dryingRequired,
      remark: record.remark || '',
      reportedAt: record.reportedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      batch: record.batch ? {
        id: record.batch.id,
        code: record.batch.code,
        status: record.batch.status,
        versionNo: record.batch.versionNo,
        dryingRequired: record.batch.dryingRequired,
      } : null,
    }
  }

  private batchDto(record: any, user?: AdminContext, mobile = false) {
    const isTeamMember = Boolean(user && record.report?.task?.team?.members?.some((member: { userId: string }) => member.userId === user.id))
    const canOperate = Boolean(user && (this.isAdministrator(user) || isTeamMember))
    const result = {
      id: record.id,
      code: record.code,
      qrContent: record.qrContent,
      reportId: record.reportId,
      taskId: record.report?.taskId || '',
      taskCode: record.report?.task?.code || '',
      workOrderId: record.report?.task?.workOrderId || '',
      coreBoxCode: record.coreBoxCodeSnapshot,
      coreBoxName: record.coreBoxNameSnapshot,
      productCode: record.productCodeSnapshot,
      productName: record.productNameSnapshot,
      workOrderCode: record.workOrderCodeSnapshot,
      reportedAt: record.report?.reportedAt?.toISOString() || record.createdAt.toISOString(),
      initialQuantity: record.initialQuantity,
      currentQuantity: record.currentQuantity,
      dryingRequired: record.dryingRequired,
      driedAt: record.driedAt?.toISOString() || '',
      driedByName: record.driedBy?.name || '',
      dryingEquipmentCode: record.dryingEquipmentCode || '',
      dryingEquipmentName: record.dryingEquipmentNameSnapshot || '',
      shelfLifeHours: decimal(record.shelfLifeHoursSnapshot),
      shelfLifeStartedAt: record.shelfLifeStartedAt?.toISOString() || '',
      expiresAt: record.expiresAt?.toISOString() || '',
      status: record.status,
      versionNo: record.versionNo,
      lockedByName: record.lockedBy?.name || '',
      lockedAt: record.lockedAt?.toISOString() || '',
      lockReason: record.lockReason || '',
      scrappedByName: record.scrappedBy?.name || '',
      scrappedAt: record.scrappedAt?.toISOString() || '',
      scrapReason: record.scrapReason || '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      canDry: record.dryingRequired
        && record.status === 'UNDRIED'
        && canOperate
        && Boolean(user && hasAdminPermission(user, mobile ? 'mini.production.core.dry' : 'production.core_task.dry')),
    }
    if (!Array.isArray(record.ledgers)) return result
    return {
      ...result,
      ledgers: record.ledgers.map((item: any) => ({
        id: item.id,
        action: item.action,
        quantityChange: item.quantityChange,
        quantityAfter: item.quantityAfter,
        operatorName: item.operatorNameSnapshot,
        reason: item.reason || '',
        createdAt: item.createdAt.toISOString(),
      })),
    }
  }

  private async findBatch(id: string) {
    const record = await this.prisma.coreInventoryBatch.findUnique({ where: { id }, include: this.batchInclude() })
    if (!record) throw new NotFoundException('砂芯批次不存在')
    return record
  }

  private async refreshBatchStatus(id: string) {
    const current = await this.prisma.coreInventoryBatch.findUnique({
      where: { id },
      select: { id: true, status: true, expiresAt: true },
    })
    if (!current) throw new NotFoundException('砂芯批次不存在')
    const status = this.liveBatchStatus(current, new Date())
    if (status !== current.status) {
      await this.prisma.coreInventoryBatch.updateMany({
        where: { id, status: current.status },
        data: { status },
      })
    }
    return this.findBatch(id)
  }

  private async assertBatchVisible(request: RequestWithAdmin, id: string) {
    const batch = await this.prisma.coreInventoryBatch.findUnique({
      where: { id },
      select: { report: { select: { taskId: true } } },
    })
    if (!batch) throw new NotFoundException('砂芯批次不存在')
    await this.assertTaskVisible(request, batch.report.taskId)
  }

  private liveBatchStatus(record: { status: CoreBatchStatus; expiresAt: Date | null }, now: Date) {
    if (!['AVAILABLE', 'WARNING', 'EXPIRED'].includes(record.status)) return record.status
    return coreBatchStatus(now, record.expiresAt) as CoreBatchStatus
  }

  async refreshInventoryStatuses(where: Prisma.CoreInventoryBatchWhereInput = {}) {
    const now = new Date()
    const warningAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    await this.prisma.$transaction([
      this.prisma.coreInventoryBatch.updateMany({
        where: { AND: [where, { status: { in: ['AVAILABLE', 'WARNING'] }, expiresAt: { lte: now } }] },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.coreInventoryBatch.updateMany({
        where: { AND: [where, { status: { in: ['AVAILABLE', 'EXPIRED'] }, expiresAt: { gt: now, lte: warningAt } }] },
        data: { status: 'WARNING' },
      }),
      this.prisma.coreInventoryBatch.updateMany({
        where: {
          AND: [
            where,
            { status: { in: ['WARNING', 'EXPIRED'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: warningAt } }] },
          ],
        },
        data: { status: 'AVAILABLE' },
      }),
    ])
  }

  async getCoreReadiness(request: RequestWithAdmin, workOrderId: string) {
    await this.assertWorkOrderVisible(request, workOrderId)
    const workOrder = await this.loadWorkOrder(this.prisma, workOrderId)
    const coreBoxCodes = workOrder.bomVersion.coreBoxes.map((item) => item.coreBoxCode)
    const inventoryWhere: Prisma.CoreInventoryBatchWhereInput = {
      productCodeSnapshot: workOrder.productCode,
      coreBoxCodeSnapshot: { in: coreBoxCodes },
      report: {
        task: {
          productCodeSnapshot: workOrder.productCode,
          workOrder: { productCode: workOrder.productCode },
        },
      },
    }
    if (coreBoxCodes.length) await this.refreshInventoryStatuses(inventoryWhere)
    const inventory = coreBoxCodes.length
      ? await this.prisma.coreInventoryBatch.groupBy({
        by: ['coreBoxCodeSnapshot', 'status'],
        where: { AND: [inventoryWhere, { currentQuantity: { gt: 0 } }] },
        _sum: { currentQuantity: true },
        _min: { expiresAt: true },
      })
      : []
    const now = Date.now()
    const rows = workOrder.bomVersion.coreBoxes.map((item) => {
      const groups = inventory.filter((group) => group.coreBoxCodeSnapshot === item.coreBoxCode)
      const usableGroups = groups.filter((group) => ['AVAILABLE', 'WARNING'].includes(group.status))
      const requiredQuantity = this.assemblyCoreDemand(workOrder.plannedQuantity, item.quantityPerProduct)
      const availableQuantity = usableGroups.reduce((sum, group) => sum + Number(group._sum.currentQuantity || 0), 0)
      const undriedQuantity = groups
        .filter((group) => group.status === 'UNDRIED')
        .reduce((sum, group) => sum + Number(group._sum.currentQuantity || 0), 0)
      const shortageQuantity = Number(Math.max(requiredQuantity - availableQuantity, 0).toFixed(4))
      const expirations = usableGroups.map((group) => group._min.expiresAt).filter((value): value is Date => value !== null)
      const minExpiresAt = expirations.length ? new Date(Math.min(...expirations.map((value) => value.getTime()))) : null
      return {
        coreBoxCode: item.coreBoxCode,
        coreBoxName: item.coreBoxNameSnapshot || item.coreBox.name,
        quantityPerProduct: Number(item.quantityPerProduct),
        requiredQuantity,
        availableQuantity,
        undriedQuantity,
        shortageQuantity,
        minRemainingHours: minExpiresAt ? Number(Math.max((minExpiresAt.getTime() - now) / 3_600_000, 0).toFixed(2)) : null,
        readinessStatus: shortageQuantity === 0 ? 'READY' : availableQuantity > 0 || undriedQuantity > 0 ? 'PARTIAL' : 'SHORTAGE',
      }
    })
    const totalRequiredQuantity = Number(rows.reduce((sum, row) => sum + row.requiredQuantity, 0).toFixed(4))
    const totalAvailableQuantity = rows.reduce((sum, row) => sum + row.availableQuantity, 0)
    const totalUndriedQuantity = rows.reduce((sum, row) => sum + row.undriedQuantity, 0)
    const totalShortageQuantity = Number(rows.reduce((sum, row) => sum + row.shortageQuantity, 0).toFixed(4))
    const readinessRate = totalRequiredQuantity === 0
      ? 100
      : Number((((totalRequiredQuantity - totalShortageQuantity) / totalRequiredQuantity) * 100).toFixed(2))
    return {
      workOrderId: workOrder.id,
      workOrderCode: workOrder.code,
      rows,
      totalRequiredQuantity,
      totalAvailableQuantity,
      totalUndriedQuantity,
      totalShortageQuantity,
      readinessRate,
    }
  }

  private consumptionOperator(value: CoreConsumptionOperator | undefined) {
    const id = String(value?.id || '').trim()
    const name = String(value?.name || '').trim()
    if (!id || !name) throw new BadRequestException('领用操作人信息不完整')
    return { id, name }
  }

  private async consumptionContext(client: DatabaseClient, workOrderId: string, batchCode: string) {
    const [workOrder, batch] = await Promise.all([
      client.workOrder.findUnique({
        where: { id: workOrderId },
        select: {
          productCode: true,
          bomVersionId: true,
          bomVersion: { select: { coreBoxes: { select: { coreBoxCode: true } } } },
        },
      }),
      client.coreInventoryBatch.findUnique({
        where: { code: batchCode },
        include: {
          report: {
            include: {
              task: {
                select: {
                  coreBoxCode: true,
                  productCodeSnapshot: true,
                  workOrder: { select: { productCode: true } },
                },
              },
            },
          },
        },
      }),
    ])
    if (!workOrder) throw new NotFoundException('生产工单不存在')
    if (!batch) throw new NotFoundException('砂芯批次不存在')
    const sourceTask = batch.report.task
    if (
      batch.productCodeSnapshot !== workOrder.productCode
      || sourceTask.productCodeSnapshot !== workOrder.productCode
      || sourceTask.workOrder.productCode !== workOrder.productCode
    ) {
      throw new BadRequestException('砂芯批次产品与目标工单不匹配')
    }
    const allowedCoreBoxes = new Set(workOrder.bomVersion.coreBoxes.map((item) => item.coreBoxCode))
    if (batch.coreBoxCodeSnapshot !== sourceTask.coreBoxCode || !allowedCoreBoxes.has(sourceTask.coreBoxCode)) {
      throw new BadRequestException('砂芯批次芯盒不属于目标工单锁定 BOM')
    }
    const status = this.liveBatchStatus(batch, new Date())
    return { batch, status }
  }

  async validateCoreConsumption(
    workOrderId: string,
    batchCode: string,
    quantity: number,
    operatorContext?: CoreConsumptionOperator,
  ) {
    const normalizedWorkOrderId = textValue(workOrderId, '生产工单', true)
    const normalizedBatchCode = textValue(batchCode, '砂芯批次', true)
    const normalizedQuantity = requiredInteger(quantity, '领用数量', 1)
    if (operatorContext !== undefined) this.consumptionOperator(operatorContext)
    await this.refreshInventoryStatuses({ code: normalizedBatchCode })
    const { batch, status } = await this.consumptionContext(this.prisma, normalizedWorkOrderId, normalizedBatchCode)
    if (!['AVAILABLE', 'WARNING'].includes(status)) throw new ConflictException('砂芯批次当前状态不可领用')
    if (batch.currentQuantity < normalizedQuantity) throw new ConflictException('砂芯批次库存不足')
    return {
      workOrderId: normalizedWorkOrderId,
      batchId: batch.id,
      batchCode: batch.code,
      coreBoxCode: batch.coreBoxCodeSnapshot,
      requestedQuantity: normalizedQuantity,
      availableQuantity: batch.currentQuantity,
      status,
      recommendationPriority: status === 'WARNING' ? 'FIRST' : 'NORMAL',
      versionNo: batch.versionNo,
    }
  }

  async consumeCoreBatch(
    workOrderId: string,
    batchCode: string,
    quantity: number,
    operatorContext: CoreConsumptionOperator,
  ) {
    const normalizedWorkOrderId = textValue(workOrderId, '生产工单', true)
    const normalizedBatchCode = textValue(batchCode, '砂芯批次', true)
    const normalizedQuantity = requiredInteger(quantity, '领用数量', 1)
    const operator = this.consumptionOperator(operatorContext)
    const consumption = await this.serializable(async (tx) => {
      const target = await tx.coreInventoryBatch.findUnique({ where: { code: normalizedBatchCode }, select: { id: true } })
      if (!target) throw new NotFoundException('砂芯批次不存在')
      await this.lockBatchRecord(tx, target.id)
      const { batch, status } = await this.consumptionContext(tx, normalizedWorkOrderId, normalizedBatchCode)
      if (status !== batch.status) {
        await tx.coreInventoryBatch.updateMany({ where: { id: batch.id, status: batch.status }, data: { status } })
      }
      if (!['AVAILABLE', 'WARNING'].includes(status)) return { batchId: batch.id, consumed: false }
      if (batch.currentQuantity < normalizedQuantity) throw new ConflictException('砂芯批次库存不足')
      const quantityAfter = batch.currentQuantity - normalizedQuantity
      const updated = await tx.coreInventoryBatch.updateMany({
        where: {
          id: batch.id,
          versionNo: batch.versionNo,
          currentQuantity: { gte: normalizedQuantity },
          status: { in: ['AVAILABLE', 'WARNING'] },
        },
        data: {
          currentQuantity: { decrement: normalizedQuantity },
          status: quantityAfter === 0 ? 'CONSUMED' : status,
          versionNo: { increment: 1 },
        },
      })
      if (!updated.count) throw new ConflictException('砂芯批次已被其他操作领用，请刷新后重试')
      await tx.coreInventoryLedger.create({
        data: {
          batchId: batch.id,
          action: 'CONSUMED',
          quantityChange: -normalizedQuantity,
          quantityAfter,
          sourceType: 'WORK_ORDER',
          sourceId: normalizedWorkOrderId,
          operatorUserId: operator.id,
          operatorNameSnapshot: operator.name,
        },
      })
      return { batchId: batch.id, consumed: true }
    })
    if (!consumption.consumed) throw new ConflictException('砂芯批次当前状态不可领用')
    return this.batchDto(await this.refreshBatchStatus(consumption.batchId))
  }

  private async validateStartResources(
    tx: Prisma.TransactionClient,
    task: { routingNodeId: string; equipmentCode: string | null; teamCode: string | null },
  ) {
    if (!task.equipmentCode || !task.teamCode) throw new BadRequestException('制芯任务缺少完整派工信息')
    const [equipmentLink, team] = await Promise.all([
      tx.routingNodeEquipment.findUnique({
        where: { routingNodeId_equipmentCode: { routingNodeId: task.routingNodeId, equipmentCode: task.equipmentCode } },
        include: { equipment: { include: { workshop: true } } },
      }),
      tx.team.findUnique({ where: { code: task.teamCode }, include: { workshop: true } }),
    ])
    if (!equipmentLink) throw new BadRequestException('派工设备已解除当前制芯工序绑定，不能开始任务')
    const equipment = equipmentLink.equipment
    if (equipment.status !== '启用') throw new BadRequestException('派工设备已停用，不能开始任务')
    if (!equipment.workshop || equipment.workshop.status !== '启用') throw new BadRequestException('派工设备所属车间不存在或已停用')
    if (!team || team.status !== '启用') throw new BadRequestException('派工班组不存在或已停用，不能开始任务')
    if (team.workshop.status !== '启用') throw new BadRequestException('派工班组所属车间已停用')
    if (team.workshopCode !== equipment.workshopCode) throw new BadRequestException('派工设备与班组不属于同一车间')
  }

  async startTask(request: RequestWithAdmin, id: string, value: StartCoreTaskBody | unknown, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const body = requestBody(value) as StartCoreTaskBody
    const versionNo = requiredVersion(body.versionNo)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lockTask(tx, id)
      if (mobile) await this.assertTaskOperator(tx, user, id)
      const current = await tx.coreProductionTask.findUnique({
        where: { id },
        include: { workOrder: { select: { productionStatus: true } } },
      })
      if (!current) throw new NotFoundException('制芯任务不存在')
      if (current.versionNo !== versionNo) throw new ConflictException('制芯任务已被其他用户更新，请刷新后重试')
      if (['COMPLETED', 'CLOSED'].includes(current.workOrder.productionStatus)) {
        throw new BadRequestException('父生产工单已完成或关闭，不能开始制芯任务')
      }
      if (current.status !== 'WAITING' || !current.equipmentCode || !current.teamCode || !current.plannedStartAt) {
        throw new ConflictException('仅已完成派工的待生产任务可以开始')
      }
      await this.validateStartResources(tx, current)
      const result = await tx.coreProductionTask.updateMany({
        where: { id, versionNo, status: 'WAITING' },
        data: { status: 'IN_PROGRESS', startedByUserId: user.id, startedAt: new Date(), versionNo: { increment: 1 } },
      })
      if (!result.count) throw new ConflictException('制芯任务已被其他用户更新，请刷新后重试')
    })
    await this.assertTaskAccess(request, id, mobile)
    return this.taskDto(await this.findTask(id), user, mobile)
  }

  async reportTask(request: RequestWithAdmin, id: string, value: ReportCoreTaskBody | unknown, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const body = requestBody(value) as ReportCoreTaskBody
    const versionNo = requiredVersion(body.versionNo)
    const qualifiedQuantity = requiredInteger(body.qualifiedQuantity, '合格数量', 1)
    const scrapQuantity = requiredInteger(body.scrapQuantity, '废品数量', 0)
    const shiftCode = textValue(body.shiftCode, '班次', true)
    const dryingRequired = requiredBoolean(body.dryingRequired, '是否需要烘干')
    const sandBatchCode = textValue(body.sandBatchCode, '砂批次') || null
    const defectReason = textValue(body.defectReason, '缺陷原因') || null
    const remark = textValue(body.remark, '备注') || null
    const user = getAdminContext(request)

    const reportId = await this.serializable(async (tx) => {
      await this.lockTask(tx, id)
      if (mobile) await this.assertTaskOperator(tx, user, id)
      const current = await tx.coreProductionTask.findUnique({
        where: { id },
        include: { workOrder: { select: { productionStatus: true } } },
      })
      if (!current) throw new NotFoundException('制芯任务不存在')
      if (current.versionNo !== versionNo) throw new ConflictException('制芯任务已被其他用户更新，请刷新后重试')
      if (['COMPLETED', 'CLOSED'].includes(current.workOrder.productionStatus)) {
        throw new BadRequestException('父生产工单已完成或关闭，不能继续报工')
      }
      if (current.status !== 'IN_PROGRESS') throw new ConflictException('仅生产中的制芯任务可以报工')
      if (!current.equipmentCode || !current.equipmentNameSnapshot || !current.teamCode || !current.teamNameSnapshot) {
        throw new BadRequestException('制芯任务缺少完整派工信息')
      }
      if (!(await tx.shiftMaster.count({ where: { code: shiftCode, status: '启用' } }))) {
        throw new BadRequestException('班次不存在或已停用')
      }

      const qualifiedTotal = BigInt(current.qualifiedQuantity) + BigInt(qualifiedQuantity)
      const scrapTotal = BigInt(current.scrapQuantity) + BigInt(scrapQuantity)
      if (qualifiedTotal > 2_147_483_647n || scrapTotal > 2_147_483_647n) throw new BadRequestException('累计报工数量超出可存储范围')
      const reportedAt = new Date()
      const completed = qualifiedTotal >= BigInt(current.plannedQuantity)
      const updated = await tx.coreProductionTask.updateMany({
        where: { id, versionNo, status: 'IN_PROGRESS' },
        data: {
          qualifiedQuantity: Number(qualifiedTotal),
          scrapQuantity: Number(scrapTotal),
          status: completed ? 'COMPLETED' : 'IN_PROGRESS',
          completedByUserId: completed ? user.id : null,
          completedAt: completed ? reportedAt : null,
          versionNo: { increment: 1 },
        },
      })
      if (!updated.count) throw new ConflictException('制芯任务已被其他用户更新，请刷新后重试')

      const report = await tx.coreProductionReport.create({
        data: {
          taskId: id,
          equipmentCode: current.equipmentCode,
          equipmentNameSnapshot: current.equipmentNameSnapshot,
          teamCode: current.teamCode,
          teamNameSnapshot: current.teamNameSnapshot,
          shiftCode,
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
          sandBatchCode,
          qualifiedQuantity,
          scrapQuantity,
          defectReason,
          dryingRequired,
          remark,
          reportedAt,
        },
      })
      const expiresAt = calculateCoreBatchExpiresAt(dryingRequired, reportedAt, null, decimal(current.shelfLifeHoursSnapshot))
      const batchCode = await this.nextBatchCode(tx, current.coreBoxCode, shiftCode, reportedAt)
      const batch = await tx.coreInventoryBatch.create({
        data: {
          code: batchCode,
          qrContent: batchCode,
          reportId: report.id,
          coreBoxCodeSnapshot: current.coreBoxCode,
          productCodeSnapshot: current.productCodeSnapshot,
          productNameSnapshot: current.productNameSnapshot,
          coreBoxNameSnapshot: current.coreBoxNameSnapshot,
          workOrderCodeSnapshot: current.workOrderCodeSnapshot,
          initialQuantity: qualifiedQuantity,
          currentQuantity: qualifiedQuantity,
          dryingRequired,
          shelfLifeHoursSnapshot: current.shelfLifeHoursSnapshot,
          shelfLifeStartedAt: dryingRequired ? null : reportedAt,
          expiresAt,
          status: dryingRequired ? 'UNDRIED' : coreBatchStatus(reportedAt, expiresAt),
        },
      })
      await tx.coreInventoryLedger.create({
        data: {
          batchId: batch.id,
          action: 'PRODUCED',
          quantityChange: qualifiedQuantity,
          quantityAfter: qualifiedQuantity,
          sourceType: 'CORE_PRODUCTION_REPORT',
          sourceId: report.id,
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
        },
      })
      return report.id
    }, 5)

    await this.assertTaskAccess(request, id, mobile)
    const created = await this.prisma.coreProductionReport.findUnique({ where: { id: reportId }, select: { batch: { select: { id: true } } } })
    if (!created?.batch) throw new NotFoundException('报工库存批次不存在')
    await this.refreshBatchStatus(created.batch.id)
    const report = await this.prisma.coreProductionReport.findUnique({ where: { id: reportId }, include: { batch: { include: this.batchInclude() } } })
    if (!report?.batch) throw new NotFoundException('报工库存批次不存在')
    return {
      task: this.taskDto(await this.findTask(id), user, mobile),
      report: this.reportDto(report),
      batch: this.batchDto(report.batch, user, mobile),
    }
  }

  async listDryingBatches(request: RequestWithAdmin, taskId: string) {
    await this.assertTaskAccess(request, taskId, true)
    const user = getAdminContext(request)
    const records = await this.prisma.coreInventoryBatch.findMany({
      where: { report: { taskId }, dryingRequired: true, status: 'UNDRIED' },
      include: this.batchInclude(false),
      orderBy: { createdAt: 'desc' },
    })
    return records.map((record) => this.batchDto(record, user, true))
  }

  async listInventory(request: RequestWithAdmin, query: CoreInventoryQuery) {
    const taskIds = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:core_tasks')
    const page = positiveInteger(query.page, 1)
    const pageSize = positiveInteger(query.pageSize, 20, 100)
    if (taskIds?.length === 0) return { items: [], page, pageSize, total: 0, totalPages: 0 }
    const visibilityWhere: Prisma.CoreInventoryBatchWhereInput = taskIds ? { report: { taskId: { in: taskIds } } } : {}
    await this.refreshInventoryStatuses(visibilityWhere)
    const keyword = query.keyword?.trim()
    const status = query.status && query.status !== 'ALL' && Object.values(CoreBatchStatus).includes(query.status as CoreBatchStatus)
      ? query.status as CoreBatchStatus
      : undefined
    const where: Prisma.CoreInventoryBatchWhereInput = {
      AND: [
        visibilityWhere,
        ...(status ? [{ status }] : []),
        ...(keyword ? [{ OR: [
          { code: { contains: keyword, mode: 'insensitive' as const } },
          { coreBoxCodeSnapshot: { contains: keyword, mode: 'insensitive' as const } },
          { coreBoxNameSnapshot: { contains: keyword, mode: 'insensitive' as const } },
          { productCodeSnapshot: { contains: keyword, mode: 'insensitive' as const } },
          { productNameSnapshot: { contains: keyword, mode: 'insensitive' as const } },
          { workOrderCodeSnapshot: { contains: keyword, mode: 'insensitive' as const } },
          { report: { task: { code: { contains: keyword, mode: 'insensitive' as const } } } },
        ] }] : []),
      ],
    }
    const [total, records] = await Promise.all([
      this.prisma.coreInventoryBatch.count({ where }),
      this.prisma.coreInventoryBatch.findMany({
        where,
        include: this.batchInclude(false),
        orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { items: records.map((record) => this.batchDto(record)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  }

  async getInventoryBatch(request: RequestWithAdmin, id: string) {
    await this.assertBatchVisible(request, id)
    return this.batchDto(await this.refreshBatchStatus(id))
  }

  async getCoreInventoryOptions() {
    const equipment = await this.prisma.furnace.findMany({
      where: { status: '启用' },
      include: { workshop: true },
      orderBy: { code: 'asc' },
    })
    return {
      dryingEquipment: equipment
        .filter((item) => /(芯|烘干)/.test(item.equipmentType))
        .map((item) => ({
          code: item.code,
          name: item.name,
          status: item.status,
          workshopCode: item.workshopCode || '',
          workshopName: item.workshop?.name || '',
          equipmentType: item.equipmentType,
        })),
    }
  }

  async dryBatch(request: RequestWithAdmin, id: string, value: DryCoreBatchBody | unknown, mobile = false) {
    if (mobile) {
      const batch = await this.prisma.coreInventoryBatch.findUnique({ where: { id }, select: { report: { select: { taskId: true } } } })
      if (!batch) throw new NotFoundException('砂芯批次不存在')
      await this.assertTaskAccess(request, batch.report.taskId, true)
    } else {
      await this.assertBatchVisible(request, id)
    }
    const body = requestBody(value) as DryCoreBatchBody
    const versionNo = requiredVersion(body.versionNo)
    const equipmentCode = textValue(body.equipmentCode, '烘干设备', true)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lockBatchRecord(tx, id)
      const batch = await tx.coreInventoryBatch.findUnique({ where: { id }, include: { report: { select: { taskId: true } } } })
      if (!batch) throw new NotFoundException('砂芯批次不存在')
      if (mobile) await this.assertTaskOperator(tx, user, batch.report.taskId)
      if (batch.versionNo !== versionNo) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      if (!batch.dryingRequired || batch.status !== 'UNDRIED') throw new ConflictException('仅待烘干批次可以确认烘干')
      const equipment = await tx.furnace.findUnique({ where: { code: equipmentCode } })
      if (!equipment || equipment.status !== '启用' || !/(芯|烘干)/.test(equipment.equipmentType)) {
        throw new BadRequestException('请选择启用且与制芯或烘干相关的设备')
      }
      const driedAt = new Date()
      const expiresAt = calculateCoreBatchExpiresAt(true, batch.createdAt, driedAt, decimal(batch.shelfLifeHoursSnapshot))
      const updated = await tx.coreInventoryBatch.updateMany({
        where: { id, versionNo, status: 'UNDRIED', dryingRequired: true },
        data: {
          driedAt,
          driedByUserId: user.id,
          dryingEquipmentCode: equipment.code,
          dryingEquipmentNameSnapshot: equipment.name,
          shelfLifeStartedAt: driedAt,
          expiresAt,
          status: coreBatchStatus(driedAt, expiresAt),
          versionNo: { increment: 1 },
        },
      })
      if (!updated.count) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
    })
    if (mobile) {
      const batch = await this.prisma.coreInventoryBatch.findUnique({ where: { id }, select: { report: { select: { taskId: true } } } })
      if (!batch) throw new NotFoundException('砂芯批次不存在')
      await this.assertTaskAccess(request, batch.report.taskId, true)
    }
    return this.batchDto(await this.refreshBatchStatus(id), user, mobile)
  }

  async lockBatch(request: RequestWithAdmin, id: string, value: LockCoreBatchBody | unknown) {
    await this.assertBatchVisible(request, id)
    const body = requestBody(value) as LockCoreBatchBody
    const versionNo = requiredVersion(body.versionNo)
    const reason = textValue(body.reason, '锁定原因', true)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lockBatchRecord(tx, id)
      const batch = await tx.coreInventoryBatch.findUnique({ where: { id } })
      if (!batch) throw new NotFoundException('砂芯批次不存在')
      if (batch.versionNo !== versionNo) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      const currentStatus = this.liveBatchStatus(batch, new Date())
      if (!['AVAILABLE', 'WARNING', 'EXPIRED'].includes(currentStatus)) throw new ConflictException('当前砂芯批次不可锁定')
      if (batch.currentQuantity <= 0) throw new ConflictException('无可锁定库存数量')
      const lockedAt = new Date()
      const updated = await tx.coreInventoryBatch.updateMany({
        where: { id, versionNo, status: { in: ['AVAILABLE', 'WARNING', 'EXPIRED'] } },
        data: { status: 'LOCKED', lockedByUserId: user.id, lockedAt, lockReason: reason, versionNo: { increment: 1 } },
      })
      if (!updated.count) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      await tx.coreInventoryLedger.create({
        data: { batchId: id, action: 'LOCKED', quantityChange: 0, quantityAfter: batch.currentQuantity, operatorUserId: user.id, operatorNameSnapshot: user.name, reason },
      })
    })
    return this.batchDto(await this.findBatch(id))
  }

  async unlockBatch(request: RequestWithAdmin, id: string, value: UnlockCoreBatchBody | unknown) {
    await this.assertBatchVisible(request, id)
    const body = requestBody(value) as UnlockCoreBatchBody
    const versionNo = requiredVersion(body.versionNo)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lockBatchRecord(tx, id)
      const batch = await tx.coreInventoryBatch.findUnique({ where: { id } })
      if (!batch) throw new NotFoundException('砂芯批次不存在')
      if (batch.versionNo !== versionNo) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      if (batch.status !== 'LOCKED') throw new ConflictException('仅锁定中的砂芯批次可以解锁')
      const status = coreBatchStatus(new Date(), batch.expiresAt)
      const updated = await tx.coreInventoryBatch.updateMany({
        where: { id, versionNo, status: 'LOCKED' },
        data: { status, lockedByUserId: null, lockedAt: null, lockReason: null, versionNo: { increment: 1 } },
      })
      if (!updated.count) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      await tx.coreInventoryLedger.create({
        data: { batchId: id, action: 'UNLOCKED', quantityChange: 0, quantityAfter: batch.currentQuantity, operatorUserId: user.id, operatorNameSnapshot: user.name },
      })
    })
    return this.batchDto(await this.findBatch(id))
  }

  async scrapBatch(request: RequestWithAdmin, id: string, value: ScrapCoreBatchBody | unknown) {
    await this.assertBatchVisible(request, id)
    const body = requestBody(value) as ScrapCoreBatchBody
    const versionNo = requiredVersion(body.versionNo)
    const reason = textValue(body.reason, '报废原因', true)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lockBatchRecord(tx, id)
      const batch = await tx.coreInventoryBatch.findUnique({ where: { id } })
      if (!batch) throw new NotFoundException('砂芯批次不存在')
      if (batch.versionNo !== versionNo) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      if (['SCRAPPED', 'CONSUMED'].includes(batch.status) || batch.currentQuantity <= 0) throw new ConflictException('当前砂芯批次无可报废库存')
      const scrappedAt = new Date()
      const updated = await tx.coreInventoryBatch.updateMany({
        where: { id, versionNo, currentQuantity: { gt: 0 }, status: { notIn: ['SCRAPPED', 'CONSUMED'] } },
        data: {
          currentQuantity: 0,
          status: 'SCRAPPED',
          scrappedByUserId: user.id,
          scrappedAt,
          scrapReason: reason,
          versionNo: { increment: 1 },
        },
      })
      if (!updated.count) throw new ConflictException('砂芯批次已被其他用户更新，请刷新后重试')
      await tx.coreInventoryLedger.create({
        data: {
          batchId: id,
          action: 'SCRAPPED',
          quantityChange: -batch.currentQuantity,
          quantityAfter: 0,
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
          reason,
        },
      })
    })
    return this.batchDto(await this.findBatch(id))
  }
}
