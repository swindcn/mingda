import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { calculateShakePieces } from './shake-clean.calculations'

type DatabaseClient = PrismaService | Prisma.TransactionClient

export interface ReachableShakeNode {
  id: string
  operationCode: string
  operationName: string
  coolingDurationMinutes: number
}

export interface CreateShakeBatchOptions {
  reportAlreadyLocked?: boolean
  moldingTaskAlreadyLocked?: boolean
}

export interface BackfillShakeBatchesOptions {
  afterId?: string
  limit?: number
  moldingTaskIds?: string[]
  moldingTaskAlreadyLocked?: boolean
}

export interface BackfillShakeBatchesResult {
  processed: number
  created: number
  lastId: string | null
  hasMore: boolean
}

export async function findReachableShakeNode(
  client: DatabaseClient,
  routingVersionId: string,
  pouringNodeId: string,
): Promise<ReachableShakeNode | null> {
  const version = await client.processRoutingVersion.findUnique({
    where: { id: routingVersionId },
    select: {
      nodes: {
        select: {
          id: true,
          coolingDurationMinutes: true,
          operation: { select: { code: true, name: true, section: true } },
        },
      },
      edges: { select: { sourceNodeId: true, targetNodeId: true } },
    },
  })
  if (!version) return null

  const nodes = new Map(version.nodes.map((node) => [node.id, node]))
  if (!nodes.has(pouringNodeId)) return null

  const outgoing = new Map<string, string[]>()
  for (const edge of version.edges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge.targetNodeId])
  }

  const visitState = new Map<string, 'VISITING' | 'VISITED'>()
  const detectCycle = (nodeId: string): boolean => {
    if (visitState.get(nodeId) === 'VISITING') return true
    if (visitState.get(nodeId) === 'VISITED') return false
    visitState.set(nodeId, 'VISITING')
    for (const targetNodeId of outgoing.get(nodeId) || []) {
      if (!nodes.has(targetNodeId)) {
        throw new BadRequestException('工艺路线边存在跨版本节点，请先修正工艺路线')
      }
      if (detectCycle(targetNodeId)) return true
    }
    visitState.set(nodeId, 'VISITED')
    return false
  }
  if (detectCycle(pouringNodeId)) {
    throw new BadRequestException('浇注工序后的工艺路线存在循环，请先修正工艺路线')
  }

  const visited = new Set([pouringNodeId])
  let frontier = [pouringNodeId]
  while (frontier.length) {
    const nextIds = new Set<string>()
    for (const sourceNodeId of frontier) {
      for (const targetNodeId of outgoing.get(sourceNodeId) || []) {
        if (!visited.has(targetNodeId)) nextIds.add(targetNodeId)
      }
    }

    const candidates = [...nextIds]
      .map((id) => nodes.get(id)!)
      .filter((node) => node.operation.code === 'OP-SHAKE' || node.operation.section === '清理')
    if (candidates.length > 1) {
      throw new BadRequestException('浇注工序后存在多个同级可达落砂节点，请先修正工艺路线')
    }
    if (candidates.length === 1) {
      const node = candidates[0]
      return {
        id: node.id,
        operationCode: node.operation.code,
        operationName: node.operation.name,
        coolingDurationMinutes: node.coolingDurationMinutes,
      }
    }

    nextIds.forEach((id) => visited.add(id))
    frontier = [...nextIds]
  }
  return null
}

async function lockPouringReport(tx: Prisma.TransactionClient, pouringReportId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "PouringReport" WHERE "id" = ${pouringReportId} FOR UPDATE
  `)
  return rows.length > 0
}

async function lockMoldingTask(tx: Prisma.TransactionClient, moldingTaskId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "MoldingTask" WHERE "id" = ${moldingTaskId} FOR UPDATE
  `)
  return rows.length > 0
}

async function createShakeBatch(
  tx: Prisma.TransactionClient,
  pouringReportId: string,
  options: CreateShakeBatchOptions,
): Promise<{ id: string; created: boolean } | null> {
  const reference = await tx.pouringReport.findUnique({
    where: { id: pouringReportId },
    select: { moldingTaskId: true },
  })
  if (!reference) return null
  if (!options.moldingTaskAlreadyLocked && !await lockMoldingTask(tx, reference.moldingTaskId)) return null
  if (!options.reportAlreadyLocked && !await lockPouringReport(tx, pouringReportId)) return null
  const report = await tx.pouringReport.findUnique({
    where: { id: pouringReportId },
    select: {
      id: true,
      code: true,
      status: true,
      shakeQueueResolution: true,
      goodQty: true,
      reportedAt: true,
      moldingTaskId: true,
      workOrderId: true,
      pouringRoutingNodeId: true,
      workOrderCodeSnapshot: true,
      productCodeSnapshot: true,
      productNameSnapshot: true,
      shakeBatch: { select: { id: true } },
      moldingTask: { select: { routingVersionId: true, cavityCountSnapshot: true } },
    },
  })
  if (!report) return null
  if (report.shakeBatch) {
    if (report.shakeQueueResolution !== 'CREATED') {
      await tx.pouringReport.update({ where: { id: report.id }, data: { shakeQueueResolution: 'CREATED' } })
    }
    return { id: report.shakeBatch.id, created: false }
  }
  if (report.shakeQueueResolution !== 'PENDING') return null
  if (report.status !== 'ACTIVE' || report.goodQty <= 0) {
    await tx.pouringReport.update({ where: { id: report.id }, data: { shakeQueueResolution: 'NOT_APPLICABLE' } })
    return null
  }

  const shakeNode = await findReachableShakeNode(
    tx,
    report.moldingTask.routingVersionId,
    report.pouringRoutingNodeId,
  )
  if (!shakeNode) {
    await tx.pouringReport.update({ where: { id: report.id }, data: { shakeQueueResolution: 'NOT_APPLICABLE' } })
    return null
  }

  const quantity = calculateShakePieces(report.goodQty, report.moldingTask.cavityCountSnapshot)
  const batch = await tx.shakeBatch.upsert({
    where: { sourcePouringReportId: report.id },
    update: {},
    create: {
      code: `${report.code}-SHAKE`,
      sourcePouringReportId: report.id,
      moldingTaskId: report.moldingTaskId,
      workOrderId: report.workOrderId,
      routingVersionId: report.moldingTask.routingVersionId,
      shakeRoutingNodeId: shakeNode.id,
      workOrderCodeSnapshot: report.workOrderCodeSnapshot,
      productCodeSnapshot: report.productCodeSnapshot,
      productNameSnapshot: report.productNameSnapshot,
      shakeOperationCodeSnapshot: shakeNode.operationCode,
      shakeOperationNameSnapshot: shakeNode.operationName,
      originalQuantity: quantity,
      remainingQuantity: quantity,
      pouredAt: report.reportedAt,
      coolingDurationMinutesSnapshot: shakeNode.coolingDurationMinutes,
    },
  })
  await tx.pouringReport.update({ where: { id: report.id }, data: { shakeQueueResolution: 'CREATED' } })
  return { id: batch.id, created: true }
}

export async function createShakeBatchForPouringReport(
  tx: Prisma.TransactionClient,
  pouringReportId: string,
  options: CreateShakeBatchOptions = {},
): Promise<string | null> {
  return (await createShakeBatch(tx, pouringReportId, options))?.id || null
}

export async function backfillShakeBatches(
  tx: Prisma.TransactionClient,
  options: BackfillShakeBatchesOptions = {},
): Promise<BackfillShakeBatchesResult> {
  const requestedLimit = options.limit ?? 100
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 100
  const reports = await tx.pouringReport.findMany({
    where: {
      shakeQueueResolution: 'PENDING',
      ...(options.moldingTaskIds ? { moldingTaskId: { in: options.moldingTaskIds } } : {}),
      ...(options.afterId ? { id: { gt: options.afterId } } : {}),
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: limit + 1,
  })
  const candidates = reports.slice(0, limit)
  let created = 0
  for (const report of candidates) {
    const result = await createShakeBatch(tx, report.id, {
      moldingTaskAlreadyLocked: options.moldingTaskAlreadyLocked,
    })
    if (result?.created) created += 1
  }
  return {
    processed: candidates.length,
    created,
    lastId: candidates.at(-1)?.id || null,
    hasMore: reports.length > limit,
  }
}
