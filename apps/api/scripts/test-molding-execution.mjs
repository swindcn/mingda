import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
let taskId = ''
let coreTaskId = ''
let coreReportId = ''
let coreBatchId = ''
let lockedRoutingVersionId = ''
let lockedRoutingVersionStatus = ''

async function request(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const payload = await response.json()
  return { status: response.status, body: payload }
}

try {
  const login = await request('/auth/login', '', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '13665068911' }) })
  assert.equal(login.status, 201)
  const token = login.body.data.token
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })
  const workOrder = await prisma.workOrder.findFirstOrThrow({
    where: {
      moldingTasks: { none: {} },
      bomVersion: { status: 'ACTIVE' },
      routingVersion: {
        AND: [
          { nodes: { some: { operation: { section: '造型' } } } },
          { nodes: { some: { operation: { pouringMergePoint: true } } } },
        ],
      },
    },
    include: {
      bomVersion: { include: { bom: true, molds: { include: { mold: true } }, coreBoxes: { include: { coreBox: true } } } },
      routingVersion: { include: { routing: true, nodes: { include: { operation: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const node = workOrder.routingVersion.nodes.find((item) => item.operation.section === '造型')
  const mold = workOrder.bomVersion.molds[0]?.mold || await prisma.moldMaster.findFirstOrThrow({ where: { status: '启用', cavityCount: { gt: 0 } } })
  lockedRoutingVersionId = workOrder.routingVersionId
  lockedRoutingVersionStatus = workOrder.routingVersion.status
  await prisma.processRoutingVersion.update({
    where: { id: lockedRoutingVersionId },
    data: { status: 'DISABLED' },
  })
  const historicalPreview = await request(`/admin/production/work-orders/${workOrder.id}/molding-task/preview`, token, {
    method: 'POST',
    body: JSON.stringify({ routingNodeId: node.id, moldCode: mold.code }),
  })
  assert.equal(historicalPreview.status, 201, JSON.stringify(historicalPreview.body))
  await prisma.processRoutingVersion.update({
    where: { id: lockedRoutingVersionId },
    data: { status: lockedRoutingVersionStatus },
  })
  lockedRoutingVersionId = ''
  const line = await prisma.productionLine.findFirstOrThrow({ where: { status: '启用', workshop: { status: '启用', type: '造型' } }, include: { workshop: true } })
  const team = await prisma.team.findFirstOrThrow({ where: { status: '启用', workshopCode: line.workshopCode } })
  const code = `TEST-MOLD-${Date.now()}`
  const planBoxQty = Math.ceil(workOrder.plannedQuantity / Number(mold.cavityCount || 1))
  const task = await prisma.moldingTask.create({
    data: {
      code,
      workOrderId: workOrder.id,
      bomVersionId: workOrder.bomVersionId,
      routingVersionId: workOrder.routingVersionId,
      routingNodeId: node.id,
      moldCode: mold.code,
      productionLineCode: line.code,
      teamCode: team.code,
      workOrderCodeSnapshot: workOrder.code,
      productCodeSnapshot: workOrder.productCodeSnapshot,
      productNameSnapshot: workOrder.productNameSnapshot,
      bomCodeSnapshot: workOrder.bomCodeSnapshot,
      bomVersionSnapshot: workOrder.bomVersionSnapshot,
      routingCodeSnapshot: workOrder.routingCodeSnapshot,
      routingNameSnapshot: workOrder.routingNameSnapshot,
      routingVersionSnapshot: workOrder.routingVersionSnapshot,
      operationCodeSnapshot: node.operationCode,
      operationNameSnapshot: node.operation.name,
      moldNameSnapshot: mold.name,
      cavityCountSnapshot: Number(mold.cavityCount || 1),
      productionLineNameSnapshot: line.name,
      workshopCodeSnapshot: line.workshopCode,
      workshopNameSnapshot: line.workshop.name,
      teamNameSnapshot: team.name,
      planPieceQty: workOrder.plannedQuantity,
      planBoxQty,
      coreRequirementsSnapshot: [{
        coreBoxCode: 'TEST-MISSING-CORE',
        coreBoxName: '自动化测试砂芯',
        quantityPerProduct: 1,
        quantityPerBox: 1,
        requiredQuantity: 1,
      }],
      createdByUserId: admin.id,
    },
  })
  taskId = task.id
  await prisma.businessDataOwnership.create({ data: { entityType: 'production:molding_tasks', entityId: task.id, createdByUserId: admin.id, createdByDepartmentId: admin.departmentId, ownerUserId: admin.id, ownerDepartmentId: admin.departmentId } })

  const detail = await request(`/admin/production/molding-tasks/${task.id}`, token)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.data.readiness.ready, false)

  const dispatched = await request(`/admin/production/molding-tasks/${task.id}/dispatch`, token, {
    method: 'PUT',
    body: JSON.stringify({ versionNo: 1, productionLineCode: line.code, teamCode: team.code }),
  })
  assert.equal(dispatched.status, 200)
  assert.equal(dispatched.body.data.status, 'DISPATCHED')
  assert.equal(dispatched.body.data.displayStatus, 'DISPATCHED')
  assert.equal(dispatched.body.data.readiness.ready, false)
  assert.equal(dispatched.body.data.allowedActions.start, false)

  const blockedStart = await request(`/admin/production/molding-tasks/${task.id}/start`, token, { method: 'POST', body: JSON.stringify({ versionNo: 2 }) })
  assert.equal(blockedStart.status, 400)
  assert.match(blockedStart.body.message, /制芯任务尚未完成/)

  const bomCoreBox = workOrder.bomVersion.coreBoxes[0]
  assert.ok(bomCoreBox, '测试工单必须包含芯盒')
  const equipment = await prisma.furnace.findFirstOrThrow({ where: { status: '启用' } })
  const supportTask = await prisma.coreProductionTask.create({
    data: {
      code: `${code}-CORE`, workOrderId: workOrder.id, bomVersionId: workOrder.bomVersionId, routingNodeId: node.id,
      coreBoxCode: bomCoreBox.coreBoxCode, productCodeSnapshot: workOrder.productCodeSnapshot, productNameSnapshot: workOrder.productNameSnapshot,
      workOrderCodeSnapshot: workOrder.code, bomCodeSnapshot: workOrder.bomCodeSnapshot, bomVersionSnapshot: workOrder.bomVersionSnapshot,
      routingCodeSnapshot: workOrder.routingCodeSnapshot, routingVersionSnapshot: workOrder.routingVersionSnapshot,
      operationCodeSnapshot: node.operationCode, operationNameSnapshot: node.operation.name, coreBoxNameSnapshot: bomCoreBox.coreBox.name,
      moldCodeSnapshot: mold.code, moldNameSnapshot: mold.name, quantityPerProductSnapshot: 1, cavityCountSnapshot: bomCoreBox.coreBox.cavityCount,
      plannedQuantity: 1, plannedPressCount: 1, equipmentCode: equipment.code, equipmentNameSnapshot: equipment.name,
      teamCode: team.code, teamNameSnapshot: team.name, status: 'COMPLETED', qualifiedQuantity: 1,
      completedByUserId: admin.id, completedAt: new Date(), createdByUserId: admin.id,
    },
  })
  coreTaskId = supportTask.id
  const supportReport = await prisma.coreProductionReport.create({
    data: {
      taskId: supportTask.id, equipmentCode: equipment.code, equipmentNameSnapshot: equipment.name,
      teamCode: team.code, teamNameSnapshot: team.name, operatorUserId: admin.id, operatorNameSnapshot: admin.name,
      qualifiedQuantity: 1, dryingRequired: false,
    },
  })
  coreReportId = supportReport.id
  const supportBatch = await prisma.coreInventoryBatch.create({
    data: {
      code: `${code}-BATCH`, qrContent: `${code}-BATCH`, reportId: supportReport.id,
      coreBoxCodeSnapshot: bomCoreBox.coreBoxCode, productCodeSnapshot: workOrder.productCodeSnapshot,
      productNameSnapshot: workOrder.productNameSnapshot, coreBoxNameSnapshot: bomCoreBox.coreBox.name,
      workOrderCodeSnapshot: workOrder.code, initialQuantity: 1, currentQuantity: 1, dryingRequired: false,
      driedAt: new Date(), shelfLifeStartedAt: new Date(), status: 'AVAILABLE',
    },
  })
  coreBatchId = supportBatch.id
  await prisma.moldingTask.update({
    where: { id: task.id },
    data: { coreRequirementsSnapshot: [{
      coreBoxCode: bomCoreBox.coreBoxCode,
      coreBoxName: bomCoreBox.coreBox.name,
      quantityPerProduct: 1,
      quantityPerBox: 1,
      requiredQuantity: planBoxQty,
    }] },
  })

  const partialDetail = await request(`/admin/production/molding-tasks/${task.id}`, token)
  assert.equal(partialDetail.status, 200)
  assert.equal(partialDetail.body.data.readiness.ready, false)
  assert.equal(partialDetail.body.data.readiness.startable, true)
  assert.equal(partialDetail.body.data.readiness.maxProducibleBoxQty, 1)
  assert.equal(partialDetail.body.data.allowedActions.start, true)

  const started = await request(`/admin/production/molding-tasks/${task.id}/start`, token, { method: 'POST', body: JSON.stringify({ versionNo: 2 }) })
  assert.equal(started.status, 201)
  assert.equal(started.body.data.status, 'IN_PROGRESS')
  assert.equal(started.body.data.versionNo, 3)

  const defects = await request(`/admin/production/molding-tasks/${task.id}/defect-options`, token)
  assert.equal(defects.status, 200)
  assert.equal(defects.body.data.length >= 6, true)
  const defectCode = defects.body.data[0].code

  const invalid = await request(`/admin/production/molding-tasks/${task.id}/report`, token, { method: 'POST', body: JSON.stringify({ versionNo: 3, requestId: `${code}-invalid`, goodQty: 1, scrapQty: 1, finishTask: false, defects: [{ defectCode, quantity: 2 }] }) })
  assert.equal(invalid.status, 400)

  const reportPayload = { versionNo: 3, requestId: `${code}-report`, goodQty: 2, scrapQty: 1, finishTask: false, defects: [{ defectCode, quantity: 1 }] }
  const reported = await request(`/admin/production/molding-tasks/${task.id}/report`, token, { method: 'POST', body: JSON.stringify(reportPayload) })
  assert.equal(reported.status, 201)
  assert.equal(reported.body.data.completedGoodQty, 2)
  assert.equal(reported.body.data.completedScrapQty, 1)
  assert.equal(reported.body.data.versionNo, 4)
  assert.equal(reported.body.data.reports.length, 1)
  const reportId = reported.body.data.reports[0].id
  const overdrawnBatch = await prisma.coreInventoryBatch.findUniqueOrThrow({ where: { id: supportBatch.id } })
  assert.equal(overdrawnBatch.currentQuantity, -2)
  assert.equal(overdrawnBatch.status, 'CONSUMED')
  assert.equal(reported.body.data.reports[0].coreConsumptions[0].quantity, 3)
  assert.equal(reported.body.data.reports[0].coreConsumptions[0].quantityAfter, -2)
  const pouringBatch = await prisma.pouringMoldBatch.findUnique({ where: { sourceMoldingReportId: reportId } })
  assert.ok(pouringBatch, '造型合格报工必须生成待浇注砂型批次')
  assert.equal(pouringBatch.originalQuantity, 2)
  assert.equal(pouringBatch.remainingQuantity, 2)
  assert.equal(pouringBatch.status, 'WAITING')
  assert.equal(pouringBatch.moldingTaskId, task.id)
  assert.equal(pouringBatch.workOrderId, workOrder.id)

  const duplicate = await request(`/admin/production/molding-tasks/${task.id}/report`, token, { method: 'POST', body: JSON.stringify(reportPayload) })
  assert.equal(duplicate.status, 201)
  assert.equal(duplicate.body.data.reports.length, 1)
  assert.equal(duplicate.body.data.versionNo, 4)
  assert.equal(await prisma.pouringMoldBatch.count({ where: { sourceMoldingReportId: reportId } }), 1)

  const reversed = await request(`/admin/production/molding-reports/${reportId}/reverse`, token, { method: 'POST', body: JSON.stringify({ versionNo: 4, reason: '自动化测试撤销' }) })
  assert.equal(reversed.status, 201)
  assert.equal(reversed.body.data.completedGoodQty, 0)
  assert.equal(reversed.body.data.completedScrapQty, 0)
  assert.equal(reversed.body.data.reports[0].status, 'REVERSED')
  assert.equal((await prisma.coreInventoryBatch.findUniqueOrThrow({ where: { id: supportBatch.id } })).currentQuantity, 1)
  assert.equal((await prisma.pouringMoldBatch.findUniqueOrThrow({ where: { sourceMoldingReportId: reportId } })).status, 'CANCELED')

  const zeroContinue = await request(`/admin/production/molding-tasks/${task.id}/report`, token, {
    method: 'POST', body: JSON.stringify({ versionNo: 5, requestId: `${code}-zero-continue`, goodQty: 0, scrapQty: 0, finishTask: false, defects: [] }),
  })
  assert.equal(zeroContinue.status, 400)
  assert.match(zeroContinue.body.message, /零数量报工仅用于结束任务/)
  const zeroWithoutReason = await request(`/admin/production/molding-tasks/${task.id}/report`, token, {
    method: 'POST', body: JSON.stringify({ versionNo: 5, requestId: `${code}-zero-no-reason`, goodQty: 0, scrapQty: 0, finishTask: true, defects: [] }),
  })
  assert.equal(zeroWithoutReason.status, 400)
  assert.match(zeroWithoutReason.body.message, /结束原因/)
  const zeroFinished = await request(`/admin/production/molding-tasks/${task.id}/report`, token, {
    method: 'POST', body: JSON.stringify({ versionNo: 5, requestId: `${code}-zero-finish`, goodQty: 0, scrapQty: 0, finishTask: true, earlyCompletionReason: '补充关闭任务', defects: [] }),
  })
  assert.equal(zeroFinished.status, 201)
  assert.equal(zeroFinished.body.data.status, 'COMPLETED')
  assert.equal(zeroFinished.body.data.earlyCompletionReason, '补充关闭任务')
  assert.equal(zeroFinished.body.data.reports.length, 2)
  assert.equal(zeroFinished.body.data.readiness.ready, true)
  assert.equal(zeroFinished.body.data.readiness.requirements.every((item) => item.shortage === 0), true)
  assert.equal(await prisma.pouringMoldBatch.count({ where: { moldingTaskId: task.id } }), 1)

  const miniList = await request('/mini/production/molding-tasks', token)
  assert.equal(miniList.status, 200)
  assert.equal(miniList.body.data.some((item) => item.id === task.id), true)

  console.log(JSON.stringify({ ok: true, suite: 'molding-execution' }))
} finally {
  if (lockedRoutingVersionId) {
    await prisma.processRoutingVersion.update({
      where: { id: lockedRoutingVersionId },
      data: { status: lockedRoutingVersionStatus },
    })
  }
  if (taskId) {
    const reports = await prisma.moldingReport.findMany({ where: { taskId }, select: { id: true } })
    const reportIds = reports.map((item) => item.id)
    await prisma.moldingReportDefect.deleteMany({ where: { reportId: { in: reportIds } } })
    await prisma.moldingCoreConsumption.deleteMany({ where: { reportId: { in: reportIds } } })
    await prisma.pouringMoldBatch.deleteMany({ where: { moldingTaskId: taskId } })
    await prisma.coreInventoryLedger.deleteMany({ where: { OR: [{ sourceId: { in: reportIds } }, ...(coreBatchId ? [{ batchId: coreBatchId }] : [])] } })
    await prisma.moldingReport.deleteMany({ where: { id: { in: reportIds } } })
    await prisma.businessDataOwnership.deleteMany({ where: { entityType: 'production:molding_tasks', entityId: taskId } })
    await prisma.moldingTask.deleteMany({ where: { id: taskId } })
  }
  if (coreBatchId) await prisma.coreInventoryBatch.deleteMany({ where: { id: coreBatchId } })
  if (coreReportId) await prisma.coreProductionReport.deleteMany({ where: { id: coreReportId } })
  if (coreTaskId) await prisma.coreProductionTask.deleteMany({ where: { id: coreTaskId } })
  await prisma.$disconnect()
}
