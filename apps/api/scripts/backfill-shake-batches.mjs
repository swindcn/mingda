import { Prisma, PrismaClient } from '@prisma/client'
import { backfillShakeBatches } from '../dist/production/shake-clean.queue.js'

const prisma = new PrismaClient()
const requestedLimit = Number(process.env.BACKFILL_SHAKE_BATCH_SIZE || 100)
const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 100
const moldingTaskIds = String(process.env.BACKFILL_SHAKE_MOLDING_TASK_IDS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

let processed = 0
let created = 0
let pages = 0
let afterId

try {
  while (true) {
    const result = await prisma.$transaction(
      (tx) => backfillShakeBatches(tx, {
        afterId,
        limit,
        ...(moldingTaskIds.length ? { moldingTaskIds } : {}),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    pages += 1
    processed += result.processed
    created += result.created
    process.stdout.write(`${JSON.stringify({ page: pages, ...result })}\n`)
    if (!result.hasMore || !result.lastId) break
    afterId = result.lastId
  }
  process.stdout.write(`${JSON.stringify({ ok: true, pages, processed, created })}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, pages, processed, created, message: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
