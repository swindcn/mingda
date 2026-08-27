import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import {
  backfillShakeBatches,
  createShakeBatchForPouringReport,
  findReachableShakeNode,
} from '../dist/production/shake-clean.queue.js'

const prisma = new PrismaClient()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
function isTestDatabase(connectionString) {
  try {
    const parsed = new URL(connectionString)
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase()
    const schemaName = (parsed.searchParams.get('schema') || 'public').toLowerCase()
    return /(^|[-_])test($|[-_])/.test(databaseName) || /(^|[-_])test($|[-_])/.test(schemaName)
  } catch {
    return false
  }
}
if (process.env.ALLOW_SHARED_DB_MUTATION !== '1' && !isTestDatabase(databaseUrl)) {
  throw new Error('pouring-execution 会修改工单与路线夹具；请使用 test 数据库/schema，或显式设置 ALLOW_SHARED_DB_MUTATION=1')
}
let baseUrl = process.env.API_BASE_URL || ''
let apiProcess
let apiOutput = ''
const suffix = Date.now()
const stationCode = `TEST-POUR-ST-${suffix}`
const defectCode = `TEST-POUR-DEF-${suffix}`
let sourceReportId = ''
let batchId = ''
let pouringReportId = ''
let noShakePouringReportId = ''
let consumedPouringReportId = ''
let shakeReportId = ''
let transferId = ''
let transferVersionNo = 0
let moldingTaskId = ''
let pouringNodeId = ''
let shakeNodeId = ''
let routingVersionId = ''
let originalRoutingVersionStatus = ''
let originalCavityCount = 0
let originalCoolingDurationMinutes = 0
let removedEdge = null
let pendingBeforeReport = 0

async function request(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const body = await response.json()
  return { status: response.status, body }
}

async function availablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // The new dist process may not be listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`新构建 API 启动超时\n${apiOutput}`)
}

async function verifyRoutingGraphGuards() {
  const node = (id, code, section = '其他') => ({
    id,
    coolingDurationMinutes: 0,
    operation: { code, name: code, section },
  })
  const client = (nodes, edges) => ({
    processRoutingVersion: { findUnique: async () => ({ nodes, edges }) },
  })
  await assert.rejects(
    () => findReachableShakeNode(
      client([node('pour', 'OP-POUR', '浇注'), node('shake-a', 'OP-SHAKE', '清理'), node('shake-b', 'OP-SHAKE', '清理')], [
        { sourceNodeId: 'pour', targetNodeId: 'shake-a' },
        { sourceNodeId: 'pour', targetNodeId: 'shake-b' },
      ]),
      'routing-version',
      'pour',
    ),
    /多个同级可达落砂节点/,
  )
  await assert.rejects(
    () => findReachableShakeNode(
      client([node('pour', 'OP-POUR', '浇注'), node('middle', 'OP-INSP', '质检')], [
        { sourceNodeId: 'pour', targetNodeId: 'middle' },
        { sourceNodeId: 'middle', targetNodeId: 'pour' },
      ]),
      'routing-version',
      'pour',
    ),
    /工艺路线存在循环/,
  )
}

async function verifyBackfillLockingAndBounds() {
  const lockOrder = []
  let reportReads = 0
  let upserted = false
  let reversedResolution
  const reversedAfterLock = {
    $queryRaw: async () => {
      lockOrder.push(lockOrder.length === 0 ? 'MoldingTask' : 'PouringReport')
      return [{ id: 'report-reversed' }]
    },
    pouringReport: {
      findUnique: async () => {
        reportReads += 1
        if (reportReads === 1) return { moldingTaskId: 'task-reversed' }
        assert.deepEqual(lockOrder, ['MoldingTask', 'PouringReport'], '补建必须按任务、浇注报工顺序加锁后重读状态')
        return { id: 'report-reversed', status: 'REVERSED', goodQty: 3, shakeQueueResolution: 'PENDING', shakeBatch: null }
      },
      update: async ({ data }) => { reversedResolution = data.shakeQueueResolution },
    },
    shakeBatch: { upsert: async () => { upserted = true } },
  }
  assert.equal(await createShakeBatchForPouringReport(reversedAfterLock, 'report-reversed'), null)
  assert.equal(upserted, false, '锁后已撤销的浇注报工不得生成待落砂批次')
  assert.equal(reversedResolution, 'NOT_APPLICABLE', '撤销报工必须持久化为无需进入待落砂队列')

  const ids = Array.from({ length: 101 }, (_, index) => `report-${String(index).padStart(3, '0')}`)
  let findManyCalls = 0
  let lockCalls = 0
  let created = 0
  const boundedTx = {
    $queryRaw: async () => {
      lockCalls += 1
      return [{ id: 'locked' }]
    },
    pouringReport: {
      findMany: async ({ take, where }) => {
        findManyCalls += 1
        assert.equal(take, 101, '单批查询只允许 100 条加 1 条前瞻记录')
        assert.equal(where.shakeQueueResolution, 'PENDING', '补建只处理待解析浇注报工')
        return ids.map((id) => ({ id }))
      },
      findUnique: async ({ where, select }) => select?.moldingTaskId && Object.keys(select).length === 1 ? { moldingTaskId: 'task' } : ({
        id: where.id,
        code: `PR-${where.id}`,
        status: 'ACTIVE',
        shakeQueueResolution: 'PENDING',
        goodQty: 1,
        reportedAt: new Date('2026-08-24T00:00:00Z'),
        moldingTaskId: 'task',
        workOrderId: 'work-order',
        pouringRoutingNodeId: 'pour',
        workOrderCodeSnapshot: 'WO',
        productCodeSnapshot: 'ITEM',
        productNameSnapshot: '产品',
        shakeBatch: null,
        moldingTask: { routingVersionId: 'routing-version', cavityCountSnapshot: 2 },
      }),
      update: async ({ data }) => {
        assert.equal(data.shakeQueueResolution, 'CREATED')
      },
    },
    processRoutingVersion: {
      findUnique: async () => ({
        nodes: [
          { id: 'pour', coolingDurationMinutes: 0, operation: { code: 'OP-POUR', name: '浇注', section: '浇注' } },
          { id: 'shake', coolingDurationMinutes: 90, operation: { code: 'OP-SHAKE', name: '落砂清理', section: '清理' } },
        ],
        edges: [{ sourceNodeId: 'pour', targetNodeId: 'shake' }],
      }),
    },
    shakeBatch: {
      upsert: async ({ create }) => {
        created += 1
        return { id: `batch-${create.sourcePouringReportId}` }
      },
    },
  }
  const result = await backfillShakeBatches(boundedTx)
  assert.deepEqual(result, { processed: 100, created: 100, lastId: 'report-099', hasMore: true })
  assert.equal(findManyCalls, 1, '一次调用不得在同一事务继续扫描下一批')
  assert.equal(lockCalls, 200, '每条补建记录必须依次锁定任务和浇注报工')
  assert.equal(created, 100)
}

try {
  await verifyRoutingGraphGuards()
  await verifyBackfillLockingAndBounds()
  if (!baseUrl) {
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}/api`
    apiProcess = spawn(process.execPath, ['dist/main.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), JWT_SECRET: 'pouring-execution-test-secret' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    apiProcess.stdout.on('data', (chunk) => { apiOutput += String(chunk) })
    apiProcess.stderr.on('data', (chunk) => { apiOutput += String(chunk) })
    await waitForHealth()
  }
  const login = await request('/auth/login', '', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '13665068911' }) })
  assert.equal(login.status, 201)
  const token = login.body.data.token
  const task = await prisma.moldingTask.findFirstOrThrow({
    where: {
      workOrder: { allocations: { some: { heatOrder: { status: { in: ['TRANSFERRING', 'COMPLETED'] }, transfers: { some: {} } } } } },
      routingVersion: { nodes: { some: { operation: { pouringMergePoint: true } } } },
    },
    include: {
      workOrder: { include: { allocations: { include: { heatOrder: { include: { transfers: true } } } } } },
      routingVersion: { include: { nodes: { include: { operation: true } }, edges: true } },
    },
  })
  const pouringNode = task.routingVersion.nodes.find((node) => node.operation.pouringMergePoint)
  assert.ok(pouringNode)
  const shakeNode = task.routingVersion.nodes.find((node) => node.operationCode === 'OP-SHAKE' || node.operation.section === '清理')
  assert.ok(shakeNode)
  const pouringToShakeEdge = task.routingVersion.edges.find((edge) => edge.sourceNodeId === pouringNode.id && edge.targetNodeId === shakeNode.id)
  assert.ok(pouringToShakeEdge)
  pouringNodeId = pouringNode.id
  moldingTaskId = task.id
  shakeNodeId = shakeNode.id
  routingVersionId = task.routingVersionId
  originalRoutingVersionStatus = task.routingVersion.status
  originalCavityCount = task.cavityCountSnapshot
  originalCoolingDurationMinutes = shakeNode.coolingDurationMinutes
  const transfer = task.workOrder.allocations.flatMap((allocation) => allocation.heatOrder.transfers)[0]
  assert.ok(transfer)
  transferId = transfer.id
  transferVersionNo = transfer.versionNo
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })
  await prisma.moldingTask.update({ where: { id: task.id }, data: { cavityCountSnapshot: 2 } })
  await prisma.processRoutingVersion.update({ where: { id: task.routingVersionId }, data: { status: 'DISABLED' } })
  await prisma.processRoutingNode.update({ where: { id: shakeNode.id }, data: { coolingDurationMinutes: 90 } })
  await prisma.furnace.create({ data: { code: stationCode, name: '自动化测试浇注工位', equipmentType: '浇注设备', status: '启用' } })
  await prisma.routingNodeEquipment.create({ data: { routingNodeId: pouringNode.id, equipmentCode: stationCode } })
  const defect = await prisma.defectCode.create({ data: { code: defectCode, name: '自动化测试浇不足', category: '浇注缺陷', status: '启用' } })
  await prisma.defectOperation.create({ data: { defectCodeId: defect.id, operationCode: pouringNode.operationCode } })
  const sourceReport = await prisma.moldingReport.create({
    data: {
      taskId: task.id,
      reportCode: `TEST-MRP-${suffix}`,
      requestId: `TEST-MRP-REQ-${suffix}`,
      goodQty: 10,
      scrapQty: 0,
      operatorUserId: admin.id,
      operatorNameSnapshot: admin.name,
      reportedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
  })
  sourceReportId = sourceReport.id
  const batch = await prisma.pouringMoldBatch.create({
    data: {
      code: `TEST-PMB-${suffix}`,
      sourceMoldingReportId: sourceReport.id,
      moldingTaskId: task.id,
      workOrderId: task.workOrderId,
      routingVersionId: task.routingVersionId,
      pouringRoutingNodeId: pouringNode.id,
      workOrderCodeSnapshot: task.workOrderCodeSnapshot,
      productCodeSnapshot: task.productCodeSnapshot,
      productNameSnapshot: task.productNameSnapshot,
      moldCodeSnapshot: task.moldCode,
      moldNameSnapshot: task.moldNameSnapshot,
      moldingOperationCodeSnapshot: task.operationCodeSnapshot,
      moldingOperationNameSnapshot: task.operationNameSnapshot,
      pouringOperationCodeSnapshot: pouringNode.operationCode,
      pouringOperationNameSnapshot: pouringNode.operation.name,
      originalQuantity: 10,
      remainingQuantity: 10,
      closingTime: sourceReport.reportedAt,
    },
  })
  batchId = batch.id
  pendingBeforeReport = (await prisma.pouringMoldBatch.aggregate({
    where: { moldingTaskId: task.id, status: { in: ['WAITING', 'PARTIAL'] } },
    _sum: { remainingQuantity: true },
  }))._sum.remainingQuantity || 0

  const queue = await request('/admin/production/pouring-tasks', token)
  assert.equal(queue.status, 200, JSON.stringify(queue.body))
  assert.equal(queue.body.data.some((item) => item.moldingTaskId === task.id), true)
  const options = await request(`/admin/production/pouring-tasks/${task.id}/options`, token)
  assert.equal(options.status, 200, JSON.stringify(options.body))
  assert.equal(options.body.data.stations.some((item) => item.code === stationCode), true)
  assert.equal(options.body.data.transfers.some((item) => item.id === transfer.id), true)

  const checkPayload = { moldingTaskId: task.id, heatOrderTransferId: transfer.id, stationEquipmentCode: stationCode, goodQty: 3, scrapQty: 1, actualWeightKg: Number(transfer.weightKg) + 50 }
  const check = await request('/admin/production/pouring/check', token, { method: 'POST', body: JSON.stringify(checkPayload) })
  assert.equal(check.status, 201, JSON.stringify(check.body))
  assert.equal(check.body.data.warningCodes.includes('CRITICAL_HOLD'), true)
  assert.equal(check.body.data.warningCodes.includes('TRANSFER_OVERDRAW'), true)
  assert.equal(check.body.data.transferBalanceAfterKg < 0, true)

  const reportPayload = {
    ...checkPayload,
    requestId: `TEST-POUR-REQ-${suffix}`,
    transferVersionNo,
    defects: [{ defectCode, quantity: 1 }],
  }
  const unconfirmed = await request('/admin/production/pouring/reports', token, { method: 'POST', body: JSON.stringify(reportPayload) })
  assert.equal(unconfirmed.status, 409)
  assert.equal(unconfirmed.body.message.conflictCode || unconfirmed.body.conflictCode, 'POURING_WARNING_CONFIRMATION_REQUIRED')
  const reported = await request('/admin/production/pouring/reports', token, {
    method: 'POST',
    body: JSON.stringify({ ...reportPayload, confirmedWarningCodes: ['CRITICAL_HOLD', 'TRANSFER_OVERDRAW'] }),
  })
  assert.equal(reported.status, 201, JSON.stringify(reported.body))
  pouringReportId = reported.body.data.id
  assert.equal(reported.body.data.goodQty, 3)
  assert.equal(reported.body.data.scrapQty, 1)
  assert.equal(reported.body.data.transferBalanceAfterKg < 0, true)
  assert.equal((await prisma.pouringMoldBatch.aggregate({
    where: { moldingTaskId: task.id, status: { in: ['WAITING', 'PARTIAL'] } },
    _sum: { remainingQuantity: true },
  }))._sum.remainingQuantity || 0, pendingBeforeReport - 4)
  assert.equal((await prisma.heatOrderTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).versionNo, transferVersionNo + 1)

  const shakeBatch = await prisma.shakeBatch.findUnique({ where: { sourcePouringReportId: pouringReportId } })
  assert.ok(shakeBatch, '浇注报工应生成待落砂批次')
  assert.equal(shakeBatch.code, `${reported.body.data.code}-SHAKE`)
  assert.equal(shakeBatch.originalQuantity, 6)
  assert.equal(shakeBatch.remainingQuantity, 6)
  assert.equal(shakeBatch.moldingTaskId, task.id)
  assert.equal(shakeBatch.workOrderId, task.workOrderId)
  assert.equal(shakeBatch.routingVersionId, task.routingVersionId)
  assert.equal(shakeBatch.shakeRoutingNodeId, shakeNode.id)
  assert.equal(shakeBatch.shakeOperationCodeSnapshot, shakeNode.operationCode)
  assert.equal(shakeBatch.shakeOperationNameSnapshot, shakeNode.operation.name)
  assert.equal(shakeBatch.coolingDurationMinutesSnapshot, 90)
  assert.equal(shakeBatch.pouredAt.toISOString(), new Date(reported.body.data.reportedAt).toISOString())
  assert.equal((await prisma.pouringReport.findUniqueOrThrow({ where: { id: pouringReportId } })).shakeQueueResolution, 'CREATED')
  assert.equal((await prisma.processRoutingVersion.findUniqueOrThrow({ where: { id: task.routingVersionId } })).status, 'DISABLED')

  const duplicate = await request('/admin/production/pouring/reports', token, {
    method: 'POST',
    body: JSON.stringify({ ...reportPayload, confirmedWarningCodes: ['CRITICAL_HOLD', 'TRANSFER_OVERDRAW'] }),
  })
  assert.equal(duplicate.status, 201)
  assert.equal(duplicate.body.data.id, pouringReportId)
  assert.equal(await prisma.pouringReport.count({ where: { moldingTaskId: task.id, requestId: reportPayload.requestId } }), 1)
  assert.equal(await prisma.shakeBatch.count({ where: { sourcePouringReportId: pouringReportId } }), 1)

  const reversed = await request(`/admin/production/pouring-reports/${pouringReportId}/reverse`, token, {
    method: 'POST',
    body: JSON.stringify({ transferVersionNo: transferVersionNo + 1, reason: '自动化测试撤销' }),
  })
  assert.equal(reversed.status, 201, JSON.stringify(reversed.body))
  assert.equal(reversed.body.data.status, 'REVERSED')
  assert.equal(reversed.body.data.shakeQueueResolution, 'NOT_APPLICABLE')
  const canceledShakeBatch = await prisma.shakeBatch.findUniqueOrThrow({ where: { sourcePouringReportId: pouringReportId } })
  assert.equal(canceledShakeBatch.status, 'CANCELED')
  assert.equal(canceledShakeBatch.versionNo, shakeBatch.versionNo + 1)
  assert.equal((await prisma.pouringMoldBatch.aggregate({
    where: { moldingTaskId: task.id, status: { in: ['WAITING', 'PARTIAL'] } },
    _sum: { remainingQuantity: true },
  }))._sum.remainingQuantity || 0, pendingBeforeReport)

  removedEdge = pouringToShakeEdge
  await prisma.processRoutingEdge.delete({ where: { id: pouringToShakeEdge.id } })
  const noShake = await request('/admin/production/pouring/reports', token, {
    method: 'POST',
    body: JSON.stringify({
      moldingTaskId: task.id,
      heatOrderTransferId: transfer.id,
      stationEquipmentCode: stationCode,
      goodQty: 1,
      scrapQty: 0,
      actualWeightKg: 0,
      requestId: `TEST-POUR-NO-SHAKE-${suffix}`,
      transferVersionNo: transferVersionNo + 2,
      confirmedWarningCodes: ['CRITICAL_HOLD'],
      defects: [],
    }),
  })
  assert.equal(noShake.status, 201, JSON.stringify(noShake.body))
  noShakePouringReportId = noShake.body.data.id
  assert.equal(await prisma.shakeBatch.count({ where: { sourcePouringReportId: noShakePouringReportId } }), 0)
  assert.equal((await prisma.pouringReport.findUniqueOrThrow({ where: { id: noShakePouringReportId } })).shakeQueueResolution, 'NOT_APPLICABLE')
  await prisma.$transaction(async (tx) => {
    await backfillShakeBatches(tx)
    await backfillShakeBatches(tx)
  })
  assert.equal(await prisma.shakeBatch.count({ where: { sourcePouringReportId: noShakePouringReportId } }), 0)
  await prisma.processRoutingEdge.create({ data: removedEdge })
  removedEdge = null
  await prisma.$transaction(async (tx) => {
    await backfillShakeBatches(tx)
    await backfillShakeBatches(tx)
  })
  assert.equal(await prisma.shakeBatch.count({ where: { sourcePouringReportId: noShakePouringReportId } }), 0, '已解析为 NOT_APPLICABLE 的报工不因后续路线变更重复入队')
  assert.equal((await prisma.pouringReport.findUniqueOrThrow({ where: { id: noShakePouringReportId } })).shakeQueueResolution, 'NOT_APPLICABLE')
  const reversedNoShake = await request(`/admin/production/pouring-reports/${noShakePouringReportId}/reverse`, token, {
    method: 'POST',
    body: JSON.stringify({ transferVersionNo: transferVersionNo + 3, reason: '自动化测试撤销无落砂路线报工' }),
  })
  assert.equal(reversedNoShake.status, 201, JSON.stringify(reversedNoShake.body))

  const consumed = await request('/admin/production/pouring/reports', token, {
    method: 'POST',
    body: JSON.stringify({
      moldingTaskId: task.id,
      heatOrderTransferId: transfer.id,
      stationEquipmentCode: stationCode,
      goodQty: 1,
      scrapQty: 0,
      actualWeightKg: 0,
      requestId: `TEST-POUR-CONSUMED-${suffix}`,
      transferVersionNo: transferVersionNo + 4,
      confirmedWarningCodes: ['CRITICAL_HOLD'],
      defects: [],
    }),
  })
  assert.equal(consumed.status, 201, JSON.stringify(consumed.body))
  consumedPouringReportId = consumed.body.data.id
  const consumedShakeBatch = await prisma.shakeBatch.findUniqueOrThrow({ where: { sourcePouringReportId: consumedPouringReportId } })
  const shakeReport = await prisma.shakeReport.create({
    data: {
      code: `TEST-SHR-${suffix}`,
      requestId: `TEST-SHR-REQ-${suffix}`,
      moldingTaskId: task.id,
      workOrderId: task.workOrderId,
      shakeRoutingNodeId: shakeNode.id,
      stationEquipmentCode: stationCode,
      workOrderCodeSnapshot: task.workOrderCodeSnapshot,
      productCodeSnapshot: task.productCodeSnapshot,
      productNameSnapshot: task.productNameSnapshot,
      shakeOperationCodeSnapshot: shakeNode.operationCode,
      shakeOperationNameSnapshot: shakeNode.operation.name,
      stationEquipmentNameSnapshot: '自动化测试浇注工位',
      operatorUserId: admin.id,
      operatorNameSnapshot: admin.name,
      goodQty: 1,
      scrapQty: 0,
      requiredCoolingMinutesSnapshot: 90,
      actualCoolingMinutesSnapshot: 90,
      earlyShake: false,
    },
  })
  shakeReportId = shakeReport.id
  await prisma.shakeBatchConsumption.create({
    data: {
      shakeReportId: shakeReport.id,
      shakeBatchId: consumedShakeBatch.id,
      quantity: 1,
      quantityBefore: 2,
      quantityAfter: 1,
      requiredCoolingMinutesSnapshot: 90,
      actualCoolingMinutesSnapshot: 90,
      earlyShake: false,
    },
  })
  await prisma.shakeBatch.update({ where: { id: consumedShakeBatch.id }, data: { remainingQuantity: 1, status: 'PARTIAL', versionNo: { increment: 1 } } })
  const blockedReverse = await request(`/admin/production/pouring-reports/${consumedPouringReportId}/reverse`, token, {
    method: 'POST',
    body: JSON.stringify({ transferVersionNo: transferVersionNo + 5, reason: '自动化测试下游已消费' }),
  })
  assert.equal(blockedReverse.status, 400, JSON.stringify(blockedReverse.body))
  assert.match(String(blockedReverse.body.message), /先撤销落砂/)
  assert.equal((await prisma.pouringReport.findUniqueOrThrow({ where: { id: consumedPouringReportId } })).status, 'ACTIVE')
  assert.equal((await prisma.heatOrderTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).versionNo, transferVersionNo + 5)

  await prisma.shakeBatchConsumption.deleteMany({ where: { shakeReportId } })
  await prisma.shakeReport.delete({ where: { id: shakeReportId } })
  shakeReportId = ''
  await prisma.shakeBatch.update({ where: { id: consumedShakeBatch.id }, data: { remainingQuantity: 2, status: 'WAITING', versionNo: { increment: 1 } } })
  const reversedConsumed = await request(`/admin/production/pouring-reports/${consumedPouringReportId}/reverse`, token, {
    method: 'POST',
    body: JSON.stringify({ transferVersionNo: transferVersionNo + 5, reason: '自动化测试下游撤销后撤销浇注' }),
  })
  assert.equal(reversedConsumed.status, 201, JSON.stringify(reversedConsumed.body))
  assert.equal((await prisma.shakeBatch.findUniqueOrThrow({ where: { id: consumedShakeBatch.id } })).status, 'CANCELED')

  console.log(JSON.stringify({ ok: true, suite: 'pouring-execution' }))
} catch (error) {
  if (apiOutput) console.error(apiOutput)
  throw error
} finally {
  if (apiProcess && apiProcess.exitCode === null) {
    const exited = once(apiProcess, 'exit')
    apiProcess.kill('SIGTERM')
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))])
    if (apiProcess.exitCode === null) apiProcess.kill('SIGKILL')
  }
  if (removedEdge) await prisma.processRoutingEdge.create({ data: removedEdge })
  if (shakeReportId) {
    await prisma.shakeBatchConsumption.deleteMany({ where: { shakeReportId } })
    await prisma.shakeReport.deleteMany({ where: { id: shakeReportId } })
  }
  const pouringReportIds = [pouringReportId, noShakePouringReportId, consumedPouringReportId].filter(Boolean)
  if (pouringReportIds.length) {
    await prisma.shakeBatchConsumption.deleteMany({ where: { shakeBatch: { sourcePouringReportId: { in: pouringReportIds } } } })
    await prisma.shakeBatch.deleteMany({ where: { sourcePouringReportId: { in: pouringReportIds } } })
    await prisma.pouringReportDefect.deleteMany({ where: { pouringReportId: { in: pouringReportIds } } })
    await prisma.pouringMoldConsumption.deleteMany({ where: { pouringReportId: { in: pouringReportIds } } })
    await prisma.pouringReport.deleteMany({ where: { id: { in: pouringReportIds } } })
  }
  if (batchId) await prisma.pouringMoldBatch.deleteMany({ where: { id: batchId } })
  if (sourceReportId) await prisma.moldingReport.deleteMany({ where: { id: sourceReportId } })
  if (pouringNodeId) await prisma.routingNodeEquipment.deleteMany({ where: { routingNodeId: pouringNodeId, equipmentCode: stationCode } })
  await prisma.furnace.deleteMany({ where: { code: stationCode } })
  const defect = await prisma.defectCode.findUnique({ where: { code: defectCode } })
  if (defect) {
    await prisma.defectOperation.deleteMany({ where: { defectCodeId: defect.id } })
    await prisma.defectCode.delete({ where: { id: defect.id } })
  }
  if (shakeNodeId) await prisma.processRoutingNode.update({ where: { id: shakeNodeId }, data: { coolingDurationMinutes: originalCoolingDurationMinutes } })
  if (routingVersionId) await prisma.processRoutingVersion.update({ where: { id: routingVersionId }, data: { status: originalRoutingVersionStatus } })
  if (moldingTaskId) await prisma.moldingTask.update({ where: { id: moldingTaskId }, data: { cavityCountSnapshot: originalCavityCount } })
  if (transferId && transferVersionNo) await prisma.heatOrderTransfer.update({ where: { id: transferId }, data: { versionNo: transferVersionNo } })
  await prisma.$disconnect()
}
