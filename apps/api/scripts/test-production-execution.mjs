import { PrismaClient } from '@prisma/client'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseDatabaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const allowRemoteIntegrationTest = process.env.ALLOW_REMOTE_INTEGRATION_TEST === 'true'
const stamp = Date.now()
const schemaName = `test_production_${process.pid}_${stamp}_${randomBytes(4).toString('hex')}`
if (!/^test_production_[a-z0-9_]+$/.test(schemaName)) throw new Error(`临时 schema 名称不安全: ${schemaName}`)

function isolatedDatabaseUrl(baseUrl, schema) {
  const dbUrl = new URL(baseUrl)
  const localHosts = new Set(['127.0.0.1', 'localhost'])
  const databaseName = decodeURIComponent(dbUrl.pathname.replace(/^\/+/, ''))
  const looksLikeProduction = /(^|[_-])(prod|production)([_-]|$)/i.test(databaseName)
  if (!['postgresql:', 'postgres:'].includes(dbUrl.protocol)) throw new Error(`仅支持 PostgreSQL 集成测试连接: ${dbUrl.protocol}`)
  if (!allowRemoteIntegrationTest && (!localHosts.has(dbUrl.hostname) || looksLikeProduction)) {
    throw new Error(
      `拒绝运行生产执行集成测试: DB=${dbUrl.hostname}/${databaseName}；如已确认隔离，请显式设置 ALLOW_REMOTE_INTEGRATION_TEST=true`,
    )
  }
  dbUrl.searchParams.set('schema', schema)
  return dbUrl.toString()
}

const databaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, schemaName)
const managementDatabaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, 'public')
let baseUrl = ''
let prisma
let managementPrisma
let apiProcess
let apiOutput = ''
let apiSpawnError
let schemaCreated = false

const prefix = `TEST-PROD-${stamp}`
const workshopCode = `${prefix}-WS`
const foreignWorkshopCode = `${prefix}-WS-FOREIGN`
const teamCode = `${prefix}-TEAM`
const foreignTeamCode = `${prefix}-TEAM-FOREIGN`
const furnaceCode = `${prefix}-FURNACE`
const alternateFurnaceCode = `${prefix}-FURNACE-ALT`
const pouringLadleCode = `${prefix}-LADLE-POUR`
const spheroidizingLadleCode = `${prefix}-LADLE-SPH`
const unboundFurnaceCode = `${prefix}-FURNACE-UNBOUND`
const disabledFurnaceCode = `${prefix}-FURNACE-DISABLED`
const zeroCapacityFurnaceCode = `${prefix}-FURNACE-ZERO`
const negativeCapacityFurnaceCode = `${prefix}-FURNACE-NEGATIVE`
const unsupportedUnitFurnaceCode = `${prefix}-FURNACE-UNIT`
const productCode = `${prefix}-ITEM`
const secondProductCode = `${prefix}-ITEM-B`
const routingCode = `${prefix}-RT`
const bomCode = `${prefix}-BOM`
const recipeCode = `${prefix}-REC`
const roleName = `${prefix}-ROLE`
const miniRoleName = `${prefix}-MINI-ROLE`
const memberPhone = `17${String(stamp).slice(-9)}`
const outsiderPhone = `18${String(stamp).slice(-9)}`
const restrictedPhone = `19${String(stamp).slice(-9)}`

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  const failed = !response.ok || payload.code !== 0
  if (expectedStatus !== undefined) {
    const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]
    if (!statuses.includes(response.status)) {
      throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}，期望 ${statuses.join('/')}: ${payload.message || ''}`)
    }
    if (response.status >= 500) throw new Error(`${options.method || 'GET'} ${path}: 业务断言不得接受 HTTP ${response.status}`)
    if (response.ok && payload.code !== 0) throw new Error(`${options.method || 'GET'} ${path}: HTTP 成功但业务失败: ${payload.message || payload.code}`)
    return { ...payload, httpStatus: response.status }
  }
  if (failed) throw new Error(`${options.method || 'GET'} ${path}: ${payload.message || response.status}`)
  return payload.data
}

function runCommand(label, command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: apiRoot, env, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`${label}失败: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`)
  }
}

async function availablePort() {
  const configuredPort = process.env.PORT ? Number(process.env.PORT) : 0
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) throw new Error(`PORT 无效: ${process.env.PORT}`)
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(configuredPort, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function waitForHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (apiSpawnError) throw apiSpawnError
    if (apiProcess?.exitCode !== null) throw new Error(`隔离 API 提前退出 (${apiProcess?.exitCode}):\n${apiOutput}`)
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      // The child process may not be listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`等待隔离 API 健康检查超时:\n${apiOutput}`)
}

async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return
  const exited = once(apiProcess, 'exit')
  apiProcess.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 5000)),
  ])
  if (!stopped && apiProcess.exitCode === null) {
    const killed = once(apiProcess, 'exit')
    apiProcess.kill('SIGKILL')
    await killed
  }
}

let testError
let testSummary
const cleanupErrors = []

async function cleanup(label, operation) {
  try {
    await operation()
  } catch (error) {
    cleanupErrors.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }))
  }
}

try {
  runCommand('构建当前 API', 'npm', ['run', 'build'])
  managementPrisma = new PrismaClient({ datasources: { db: { url: managementDatabaseUrl } } })
  await managementPrisma.$connect()
  await managementPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`)
  schemaCreated = true
  runCommand(
    '初始化临时 schema',
    resolve(apiRoot, 'node_modules/.bin/prisma'),
    ['db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'],
    { ...process.env, DATABASE_URL: databaseUrl },
  )
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await prisma.$connect()
  await prisma.user.create({
    data: {
      username: 'admin',
      name: '系统管理员',
      phone: '13665068911',
      passwordHash: hashPassword('13665068911'),
      userType: 'SUPER_ADMIN',
    },
  })
  await prisma.materialGrade.create({
    data: { code: `${prefix}-GRADE`, name: '测试材质牌号', category: '铸铁', status: '启用' },
  })
  const port = await availablePort()
  baseUrl = `http://127.0.0.1:${port}/api`
  apiProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  apiProcess.stdout.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.stderr.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.on('error', (error) => { apiSpawnError = error })
  await waitForHealth(baseUrl)

  const admin = await prisma.user.findFirst({ where: { OR: [{ username: 'admin' }, { userType: 'SUPER_ADMIN' }] } })
  const grade = await prisma.materialGrade.findFirst({ where: { status: '启用' }, orderBy: { code: 'asc' } })
  if (!admin || !grade) throw new Error('测试需要管理员和启用材质牌号')

  const role = await prisma.role.create({
    data: {
      name: roleName,
      app: 'admin',
      dataScope: 'ALL',
      dataScopes: ['ALL'],
      permissions: ['production.heat.view', 'production.heat.start', 'production.heat.transfer', 'production.heat.complete'],
    },
  })
  const restrictedRole = await prisma.role.create({
    data: {
      name: `${prefix}-RESTRICTED-ROLE`,
      app: 'admin',
      dataScope: 'OWN',
      dataScopes: ['OWN'],
      permissions: ['production.schedule.view', 'production.schedule.adjust'],
    },
  })
  const [memberUser, outsiderUser] = await Promise.all([
    prisma.user.create({ data: { username: memberPhone, phone: memberPhone, name: '测试炉前班员', passwordHash: hashPassword('123456'), userType: 'EMPLOYEE', roles: { create: { roleId: role.id } } } }),
    prisma.user.create({ data: { username: outsiderPhone, phone: outsiderPhone, name: '测试非执行人员', passwordHash: hashPassword('123456'), userType: 'EMPLOYEE', roles: { create: { roleId: role.id } } } }),
  ])
  await prisma.user.create({ data: { username: restrictedPhone, phone: restrictedPhone, name: '测试受限排产员', passwordHash: hashPassword('123456'), userType: 'EMPLOYEE', roles: { create: { roleId: restrictedRole.id } } } })

  await prisma.workshop.create({ data: { code: workshopCode, name: '测试熔炼车间', type: '熔炼', status: '启用' } })
  await prisma.workshop.create({ data: { code: foreignWorkshopCode, name: '测试异地车间', type: '熔炼', status: '启用' } })
  await prisma.team.create({
    data: {
      code: teamCode,
      name: '测试熔炼甲班',
      workshopCode,
      leaderUserId: admin.id,
      status: '启用',
      members: { create: [{ userId: admin.id }, { userId: memberUser.id }] },
    },
  })
  await prisma.team.create({
    data: {
      code: foreignTeamCode,
      name: '测试异地班组',
      workshopCode: foreignWorkshopCode,
      leaderUserId: admin.id,
      status: '启用',
    },
  })
  await prisma.furnace.create({
    data: { code: furnaceCode, name: '测试9.75吨中频炉', equipmentType: '熔炼炉', workshopCode, capacity: 9.75, capacityUnit: '吨/炉', status: '启用' },
  })
  await prisma.furnace.createMany({
    data: [
      { code: alternateFurnaceCode, name: '测试备用10吨中频炉', equipmentType: '熔炼炉', workshopCode, capacity: 10, capacityUnit: '吨/炉', status: '启用' },
      { code: pouringLadleCode, name: '测试1号浇注包', equipmentType: '浇注包', workshopCode, status: '启用' },
      { code: spheroidizingLadleCode, name: '测试1号球化包', equipmentType: '球化包', workshopCode, status: '启用' },
      { code: unboundFurnaceCode, name: '测试未绑定配方炉', workshopCode, capacity: 9.75, capacityUnit: '吨/炉', status: '启用' },
      { code: disabledFurnaceCode, name: '测试停用炉', workshopCode, capacity: 9.75, capacityUnit: '吨/炉', status: '停用' },
      { code: zeroCapacityFurnaceCode, name: '测试零容量炉', workshopCode, capacity: 0, capacityUnit: '吨/炉', status: '启用' },
      { code: negativeCapacityFurnaceCode, name: '测试负容量炉', workshopCode, capacity: -1, capacityUnit: '吨/炉', status: '启用' },
      { code: unsupportedUnitFurnaceCode, name: '测试非法单位炉', workshopCode, capacity: 10, capacityUnit: 'kg/h', status: '启用' },
    ],
  })
  await prisma.product.createMany({
    data: [
      { code: productCode, name: '测试泵体毛坯', type: '半成品', unit: '件', materialGradeCode: grade.code },
      { code: secondProductCode, name: '测试阀体毛坯', type: '半成品', unit: '件', materialGradeCode: grade.code },
    ],
  })

  const bom = await prisma.castingBom.create({ data: { code: bomCode, productCode } })
  const bomVersion = await prisma.castingBomVersion.create({
    data: {
      bomId: bom.id,
      version: 'V1.0',
      materialGradeCode: grade.code,
      productNameSnapshot: '测试泵体毛坯',
      netWeightKg: 45,
      grossWeightKg: 65,
      yieldRate: 69.2308,
      returnWeightKg: 20,
      status: 'ACTIVE',
      createdByUserId: admin.id,
    },
  })
  const routing = await prisma.processRouting.create({ data: { code: routingCode, name: '测试泵体标准路线' } })
  const routingVersion = await prisma.processRoutingVersion.create({
    data: {
      routingId: routing.id,
      version: 'V1.0',
      status: 'ACTIVE',
      createdByUserId: admin.id,
      products: { create: { productCode } },
    },
  })
  await prisma.productDefaultRouting.create({ data: { productCode, routingVersionId: routingVersion.id } })
  await prisma.meltRecipe.create({
    data: {
      code: recipeCode,
      name: '测试材质标准配方',
      materialGradeCode: grade.code,
      version: 'V1.0',
      status: 'ACTIVE',
      createdByUserId: admin.id,
      applicableFurnaces: {
        create: [
          { furnaceCode },
          { furnaceCode: alternateFurnaceCode },
          { furnaceCode: disabledFurnaceCode },
          { furnaceCode: zeroCapacityFurnaceCode },
          { furnaceCode: negativeCapacityFurnaceCode },
          { furnaceCode: unsupportedUnitFurnaceCode },
        ],
      },
    },
  })

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: '13665068911' }),
  })
  const headers = { authorization: `Bearer ${login.token}` }
  const scheduleWorkshopsBeforeOrders = await request('/admin/production/equipment-schedule/workshops', { headers })
  if (!scheduleWorkshopsBeforeOrders.some((item) => item.code === workshopCode)) {
    throw new Error('没有待排工单时仍应返回可用熔炼车间')
  }
  const recipeDraftBody = {
    name: '测试时长配方草稿', materialGradeCode: grade.code, furnaceCodes: [furnaceCode], version: 'V1.0', baseWeightKg: 1000,
    meltingDurationMinutes: 60, transferDurationMinutes: 15, cleaningDurationMinutes: 15, targetElements: [], items: [],
  }
  await request('/admin/modeling/recipes', { method: 'POST', headers, body: JSON.stringify({ ...recipeDraftBody, meltingDurationMinutes: 0, transferDurationMinutes: 0, cleaningDurationMinutes: 0 }) }, 400)
  await request('/admin/modeling/recipes', { method: 'POST', headers, body: JSON.stringify({ ...recipeDraftBody, meltingDurationMinutes: 1.5 }) }, 400)
  const durationRecipe = await request('/admin/modeling/recipes', { method: 'POST', headers, body: JSON.stringify(recipeDraftBody) })
  if (durationRecipe.occupancyDurationMinutes !== 90) throw new Error('配方接口未保存或返回标准占用时长')
  const durationRecipeClone = await request(`/admin/modeling/recipes/${durationRecipe.code}/clone`, { method: 'POST', headers })
  if (durationRecipeClone.occupancyDurationMinutes !== 90) throw new Error('配方克隆未复制三个时长字段')
  const memberLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: memberPhone, password: '123456' }) })
  const memberHeaders = { authorization: `Bearer ${memberLogin.token}` }
  const outsiderLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: outsiderPhone, password: '123456' }) })
  const outsiderHeaders = { authorization: `Bearer ${outsiderLogin.token}` }
  const restrictedLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: restrictedPhone, password: '123456' }) })
  const restrictedHeaders = { authorization: `Bearer ${restrictedLogin.token}` }
  const options = await request('/admin/production/work-orders/options', { headers })
  if (!options.products.some((item) => item.code === productCode)) throw new Error('工单选项缺少测试产品')
  if (!options.products.some((item) => item.code === secondProductCode)) {
    throw new Error('工单选项应包含尚未配置 BOM 或工艺路线的成品/半成品')
  }

  const preview = await request(`/admin/production/work-orders/product-preview/${productCode}`, { headers })
  if (preview.bomVersionId !== bomVersion.id || preview.routingVersionId !== routingVersion.id) throw new Error('未带入生效 BOM 或默认路线')

  const order = await request('/admin/production/work-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      productCode,
      bomVersionId: bomVersion.id,
      routingVersionId: routingVersion.id,
      plannedQuantity: 100,
      plannedDeliveryDate: '2026-08-30',
      priority: 'URGENT',
      remark: '生产工单自动化测试',
    }),
  })
  if (!/^WO\d{11}$/.test(order.code)) throw new Error(`工单编号格式错误: ${order.code}`)
  if (order.scheduleStatus !== 'PENDING' || order.productionStatus !== 'RELEASED') throw new Error('新工单初始状态错误')
  if (order.totalNetWeightKg !== 4500 || order.totalMeltWeightKg !== 6500 || order.expectedReturnWeightKg !== 2000) {
    throw new Error('工单重量计算错误')
  }
  if (order.bomVersionId !== bomVersion.id || order.routingVersionId !== routingVersion.id) throw new Error('工单版本快照未锁定')

  const ownership = await prisma.businessDataOwnership.findUnique({
    where: { entityType_entityId: { entityType: 'production:work-orders', entityId: order.id } },
  })
  if (!ownership) throw new Error('生产工单未写入数据归属')

  const pool = await request('/admin/production/melt-pool', { headers })
  const poolOrder = pool.groups.flatMap((group) => group.orders).find((item) => item.id === order.id)
  if (!poolOrder || poolOrder.remainingQuantity !== 100 || poolOrder.remainingWeightKg !== 6500) throw new Error('工单未正确进入排产池')

  const edited = await request(`/admin/production/work-orders/${order.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      productCode,
      bomVersionId: bomVersion.id,
      routingVersionId: routingVersion.id,
      plannedQuantity: 80,
      plannedDeliveryDate: '2026-08-31',
      priority: 'NORMAL',
      versionNo: order.versionNo,
    }),
  })
  if (edited.plannedQuantity !== 80 || edited.totalMeltWeightKg !== 5200 || edited.versionNo !== order.versionNo + 1) {
    throw new Error('未排产工单编辑失败')
  }

  const orderB = await request('/admin/production/work-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      productCode,
      bomVersionId: bomVersion.id,
      routingVersionId: routingVersion.id,
      plannedQuantity: 100,
      plannedDeliveryDate: '2026-09-01',
      priority: 'NORMAL',
    }),
  })

  const zeroDurationFailure = await request('/admin/production/heat-orders', {
    method: 'POST', headers,
    body: JSON.stringify({
      materialGradeCode: grade.code, workshopCode, furnaceCode, recipeCode, teamCode,
      plannedStartAt: '2026-08-30T07:00:00+08:00', plannedFinishAt: '2026-08-30T08:00:00+08:00',
      allocations: [{ workOrderId: order.id, quantity: 1 }],
    }),
  }, 400)
  if (!/配方未维护有效/.test(String(zeroDurationFailure.message || ''))) throw new Error('零时长历史配方应禁止排产')
  await prisma.meltRecipe.update({
    where: { code: recipeCode },
    data: { meltingDurationMinutes: 60, transferDurationMinutes: 15, cleaningDurationMinutes: 15 },
  })

  const scheduleOptions = await request(`/admin/production/melt-pool/options?materialGradeCode=${encodeURIComponent(grade.code)}`, { headers })
  const optionFurnaceCodes = scheduleOptions.furnaces.map((item) => item.code)
  if (JSON.stringify(optionFurnaceCodes) !== JSON.stringify([...optionFurnaceCodes].sort())) {
    throw new Error(`排产设备选项未按 code 排序: ${optionFurnaceCodes.join(',')}`)
  }
  const scheduleFurnace = scheduleOptions.furnaces.find((item) => item.code === furnaceCode)
  if (!scheduleFurnace
    || scheduleFurnace.capacity !== 9.75
    || scheduleFurnace.capacityUnit !== '吨/炉'
    || scheduleFurnace.capacityKg !== 9750) {
    throw new Error('排产设备选项未返回原始能力与 kg 换算值')
  }
  if (scheduleOptions.unavailableReason !== '') throw new Error('存在可用熔炼设备时不应返回不可用原因')
  if (!scheduleOptions.recipes.some((item) => item.code === recipeCode)) throw new Error('排产选项缺少适用配方')
  const scheduleRecipe = scheduleOptions.recipes.find((item) => item.code === recipeCode)
  if (!scheduleRecipe?.durationConfigured || scheduleRecipe.occupancyDurationMinutes !== 90) throw new Error('排产选项未返回配方时长')
  if (!scheduleOptions.workshops.some((item) => item.code === workshopCode)) throw new Error('排产选项缺少可用熔炼车间')
  if (!scheduleOptions.teams.some((item) => item.code === teamCode)) throw new Error('排产选项缺少执行班组')
  for (const excludedCode of [unboundFurnaceCode, disabledFurnaceCode, zeroCapacityFurnaceCode, negativeCapacityFurnaceCode, unsupportedUnitFurnaceCode]) {
    if (scheduleOptions.furnaces.some((item) => item.code === excludedCode)) {
      throw new Error(`无效熔炼设备不应出现在排产选项: ${excludedCode}`)
    }
  }
  if (scheduleOptions.teams.some((item) => item.code === foreignTeamCode)) throw new Error('异地班组不应出现在当前设备车间选项')
  const unavailableOptions = await request(`/admin/production/melt-pool/options?materialGradeCode=${encodeURIComponent(`${prefix}-NO-FURNACE`)}`, { headers })
  if (unavailableOptions.unavailableReason !== '当前材质暂无可用熔炼设备，请检查已生效配方和设备容量配置') {
    throw new Error('无有效设备时未返回明确不可用原因')
  }

  async function expectRejectedHeat(candidateFurnaceCode, candidateTeamCode, messagePattern, label) {
    const failure = await request('/admin/production/heat-orders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        materialGradeCode: grade.code,
        workshopCode,
        furnaceCode: candidateFurnaceCode,
        recipeCode,
        teamCode: candidateTeamCode,
        plannedStartAt: '2026-08-30T09:00:00+08:00',
        plannedFinishAt: '2026-08-30T10:30:00+08:00',
        allocations: [{ workOrderId: order.id, quantity: 1 }],
      }),
    }, 400)
    if (!messagePattern.test(String(failure.message || ''))) {
      throw new Error(`${label}拒绝原因不正确: ${failure.message || ''}`)
    }
  }

  await expectRejectedHeat(unboundFurnaceCode, teamCode, /配方与材质或熔炼设备不匹配/, '未绑定配方设备')
  await expectRejectedHeat(disabledFurnaceCode, teamCode, /熔炼设备不存在或未配置能力/, '停用设备')
  await expectRejectedHeat(zeroCapacityFurnaceCode, teamCode, /大于 0/, '零容量设备')
  await expectRejectedHeat(negativeCapacityFurnaceCode, teamCode, /大于 0/, '负容量设备')
  await expectRejectedHeat(unsupportedUnitFurnaceCode, teamCode, /单炉重量/, '不支持单位设备')
  await expectRejectedHeat(furnaceCode, foreignTeamCode, /执行班组必须属于设备所在车间/, '异地班组')
  const wrongWorkshop = await request('/admin/production/heat-orders', {
    method: 'POST', headers,
    body: JSON.stringify({
      materialGradeCode: grade.code, workshopCode: foreignWorkshopCode, furnaceCode, recipeCode, teamCode,
      plannedStartAt: '2026-08-30T06:00:00+08:00', plannedFinishAt: '2026-08-30T07:30:00+08:00',
      allocations: [{ workOrderId: order.id, quantity: 1 }],
    }),
  }, 400)
  if (!/不属于所选启用熔炼车间/.test(String(wrongWorkshop.message || ''))) throw new Error('车间与设备不匹配应被拒绝')

  const concurrentOrder = await request('/admin/production/work-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      productCode,
      bomVersionId: bomVersion.id,
      routingVersionId: routingVersion.id,
      plannedQuantity: 10,
      plannedDeliveryDate: '2026-09-02',
      priority: 'NORMAL',
    }),
  })
  const concurrentHeatBody = JSON.stringify({
    materialGradeCode: grade.code,
    workshopCode,
    furnaceCode,
    recipeCode,
    teamCode,
    plannedStartAt: '2026-08-30T09:15:00+08:00',
    plannedFinishAt: '2026-08-30T10:45:00+08:00',
    allocations: [{ workOrderId: concurrentOrder.id, quantity: 10 }],
  })
  const concurrentResults = await Promise.allSettled([
    request('/admin/production/heat-orders', { method: 'POST', headers, body: concurrentHeatBody }, [201, 409]),
    request('/admin/production/heat-orders', { method: 'POST', headers, body: concurrentHeatBody }, [201, 409]),
  ])
  const rejectedConcurrency = concurrentResults.find((result) => result.status === 'rejected')
  if (rejectedConcurrency) throw rejectedConcurrency.reason
  const concurrencyStatuses = concurrentResults.map((result) => result.value.httpStatus).sort((a, b) => a - b)
  if (concurrencyStatuses[0] !== 201 || concurrencyStatuses[1] !== 409) {
    throw new Error(`并发排产结果应为 201/409，实际为 ${concurrencyStatuses.join('/')}`)
  }
  const activeConcurrentAllocations = await prisma.heatOrderAllocation.findMany({
    where: { workOrderId: concurrentOrder.id, heatOrder: { status: { not: 'CANCELED' } } },
    select: { allocatedQuantity: true },
  })
  const activeConcurrentQuantity = activeConcurrentAllocations.reduce((sum, item) => sum + item.allocatedQuantity, 0)
  if (activeConcurrentQuantity > concurrentOrder.plannedQuantity) {
    throw new Error(`并发排产发生超分配: ${activeConcurrentQuantity} > ${concurrentOrder.plannedQuantity}`)
  }
  const checkedConflicts = await request('/admin/production/heat-orders/check-conflicts', {
    method: 'POST', headers,
    body: JSON.stringify({ furnaceCode, plannedStartAt: '2026-08-30T10:00:00+08:00', plannedFinishAt: '2026-08-30T10:30:00+08:00' }),
  })
  if (!checkedConflicts.conflicts.length) throw new Error('冲突检查接口未识别重叠炉次')
  const adjacentConflicts = await request('/admin/production/heat-orders/check-conflicts', {
    method: 'POST', headers,
    body: JSON.stringify({ furnaceCode, plannedStartAt: '2026-08-30T10:45:00+08:00', plannedFinishAt: '2026-08-30T11:15:00+08:00' }),
  })
  if (adjacentConflicts.conflicts.length) throw new Error('首尾相邻区间不应被识别为冲突')
  const unconfirmedConflict = await request('/admin/production/heat-orders', {
    method: 'POST', headers,
    body: JSON.stringify({
      materialGradeCode: grade.code, workshopCode, furnaceCode, recipeCode, teamCode,
      plannedStartAt: '2026-08-30T10:00:00+08:00', plannedFinishAt: '2026-08-30T10:30:00+08:00',
      allocations: [{ workOrderId: order.id, quantity: 1 }],
    }),
  }, 409)
  if (unconfirmedConflict.conflictCode !== 'HEAT_SCHEDULE_CONFLICT' || !unconfirmedConflict.data?.conflicts?.length) {
    throw new Error('首次冲突提交未返回结构化 409 冲突清单')
  }

  const overCapacity = await request('/admin/production/heat-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      materialGradeCode: grade.code,
      workshopCode,
      furnaceCode,
      recipeCode,
      teamCode,
      plannedStartAt: '2026-08-30T09:30:00+08:00',
      plannedFinishAt: '2026-08-30T11:00:00+08:00',
      allocations: [
        { workOrderId: order.id, quantity: 80 },
        { workOrderId: orderB.id, quantity: 100 },
      ],
    }),
  }, 400)
  const overCapacityMessage = String(overCapacity.message || '')
  for (const detail of ['测试9.75吨中频炉', '9750', '11700', '1950']) {
    if (!overCapacityMessage.includes(detail)) throw new Error(`超容量错误缺少 ${detail}: ${overCapacityMessage}`)
  }

  const canceledHeat = await request('/admin/production/heat-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      materialGradeCode: grade.code,
      workshopCode,
      furnaceCode,
      recipeCode,
      teamCode,
      plannedStartAt: '2026-08-30T08:30:00+08:00',
      plannedFinishAt: '2026-08-30T10:00:00+08:00',
      confirmScheduleConflict: true,
      allocations: [
        { workOrderId: order.id, quantity: 50 },
        { workOrderId: orderB.id, quantity: 100 },
      ],
    }),
  })
  if (canceledHeat.targetWeightKg !== 9750 || canceledHeat.status !== 'WAITING') throw new Error('目标重量等于单炉容量时应允许创建')
  const canceled = await request(`/admin/production/heat-orders/${canceledHeat.id}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionNo: canceledHeat.versionNo, reason: '自动化测试撤销' }),
  })
  if (canceled.status !== 'CANCELED') throw new Error('待生产炉次未撤销')
  const poolAfterCancel = await request('/admin/production/melt-pool', { headers })
  const returnedA = poolAfterCancel.groups.flatMap((group) => group.orders).find((item) => item.id === order.id)
  if (!returnedA || returnedA.remainingQuantity !== 80) throw new Error('撤销炉次后分配数量未返回排产池')

  let heatA = await request('/admin/production/heat-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      materialGradeCode: grade.code,
      workshopCode,
      furnaceCode,
      recipeCode,
      teamCode,
      plannedStartAt: '2026-08-30T09:30:00+08:00',
      plannedFinishAt: '2026-08-30T11:15:00+08:00',
      confirmScheduleConflict: true,
      allocations: [
        { workOrderId: order.id, quantity: 50 },
        { workOrderId: orderB.id, quantity: 20 },
      ],
    }),
  })
  if (heatA.targetWeightKg !== 4550 || heatA.allocations.length !== 2) throw new Error('同材质合炉计算错误')
  if (heatA.workshopCode !== workshopCode || heatA.occupancyDurationMinutes !== 90) throw new Error('炉次未保存车间或时长快照')
  if (heatA.calculatedFinishAt !== '2026-08-30T03:00:00.000Z' || !heatA.finishTimeAdjusted) throw new Error('炉次自动完成时间或人工调整标识错误')
  const originalHeatAVersion = heatA.versionNo
  await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers: restrictedHeaders,
    body: JSON.stringify({ versionNo: heatA.versionNo, furnaceCode: alternateFurnaceCode, plannedStartAt: '2026-08-30T12:15:00+08:00' }),
  }, 404)
  const afterDeniedAdjustment = await prisma.heatOrder.findUniqueOrThrow({ where: { id: heatA.id } })
  if (afterDeniedAdjustment.versionNo !== heatA.versionNo || afterDeniedAdjustment.furnaceCode !== furnaceCode) {
    throw new Error('不可见炉次被受限用户越权调整')
  }
  const restrictedConflictProbe = await request('/admin/production/heat-orders/check-conflicts', {
    method: 'POST', headers: restrictedHeaders,
    body: JSON.stringify({ furnaceCode, plannedStartAt: '2026-08-30T09:30:00+08:00', plannedFinishAt: '2026-08-30T10:00:00+08:00' }),
  })
  if (!restrictedConflictProbe.conflicts.length
    || restrictedConflictProbe.conflicts.some((item) => item.id || item.code !== '其他排程占用' || item.plannedStartAt || item.plannedFinishAt)) {
    throw new Error('冲突查询泄露了数据范围外的炉次信息')
  }
  await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: heatA.versionNo, furnaceCode: alternateFurnaceCode, plannedStartAt: '2026-08-30T12:07:00+08:00' }),
  }, 400)
  const crossDeviceAdjusted = await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: heatA.versionNo, furnaceCode: alternateFurnaceCode, plannedStartAt: '2026-08-30T12:15:00+08:00' }),
  })
  if (crossDeviceAdjusted.furnaceCode !== alternateFurnaceCode
    || crossDeviceAdjusted.plannedStartAt !== '2026-08-30T04:15:00.000Z'
    || crossDeviceAdjusted.plannedFinishAt !== '2026-08-30T06:00:00.000Z') {
    throw new Error('跨设备调整未保存目标设备、15 分钟时间或原计划占用时长')
  }
  await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: originalHeatAVersion, furnaceCode: alternateFurnaceCode, plannedStartAt: '2026-08-30T12:30:00+08:00' }),
  }, 409)
  await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: crossDeviceAdjusted.versionNo, furnaceCode: unboundFurnaceCode, plannedStartAt: '2026-08-30T12:30:00+08:00' }),
  }, 400)
  const scheduleConflict = await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: crossDeviceAdjusted.versionNo, furnaceCode, plannedStartAt: '2026-08-30T09:45:00+08:00' }),
  }, 409)
  if (scheduleConflict.conflictCode !== 'HEAT_SCHEDULE_CONFLICT' || !scheduleConflict.data?.conflicts?.length) {
    throw new Error('调整排程冲突未返回结构化 409 冲突清单')
  }
  heatA = await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: crossDeviceAdjusted.versionNo, furnaceCode, plannedStartAt: '2026-08-30T09:45:00+08:00', confirmScheduleConflict: true }),
  })
  if (!heatA.hasScheduleConflict || !heatA.confirmedScheduleConflicts.length) throw new Error('调整后的排程冲突未同步到炉次详情')
  const scheduleRecords = await prisma.heatOrderRecord.findMany({ where: { heatOrderId: heatA.id, action: 'SCHEDULE_ADJUSTED' }, orderBy: { createdAt: 'asc' } })
  if (scheduleRecords.length !== 2
    || scheduleRecords[0].operatorUserId !== admin.id
    || scheduleRecords[0].payload.fromFurnaceCode !== furnaceCode
    || scheduleRecords[0].payload.toFurnaceCode !== alternateFurnaceCode) {
    throw new Error('排程调整记录未保存设备、时间或操作人快照')
  }
  await request(`/admin/production/work-orders/${order.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...edited, plannedDeliveryDate: '2026-09-02' }),
  }, 400)

  await request('/mini/production/heat-orders?status=WAITING', { headers: memberHeaders }, 403)
  const miniRole = await prisma.role.create({
    data: {
      name: miniRoleName,
      app: '小程序端',
      dataScope: 'OWN',
      dataScopes: ['OWN'],
      permissions: ['mini.production.heat.view', 'mini.production.heat.start', 'mini.production.heat.transfer', 'mini.production.heat.complete'],
    },
  })
  await prisma.userRole.createMany({
    data: [
      { userId: memberUser.id, roleId: miniRole.id },
      { userId: outsiderUser.id, roleId: miniRole.id },
    ],
  })

  const mobileList = await request('/mini/production/heat-orders?status=WAITING', { headers: memberHeaders })
  if (!mobileList.some((item) => item.id === heatA.id)) throw new Error('执行班组成员未看到待生产炉次')
  const outsiderList = await request('/mini/production/heat-orders?status=WAITING', { headers: outsiderHeaders })
  if (outsiderList.some((item) => item.id === heatA.id)) throw new Error('非执行班组成员看到了炉次')
  await request(`/mini/production/heat-orders/${heatA.id}`, { headers: outsiderHeaders }, 404)
  const executionOptions = await request(`/mini/production/heat-orders/${heatA.id}/execution-options`, { headers: memberHeaders })
  if (executionOptions.targetWeightKg !== heatA.targetWeightKg || executionOptions.transferTotalWeightKg !== 0 || executionOptions.remainingTransferWeightKg !== heatA.targetWeightKg) {
    throw new Error('执行选项未返回正确的目标、已转运和剩余可转运重量')
  }
  if (!executionOptions.furnaces.some((item) => item.code === alternateFurnaceCode)) throw new Error('执行选项缺少符合条件的备用熔炉')
  if (!executionOptions.transferDevices.some((item) => item.code === pouringLadleCode)) throw new Error('执行选项缺少浇注包')
  if (!executionOptions.transferDevices.some((item) => item.code === spheroidizingLadleCode)) throw new Error('执行选项缺少球化包')
  const unconfirmedFurnaceChange = await request(`/mini/production/heat-orders/${heatA.id}/start`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: heatA.versionNo, actualFurnaceCode: alternateFurnaceCode }),
  }, 409)
  if (unconfirmedFurnaceChange.conflictCode !== 'FURNACE_CHANGE_CONFIRMATION_REQUIRED') throw new Error('更换实际熔炉未要求二次确认')
  const startedA = await request(`/mini/production/heat-orders/${heatA.id}/start`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: heatA.versionNo, actualFurnaceCode: alternateFurnaceCode, confirmFurnaceChange: true }),
  })
  if (startedA.status !== 'IN_PROGRESS' || !startedA.startedAt || startedA.actualFurnaceCode !== alternateFurnaceCode || startedA.furnaceCode !== furnaceCode) throw new Error('小程序开始生产或计划/实际熔炉绑定失败')
  const unrelatedFutureConflict = await request('/admin/production/heat-orders/check-conflicts', {
    method: 'POST', headers,
    body: JSON.stringify({ furnaceCode: alternateFurnaceCode, plannedStartAt: '2026-09-01T09:00:00+08:00', plannedFinishAt: '2026-09-01T10:00:00+08:00' }),
  })
  if (unrelatedFutureConflict.conflicts.some((item) => item.id === heatA.id)) throw new Error('活动炉次错误占用了计划区间之外的未来排程')
  await request(`/admin/production/heat-orders/${heatA.id}/schedule`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: startedA.versionNo, furnaceCode, plannedStartAt: '2026-08-30T12:00:00+08:00' }),
  }, 409)
  await request(`/admin/production/heat-orders/${heatA.id}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionNo: startedA.versionNo, reason: '生产中不允许撤销' }),
  }, 409)
  await prisma.team.update({ where: { code: teamCode }, data: { status: '禁用' } })
  await request(`/mini/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST', headers: memberHeaders,
    body: JSON.stringify({ versionNo: startedA.versionNo, transferDeviceCode: pouringLadleCode, weightKg: 100 }),
  }, 400)
  await prisma.team.update({ where: { code: teamCode }, data: { status: '启用' } })
  await prisma.team.update({ where: { code: teamCode }, data: { workshopCode: foreignWorkshopCode } })
  await request(`/mini/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST', headers: memberHeaders,
    body: JSON.stringify({ versionNo: startedA.versionNo, transferDeviceCode: pouringLadleCode, weightKg: 100 }),
  }, 400)
  await prisma.team.update({ where: { code: teamCode }, data: { workshopCode } })
  await prisma.workshop.update({ where: { code: workshopCode }, data: { status: '禁用' } })
  await request(`/mini/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST', headers: memberHeaders,
    body: JSON.stringify({ versionNo: startedA.versionNo, transferDeviceCode: pouringLadleCode, weightKg: 100 }),
  }, 400)
  await prisma.workshop.update({ where: { code: workshopCode }, data: { status: '启用' } })
  const transferA1 = await request(`/mini/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: startedA.versionNo, transferDeviceCode: pouringLadleCode, weightKg: 2000, remark: '第一次转运' }),
  })
  if (transferA1.status !== 'TRANSFERRING' || transferA1.transferTotalWeightKg !== 2000 || transferA1.transfers.length !== 1) throw new Error('首次转运未进入转运中或未保存明细')
  const optionsAfterTransferA1 = await request(`/mini/production/heat-orders/${heatA.id}/execution-options`, { headers: memberHeaders })
  if (optionsAfterTransferA1.remainingTransferWeightKg !== heatA.targetWeightKg - 2000) throw new Error('首次转运后剩余可转运重量未正确递减')
  await request(`/admin/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionNo: startedA.versionNo, transferDeviceCode: pouringLadleCode, weightKg: 100 }),
  }, 409)
  await request(`/mini/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: transferA1.versionNo, transferDeviceCode: pouringLadleCode, weightKg: optionsAfterTransferA1.remainingTransferWeightKg + 0.01 }),
  }, 400)
  const transferA2 = await request(`/mini/production/heat-orders/${heatA.id}/transfer`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: transferA1.versionNo, transferDeviceCode: spheroidizingLadleCode, weightKg: 2500, remark: '第二次转运' }),
  })
  if (transferA2.status !== 'TRANSFERRING' || transferA2.transferTotalWeightKg !== 4500 || transferA2.transfers.length !== 2) throw new Error('多次转运累计错误')
  const orderBeforeInvalidClose = await request(`/admin/production/work-orders/${order.id}`, { headers })
  await request(`/admin/production/work-orders/${order.id}/close`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: orderBeforeInvalidClose.versionNo, reason: '转运中禁止关闭' }),
  }, 400)
  const transferringSchedule = await request(`/admin/production/equipment-schedule?workshopCode=${encodeURIComponent(workshopCode)}&date=2026-08-30`, { headers })
  const transferringPlannedDevice = transferringSchedule.devices.find((item) => item.code === furnaceCode)
  const transferringActualDevice = transferringSchedule.devices.find((item) => item.code === alternateFurnaceCode)
  if (transferringPlannedDevice?.heats.some((item) => item.id === heatA.id) || !transferringActualDevice?.heats.some((item) => item.id === heatA.id)) {
    throw new Error('执行中的炉次未按实际熔炉归入设备排程')
  }
  const completedA = await request(`/mini/production/heat-orders/${heatA.id}/complete`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: transferA2.versionNo, remark: '自动化测试完成第一炉' }),
  })
  if (completedA.status !== 'COMPLETED') throw new Error('小程序完成生产失败')
  if (completedA.actualOutputWeightKg !== 4500) throw new Error('未填写最终重量时应默认采用转运累计重量')
  const actualSumA = completedA.allocations.reduce((sum, item) => sum + Number(item.actualWeightKg || 0), 0)
  if (actualSumA !== 4500) throw new Error('实际出炉重量分摊总和错误')
  await request(`/mini/production/heat-orders/${heatA.id}/complete`, {
    method: 'POST',
    headers: memberHeaders,
    body: JSON.stringify({ versionNo: completedA.versionNo, actualOutputWeightKg: 4500 }),
  }, 409)

  const heatB = await request('/admin/production/heat-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      materialGradeCode: grade.code,
      workshopCode,
      furnaceCode,
      recipeCode,
      teamCode,
      plannedStartAt: '2026-08-30T11:30:00+08:00',
      plannedFinishAt: '2026-08-30T13:00:00+08:00',
      allocations: [
        { workOrderId: order.id, quantity: 30 },
        { workOrderId: orderB.id, quantity: 80 },
      ],
    }),
  })
  const startedB = await request(`/admin/production/heat-orders/${heatB.id}/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionNo: heatB.versionNo, actualFurnaceCode: furnaceCode }),
  })
  const transferB = await request(`/admin/production/heat-orders/${heatB.id}/transfer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionNo: startedB.versionNo, transferDeviceCode: pouringLadleCode, weightKg: 7000 }),
  })
  await request(`/admin/production/heat-orders/${heatB.id}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionNo: transferB.versionNo, actualOutputWeightKg: 7100 }),
  })
  const equipmentSchedule = await request(`/admin/production/equipment-schedule?workshopCode=${encodeURIComponent(workshopCode)}&date=2026-08-30`, { headers })
  const scheduleDevice = equipmentSchedule.devices.find((item) => item.code === furnaceCode)
  const actualScheduleDevice = equipmentSchedule.devices.find((item) => item.code === alternateFurnaceCode)
  if (!scheduleDevice || scheduleDevice.heats.some((item) => item.id === heatA.id) || !scheduleDevice.heats.some((item) => item.id === heatB.id) || !actualScheduleDevice?.heats.some((item) => item.id === heatA.id)) {
    throw new Error('设备排程概览未返回车间设备和有效炉次')
  }
  const scheduledHeatA = actualScheduleDevice.heats.find((item) => item.id === heatA.id)
  if (scheduledHeatA.capacityUtilizationPercent !== 45.5) {
    throw new Error(`炉次容量占比计算错误: ${scheduledHeatA.capacityUtilizationPercent}`)
  }
  if (scheduleDevice.heats.some((item) => item.id === canceledHeat.id)) throw new Error('已撤销炉次不应进入设备排程概览')
  if (!equipmentSchedule.devices.some((item) => item.code === unboundFurnaceCode && item.heats.length === 0)) {
    throw new Error('设备排程概览应包含没有炉次的空闲设备')
  }
  const restrictedSchedule = await request(`/admin/production/equipment-schedule?workshopCode=${encodeURIComponent(workshopCode)}&date=2026-08-30`, { headers: restrictedHeaders })
  if (restrictedSchedule.devices.some((device) => device.heats.length || device.summary)) throw new Error('设备排程概览泄露了数据范围外的炉次')
  const finalA = await request(`/admin/production/work-orders/${order.id}`, { headers })
  const finalB = await request(`/admin/production/work-orders/${orderB.id}`, { headers })
  if (finalA.productionStatus !== 'MELT_COMPLETED' || finalB.productionStatus !== 'MELT_COMPLETED') {
    throw new Error('全部有效炉次完成后工单未进入熔炼完成')
  }
  if (finalA.meltCompletedWeightKg <= 0 || !finalA.heatOrders.some((item) => item.heatOrderId === heatA.id && item.actualFurnaceCode === alternateFurnaceCode && item.transferTotalWeightKg === 4500)) {
    throw new Error('工单未同步炉次实际熔炉、转运累计或完成重量')
  }
  if (finalA.scheduleStatus !== 'FULL' || finalB.scheduleStatus !== 'FULL') throw new Error('工单全部分配后排产状态错误')

  await request('/admin/production/work-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({ productCode: secondProductCode, plannedQuantity: 10, plannedDeliveryDate: '2026-08-30' }),
  }, 400)
  await request('/admin/production/work-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({ productCode, bomVersionId: bomVersion.id, routingVersionId: routingVersion.id, plannedQuantity: 1.5, plannedDeliveryDate: '2026-08-30' }),
  }, 400)

  testSummary = { ok: true, suite: 'production-execution', workOrder: order.code, completedHeats: [heatA.code, heatB.code] }
} catch (error) {
  testError = error
} finally {
  await cleanup('停止隔离 API', stopApi)
  if (prisma) await cleanup('断开临时 schema 数据库连接', () => prisma.$disconnect())
  if (schemaCreated && managementPrisma) {
    await cleanup('删除临时 schema', () => managementPrisma.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`))
  }
  if (managementPrisma) await cleanup('断开管理数据库连接', () => managementPrisma.$disconnect())
}

if (testError) {
  if (cleanupErrors.length) {
    if (!(testError instanceof Error)) {
      throw new AggregateError([new Error(String(testError)), ...cleanupErrors], '主测试与清理均失败')
    }
    testError.message += `\n清理失败: ${cleanupErrors.map((error) => error.message).join('; ')}`
    testError.cleanupErrors = cleanupErrors
  }
  throw testError
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, '生产执行集成测试清理失败')
console.log(JSON.stringify(testSummary))
