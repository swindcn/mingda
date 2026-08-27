import { Prisma, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const MAX_ATTEMPTS = 3
const warehouses = [
  { code: 'BLANK_WAREHOUSE', name: '铸件毛坯库', type: 'BLANK', system: true },
  { code: 'RETURN_MELT_WAREHOUSE', name: '回炉料仓', type: 'RETURN_MELT', system: true },
]

try {
  let records
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      records = await prisma.$transaction(async (tx) => {
        const existing = await tx.systemWarehouse.findMany({
          where: { code: { in: warehouses.map(({ code }) => code) } },
        })
        for (const row of existing) {
          const expected = warehouses.find(({ code }) => code === row.code)
          if (!expected) continue
          if (!row.system || row.type !== expected.type) {
            throw new Error(`保留仓库 ${row.code} 已存在但不是兼容的系统仓库，禁止覆盖`)
          }
        }

        const next = []
        for (const warehouse of warehouses) {
          next.push(await tx.systemWarehouse.upsert({
            where: { code: warehouse.code },
            update: { name: warehouse.name, status: 'ENABLED' },
            create: { ...warehouse, status: 'ENABLED' },
          }))
        }
        return next
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      break
    } catch (error) {
      if (error?.code !== 'P2034' || attempt === MAX_ATTEMPTS) throw error
    }
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    warehouses: records.map(({ code, name, type, system, status }) => ({ code, name, type, system, status })),
  })}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
