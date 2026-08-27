import { PrismaClient } from '@prisma/client'

const databaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let cutoff = null
let cutoffIso = null

try {
  const cliBefore = process.argv.find((argument) => argument.startsWith('--before='))?.slice('--before='.length).trim()
  const rawCutoff = cliBefore || String(process.env.MELT_RELEASE_BACKFILL_BEFORE || '').trim()
  if (!rawCutoff) {
    throw new Error('缺少回填截止时间，请使用 --before=<ISO timestamp> 或设置 MELT_RELEASE_BACKFILL_BEFORE')
  }
  cutoff = new Date(rawCutoff)
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`回填截止时间无效: ${rawCutoff}，请输入有效的 ISO timestamp`)
  }
  cutoffIso = cutoff.toISOString()
  const updated = await prisma.$executeRaw`
    UPDATE "WorkOrder"
    SET "meltReleasedAt" = "createdAt"
    WHERE "meltReleasedAt" IS NULL
      AND "createdAt" < ${cutoff}
  `
  process.stdout.write(`${JSON.stringify({ ok: true, cutoff: cutoffIso, updated })}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, ...(cutoffIso ? { cutoff: cutoffIso } : {}), message: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
