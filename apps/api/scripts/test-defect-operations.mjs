import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const operations = [
  { code: 'OP-CORE', name: '射芯制芯', section: '制芯' },
  { code: 'OP-MOLD', name: '造型下芯', section: '造型' },
  { code: 'OP-POUR', name: '合型浇注', section: '浇注', pouringMergePoint: true },
  { code: 'OP-SHAKE', name: '落砂清理', section: '清理' },
]

const defects = [
  ['CORE-INCOMPLETE', '射砂不足/砂芯缺肉', '制芯缺陷', ['OP-CORE']],
  ['CORE-CRACK', '砂芯裂纹', '制芯缺陷', ['OP-CORE']],
  ['CORE-DAMAGE', '砂芯破损', '制芯缺陷', ['OP-CORE']],
  ['CORE-DEFORM', '砂芯变形', '制芯缺陷', ['OP-CORE']],
  ['CORE-DIMENSION', '尺寸超差', '制芯缺陷', ['OP-CORE']],
  ['CORE-STRENGTH', '强度不足', '制芯缺陷', ['OP-CORE']],
  ['CORE-COATING', '涂料不良', '制芯缺陷', ['OP-CORE']],
  ['CORE-DRYING', '烘干不良', '制芯缺陷', ['OP-CORE']],
  ['MOLD-SAND-DAMAGE', '砂型损伤', '造型缺陷', ['OP-MOLD']],
  ['MOLD-COLLAPSE', '塌箱', '造型缺陷', ['OP-MOLD']],
  ['MOLD-CORE-OFFSET', '下芯错位', '造型缺陷', ['OP-MOLD']],
  ['MOLD-CORE-DAMAGE', '砂芯破损', '造型缺陷', ['OP-MOLD']],
  ['MOLD-CLOSING', '合型不到位', '造型缺陷', ['OP-MOLD']],
  ['MOLD-MISMATCH', '错箱/偏箱', '造型缺陷', ['OP-MOLD']],
  ['POUR-RUNOUT', '跑火', '浇注缺陷', ['OP-POUR']],
  ['POUR-MISRUN', '浇不足', '浇注缺陷', ['OP-POUR']],
  ['POUR-COLD-SHUT', '冷隔', '浇注缺陷', ['OP-POUR']],
  ['POUR-SLAG', '夹渣', '浇注缺陷', ['OP-POUR']],
  ['SHAKE-CRACK', '粗开裂', '落砂缺陷', ['OP-SHAKE']],
  ['SHAKE-DAMAGE', '严重损坏', '落砂缺陷', ['OP-SHAKE']],
  ['CLEAN-STICKING', '粘砂', '清理缺陷', ['OP-SHAKE']],
  ['CLEAN-POROSITY', '气孔', '清理缺陷', ['OP-SHAKE']],
  ['CLEAN-OVERCUT', '切割过深', '清理缺陷', ['OP-SHAKE']],
  ['CLEAN-SANDHOLE', '砂眼', '清理缺陷', ['OP-SHAKE']],
]

try {
  for (const operation of operations) {
    await prisma.operationMaster.upsert({
      where: { code: operation.code },
      update: { name: operation.name, section: operation.section, pouringMergePoint: Boolean(operation.pouringMergePoint), status: 'ENABLED' },
      create: { ...operation, reportMode: 'BATCH', status: 'ENABLED' },
    })
  }
  for (const [code, name, category, operationCodes] of defects) {
    const defect = await prisma.defectCode.upsert({
      where: { code },
      update: { name, category, status: '启用', sourceOperation: operationCodes.join('、') },
      create: { code, name, category, status: '启用', sourceOperation: operationCodes.join('、') },
    })
    await prisma.defectOperation.deleteMany({ where: { defectCodeId: defect.id } })
    await prisma.defectOperation.createMany({ data: operationCodes.map((operationCode) => ({ defectCodeId: defect.id, operationCode })) })
  }

  const moldingOptions = await prisma.defectCode.findMany({ where: { status: '启用', operations: { some: { operationCode: 'OP-MOLD' } } }, include: { operations: true } })
  const coreOptions = await prisma.defectCode.findMany({ where: { status: '启用', operations: { some: { operationCode: 'OP-CORE' } } }, include: { operations: true } })
  const pouringOptions = await prisma.defectCode.findMany({ where: { status: '启用', operations: { some: { operationCode: 'OP-POUR' } } }, include: { operations: true } })
  const shakeOptions = await prisma.defectCode.findMany({ where: { status: '启用', operations: { some: { operationCode: 'OP-SHAKE' } } }, include: { operations: true } })
  assert.equal(moldingOptions.length >= 6, true)
  assert.equal(coreOptions.length >= 8, true)
  assert.equal(moldingOptions.every((item) => item.operations.some((link) => link.operationCode === 'OP-MOLD')), true)
  assert.equal(coreOptions.every((item) => item.operations.some((link) => link.operationCode === 'OP-CORE')), true)
  assert.equal(pouringOptions.length >= 4, true)
  assert.equal(pouringOptions.every((item) => item.operations.some((link) => link.operationCode === 'OP-POUR')), true)
  assert.equal(shakeOptions.length >= 6, true)
  assert.equal(shakeOptions.every((item) => item.operations.some((link) => link.operationCode === 'OP-SHAKE')), true)
  console.log(JSON.stringify({ ok: true, suite: 'defect-operations', molding: moldingOptions.length, coremaking: coreOptions.length, pouring: pouringOptions.length, shakeCleaning: shakeOptions.length }))
} finally {
  await prisma.$disconnect()
}
