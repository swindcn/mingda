import { PrismaClient } from '@prisma/client'

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
const databaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const stamp = Date.now()
const productCode = `TEST-MOLD-P-${stamp}`
const moldA = `TEST-MOLD-A-${stamp}`
const moldB = `TEST-MOLD-B-${stamp}`
const moldLegacy = `TEST-MOLD-L-${stamp}`
const moldFromDevelopment = `TEST-MOLD-D-${stamp}`
const moldDuplicateDevelopment = `TEST-MOLD-DD-${stamp}`
const coreA = `${moldA}-WATER`
const coreB = `${moldA}-CRANK`
const coreC = `${moldA}-OIL`
const coreD = `${moldA}-INTAKE`
const legacyCore = `${moldLegacy}-CORE`
const customerCode = `TEST-MOLD-C-${stamp}`
const supplierCode = `TEST-MOLD-S-${stamp}`
const developmentA = `TEST-MOLD-DEV-A-${stamp}`
const developmentB = `TEST-MOLD-DEV-B-${stamp}`
const moldCodes = [moldA, moldB, moldLegacy, moldFromDevelopment, moldDuplicateDevelopment]

async function request(path, options = {}, expectedFailure = false) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  const failed = !response.ok || payload.code !== 0
  if (expectedFailure) {
    if (!failed) throw new Error(`${options.method || 'GET'} ${path}: 应该失败但成功了`)
    return payload
  }
  if (failed) throw new Error(`${options.method || 'GET'} ${path}: ${payload.message || response.status}`)
  return payload.data
}

function coreBox(code, name, overrides = {}) {
  return {
    code,
    name,
    images: [`/uploads/${code}.jpg`],
    maxLife: 10000,
    usedLife: 0,
    status: '启用',
    remark: `${name}测试`,
    ...overrides,
  }
}

try {
  const product = await prisma.product.create({
    data: { code: productCode, name: '多芯盒测试发动机缸体', type: '半成品', unit: '件' },
  })
  const customer = await prisma.customer.create({ data: { code: customerCode, name: '多芯盒测试客户' } })
  const supplier = await prisma.supplier.create({ data: { code: supplierCode, name: '多芯盒测试供应商' } })
  await prisma.moldDevelopment.createMany({
    data: [developmentA, developmentB].map((code) => ({
      code,
      customerId: customer.id,
      productId: product.id,
      supplierId: supplier.id,
      customerNotifyDate: new Date(),
      moldName: `${code}模具`,
      moldType: '金属型',
      status: 'COMPLETED',
    })),
  })

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: '13665068911' }),
  })
  const headers = { authorization: `Bearer ${login.token}` }

  const created = await request('/admin/modeling/molds', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: moldA,
      name: '发动机缸体模具',
      itemCode: productCode,
      status: '启用',
      coreBoxes: [
        coreBox(coreA, '水道芯盒'),
        coreBox(coreB, '曲轴箱芯盒'),
        coreBox(coreC, '油道芯盒'),
      ],
    }),
  })
  if (!created.hasCoreBox || created.coreBoxes?.length !== 3) throw new Error('一次创建三套芯盒失败')
  const ownerships = await prisma.businessDataOwnership.findMany({
    where: { entityType: { in: ['modeling:molds', 'modeling:coreboxes'] }, entityId: { in: [moldA, coreA, coreB, coreC] } },
  })
  if (ownerships.length !== 4) throw new Error('模具或嵌套芯盒未在同一请求中生成数据归属')

  await request('/admin/modeling/molds', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: moldFromDevelopment,
      name: '开发单建档测试模具',
      itemCode: productCode,
      sourceMoldDevelopmentCode: developmentA,
      status: '启用',
    }),
  })
  const linkedDevelopment = await prisma.moldDevelopment.findUnique({ where: { code: developmentA } })
  if (linkedDevelopment?.archivedMoldCode !== moldFromDevelopment) throw new Error('开发单建档关联未同步写入')

  const duplicateArchive = await request('/admin/modeling/molds', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: moldDuplicateDevelopment,
      name: '不应成功的重复建档模具',
      itemCode: productCode,
      sourceMoldDevelopmentCode: developmentA,
      status: '启用',
    }),
  }, true)
  if (!String(duplicateArchive.message || '').includes('已建档')) throw new Error('重复关联已建档开发单时提示不明确')

  await request(`/admin/modeling/molds/${moldFromDevelopment}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      code: moldFromDevelopment,
      name: '开发单建档测试模具',
      itemCode: productCode,
      sourceMoldDevelopmentCode: developmentB,
      status: '启用',
    }),
  })
  const [oldDevelopment, newDevelopment] = await Promise.all([
    prisma.moldDevelopment.findUnique({ where: { code: developmentA } }),
    prisma.moldDevelopment.findUnique({ where: { code: developmentB } }),
  ])
  if (oldDevelopment?.archivedMoldCode !== null || newDevelopment?.archivedMoldCode !== moldFromDevelopment) {
    throw new Error('修改来源开发单后两侧关联未保持一致')
  }

  await request('/admin/modeling/molds', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: moldB, name: '冲突回滚测试模具', itemCode: productCode, status: '启用' }),
  })

  const updated = await request(`/admin/modeling/molds/${moldA}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      code: moldA,
      name: '发动机缸体模具（修订）',
      itemCode: productCode,
      status: '启用',
      coreBoxes: [
        coreBox(coreA, '水道芯盒（修订）', { usedLife: 125 }),
        coreBox(coreC, '油道芯盒'),
        coreBox(coreD, '进气道芯盒'),
      ],
    }),
  })
  const updatedMap = new Map(updated.coreBoxes.map((item) => [item.code, item]))
  if (updated.coreBoxes.length !== 4) throw new Error('编辑后未返回全部芯盒')
  if (updatedMap.get(coreA)?.name !== '水道芯盒（修订）' || updatedMap.get(coreA)?.usedLife !== 125) {
    throw new Error('已有芯盒修改失败')
  }
  if (!updatedMap.has(coreD)) throw new Error('编辑时新增芯盒失败')
  if (updatedMap.get(coreB)?.status !== '停用') throw new Error('请求遗漏的已有芯盒未停用')

  const conflict = await request(`/admin/modeling/molds/${moldB}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      code: moldB,
      name: '不应保存的新名称',
      itemCode: productCode,
      status: '启用',
      coreBoxes: [coreBox(coreA, '冲突芯盒')],
    }),
  }, true)
  if (!String(conflict.message || '').includes('其他模具')) throw new Error('跨模具芯盒编码冲突提示不明确')
  const moldBAfterConflict = await prisma.moldMaster.findUnique({ where: { code: moldB }, include: { coreBoxes: true } })
  if (moldBAfterConflict?.name !== '冲突回滚测试模具' || moldBAfterConflict.coreBoxes.length !== 0) {
    throw new Error('跨模具编码冲突时未整体回滚')
  }

  const invalidCode = await request(`/admin/modeling/molds/${moldA}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      code: moldA,
      name: '不应保存的非法编码修改',
      itemCode: productCode,
      coreBoxes: [coreBox('中文 CORE', '非法芯盒')],
    }),
  }, true)
  if (!String(invalidCode.message || '').includes('编码')) throw new Error('非法芯盒编码提示不明确')

  const duplicateCode = await request(`/admin/modeling/molds/${moldA}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      code: moldA,
      name: '不应保存的重复编码修改',
      itemCode: productCode,
      coreBoxes: [coreBox(coreA, '重复芯盒一'), coreBox(coreA, '重复芯盒二')],
    }),
  }, true)
  if (!String(duplicateCode.message || '').includes('重复')) throw new Error('同请求芯盒编码重复提示不明确')

  await request('/admin/modeling/molds', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: moldLegacy,
      name: '旧请求兼容模具',
      itemCode: productCode,
      hasCoreBox: true,
      coreBoxCode: legacyCore,
      coreBoxName: '旧版单芯盒',
      coreBoxImages: ['/uploads/legacy-core.jpg'],
      coreBoxMaxLife: 5000,
      coreBoxUsedLife: 10,
      coreBoxRemark: '旧字段请求',
    }),
  })
  const legacyDetail = await request(`/admin/modeling/molds/${moldLegacy}`, { headers })
  if (!legacyDetail.hasCoreBox || legacyDetail.coreBoxes?.[0]?.code !== legacyCore) throw new Error('旧单芯盒请求不兼容')

  console.log(JSON.stringify({ ok: true, moldCode: moldA, coreBoxes: updated.coreBoxes.length, omittedDisabled: coreB }))
} finally {
  await prisma.businessDataOwnership.deleteMany({
    where: { entityType: { in: ['modeling:molds', 'modeling:coreboxes'] }, entityId: { in: [...moldCodes, coreA, coreB, coreC, coreD, legacyCore] } },
  }).catch(() => null)
  await prisma.coreBoxMaster.deleteMany({ where: { moldCode: { in: moldCodes } } }).catch(() => null)
  await prisma.moldMaster.deleteMany({ where: { code: { in: moldCodes } } }).catch(() => null)
  await prisma.moldDevelopment.deleteMany({ where: { code: { in: [developmentA, developmentB] } } }).catch(() => null)
  await prisma.customer.deleteMany({ where: { code: customerCode } }).catch(() => null)
  await prisma.supplier.deleteMany({ where: { code: supplierCode } }).catch(() => null)
  await prisma.product.deleteMany({ where: { code: productCode } }).catch(() => null)
  await prisma.$disconnect()
}
