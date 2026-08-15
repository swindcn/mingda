import { PrismaClient } from '@prisma/client'

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
const databaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const stamp = Date.now()
const productA = `TEST-BOM-P-${stamp}`
const productB = `TEST-BOM-Q-${stamp}`
const productC = `TEST-BOM-D-${stamp}`
const coreItem = `TEST-BOM-C-${stamp}`
const auxiliaryItem = `TEST-BOM-A-${stamp}`
const invalidItem = `TEST-BOM-R-${stamp}`
const moldA = `TEST-BOM-MA-${stamp}`
const moldB = `TEST-BOM-MB-${stamp}`
const disabledMold = `TEST-BOM-MD-${stamp}`
const coreBoxA = `TEST-BOM-CB-${stamp}`
const coreBoxB = `TEST-BOM-CB2-${stamp}`
const createdVersionIds = []

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

async function assertWaitsForBomLock(bomId, operation, label) {
  let releaseLock
  let lockReady
  const releasePromise = new Promise((resolve) => { releaseLock = resolve })
  const readyPromise = new Promise((resolve) => { lockReady = resolve })
  const holder = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `casting-bom:${bomId}`)
    lockReady()
    await releasePromise
  })
  await readyPromise
  let settled = false
  const pending = operation().finally(() => { settled = true })
  await new Promise((resolve) => setTimeout(resolve, 150))
  const settledBeforeRelease = settled
  releaseLock()
  await holder
  const result = await pending
  if (settledBeforeRelease) throw new Error(`${label}未使用 BOM advisory lock`)
  return result
}

try {
  const grade = await prisma.materialGrade.findFirst({ where: { status: '启用' }, orderBy: { code: 'asc' } })
  if (!grade) throw new Error('缺少启用材质牌号')
  await prisma.product.createMany({
    data: [
      { code: productA, name: '测试泵体毛坯A', type: '半成品', unit: '件', materialGradeCode: grade.code },
      { code: productB, name: '测试泵体毛坯B', type: '半成品', unit: '件', materialGradeCode: grade.code },
      { code: productC, name: '测试泵体毛坯C', type: '半成品', unit: '件', materialGradeCode: grade.code },
      { code: coreItem, name: '测试水道砂芯', type: '半成品/砂芯', unit: '个' },
      { code: auxiliaryItem, name: '测试冒口套', type: '铸造辅材', unit: '个' },
      { code: invalidItem, name: '测试生铁', type: '原材料', unit: 'kg' },
    ],
  })
  await prisma.moldMaster.createMany({
    data: [
      { code: moldA, name: '测试泵体生产模具A', itemCode: productA, status: '启用', hasCoreBox: true },
      { code: moldB, name: '测试泵体生产模具B', itemCode: productB, status: '启用', hasCoreBox: false },
      { code: disabledMold, name: '测试停用模具', itemCode: productA, status: '停用', hasCoreBox: false },
    ],
  })
  await prisma.coreBoxMaster.createMany({
    data: [
      { code: coreBoxA, name: '测试泵体水道芯盒', moldCode: moldA, status: '启用' },
      { code: coreBoxB, name: '测试泵体油道芯盒', moldCode: moldA, status: '启用' },
    ],
  })

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: '13665068911', password: '13665068911' }),
  })
  const headers = { authorization: `Bearer ${login.token}` }
  const options = await request('/admin/modeling/boms/options', { headers })
  if (!options.products.some((item) => item.code === productA)) throw new Error('BOM 产品选项缺少测试产品')
  if (!options.physicalItems.some((item) => item.code === coreItem)) throw new Error('BOM 用料选项缺少砂芯')
  if (options.physicalItems.some((item) => item.code === invalidItem)) throw new Error('BOM 用料选项包含原材料')
  if (!options.molds?.some((item) => item.code === moldA && item.itemCode === productA)) throw new Error('BOM 选项缺少产品启用模具')
  if (options.molds.some((item) => item.code === disabledMold)) throw new Error('BOM 选项包含停用模具')
  if (![coreBoxA, coreBoxB].every((code) => options.coreBoxes?.some((item) => item.code === code && item.moldCode === moldA))) throw new Error('BOM 选项缺少启用芯盒')

  const payload = {
    productCode: productA,
    materialGradeCode: grade.code,
    moldCodes: [moldA],
    coreBoxes: [
      { coreBoxCode: coreBoxA, quantityPerProduct: 2, shelfLifeHours: 8.5 },
      { coreBoxCode: coreBoxB, quantityPerProduct: 4, shelfLifeHours: 24 },
    ],
    netWeightKg: 45,
    grossWeightKg: 65,
    remark: 'BOM 自动化测试',
    items: [
      { itemCode: coreItem, standardQuantity: 1, unit: '个', lossRate: 2, remark: '自制芯' },
      { itemCode: auxiliaryItem, standardQuantity: 4, unit: '个', lossRate: 0, remark: '外购' },
    ],
  }
  const v1 = await request('/admin/modeling/boms', { method: 'POST', headers, body: JSON.stringify(payload) })
  createdVersionIds.push(v1.id)
  if (v1.version !== 'V1.0' || v1.status !== 'DRAFT') throw new Error('首版状态或版本不正确')
  if (Math.abs(v1.yieldRate - 69.2308) > 0.001 || v1.returnWeightKg !== 20) throw new Error('重量计算不正确')
  if (v1.molds?.[0]?.code !== moldA || v1.coreBoxes?.length !== 2 || v1.coreBoxes[0].moldCode !== moldA) {
    throw new Error('BOM 工装关系保存或返回不正确')
  }
  if (v1.coreBoxes.find((item) => item.code === coreBoxA)?.quantityPerProduct !== 2) throw new Error('水道芯盒芯件比保存失败')
  if (v1.coreBoxes.find((item) => item.code === coreBoxB)?.quantityPerProduct !== 4) throw new Error('油道芯盒芯件比保存失败')
  if (v1.coreBoxes.find((item) => item.code === coreBoxA)?.shelfLifeHours !== 8.5) throw new Error('水道芯盒保质期保存失败')
  if (v1.coreBoxes.find((item) => item.code === coreBoxB)?.shelfLifeHours !== 24) throw new Error('油道芯盒保质期保存失败')
  const v1Ownership = await prisma.businessDataOwnership.findUnique({
    where: { entityType_entityId: { entityType: 'modeling:boms', entityId: v1.id } },
  })
  if (!v1Ownership) throw new Error('BOM 与数据归属未在同一创建流程中保存')
  const v1WithoutTooling = await request(`/admin/modeling/boms/${v1.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...payload, moldCodes: [], coreBoxes: [] }),
  })
  if (v1WithoutTooling.moldCodes.length || v1WithoutTooling.coreBoxes.length) throw new Error('草稿编辑未清理旧工装关系')
  const v1WithSharedMold = await request(`/admin/modeling/boms/${v1.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...payload, moldCodes: [moldB], coreBoxes: [] }),
  })
  if (v1WithSharedMold.moldCodes[0] !== moldB) throw new Error('BOM 未能引用其他物料下的有效模具档案')
  const v1Restored = await request(`/admin/modeling/boms/${v1.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  })
  if (v1Restored.moldCodes[0] !== moldA || v1Restored.coreBoxCodes[0] !== coreBoxA) throw new Error('草稿编辑未恢复工装关系')
  const { coreBoxes: _structuredCoreBoxes, ...legacyPayload } = payload
  const v1Legacy = await request(`/admin/modeling/boms/${v1.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...legacyPayload, coreBoxCodes: [coreBoxA] }),
  })
  if (v1Legacy.coreBoxes.length !== 1 || v1Legacy.coreBoxes[0].quantityPerProduct !== 1) throw new Error('旧 coreBoxCodes 请求未按芯件比 1 兼容')
  if (v1Legacy.coreBoxes[0].shelfLifeHours != null) throw new Error('旧 coreBoxCodes 请求不应生成保质期')
  await request(`/admin/modeling/boms/${v1.id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  const moldDeleteFailure = await request(`/admin/modeling/molds/${moldA}`, { method: 'DELETE', headers }, true)
  if (!String(moldDeleteFailure.message || '').includes('已被其他资料引用')) throw new Error('被 BOM 引用的模具删除提示不正确')
  const coreBoxDeleteFailure = await request(`/admin/modeling/coreboxes/${coreBoxA}`, { method: 'DELETE', headers }, true)
  if (!String(coreBoxDeleteFailure.message || '').includes('已被其他资料引用')) throw new Error('被 BOM 引用的芯盒删除提示不正确')

  await request('/admin/modeling/boms', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, productCode: productB, items: [{ itemCode: invalidItem, standardQuantity: 1, unit: 'kg', lossRate: 0 }] }),
  }, true)
  await request('/admin/modeling/boms', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, productCode: productB, moldCodes: [moldB], coreBoxes: [{ coreBoxCode: coreBoxA, quantityPerProduct: 1 }] }),
  }, true)
  await request('/admin/modeling/boms', {
    method: 'POST', headers,
    body: JSON.stringify({ ...payload, productCode: productB, coreBoxes: [{ coreBoxCode: coreBoxA, quantityPerProduct: 0 }] }),
  }, true)
  for (const invalidShelfLife of [0, -1]) {
    const invalidShelfLifeResult = await request('/admin/modeling/boms', {
      method: 'POST', headers,
      body: JSON.stringify({
        ...payload,
        productCode: productB,
        coreBoxes: [{ coreBoxCode: coreBoxA, quantityPerProduct: 1, shelfLifeHours: invalidShelfLife }],
      }),
    }, true)
    if (!String(invalidShelfLifeResult.message || '').includes('保质期')) throw new Error('非法保质期提示不明确')
  }
  await request('/admin/modeling/boms', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, productCode: invalidItem }),
  }, true)

  const activeV1 = await request(`/admin/modeling/boms/${v1.id}/activate`, { method: 'POST', headers })
  if (activeV1.status !== 'ACTIVE') throw new Error('V1.0 未生效')
  const v2 = await request(`/admin/modeling/boms/${v1.id}/new-version`, { method: 'POST', headers })
  createdVersionIds.push(v2.id)
  if (v2.version !== 'V2.0' || v2.status !== 'DRAFT' || v2.items.length !== 2) throw new Error('新版本复制失败')
  if (v2.moldCodes?.[0] !== moldA || v2.coreBoxes?.length !== 2) throw new Error('新版本未复制工装关系')
  if (v2.coreBoxes.find((item) => item.code === coreBoxB)?.quantityPerProduct !== 4) throw new Error('新版本未复制芯件比')
  if (v2.coreBoxes.find((item) => item.code === coreBoxB)?.shelfLifeHours !== 24) throw new Error('新版本未复制保质期')
  await assertWaitsForBomLock(v2.bomId, () => request(`/admin/modeling/boms/${v2.id}`, {
    method: 'PUT', headers, body: JSON.stringify({ ...payload, remark: '锁内更新' }),
  }), '草稿编辑')
  await request(`/admin/modeling/boms/${v2.id}/new-version`, { method: 'POST', headers }, true)
  const cloned = await request(`/admin/modeling/boms/${v2.id}/clone`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetProductCode: productB }),
  })
  createdVersionIds.push(cloned.id)
  if (cloned.productCode !== productB || cloned.version !== 'V1.0' || cloned.status !== 'DRAFT') throw new Error('跨产品克隆失败')
  if (cloned.moldCodes?.length || cloned.coreBoxCodes?.length) throw new Error('跨产品克隆错误沿用了来源产品工装')
  const deletableClone = await request(`/admin/modeling/boms/${v2.id}/clone`, {
    method: 'POST', headers, body: JSON.stringify({ targetProductCode: productC }),
  })
  createdVersionIds.push(deletableClone.id)
  await assertWaitsForBomLock(deletableClone.bomId, () => request(`/admin/modeling/boms/${deletableClone.id}`, {
    method: 'DELETE', headers,
  }), '草稿删除')
  await request(`/admin/modeling/boms/${v2.id}`, { method: 'DELETE', headers }, true)
  await request(`/admin/modeling/boms/${v2.id}/activate`, { method: 'POST', headers })
  const v1After = await request(`/admin/modeling/boms/${v1.id}`, { headers })
  if (v1After.status !== 'DISABLED') throw new Error('新版本生效后旧版本未停用')
  const concurrentVersions = await Promise.all([
    request(`/admin/modeling/boms/${v2.id}/new-version`, { method: 'POST', headers }),
    request(`/admin/modeling/boms/${v2.id}/new-version`, { method: 'POST', headers }),
  ])
  createdVersionIds.push(...concurrentVersions.map((item) => item.id))
  const concurrentVersionNames = concurrentVersions.map((item) => item.version).sort()
  if (concurrentVersionNames.join(',') !== 'V3.0,V4.0') throw new Error('并发创建版本未按顺序生成 V3.0/V4.0')
  await Promise.all(concurrentVersions.map((item) => request(`/admin/modeling/boms/${item.id}/activate`, { method: 'POST', headers })))
  const productVersions = await request(`/admin/modeling/boms?keyword=${encodeURIComponent(productA)}`, { headers })
  if (productVersions.filter((item) => item.productCode === productA && item.status === 'ACTIVE').length !== 1) {
    throw new Error('并发提交后存在多个已生效版本')
  }
  await request(`/admin/modeling/boms/${v2.id}/clone`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetProductCode: productA }),
  }, true)

  const calculation = await request(`/admin/modeling/boms/${v2.id}/calculate?quantity=100`, { headers })
  if (calculation.moltenMetalWeightKg !== 6500 || calculation.returnWeightKg !== 2000) throw new Error('生产需求重量计算失败')
  const coreRequirement = calculation.physicalItems.find((item) => item.itemCode === coreItem)
  if (!coreRequirement || Math.abs(coreRequirement.requiredQuantity - 102) > 0.0001) throw new Error('损耗后领料数量计算失败')
  if (calculation.molds?.[0]?.code !== moldA || calculation.coreBoxes?.length !== 2) throw new Error('计算接口缺少生产工装摘要')
  if (calculation.coreBoxes.find((item) => item.code === coreBoxB)?.quantityPerProduct !== 4) throw new Error('计算接口缺少芯件比')
  if (calculation.coreBoxes.find((item) => item.code === coreBoxB)?.requiredQuantity !== 400) throw new Error('计算接口芯件需求量不正确')
  if (calculation.coreBoxes.find((item) => item.code === coreBoxB)?.shelfLifeHours !== 24) throw new Error('计算接口缺少芯盒保质期')

  console.log(JSON.stringify({ ok: true, productCode: productA, versions: ['V1.0', 'V2.0', 'V3.0', 'V4.0'], clonedProduct: productB }))
} finally {
  if (createdVersionIds.length) {
    await prisma.businessDataOwnership.deleteMany({ where: { entityType: 'modeling:boms', entityId: { in: createdVersionIds } } }).catch(() => null)
  }
  if (createdVersionIds.length) await prisma.castingBomVersion?.deleteMany({ where: { id: { in: createdVersionIds } } }).catch(() => null)
  await prisma.castingBom?.deleteMany({ where: { productCode: { in: [productA, productB, productC] } } }).catch(() => null)
  await prisma.coreBoxMaster.deleteMany({ where: { code: { in: [coreBoxA, coreBoxB] } } }).catch(() => null)
  await prisma.moldMaster.deleteMany({ where: { code: { in: [moldA, moldB, disabledMold] } } }).catch(() => null)
  await prisma.product.deleteMany({ where: { code: { in: [productA, productB, productC, coreItem, auxiliaryItem, invalidItem] } } })
  await prisma.$disconnect()
}
