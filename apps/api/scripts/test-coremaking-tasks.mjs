import { PrismaClient } from '@prisma/client'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseDatabaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const allowRemoteIntegrationTest = process.env.ALLOW_REMOTE_INTEGRATION_TEST === 'true'
const stamp = Date.now()
const schemaName = `test_coremaking_tasks_${process.pid}_${stamp}_${randomBytes(4).toString('hex')}`

function isolatedDatabaseUrl(baseUrl, schema) {
  const dbUrl = new URL(baseUrl)
  const databaseName = decodeURIComponent(dbUrl.pathname.replace(/^\/+/, ''))
  const localHosts = new Set(['127.0.0.1', 'localhost'])
  if (!['postgresql:', 'postgres:'].includes(dbUrl.protocol)) throw new Error('制芯任务测试仅支持 PostgreSQL')
  if (!allowRemoteIntegrationTest && (!localHosts.has(dbUrl.hostname) || /(^|[_-])(prod|production)([_-]|$)/i.test(databaseName))) {
    throw new Error(`拒绝在非本地或疑似生产数据库运行制芯任务测试: ${dbUrl.hostname}/${databaseName}`)
  }
  dbUrl.searchParams.set('schema', schema)
  return dbUrl.toString()
}

const databaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, schemaName)
const managementDatabaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, 'public')
const prefix = `TEST-CORE-${stamp}`
let prisma
let managementPrisma
let apiProcess
let apiOutput = ''
let apiSpawnError
let schemaCreated = false

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function runCommand(label, command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: apiRoot, env, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`${label}失败: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`)
  }
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (apiSpawnError) throw apiSpawnError
    if (apiProcess?.exitCode !== null) throw new Error(`隔离 API 提前退出 (${apiProcess?.exitCode}):\n${apiOutput}`)
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // API may still be starting.
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
    new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 5_000)),
  ])
  if (!stopped && apiProcess.exitCode === null) {
    const killed = once(apiProcess, 'exit')
    apiProcess.kill('SIGKILL')
    await killed
  }
}

async function request(baseUrl, path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  if (expectedStatus !== undefined) {
    const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]
    if (!statuses.includes(response.status)) {
      throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}，期望 ${statuses.join('/')}: ${payload.message || ''}`)
    }
    if (response.status >= 500) throw new Error(`${options.method || 'GET'} ${path}: 不应返回 HTTP ${response.status}`)
    return { ...payload, httpStatus: response.status }
  }
  if (!response.ok || payload.code !== 0) throw new Error(`${options.method || 'GET'} ${path}: ${payload.message || response.status}`)
  return payload.data
}

function workOrderData({ code, product, bomVersion, routingVersion, admin, quantity = 100 }) {
  return {
    code,
    productCode: product.code,
    productCodeSnapshot: product.code,
    productNameSnapshot: product.name,
    bomVersionId: bomVersion.id,
    bomCodeSnapshot: bomVersion.bom.code,
    bomVersionSnapshot: bomVersion.version,
    routingVersionId: routingVersion.id,
    routingCodeSnapshot: routingVersion.routing.code,
    routingNameSnapshot: routingVersion.routing.name,
    routingVersionSnapshot: routingVersion.version,
    materialGradeCode: bomVersion.materialGradeCode,
    materialGradeNameSnapshot: '测试灰铸铁',
    plannedQuantity: quantity,
    plannedDeliveryDate: new Date('2026-09-01T00:00:00.000Z'),
    unitNetWeightKg: 10,
    unitGrossWeightKg: 15,
    yieldRate: 66.6667,
    unitReturnWeightKg: 5,
    totalNetWeightKg: quantity * 10,
    totalMeltWeightKg: quantity * 15,
    expectedReturnWeightKg: quantity * 5,
    createdByUserId: admin.id,
  }
}

async function createBom(product, grade, admin, suffix, coreBoxes) {
  const bom = await prisma.castingBom.create({ data: { code: `${prefix}-BOM-${suffix}`, productCode: product.code } })
  return prisma.castingBomVersion.create({
    data: {
      bomId: bom.id,
      version: 'V1.0',
      materialGradeCode: grade.code,
      productNameSnapshot: product.name,
      netWeightKg: 10,
      grossWeightKg: 15,
      yieldRate: 66.6667,
      returnWeightKg: 5,
      status: 'ACTIVE',
      createdByUserId: admin.id,
      coreBoxes: {
        create: coreBoxes.map((item) => ({
          coreBoxCode: item.code,
          coreBoxNameSnapshot: item.name,
          moldCodeSnapshot: item.moldCode,
          quantityPerProduct: item.ratio,
          shelfLifeHours: item.shelfLifeHours,
        })),
      },
    },
    include: { bom: true },
  })
}

async function createRouting(admin, coreOperation, otherOperation, equipmentCodes, suffix, includeCore) {
  const routing = await prisma.processRouting.create({ data: { code: `${prefix}-RT-${suffix}`, name: `测试路线${suffix}` } })
  return prisma.processRoutingVersion.create({
    data: {
      routingId: routing.id,
      version: 'V1.0',
      status: 'ACTIVE',
      createdByUserId: admin.id,
      nodes: {
        create: [
          ...(includeCore ? [{
            operationCode: coreOperation.code,
            seqNo: 10,
            routeType: 'CORE_BRANCH',
            equipmentLinks: { create: equipmentCodes.map((equipmentCode) => ({ equipmentCode })) },
          }] : []),
          { operationCode: otherOperation.code, seqNo: includeCore ? 20 : 10, routeType: 'MOLD_MAIN' },
        ],
      },
    },
    include: { routing: true, nodes: { include: { operation: true } } },
  })
}

let testError
try {
  runCommand('构建当前 API', 'npm', ['run', 'build'])
  managementPrisma = new PrismaClient({ datasources: { db: { url: managementDatabaseUrl } } })
  await managementPrisma.$connect()
  await managementPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`)
  schemaCreated = true
  runCommand('初始化临时 schema', resolve(apiRoot, 'node_modules/.bin/prisma'), ['db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'], { ...process.env, DATABASE_URL: databaseUrl })
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await prisma.$connect()

  const admin = await prisma.user.create({
    data: { username: 'admin', phone: '13665068911', name: '系统管理员', passwordHash: hashPassword('13665068911'), userType: 'SUPER_ADMIN' },
  })
  const grade = await prisma.materialGrade.create({ data: { code: `${prefix}-GRADE`, name: '测试灰铸铁', status: '启用' } })
  const workshop = await prisma.workshop.create({ data: { code: `${prefix}-WS`, name: '测试制芯车间', type: '制芯', status: '启用' } })
  const foreignWorkshop = await prisma.workshop.create({ data: { code: `${prefix}-WS-X`, name: '测试异地车间', type: '制芯', status: '启用' } })
  const team = await prisma.team.create({ data: { code: `${prefix}-TEAM`, name: '制芯一班', workshopCode: workshop.code, leaderUserId: admin.id, status: '启用' } })
  const foreignTeam = await prisma.team.create({ data: { code: `${prefix}-TEAM-X`, name: '异地制芯班', workshopCode: foreignWorkshop.code, leaderUserId: admin.id, status: '启用' } })
  const equipment = await prisma.furnace.create({ data: { code: `${prefix}-EQ`, name: '一号射芯机', equipmentType: '射芯机', workshopCode: workshop.code, status: '启用' } })
  const disabledEquipment = await prisma.furnace.create({ data: { code: `${prefix}-EQ-OFF`, name: '停用射芯机', equipmentType: '射芯机', workshopCode: workshop.code, status: '停用' } })
  const unboundEquipment = await prisma.furnace.create({ data: { code: `${prefix}-EQ-OTHER`, name: '未绑定射芯机', equipmentType: '射芯机', workshopCode: workshop.code, status: '启用' } })
  const coreOperation = await prisma.operationMaster.create({ data: { code: `${prefix}-OP-CORE`, name: '射芯制芯', section: '制芯', status: 'ENABLED' } })
  const otherOperation = await prisma.operationMaster.create({ data: { code: `${prefix}-OP-MOLD`, name: '造型下芯', section: '造型', status: 'ENABLED' } })

  const products = await Promise.all(['MAIN', 'NOCORE', 'EMPTY'].map((suffix) => prisma.product.create({
    data: { code: `${prefix}-ITEM-${suffix}`, name: `测试铸件${suffix}`, type: '半成品', unit: '件', materialGradeCode: grade.code },
  })))
  const mold = await prisma.moldMaster.create({ data: { code: `${prefix}-MOLD`, name: '测试铸件模具', itemCode: products[0].code, hasCoreBox: true } })
  const coreBoxes = await Promise.all([
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-A`, name: '水道芯盒', moldCode: mold.code, cavityCount: 4 } }),
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-B`, name: '油道芯盒', moldCode: mold.code, cavityCount: 3 } }),
  ])
  const mainBom = await createBom(products[0], grade, admin, 'MAIN', [
    { ...coreBoxes[0], ratio: 2, shelfLifeHours: 8.5 },
    { ...coreBoxes[1], ratio: 1.1, shelfLifeHours: null },
  ])
  const noCoreBom = await createBom(products[1], grade, admin, 'NOCORE', [])
  const emptyBom = await createBom(products[2], grade, admin, 'EMPTY', [])
  const coreRouting = await createRouting(admin, coreOperation, otherOperation, [equipment.code, disabledEquipment.code], 'CORE', true)
  const noCoreRouting = await createRouting(admin, coreOperation, otherOperation, [], 'NOCORE', false)
  await prisma.routingApplicableProduct.create({ data: { routingVersionId: coreRouting.id, productCode: products[0].code } })
  await prisma.meltRecipe.create({ data: { code: `${prefix}-RECIPE`, name: '测试生效熔炼配方', materialGradeCode: grade.code, status: 'ACTIVE' } })
  const coreNode = coreRouting.nodes.find((node) => node.operation.section === '制芯')
  const nonCoreNode = coreRouting.nodes.find((node) => node.operation.section !== '制芯')
  if (!coreNode || !nonCoreNode) throw new Error('测试路线节点初始化失败')
  const noEquipmentCoreNode = await prisma.processRoutingNode.create({
    data: { routingVersionId: coreRouting.id, operationCode: coreOperation.code, seqNo: 15, routeType: 'CORE_BRANCH' },
  })

  const mainWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-MAIN`, product: products[0], bomVersion: mainBom, routingVersion: coreRouting, admin }) })
  const noCoreWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-NOCORE`, product: products[1], bomVersion: noCoreBom, routingVersion: noCoreRouting, admin }) })
  const emptyWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-EMPTY`, product: products[2], bomVersion: emptyBom, routingVersion: coreRouting, admin }) })
  const validationWorkOrders = await Promise.all(['NO-EQUIPMENT', 'NODE', 'UNBOUND', 'DISABLED', 'TEAM'].map((suffix) => prisma.workOrder.create({
    data: workOrderData({ code: `${prefix}-WO-${suffix}`, product: products[0], bomVersion: mainBom, routingVersion: coreRouting, admin }),
  })))
  const concurrentWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-CONCURRENT`, product: products[0], bomVersion: mainBom, routingVersion: coreRouting, admin }) })
  const closedDispatchWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-CLOSED-DISPATCH`, product: products[0], bomVersion: mainBom, routingVersion: coreRouting, admin }) })
  const raceUpdateWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-RACE-UPDATE`, product: products[0], bomVersion: mainBom, routingVersion: coreRouting, admin }) })
  const raceCloseWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-RACE-CLOSE`, product: products[0], bomVersion: mainBom, routingVersion: coreRouting, admin }) })

  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}/api`
  apiProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), JWT_SECRET: 'coremaking-task-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  apiProcess.stdout.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.stderr.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.on('error', (error) => { apiSpawnError = error })
  await waitForHealth(baseUrl)

  const login = await request(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '13665068911' }) })
  const headers = { authorization: `Bearer ${login.token}` }
  const invalidPreviewBody = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks/preview`, {
    method: 'POST', headers, body: 'null',
  }, 400)
  if (invalidPreviewBody.httpStatus !== 400) throw new Error('预览 null 请求体未返回 400')
  const invalidPreviewRows = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks/preview`, {
    method: 'POST', headers, body: JSON.stringify({ rows: {} }),
  }, 400)
  if (!String(invalidPreviewRows.message).includes('rows') || !String(invalidPreviewRows.message).includes('数组')) throw new Error(`预览 rows 类型错误不明确: ${invalidPreviewRows.message}`)
  const invalidCreateBody = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks`, {
    method: 'POST', headers, body: 'null',
  }, 400)
  if (invalidCreateBody.httpStatus !== 400) throw new Error('生成 null 请求体未返回 400')
  const invalidCreateRows = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks`, {
    method: 'POST', headers, body: JSON.stringify({ rows: {} }),
  }, 400)
  if (!String(invalidCreateRows.message).includes('rows') || !String(invalidCreateRows.message).includes('数组')) throw new Error(`生成 rows 类型错误不明确: ${invalidCreateRows.message}`)
  const noCoreDetail = await request(baseUrl, `/admin/production/work-orders/${noCoreWorkOrder.id}`, { headers })
  if (noCoreDetail.requiresCoremaking !== false || noCoreDetail.canGenerateCoreTasks !== false || noCoreDetail.coreTaskCount !== 0) {
    throw new Error('无制芯路线的工单能力摘要不正确')
  }
  const noCorePreview = await request(baseUrl, `/admin/production/work-orders/${noCoreWorkOrder.id}/core-tasks/preview`, { method: 'POST', headers, body: '{}' }, 400)
  if (!String(noCorePreview.message).includes('无需制芯')) throw new Error(`无制芯路线错误不明确: ${noCorePreview.message}`)
  const emptyPreview = await request(baseUrl, `/admin/production/work-orders/${emptyWorkOrder.id}/core-tasks/preview`, { method: 'POST', headers, body: '{}' }, 400)
  if (!String(emptyPreview.message).includes('BOM') || !String(emptyPreview.message).includes('芯盒')) throw new Error(`BOM 无芯盒错误不明确: ${emptyPreview.message}`)
  const emptyDetail = await request(baseUrl, `/admin/production/work-orders/${emptyWorkOrder.id}`, { headers })
  if (!emptyDetail.requiresCoremaking || !emptyDetail.canGenerateCoreTasks) throw new Error('BOM 无芯盒但需要制芯的工单应保留生成入口')

  const preview = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks/preview`, {
    method: 'POST', headers,
    body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, expectedScrapRate: 0.03 }, { coreBoxCode: coreBoxes[1].code, expectedScrapRate: 0 }] }),
  })
  if (preview.rows.length !== 2) throw new Error(`预览应返回 2 个芯盒，实际 ${preview.rows.length}`)
  const previewA = preview.rows.find((row) => row.coreBoxCode === coreBoxes[0].code)
  const previewB = preview.rows.find((row) => row.coreBoxCode === coreBoxes[1].code)
  if (previewA.plannedQuantity !== 206 || previewA.plannedPressCount !== 52) throw new Error('多芯盒需求量或压盒次数计算错误')
  if (previewB.plannedQuantity !== 110 || previewB.plannedPressCount !== 37) throw new Error('小数芯件比计算错误')
  if (previewA.cavityCount !== 4 || previewA.shelfLifeHours !== 8.5) throw new Error('芯盒快照预览不完整')

  const noEquipmentPreview = await request(baseUrl, `/admin/production/work-orders/${validationWorkOrders[0].id}/core-tasks/preview`, {
    method: 'POST', headers,
    body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, routingNodeId: noEquipmentCoreNode.id }] }),
  }, 400)
  if (!String(noEquipmentPreview.message).includes('未绑定启用设备')) throw new Error(`无可用设备节点预览错误不明确: ${noEquipmentPreview.message}`)

  const plannedStartAt = '2026-08-20T00:00:00.000Z'
  const created = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ rows: [
      { coreBoxCode: coreBoxes[0].code, expectedScrapRate: 0.03, routingNodeId: coreNode.id, equipmentCode: equipment.code, teamCode: team.code, plannedStartAt },
      { coreBoxCode: coreBoxes[1].code, expectedScrapRate: 0, routingNodeId: coreNode.id },
    ] }),
  })
  if (created.length !== 2) throw new Error('批量生成未返回两张制芯任务')
  const waitingTask = created.find((task) => task.coreBoxCode === coreBoxes[0].code)
  const pendingTask = created.find((task) => task.coreBoxCode === coreBoxes[1].code)
  if (waitingTask.status !== 'WAITING' || pendingTask.status !== 'PENDING_DISPATCH') throw new Error('任务初始状态不正确')
  if (!waitingTask.canCancel || !waitingTask.canDispatch || !waitingTask.canStart || waitingTask.canReport || pendingTask.canStart) {
    throw new Error('制芯任务能力字段不正确')
  }
  if (waitingTask.quantityPerProduct !== 2 || waitingTask.cavityCount !== 4 || waitingTask.shelfLifeHours !== 8.5) throw new Error('任务快照保存不完整')

  const invalidDispatchBody = await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}/dispatch`, {
    method: 'PUT', headers, body: 'null',
  }, 400)
  if (invalidDispatchBody.httpStatus !== 400) throw new Error('派工 null 请求体未返回 400')
  const invalidCancelBody = await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}/cancel`, {
    method: 'POST', headers, body: 'null',
  }, 400)
  if (invalidCancelBody.httpStatus !== 400) throw new Error('取消 null 请求体未返回 400')

  const workOrderBeforeLockedUpdate = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}`, { headers })
  const lockedStructureUpdate = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      productCode: workOrderBeforeLockedUpdate.productCode,
      bomVersionId: workOrderBeforeLockedUpdate.bomVersionId,
      routingVersionId: workOrderBeforeLockedUpdate.routingVersionId,
      plannedQuantity: workOrderBeforeLockedUpdate.plannedQuantity + 1,
      plannedStartDate: workOrderBeforeLockedUpdate.plannedStartDate,
      plannedDeliveryDate: workOrderBeforeLockedUpdate.plannedDeliveryDate,
      priority: workOrderBeforeLockedUpdate.priority,
      remark: workOrderBeforeLockedUpdate.remark,
      versionNo: workOrderBeforeLockedUpdate.versionNo,
    }),
  }, 400)
  if (!String(lockedStructureUpdate.message).includes('已生成制芯任务') || !String(lockedStructureUpdate.message).includes('计划数量')) {
    throw new Error(`工单结构锁定错误不明确: ${lockedStructureUpdate.message}`)
  }
  await prisma.castingBomVersion.update({ where: { id: mainBom.id }, data: { grossWeightKg: 99, returnWeightKg: 89, yieldRate: 10.101 } })
  await prisma.product.update({ where: { code: products[0].code }, data: { name: '不应覆盖工单的新版产品名' } })
  const nonStructuralUpdate = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      productCode: workOrderBeforeLockedUpdate.productCode,
      bomVersionId: workOrderBeforeLockedUpdate.bomVersionId,
      routingVersionId: workOrderBeforeLockedUpdate.routingVersionId,
      plannedQuantity: workOrderBeforeLockedUpdate.plannedQuantity,
      plannedStartDate: '2026-08-25',
      plannedDeliveryDate: '2026-09-05',
      priority: 'HIGH',
      remark: '仅更新非结构字段',
      versionNo: workOrderBeforeLockedUpdate.versionNo,
    }),
  })
  if (nonStructuralUpdate.productName !== workOrderBeforeLockedUpdate.productName || nonStructuralUpdate.unitGrossWeightKg !== workOrderBeforeLockedUpdate.unitGrossWeightKg || nonStructuralUpdate.totalMeltWeightKg !== workOrderBeforeLockedUpdate.totalMeltWeightKg) {
    throw new Error('非结构字段更新时覆盖了制芯任务依赖的工单快照或重量')
  }
  if (nonStructuralUpdate.priority !== 'HIGH' || nonStructuralUpdate.remark !== '仅更新非结构字段' || nonStructuralUpdate.plannedStartDate !== '2026-08-25') {
    throw new Error('工单非结构字段更新失败')
  }

  const closeWithActiveCoreTasks = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/close`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: nonStructuralUpdate.versionNo, reason: '不应关闭' }),
  }, 400)
  if (!String(closeWithActiveCoreTasks.message).includes('制芯任务') || !String(closeWithActiveCoreTasks.message).includes('完成或取消')) {
    throw new Error(`活动制芯任务关单错误不明确: ${closeWithActiveCoreTasks.message}`)
  }

  const afterCreatePreview = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks/preview`, { method: 'POST', headers, body: '{}' })
  if (afterCreatePreview.rows.length !== 0 || afterCreatePreview.canGenerateCoreTasks !== false) throw new Error('已生成芯盒未从预览中过滤')
  const duplicate = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}/core-tasks`, {
    method: 'POST', headers, body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, routingNodeId: coreNode.id }] }),
  }, 409)
  if (!String(duplicate.message).includes('重复')) throw new Error(`重复生成错误不明确: ${duplicate.message}`)

  const concurrentPayload = JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, routingNodeId: coreNode.id }] })
  const concurrentResults = await Promise.all([
    request(baseUrl, `/admin/production/work-orders/${concurrentWorkOrder.id}/core-tasks`, { method: 'POST', headers, body: concurrentPayload }, [201, 409]),
    request(baseUrl, `/admin/production/work-orders/${concurrentWorkOrder.id}/core-tasks`, { method: 'POST', headers, body: concurrentPayload }, [201, 409]),
  ])
  const concurrentStatuses = concurrentResults.map((item) => item.httpStatus).sort((a, b) => a - b)
  if (concurrentStatuses.join(',') !== '201,409') throw new Error(`并发生成结果不正确: ${concurrentStatuses.join(',')}`)
  if (!String(concurrentResults.find((item) => item.httpStatus === 409)?.message || '').match(/重复|并发/)) throw new Error('并发失败未返回中文业务冲突')
  const concurrentTaskCount = await prisma.coreProductionTask.count({ where: { workOrderId: concurrentWorkOrder.id, coreBoxCode: coreBoxes[0].code } })
  if (concurrentTaskCount !== 1) throw new Error(`并发生成产生了 ${concurrentTaskCount} 条重复制芯任务`)

  const raceUpdateDetail = await request(baseUrl, `/admin/production/work-orders/${raceUpdateWorkOrder.id}`, { headers })
  const raceUpdateQuantity = raceUpdateDetail.plannedQuantity + 7
  const [raceCreateResult, raceStructureResult] = await Promise.all([
    request(baseUrl, `/admin/production/work-orders/${raceUpdateWorkOrder.id}/core-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, routingNodeId: coreNode.id }] }),
    }, [201, 400, 409]),
    request(baseUrl, `/admin/production/work-orders/${raceUpdateWorkOrder.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        productCode: raceUpdateDetail.productCode,
        bomVersionId: raceUpdateDetail.bomVersionId,
        routingVersionId: raceUpdateDetail.routingVersionId,
        plannedQuantity: raceUpdateQuantity,
        plannedStartDate: raceUpdateDetail.plannedStartDate,
        plannedDeliveryDate: raceUpdateDetail.plannedDeliveryDate,
        priority: raceUpdateDetail.priority,
        remark: '并发结构修改',
        versionNo: raceUpdateDetail.versionNo,
      }),
    }, [200, 400, 409]),
  ])
  if (raceCreateResult.httpStatus >= 400 && raceStructureResult.httpStatus >= 400) throw new Error('生成与结构修改并发时两侧均失败')
  const raceUpdateDatabase = await prisma.workOrder.findUnique({ where: { id: raceUpdateWorkOrder.id } })
  const raceUpdateTask = await prisma.coreProductionTask.findFirst({
    where: { workOrderId: raceUpdateWorkOrder.id, coreBoxCode: coreBoxes[0].code },
    include: { routingNode: true },
  })
  if (raceUpdateTask && (
    raceUpdateDatabase?.productionStatus === 'CLOSED'
    || raceUpdateTask.productCodeSnapshot !== raceUpdateDatabase?.productCodeSnapshot
    || raceUpdateTask.bomVersionId !== raceUpdateDatabase?.bomVersionId
    || raceUpdateTask.routingNode.routingVersionId !== raceUpdateDatabase?.routingVersionId
    || raceUpdateTask.plannedQuantity !== raceUpdateDatabase.plannedQuantity * 2
  )) throw new Error('生成与结构修改并发后，工单结构与制芯任务快照不一致')

  const raceCloseDetail = await request(baseUrl, `/admin/production/work-orders/${raceCloseWorkOrder.id}`, { headers })
  const [raceCloseCreateResult, raceCloseResult] = await Promise.all([
    request(baseUrl, `/admin/production/work-orders/${raceCloseWorkOrder.id}/core-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, routingNodeId: coreNode.id }] }),
    }, [201, 400, 409]),
    request(baseUrl, `/admin/production/work-orders/${raceCloseWorkOrder.id}/close`, {
      method: 'POST', headers,
      body: JSON.stringify({ versionNo: raceCloseDetail.versionNo, reason: '并发关闭测试' }),
    }, [201, 400, 409]),
  ])
  if (raceCloseCreateResult.httpStatus >= 400 && raceCloseResult.httpStatus >= 400) throw new Error('生成与关闭并发时两侧均失败')
  const raceCloseDatabase = await prisma.workOrder.findUnique({ where: { id: raceCloseWorkOrder.id } })
  const raceCloseTaskCount = await prisma.coreProductionTask.count({ where: { workOrderId: raceCloseWorkOrder.id } })
  if (raceCloseTaskCount > 0 && raceCloseDatabase?.productionStatus === 'CLOSED') throw new Error('生成与关闭并发后出现已关闭工单仍存在制芯任务')

  const list = await request(baseUrl, `/admin/production/core-tasks?workOrderId=${mainWorkOrder.id}`, { headers })
  if (list.length !== 2) throw new Error('制芯任务列表未按工单筛选')
  const detail = await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}`, { headers })
  if (detail.workOrderCode !== mainWorkOrder.code || detail.coreBoxName !== coreBoxes[1].name) throw new Error('制芯任务详情快照不完整')

  await prisma.coreProductionReport.create({
    data: {
      taskId: waitingTask.id,
      equipmentCode: equipment.code,
      equipmentNameSnapshot: equipment.name,
      teamCode: team.code,
      teamNameSnapshot: team.name,
      operatorUserId: admin.id,
      operatorNameSnapshot: admin.name,
      qualifiedQuantity: 1,
      scrapQuantity: 0,
    },
  })
  const reportedDetail = await request(baseUrl, `/admin/production/core-tasks/${waitingTask.id}`, { headers })
  if (reportedDetail.reportCount !== 1 || reportedDetail.canDispatch || reportedDetail.canCancel) throw new Error('已有报工任务仍允许派工或取消')
  await request(baseUrl, `/admin/production/core-tasks/${waitingTask.id}/dispatch`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: waitingTask.versionNo, equipmentCode: equipment.code, teamCode: team.code, plannedStartAt }),
  }, 409)
  await request(baseUrl, `/admin/production/core-tasks/${waitingTask.id}/cancel`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: waitingTask.versionNo, reason: '不应成功' }),
  }, 409)

  const dispatched = await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}/dispatch`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: pendingTask.versionNo, equipmentCode: equipment.code, teamCode: team.code, plannedStartAt }),
  })
  if (dispatched.status !== 'WAITING' || dispatched.versionNo !== pendingTask.versionNo + 1) throw new Error('待派工任务派工失败')
  await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}/dispatch`, {
    method: 'PUT', headers, body: JSON.stringify({ versionNo: pendingTask.versionNo, equipmentCode: equipment.code, teamCode: team.code, plannedStartAt }),
  }, 409)
  await prisma.coreProductionTask.update({ where: { id: pendingTask.id }, data: { status: 'IN_PROGRESS' } })
  const inProgressDatabaseTask = await prisma.coreProductionTask.findUnique({
    where: { id: pendingTask.id },
    include: { _count: { select: { reports: true } } },
  })
  if (inProgressDatabaseTask?.status !== 'IN_PROGRESS' || inProgressDatabaseTask.versionNo !== dispatched.versionNo || inProgressDatabaseTask._count.reports !== 0) {
    throw new Error(`IN_PROGRESS 取消测试前置数据错误: ${JSON.stringify(inProgressDatabaseTask)}`)
  }
  const inProgressDetail = await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}`, { headers })
  if (!inProgressDetail.canCancel) throw new Error('生产中但尚未报工的任务应允许取消')
  const canceled = await request(baseUrl, `/admin/production/core-tasks/${pendingTask.id}/cancel`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: inProgressDetail.versionNo, reason: '测试取消' }),
  })
  if (canceled.status !== 'CANCELED' || canceled.cancelReason !== '测试取消' || canceled.canCancel) throw new Error('制芯任务取消失败')

  async function expectCreateFailure(workOrder, row, expectedText) {
    const result = await request(baseUrl, `/admin/production/work-orders/${workOrder.id}/core-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, expectedScrapRate: 0, ...row }] }),
    }, 400)
    if (!String(result.message).includes(expectedText)) throw new Error(`期望错误包含“${expectedText}”，实际: ${result.message}`)
  }
  await expectCreateFailure(validationWorkOrders[0], { routingNodeId: noEquipmentCoreNode.id }, '未绑定启用设备')
  await expectCreateFailure(validationWorkOrders[1], { routingNodeId: nonCoreNode.id }, '制芯')
  await expectCreateFailure(validationWorkOrders[2], { routingNodeId: coreNode.id, equipmentCode: unboundEquipment.code, teamCode: team.code, plannedStartAt }, '未绑定当前制芯工序节点')
  await expectCreateFailure(validationWorkOrders[3], { routingNodeId: coreNode.id, equipmentCode: disabledEquipment.code, teamCode: team.code, plannedStartAt }, '停用')
  await expectCreateFailure(validationWorkOrders[4], { routingNodeId: coreNode.id, equipmentCode: equipment.code, teamCode: foreignTeam.code, plannedStartAt }, '车间')

  const [closedParentTask] = await request(baseUrl, `/admin/production/work-orders/${closedDispatchWorkOrder.id}/core-tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ rows: [{ coreBoxCode: coreBoxes[0].code, routingNodeId: coreNode.id }] }),
  })
  await prisma.workOrder.update({ where: { id: closedDispatchWorkOrder.id }, data: { productionStatus: 'CLOSED' } })
  const closedParentDetail = await request(baseUrl, `/admin/production/work-orders/${closedDispatchWorkOrder.id}`, { headers })
  if (closedParentDetail.canGenerateCoreTasks) throw new Error('已关闭父工单仍错误开放生成制芯任务入口')
  const closedParentDispatch = await request(baseUrl, `/admin/production/core-tasks/${closedParentTask.id}/dispatch`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: closedParentTask.versionNo, equipmentCode: equipment.code, teamCode: team.code, plannedStartAt }),
  }, 400)
  if (!String(closedParentDispatch.message).includes('工单') || !String(closedParentDispatch.message).includes('关闭')) {
    throw new Error(`关闭父工单派工错误不明确: ${closedParentDispatch.message}`)
  }
  await prisma.workOrder.update({ where: { id: closedDispatchWorkOrder.id }, data: { productionStatus: 'COMPLETED' } })
  const completedParentDetail = await request(baseUrl, `/admin/production/work-orders/${closedDispatchWorkOrder.id}`, { headers })
  if (completedParentDetail.canGenerateCoreTasks) throw new Error('已完成父工单仍错误开放生成制芯任务入口')
  const completedParentDispatch = await request(baseUrl, `/admin/production/core-tasks/${closedParentTask.id}/dispatch`, {
    method: 'PUT', headers,
    body: JSON.stringify({ versionNo: closedParentTask.versionNo, equipmentCode: equipment.code, teamCode: team.code, plannedStartAt }),
  }, 400)
  if (!String(completedParentDispatch.message).includes('工单') || !String(completedParentDispatch.message).includes('完成')) {
    throw new Error(`完成父工单派工错误不明确: ${completedParentDispatch.message}`)
  }

  const finalWorkOrder = await request(baseUrl, `/admin/production/work-orders/${mainWorkOrder.id}`, { headers })
  if (!finalWorkOrder.requiresCoremaking || finalWorkOrder.canGenerateCoreTasks || finalWorkOrder.coreTaskCount !== 2) throw new Error('生产工单制芯能力摘要未更新')
  if (finalWorkOrder.coreTaskSummary.total !== 2 || finalWorkOrder.coreTaskSummary.waiting !== 1 || finalWorkOrder.coreTaskSummary.canceled !== 1) {
    throw new Error('生产工单制芯任务汇总不正确')
  }
  const ownershipCount = await prisma.businessDataOwnership.count({ where: { entityType: 'production:core_tasks', entityId: { in: created.map((task) => task.id) } } })
  if (ownershipCount !== 2) throw new Error('制芯任务未写入数据归属')

  console.log(JSON.stringify({ ok: true, workOrder: mainWorkOrder.code, tasks: created.map((task) => task.code), assertions: 56 }))
} catch (error) {
  testError = error
} finally {
  await stopApi().catch((error) => { if (!testError) testError = error })
  if (prisma) await prisma.$disconnect().catch(() => null)
  if (schemaCreated && managementPrisma) await managementPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => null)
  if (managementPrisma) await managementPrisma.$disconnect().catch(() => null)
}

if (testError) throw testError
