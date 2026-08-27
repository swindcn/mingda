import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

async function lockBlankOutputBatch(tx: Prisma.TransactionClient, blankOutputBatchId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BlankOutputBatch" WHERE "id" = ${blankOutputBatchId} FOR UPDATE
  `)
  return rows.length > 0
}

export async function ensureInspectionBatchForBlankOutput(
  tx: Prisma.TransactionClient,
  blankOutputBatchId: string,
): Promise<{ id: string; created: boolean } | null> {
  if (!await lockBlankOutputBatch(tx, blankOutputBatchId)) return null

  const blank = await tx.blankOutputBatch.findUnique({
    where: { id: blankOutputBatchId },
    select: {
      id: true,
      code: true,
      status: true,
      quantity: true,
      createdAt: true,
      routingVersionId: true,
      inspectionBatch: { select: { id: true } },
      workOrder: {
        select: {
          id: true,
          code: true,
          productCode: true,
          routingVersionId: true,
          product: { select: { code: true, name: true } },
        },
      },
      routingVersion: {
        select: {
          id: true,
          version: true,
          routing: { select: { code: true, name: true } },
        },
      },
      nextRoutingNode: {
        select: {
          id: true,
          routingVersionId: true,
          operationCode: true,
          operation: { select: { code: true, name: true } },
        },
      },
    },
  })
  if (!blank || blank.status === 'CANCELED') return null

  const node = blank.nextRoutingNode
  if (
    !node
    || node.routingVersionId !== blank.routingVersionId
    || blank.workOrder.routingVersionId !== blank.routingVersionId
    || node.operationCode !== 'OP-INSP'
    || node.operation.code !== 'OP-INSP'
  ) return null
  if (blank.quantity <= 0) throw new BadRequestException('毛坯批次数量必须大于 0')
  const existed = Boolean(blank.inspectionBatch)

  const batch = await tx.inspectionBatch.upsert({
    where: { sourceBlankOutputBatchId: blank.id },
    update: {},
    create: {
      code: `${blank.code}-INSP`,
      sourceBlankOutputBatchId: blank.id,
      sourceReworkReportId: null,
      workOrderId: blank.workOrder.id,
      productCode: blank.workOrder.productCode,
      routingVersionId: blank.routingVersion.id,
      inspectionRoutingNodeId: node.id,
      workOrderCodeSnapshot: blank.workOrder.code,
      productCodeSnapshot: blank.workOrder.product.code,
      productNameSnapshot: blank.workOrder.product.name,
      routingCodeSnapshot: blank.routingVersion.routing.code,
      routingNameSnapshot: blank.routingVersion.routing.name,
      routingVersionSnapshot: blank.routingVersion.version,
      operationCodeSnapshot: node.operation.code,
      operationNameSnapshot: node.operation.name,
      originalQuantity: blank.quantity,
      remainingQuantity: blank.quantity,
      status: 'WAITING',
      availableAt: blank.createdAt,
    },
  })
  return { id: batch.id, created: !existed }
}
