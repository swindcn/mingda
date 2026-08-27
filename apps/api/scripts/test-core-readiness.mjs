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
const schemaName = `test_core_readiness_${process.pid}_${stamp}_${randomBytes(4).toString('hex')}`
if (!/^test_core_readiness_[a-z0-9_]+$/.test(schemaName)) throw new Error(`临时 schema 名称不安全: ${schemaName}`)

function isolatedDatabaseUrl(baseUrl, schema) {
  const dbUrl = new URL(baseUrl)
  const databaseName = decodeURIComponent(dbUrl.pathname.replace(/^\/+/, ''))
  if (!['postgresql:', 'postgres:'].includes(dbUrl.protocol)) throw new Error('砂芯齐套测试仅支持 PostgreSQL')
  if (!allowRemoteIntegrationTest && (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || /(^|[_-])(prod|production)([_-]|$)/i.test(databaseName))) {
    throw new Error(`拒绝在非本地或疑似生产数据库运行砂芯齐套测试: ${dbUrl.hostname}/${databaseName}`)
  }
  dbUrl.searchParams.set('schema', schema)
  return dbUrl.toString()
}

const databaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, schemaName)
const managementDatabaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, 'public')
const prefix = `TEST-READINESS-${stamp}`
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
  if (result.error || result.status !== 0) throw new Error(`${label}失败: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`)
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolvePort(typeof address === 'object' && address ? address.port : 0))
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
  const stopped = await Promise.race([exited.then(() => true), new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 5_000))])
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
    if (!statuses.includes(response.status)) throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status}，期望 ${statuses.join('/')}: ${payload.message || ''}`)
    if (response.status >= 500) throw new Error(`${options.method || 'GET'} ${path}: 不应返回 HTTP ${response.status}`)
    return { ...payload, httpStatus: response.status }
  }
  if (!response.ok || payload.code !== 0) throw new Error(`${options.method || 'GET'} ${path}: ${payload.message || response.status}`)
  return payload.data
}

function workOrderData({ code, product, bomVersion, routingVersion, grade, admin, quantity = 10 }) {
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
    materialGradeCode: grade.code,
    materialGradeNameSnapshot: grade.name,
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

async function expectRejectedStatus(operation, expectedStatuses, label) {
  try {
    await operation()
  } catch (error) {
    const status = typeof error?.getStatus === 'function' ? error.getStatus() : error?.status
    if (expectedStatuses.includes(status)) return error
    throw new Error(`${label}返回了错误状态 ${status || 'unknown'}: ${error?.message || error}`)
  }
  throw new Error(`${label}未被拒绝`)
}

let testError
try {
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
  const restrictedUsername = `${prefix}-VIEWER`
  const restrictedRole = await prisma.role.create({
    data: { name: `${prefix}-VIEWER`, app: 'admin', dataScope: 'OWN', dataScopes: ['OWN'], permissions: ['production.work_order.view'] },
  })
  await prisma.user.create({
    data: { username: restrictedUsername, phone: `READINESS-${stamp}`, name: '受限工单查看员', passwordHash: hashPassword('123456'), roles: { create: { roleId: restrictedRole.id } } },
  })
  const grade = await prisma.materialGrade.create({ data: { code: `${prefix}-GRADE`, name: '测试灰铁', status: '启用' } })
  const workshop = await prisma.workshop.create({ data: { code: `${prefix}-WS`, name: '测试制芯车间', type: '制芯', status: '启用' } })
  const team = await prisma.team.create({ data: { code: `${prefix}-TEAM`, name: '制芯班', workshopCode: workshop.code, leaderUserId: admin.id, status: '启用' } })
  const equipment = await prisma.furnace.create({ data: { code: `${prefix}-EQ`, name: '射芯机', equipmentType: '射芯机', workshopCode: workshop.code, status: '启用' } })
  const operation = await prisma.operationMaster.create({ data: { code: `${prefix}-OP`, name: '射芯', section: '制芯', status: 'ENABLED' } })
  const product = await prisma.product.create({ data: { code: `${prefix}-ITEM`, name: '同名测试泵体', type: '半成品', unit: '件', materialGradeCode: grade.code } })
  const foreignProduct = await prisma.product.create({ data: { code: `${prefix}-ITEM-X`, name: product.name, type: '半成品', unit: '件', materialGradeCode: grade.code } })
  const emptyProduct = await prisma.product.create({ data: { code: `${prefix}-ITEM-EMPTY`, name: '无砂芯产品', type: '半成品', unit: '件', materialGradeCode: grade.code } })
  const mold = await prisma.moldMaster.create({ data: { code: `${prefix}-MOLD`, name: '测试模具', itemCode: product.code, hasCoreBox: true } })
  const foreignMold = await prisma.moldMaster.create({ data: { code: `${prefix}-MOLD-X`, name: '异品模具', itemCode: foreignProduct.code, hasCoreBox: true } })
  const [coreA, coreB, coreC] = await Promise.all([
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-A`, name: '水道芯', moldCode: mold.code, cavityCount: 2 } }),
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-B`, name: '油道芯', moldCode: mold.code, cavityCount: 2 } }),
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-C`, name: '非 BOM 芯', moldCode: mold.code, cavityCount: 1 } }),
  ])
  const foreignCore = await prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-X`, name: '异品砂芯', moldCode: foreignMold.code, cavityCount: 1 } })
  const bom = await prisma.castingBom.create({ data: { code: `${prefix}-BOM`, productCode: product.code } })
  const bomVersion = await prisma.castingBomVersion.create({
    data: {
      bomId: bom.id, version: 'V1.0', materialGradeCode: grade.code, productNameSnapshot: product.name,
      netWeightKg: 10, grossWeightKg: 15, yieldRate: 66.6667, returnWeightKg: 5, status: 'ACTIVE', createdByUserId: admin.id,
      coreBoxes: { create: [
        { coreBoxCode: coreA.code, coreBoxNameSnapshot: coreA.name, moldCodeSnapshot: mold.code, quantityPerProduct: 1, shelfLifeHours: 48 },
        { coreBoxCode: coreB.code, coreBoxNameSnapshot: coreB.name, moldCodeSnapshot: mold.code, quantityPerProduct: 2, shelfLifeHours: 48 },
      ] },
    },
    include: { bom: true },
  })
  const alternateBomVersion = await prisma.castingBomVersion.create({
    data: {
      bomId: bom.id, version: 'V2.0', materialGradeCode: grade.code, productNameSnapshot: product.name,
      netWeightKg: 10, grossWeightKg: 15, yieldRate: 66.6667, returnWeightKg: 5, status: 'ACTIVE', createdByUserId: admin.id,
      coreBoxes: { create: [{ coreBoxCode: coreA.code, coreBoxNameSnapshot: coreA.name, moldCodeSnapshot: mold.code, quantityPerProduct: 1, shelfLifeHours: 48 }] },
    },
    include: { bom: true },
  })
  const foreignBom = await prisma.castingBom.create({ data: { code: `${prefix}-BOM-X`, productCode: foreignProduct.code } })
  const foreignBomVersion = await prisma.castingBomVersion.create({
    data: {
      bomId: foreignBom.id, version: 'V1.0', materialGradeCode: grade.code, productNameSnapshot: foreignProduct.name,
      netWeightKg: 10, grossWeightKg: 15, yieldRate: 66.6667, returnWeightKg: 5, status: 'ACTIVE', createdByUserId: admin.id,
      coreBoxes: { create: [{ coreBoxCode: foreignCore.code, coreBoxNameSnapshot: foreignCore.name, moldCodeSnapshot: foreignMold.code, quantityPerProduct: 1, shelfLifeHours: 48 }] },
    },
    include: { bom: true },
  })
  const emptyBom = await prisma.castingBom.create({ data: { code: `${prefix}-BOM-EMPTY`, productCode: emptyProduct.code } })
  const emptyBomVersion = await prisma.castingBomVersion.create({
    data: {
      bomId: emptyBom.id, version: 'V1.0', materialGradeCode: grade.code, productNameSnapshot: emptyProduct.name,
      netWeightKg: 10, grossWeightKg: 15, yieldRate: 66.6667, returnWeightKg: 5, status: 'ACTIVE', createdByUserId: admin.id,
    },
    include: { bom: true },
  })
  const routing = await prisma.processRouting.create({ data: { code: `${prefix}-RT`, name: '测试制芯路线' } })
  const routingVersion = await prisma.processRoutingVersion.create({
    data: {
      routingId: routing.id, version: 'V1.0', status: 'ACTIVE', createdByUserId: admin.id,
      nodes: { create: [{ operationCode: operation.code, seqNo: 10, routeType: 'CORE_BRANCH', equipmentLinks: { create: [{ equipmentCode: equipment.code }] } }] },
    },
    include: { routing: true, nodes: true },
  })
  const targetWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-TARGET`, product, bomVersion, routingVersion, grade, admin, quantity: 10 }) })
  const emptyWorkOrder = await prisma.workOrder.create({ data: workOrderData({ code: `${prefix}-WO-EMPTY`, product: emptyProduct, bomVersion: emptyBomVersion, routingVersion, grade, admin, quantity: 10 }) })

  let sourceSerial = 0
  async function createBatch({
    code,
    sourceProduct = product,
    sourceBomVersion = bomVersion,
    coreBox = coreA,
    status = 'AVAILABLE',
    quantity = 1,
    expiresAt = new Date(Date.now() + 48 * 3_600_000),
    taskBomVersionId = sourceBomVersion.id,
  }) {
    const serial = ++sourceSerial
    const workOrder = await prisma.workOrder.create({
      data: workOrderData({ code: `${prefix}-WO-SOURCE-${serial}`, product: sourceProduct, bomVersion: sourceBomVersion, routingVersion, grade, admin, quantity: 10 }),
    })
    const task = await prisma.coreProductionTask.create({
      data: {
        code: `${prefix}-TASK-${serial}`, workOrderId: workOrder.id, bomVersionId: taskBomVersionId,
        routingNodeId: routingVersion.nodes[0].id, coreBoxCode: coreBox.code,
        productCodeSnapshot: sourceProduct.code, productNameSnapshot: sourceProduct.name, workOrderCodeSnapshot: workOrder.code,
        bomCodeSnapshot: sourceBomVersion.bom.code, bomVersionSnapshot: sourceBomVersion.version,
        routingCodeSnapshot: routing.code, routingVersionSnapshot: routingVersion.version,
        operationCodeSnapshot: operation.code, operationNameSnapshot: operation.name,
        coreBoxNameSnapshot: coreBox.name, moldCodeSnapshot: coreBox.moldCode, moldNameSnapshot: '测试模具',
        quantityPerProductSnapshot: 1, cavityCountSnapshot: coreBox.cavityCount, shelfLifeHoursSnapshot: 48,
        plannedQuantity: 10, plannedPressCount: 5, equipmentCode: equipment.code, equipmentNameSnapshot: equipment.name,
        teamCode: team.code, teamNameSnapshot: team.name, plannedStartAt: new Date(), status: 'COMPLETED',
        qualifiedQuantity: quantity, completedByUserId: admin.id, completedAt: new Date(), createdByUserId: admin.id,
      },
    })
    const report = await prisma.coreProductionReport.create({
      data: {
        taskId: task.id, equipmentCode: equipment.code, equipmentNameSnapshot: equipment.name,
        teamCode: team.code, teamNameSnapshot: team.name, operatorUserId: admin.id, operatorNameSnapshot: admin.name,
        qualifiedQuantity: quantity, dryingRequired: status === 'UNDRIED', reportedAt: new Date(),
      },
    })
    return prisma.coreInventoryBatch.create({
      data: {
        code, qrContent: code, reportId: report.id, coreBoxCodeSnapshot: coreBox.code,
        productCodeSnapshot: sourceProduct.code, productNameSnapshot: sourceProduct.name,
        coreBoxNameSnapshot: coreBox.name, workOrderCodeSnapshot: workOrder.code,
        initialQuantity: quantity, currentQuantity: quantity, dryingRequired: status === 'UNDRIED',
        driedAt: status === 'UNDRIED' ? null : new Date(), shelfLifeStartedAt: status === 'UNDRIED' ? null : new Date(),
        expiresAt, status,
      },
    })
  }

  const warningBatch = await createBatch({ code: `${prefix}-A-WARNING`, coreBox: coreA, status: 'WARNING', quantity: 4, expiresAt: new Date(Date.now() + 12 * 3_600_000) })
  await createBatch({ code: `${prefix}-A-AVAILABLE`, coreBox: coreA, status: 'AVAILABLE', quantity: 3 })
  await createBatch({ code: `${prefix}-A-UNDRIED`, coreBox: coreA, status: 'UNDRIED', quantity: 2, expiresAt: null })
  await createBatch({ code: `${prefix}-A-EXPIRED`, coreBox: coreA, status: 'EXPIRED', quantity: 8, expiresAt: new Date(Date.now() - 3_600_000) })
  await createBatch({ code: `${prefix}-A-LOCKED`, coreBox: coreA, status: 'LOCKED', quantity: 5, expiresAt: new Date(Date.now() - 3_600_000) })
  await createBatch({ code: `${prefix}-A-SCRAPPED`, coreBox: coreA, status: 'SCRAPPED', quantity: 7 })
  await createBatch({ code: `${prefix}-A-CONSUMED`, coreBox: coreA, status: 'CONSUMED', quantity: 9 })
  await createBatch({ code: `${prefix}-B-AVAILABLE`, coreBox: coreB, status: 'AVAILABLE', quantity: 25 })
  const legacyBomBatch = await createBatch({ code: `${prefix}-LEGACY-BOM`, sourceBomVersion: alternateBomVersion, coreBox: coreA, quantity: 2 })
  const wrongProductBatch = await createBatch({ code: `${prefix}-WRONG-PRODUCT`, sourceProduct: foreignProduct, sourceBomVersion: foreignBomVersion, coreBox: foreignCore, quantity: 2 })
  const wrongCoreBatch = await createBatch({ code: `${prefix}-WRONG-CORE`, sourceBomVersion: bomVersion, coreBox: coreC, quantity: 2 })
  await prisma.coreProductionTask.create({
    data: {
      code: `${prefix}-TARGET-TASK`, workOrderId: targetWorkOrder.id, bomVersionId: bomVersion.id,
      routingNodeId: routingVersion.nodes[0].id, coreBoxCode: coreA.code,
      productCodeSnapshot: product.code, productNameSnapshot: product.name, workOrderCodeSnapshot: targetWorkOrder.code,
      bomCodeSnapshot: bom.code, bomVersionSnapshot: bomVersion.version,
      routingCodeSnapshot: routing.code, routingVersionSnapshot: routingVersion.version,
      operationCodeSnapshot: operation.code, operationNameSnapshot: operation.name,
      coreBoxNameSnapshot: coreA.name, moldCodeSnapshot: mold.code, moldNameSnapshot: mold.name,
      quantityPerProductSnapshot: 1, cavityCountSnapshot: coreA.cavityCount, shelfLifeHoursSnapshot: 48,
      expectedScrapRate: 50, plannedQuantity: 99, plannedPressCount: 50, status: 'PENDING_DISPATCH', createdByUserId: admin.id,
    },
  })

  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}/api`
  apiProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), JWT_SECRET: 'core-readiness-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  apiProcess.stdout.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.stderr.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.on('error', (error) => { apiSpawnError = error })
  await waitForHealth(baseUrl)
  const login = await request(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '13665068911' }) })
  const headers = { authorization: `Bearer ${login.token}` }
  const restrictedLogin = await request(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: restrictedUsername, password: '123456' }) })
  const restrictedHeaders = { authorization: `Bearer ${restrictedLogin.token}` }

  const readiness = await request(baseUrl, `/admin/production/work-orders/${targetWorkOrder.id}/core-readiness`, { headers })
  if (!Array.isArray(readiness.rows) || readiness.rows.length !== 2) throw new Error('多芯盒齐套明细数量错误')
  const rowA = readiness.rows.find((row) => row.coreBoxCode === coreA.code)
  const rowB = readiness.rows.find((row) => row.coreBoxCode === coreB.code)
  if (!rowA || rowA.requiredQuantity !== 10 || rowA.availableQuantity !== 9 || rowA.undriedQuantity !== 2 || rowA.shortageQuantity !== 1 || rowA.readinessStatus !== 'PARTIAL') {
    throw new Error(`芯盒 A 齐套计算错误: ${JSON.stringify(rowA)}`)
  }
  if (rowA.minRemainingHours < 11.8 || rowA.minRemainingHours > 12) throw new Error(`临期批次最短剩余时间错误: ${rowA.minRemainingHours}`)
  if (!rowB || rowB.requiredQuantity !== 20 || rowB.availableQuantity !== 25 || rowB.undriedQuantity !== 0 || rowB.shortageQuantity !== 0 || rowB.readinessStatus !== 'READY') {
    throw new Error(`芯盒 B 齐套计算错误: ${JSON.stringify(rowB)}`)
  }
  if (readiness.totalRequiredQuantity !== 30 || readiness.totalAvailableQuantity !== 34 || readiness.totalShortageQuantity !== 1 || readiness.readinessRate !== 96.67) {
    throw new Error(`总齐套率或汇总错误: ${JSON.stringify(readiness)}`)
  }
  const moldingLine = await prisma.productionLine.create({
    data: { code: `${prefix}-MOLD-LINE`, name: '造型测试线', workshopCode: workshop.code, status: '启用' },
  })
  const consumedCoverBatch = await createBatch({ code: `${prefix}-A-CONSUMED-COVER`, coreBox: coreA, status: 'CONSUMED', quantity: 1 })
  await prisma.coreInventoryBatch.update({ where: { id: consumedCoverBatch.id }, data: { currentQuantity: 0, status: 'CONSUMED' } })
  const moldingTask = await prisma.moldingTask.create({
    data: {
      code: `${prefix}-MOLDING-TASK`, workOrderId: targetWorkOrder.id, bomVersionId: bomVersion.id,
      routingVersionId: routingVersion.id, routingNodeId: routingVersion.nodes[0].id,
      moldCode: mold.code, productionLineCode: moldingLine.code,
      productCodeSnapshot: product.code, productNameSnapshot: product.name, workOrderCodeSnapshot: targetWorkOrder.code,
      bomCodeSnapshot: bom.code, bomVersionSnapshot: bomVersion.version,
      routingCodeSnapshot: routing.code, routingNameSnapshot: routing.name, routingVersionSnapshot: routingVersion.version,
      operationCodeSnapshot: operation.code, operationNameSnapshot: operation.name,
      moldNameSnapshot: mold.name,
      productionLineNameSnapshot: moldingLine.name,
      workshopCodeSnapshot: workshop.code, workshopNameSnapshot: workshop.name,
      coreRequirementsSnapshot: [{ coreBoxCode: coreA.code, coreBoxName: coreA.name, quantityPerBox: 1 }],
      planPieceQty: 1, planBoxQty: 1, cavityCountSnapshot: 1,
      status: 'COMPLETED', completedGoodQty: 1, createdByUserId: admin.id,
    },
  })
  const moldingReport = await prisma.moldingReport.create({
    data: {
      taskId: moldingTask.id, reportCode: `${prefix}-MRP-001`, requestId: `${prefix}-MRP-REQ-001`,
      goodQty: 1, scrapQty: 0, finishTask: true, operatorUserId: admin.id, operatorNameSnapshot: admin.name,
    },
  })
  await prisma.moldingCoreConsumption.create({
    data: {
      reportId: moldingReport.id, coreInventoryBatchId: consumedCoverBatch.id, workOrderId: targetWorkOrder.id,
      coreBoxCodeSnapshot: coreA.code, quantity: 1, quantityBefore: 1, quantityAfter: 0,
    },
  })
  const consumedReadiness = await request(baseUrl, `/admin/production/work-orders/${targetWorkOrder.id}/core-readiness`, { headers })
  const consumedRowA = consumedReadiness.rows.find((row) => row.coreBoxCode === coreA.code)
  if (!consumedRowA || consumedRowA.consumedQuantity !== 1 || consumedRowA.remainingRequiredQuantity !== 9 || consumedRowA.shortageQuantity !== 0 || consumedRowA.readinessStatus !== 'READY') {
    throw new Error(`已消耗砂芯未抵扣齐套缺口: ${JSON.stringify(consumedRowA)}`)
  }
  if (consumedReadiness.totalConsumedQuantity !== 1 || consumedReadiness.totalShortageQuantity !== 0 || consumedReadiness.readinessRate !== 100) {
    throw new Error(`已消耗砂芯未计入总齐套率: ${JSON.stringify(consumedReadiness)}`)
  }
  await prisma.workOrder.update({ where: { id: targetWorkOrder.id }, data: { plannedQuantity: 1 } })
  await prisma.castingBomVersionCoreBox.update({
    where: { bomVersionId_coreBoxCode: { bomVersionId: bomVersion.id, coreBoxCode: coreA.code } },
    data: { quantityPerProduct: 1.5 },
  })
  const fractionalReadiness = await request(baseUrl, `/admin/production/work-orders/${targetWorkOrder.id}/core-readiness`, { headers })
  const fractionalRow = fractionalReadiness.rows.find((row) => row.coreBoxCode === coreA.code)
  if (fractionalRow?.requiredQuantity !== 2) throw new Error(`齐套需求量未向上取整: ${JSON.stringify(fractionalRow)}`)
  await prisma.workOrder.update({ where: { id: targetWorkOrder.id }, data: { plannedQuantity: 2_147_483_647 } })
  await request(baseUrl, `/admin/production/work-orders/${targetWorkOrder.id}/core-readiness`, { headers }, 400)
  await prisma.workOrder.update({ where: { id: targetWorkOrder.id }, data: { plannedQuantity: 10 } })
  await prisma.castingBomVersionCoreBox.update({
    where: { bomVersionId_coreBoxCode: { bomVersionId: bomVersion.id, coreBoxCode: coreA.code } },
    data: { quantityPerProduct: 1 },
  })
  const emptyReadiness = await request(baseUrl, `/admin/production/work-orders/${emptyWorkOrder.id}/core-readiness`, { headers })
  if (emptyReadiness.rows.length !== 0 || emptyReadiness.totalRequiredQuantity !== 0 || emptyReadiness.totalAvailableQuantity !== 0 || emptyReadiness.totalShortageQuantity !== 0 || emptyReadiness.readinessRate !== 100) {
    throw new Error(`无芯盒工单齐套结果错误: ${JSON.stringify(emptyReadiness)}`)
  }
  await request(baseUrl, `/admin/production/work-orders/${targetWorkOrder.id}/core-readiness`, { headers: restrictedHeaders }, 404)
  await request(baseUrl, '/admin/production/work-orders/not-found/core-readiness', { headers }, 404)

  const coremakingModule = await import('../dist/production/coremaking.service.js')
  const CoremakingService = coremakingModule.CoremakingService || coremakingModule.default?.CoremakingService
  const service = new CoremakingService(prisma)
  const legacyValidation = await service.validateCoreConsumption(targetWorkOrder.id, legacyBomBatch.code, 1)
  if (legacyValidation.availableQuantity !== 2 || legacyValidation.coreBoxCode !== coreA.code) throw new Error('同产品旧 BOM 版本砂芯未被允许领用')
  const legacyConsumed = await service.consumeCoreBatch(targetWorkOrder.id, legacyBomBatch.code, 1, { id: admin.id, name: admin.name })
  if (legacyConsumed.currentQuantity !== 1 || legacyConsumed.status !== 'AVAILABLE') throw new Error('同产品旧 BOM 版本砂芯领用失败')
  const validation = await service.validateCoreConsumption(targetWorkOrder.id, warningBatch.code, 2)
  if (validation.status !== 'WARNING' || validation.availableQuantity !== 4 || validation.recommendationPriority !== 'FIRST') throw new Error('WARNING 批次未被允许或优先推荐')
  const consumedPartial = await service.consumeCoreBatch(targetWorkOrder.id, warningBatch.code, 2, { id: admin.id, name: admin.name })
  if (consumedPartial.currentQuantity !== 2 || consumedPartial.status !== 'WARNING') throw new Error('部分领用未保持实时 WARNING 状态')
  const partialLedger = await prisma.coreInventoryLedger.findFirst({ where: { batchId: warningBatch.id, action: 'CONSUMED' }, orderBy: { createdAt: 'desc' } })
  if (!partialLedger || partialLedger.quantityChange !== -2 || partialLedger.quantityAfter !== 2 || partialLedger.operatorUserId !== admin.id || partialLedger.operatorNameSnapshot !== admin.name) {
    throw new Error('领用流水数量或操作人错误')
  }

  const fullBatch = await createBatch({ code: `${prefix}-FULL`, status: 'AVAILABLE', quantity: 2 })
  const consumedFull = await service.consumeCoreBatch(targetWorkOrder.id, fullBatch.code, 2, { id: admin.id, name: admin.name })
  if (consumedFull.currentQuantity !== 0 || consumedFull.status !== 'CONSUMED') throw new Error('耗尽领用未归零或标记 CONSUMED')
  const fullLedgers = await prisma.coreInventoryLedger.findMany({ where: { batchId: fullBatch.id, action: 'CONSUMED' } })
  if (fullLedgers.length !== 1 || fullLedgers[0].quantityAfter !== 0) throw new Error('耗尽领用流水不唯一或结余错误')

  await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, wrongProductBatch.code, 1), [400], '错误产品批次')
  await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, wrongCoreBatch.code, 1), [400], '错误芯盒批次')
  await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, fullBatch.code, 1), [400, 409], '已耗尽批次')
  await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, `${prefix}-MISSING`, 1), [404], '不存在批次')
  for (const quantity of [0, -1, 1.5, '1']) {
    await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, warningBatch.code, quantity), [400], `非法数量 ${quantity}`)
  }
  await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, warningBatch.code, 3), [400, 409], '库存不足')
  await expectRejectedStatus(() => service.consumeCoreBatch(targetWorkOrder.id, warningBatch.code, 1, {}), [400], '缺少操作人')

  const staleValidateBatch = await createBatch({ code: `${prefix}-STALE-VALIDATE`, status: 'AVAILABLE', quantity: 2, expiresAt: new Date(Date.now() - 3_600_000) })
  await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, staleValidateBatch.code, 1), [409], '校验实时过期批次')
  const staleValidateAfter = await prisma.coreInventoryBatch.findUnique({ where: { id: staleValidateBatch.id }, select: { status: true } })
  if (staleValidateAfter?.status !== 'EXPIRED') throw new Error('validate 拒绝过期批次后未持久化 EXPIRED')

  const staleConsumeBatch = await createBatch({ code: `${prefix}-STALE-CONSUME`, status: 'AVAILABLE', quantity: 2, expiresAt: new Date(Date.now() - 3_600_000) })
  await expectRejectedStatus(
    () => service.consumeCoreBatch(targetWorkOrder.id, staleConsumeBatch.code, 1, { id: admin.id, name: admin.name }),
    [409],
    '领用实时过期批次',
  )
  const [staleConsumeAfter, staleConsumeLedgers] = await Promise.all([
    prisma.coreInventoryBatch.findUnique({ where: { id: staleConsumeBatch.id }, select: { status: true, currentQuantity: true } }),
    prisma.coreInventoryLedger.count({ where: { batchId: staleConsumeBatch.id, action: 'CONSUMED' } }),
  ])
  if (staleConsumeAfter?.status !== 'EXPIRED' || staleConsumeAfter.currentQuantity !== 2 || staleConsumeLedgers !== 0) {
    throw new Error('consume 拒绝过期批次后未持久化 EXPIRED，或错误扣减库存/写入流水')
  }

  for (const status of ['EXPIRED', 'UNDRIED', 'LOCKED', 'SCRAPPED']) {
    const blocked = await createBatch({ code: `${prefix}-BLOCKED-${status}`, status, quantity: 2, expiresAt: status === 'EXPIRED' ? new Date(Date.now() - 3_600_000) : new Date(Date.now() + 48 * 3_600_000) })
    await expectRejectedStatus(() => service.validateCoreConsumption(targetWorkOrder.id, blocked.code, 1), [400, 409], `${status} 批次`)
  }

  const raceBatch = await createBatch({ code: `${prefix}-RACE`, status: 'AVAILABLE', quantity: 6 })
  const raceResults = await Promise.allSettled([
    service.consumeCoreBatch(targetWorkOrder.id, raceBatch.code, 4, { id: admin.id, name: admin.name }),
    service.consumeCoreBatch(targetWorkOrder.id, raceBatch.code, 4, { id: admin.id, name: admin.name }),
  ])
  if (raceResults.filter((result) => result.status === 'fulfilled').length !== 1 || raceResults.filter((result) => result.status === 'rejected').length !== 1) {
    throw new Error(`并发领用未实现单一成功: ${raceResults.map((result) => result.status).join('/')}`)
  }
  const raceAfter = await prisma.coreInventoryBatch.findUnique({ where: { id: raceBatch.id } })
  const raceLedgers = await prisma.coreInventoryLedger.findMany({ where: { batchId: raceBatch.id, action: 'CONSUMED' } })
  if (raceAfter?.currentQuantity !== 2 || raceLedgers.length !== 1 || raceLedgers[0].quantityChange !== -4 || raceLedgers[0].quantityAfter !== 2) {
    throw new Error('并发领用发生超卖、负库存或重复流水')
  }
  const rejectedRace = raceResults.find((result) => result.status === 'rejected')
  const rejectedRaceStatus = typeof rejectedRace?.reason?.getStatus === 'function' ? rejectedRace.reason.getStatus() : rejectedRace?.reason?.status
  if (![400, 409].includes(rejectedRaceStatus)) throw new Error(`并发领用失败状态错误: ${rejectedRaceStatus}`)

  const schedulerCases = {
    warning: await createBatch({ code: `${prefix}-SCHEDULE-WARNING`, status: 'AVAILABLE', quantity: 1, expiresAt: new Date(Date.now() + 3_600_000) }),
    expired: await createBatch({ code: `${prefix}-SCHEDULE-EXPIRED`, status: 'AVAILABLE', quantity: 1, expiresAt: new Date(Date.now() - 3_600_000) }),
    available: await createBatch({ code: `${prefix}-SCHEDULE-AVAILABLE`, status: 'WARNING', quantity: 1, expiresAt: new Date(Date.now() + 48 * 3_600_000) }),
    locked: await createBatch({ code: `${prefix}-SCHEDULE-LOCKED`, status: 'LOCKED', quantity: 1, expiresAt: new Date(Date.now() - 3_600_000) }),
    scrapped: await createBatch({ code: `${prefix}-SCHEDULE-SCRAPPED`, status: 'SCRAPPED', quantity: 1, expiresAt: new Date(Date.now() - 3_600_000) }),
    consumed: await createBatch({ code: `${prefix}-SCHEDULE-CONSUMED`, status: 'CONSUMED', quantity: 1, expiresAt: new Date(Date.now() + 3_600_000) }),
    undried: await createBatch({ code: `${prefix}-SCHEDULE-UNDRIED`, status: 'UNDRIED', quantity: 1, expiresAt: new Date(Date.now() - 3_600_000) }),
  }
  const protectedIds = [schedulerCases.locked.id, schedulerCases.scrapped.id, schedulerCases.consumed.id, schedulerCases.undried.id]
  const protectedBefore = await prisma.coreInventoryBatch.findMany({ where: { id: { in: protectedIds } }, select: { id: true, status: true, updatedAt: true } })
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
  const schedulerModule = await import('../dist/production/core-inventory.scheduler.js')
  const CoreInventoryScheduler = schedulerModule.CoreInventoryScheduler || schedulerModule.default?.CoreInventoryScheduler
  const scheduler = new CoreInventoryScheduler(service)
  await scheduler.refreshStatuses()
  const refreshed = await prisma.coreInventoryBatch.findMany({ where: { id: { in: Object.values(schedulerCases).map((batch) => batch.id) } }, select: { id: true, status: true, updatedAt: true } })
  const statusById = new Map(refreshed.map((batch) => [batch.id, batch.status]))
  if (statusById.get(schedulerCases.warning.id) !== 'WARNING' || statusById.get(schedulerCases.expired.id) !== 'EXPIRED' || statusById.get(schedulerCases.available.id) !== 'AVAILABLE') {
    throw new Error('定时刷新未正确更新临期、超期和恢复可用状态')
  }
  for (const before of protectedBefore) {
    const after = refreshed.find((batch) => batch.id === before.id)
    if (!after || after.status !== before.status || after.updatedAt.getTime() !== before.updatedAt.getTime()) throw new Error(`定时刷新破坏保护状态 ${before.status}`)
  }

  const updateManyCalls = []
  const fakeService = new CoremakingService({
    coreInventoryBatch: {
      findMany: async () => { throw new Error('定时状态刷新不得全量读取候选批次') },
      updateMany: (args) => {
        updateManyCalls.push(args)
        return Promise.resolve({ count: 0 })
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  })
  await fakeService.refreshInventoryStatuses()
  if (updateManyCalls.length !== 3 || new Set(updateManyCalls.map((call) => call.data.status)).size !== 3) throw new Error('定时状态刷新不是固定三次集合更新')
  if (updateManyCalls.some((call) => !JSON.stringify(call.where).includes('status'))) throw new Error('定时状态刷新条件未限制实时状态集合')
  if (updateManyCalls.some((call) => /LOCKED|SCRAPPED|CONSUMED|UNDRIED/.test(JSON.stringify(call.where)))) throw new Error('定时状态刷新包含保护状态')

  console.log(JSON.stringify({ ok: true, assertions: 39, readinessRate: readiness.readinessRate, raceLedgers: raceLedgers.length }))
} catch (error) {
  testError = error
} finally {
  await stopApi().catch((error) => { if (!testError) testError = error })
  if (prisma) await prisma.$disconnect().catch(() => null)
  if (schemaCreated && managementPrisma) await managementPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => null)
  if (managementPrisma) await managementPrisma.$disconnect().catch(() => null)
}

if (testError) throw testError
