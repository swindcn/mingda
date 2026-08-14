import { PrismaClient } from '@prisma/client'

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api'
const databaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const testName = `配方接口测试-${Date.now()}`
let sourceCode = ''
let clonedCode = ''

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

try {
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: '13665068911', password: '13665068911' }),
  })
  const headers = { authorization: `Bearer ${login.token}` }
  const options = await request('/admin/modeling/recipe-options', { headers })
  const material = options.materials?.[0]
  const furnaces = options.furnaces || []
  const rawMaterials = options.rawMaterials || []
  if (!material?.code || !material.elements?.length) throw new Error('缺少带化学成分的材质牌号')
  if (!furnaces.length) throw new Error('缺少启用的熔炼设备')
  if (rawMaterials.length < 2) throw new Error('至少需要两种原材料测试配比')
  if (rawMaterials.some((item) => !String(item.type).startsWith('原材料'))) throw new Error('配方选项返回了非原材料物料')

  await request('/admin/modeling/recipes', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `${testName}-无时长`, materialGradeCode: material.code, furnaceCodes: [furnaces[0].code],
      version: 'V1.0', baseWeightKg: 1000, meltingDurationMinutes: 0, transferDurationMinutes: 0,
      cleaningDurationMinutes: 0, targetElements: [], items: [],
    }),
  }, true)

  const draft = await request('/admin/modeling/recipes', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: testName,
      materialGradeCode: material.code,
      furnaceCodes: furnaces.slice(0, 2).map((item) => item.code),
      version: 'V1.0',
      baseWeightKg: 1000,
      meltingDurationMinutes: 60,
      transferDurationMinutes: 15,
      cleaningDurationMinutes: 15,
      targetElements: material.elements.slice(0, 2).map((item) => ({
        elementName: item.elementName,
        minValue: item.minValue,
        maxValue: item.maxValue,
        unit: item.unit,
      })),
      items: [
        { itemCode: rawMaterials[0].code, materialCategory: 'RAW', ratio: 60, quantity: 600, unit: 'kg' },
        { itemCode: rawMaterials[1].code, materialCategory: 'RETURN', ratio: 40, quantity: 400, unit: 'kg' },
      ],
      remark: '自动化测试数据',
    }),
  })
  sourceCode = draft.code
  if (!/^REC-\d{8}-\d{3}$/.test(sourceCode)) throw new Error(`自动编码不正确：${sourceCode}`)
  if (draft.status !== 'DRAFT' || draft.furnaceCodes.length !== Math.min(2, furnaces.length)) throw new Error('草稿主表或炉型关系保存失败')
  if (draft.occupancyDurationMinutes !== 90) throw new Error('配方时长保存或合计不正确')
  if (draft.targetElements.length !== 2 || draft.items.length !== 2) throw new Error('配方明细保存失败')

  await request(`/admin/modeling/recipes/${sourceCode}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...draft, items: draft.items.map((item, index) => ({ ...item, ratio: index === 0 ? 60 : 30 })) }),
  })
  await request(`/admin/modeling/recipes/${sourceCode}/activate`, { method: 'POST', headers }, true)
  await request(`/admin/modeling/recipes/${sourceCode}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...draft, items: draft.items }),
  })

  const clone = await request(`/admin/modeling/recipes/${sourceCode}/clone`, { method: 'POST', headers })
  clonedCode = clone.code
  if (clone.sourceRecipeCode !== sourceCode || clone.status !== 'DRAFT' || clone.version !== 'V1.0') throw new Error('克隆主表规则不正确')
  if (clone.targetElements.length !== draft.targetElements.length || clone.items.length !== draft.items.length) throw new Error('克隆未复制明细')
  if (clone.occupancyDurationMinutes !== 90) throw new Error('克隆未复制配方时长')
  await request(`/admin/modeling/recipes/${clonedCode}`, { method: 'DELETE', headers })
  clonedCode = ''

  const active = await request(`/admin/modeling/recipes/${sourceCode}/activate`, { method: 'POST', headers })
  if (active.status !== 'ACTIVE') throw new Error('配方未生效')
  await request(`/admin/modeling/recipes/${sourceCode}`, { method: 'PUT', headers, body: JSON.stringify({ ...draft, name: '不允许修改' }) }, true)
  const disabled = await request(`/admin/modeling/recipes/${sourceCode}/disable`, { method: 'POST', headers })
  if (disabled.status !== 'DISABLED') throw new Error('配方未停用')
  await request(`/admin/modeling/recipes/${sourceCode}`, { method: 'DELETE', headers }, true)

  const version2 = await request(`/admin/modeling/recipes/${sourceCode}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...disabled, name: `${testName}-二版` }),
  })
  if (version2.status !== 'DRAFT' || version2.version !== 'V2.0') throw new Error('停用配方保存后未升级为 V2.0 草稿')

  const version2Draft = await request(`/admin/modeling/recipes/${sourceCode}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...version2, remark: 'V2.0 草稿再次保存' }),
  })
  if (version2Draft.status !== 'DRAFT' || version2Draft.version !== 'V2.0') throw new Error('草稿重复保存不应再次升级版本')

  await request(`/admin/modeling/recipes/${sourceCode}/activate`, { method: 'POST', headers })
  const version2Disabled = await request(`/admin/modeling/recipes/${sourceCode}/disable`, { method: 'POST', headers })
  const version3 = await request(`/admin/modeling/recipes/${sourceCode}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...version2Disabled, name: `${testName}-三版` }),
  })
  if (version3.status !== 'DRAFT' || version3.version !== 'V3.0') throw new Error('第二次停用修改后未升级为 V3.0 草稿')

  console.log(JSON.stringify({ ok: true, sourceCode, clonedCode: clone.code, status: version3.status, version: version3.version }))
} finally {
  const codes = [sourceCode, clonedCode].filter(Boolean)
  if (codes.length) await prisma.meltRecipe.deleteMany({ where: { code: { in: codes } } })
  await prisma.$disconnect()
}
