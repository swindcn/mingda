import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type DatabaseClient = PrismaService | Prisma.TransactionClient

interface MoldingTaskSnapshot {
  id: string
  workOrderId: string
  routingVersionId: string
  routingNodeId: string
  workOrderCodeSnapshot: string
  productCodeSnapshot: string
  productNameSnapshot: string
  moldCode: string
  moldNameSnapshot: string
  operationCodeSnapshot: string
  operationNameSnapshot: string
}

interface MoldingReportSnapshot {
  id: string
  reportCode: string
  goodQty: number
  reportedAt: Date
}

export async function findReachablePouringNode(
  client: DatabaseClient,
  routingVersionId: string,
  sourceNodeId: string,
) {
  const version = await client.processRoutingVersion.findUnique({
    where: { id: routingVersionId },
    select: {
      nodes: {
        select: {
          id: true,
          seqNo: true,
          operationCode: true,
          operation: { select: { name: true, pouringMergePoint: true } },
        },
      },
      edges: { select: { sourceNodeId: true, targetNodeId: true } },
    },
  })
  if (!version || !version.nodes.some((node) => node.id === sourceNodeId)) return null

  const nodes = new Map(version.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  for (const edge of version.edges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge.targetNodeId])
  }

  const visited = new Set([sourceNodeId])
  let frontier = [sourceNodeId]
  while (frontier.length) {
    const next = [...new Set(frontier.flatMap((id) => outgoing.get(id) || []))]
      .filter((id) => !visited.has(id))
    const candidates = next
      .map((id) => nodes.get(id))
      .filter((node): node is NonNullable<typeof node> => Boolean(node?.operation.pouringMergePoint))
      .sort((left, right) => left.seqNo - right.seqNo || left.id.localeCompare(right.id))
    if (candidates.length > 1) throw new BadRequestException('造型工序后存在多个同级浇注汇合点，请先修正工艺路线')
    if (candidates.length === 1) return candidates[0]
    next.forEach((id) => visited.add(id))
    frontier = next
  }
  return null
}

export async function createPouringMoldBatchForReport(
  client: DatabaseClient,
  task: MoldingTaskSnapshot,
  report: MoldingReportSnapshot,
) {
  if (report.goodQty <= 0) return null
  const existing = await client.pouringMoldBatch.findUnique({ where: { sourceMoldingReportId: report.id } })
  if (existing) return existing
  const pouringNode = await findReachablePouringNode(client, task.routingVersionId, task.routingNodeId)
  if (!pouringNode) return null
  return client.pouringMoldBatch.create({
    data: {
      code: `PMB-${report.reportCode}`,
      sourceMoldingReportId: report.id,
      moldingTaskId: task.id,
      workOrderId: task.workOrderId,
      routingVersionId: task.routingVersionId,
      pouringRoutingNodeId: pouringNode.id,
      workOrderCodeSnapshot: task.workOrderCodeSnapshot,
      productCodeSnapshot: task.productCodeSnapshot,
      productNameSnapshot: task.productNameSnapshot,
      moldCodeSnapshot: task.moldCode,
      moldNameSnapshot: task.moldNameSnapshot,
      moldingOperationCodeSnapshot: task.operationCodeSnapshot,
      moldingOperationNameSnapshot: task.operationNameSnapshot,
      pouringOperationCodeSnapshot: pouringNode.operationCode,
      pouringOperationNameSnapshot: pouringNode.operation.name,
      originalQuantity: report.goodQty,
      remainingQuantity: report.goodQty,
      closingTime: report.reportedAt,
    },
  })
}

export async function backfillPouringMoldBatches(client: DatabaseClient) {
  const reports = await client.moldingReport.findMany({
    where: { status: 'ACTIVE', goodQty: { gt: 0 }, pouringMoldBatch: null },
    include: { task: true },
    orderBy: { reportedAt: 'asc' },
  })
  let created = 0
  for (const report of reports) {
    if (await createPouringMoldBatchForReport(client, report.task, report)) created += 1
  }
  return created
}
