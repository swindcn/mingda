import { PrismaClient } from '@prisma/client'

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
const databaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const stamp = Date.now()
const prefix = `TEST-ROUTING-${stamp}`
const productA = `${prefix}-A`
const productB = `${prefix}-B`
const semiProduct = `${prefix}-S`
const rawProduct = `${prefix}-RAW`
const equipmentA = `${prefix}-EA`
const equipmentB = `${prefix}-EB`
const operationCode = `${prefix}-OP`
const routeCode = `${prefix}-RT`
const cloneCode = `${prefix}-CLONE`

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

let operationId = ''
try {
  const grade = await prisma.materialGrade.findFirst({ where: { status: '启用' }, orderBy: { code: 'asc' } })
  if (!grade) throw new Error('缺少启用材质牌号')
  await prisma.product.createMany({
    data: [
      { code: productA, name: '测试泵体成品A', type: '成品', unit: '件', materialGradeCode: grade.code },
      { code: productB, name: '测试泵体成品B', type: '成品', unit: '件', materialGradeCode: grade.code },
      { code: semiProduct, name: '测试泵体毛坯', type: '半成品', unit: '件', materialGradeCode: grade.code },
      { code: rawProduct, name: '测试废钢', type: '原材料', unit: 'kg', materialGradeCode: grade.code },
    ],
  })
  await prisma.furnace.createMany({
    data: [
      { code: equipmentA, name: '测试中频炉', status: '启用' },
      { code: equipmentB, name: '测试浇注轨道', status: '启用' },
    ],
  })

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: '13665068911', password: '13665068911' }),
  })
  const headers = { authorization: `Bearer ${login.token}` }

  const operationOptions = await request('/admin/modeling/operations/options', { headers })
  if (!operationOptions.sections.includes('浇注')) throw new Error('工段字典缺少浇注')
  if (!operationOptions.operations.some((item) => item.code === 'OP-POUR')) throw new Error('缺少预置浇注工序')
  const customOperation = await request('/admin/modeling/operations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: operationCode, name: '测试抛丸', section: '后处理', reportMode: 'BATCH' }),
  })
  operationId = customOperation.id
  await request(`/admin/modeling/operations/${operationId}/disable`, { method: 'POST', headers })
  const disabledOptions = await request('/admin/modeling/operations/options', { headers })
  if (disabledOptions.operations.some((item) => item.code === operationCode)) throw new Error('禁用工序仍出现在路线选项')
  await request(`/admin/modeling/operations/${operationId}/enable`, { method: 'POST', headers })
  const enabledOptions = await request('/admin/modeling/operations/options', { headers })
  if (!enabledOptions.operations.some((item) => item.code === operationCode)) throw new Error('工序重新启用后未恢复可选')

  const routeOptions = await request('/admin/modeling/routings/options', { headers })
  if (!routeOptions.products.some((item) => item.code === productA)) throw new Error('路线选项缺少成品')
  if (!routeOptions.equipment.some((item) => item.code === equipmentA)) throw new Error('路线选项缺少启用设备')

  const nodes = [
    { id: 'melt', operationCode: 'OP-MELT', routeType: 'MELT_BRANCH', equipmentCodes: [equipmentA], positionX: 80, positionY: 40 },
    { id: 'core', operationCode: 'OP-CORE', routeType: 'CORE_BRANCH', equipmentCodes: [], positionX: 80, positionY: 180 },
    { id: 'mold', operationCode: 'OP-MOLD', routeType: 'MOLD_MAIN', equipmentCodes: [], positionX: 80, positionY: 320 },
    { id: 'pour', operationCode: 'OP-POUR', routeType: 'MERGE_POINT', equipmentCodes: [equipmentB], positionX: 420, positionY: 180 },
    { id: 'inspect', operationCode: 'OP-INSP', routeType: 'AFTER_MERGE', equipmentCodes: [], positionX: 720, positionY: 180 },
  ]
  const edges = [
    { sourceNodeId: 'melt', targetNodeId: 'pour' },
    { sourceNodeId: 'core', targetNodeId: 'pour' },
    { sourceNodeId: 'mold', targetNodeId: 'pour' },
    { sourceNodeId: 'pour', targetNodeId: 'inspect' },
  ]
  const payload = {
    code: routeCode,
    name: '测试通用铸造路线',
    productCodes: [productA, productB, semiProduct],
    nodes,
    edges,
    remark: '工艺路线自动化测试',
  }

  await request('/admin/modeling/routings', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, code: `${routeCode}-CYCLE`, edges: [...edges, { sourceNodeId: 'inspect', targetNodeId: 'melt' }] }),
  }, true)

  const v1 = await request('/admin/modeling/routings', { method: 'POST', headers, body: JSON.stringify(payload) })
  if (v1.version !== 'V1.0' || v1.status !== 'DRAFT') throw new Error('路线首版状态不正确')
  if (v1.productCodes.length !== 3 || v1.nodes.length !== 5 || v1.edges.length !== 4) throw new Error('路线关系保存不完整')
  const pouringNode = v1.nodes.find((item) => item.operationCode === 'OP-POUR')
  if (!pouringNode?.requireFurnaceBatch || !pouringNode.requireLadle || !pouringNode.requireCoreBatch) throw new Error('浇注绑定规则未强制启用')
  if (v1.nodes.map((item) => item.seqNo).join(',') !== '10,20,30,40,50') throw new Error('工序号未按拓扑顺序生成')

  const activeV1 = await request(`/admin/modeling/routings/${v1.id}/activate`, { method: 'POST', headers })
  if (activeV1.status !== 'ACTIVE') throw new Error('路线未发布生效')
  const withDefaults = await request(`/admin/modeling/routings/${v1.id}/default-products`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ productCodes: [productA, productB] }),
  })
  if (withDefaults.defaultProductCodes.length !== 2) throw new Error('默认产品关系保存失败')

  const activeProductsUpdated = await request(`/admin/modeling/routings/${v1.id}/applicable-products`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ productCodes: [productA, semiProduct] }),
  })
  if (activeProductsUpdated.status !== 'ACTIVE' || activeProductsUpdated.version !== 'V1.0') throw new Error('维护适用产品不应改变路线状态或版本')
  if (activeProductsUpdated.productCodes.join(',') !== [productA, semiProduct].sort().join(',')) throw new Error('已生效路线适用产品更新失败')
  if (activeProductsUpdated.defaultProductCodes.join(',') !== productA) throw new Error('移除适用产品后未同步清理默认路线')
  if (await prisma.productDefaultRouting.count({ where: { productCode: productB } })) throw new Error('被移除产品仍保留默认路线关系')
  await request(`/admin/modeling/routings/${v1.id}/applicable-products`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ productCodes: [productA, rawProduct] }),
  }, true)

  const v2 = await request(`/admin/modeling/routings/${v1.id}/new-version`, { method: 'POST', headers })
  if (v2.version !== 'V2.0' || v2.status !== 'DRAFT' || v2.nodes.length !== 5) throw new Error('路线新版本复制失败')
  const activeV2 = await request(`/admin/modeling/routings/${v2.id}/activate`, { method: 'POST', headers })
  if (activeV2.defaultProductCodes.length !== 1) throw new Error('新版本未接替默认产品')
  const oldV1 = await request(`/admin/modeling/routings/${v1.id}`, { headers })
  if (oldV1.status !== 'DISABLED') throw new Error('新版本生效后旧版本未停用')
  await request(`/admin/modeling/routings/${v1.id}/applicable-products`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ productCodes: [productA, productB, semiProduct] }),
  }, true)
  const activeProductsExpanded = await request(`/admin/modeling/routings/${v2.id}/applicable-products`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ productCodes: [productA, productB, semiProduct] }),
  })
  if (activeProductsExpanded.productCodes.length !== 3 || activeProductsExpanded.status !== 'ACTIVE') throw new Error('已生效路线不能直接新增适用产品')

  const cloned = await request(`/admin/modeling/routings/${v2.id}/clone`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: cloneCode, name: '测试通用铸造路线复制' }),
  })
  if (cloned.code !== cloneCode || cloned.version !== 'V1.0' || cloned.status !== 'DRAFT') throw new Error('路线克隆失败')
  if (cloned.defaultProductCodes.length) throw new Error('克隆路线不应复制默认关系')

  const list = await request(`/admin/modeling/routings?keyword=${encodeURIComponent(routeCode)}`, { headers })
  if (list.filter((item) => item.code === routeCode).length !== 2) throw new Error('路线列表未保留两个版本')
  console.log(JSON.stringify({ ok: true, routeCode, versions: ['V1.0', 'V2.0'], cloned: cloneCode }))
} finally {
  const testRoutes = await prisma.processRouting.findMany({ where: { code: { startsWith: prefix } }, include: { versions: { select: { id: true } } } }).catch(() => [])
  const testVersionIds = testRoutes.flatMap((route) => route.versions.map((version) => version.id))
  await prisma.businessDataOwnership.deleteMany({
    where: {
      OR: [
        { entityType: 'modeling:operations', entityId: { startsWith: prefix } },
        { entityType: 'modeling:routings', entityId: { in: testVersionIds } },
      ],
    },
  }).catch(() => null)
  await prisma.productDefaultRouting.deleteMany({ where: { productCode: { in: [productA, productB, semiProduct] } } }).catch(() => null)
  await prisma.processRouting.deleteMany({ where: { code: { startsWith: prefix } } }).catch(() => null)
  if (operationId) await prisma.operationMaster.deleteMany({ where: { id: operationId } }).catch(() => null)
  await prisma.furnace.deleteMany({ where: { code: { in: [equipmentA, equipmentB] } } }).catch(() => null)
  await prisma.product.deleteMany({ where: { code: { in: [productA, productB, semiProduct, rawProduct] } } }).catch(() => null)
  await prisma.$disconnect()
}
