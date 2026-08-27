import { Prisma, PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ensureInspectionBatchForBlankOutput } from '../dist/production/final-inspection.queue.js'

function batchSize(value) {
  const parsed = Number(value ?? 100)
  return Number.isInteger(parsed) ? Math.min(500, Math.max(1, parsed)) : 100
}

export async function backfillInspectionBatches(prisma, options = {}) {
  const limit = batchSize(options.limit)
  let afterId = options.afterId || undefined
  let processed = 0
  let created = 0
  let pages = 0

  while (true) {
    const rows = await prisma.blankOutputBatch.findMany({
      where: {
        status: { not: 'CANCELED' },
        nextRoutingNode: { is: { operationCode: 'OP-INSP' } },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    })
    if (!rows.length) break

    const page = await prisma.$transaction(async (tx) => {
      let pageCreated = 0
      for (const row of rows) {
        const result = await ensureInspectionBatchForBlankOutput(tx, row.id)
        if (result?.created) pageCreated += 1
      }
      return pageCreated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    pages += 1
    processed += rows.length
    created += page
    afterId = rows.at(-1).id
    if (rows.length < limit) break
  }

  return { ok: true, pages, processed, created, lastId: afterId || null }
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const result = await backfillInspectionBatches(prisma, {
      limit: process.env.BACKFILL_INSPECTION_BATCH_SIZE,
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) await main()
