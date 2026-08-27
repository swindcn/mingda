import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { CoreBatchStatus, MoldingTaskStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  getAdminContext,
  hasAdminPermission,
  visibleOwnershipEntityIds,
  type AdminContext,
  type RequestWithAdmin,
} from '../shared/admin-context'
import {
  allocateCoreBatchesWithOverdraft,
  calculateCoreDemandPerBox,
  calculateMoldingStartReadiness,
  calculateOverproduction,
  calculatePlannedBoxes,
  calculateReportCoreDemand,
} from './molding.calculations'
import { createPouringMoldBatchForReport } from './pouring.queue'
import type {
  CancelMoldingTaskBody,
  CreateMoldingTaskBody,
  DispatchMoldingTaskBody,
  MoldingTaskPreviewBody,
  ReportMoldingTaskBody,
  ReverseMoldingReportBody,
  StartMoldingTaskBody,
} from './molding.types'

type DatabaseClient = PrismaService | Prisma.TransactionClient

export interface CoreRequirementSnapshot {
  coreBoxCode: string
  coreBoxName: string
  quantityPerProduct: number
  quantityPerBox: number
  requiredQuantity: number
}

function bodyRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求体格式不正确')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new BadRequestException(`${label}格式不正确`)
  const result = String(value || '').trim()
  if (required && !result) throw new BadRequestException(`请填写${label}`)
  return result
}

function integer(value: unknown, label: string, minimum = 0) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2_147_483_647) {
    throw new BadRequestException(`${label}必须为${minimum > 0 ? '正' : '非负'}整数`)
  }
  return value
}

function version(value: unknown) {
  return integer(value, '数据版本', 1)
}

function dateTime(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null
  const result = new Date(String(value))
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${label}格式不正确`)
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

function serializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && String(error.meta?.code || '') === '40001'))
}

function coreRequirements(value: Prisma.JsonValue): CoreRequirementSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => item as unknown as CoreRequirementSnapshot)
}

@Injectable()
export class MoldingService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdministrator(user: AdminContext) {
    return user.username === 'admin' || user.userType === 'SUPER_ADMIN'
  }

  private taskInclude(includeReports = false) {
    return {
      workOrder: { select: { id: true, code: true, productionStatus: true } },
      productionLine: { include: { workshop: true } },
      team: { include: { members: { select: { userId: true } }, workshop: true } },
      createdBy: { select: { id: true, name: true } },
      startedBy: { select: { id: true, name: true } },
      completedBy: { select: { id: true, name: true } },
      canceledBy: { select: { id: true, name: true } },
      ...(includeReports ? {
        reports: {
          include: {
            operator: { select: { id: true, name: true } },
            reversedBy: { select: { id: true, name: true } },
            defects: { include: { defectCode: true }, orderBy: { createdAt: 'asc' as const } },
            coreConsumptions: {
              include: { coreInventoryBatch: { select: { id: true, code: true, status: true } } },
              orderBy: { createdAt: 'asc' as const },
            },
          },
          orderBy: { reportedAt: 'asc' as const },
        },
      } : { _count: { select: { reports: { where: { status: 'ACTIVE' as const } } } } }),
    }
  }

  private workOrderInclude() {
    return {
      bomVersion: {
        include: {
          bom: true,
          molds: { include: { mold: true } },
          coreBoxes: { include: { coreBox: true } },
        },
      },
      routingVersion: {
        include: {
          routing: true,
          nodes: { include: { operation: true }, orderBy: { seqNo: 'asc' as const } },
        },
      },
      moldingTasks: { select: { id: true, code: true, routingNodeId: true, status: true } },
    }
  }

  private async assertWorkOrderVisible(request: RequestWithAdmin, id: string) {
    const ids = await visibleOwnershipEntityIds(this.prisma, getAdminContext(request), 'production:work-orders')
    if (ids !== null && !ids.includes(id)) throw new NotFoundException('生产工单不存在')
  }

  private async assertTaskAccess(request: RequestWithAdmin, id: string, mobile: boolean) {
    const user = getAdminContext(request)
    if (mobile) {
      if (this.isAdministrator(user)) return
      const count = await this.prisma.moldingTask.count({ where: { id, team: { members: { some: { userId: user.id } } } } })
      if (!count) throw new NotFoundException('造型下芯任务不存在')
      return
    }
    const ids = await visibleOwnershipEntityIds(this.prisma, user, 'production:molding_tasks')
    if (ids !== null && !ids.includes(id)) throw new NotFoundException('造型下芯任务不存在')
  }

  private async loadWorkOrder(client: DatabaseClient, id: string) {
    const record = await client.workOrder.findUnique({ where: { id }, include: this.workOrderInclude() })
    if (!record) throw new NotFoundException('生产工单不存在')
    return record
  }

  private moldingNodes(workOrder: Awaited<ReturnType<MoldingService['loadWorkOrder']>>) {
    return workOrder.routingVersion.nodes.filter((node) => node.operation.section === '造型')
  }

  private selectNode(workOrder: Awaited<ReturnType<MoldingService['loadWorkOrder']>>, requestedId?: string) {
    const nodes = this.moldingNodes(workOrder)
    if (!nodes.length) throw new BadRequestException('该工单锁定的工艺路线不包含造型工序')
    if (requestedId) {
      const node = nodes.find((item) => item.id === requestedId)
      if (!node) throw new BadRequestException('所选造型工序不属于工单锁定路线')
      return node
    }
    if (nodes.length > 1) throw new BadRequestException('工艺路线包含多个造型工序，请选择具体工序')
    return nodes[0]
  }

  private validateGeneration(workOrder: Awaited<ReturnType<MoldingService['loadWorkOrder']>>) {
    if (workOrder.bomVersion.status !== 'ACTIVE') throw new BadRequestException('工单锁定的 BOM 不是已生效状态')
    if (['COMPLETED', 'CLOSED'].includes(workOrder.productionStatus)) throw new BadRequestException('已完成或已关闭工单不能生成造型任务')
  }

  private moldOptions(workOrder: Awaited<ReturnType<MoldingService['loadWorkOrder']>>) {
    return workOrder.bomVersion.molds
      .filter((link) => link.mold.status === '启用' && Number(link.mold.cavityCount || 0) > 0)
      .map((link) => ({ code: link.moldCode, name: link.moldNameSnapshot || link.mold.name, cavityCount: Number(link.mold.cavityCount) }))
  }

  private buildRequirements(workOrder: Awaited<ReturnType<MoldingService['loadWorkOrder']>>, moldCode: string, planBoxQty: number, cavityCount: number) {
    return workOrder.bomVersion.coreBoxes
      .filter((item) => item.coreBox.status === '启用' && item.coreBox.moldCode === moldCode)
      .map((item) => {
        const quantityPerProduct = Number(item.quantityPerProduct)
        const quantityPerBox = calculateCoreDemandPerBox(item.quantityPerProduct, cavityCount)
        return {
          coreBoxCode: item.coreBoxCode,
          coreBoxName: item.coreBoxNameSnapshot || item.coreBox.name,
          quantityPerProduct,
          quantityPerBox,
          requiredQuantity: planBoxQty * quantityPerBox,
        }
      })
  }

  private async assignmentOptions(client: DatabaseClient) {
    const lines = await client.productionLine.findMany({
      where: { status: '启用', workshop: { status: '启用', type: '造型' } },
      include: { workshop: true },
      orderBy: [{ workshopCode: 'asc' }, { code: 'asc' }],
    })
    const workshopCodes = Array.from(new Set(lines.map((line) => line.workshopCode)))
    const teams = await client.team.findMany({
      where: { status: '启用', workshopCode: { in: workshopCodes }, workshop: { status: '启用' } },
      include: { workshop: true },
      orderBy: [{ workshopCode: 'asc' }, { code: 'asc' }],
    })
    return { lines, teams }
  }

  private async validateAssignment(client: DatabaseClient, productionLineCode: string, teamCode?: string) {
    const line = await client.productionLine.findUnique({ where: { code: productionLineCode }, include: { workshop: true } })
    if (!line || line.status !== '启用' || line.workshop.status !== '启用' || line.workshop.type !== '造型') throw new BadRequestException('请选择造型车间的启用生产线')
    const team = teamCode ? await client.team.findUnique({ where: { code: teamCode }, include: { workshop: true } }) : null
    if (teamCode && (!team || team.status !== '启用' || team.workshop.status !== '启用')) throw new BadRequestException('所选班组不存在或已停用')
    if (team && team.workshopCode !== line.workshopCode) throw new BadRequestException('班组必须属于生产线所在车间')
    return { line, team }
  }

  async previewTask(request: RequestWithAdmin, workOrderId: string, value: MoldingTaskPreviewBody | unknown) {
    await this.assertWorkOrderVisible(request, workOrderId)
    const body = bodyRecord(value)
    const workOrder = await this.loadWorkOrder(this.prisma, workOrderId)
    this.validateGeneration(workOrder)
    const node = this.selectNode(workOrder, text(body.routingNodeId, '造型工序'))
    const molds = this.moldOptions(workOrder)
    if (!molds.length) throw new BadRequestException('当前生效 BOM 未配置可用模具或模具型腔数')
    const requestedMoldCode = text(body.moldCode, '模具')
    const selectedMold = requestedMoldCode ? molds.find((item) => item.code === requestedMoldCode) : molds.length === 1 ? molds[0] : null
    if (requestedMoldCode && !selectedMold) throw new BadRequestException('所选模具不属于工单锁定 BOM')
    const planBoxQty = selectedMold ? calculatePlannedBoxes(workOrder.plannedQuantity, selectedMold.cavityCount) : null
    const requirements = selectedMold && planBoxQty ? this.buildRequirements(workOrder, selectedMold.code, planBoxQty, selectedMold.cavityCount) : []
    const assignment = await this.assignmentOptions(this.prisma)
    return {
      workOrderId,
      workOrderCode: workOrder.code,
      productCode: workOrder.productCodeSnapshot,
      productName: workOrder.productNameSnapshot,
      planPieceQty: workOrder.plannedQuantity,
      routingNodes: this.moldingNodes(workOrder).map((item) => ({ id: item.id, seqNo: item.seqNo, operationCode: item.operationCode, operationName: item.operation.name })),
      selectedRoutingNodeId: node.id,
      molds,
      selectedMoldCode: selectedMold?.code || '',
      cavityCount: selectedMold?.cavityCount || null,
      planBoxQty,
      coreRequirements: requirements,
      existingTask: workOrder.moldingTasks.find((item) => item.routingNodeId === node.id) || null,
      productionLines: assignment.lines.map((line) => ({ code: line.code, name: line.name, workshopCode: line.workshopCode, workshopName: line.workshop.name })),
      teams: assignment.teams.map((team) => ({ code: team.code, name: team.name, workshopCode: team.workshopCode, workshopName: team.workshop.name })),
    }
  }

  private async nextCode(tx: Prisma.TransactionClient, documentType: 'MOLDING_TASK' | 'MOLDING_REPORT', prefix: string) {
    const current = businessDate()
    const [sequence] = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
      INSERT INTO "DocumentSequence" ("documentType", "businessDate", "currentValue", "updatedAt")
      VALUES (${documentType}, ${current.date}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("documentType", "businessDate") DO UPDATE
      SET "currentValue" = "DocumentSequence"."currentValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "currentValue"
    `)
    return `${prefix}-${current.key}-${String(sequence.currentValue).padStart(3, '0')}`
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (serializableConflict(error) && attempt < 2) continue
        if (serializableConflict(error)) throw new ConflictException('数据并发冲突，请重试')
        throw error
      }
    }
    throw new ConflictException('数据并发冲突，请重试')
  }

  private async lock(tx: Prisma.TransactionClient, table: 'WorkOrder' | 'MoldingTask' | 'MoldingReport' | 'CoreInventoryBatch', id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`)
    if (!rows.length) throw new NotFoundException('业务数据不存在')
  }

  async createTask(request: RequestWithAdmin, workOrderId: string, value: CreateMoldingTaskBody | unknown) {
    await this.assertWorkOrderVisible(request, workOrderId)
    const body = bodyRecord(value)
    const moldCode = text(body.moldCode, '模具', true)
    const productionLineCode = text(body.productionLineCode, '生产线', true)
    const teamCode = text(body.teamCode, '班组') || undefined
    const plannedStartAt = dateTime(body.plannedStartAt, '计划开始时间')
    const remark = text(body.remark, '备注') || null
    const routingNodeId = text(body.routingNodeId, '造型工序')
    const user = getAdminContext(request)
    try {
      const id = await this.serializable(async (tx) => {
        await this.lock(tx, 'WorkOrder', workOrderId)
        const workOrder = await this.loadWorkOrder(tx, workOrderId)
        this.validateGeneration(workOrder)
        const node = this.selectNode(workOrder, routingNodeId)
        const existing = await tx.moldingTask.findUnique({ where: { workOrderId_routingNodeId: { workOrderId, routingNodeId: node.id } } })
        if (existing) throw new ConflictException('当前工单的造型工序已生成任务')
        const mold = this.moldOptions(workOrder).find((item) => item.code === moldCode)
        if (!mold) throw new BadRequestException('所选模具不属于工单锁定 BOM')
        const assignment = await this.validateAssignment(tx, productionLineCode, teamCode)
        const planBoxQty = calculatePlannedBoxes(workOrder.plannedQuantity, mold.cavityCount)
        const requirements = this.buildRequirements(workOrder, moldCode, planBoxQty, mold.cavityCount)
        const record = await tx.moldingTask.create({
          data: {
            code: await this.nextCode(tx, 'MOLDING_TASK', 'MOLD'),
            workOrderId,
            bomVersionId: workOrder.bomVersionId,
            routingVersionId: workOrder.routingVersionId,
            routingNodeId: node.id,
            moldCode,
            productionLineCode,
            teamCode: teamCode || null,
            workOrderCodeSnapshot: workOrder.code,
            productCodeSnapshot: workOrder.productCodeSnapshot,
            productNameSnapshot: workOrder.productNameSnapshot,
            bomCodeSnapshot: workOrder.bomCodeSnapshot,
            bomVersionSnapshot: workOrder.bomVersionSnapshot,
            routingCodeSnapshot: workOrder.routingCodeSnapshot,
            routingNameSnapshot: workOrder.routingNameSnapshot,
            routingVersionSnapshot: workOrder.routingVersionSnapshot,
            operationCodeSnapshot: node.operationCode,
            operationNameSnapshot: node.operation.name,
            moldNameSnapshot: mold.name,
            cavityCountSnapshot: mold.cavityCount,
            productionLineNameSnapshot: assignment.line.name,
            workshopCodeSnapshot: assignment.line.workshopCode,
            workshopNameSnapshot: assignment.line.workshop.name,
            teamNameSnapshot: assignment.team?.name || null,
            planPieceQty: workOrder.plannedQuantity,
            planBoxQty,
            coreRequirementsSnapshot: requirements as unknown as Prisma.InputJsonValue,
            status: 'DISPATCHED',
            plannedStartAt,
            remark,
            createdByUserId: user.id,
          },
        })
        await tx.businessDataOwnership.create({
          data: {
            entityType: 'production:molding_tasks', entityId: record.id,
            createdByUserId: user.id, createdByDepartmentId: user.departmentId,
            ownerUserId: user.id, ownerDepartmentId: user.departmentId,
          },
        })
        return record.id
      })
      return this.getTask(request, id)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('造型任务已生成，请刷新后重试')
      throw error
    }
  }

  private async readiness(client: DatabaseClient, task: any) {
    const requirements = coreRequirements(task.coreRequirementsSnapshot)
    if (!requirements.length) return {
      ready: true,
      code: 'READY',
      requirements: [],
      startable: true,
      maxProducibleBoxQty: null,
      blockedReason: '',
    }
    const coreTasks = await client.coreProductionTask.findMany({
      where: { workOrderId: task.workOrderId, coreBoxCode: { in: requirements.map((item) => item.coreBoxCode) } },
      select: { coreBoxCode: true, status: true },
    })
    const completedCodes = new Set(coreTasks.filter((item) => item.status === 'COMPLETED').map((item) => item.coreBoxCode))
    const batches = await client.coreInventoryBatch.findMany({
      where: {
        report: { task: { workOrderId: task.workOrderId } },
        coreBoxCodeSnapshot: { in: requirements.map((item) => item.coreBoxCode) },
      },
      select: { coreBoxCodeSnapshot: true, currentQuantity: true, status: true, expiresAt: true },
    })
    const availableByCode = new Map<string, number>()
    const now = new Date()
    for (const batch of batches) {
      const eligiblePositive = ['AVAILABLE', 'WARNING'].includes(batch.status)
        && batch.currentQuantity > 0
        && (!batch.expiresAt || batch.expiresAt > now)
      const quantity = eligiblePositive || batch.currentQuantity < 0 ? batch.currentQuantity : 0
      availableByCode.set(batch.coreBoxCodeSnapshot, (availableByCode.get(batch.coreBoxCodeSnapshot) || 0) + quantity)
    }
    const remainingBoxQty = ['COMPLETED', 'CANCELED'].includes(task.status)
      ? 0
      : Math.max(0, task.planBoxQty - task.completedGoodQty)
    const rows = requirements.map((item) => {
      const netAvailable = availableByCode.get(item.coreBoxCode) || 0
      const available = Math.max(0, netAvailable)
      const remainingRequiredQuantity = remainingBoxQty * item.quantityPerBox
      return {
        ...item,
        remainingRequiredQuantity,
        coreTaskCompleted: completedCodes.has(item.coreBoxCode),
        available,
        shortage: Math.max(0, remainingRequiredQuantity - netAvailable),
      }
    })
    const startReadiness = calculateMoldingStartReadiness(rows)
    if (rows.some((item) => !item.coreTaskCompleted)) return { ready: false, code: 'WAITING_CORE_TASK', requirements: rows, ...startReadiness }
    if (rows.some((item) => item.shortage > 0)) return { ready: false, code: 'INSUFFICIENT_CORE', requirements: rows, ...startReadiness }
    return { ready: true, code: 'READY', requirements: rows, ...startReadiness }
  }

  private taskDto(record: any, user: AdminContext, readiness: any, mobile: boolean) {
    const teamMember = Boolean(record.team?.members?.some((member: { userId: string }) => member.userId === user.id))
    const canOperate = !mobile || this.isAdministrator(user) || teamMember
    const canStartWithPermission = canOperate && hasAdminPermission(user, mobile ? 'mini.production.molding.start' : 'production.molding.start')
    const activeReports = record.reports ? record.reports.filter((report: any) => report.status === 'ACTIVE') : []
    const reportCount = record._count?.reports ?? activeReports.length
    const dispatchable = ['PENDING', 'DISPATCHED'].includes(record.status) && reportCount === 0
    const allowedActions = {
      dispatch: dispatchable && hasAdminPermission(user, 'production.molding.dispatch'),
      start: record.status === 'DISPATCHED' && readiness.startable && canStartWithPermission,
      report: record.status === 'IN_PROGRESS' && canOperate && hasAdminPermission(user, mobile ? 'mini.production.molding.report' : 'production.molding.report'),
      cancel: dispatchable && hasAdminPermission(user, 'production.molding.cancel'),
      reverse: !mobile && hasAdminPermission(user, 'production.molding.reverse'),
    }
    return {
      id: record.id,
      code: record.code,
      workOrderId: record.workOrderId,
      workOrderCode: record.workOrderCodeSnapshot,
      productCode: record.productCodeSnapshot,
      productName: record.productNameSnapshot,
      bomCode: record.bomCodeSnapshot,
      bomVersion: record.bomVersionSnapshot,
      routingCode: record.routingCodeSnapshot,
      routingName: record.routingNameSnapshot,
      routingVersion: record.routingVersionSnapshot,
      operationCode: record.operationCodeSnapshot,
      operationName: record.operationNameSnapshot,
      routingNodeId: record.routingNodeId,
      moldCode: record.moldCode,
      moldName: record.moldNameSnapshot,
      cavityCount: record.cavityCountSnapshot,
      productionLineCode: record.productionLineCode,
      productionLineName: record.productionLineNameSnapshot,
      workshopCode: record.workshopCodeSnapshot,
      workshopName: record.workshopNameSnapshot,
      teamCode: record.teamCode || '',
      teamName: record.teamNameSnapshot || '',
      planPieceQty: record.planPieceQty,
      planBoxQty: record.planBoxQty,
      completedGoodQty: record.completedGoodQty,
      completedScrapQty: record.completedScrapQty,
      overproductionQty: record.overproductionQty,
      coreRequirements: coreRequirements(record.coreRequirementsSnapshot),
      readiness,
      status: record.status,
      displayStatus: record.status,
      completionType: record.completionType || '',
      earlyCompletionReason: record.earlyCompletionReason || '',
      plannedStartAt: record.plannedStartAt?.toISOString() || '',
      startedAt: record.startedAt?.toISOString() || '',
      completedAt: record.completedAt?.toISOString() || '',
      canceledAt: record.canceledAt?.toISOString() || '',
      cancelReason: record.cancelReason || '',
      versionNo: record.versionNo,
      remark: record.remark || '',
      createdByName: record.createdBy?.name || '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      allowedActions,
      startBlockedReason: record.status === 'DISPATCHED' && canStartWithPermission && !readiness.startable ? readiness.blockedReason : '',
      startWarning: record.status === 'DISPATCHED' && readiness.startable && !readiness.ready && readiness.maxProducibleBoxQty !== null
        ? `砂芯未完全齐套，当前最多可生产 ${readiness.maxProducibleBoxQty} 箱`
        : '',
      ...(record.reports ? { reports: record.reports.map((report: any) => this.reportDto(report)) } : {}),
    }
  }

  private reportDto(report: any) {
    return {
      id: report.id,
      reportCode: report.reportCode,
      requestId: report.requestId,
      goodQty: report.goodQty,
      scrapQty: report.scrapQty,
      finishTask: report.finishTask,
      operatorName: report.operatorNameSnapshot,
      remark: report.remark || '',
      status: report.status,
      reportedAt: report.reportedAt.toISOString(),
      reversedByName: report.reversedBy?.name || '',
      reversedAt: report.reversedAt?.toISOString() || '',
      reverseReason: report.reverseReason || '',
      defects: (report.defects || []).map((item: any) => ({ code: item.defectCodeSnapshot, name: item.defectNameSnapshot, quantity: item.quantity, remark: item.remark || '' })),
      coreConsumptions: (report.coreConsumptions || []).map((item: any) => ({
        batchId: item.coreInventoryBatchId,
        batchCode: item.coreInventoryBatch?.code || '',
        coreBoxCode: item.coreBoxCodeSnapshot,
        quantity: item.quantity,
        quantityBefore: item.quantityBefore,
        quantityAfter: item.quantityAfter,
      })),
    }
  }

  async listTasks(request: RequestWithAdmin, filters: { keyword?: string; status?: string; workOrderId?: string }, mobile = false) {
    const user = getAdminContext(request)
    const visibleIds = mobile || this.isAdministrator(user) ? null : await visibleOwnershipEntityIds(this.prisma, user, 'production:molding_tasks')
    const keyword = filters.keyword?.trim()
    const records = await this.prisma.moldingTask.findMany({
      where: {
        ...(visibleIds !== null ? { id: { in: visibleIds } } : {}),
        ...(mobile && !this.isAdministrator(user) ? { team: { members: { some: { userId: user.id } } } } : {}),
        ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
        ...(filters.status && filters.status !== 'ALL' ? { status: filters.status as MoldingTaskStatus } : {}),
        ...(keyword ? { OR: [
          { code: { contains: keyword, mode: 'insensitive' } },
          { workOrderCodeSnapshot: { contains: keyword, mode: 'insensitive' } },
          { productCodeSnapshot: { contains: keyword, mode: 'insensitive' } },
          { productNameSnapshot: { contains: keyword, mode: 'insensitive' } },
        ] } : {}),
      },
      include: this.taskInclude(false),
      orderBy: { createdAt: 'desc' },
    })
    return Promise.all(records.map(async (record) => this.taskDto(record, user, await this.readiness(this.prisma, record), mobile)))
  }

  async getTask(request: RequestWithAdmin, id: string, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const record = await this.prisma.moldingTask.findUnique({ where: { id }, include: this.taskInclude(true) })
    if (!record) throw new NotFoundException('造型下芯任务不存在')
    return this.taskDto(record, getAdminContext(request), await this.readiness(this.prisma, record), mobile)
  }

  async getTaskByCode(request: RequestWithAdmin, code: string) {
    const record = await this.prisma.moldingTask.findUnique({ where: { code }, select: { id: true } })
    if (!record) throw new NotFoundException('造型下芯任务不存在')
    return this.getTask(request, record.id, true)
  }

  async defectOptions(request: RequestWithAdmin, id: string, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const task = await this.prisma.moldingTask.findUnique({ where: { id }, select: { operationCodeSnapshot: true } })
    if (!task) throw new NotFoundException('造型下芯任务不存在')
    const defects = await this.prisma.defectCode.findMany({
      where: { status: '启用', operations: { some: { operationCode: task.operationCodeSnapshot } } },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    })
    return defects.map((item) => ({ code: item.code, name: item.name, category: item.category }))
  }

  async dispatchTask(request: RequestWithAdmin, id: string, value: DispatchMoldingTaskBody | unknown) {
    await this.assertTaskAccess(request, id, false)
    const body = bodyRecord(value)
    const expectedVersion = version(body.versionNo)
    const productionLineCode = text(body.productionLineCode, '生产线', true)
    const teamCode = text(body.teamCode, '班组') || undefined
    const plannedStartAt = dateTime(body.plannedStartAt, '计划开始时间')
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', id)
      const task = await tx.moldingTask.findUnique({ where: { id }, include: { _count: { select: { reports: { where: { status: 'ACTIVE' } } } } } })
      if (!task) throw new NotFoundException('造型下芯任务不存在')
      if (task.versionNo !== expectedVersion) throw new ConflictException('数据已更新，请刷新后重试')
      if (!['PENDING', 'DISPATCHED'].includes(task.status) || task._count.reports > 0) throw new BadRequestException('当前任务不能调整派工')
      const assignment = await this.validateAssignment(tx, productionLineCode, teamCode)
      await tx.moldingTask.update({
        where: { id },
        data: {
          productionLineCode,
          productionLineNameSnapshot: assignment.line.name,
          workshopCodeSnapshot: assignment.line.workshopCode,
          workshopNameSnapshot: assignment.line.workshop.name,
          teamCode: teamCode || null,
          teamNameSnapshot: assignment.team?.name || null,
          plannedStartAt,
          status: 'DISPATCHED',
          versionNo: { increment: 1 },
        },
      })
    })
    return this.getTask(request, id)
  }

  async startTask(request: RequestWithAdmin, id: string, value: StartMoldingTaskBody | unknown, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const expectedVersion = version(bodyRecord(value).versionNo)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', id)
      const task = await tx.moldingTask.findUnique({ where: { id }, include: { team: { include: { members: true } } } })
      if (!task) throw new NotFoundException('造型下芯任务不存在')
      if (task.versionNo !== expectedVersion) throw new ConflictException('数据已更新，请刷新后重试')
      if (task.status !== 'DISPATCHED') throw new BadRequestException('当前任务不能开始生产')
      if (!task.teamCode) throw new BadRequestException('请先为任务分配执行班组')
      if (mobile && !this.isAdministrator(user) && !task.team?.members.some((member) => member.userId === user.id)) throw new NotFoundException('造型下芯任务不存在')
      const currentReadiness = await this.readiness(tx, task)
      if (!currentReadiness.startable) throw new BadRequestException(currentReadiness.blockedReason || '当前砂芯不能支持开工')
      await tx.moldingTask.update({ where: { id }, data: { status: 'IN_PROGRESS', startedByUserId: user.id, startedAt: new Date(), versionNo: { increment: 1 } } })
    })
    return this.getTask(request, id, mobile)
  }

  private parsedReport(value: ReportMoldingTaskBody | unknown) {
    const body = bodyRecord(value)
    const goodQty = integer(body.goodQty, '本次合格箱数')
    const scrapQty = integer(body.scrapQty, '本次废品箱数')
    if (typeof body.finishTask !== 'boolean') throw new BadRequestException('请选择完工状态')
    const earlyCompletionReason = text(body.earlyCompletionReason, '提前结束原因')
    if (goodQty + scrapQty === 0 && !body.finishTask) throw new BadRequestException('零数量报工仅用于结束任务')
    if (goodQty + scrapQty === 0 && !earlyCompletionReason) throw new BadRequestException('零数量结束任务必须填写结束原因')
    const defects = Array.isArray(body.defects) ? body.defects.map((item) => {
      const row = bodyRecord(item)
      return { defectCode: text(row.defectCode, '缺陷代码', true), quantity: integer(row.quantity, '缺陷数量', 1), remark: text(row.remark, '缺陷备注') || null }
    }) : []
    if (scrapQty > 0 && !defects.length) throw new BadRequestException('存在废品时必须选择缺陷代码')
    if (defects.reduce((sum, item) => sum + item.quantity, 0) !== scrapQty) throw new BadRequestException('缺陷数量合计必须等于本次废品箱数')
    if (new Set(defects.map((item) => item.defectCode)).size !== defects.length) throw new BadRequestException('同一缺陷代码不能重复填写')
    return {
      versionNo: version(body.versionNo),
      requestId: text(body.requestId, '请求标识', true),
      goodQty,
      scrapQty,
      finishTask: body.finishTask,
      earlyCompletionReason,
      defects,
      remark: text(body.remark, '备注') || null,
    }
  }

  private calculatedBatchStatus(batch: { currentQuantity: number; dryingRequired: boolean; driedAt: Date | null; expiresAt: Date | null; status: CoreBatchStatus }) {
    if (batch.currentQuantity <= 0) return CoreBatchStatus.CONSUMED
    if (batch.status === CoreBatchStatus.LOCKED) return CoreBatchStatus.LOCKED
    if (batch.dryingRequired && !batch.driedAt) return CoreBatchStatus.UNDRIED
    if (batch.expiresAt && batch.expiresAt <= new Date()) return CoreBatchStatus.EXPIRED
    if (batch.expiresAt && batch.expiresAt.getTime() - Date.now() <= 24 * 60 * 60 * 1000) return CoreBatchStatus.WARNING
    return CoreBatchStatus.AVAILABLE
  }

  async reportTask(request: RequestWithAdmin, id: string, value: ReportMoldingTaskBody | unknown, mobile = false) {
    await this.assertTaskAccess(request, id, mobile)
    const input = this.parsedReport(value)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', id)
      const existing = await tx.moldingReport.findUnique({ where: { taskId_requestId: { taskId: id, requestId: input.requestId } } })
      if (existing) return
      const task = await tx.moldingTask.findUnique({ where: { id }, include: { team: { include: { members: true } } } })
      if (!task) throw new NotFoundException('造型下芯任务不存在')
      if (task.versionNo !== input.versionNo) throw new ConflictException('数据已更新，请刷新后重试')
      if (task.status !== 'IN_PROGRESS') throw new BadRequestException('当前任务不能提交报工')
      if (mobile && !this.isAdministrator(user) && !task.team?.members.some((member) => member.userId === user.id)) throw new NotFoundException('造型下芯任务不存在')
      const nextGood = task.completedGoodQty + input.goodQty
      if (input.finishTask && nextGood < task.planBoxQty && !input.earlyCompletionReason) throw new BadRequestException('未达到计划数量时结束任务必须填写提前结束原因')
      const defectCodes = input.defects.map((item) => item.defectCode)
      const defects = defectCodes.length ? await tx.defectCode.findMany({
        where: { code: { in: defectCodes }, status: '启用', operations: { some: { operationCode: task.operationCodeSnapshot } } },
      }) : []
      if (defects.length !== defectCodes.length) throw new BadRequestException('所选缺陷代码不适用于当前造型工序')
      const report = await tx.moldingReport.create({
        data: {
          taskId: id,
          reportCode: await this.nextCode(tx, 'MOLDING_REPORT', 'MRP'),
          requestId: input.requestId,
          goodQty: input.goodQty,
          scrapQty: input.scrapQty,
          finishTask: input.finishTask,
          operatorUserId: user.id,
          operatorNameSnapshot: user.name,
          remark: input.remark,
          defects: {
            create: input.defects.map((item) => {
              const defect = defects.find((record) => record.code === item.defectCode)!
              return { defectCodeId: defect.id, defectCodeSnapshot: defect.code, defectNameSnapshot: defect.name, quantity: item.quantity, remark: item.remark }
            }),
          },
        },
      })
      await createPouringMoldBatchForReport(tx, task, report)
      const requirements = coreRequirements(task.coreRequirementsSnapshot)
      for (const requirement of requirements) {
        const required = calculateReportCoreDemand(input.goodQty, input.scrapQty, requirement.quantityPerBox)
        if (required === 0) continue
        const batches = await tx.coreInventoryBatch.findMany({
          where: {
            report: { task: { workOrderId: task.workOrderId } },
            coreBoxCodeSnapshot: requirement.coreBoxCode,
          },
          orderBy: [{ createdAt: 'asc' }],
        })
        let allocations: Array<{ batchId: string; quantity: number }>
        try {
          allocations = allocateCoreBatchesWithOverdraft(required, batches.map((batch) => ({
            id: batch.id,
            quantity: batch.currentQuantity,
            status: batch.status,
            expiresAt: batch.expiresAt,
            producedAt: batch.createdAt,
          })))
        } catch (error) {
          throw new BadRequestException(error instanceof Error ? error.message : '砂芯库存分配失败')
        }
        for (const allocation of allocations) {
          await this.lock(tx, 'CoreInventoryBatch', allocation.batchId)
          const batch = await tx.coreInventoryBatch.findUnique({ where: { id: allocation.batchId } })
          if (!batch || !['AVAILABLE', 'WARNING', 'CONSUMED'].includes(batch.status)) {
            throw new ConflictException('砂芯库存已变化，请刷新后重试')
          }
          const quantityAfter = batch.currentQuantity - allocation.quantity
          const nextStatus = this.calculatedBatchStatus({ ...batch, currentQuantity: quantityAfter })
          await tx.coreInventoryBatch.update({
            where: { id: batch.id },
            data: { currentQuantity: quantityAfter, status: nextStatus, versionNo: { increment: 1 } },
          })
          await tx.moldingCoreConsumption.create({
            data: {
              reportId: report.id,
              coreInventoryBatchId: batch.id,
              workOrderId: task.workOrderId,
              coreBoxCodeSnapshot: requirement.coreBoxCode,
              quantity: allocation.quantity,
              quantityBefore: batch.currentQuantity,
              quantityAfter,
            },
          })
          await tx.coreInventoryLedger.create({
            data: {
              batchId: batch.id,
              action: 'CONSUMED',
              quantityChange: -allocation.quantity,
              quantityAfter,
              sourceType: 'MOLDING_REPORT',
              sourceId: report.id,
              operatorUserId: user.id,
              operatorNameSnapshot: user.name,
              reason: `造型报工 ${report.reportCode}`,
            },
          })
        }
      }
      const completed = input.finishTask || nextGood >= task.planBoxQty
      const zeroQuantityClose = input.finishTask && input.goodQty + input.scrapQty === 0
      await tx.moldingTask.update({
        where: { id },
        data: {
          completedGoodQty: nextGood,
          completedScrapQty: task.completedScrapQty + input.scrapQty,
          overproductionQty: calculateOverproduction(task.planBoxQty, nextGood),
          status: completed ? 'COMPLETED' : 'IN_PROGRESS',
          completionType: completed ? (nextGood < task.planBoxQty ? 'SHORT' : 'NORMAL') : null,
          earlyCompletionReason: completed && (nextGood < task.planBoxQty || zeroQuantityClose) ? input.earlyCompletionReason : null,
          completedByUserId: completed ? user.id : null,
          completedAt: completed ? new Date() : null,
          versionNo: { increment: 1 },
        },
      })
    })
    return this.getTask(request, id, mobile)
  }

  async reverseReport(request: RequestWithAdmin, reportId: string, value: ReverseMoldingReportBody | unknown) {
    const body = bodyRecord(value)
    const expectedVersion = version(body.versionNo)
    const reason = text(body.reason, '撤销原因', true)
    const reportRef = await this.prisma.moldingReport.findUnique({ where: { id: reportId }, select: { taskId: true } })
    if (!reportRef) throw new NotFoundException('造型报工记录不存在')
    await this.assertTaskAccess(request, reportRef.taskId, false)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingReport', reportId)
      const report = await tx.moldingReport.findUnique({
        where: { id: reportId },
        include: {
          task: true,
          coreConsumptions: true,
          pouringMoldBatch: {
            include: { consumptions: { include: { pouringReport: { select: { status: true } } } } },
          },
        },
      })
      if (!report) throw new NotFoundException('造型报工记录不存在')
      await this.lock(tx, 'MoldingTask', report.taskId)
      if (report.task.versionNo !== expectedVersion) throw new ConflictException('数据已更新，请刷新后重试')
      if (report.status === 'REVERSED') throw new BadRequestException('该报工已经撤销')
      if (report.pouringMoldBatch?.consumptions.some((item) => item.pouringReport.status === 'ACTIVE')) {
        throw new BadRequestException('该造型报工已进入浇注追溯，请先撤销浇注报工')
      }
      for (const consumption of report.coreConsumptions) {
        await this.lock(tx, 'CoreInventoryBatch', consumption.coreInventoryBatchId)
        const batch = await tx.coreInventoryBatch.findUnique({ where: { id: consumption.coreInventoryBatchId } })
        if (!batch) throw new NotFoundException('原砂芯批次不存在，不能撤销')
        if (batch.status === 'SCRAPPED') throw new BadRequestException(`砂芯批次 ${batch.code} 已报废，不能直接撤销`)
        const currentQuantity = batch.currentQuantity + consumption.quantity
        const nextStatus = this.calculatedBatchStatus({ ...batch, currentQuantity })
        await tx.coreInventoryBatch.update({ where: { id: batch.id }, data: { currentQuantity, status: nextStatus, versionNo: { increment: 1 } } })
        await tx.coreInventoryLedger.create({
          data: {
            batchId: batch.id,
            action: 'ADJUSTED',
            quantityChange: consumption.quantity,
            quantityAfter: currentQuantity,
            sourceType: 'MOLDING_REPORT_REVERSAL',
            sourceId: report.id,
            operatorUserId: user.id,
            operatorNameSnapshot: user.name,
            reason,
          },
        })
      }
      await tx.moldingReport.update({ where: { id: reportId }, data: { status: 'REVERSED', reversedByUserId: user.id, reversedAt: new Date(), reverseReason: reason } })
      if (report.pouringMoldBatch) {
        await tx.pouringMoldBatch.update({
          where: { id: report.pouringMoldBatch.id },
          data: { status: 'CANCELED', versionNo: { increment: 1 } },
        })
      }
      const totals = await tx.moldingReport.aggregate({
        where: { taskId: report.taskId, status: 'ACTIVE' },
        _sum: { goodQty: true, scrapQty: true },
      })
      const good = totals._sum.goodQty || 0
      const scrap = totals._sum.scrapQty || 0
      const completed = good >= report.task.planBoxQty
      await tx.moldingTask.update({
        where: { id: report.taskId },
        data: {
          completedGoodQty: good,
          completedScrapQty: scrap,
          overproductionQty: calculateOverproduction(report.task.planBoxQty, good),
          status: completed ? 'COMPLETED' : 'IN_PROGRESS',
          completionType: completed ? 'NORMAL' : null,
          earlyCompletionReason: null,
          completedByUserId: null,
          completedAt: completed ? report.task.completedAt : null,
          versionNo: { increment: 1 },
        },
      })
    })
    return this.getTask(request, reportRef.taskId)
  }

  async cancelTask(request: RequestWithAdmin, id: string, value: CancelMoldingTaskBody | unknown) {
    await this.assertTaskAccess(request, id, false)
    const body = bodyRecord(value)
    const expectedVersion = version(body.versionNo)
    const reason = text(body.reason, '取消原因', true)
    const user = getAdminContext(request)
    await this.serializable(async (tx) => {
      await this.lock(tx, 'MoldingTask', id)
      const task = await tx.moldingTask.findUnique({ where: { id }, include: { _count: { select: { reports: { where: { status: 'ACTIVE' } } } } } })
      if (!task) throw new NotFoundException('造型下芯任务不存在')
      if (task.versionNo !== expectedVersion) throw new ConflictException('数据已更新，请刷新后重试')
      if (!['PENDING', 'DISPATCHED'].includes(task.status) || task._count.reports > 0) throw new BadRequestException('当前任务不能取消')
      await tx.moldingTask.update({ where: { id }, data: { status: 'CANCELED', cancelReason: reason, canceledByUserId: user.id, canceledAt: new Date(), versionNo: { increment: 1 } } })
    })
    return this.getTask(request, id)
  }
}
