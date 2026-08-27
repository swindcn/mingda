import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAdminContext, visibleOwnershipEntityIds, type RequestWithAdmin } from '../shared/admin-context'
import type {
  DispatchStatus,
  ExecutionModule,
  RoutingExecutionAllocationContext,
  RoutingExecutionHeatContext,
  RoutingExecutionNodeContext,
  RoutingExecutionQueueContext,
  RoutingExecutionTaskContext,
  RoutingNodeAction,
  MeltReleaseResult,
  WorkOrderRoutingExecutionWarning,
  WorkOrderExecutionContext,
  WorkOrderRoutingExecutionNode,
} from './work-order-routing-execution.types'

const dispatchLabels: Record<DispatchStatus, string> = {
  PENDING: '待下达',
  PARTIAL: '部分下达',
  RELEASED: '已下达',
  WAITING_UPSTREAM: '等待上游',
  UNSUPPORTED: '未接入',
}

const progressLabels: Record<string, string> = {
  NOT_STARTED: '-',
  WAITING: '待生产',
  WAITING_DISPATCH: '待派工',
  WAITING_SCHEDULE: '待排产',
  IN_PROGRESS: '生产中',
  TRANSFERRING: '转运中',
  PARTIAL_COMPLETED: '部分完成',
  COMPLETED: '已完成',
  CANCELED: '已取消',
}

function numberValue(value: unknown) {
  const result = Number(value || 0)
  return Number.isFinite(result) ? result : 0
}

function uniqueNames(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

export function classifyExecutionModule(input: { code?: string | null; section?: string | null }): ExecutionModule {
  const code = String(input.code || '').trim().toUpperCase()
  const section = String(input.section || '').trim()
  if (code === 'OP-CORE' || section === '制芯') return 'CORE'
  if (code === 'OP-MELT' || section === '熔炼') return 'MELT'
  if (code === 'OP-MOLD' || section === '造型') return 'MOLDING'
  if (code === 'OP-POUR') return 'POURING'
  if (code === 'OP-SHAKE') return 'SHAKE_CLEAN'
  if (code === 'OP-INSP') return 'INSPECTION'
  return 'UNSUPPORTED'
}

export function summarizeStatuses(statuses: string[]) {
  const values = statuses.map((status) => String(status || '').trim().toUpperCase()).filter(Boolean)
  if (!values.length) return { progressStatus: 'NOT_STARTED', progressLabel: progressLabels.NOT_STARTED }
  if (values.every((status) => status === 'CANCELED')) return { progressStatus: 'CANCELED', progressLabel: progressLabels.CANCELED }
  const normalized = values.map((status) => status === 'CONSUMED' ? 'COMPLETED' : status)
  if (normalized.every((status) => status === 'COMPLETED')) return { progressStatus: 'COMPLETED', progressLabel: progressLabels.COMPLETED }
  if (normalized.some((status) => ['COMPLETED', 'PARTIAL_COMPLETED', 'PARTIAL'].includes(status))) {
    return { progressStatus: 'PARTIAL_COMPLETED', progressLabel: progressLabels.PARTIAL_COMPLETED }
  }
  if (values.some((status) => status === 'TRANSFERRING')) return { progressStatus: 'TRANSFERRING', progressLabel: progressLabels.TRANSFERRING }
  if (values.some((status) => status === 'IN_PROGRESS')) return { progressStatus: 'IN_PROGRESS', progressLabel: progressLabels.IN_PROGRESS }
  if (values.some((status) => ['DISPATCHED', 'PENDING_DISPATCH'].includes(status))) {
    return { progressStatus: 'WAITING_DISPATCH', progressLabel: progressLabels.WAITING_DISPATCH }
  }
  return { progressStatus: 'WAITING', progressLabel: progressLabels.WAITING }
}

export function releasedMeltRoutingNodeIds(record: any): string[] {
  const meltNodes = (record.routingVersion?.nodes || []).filter((node: any) => classifyExecutionModule({ code: node.operationCode, section: node.operation?.section }) === 'MELT')
  const nodeIds = new Set(meltNodes.map((node: any) => node.id))
  const releasedNodeIds = Array.from(new Set<string>((record.meltReleases || [])
    .map((release: any) => String(release.routingNodeId || '').trim())
    .filter((id: string) => nodeIds.has(id))))
  if (releasedNodeIds.length) return releasedNodeIds
  return meltNodes.length === 1 && record.meltReleasedAt ? [meltNodes[0].id] : []
}

function baseNode(node: RoutingExecutionNodeContext, module: ExecutionModule, dispatchStatus: DispatchStatus, action: RoutingNodeAction, permission: string, hint = ''): WorkOrderRoutingExecutionNode {
  const progress = summarizeStatuses([])
  return {
    nodeId: node.id,
    seqNo: node.seqNo,
    operationCode: node.operationCode,
    operationName: node.operation?.name || node.operationCode,
    module,
    dispatchStatus,
    dispatchLabel: dispatchLabels[dispatchStatus],
    progressStatus: progress.progressStatus,
    progressLabel: progress.progressLabel,
    progressText: progress.progressLabel,
    progressCurrent: null,
    progressTotal: null,
    progressUnit: '件',
    equipmentNames: [],
    teamNames: [],
    taskCount: 0,
    action,
    actionEnabled: action !== 'WAIT' && action !== 'NONE',
    actionPermission: permission,
    actionHint: hint,
  }
}

function applyProgress(node: WorkOrderRoutingExecutionNode, statuses: string[], current: number | null, total: number | null, unit = '件', text?: string) {
  const progress = summarizeStatuses(statuses)
  node.progressStatus = progress.progressStatus
  node.progressLabel = progress.progressLabel
  node.progressText = text || progress.progressLabel
  node.progressCurrent = current
  node.progressTotal = total
  node.progressUnit = unit
  return node
}

function actualEquipment(task: RoutingExecutionTaskContext) {
  return task.equipmentNameSnapshot || task.productionLineNameSnapshot || task.equipmentCode || task.productionLineCode || ''
}

function actualTeam(task: RoutingExecutionTaskContext) {
  return task.teamNameSnapshot || task.teamCode || ''
}

function coreTaskTotal(task: RoutingExecutionTaskContext) {
  return numberValue(task.plannedQuantity)
}

function sumQueueProgress(rows: RoutingExecutionQueueContext[]) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.originalQuantity), 0)
  const remaining = rows.reduce((sum, row) => sum + numberValue(row.remainingQuantity), 0)
  return { current: Math.max(0, total - remaining), total }
}

function queueRowsForNode(rows: RoutingExecutionQueueContext[] | null | undefined, nodeId: string, field: keyof RoutingExecutionQueueContext) {
  return (rows || []).filter((row) => String(row[field] || row.routingNodeId || '') === nodeId)
}

function heatOrderForAllocation(allocation: RoutingExecutionAllocationContext): RoutingExecutionHeatContext | null {
  return allocation.heatOrder || null
}

function permissionAllowed(permission: string, permissions?: string[]) {
  if (!permissions) return true
  return !permission || permissions.includes('*') || permissions.includes(permission)
}

export function summarizeWorkOrderExecution(workOrder: WorkOrderExecutionContext, permissions?: string[]): WorkOrderRoutingExecutionNode[] {
  return [...(workOrder.routingVersion?.nodes || [])]
    .sort((left, right) => left.seqNo - right.seqNo)
    .map((node) => {
      const module = classifyExecutionModule({ code: node.operationCode, section: node.operation?.section })
      if (module === 'CORE') return summarizeCore(workOrder, node)
      if (module === 'MELT') return summarizeMelt(workOrder, node)
      if (module === 'MOLDING') return summarizeMolding(workOrder, node)
      if (module === 'POURING') return summarizePouring(workOrder, node)
      if (module === 'SHAKE_CLEAN') return summarizeShakeClean(workOrder, node)
      if (module === 'INSPECTION') return summarizeInspection(workOrder, node)
      return baseNode(node, 'UNSUPPORTED', 'UNSUPPORTED', 'NONE', '', '该工序暂未接入生产执行模块')
    })
    .map((node) => ({ ...node, actionEnabled: node.actionEnabled && permissionAllowed(node.actionPermission, permissions) }))
}

function summarizeCore(workOrder: WorkOrderExecutionContext, node: RoutingExecutionNodeContext) {
  const tasks = (workOrder.coreTasks || []).filter((task) => task.routingNodeId === node.id)
  const effectiveTasks = tasks.filter((task) => String(task.status || '').toUpperCase() !== 'CANCELED')
  const expected = new Set((workOrder.bomVersion?.coreBoxes || []).map((item) => item.coreBoxCode).filter(Boolean)).size
  const coveredCoreBoxes = new Set(tasks.map((task) => task.coreBoxCode).filter(Boolean)).size
  const dispatchStatus: DispatchStatus = !tasks.length ? 'PENDING' : expected > coveredCoreBoxes ? 'PARTIAL' : 'RELEASED'
  const action: RoutingNodeAction = dispatchStatus === 'PENDING' || dispatchStatus === 'PARTIAL' ? 'CREATE' : 'VIEW'
  const permission = action === 'CREATE' ? 'production.core_task.create' : 'production.core_task.view'
  const progressTasks = effectiveTasks.length ? effectiveTasks : tasks
  const result = baseNode(node, 'CORE', dispatchStatus, action, permission, expected > coveredCoreBoxes ? `仍有 ${expected - coveredCoreBoxes} 个芯盒未生成制芯任务` : '')
  const statuses = progressTasks.map((task) => task.status || '')
  const current = effectiveTasks.reduce((sum, task) => sum + numberValue(task.qualifiedQuantity), 0)
  const total = effectiveTasks.reduce((sum, task) => sum + coreTaskTotal(task), 0)
  result.taskCount = tasks.length
  result.equipmentNames = uniqueNames(effectiveTasks.map(actualEquipment))
  result.teamNames = uniqueNames(effectiveTasks.map(actualTeam))
  return applyProgress(result, statuses, effectiveTasks.length ? current : null, effectiveTasks.length ? total : null)
}

function summarizeMelt(workOrder: WorkOrderExecutionContext, node: RoutingExecutionNodeContext) {
  const meltNodes = (workOrder.routingVersion?.nodes || []).filter((item) => classifyExecutionModule({ code: item.operationCode, section: item.operation?.section }) === 'MELT')
  const nodeRelease = workOrder.meltReleases?.find((release) => release.routingNodeId === node.id)
  const legacySingleNodeRelease = meltNodes.length === 1 && meltNodes[0]?.id === node.id && Boolean(workOrder.meltReleasedAt)
  const released = Boolean(nodeRelease || legacySingleNodeRelease)
  const allocations = (released ? workOrder.allocations || [] : []).filter((allocation) => {
    if (allocation.workOrderId && allocation.workOrderId !== workOrder.id) return false
    if (allocation.routingNodeId) return allocation.routingNodeId === node.id
    return meltNodes.length === 1 && meltNodes[0]?.id === node.id
  })
  const allHeats = allocations.map(heatOrderForAllocation).filter((heat): heat is RoutingExecutionHeatContext => Boolean(heat))
  const activeAllocations = allocations.filter((allocation) => {
    const heat = heatOrderForAllocation(allocation)
    return Boolean(heat && heat.status !== 'CANCELED')
  })
  const activeHeats = activeAllocations.map(heatOrderForAllocation).filter((heat): heat is RoutingExecutionHeatContext => Boolean(heat && heat.status !== 'CANCELED'))
  const dispatchStatus: DispatchStatus = released ? 'RELEASED' : 'PENDING'
  const action: RoutingNodeAction = released ? 'VIEW' : 'RELEASE_MELT'
  const permission = action === 'RELEASE_MELT' ? 'production.schedule.release' : 'production.heat.view'
  const result = baseNode(node, 'MELT', dispatchStatus, action, permission)
  const statuses = activeHeats.length ? activeHeats.map((heat) => heat.status || 'WAITING') : allHeats.map((heat) => heat.status || 'WAITING')
  const current = meltNodes.length > 1
    ? activeAllocations.reduce((sum, allocation) => sum + numberValue(allocation.allocatedQuantity), 0)
    : numberValue(workOrder.meltCompletedQuantity)
  result.taskCount = allHeats.length
  result.equipmentNames = uniqueNames(activeHeats.map((heat) => heat.actualFurnaceNameSnapshot || heat.furnaceNameSnapshot || heat.actualFurnaceCode || heat.furnaceCode))
  result.teamNames = uniqueNames(activeHeats.map((heat) => heat.teamNameSnapshot || heat.teamCode))
  if (!activeHeats.length && released && allHeats.length === 0) {
    applyProgress(result, ['WAITING'], 0, workOrder.plannedQuantity, '件', '待排产')
  } else {
    applyProgress(result, statuses, activeHeats.length ? current : null, activeHeats.length ? workOrder.plannedQuantity : null)
  }
  return result
}

function summarizeMolding(workOrder: WorkOrderExecutionContext, node: RoutingExecutionNodeContext) {
  const tasks = (workOrder.moldingTasks || []).filter((task) => task.routingNodeId === node.id)
  const action: RoutingNodeAction = tasks.length ? 'VIEW' : 'CREATE'
  const permission = action === 'CREATE' ? 'production.molding.create' : 'production.molding.view'
  const result = baseNode(node, 'MOLDING', tasks.length ? 'RELEASED' : 'PENDING', action, permission)
  const current = tasks.reduce((sum, task) => sum + numberValue(task.completedGoodQty), 0)
  const total = tasks.reduce((sum, task) => sum + numberValue(task.planBoxQty || task.plannedQuantity), 0)
  result.taskCount = tasks.length
  result.equipmentNames = uniqueNames(tasks.map(actualEquipment))
  result.teamNames = uniqueNames(tasks.map(actualTeam))
  return applyProgress(result, tasks.map((task) => task.status || ''), tasks.length ? current : null, tasks.length ? total : null, '箱')
}

function summarizePouring(workOrder: WorkOrderExecutionContext, node: RoutingExecutionNodeContext) {
  const batches = queueRowsForNode(workOrder.pouringMoldBatches, node.id, 'pouringRoutingNodeId')
  const reports = queueRowsForNode(workOrder.pouringReports, node.id, 'pouringRoutingNodeId')
  const result = baseNode(node, 'POURING', batches.length ? 'RELEASED' : 'WAITING_UPSTREAM', batches.length ? 'VIEW' : 'WAIT', 'production.pouring.view', '等待造型下芯报工生成待浇注批次')
  const progress = sumQueueProgress(batches)
  result.taskCount = batches.length
  result.equipmentNames = uniqueNames(reports.map((row) => row.stationEquipmentNameSnapshot || row.stationEquipmentCode))
  return applyProgress(result, batches.length ? batches.map((batch) => batch.status || '') : [], batches.length ? progress.current : null, batches.length ? progress.total : null)
}

function summarizeShakeClean(workOrder: WorkOrderExecutionContext, node: RoutingExecutionNodeContext) {
  const shakes = queueRowsForNode(workOrder.shakeBatches, node.id, 'shakeRoutingNodeId')
  const cleanings = queueRowsForNode(workOrder.cleaningBatches, node.id, 'shakeRoutingNodeId')
  const shakeProgress = sumQueueProgress(shakes)
  const cleaningProgress = sumQueueProgress(cleanings)
  const reports = [...queueRowsForNode(workOrder.shakeReports, node.id, 'shakeRoutingNodeId'), ...queueRowsForNode(workOrder.cleaningReports, node.id, 'shakeRoutingNodeId')]
  const rows = [...shakes, ...cleanings]
  const result = baseNode(node, 'SHAKE_CLEAN', rows.length ? 'RELEASED' : 'WAITING_UPSTREAM', rows.length ? 'VIEW' : 'WAIT', 'production.shake_clean.view', '等待浇注报工生成待落砂批次')
  result.taskCount = rows.length
  result.equipmentNames = uniqueNames(reports.map((row) => row.stationEquipmentNameSnapshot || row.stationEquipmentCode))
  const text = cleanings.length
    ? `落砂 ${shakeProgress.current}/${shakeProgress.total} 件，清理 ${cleaningProgress.current}/${cleaningProgress.total} 件`
    : shakes.length ? `落砂 ${shakeProgress.current}/${shakeProgress.total} 件` : undefined
  const progressStatusRows = cleanings.length ? cleanings : shakes
  const progress = cleanings.length ? cleaningProgress : shakeProgress
  return applyProgress(result, progressStatusRows.map((row) => row.status || ''), rows.length ? progress.current : null, rows.length ? progress.total : null, '件', text)
}

function summarizeInspection(workOrder: WorkOrderExecutionContext, node: RoutingExecutionNodeContext) {
  const batches = queueRowsForNode(workOrder.inspectionBatches, node.id, 'inspectionRoutingNodeId')
  const result = baseNode(node, 'INSPECTION', batches.length ? 'RELEASED' : 'WAITING_UPSTREAM', batches.length ? 'VIEW' : 'WAIT', 'production.inspection.view', '等待落砂清理报工生成待检批次')
  const progress = sumQueueProgress(batches)
  result.taskCount = batches.length
  return applyProgress(result, batches.length ? batches.map((batch) => batch.status || '') : [], batches.length ? progress.current : null, batches.length ? progress.total : null)
}

@Injectable()
export class WorkOrderRoutingExecutionService {
  constructor(private readonly prisma: PrismaService) {}

  summarize(workOrder: WorkOrderExecutionContext) {
    return summarizeWorkOrderExecution(workOrder)
  }

  private async loadExecutionContext(client: any, id: string) {
    return client.workOrder.findUnique({
      where: { id },
      include: {
        bomVersion: { include: { coreBoxes: { select: { coreBoxCode: true } } } },
        routingVersion: { include: { nodes: { include: { operation: true }, orderBy: { seqNo: 'asc' } } } },
        coreTasks: true,
        allocations: { include: { heatOrder: true } },
        meltReleases: { select: { routingNodeId: true, releasedAt: true, releasedByUserId: true } },
        moldingTasks: true,
        pouringMoldBatches: true,
        pouringReports: true,
        shakeBatches: true,
        shakeReports: true,
        cleaningBatches: true,
        cleaningReports: true,
        inspectionBatches: true,
        inspectionReports: true,
      },
    })
  }

  private async releaseWarnings(client: any, id: string): Promise<WorkOrderRoutingExecutionWarning[]> {
    const [coreNodeCount, coreTasks, pendingDryingCount] = await Promise.all([
      client.processRoutingNode.count({
        where: {
          routingVersion: { workOrders: { some: { id } } },
          OR: [{ operationCode: 'OP-CORE' }, { operation: { section: '制芯' } }],
        },
      }),
      client.coreProductionTask.findMany({ where: { workOrderId: id }, select: { status: true } }),
      client.coreInventoryBatch.count({ where: { report: { task: { workOrderId: id } }, dryingRequired: true, status: 'UNDRIED' } }),
    ])
    const warnings: WorkOrderRoutingExecutionWarning[] = []
    if (coreNodeCount > 0 && (!coreTasks.length || coreTasks.some((task: { status: string }) => task.status !== 'COMPLETED'))) {
      warnings.push({ code: 'CORE_INCOMPLETE', message: '制芯任务尚未全部完成，仍可下达熔炼排产' })
    }
    if (pendingDryingCount > 0) {
      warnings.push({ code: 'CORE_DRYING_PENDING', message: `当前有 ${pendingDryingCount} 个砂芯批次待烘干，仍可下达熔炼排产` })
    }
    return warnings
  }

  async getSummary(request: RequestWithAdmin, id: string): Promise<WorkOrderRoutingExecutionNode[]> {
    const context = getAdminContext(request)
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, context, 'production:work-orders')
    if (visibleIds !== null && !visibleIds.includes(id)) throw new NotFoundException('生产工单不存在')
    const workOrder = await this.loadExecutionContext(this.prisma, id)
    if (!workOrder) throw new NotFoundException('生产工单不存在')
    const permissions = context.username === 'admin' || context.userType === 'SUPER_ADMIN' ? ['*'] : context.permissions
    const nodes = summarizeWorkOrderExecution(workOrder as unknown as WorkOrderExecutionContext, permissions)
    const warnings = await this.releaseWarnings(this.prisma, id)
    const warningHint = warnings.map((item) => item.message).join('；')
    return nodes.map((node) => node.module === 'MELT' && node.action === 'RELEASE_MELT' && warningHint
      ? { ...node, actionHint: warningHint }
      : node)
  }

  async releaseMelt(request: RequestWithAdmin, id: string, routingNodeId?: string): Promise<MeltReleaseResult> {
    const context = getAdminContext(request)
    const visibleIds = await visibleOwnershipEntityIds(this.prisma, context, 'production:work-orders')
    if (visibleIds !== null && !visibleIds.includes(id)) throw new NotFoundException('生产工单不存在')

    const release = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "WorkOrder" WHERE "id" = ${id} FOR UPDATE
      `)
      if (!lockedRows.length) throw new NotFoundException('生产工单不存在')

      const current = await tx.workOrder.findUnique({
        where: { id },
        select: { productionStatus: true, meltReleasedAt: true, meltReleasedByUserId: true, routingVersionId: true },
      })
      if (!current) throw new NotFoundException('生产工单不存在')
      if (current.productionStatus === 'CLOSED') throw new ConflictException('已关闭的生产工单不能下达熔炼排产')
      const meltNodes = await tx.processRoutingNode.findMany({
        where: {
          routingVersionId: current.routingVersionId,
          OR: [{ operationCode: 'OP-MELT' }, { operation: { section: '熔炼' } }],
        },
        select: { id: true },
      })
      if (!meltNodes.length) throw new ConflictException('工单锁定的工艺路线不包含熔炼工序，不能下达熔炼排产')
      const requestedRoutingNodeId = String(routingNodeId || '').trim()
      const selectedRoutingNodeId = requestedRoutingNodeId || (meltNodes.length === 1 ? meltNodes[0].id : '')
      if (!selectedRoutingNodeId) throw new ConflictException('工单包含多个熔炼工序，请明确选择熔炼工序')
      if (!meltNodes.some((node) => node.id === selectedRoutingNodeId)) throw new ConflictException('所选熔炼工序不属于工单锁定路线')

      const warnings = await this.releaseWarnings(tx, id)
      const existingRelease = await tx.workOrderMeltRelease.findUnique({
        where: { workOrderId_routingNodeId: { workOrderId: id, routingNodeId: selectedRoutingNodeId } },
      })
      const legacySingleNodeRelease = meltNodes.length === 1 && Boolean(current.meltReleasedAt)
      if (existingRelease || legacySingleNodeRelease) {
        return {
          released: false,
          alreadyReleased: true,
          routingNodeId: selectedRoutingNodeId,
          meltReleasedAt: existingRelease?.releasedAt.toISOString() || current.meltReleasedAt!.toISOString(),
          meltReleasedByUserId: existingRelease?.releasedByUserId || current.meltReleasedByUserId || '',
          warnings,
        }
      }

      const meltReleasedAt = new Date()
      await tx.workOrderMeltRelease.create({
        data: { workOrderId: id, routingNodeId: selectedRoutingNodeId, releasedAt: meltReleasedAt, releasedByUserId: context.id },
      })
      if (!current.meltReleasedAt) {
        const result = await tx.workOrder.updateMany({
          where: { id, productionStatus: { not: 'CLOSED' }, meltReleasedAt: null },
          data: { meltReleasedAt, meltReleasedByUserId: context.id },
        })
        if (result.count !== 1) throw new ConflictException('工单已被其他用户更新，请刷新后重试')
      }
      return {
        released: true,
        alreadyReleased: false,
        routingNodeId: selectedRoutingNodeId,
        meltReleasedAt: meltReleasedAt.toISOString(),
        meltReleasedByUserId: context.id,
        warnings,
      }
    })

    return { ...release, nodes: await this.getSummary(request, id) }
  }
}
