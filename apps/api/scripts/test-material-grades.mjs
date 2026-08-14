const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api'
const phone = process.env.ADMIN_PHONE || '13665068911'
const password = process.env.ADMIN_PASSWORD || phone
const code = `TEST-GRADE-${Date.now()}`

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  if (!response.ok || payload.code !== 0) {
    throw new Error(`${options.method || 'GET'} ${path}: ${payload.message || response.status}`)
  }
  return payload.data
}

async function expectFailure(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  if (response.ok && payload.code === 0) throw new Error(`${options.method || 'GET'} ${path}: 应该失败但成功了`)
  return payload
}

const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: phone, password }),
})
const headers = { authorization: `Bearer ${login.token}` }
const dictionaries = await request('/admin/dictionaries', { headers })
if (!dictionaries.materialTypes?.includes('球铁')) throw new Error('材料类型字典未配置球铁')
if (dictionaries.chemicalElements?.[0]?.name === undefined) throw new Error('化学成分字典未返回结构化项目')

const created = await request('/admin/modeling/materials', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    code,
    name: '测试球铁 QT500-7',
    category: '铸铁',
    materialType: '球铁',
    standard: 'GB/T 9440-2022',
    standardVersion: '2022',
    materialType: '球铁',
    elements: [{ elementName: 'C', valueMode: 'range', minValue: 3.40, maxValue: 3.90, unit: '%' }],
    properties: [{ propertyName: '抗拉强度', valueMode: 'fixed', fixedValue: 500, unit: 'MPa', testMethod: 'GB/T 228.1' }],
    processRules: [{ parameterName: '浇注温度', valueMode: 'range', minValue: 1380, maxValue: 1420, unit: '℃' }],
    standardVersions: [{ version: '2022', standard: 'GB/T 9440-2022', effectiveDate: '2022-01-01' }],
    status: '启用',
  }),
})
if (created.elements?.[0]?.elementName !== 'C') throw new Error('材质元素明细未回传')
if (created.properties?.[0]?.propertyName !== '抗拉强度') throw new Error('力学性能明细未回传')
if (created.processRules?.[0]?.parameterName !== '浇注温度') throw new Error('工艺要求明细未回传')
if (created.properties?.[0]?.valueMode !== 'fixed' || Number(created.properties?.[0]?.fixedValue) !== 500) throw new Error('固定值未正确保存')

const detail = await request(`/admin/modeling/materials/${code}`, { headers })
if (detail.standardVersions?.[0]?.version !== '2022') throw new Error('标准版本明细未回传')

const recipeOptions = await request('/admin/modeling/recipe-options', { headers })
const itemCode = recipeOptions.rawMaterials?.[0]?.code
const furnaceCode = recipeOptions.furnaces?.[0]?.code
if (!itemCode) throw new Error('测试需要至少一个原材料物料')
if (!furnaceCode) throw new Error('测试需要至少一个启用的熔炼设备')
const recipe = await request('/admin/modeling/recipes', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: '材质引用约束测试配方',
    materialGradeCode: code,
    furnaceCodes: [furnaceCode],
    version: 'V1.0',
    baseWeightKg: 1000,
    meltingDurationMinutes: 60,
    transferDurationMinutes: 15,
    cleaningDurationMinutes: 15,
    targetElements: created.elements,
    items: [{ itemCode, materialCategory: 'RAW', ratio: 100, quantity: 1000, unit: 'kg' }],
  }),
})
await expectFailure(`/admin/modeling/materials/${code}`, { method: 'DELETE', headers })
await request(`/admin/modeling/recipes/${recipe.code}`, { method: 'DELETE', headers })
await request(`/admin/modeling/materials/${code}`, { method: 'DELETE', headers })

console.log(JSON.stringify({ ok: true, code, materialGrade: detail.code, elements: detail.elements.length }))
