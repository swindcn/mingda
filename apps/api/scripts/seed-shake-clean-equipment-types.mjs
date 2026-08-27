import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const required = ['落砂', '清理', '抛丸', '打磨', '切割']
const defaults = ['熔炼炉', '浇注包', '球化包', '烘干设备', '落砂', '清理', '抛丸', '打磨', '切割', '其他设备']

try {
  const current = await prisma.dictionarySetting.findUnique({ where: { key: 'equipmentTypes' } })
  const values = Array.isArray(current?.values) ? current.values.filter((item) => typeof item === 'string') : []
  const next = current ? Array.from(new Set([...values, ...required])) : defaults
  await prisma.dictionarySetting.upsert({
    where: { key: 'equipmentTypes' },
    update: { values: next },
    create: { key: 'equipmentTypes', values: next },
  })
  process.stdout.write(`${JSON.stringify({ ok: true, added: next.filter((item) => !values.includes(item)), values: next })}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
