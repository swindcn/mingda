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
const schemaName = `test_coremaking_execution_${process.pid}_${stamp}_${randomBytes(4).toString('hex')}`
if (!/^test_coremaking_execution_[a-z0-9_]+$/.test(schemaName)) throw new Error(`临时 schema 名称不安全: ${schemaName}`)

function isolatedDatabaseUrl(baseUrl, schema) {
  const dbUrl = new URL(baseUrl)
  const databaseName = decodeURIComponent(dbUrl.pathname.replace(/^\/+/, ''))
  if (!['postgresql:', 'postgres:'].includes(dbUrl.protocol)) throw new Error('制芯执行测试仅支持 PostgreSQL')
  if (!allowRemoteIntegrationTest && (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || /(^|[_-])(prod|production)([_-]|$)/i.test(databaseName))) {
    throw new Error(`拒绝在非本地或疑似生产数据库运行制芯执行测试: ${dbUrl.hostname}/${databaseName}`)
  }
  dbUrl.searchParams.set('schema', schema)
  return dbUrl.toString()
}

const databaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, schemaName)
const managementDatabaseUrl = isolatedDatabaseUrl(baseDatabaseUrl, 'public')
const prefix = `TEST-CORE-EXEC-${stamp}`
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

function hoursBetween(later, earlier) {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 3_600_000
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
  const restrictedUsername = `${prefix}-RESTRICTED`
  const restrictedRole = await prisma.role.create({
    data: {
      name: `${prefix}-INVENTORY-VIEWER`,
      app: 'admin',
      dataScope: 'OWN',
      dataScopes: ['OWN'],
      permissions: ['production.core_inventory.view'],
    },
  })
  await prisma.user.create({
    data: {
      username: restrictedUsername,
      phone: `CORE-${stamp}`,
      name: '受限库存查看员',
      passwordHash: hashPassword('123456'),
      roles: { create: { roleId: restrictedRole.id } },
    },
  })
  const grade = await prisma.materialGrade.create({ data: { code: `${prefix}-GRADE`, name: '测试灰铁', status: '启用' } })
  const workshop = await prisma.workshop.create({ data: { code: `${prefix}-WS`, name: '测试制芯车间', type: '制芯', status: '启用' } })
  const team = await prisma.team.create({ data: { code: `${prefix}-TEAM`, name: '制芯一班', workshopCode: workshop.code, leaderUserId: admin.id, status: '启用' } })
  const equipment = await prisma.furnace.create({ data: { code: `${prefix}-SHOOT`, name: '一号射芯机', equipmentType: '射芯机', workshopCode: workshop.code, status: '启用' } })
  const dryer = await prisma.furnace.create({ data: { code: `${prefix}-DRY`, name: '一号烘干炉', equipmentType: '烘干设备', workshopCode: workshop.code, status: '启用' } })
  const disabledDryer = await prisma.furnace.create({ data: { code: `${prefix}-DRY-OFF`, name: '停用烘干炉', equipmentType: '烘干设备', workshopCode: workshop.code, status: '停用' } })
  const unrelatedEquipment = await prisma.furnace.create({ data: { code: `${prefix}-MELT`, name: '熔炼炉', equipmentType: '熔炼炉', workshopCode: workshop.code, status: '启用' } })
  const shift = await prisma.shiftMaster.create({ data: { code: `${prefix}-DAY`, name: '白班', startTime: '08:00', endTime: '20:00', status: '启用' } })
  const operation = await prisma.operationMaster.create({ data: { code: `${prefix}-OP`, name: '射芯制芯', section: '制芯', status: 'ENABLED' } })
  const product = await prisma.product.create({ data: { code: `${prefix}-ITEM`, name: '测试泵体', type: '半成品', unit: '件', materialGradeCode: grade.code } })
  const mold = await prisma.moldMaster.create({ data: { code: `${prefix}-MOLD`, name: '测试泵体模具', itemCode: product.code, hasCoreBox: true } })
  const [dryCoreBox, directCoreBox] = await Promise.all([
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-A`, name: '水道芯盒', moldCode: mold.code, cavityCount: 4 } }),
    prisma.coreBoxMaster.create({ data: { code: `${prefix}-CORE-B`, name: '油道芯盒', moldCode: mold.code, cavityCount: 2 } }),
  ])
  const bom = await prisma.castingBom.create({ data: { code: `${prefix}-BOM`, productCode: product.code } })
  const bomVersion = await prisma.castingBomVersion.create({
    data: {
      bomId: bom.id, version: 'V1.0', materialGradeCode: grade.code, productNameSnapshot: product.name,
      netWeightKg: 10, grossWeightKg: 15, yieldRate: 66.6667, returnWeightKg: 5, status: 'ACTIVE', createdByUserId: admin.id,
      coreBoxes: { create: [
        { coreBoxCode: dryCoreBox.code, coreBoxNameSnapshot: dryCoreBox.name, moldCodeSnapshot: mold.code, quantityPerProduct: 1, shelfLifeHours: 2 },
        { coreBoxCode: directCoreBox.code, coreBoxNameSnapshot: directCoreBox.name, moldCodeSnapshot: mold.code, quantityPerProduct: 1, shelfLifeHours: 30 },
      ] },
    },
  })
  const routing = await prisma.processRouting.create({ data: { code: `${prefix}-RT`, name: '测试制芯路线' } })
  const routingVersion = await prisma.processRoutingVersion.create({ data: { routingId: routing.id, version: 'V1.0', status: 'ACTIVE', createdByUserId: admin.id } })
  const node = await prisma.processRoutingNode.create({
    data: { routingVersionId: routingVersion.id, operationCode: operation.code, seqNo: 10, routeType: 'CORE_BRANCH', equipmentLinks: { create: { equipmentCode: equipment.code } } },
  })

  let workOrderSerial = 0
  let taskSerial = 0
  async function createTask({ coreBox = dryCoreBox, shelfLifeHours = 2, plannedQuantity = 10, status = 'WAITING', productionStatus = 'RELEASED' } = {}) {
    const workOrderNumber = ++workOrderSerial
    const taskNumber = ++taskSerial
    const workOrder = await prisma.workOrder.create({
      data: {
        code: `${prefix}-WO-${workOrderNumber}`, productCode: product.code, productCodeSnapshot: product.code, productNameSnapshot: product.name,
        bomVersionId: bomVersion.id, bomCodeSnapshot: bom.code, bomVersionSnapshot: bomVersion.version,
        routingVersionId: routingVersion.id, routingCodeSnapshot: routing.code, routingNameSnapshot: routing.name, routingVersionSnapshot: routingVersion.version,
        materialGradeCode: grade.code, materialGradeNameSnapshot: grade.name, plannedQuantity, plannedDeliveryDate: new Date('2026-09-01T00:00:00Z'),
        unitNetWeightKg: 10, unitGrossWeightKg: 15, yieldRate: 66.6667, unitReturnWeightKg: 5,
        totalNetWeightKg: plannedQuantity * 10, totalMeltWeightKg: plannedQuantity * 15, expectedReturnWeightKg: plannedQuantity * 5,
        productionStatus, createdByUserId: admin.id,
      },
    })
    const task = await prisma.coreProductionTask.create({
      data: {
        code: `${prefix}-TASK-${taskNumber}`, workOrderId: workOrder.id, bomVersionId: bomVersion.id, routingNodeId: node.id, coreBoxCode: coreBox.code,
        productCodeSnapshot: product.code, productNameSnapshot: product.name, workOrderCodeSnapshot: workOrder.code,
        bomCodeSnapshot: bom.code, bomVersionSnapshot: bomVersion.version, routingCodeSnapshot: routing.code, routingVersionSnapshot: routingVersion.version,
        operationCodeSnapshot: operation.code, operationNameSnapshot: operation.name, coreBoxNameSnapshot: coreBox.name,
        moldCodeSnapshot: mold.code, moldNameSnapshot: mold.name, quantityPerProductSnapshot: 1,
        cavityCountSnapshot: coreBox.cavityCount, shelfLifeHoursSnapshot: shelfLifeHours, expectedScrapRate: 0,
        plannedQuantity, plannedPressCount: Math.ceil(plannedQuantity / coreBox.cavityCount), equipmentCode: equipment.code,
        equipmentNameSnapshot: equipment.name, teamCode: team.code, teamNameSnapshot: team.name,
        plannedStartAt: new Date(), status, createdByUserId: admin.id,
      },
    })
    await prisma.businessDataOwnership.create({ data: { entityType: 'production:core_tasks', entityId: task.id, createdByUserId: admin.id, ownerUserId: admin.id } })
    return { task, workOrder }
  }

  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}/api`
  apiProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), JWT_SECRET: 'coremaking-execution-test-secret' },
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

  const { task: resourceTask } = await createTask()
  await prisma.furnace.update({ where: { code: equipment.code }, data: { status: '停用' } })
  await request(baseUrl, `/admin/production/core-tasks/${resourceTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: resourceTask.versionNo }) }, 400)
  await prisma.furnace.update({ where: { code: equipment.code }, data: { status: '启用' } })
  await prisma.team.update({ where: { code: team.code }, data: { status: '停用' } })
  await request(baseUrl, `/admin/production/core-tasks/${resourceTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: resourceTask.versionNo }) }, 400)
  await prisma.team.update({ where: { code: team.code }, data: { status: '启用' } })
  await prisma.workshop.update({ where: { code: workshop.code }, data: { status: '停用' } })
  await request(baseUrl, `/admin/production/core-tasks/${resourceTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: resourceTask.versionNo }) }, 400)
  await prisma.workshop.update({ where: { code: workshop.code }, data: { status: '启用' } })
  await prisma.routingNodeEquipment.delete({ where: { routingNodeId_equipmentCode: { routingNodeId: node.id, equipmentCode: equipment.code } } })
  await request(baseUrl, `/admin/production/core-tasks/${resourceTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: resourceTask.versionNo }) }, 400)
  await prisma.routingNodeEquipment.create({ data: { routingNodeId: node.id, equipmentCode: equipment.code } })
  const resourceStarted = await request(baseUrl, `/admin/production/core-tasks/${resourceTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: resourceTask.versionNo }) })
  if (resourceStarted.status !== 'IN_PROGRESS') throw new Error('资源恢复后制芯任务仍无法开始')

  const { task: mainTask } = await createTask()
  const started = await request(baseUrl, `/admin/production/core-tasks/${mainTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: mainTask.versionNo }) })
  if (started.status !== 'IN_PROGRESS' || started.versionNo !== 2 || !started.startedAt) throw new Error('开始任务未正确更新状态、版本和时间')
  await request(baseUrl, `/admin/production/core-tasks/${mainTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: mainTask.versionNo }) }, 409)

  const firstReport = await request(baseUrl, `/admin/production/core-tasks/${mainTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: started.versionNo, qualifiedQuantity: 6, scrapQuantity: 1, shiftCode: shift.code, dryingRequired: true, sandBatchCode: 'SAND-001' }),
  })
  if (firstReport.task.qualifiedQuantity !== 6 || firstReport.task.scrapQuantity !== 1 || firstReport.task.status !== 'IN_PROGRESS') throw new Error('首次报工累计错误')
  if (firstReport.batch.status !== 'UNDRIED' || firstReport.batch.currentQuantity !== 6) throw new Error('需烘干批次初始状态或数量错误')
  if (!new RegExp(`^CORE-${dryCoreBox.code}-\\d{8}-${shift.code}-\\d{3}$`).test(firstReport.batch.code)) throw new Error(`批次编码格式错误: ${firstReport.batch.code}`)
  const batchSequence = await prisma.documentSequence.findFirst({ where: { documentType: `CORE_BATCH:${dryCoreBox.code}:${shift.code}` } })
  if (!batchSequence) throw new Error('砂芯批次流水未创建')
  await prisma.documentSequence.update({
    where: { documentType_businessDate: { documentType: batchSequence.documentType, businessDate: batchSequence.businessDate } },
    data: { currentValue: 0 },
  })

  const secondReport = await request(baseUrl, `/admin/production/core-tasks/${mainTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: firstReport.task.versionNo, qualifiedQuantity: 4, scrapQuantity: 2, shiftCode: shift.code, dryingRequired: true }),
  })
  if (secondReport.task.qualifiedQuantity !== 10 || secondReport.task.scrapQuantity !== 3 || secondReport.task.status !== 'COMPLETED') throw new Error('多次报工累计或完工状态错误')
  if (firstReport.batch.code === secondReport.batch.code) throw new Error('多次报工生成了重复批次编码')
  const mainCounts = await Promise.all([
    prisma.coreProductionReport.count({ where: { taskId: mainTask.id } }),
    prisma.coreInventoryBatch.count({ where: { report: { taskId: mainTask.id } } }),
    prisma.coreInventoryLedger.count({ where: { batch: { report: { taskId: mainTask.id } }, action: 'PRODUCED' } }),
  ])
  if (mainCounts.some((count) => count !== 2)) throw new Error(`报工事务记录数量错误: ${mainCounts.join('/')}`)

  const dried = await request(baseUrl, `/admin/production/core-batches/${firstReport.batch.id}/dry`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: firstReport.batch.versionNo, equipmentCode: dryer.code }),
  })
  if (dried.status !== 'WARNING' || dried.dryingEquipmentCode !== dryer.code || !dried.driedAt || Math.abs(hoursBetween(dried.expiresAt, dried.driedAt) - 2) > 0.0001) {
    throw new Error('烘干确认未正确记录设备、状态或保质期')
  }
  await request(baseUrl, `/admin/production/core-batches/${secondReport.batch.id}/dry`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: secondReport.batch.versionNo, equipmentCode: disabledDryer.code }),
  }, 400)
  await request(baseUrl, `/admin/production/core-batches/${secondReport.batch.id}/dry`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: secondReport.batch.versionNo, equipmentCode: unrelatedEquipment.code }),
  }, 400)

  const { task: directTask } = await createTask({ coreBox: directCoreBox, shelfLifeHours: 8.5, plannedQuantity: 3 })
  const directStarted = await request(baseUrl, `/admin/production/core-tasks/${directTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: directTask.versionNo }) })
  const directReport = await request(baseUrl, `/admin/production/core-tasks/${directTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: directStarted.versionNo, qualifiedQuantity: 3, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
  })
  if (directReport.batch.status !== 'WARNING' || directReport.batch.shelfLifeStartedAt !== directReport.report.reportedAt || Math.abs(hoursBetween(directReport.batch.expiresAt, directReport.report.reportedAt) - 8.5) > 0.0001) {
    throw new Error('免烘干批次状态或保质期起点错误')
  }
  const warningBefore = await prisma.coreInventoryBatch.findUnique({ where: { id: directReport.batch.id }, select: { updatedAt: true } })
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
  const warningInventory = await request(baseUrl, `/admin/production/core-inventory?page=1&pageSize=2&status=WARNING&keyword=${encodeURIComponent(directCoreBox.code)}`, { headers })
  if (!Array.isArray(warningInventory.items) || warningInventory.items.length !== 1 || warningInventory.items[0].id !== directReport.batch.id) {
    throw new Error('库存分页状态或关键词筛选错误')
  }
  if (warningInventory.page !== 1 || warningInventory.pageSize !== 2 || warningInventory.total !== 1 || warningInventory.totalPages !== 1) {
    throw new Error('库存分页元数据错误')
  }
  if ('ledgers' in warningInventory.items[0]) throw new Error('库存列表不应加载完整流水')
  const warningDetail = await request(baseUrl, `/admin/production/core-inventory/${directReport.batch.id}`, { headers })
  if (warningDetail.id !== directReport.batch.id || !Array.isArray(warningDetail.ledgers) || !warningDetail.ledgers.some((item) => item.action === 'PRODUCED')) {
    throw new Error('库存详情未返回完整流水')
  }
  await request(baseUrl, `/admin/production/core-inventory/${directReport.batch.id}`, { headers: restrictedHeaders }, 404)
  const warningAfter = await prisma.coreInventoryBatch.findUnique({ where: { id: directReport.batch.id }, select: { updatedAt: true } })
  if (warningBefore?.updatedAt.getTime() !== warningAfter?.updatedAt.getTime()) throw new Error('库存列表对未变化状态执行了无效更新')
  const cappedInventory = await request(baseUrl, '/admin/production/core-inventory?page=1&pageSize=1000', { headers })
  if (cappedInventory.pageSize !== 100 || !Array.isArray(cappedInventory.items)) throw new Error('库存分页上限未生效')

  const { task: overTask } = await createTask({ plannedQuantity: 5 })
  const overStarted = await request(baseUrl, `/admin/production/core-tasks/${overTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: overTask.versionNo }) })
  const overReport = await request(baseUrl, `/admin/production/core-tasks/${overTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: overStarted.versionNo, qualifiedQuantity: 7, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
  })
  if (overReport.task.qualifiedQuantity !== 7 || overReport.task.status !== 'COMPLETED') throw new Error('超产报工未被允许或未完成任务')

  const { task: raceTask } = await createTask({ plannedQuantity: 20 })
  const raceStarted = await request(baseUrl, `/admin/production/core-tasks/${raceTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: raceTask.versionNo }) })
  const raceBody = JSON.stringify({ versionNo: raceStarted.versionNo, qualifiedQuantity: 5, scrapQuantity: 1, shiftCode: shift.code, dryingRequired: false })
  const raceResults = await Promise.all([
    request(baseUrl, `/admin/production/core-tasks/${raceTask.id}/report`, { method: 'POST', headers, body: raceBody }, [201, 409]),
    request(baseUrl, `/admin/production/core-tasks/${raceTask.id}/report`, { method: 'POST', headers, body: raceBody }, [201, 409]),
  ])
  if (raceResults.filter((result) => result.httpStatus === 201).length !== 1 || raceResults.filter((result) => result.httpStatus === 409).length !== 1) throw new Error('并发双报工未实现单一成功')
  const raceCounts = await Promise.all([
    prisma.coreProductionReport.count({ where: { taskId: raceTask.id } }),
    prisma.coreInventoryBatch.count({ where: { report: { taskId: raceTask.id } } }),
    prisma.coreInventoryLedger.count({ where: { batch: { report: { taskId: raceTask.id } } } }),
  ])
  if (raceCounts.some((count) => count !== 1)) throw new Error(`并发报工产生重复记录: ${raceCounts.join('/')}`)

  const collisionTasks = await Promise.all([createTask({ plannedQuantity: 2 }), createTask({ plannedQuantity: 2 })])
  for (const { task } of collisionTasks) {
    const collisionStarted = await request(baseUrl, `/admin/production/core-tasks/${task.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: task.versionNo }) })
    await request(baseUrl, `/admin/production/core-tasks/${task.id}/report`, {
      method: 'POST', headers,
      body: JSON.stringify({ versionNo: collisionStarted.versionNo, qualifiedQuantity: 1, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
    })
  }
  await prisma.documentSequence.update({
    where: { documentType_businessDate: { documentType: batchSequence.documentType, businessDate: batchSequence.businessDate } },
    data: { currentValue: 0 },
  })
  const { task: skippedTask } = await createTask({ plannedQuantity: 2 })
  const skippedStarted = await request(baseUrl, `/admin/production/core-tasks/${skippedTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: skippedTask.versionNo }) })
  const skippedReport = await request(baseUrl, `/admin/production/core-tasks/${skippedTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: skippedStarted.versionNo, qualifiedQuantity: 1, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
  })
  if (!skippedReport.batch.code.endsWith('-007')) throw new Error(`未跳过连续六个历史批次编码: ${skippedReport.batch.code}`)

  const crossTaskRecords = await Promise.all([createTask({ plannedQuantity: 2 }), createTask({ plannedQuantity: 2 })])
  const crossTaskStarted = await Promise.all(crossTaskRecords.map(({ task }) => request(
    baseUrl,
    `/admin/production/core-tasks/${task.id}/start`,
    { method: 'POST', headers, body: JSON.stringify({ versionNo: task.versionNo }) },
  )))
  const crossTaskReports = await Promise.all(crossTaskRecords.map(({ task }, index) => request(
    baseUrl,
    `/admin/production/core-tasks/${task.id}/report`,
    {
      method: 'POST', headers,
      body: JSON.stringify({ versionNo: crossTaskStarted[index].versionNo, qualifiedQuantity: 1, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
    },
  )))
  if (new Set(crossTaskReports.map((item) => item.batch.code)).size !== 2) throw new Error('跨任务并发报工生成重复批次编码')
  const crossBatchIds = crossTaskReports.map((item) => item.batch.id)
  const crossLedgers = await prisma.coreInventoryLedger.count({ where: { batchId: { in: crossBatchIds }, action: 'PRODUCED' } })
  if (crossLedgers !== 2) throw new Error('跨任务并发报工未分别生成库存流水')

  const { task: exhaustedTask } = await createTask({ plannedQuantity: 2 })
  const exhaustedStarted = await request(baseUrl, `/admin/production/core-tasks/${exhaustedTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: exhaustedTask.versionNo }) })
  await prisma.documentSequence.update({
    where: { documentType_businessDate: { documentType: batchSequence.documentType, businessDate: batchSequence.businessDate } },
    data: { currentValue: 999 },
  })
  await request(baseUrl, `/admin/production/core-tasks/${exhaustedTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: exhaustedStarted.versionNo, qualifiedQuantity: 1, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
  }, 409)
  const exhaustedCounts = await Promise.all([
    prisma.coreProductionReport.count({ where: { taskId: exhaustedTask.id } }),
    prisma.coreInventoryBatch.count({ where: { report: { taskId: exhaustedTask.id } } }),
    prisma.coreInventoryLedger.count({ where: { batch: { report: { taskId: exhaustedTask.id } } } }),
  ])
  const exhaustedAfter = await prisma.coreProductionTask.findUnique({ where: { id: exhaustedTask.id } })
  if (exhaustedCounts.some((count) => count !== 0) || exhaustedAfter?.versionNo !== exhaustedStarted.versionNo || exhaustedAfter.qualifiedQuantity !== 0) {
    throw new Error('三位批次流水耗尽时未完整回滚报工事务')
  }

  const locked = await request(baseUrl, `/admin/production/core-batches/${directReport.batch.id}/lock`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: directReport.batch.versionNo, reason: '质量复检' }),
  })
  if (locked.status !== 'LOCKED' || locked.currentQuantity !== 3) throw new Error('锁定批次状态或数量错误')
  await request(baseUrl, `/admin/production/core-batches/${directReport.batch.id}/lock`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: directReport.batch.versionNo, reason: '旧版本锁定' }),
  }, 409)
  const unlocked = await request(baseUrl, `/admin/production/core-batches/${directReport.batch.id}/unlock`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: locked.versionNo }),
  })
  if (unlocked.status !== 'WARNING' || unlocked.currentQuantity !== 3) throw new Error('解锁批次未恢复实时库存状态')
  const scrapped = await request(baseUrl, `/admin/production/core-batches/${directReport.batch.id}/scrap`, {
    method: 'POST', headers, body: JSON.stringify({ versionNo: unlocked.versionNo, reason: '尺寸超差' }),
  })
  if (scrapped.status !== 'SCRAPPED' || scrapped.currentQuantity !== 0) throw new Error('整批报废未清零库存')
  const inventoryLedgers = await prisma.coreInventoryLedger.findMany({ where: { batchId: directReport.batch.id }, orderBy: { createdAt: 'asc' } })
  const actions = inventoryLedgers.map((item) => item.action)
  if (!['PRODUCED', 'LOCKED', 'UNLOCKED', 'SCRAPPED'].every((action) => actions.includes(action))) throw new Error(`库存流水动作不完整: ${actions.join(',')}`)
  const scrapLedger = inventoryLedgers.find((item) => item.action === 'SCRAPPED')
  if (!scrapLedger || scrapLedger.quantityChange !== -3 || scrapLedger.quantityAfter !== 0) throw new Error('报废流水数量语义错误')

  await prisma.coreInventoryBatch.update({ where: { id: dried.id }, data: { status: 'AVAILABLE', expiresAt: new Date(Date.now() - 60_000) } })
  const inventory = await request(baseUrl, '/admin/production/core-inventory?page=1&pageSize=100&status=EXPIRED', { headers })
  const expired = inventory.items.find((item) => item.id === dried.id)
  if (!expired || expired.status !== 'EXPIRED' || expired.currentQuantity !== dried.currentQuantity) throw new Error('库存查询未实时刷新失效状态或错误清空数量')
  const persistedExpired = await prisma.coreInventoryBatch.findUnique({ where: { id: dried.id } })
  if (persistedExpired?.status !== 'EXPIRED') throw new Error('实时库存状态未持久化')

  const { task: closedTask } = await createTask({ productionStatus: 'CLOSED' })
  await request(baseUrl, `/admin/production/core-tasks/${closedTask.id}/start`, { method: 'POST', headers, body: JSON.stringify({ versionNo: closedTask.versionNo }) }, 400)
  const { task: closedReportTask, workOrder: closedReportOrder } = await createTask({ status: 'IN_PROGRESS' })
  await prisma.workOrder.update({ where: { id: closedReportOrder.id }, data: { productionStatus: 'COMPLETED' } })
  await request(baseUrl, `/admin/production/core-tasks/${closedReportTask.id}/report`, {
    method: 'POST', headers,
    body: JSON.stringify({ versionNo: closedReportTask.versionNo, qualifiedQuantity: 1, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }),
  }, 400)

  const malformedCases = [null, [], 'bad body', { versionNo: '1' }, { versionNo: 1, qualifiedQuantity: -1, scrapQuantity: 0, shiftCode: shift.code, dryingRequired: false }]
  for (const body of malformedCases) {
    await request(baseUrl, `/admin/production/core-tasks/${raceTask.id}/report`, { method: 'POST', headers, body: JSON.stringify(body) }, 400)
  }
  await request(baseUrl, `/admin/production/core-batches/${secondReport.batch.id}/dry`, { method: 'POST', headers, body: JSON.stringify([]) }, 400)
  await request(baseUrl, `/admin/production/core-batches/${secondReport.batch.id}/scrap`, { method: 'POST', headers, body: JSON.stringify({ versionNo: 'bad', reason: 'x' }) }, 400)

  console.log(JSON.stringify({ ok: true, assertions: 46, batches: mainCounts[1] + 3 }))
} catch (error) {
  testError = error
} finally {
  await stopApi().catch((error) => { if (!testError) testError = error })
  if (prisma) await prisma.$disconnect().catch(() => null)
  if (schemaCreated && managementPrisma) await managementPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => null)
  if (managementPrisma) await managementPrisma.$disconnect().catch(() => null)
}

if (testError) throw testError
