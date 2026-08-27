import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma, PrismaClient } from '@prisma/client'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseDatabaseUrl = process.env.DATABASE_URL || 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const allowRemote = process.env.ALLOW_REMOTE_INTEGRATION_TEST === 'true'
const stamp = Date.now()
const schemaName = `test_shake_clean_${process.pid}_${stamp}_${randomBytes(4).toString('hex')}`
if (!/^test_shake_clean_[a-z0-9_]+$/.test(schemaName)) throw new Error(`临时 schema 名称不安全: ${schemaName}`)

function databaseUrlForSchema(value, schema) {
  const url = new URL(value)
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('落砂清理测试仅支持 PostgreSQL')
  if (!allowRemote && (!['127.0.0.1', 'localhost'].includes(url.hostname) || /(^|[_-])(prod|production)([_-]|$)/i.test(databaseName))) {
    throw new Error(`拒绝在非本地或疑似生产数据库运行落砂清理测试: ${url.hostname}/${databaseName}`)
  }
  url.searchParams.set('schema', schema)
  return url.toString()
}

const databaseUrl = databaseUrlForSchema(baseDatabaseUrl, schemaName)
const managementUrl = databaseUrlForSchema(baseDatabaseUrl, 'public')
let prisma
let managementPrisma
let apiProcess
let apiOutput = ''
let apiError
let schemaCreated = false
let baseUrl = ''
const prefix = `TEST-SC-${stamp}`
let fixture
let restrictedCredentials
let backfillShakeBatches
let ensureInspectionBatchForBlankOutput
let backfillInspectionBatches

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function run(label, command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: apiRoot, env, encoding: 'utf8' })
  if (result.status !== 0 || result.error) throw new Error(`${label}失败: ${result.error?.message || result.stderr || result.stdout}`)
}

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return port
}

async function waitForApi() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (apiError) throw apiError
    if (apiProcess?.exitCode !== null) throw new Error(`隔离 API 提前退出:\n${apiOutput}`)
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`隔离 API 启动超时:\n${apiOutput}`)
}

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  if (expectedStatus !== undefined) {
    assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${path}: ${payload.message || ''}`)
    return payload
  }
  assert.equal(response.ok, true, `${options.method || 'GET'} ${path}: ${payload.message || response.status}`)
  assert.equal(payload.code, 0, payload.message)
  return payload.data
}

async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return
  const exited = once(apiProcess, 'exit')
  apiProcess.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))])
  if (apiProcess.exitCode === null) apiProcess.kill('SIGKILL')
}

let testError
try {
  run('构建 API', 'npm', ['run', 'build'])
  ;({ backfillShakeBatches } = await import('../dist/production/shake-clean.queue.js'))
  ;({ ensureInspectionBatchForBlankOutput } = await import('../dist/production/final-inspection.queue.js'))
  ;({ backfillInspectionBatches } = await import('./backfill-inspection-batches.mjs'))
  managementPrisma = new PrismaClient({ datasources: { db: { url: managementUrl } } })
  await managementPrisma.$connect()
  await managementPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`)
  schemaCreated = true
  run('初始化临时 schema', resolve(apiRoot, 'node_modules/.bin/prisma'), ['db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'], { ...process.env, DATABASE_URL: databaseUrl })
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await prisma.$connect()
  await prisma.user.create({ data: { username: 'admin', name: '系统管理员', phone: '13665068911', passwordHash: hashPassword('13665068911'), userType: 'SUPER_ADMIN' } })

  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })
  const restrictedPhone = `18${String(stamp).slice(-9)}`
  const restrictedRole = await prisma.role.create({ data: {
    name: `${prefix}-OWN`, app: 'admin', dataScope: 'OWN', dataScopes: ['OWN'],
    permissions: ['mini.production.shake_clean.view'],
  } })
  const restrictedUser = await prisma.user.create({ data: {
    username: restrictedPhone, phone: restrictedPhone, name: '受限落砂工', passwordHash: hashPassword('123456'), userType: 'EMPLOYEE',
    roles: { create: { roleId: restrictedRole.id } },
  } })
  restrictedCredentials = { username: restrictedPhone, password: '123456' }

  const codes = {
    grade: `${prefix}-GRADE`, product: `${prefix}-ITEM`, workshop: `${prefix}-WS`, line: `${prefix}-LINE`, team: `${prefix}-TEAM`,
    mold: `${prefix}-MOLD`, bom: `${prefix}-BOM`, routing: `${prefix}-RT`, recipe: `${prefix}-REC`, melt: `${prefix}-MELT`,
    ladle: `${prefix}-LADLE`, pouring: `${prefix}-POUR`, shake: `${prefix}-SHAKE`, clean: `${prefix}-CLEAN`,
    unbound: `${prefix}-UNBOUND`, disabled: `${prefix}-DISABLED`, wrong: `${prefix}-WRONG`,
  }
  await prisma.materialGrade.create({ data: { code: codes.grade, name: 'HT250测试材质', category: '灰铁', status: '启用' } })
  await prisma.product.create({ data: { code: codes.product, name: '测试泵体毛坯', type: '半成品', unit: '件', materialGradeCode: codes.grade } })
  await prisma.workshop.create({ data: { code: codes.workshop, name: '测试清理车间', type: '清理', status: '启用' } })
  await prisma.productionLine.create({ data: { code: codes.line, name: '测试造型线', workshopCode: codes.workshop, status: '启用' } })
  await prisma.team.create({ data: { code: codes.team, name: '测试清理班', workshopCode: codes.workshop, leaderUserId: admin.id, status: '启用' } })
  await prisma.furnace.createMany({ data: [
    { code: codes.melt, name: '测试中频炉', equipmentType: '熔炼炉', workshopCode: codes.workshop, status: '启用' },
    { code: codes.ladle, name: '测试浇注包', equipmentType: '浇注包', workshopCode: codes.workshop, status: '启用' },
    { code: codes.pouring, name: '测试浇注工位', equipmentType: '浇注', workshopCode: codes.workshop, status: '启用' },
    { code: codes.shake, name: '测试落砂机', equipmentType: '落砂', workshopCode: codes.workshop, status: '启用' },
    { code: codes.clean, name: '测试抛丸机', equipmentType: '抛丸', workshopCode: codes.workshop, status: '启用' },
    { code: codes.unbound, name: '未绑定落砂机', equipmentType: '落砂', workshopCode: codes.workshop, status: '启用' },
    { code: codes.disabled, name: '停用落砂机', equipmentType: '落砂', workshopCode: codes.workshop, status: '停用' },
    { code: codes.wrong, name: '错误类型设备', equipmentType: '熔炼炉', workshopCode: codes.workshop, status: '启用' },
  ] })
  await prisma.meltRecipe.create({ data: { code: codes.recipe, name: '测试熔炼配方', materialGradeCode: codes.grade, version: 'V1.0', status: 'ACTIVE' } })
  await prisma.moldMaster.create({ data: { code: codes.mold, name: '测试泵体模具', itemCode: codes.product, cavityCount: 2, status: '启用' } })
  const bom = await prisma.castingBom.create({ data: { code: codes.bom, productCode: codes.product } })
  const bomVersion = await prisma.castingBomVersion.create({ data: {
    bomId: bom.id, version: 'V1.0', materialGradeCode: codes.grade, productNameSnapshot: '测试泵体毛坯',
    netWeightKg: 10, grossWeightKg: 12, yieldRate: 83.33, returnWeightKg: 2, status: 'ACTIVE', createdByUserId: admin.id,
  } })
  await prisma.operationMaster.createMany({ data: [
    { code: 'OP-MOLD', name: '造型下芯', section: '造型', reportMode: 'BATCH', status: 'ENABLED' },
    { code: 'OP-POUR', name: '合型浇注', section: '浇注', reportMode: 'BATCH', status: 'ENABLED' },
    { code: 'OP-SHAKE', name: '落砂清理', section: '清理', reportMode: 'BATCH', status: 'ENABLED' },
    { code: 'OP-INSP', name: '成品终检', section: '质检', reportMode: 'BATCH', status: 'ENABLED' },
    { code: `${prefix}-NEXT`, name: '非终检后续工序', section: '后处理', reportMode: 'BATCH', status: 'ENABLED' },
    { code: `${prefix}-CUSTOM-SHAKE`, name: '自定义清理节点', section: '清理', reportMode: 'BATCH', status: 'ENABLED' },
  ], skipDuplicates: true })
  const routing = await prisma.processRouting.create({ data: { code: codes.routing, name: '测试落砂路线' } })
  const routingVersion = await prisma.processRoutingVersion.create({ data: { routingId: routing.id, version: 'V1.0', status: 'ACTIVE', createdByUserId: admin.id } })
  const [moldNode, pourNode, shakeNode, nextNode] = await Promise.all([
    prisma.processRoutingNode.create({ data: { routingVersionId: routingVersion.id, operationCode: 'OP-MOLD', seqNo: 10, routeType: 'MAIN' } }),
    prisma.processRoutingNode.create({ data: { routingVersionId: routingVersion.id, operationCode: 'OP-POUR', seqNo: 20, routeType: 'MAIN' } }),
    prisma.processRoutingNode.create({ data: { routingVersionId: routingVersion.id, operationCode: 'OP-SHAKE', seqNo: 30, routeType: 'MAIN', coolingDurationMinutes: 120 } }),
    prisma.processRoutingNode.create({ data: { routingVersionId: routingVersion.id, operationCode: 'OP-INSP', seqNo: 40, routeType: 'MAIN' } }),
  ])
  await prisma.processRoutingEdge.createMany({ data: [
    { routingVersionId: routingVersion.id, sourceNodeId: moldNode.id, targetNodeId: pourNode.id },
    { routingVersionId: routingVersion.id, sourceNodeId: pourNode.id, targetNodeId: shakeNode.id },
    { routingVersionId: routingVersion.id, sourceNodeId: shakeNode.id, targetNodeId: nextNode.id },
  ] })
  await prisma.routingNodeEquipment.createMany({ data: [
    { routingNodeId: shakeNode.id, equipmentCode: codes.shake },
    { routingNodeId: shakeNode.id, equipmentCode: codes.clean },
    { routingNodeId: shakeNode.id, equipmentCode: codes.disabled },
    { routingNodeId: shakeNode.id, equipmentCode: codes.wrong },
  ] })
  const defects = [
    ['SHAKE-CRACK', '粗开裂', '落砂缺陷'], ['SHAKE-DAMAGE', '严重损坏', '落砂缺陷'],
    ['CLEAN-STICKING', '粘砂', '清理缺陷'], ['CLEAN-POROSITY', '气孔', '清理缺陷'],
    ['CLEAN-OVERCUT', '切割过深', '清理缺陷'], ['CLEAN-SANDHOLE', '砂眼', '清理缺陷'],
  ]
  for (const [code, name, category] of defects) {
    await prisma.defectCode.create({ data: { code, name, category, status: '启用', operations: { create: { operationCode: 'OP-SHAKE' } } } })
  }
  const foreignDefect = await prisma.defectCode.create({ data: { code: `${prefix}-FOREIGN-DEFECT`, name: '非落砂缺陷', category: '其他', status: '启用' } })
  const customNodeDefect = await prisma.defectCode.create({ data: {
    code: `${prefix}-CUSTOM-DEFECT`, name: '仅绑定自定义清理节点缺陷', category: '其他', status: '启用',
    operations: { create: { operationCode: `${prefix}-CUSTOM-SHAKE` } },
  } })
  const workOrder = await prisma.workOrder.create({ data: {
    code: `${prefix}-WO`, productCode: codes.product, productCodeSnapshot: codes.product, productNameSnapshot: '测试泵体毛坯',
    bomVersionId: bomVersion.id, bomCodeSnapshot: codes.bom, bomVersionSnapshot: 'V1.0', routingVersionId: routingVersion.id,
    routingCodeSnapshot: codes.routing, routingNameSnapshot: '测试落砂路线', routingVersionSnapshot: 'V1.0',
    materialGradeCode: codes.grade, materialGradeNameSnapshot: 'HT250测试材质', plannedQuantity: 6,
    plannedDeliveryDate: new Date('2026-08-31T00:00:00Z'), unitNetWeightKg: 10, unitGrossWeightKg: 12,
    yieldRate: 83.33, unitReturnWeightKg: 2, totalNetWeightKg: 60, totalMeltWeightKg: 72, expectedReturnWeightKg: 12,
    productionStatus: 'IN_PRODUCTION', createdByUserId: admin.id,
  } })
  const moldingTask = await prisma.moldingTask.create({ data: {
    code: `${prefix}-MOLDING`, workOrderId: workOrder.id, bomVersionId: bomVersion.id, routingVersionId: routingVersion.id,
    routingNodeId: moldNode.id, moldCode: codes.mold, productionLineCode: codes.line,
    workOrderCodeSnapshot: workOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: '测试泵体毛坯',
    bomCodeSnapshot: codes.bom, bomVersionSnapshot: 'V1.0', routingCodeSnapshot: codes.routing,
    routingNameSnapshot: '测试落砂路线', routingVersionSnapshot: 'V1.0', operationCodeSnapshot: 'OP-MOLD',
    operationNameSnapshot: '造型下芯', moldNameSnapshot: '测试泵体模具', cavityCountSnapshot: 2,
    productionLineNameSnapshot: '测试造型线', workshopCodeSnapshot: codes.workshop, workshopNameSnapshot: '测试清理车间',
    planPieceQty: 6, planBoxQty: 3, completedGoodQty: 3, status: 'IN_PROGRESS', createdByUserId: admin.id,
  } })
  const heatOrder = await prisma.heatOrder.create({ data: {
    code: `${prefix}-HEAT`, materialGradeCode: codes.grade, materialGradeNameSnapshot: 'HT250测试材质', furnaceCode: codes.melt,
    furnaceNameSnapshot: '测试中频炉', furnaceCapacityKgSnapshot: 1000, recipeCode: codes.recipe,
    recipeNameSnapshot: '测试熔炼配方', recipeVersionSnapshot: 'V1.0', teamCode: codes.team, teamNameSnapshot: '测试清理班',
    plannedOutputAt: new Date(), targetWeightKg: 1000, status: 'COMPLETED', createdByUserId: admin.id,
  } })
  const transfer = await prisma.heatOrderTransfer.create({ data: {
    heatOrderId: heatOrder.id, transferDeviceCode: codes.ladle, transferDeviceNameSnapshot: '测试浇注包',
    equipmentTypeSnapshot: '浇注包', weightKg: 1000, operatorUserId: admin.id, operatorNameSnapshot: admin.name,
  } })
  const pouringReports = []
  const shakeBatches = []
  for (const [index, goodQty] of [1, 2].entries()) {
    const reportedAt = new Date(Date.now() - (30 - index * 5) * 60_000)
    const moldingReport = await prisma.moldingReport.create({ data: {
      taskId: moldingTask.id, reportCode: `${prefix}-MR-${index + 1}`, requestId: `${prefix}-MR-REQ-${index + 1}`,
      goodQty, operatorUserId: admin.id, operatorNameSnapshot: admin.name, reportedAt,
    } })
    await prisma.pouringMoldBatch.create({ data: {
      code: `${prefix}-PMB-${index + 1}`, sourceMoldingReportId: moldingReport.id, moldingTaskId: moldingTask.id,
      workOrderId: workOrder.id, routingVersionId: routingVersion.id, pouringRoutingNodeId: pourNode.id,
      workOrderCodeSnapshot: workOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: '测试泵体毛坯',
      moldCodeSnapshot: codes.mold, moldNameSnapshot: '测试泵体模具', moldingOperationCodeSnapshot: 'OP-MOLD',
      moldingOperationNameSnapshot: '造型下芯', pouringOperationCodeSnapshot: 'OP-POUR', pouringOperationNameSnapshot: '合型浇注',
      originalQuantity: goodQty, remainingQuantity: 0, closingTime: reportedAt, status: 'CONSUMED',
    } })
    const pouringReport = await prisma.pouringReport.create({ data: {
      code: `${prefix}-PR-${index + 1}`, requestId: `${prefix}-PR-REQ-${index + 1}`, heatOrderTransferId: transfer.id,
      moldingTaskId: moldingTask.id, workOrderId: workOrder.id, pouringRoutingNodeId: pourNode.id, stationEquipmentCode: codes.pouring,
      heatOrderCodeSnapshot: heatOrder.code, transferDeviceCodeSnapshot: codes.ladle, transferDeviceNameSnapshot: '测试浇注包',
      stationEquipmentNameSnapshot: '测试浇注工位', workOrderCodeSnapshot: workOrder.code, productCodeSnapshot: codes.product,
      productNameSnapshot: '测试泵体毛坯', pouringOperationCodeSnapshot: 'OP-POUR', pouringOperationNameSnapshot: '合型浇注',
      goodQty, theoreticalWeightKg: goodQty * 12, actualWeightKg: goodQty * 12, transferBalanceBeforeKg: 1000,
      transferBalanceAfterKg: 1000 - goodQty * 12, holdMinutesSnapshot: 10, holdLevelSnapshot: 'NORMAL',
      operatorUserId: admin.id, operatorNameSnapshot: admin.name, reportedAt, shakeQueueResolution: 'CREATED',
    } })
    pouringReports.push(pouringReport)
    shakeBatches.push(await prisma.shakeBatch.create({ data: {
      code: `${prefix}-SB-${index + 1}`, sourcePouringReportId: pouringReport.id, moldingTaskId: moldingTask.id,
      workOrderId: workOrder.id, routingVersionId: routingVersion.id, shakeRoutingNodeId: shakeNode.id,
      workOrderCodeSnapshot: workOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: '测试泵体毛坯',
      shakeOperationCodeSnapshot: 'OP-SHAKE', shakeOperationNameSnapshot: '落砂清理', originalQuantity: goodQty * 2,
      remainingQuantity: goodQty * 2, pouredAt: reportedAt, coolingDurationMinutesSnapshot: 120,
    } }))
  }
  fixture = { admin, restrictedUser, restrictedRole, codes, workOrder, moldingTask, routingVersion, shakeNode, nextNode, shakeBatches, foreignDefect, customNodeDefect }

  async function createAdditionalTask(suffix, pouredMinutesAgo, quantity, createdByUserId, createBatch = true) {
    const extraWorkOrder = await prisma.workOrder.create({ data: {
      code: `${prefix}-WO-${suffix}`, productCode: codes.product, productCodeSnapshot: codes.product, productNameSnapshot: `测试泵体毛坯-${suffix}`,
      bomVersionId: bomVersion.id, bomCodeSnapshot: codes.bom, bomVersionSnapshot: 'V1.0', routingVersionId: routingVersion.id,
      routingCodeSnapshot: codes.routing, routingNameSnapshot: '测试落砂路线', routingVersionSnapshot: 'V1.0',
      materialGradeCode: codes.grade, materialGradeNameSnapshot: 'HT250测试材质', plannedQuantity: quantity,
      plannedDeliveryDate: new Date('2026-08-31T00:00:00Z'), unitNetWeightKg: 10, unitGrossWeightKg: 12,
      yieldRate: 83.33, unitReturnWeightKg: 2, totalNetWeightKg: quantity * 10, totalMeltWeightKg: quantity * 12,
      expectedReturnWeightKg: quantity * 2, productionStatus: 'IN_PRODUCTION', createdByUserId,
    } })
    const task = await prisma.moldingTask.create({ data: {
      code: `${prefix}-MOLDING-${suffix}`, workOrderId: extraWorkOrder.id, bomVersionId: bomVersion.id, routingVersionId: routingVersion.id,
      routingNodeId: moldNode.id, moldCode: codes.mold, productionLineCode: codes.line,
      workOrderCodeSnapshot: extraWorkOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: `测试泵体毛坯-${suffix}`,
      bomCodeSnapshot: codes.bom, bomVersionSnapshot: 'V1.0', routingCodeSnapshot: codes.routing,
      routingNameSnapshot: '测试落砂路线', routingVersionSnapshot: 'V1.0', operationCodeSnapshot: 'OP-MOLD',
      operationNameSnapshot: '造型下芯', moldNameSnapshot: '测试泵体模具', cavityCountSnapshot: 1,
      productionLineNameSnapshot: '测试造型线', workshopCodeSnapshot: codes.workshop, workshopNameSnapshot: '测试清理车间',
      planPieceQty: quantity, planBoxQty: quantity, completedGoodQty: quantity, status: 'IN_PROGRESS', createdByUserId,
    } })
    const pouredAt = new Date(Date.now() - pouredMinutesAgo * 60_000)
    const moldingReport = await prisma.moldingReport.create({ data: {
      taskId: task.id, reportCode: `${prefix}-MR-${suffix}`, requestId: `${prefix}-MR-REQ-${suffix}`,
      goodQty: quantity, operatorUserId: admin.id, operatorNameSnapshot: admin.name, reportedAt: pouredAt,
    } })
    await prisma.pouringMoldBatch.create({ data: {
      code: `${prefix}-PMB-${suffix}`, sourceMoldingReportId: moldingReport.id, moldingTaskId: task.id,
      workOrderId: extraWorkOrder.id, routingVersionId: routingVersion.id, pouringRoutingNodeId: pourNode.id,
      workOrderCodeSnapshot: extraWorkOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: `测试泵体毛坯-${suffix}`,
      moldCodeSnapshot: codes.mold, moldNameSnapshot: '测试泵体模具', moldingOperationCodeSnapshot: 'OP-MOLD',
      moldingOperationNameSnapshot: '造型下芯', pouringOperationCodeSnapshot: 'OP-POUR', pouringOperationNameSnapshot: '合型浇注',
      originalQuantity: quantity, remainingQuantity: 0, closingTime: pouredAt, status: 'CONSUMED',
    } })
    const pouringReport = await prisma.pouringReport.create({ data: {
      code: `${prefix}-PR-${suffix}`, requestId: `${prefix}-PR-REQ-${suffix}`, heatOrderTransferId: transfer.id,
      moldingTaskId: task.id, workOrderId: extraWorkOrder.id, pouringRoutingNodeId: pourNode.id, stationEquipmentCode: codes.pouring,
      heatOrderCodeSnapshot: heatOrder.code, transferDeviceCodeSnapshot: codes.ladle, transferDeviceNameSnapshot: '测试浇注包',
      stationEquipmentNameSnapshot: '测试浇注工位', workOrderCodeSnapshot: extraWorkOrder.code, productCodeSnapshot: codes.product,
      productNameSnapshot: `测试泵体毛坯-${suffix}`, pouringOperationCodeSnapshot: 'OP-POUR', pouringOperationNameSnapshot: '合型浇注',
      goodQty: quantity, theoreticalWeightKg: quantity * 12, actualWeightKg: quantity * 12, transferBalanceBeforeKg: 1000,
      transferBalanceAfterKg: 1000 - quantity * 12, holdMinutesSnapshot: 10, holdLevelSnapshot: 'NORMAL',
      operatorUserId: admin.id, operatorNameSnapshot: admin.name, reportedAt: pouredAt,
      shakeQueueResolution: createBatch ? 'CREATED' : 'PENDING',
    } })
    const shakeBatch = createBatch ? await prisma.shakeBatch.create({ data: {
      code: `${prefix}-SB-${suffix}`, sourcePouringReportId: pouringReport.id, moldingTaskId: task.id,
      workOrderId: extraWorkOrder.id, routingVersionId: routingVersion.id, shakeRoutingNodeId: shakeNode.id,
      workOrderCodeSnapshot: extraWorkOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: `测试泵体毛坯-${suffix}`,
      shakeOperationCodeSnapshot: 'OP-SHAKE', shakeOperationNameSnapshot: '落砂清理', originalQuantity: quantity,
      remainingQuantity: quantity, pouredAt, coolingDurationMinutesSnapshot: 0,
    } }) : null
    return { workOrder: extraWorkOrder, task, pouringReport, shakeBatch, pouredAt }
  }

  const sortedTask = await createAdditionalTask('SORT', 10, 1, admin.id)
  const miniTask = await createAdditionalTask('MINI', 5, 4, restrictedUser.id)
  await prisma.businessDataOwnership.create({ data: {
    entityType: 'production:molding_tasks', entityId: miniTask.task.id,
    createdByUserId: restrictedUser.id, ownerUserId: restrictedUser.id,
  } })
  fixture.sortedTask = sortedTask
  fixture.miniTask = miniTask

  const bulkBackfillTask = await createAdditionalTask('BULK-BACKFILL', 60, 1, admin.id, false)
  const bulkReportedAt = new Date(Date.now() - 60 * 60_000)
  await prisma.pouringReport.createMany({ data: Array.from({ length: 1000 }, (_, index) => ({
    code: `${prefix}-PR-BULK-${String(index).padStart(4, '0')}`,
    requestId: `${prefix}-PR-REQ-BULK-${String(index).padStart(4, '0')}`,
    heatOrderTransferId: transfer.id, moldingTaskId: bulkBackfillTask.task.id, workOrderId: bulkBackfillTask.workOrder.id,
    pouringRoutingNodeId: pourNode.id, stationEquipmentCode: codes.pouring, heatOrderCodeSnapshot: heatOrder.code,
    transferDeviceCodeSnapshot: codes.ladle, transferDeviceNameSnapshot: '测试浇注包', stationEquipmentNameSnapshot: '测试浇注工位',
    workOrderCodeSnapshot: bulkBackfillTask.workOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: '批量补建测试',
    pouringOperationCodeSnapshot: 'OP-POUR', pouringOperationNameSnapshot: '合型浇注', goodQty: 1,
    theoreticalWeightKg: 12, actualWeightKg: 12, transferBalanceBeforeKg: 1000, transferBalanceAfterKg: 988,
    holdMinutesSnapshot: 10, holdLevelSnapshot: 'NORMAL', operatorUserId: admin.id, operatorNameSnapshot: admin.name,
    reportedAt: new Date(bulkReportedAt.getTime() + index),
  })) })
  const firstBackfillPage = await prisma.$transaction(
    (tx) => backfillShakeBatches(tx, { moldingTaskIds: [bulkBackfillTask.task.id], limit: 100 }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  assert.equal(firstBackfillPage.created, 100)
  await assert.rejects(
    () => prisma.$transaction(async (tx) => {
      await backfillShakeBatches(tx, { moldingTaskIds: [bulkBackfillTask.task.id], limit: 100 })
      throw new Error('模拟补建中途失败')
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    /模拟补建中途失败/,
  )
  assert.equal(await prisma.shakeBatch.count({ where: { moldingTaskId: bulkBackfillTask.task.id } }), 100, '失败页必须整体回滚，已提交页必须保留')
  const backfillCommand = spawnSync(process.execPath, ['scripts/backfill-shake-batches.mjs'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl, BACKFILL_SHAKE_BATCH_SIZE: '100', BACKFILL_SHAKE_MOLDING_TASK_IDS: bulkBackfillTask.task.id }, encoding: 'utf8',
  })
  assert.equal(backfillCommand.status, 0, backfillCommand.stderr || backfillCommand.stdout)
  assert.equal(await prisma.shakeBatch.count({ where: { moldingTaskId: bulkBackfillTask.task.id } }), 1001, '超过 1000 条历史浇注必须全部补建')
  assert.equal(await prisma.pouringReport.count({ where: { moldingTaskId: bulkBackfillTask.task.id, shakeQueueResolution: 'CREATED' } }), 1001, '有可达落砂节点的历史浇注必须全部解析为 CREATED')
  assert.equal(await prisma.pouringReport.count({ where: { moldingTaskId: bulkBackfillTask.task.id, shakeQueueResolution: 'PENDING' } }), 0, '历史补建完成后不得遗留待解析缺口')
  const backfillRerun = spawnSync(process.execPath, ['scripts/backfill-shake-batches.mjs'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl, BACKFILL_SHAKE_MOLDING_TASK_IDS: bulkBackfillTask.task.id }, encoding: 'utf8',
  })
  assert.equal(backfillRerun.status, 0, backfillRerun.stderr || backfillRerun.stdout)
  assert.match(backfillRerun.stdout, /"created":0/, '补建命令重跑应保持幂等')
  await prisma.shakeBatch.updateMany({ where: { moldingTaskId: bulkBackfillTask.task.id }, data: { status: 'CANCELED' } })

  const repairResolutionTask = await createAdditionalTask('REPAIR-RESOLUTION', 55, 1, admin.id)
  await prisma.pouringReport.update({ where: { id: repairResolutionTask.pouringReport.id }, data: { shakeQueueResolution: 'PENDING' } })
  const repairResult = await prisma.$transaction(
    (tx) => backfillShakeBatches(tx, { moldingTaskIds: [repairResolutionTask.task.id], limit: 100 }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  assert.deepEqual({ processed: repairResult.processed, created: repairResult.created }, { processed: 1, created: 0 }, '已有批次的历史记录只修复解析状态，不重复建批次')
  assert.equal((await prisma.pouringReport.findUniqueOrThrow({ where: { id: repairResolutionTask.pouringReport.id } })).shakeQueueResolution, 'CREATED')
  const repairRerun = await prisma.$transaction(
    (tx) => backfillShakeBatches(tx, { moldingTaskIds: [repairResolutionTask.task.id], limit: 100 }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  assert.equal(repairRerun.processed, 0, 'CREATED 记录重跑不得重复解析')
  await prisma.shakeBatch.update({ where: { id: repairResolutionTask.shakeBatch.id }, data: { status: 'CANCELED' } })

  const noShakeNodeTask = await createAdditionalTask('NO-SHAKE-NODE', 50, 1, admin.id, false)
  await prisma.pouringReport.update({ where: { id: noShakeNodeTask.pouringReport.id }, data: { pouringRoutingNodeId: shakeNode.id } })
  const noNodeResult = await prisma.$transaction(
    (tx) => backfillShakeBatches(tx, { moldingTaskIds: [noShakeNodeTask.task.id], limit: 100 }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  assert.deepEqual({ processed: noNodeResult.processed, created: noNodeResult.created }, { processed: 1, created: 0 }, '无可达落砂节点的历史浇注应被解析但不建批次')
  assert.equal((await prisma.pouringReport.findUniqueOrThrow({ where: { id: noShakeNodeTask.pouringReport.id } })).shakeQueueResolution, 'NOT_APPLICABLE')
  const noNodeRerun = await prisma.$transaction(
    (tx) => backfillShakeBatches(tx, { moldingTaskIds: [noShakeNodeTask.task.id], limit: 100 }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  assert.equal(noNodeRerun.processed, 0, 'NOT_APPLICABLE 记录重跑不得重复解析')
  fixture.noShakeNodeTask = noShakeNodeTask

  const port = await freePort()
  baseUrl = `http://127.0.0.1:${port}/api`
  apiProcess = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  apiProcess.stdout.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.stderr.on('data', (chunk) => { apiOutput += String(chunk) })
  apiProcess.on('error', (error) => { apiError = error })
  await waitForApi()

  const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '13665068911' }) })
  const headers = { authorization: `Bearer ${login.token}` }
  const initialDictionaries = await request('/admin/dictionaries', { headers })
  const fullEquipmentTypes = ['熔炼炉', '浇注包', '球化包', '烘干设备', '落砂', '清理', '抛丸', '打磨', '切割', '其他设备']
  assert.deepEqual(initialDictionaries.equipmentTypes, fullEquipmentTypes, '空字典读取应提供完整默认设备类型')
  const initialEquipmentSeed = spawnSync(process.execPath, ['scripts/seed-shake-clean-equipment-types.mjs'], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' })
  assert.equal(initialEquipmentSeed.status, 0, initialEquipmentSeed.stderr || initialEquipmentSeed.stdout)
  assert.deepEqual((await prisma.dictionarySetting.findUniqueOrThrow({ where: { key: 'equipmentTypes' } })).values, fullEquipmentTypes, '新库初始化必须持久化完整默认设备类型')
  await request('/admin/dictionaries', { method: 'PUT', headers, body: JSON.stringify({ equipmentTypes: ['自定义设备', '熔炼炉'] }) })
  const equipmentSeed = spawnSync(process.execPath, ['scripts/seed-shake-clean-equipment-types.mjs'], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' })
  assert.equal(equipmentSeed.status, 0, equipmentSeed.stderr || equipmentSeed.stdout)
  assert.deepEqual(
    (await request('/admin/dictionaries', { headers })).equipmentTypes,
    ['自定义设备', '熔炼炉', '落砂', '清理', '抛丸', '打磨', '切割'],
    '已有字典只追加落砂清理五类，必须保留自定义项且不恢复用户删除的其他默认项',
  )
  await request('/admin/dictionaries', { method: 'PUT', headers, body: JSON.stringify({ equipmentTypes: ['自定义设备', '熔炼炉'] }) })
  assert.deepEqual((await request('/admin/dictionaries', { headers })).equipmentTypes, ['自定义设备', '熔炼炉'], '显式初始化后再次删除也不得在普通读取时复现')
  const noNodeOptions = await request(`/admin/production/shake-clean-tasks/${fixture.noShakeNodeTask.task.id}/options`, { headers }, 404)
  assert.doesNotMatch(String(noNodeOptions.message), /历史待落砂批次尚未补建/, 'NOT_APPLICABLE 不应被误判为历史补建缺口')
  const noNodeReport = await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
    moldingTaskId: fixture.noShakeNodeTask.task.id, requestId: `${prefix}-NO-NODE-REPORT`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 1, scrapQty: 0, batchVersions: [], confirmedEarlyShake: true,
  }) }, 400)
  assert.doesNotMatch(String(noNodeReport.message), /历史待落砂批次尚未补建/, '无可达节点的报工应返回无待落砂批次，而非补建缺口')
  const taskPage = await request('/admin/production/shake-clean-tasks', { headers })
  assert.equal(taskPage.page, 1)
  assert.equal(taskPage.pageSize, 20)
  assert.equal(taskPage.total, 3)
  const tasks = taskPage.records
  assert.equal(tasks.length, 3)
  assert.deepEqual(tasks.map((item) => item.id), [fixture.moldingTask.id, fixture.sortedTask.task.id, fixture.miniTask.task.id], '任务应按最早有效浇注时间升序')
  assert.equal(new Date(tasks[0].earliestPouredAt).getTime(), fixture.shakeBatches[0].pouredAt.getTime())
  assert.equal(new Date(tasks[1].earliestPouredAt).getTime(), fixture.sortedTask.pouredAt.getTime())
  assert.equal(tasks[0].shakeOriginal, 6, '3 箱 × 2 穴应生成 6 件待落砂')
  assert.equal(tasks.find((item) => item.id === fixture.moldingTask.id).blankOutputQuantity, 0, '未清理前合格毛坯应为 0')
  assert.equal(tasks.find((item) => item.id === fixture.moldingTask.id).cooling.earlyShake, true, '最早待落砂批次应返回冷却未到期')
  assert.equal(typeof tasks.find((item) => item.id === fixture.moldingTask.id).cooling.remainingCoolingMinutes, 'number')
  assert.equal(tasks.find((item) => item.id === fixture.sortedTask.task.id).cooling.earlyShake, false, '无冷却要求的批次应返回绿色可落砂状态')
  assert.equal(tasks[0].executionStatus, 'WAITING_SHAKE')
  const cursorFirst = await request('/admin/production/shake-clean-tasks?page=1&pageSize=1', { headers })
  assert.equal(cursorFirst.total, 3, 'cursor 首页 total 应为 cursor 前总数')
  assert.equal(typeof cursorFirst.nextCursor, 'string')
  const cursorFirstId = cursorFirst.records[0].id
  const cursorFirstBatch = fixture.shakeBatches.find((item) => item.moldingTaskId === cursorFirstId) || fixture.shakeBatches[0]
  await prisma.shakeBatch.update({ where: { id: cursorFirstBatch.id }, data: { remainingQuantity: 0, status: 'CONSUMED' } })
  const cursorSecond = await request(`/admin/production/shake-clean-tasks?cursor=${encodeURIComponent(cursorFirst.nextCursor)}&pageSize=1`, { headers })
  assert.equal(cursorSecond.total, 3, 'cursor 后续页 total 仍应为 cursor 前总数')
  assert.equal(cursorSecond.records.some((item) => item.id === cursorFirstId), false, '消耗首批后第二页不得重复返回首条任务')
  await prisma.shakeBatch.update({ where: { id: cursorFirstBatch.id }, data: { remainingQuantity: cursorFirstBatch.remainingQuantity, status: cursorFirstBatch.status } })
  await request('/admin/production/shake-clean-tasks?cursor=not-a-valid-cursor&pageSize=1', { headers }, 400)

  const tiedTime = new Date(Date.now() - 7 * 60_000)
  const sortedOriginalTime = fixture.sortedTask.shakeBatch.pouredAt
  const miniOriginalTime = fixture.miniTask.shakeBatch.pouredAt
  await prisma.shakeBatch.updateMany({ where: { id: { in: [fixture.sortedTask.shakeBatch.id, fixture.miniTask.shakeBatch.id] } }, data: { pouredAt: tiedTime } })
  const tiedFirst = await request('/admin/production/shake-clean-tasks?page=1&pageSize=2', { headers })
  const tiedSecond = await request(`/admin/production/shake-clean-tasks?cursor=${encodeURIComponent(tiedFirst.nextCursor)}&pageSize=2`, { headers })
  const tiedIds = [...tiedFirst.records, ...tiedSecond.records].map((item) => item.id)
  assert.equal(new Set(tiedIds).size, tiedIds.length, '相同稳定排序时间分页不得重复')
  assert.equal(tiedFirst.total, 3)
  assert.equal(tiedSecond.total, 3)
  const tiedCreated = await prisma.moldingTask.findMany({ where: { id: { in: [fixture.sortedTask.task.id, fixture.miniTask.task.id] } }, select: { id: true, createdAt: true } })
  const expectedTiedIds = tiedCreated.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)).map((item) => item.id)
  const actualTiedIds = tiedIds.filter((id) => expectedTiedIds.includes(id))
  assert.deepEqual(actualTiedIds, expectedTiedIds, '相同 stableSortAt 应按 createdAt/id 排序')
  await prisma.shakeBatch.update({ where: { id: fixture.sortedTask.shakeBatch.id }, data: { pouredAt: sortedOriginalTime } })
  await prisma.shakeBatch.update({ where: { id: fixture.miniTask.shakeBatch.id }, data: { pouredAt: miniOriginalTime } })
  const secondPage = await request('/admin/production/shake-clean-tasks?page=2&pageSize=1', { headers })
  assert.equal(secondPage.page, 2)
  assert.equal(secondPage.pageSize, 1)
  assert.equal(secondPage.total, 3)
  assert.deepEqual(secondPage.records.map((item) => item.id), [fixture.sortedTask.task.id], '服务端分页应保持最早浇注升序')
  const waitingShakePage = await request('/admin/production/shake-clean-tasks?status=WAITING_SHAKE&page=1&pageSize=20', { headers })
  assert.equal(waitingShakePage.records.every((item) => item.executionStatus === 'WAITING_SHAKE'), true, '状态筛选应在服务端生效')
  const options = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/options`, { headers })
  assert.deepEqual(options.shakeBatchVersions.map((item) => item.id), fixture.shakeBatches.map((item) => item.id), '待落砂批次应按浇注时间 FIFO')
  assert.deepEqual(options.shakeEquipment.map((item) => item.code), [fixture.codes.shake])
  assert.deepEqual(options.cleaningEquipment.map((item) => item.code), [fixture.codes.clean])
  await prisma.processRoutingNode.update({ where: { id: fixture.shakeNode.id }, data: { operationCode: `${prefix}-CUSTOM-SHAKE` } })
  const strictDefectOptions = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/defect-options`, { headers })
  assert.equal(strictDefectOptions.some((item) => item.code === fixture.customNodeDefect.code), false, '缺陷选项只能来自 OP-SHAKE')
  const check = await request('/admin/production/shake-clean/shake/check', { method: 'POST', headers, body: JSON.stringify({ moldingTaskId: fixture.moldingTask.id, quantity: 3 }) })
  assert.equal(check.code, 'EARLY_SHAKE')
  assert.equal(check.allocations.length, 2, '落砂检查应跨两批 FIFO 分配')

  const shakeBody = {
    moldingTaskId: fixture.moldingTask.id, requestId: `${prefix}-SHAKE-REQ-1`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 2, scrapQty: 1, batchVersions: options.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
    defects: [{ defectCode: 'SHAKE-CRACK', quantity: 1 }],
  }
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify(shakeBody) }, 409)
  await request('/admin/production/shake-clean/shake/check', { method: 'POST', headers, body: JSON.stringify({ moldingTaskId: fixture.moldingTask.id, quantity: 999 }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, stationEquipmentCode: fixture.codes.unbound, confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, stationEquipmentCode: fixture.codes.disabled, confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, stationEquipmentCode: fixture.codes.wrong, confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, requestId: `${prefix}-ZERO-SCRAP-WITH-DEFECT`, scrapQty: 0, defects: [{ defectCode: 'SHAKE-CRACK', quantity: 1 }], confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, defects: [], confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, defects: [{ defectCode: 'SHAKE-CRACK', quantity: 2 }], confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, defects: [{ defectCode: fixture.foreignDefect.code, quantity: 1 }], confirmedEarlyShake: true }) }, 400)
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, requestId: `${prefix}-CUSTOM-DEFECT-REQ`, defects: [{ defectCode: fixture.customNodeDefect.code, quantity: 1 }], confirmedEarlyShake: true }) }, 400)
  await prisma.processRoutingNode.update({ where: { id: fixture.shakeNode.id }, data: { operationCode: 'OP-SHAKE' } })
  const shakeReport1 = await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, confirmedEarlyShake: true }) })
  assert.equal(shakeReport1.earlyShake, true)
  assert.equal(shakeReport1.consumptions.length, 2)
  const pendingAfterFirstShake = (await request('/admin/production/shake-clean-tasks', { headers })).records.find((item) => item.id === fixture.moldingTask.id)
  assert.equal(new Date(pendingAfterFirstShake.earliestPouredAt).getTime(), fixture.shakeBatches[1].pouredAt.getTime(), '已消耗旧批次后，最早浇注只应来自仍待落砂的新批次')
  const shakeRetry = await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, confirmedEarlyShake: true }) })
  assert.equal(shakeRetry.id, shakeReport1.id, '同 requestId 应幂等返回原报工')
  assert.equal(await prisma.shakeReport.count({ where: { moldingTaskId: fixture.moldingTask.id, requestId: shakeBody.requestId } }), 1)

  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({ ...shakeBody, requestId: `${prefix}-STALE`, goodQty: 3, scrapQty: 0, defects: [], confirmedEarlyShake: true }) }, 409)
  const options2 = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/options`, { headers })
  const shakeReport2 = await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
    moldingTaskId: fixture.moldingTask.id, requestId: `${prefix}-SHAKE-REQ-2`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 3, scrapQty: 0, batchVersions: options2.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), confirmedEarlyShake: true,
  }) })
  const cleanOptions = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/options`, { headers })
  assert.equal(cleanOptions.cleaningRemaining, 5)
  await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify({
    moldingTaskId: fixture.moldingTask.id, requestId: `${prefix}-CLEAN-ZERO-SCRAP-WITH-DEFECT`, stationEquipmentCode: fixture.codes.clean,
    goodQty: 1, scrapQty: 0, batchVersions: cleanOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), defects: [{ defectCode: 'CLEAN-STICKING', quantity: 1 }],
  }) }, 400)
  await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify({
    moldingTaskId: fixture.moldingTask.id, requestId: `${prefix}-CLEAN-WRONG`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 1, scrapQty: 0, batchVersions: cleanOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) }, 400)
  const cleaningBody = {
    moldingTaskId: fixture.moldingTask.id, requestId: `${prefix}-CLEAN-REQ-1`, stationEquipmentCode: fixture.codes.clean,
    goodQty: 3, scrapQty: 1, riseringScrapWeightKg: 12.5,
    batchVersions: cleanOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
    defects: [{ defectCode: 'CLEAN-STICKING', quantity: 1 }],
  }
  const ambiguousEdge = await prisma.processRoutingEdge.create({ data: { routingVersionId: fixture.shakeNode.routingVersionId, sourceNodeId: fixture.shakeNode.id, targetNodeId: fixture.shakeNode.id } })
  await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify(cleaningBody) }, 400)
  await prisma.processRoutingEdge.delete({ where: { id: ambiguousEdge.id } })
  await prisma.processRoutingVersion.update({ where: { id: fixture.routingVersion.id }, data: { status: 'INACTIVE' } })
  const cleaningReport = await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify(cleaningBody) })
  await prisma.processRoutingVersion.update({ where: { id: fixture.routingVersion.id }, data: { status: 'ACTIVE' } })
  assert.equal(cleaningReport.consumptions.length, 2, '清理应跨两批 FIFO 分配')
  assert.equal(cleaningReport.blankOutput.quantity, 3)
  assert.equal(cleaningReport.blankOutput.nextRoutingNodeId, fixture.nextNode.id)
  assert.equal(cleaningReport.blankOutput.status, 'WAITING_NEXT_OPERATION')
  const inspectionBatch = await prisma.inspectionBatch.findUniqueOrThrow({ where: { sourceBlankOutputBatchId: cleaningReport.blankOutput.id } })
  assert.equal(inspectionBatch.sourceReworkReportId, null)
  assert.equal(inspectionBatch.workOrderId, fixture.workOrder.id)
  assert.equal(inspectionBatch.productCode, fixture.codes.product)
  assert.equal(inspectionBatch.routingVersionId, fixture.routingVersion.id)
  assert.equal(inspectionBatch.inspectionRoutingNodeId, fixture.nextNode.id)
  assert.equal(inspectionBatch.workOrderCodeSnapshot, fixture.workOrder.code)
  assert.equal(inspectionBatch.productCodeSnapshot, fixture.codes.product)
  assert.equal(inspectionBatch.productNameSnapshot, '测试泵体毛坯')
  assert.equal(inspectionBatch.routingCodeSnapshot, fixture.codes.routing)
  assert.equal(inspectionBatch.routingNameSnapshot, '测试落砂路线')
  assert.equal(inspectionBatch.routingVersionSnapshot, 'V1.0')
  assert.equal(inspectionBatch.operationCodeSnapshot, 'OP-INSP')
  assert.equal(inspectionBatch.operationNameSnapshot, '成品终检')
  assert.equal(inspectionBatch.originalQuantity, 3)
  assert.equal(inspectionBatch.remainingQuantity, 3)
  assert.equal(inspectionBatch.status, 'WAITING')
  assert.equal(inspectionBatch.availableAt.getTime(), new Date(cleaningReport.blankOutput.createdAt).getTime())
  const queueSource = readFileSync(resolve(apiRoot, 'src/production/final-inspection.queue.ts'), 'utf8')
  assert.match(queueSource, /inspectionBatch\.upsert\(\s*\{\s*where:\s*\{\s*sourceBlankOutputBatchId:\s*blank\.id\s*\}/s, '终检队列必须通过 sourceBlankOutputBatchId 唯一键调用 upsert')
  await prisma.inspectionBatch.delete({ where: { id: inspectionBatch.id } })
  const inspectionCreated = await prisma.$transaction((tx) => ensureInspectionBatchForBlankOutput(tx, cleaningReport.blankOutput.id))
  assert.equal(inspectionCreated?.created, true)
  const inspectionRetry = await prisma.$transaction((tx) => ensureInspectionBatchForBlankOutput(tx, cleaningReport.blankOutput.id))
  assert.deepEqual(inspectionRetry, { id: inspectionCreated.id, created: false })
  assert.equal(await prisma.inspectionBatch.count({ where: { sourceBlankOutputBatchId: cleaningReport.blankOutput.id } }), 1)

  async function createCleaningSortTask(suffix) {
    const extra = await createAdditionalTask(suffix, 90, 1, admin.id)
    const extraOptions = await request(`/admin/production/shake-clean-tasks/${extra.task.id}/options`, { headers })
    await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
      moldingTaskId: extra.task.id, requestId: `${prefix}-${suffix}-SHAKE`, stationEquipmentCode: codes.shake,
      goodQty: 1, scrapQty: 0, batchVersions: extraOptions.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), confirmedEarlyShake: true,
    }) })
    return extra
  }
  const cleanSortA = await createCleaningSortTask('CLEAN-SORT-A')
  const cleanSortB = await createCleaningSortTask('CLEAN-SORT-B')
  const cleanSortC = await createCleaningSortTask('CLEAN-SORT-C')
  const sameAvailableAt = new Date('2026-08-24T08:00:00.000Z')
  await prisma.cleaningBatch.updateMany({ where: { moldingTaskId: { in: [cleanSortA.task.id, cleanSortB.task.id, cleanSortC.task.id] } }, data: { availableAt: sameAvailableAt } })
  await prisma.moldingTask.update({ where: { id: cleanSortA.task.id }, data: { createdAt: new Date('2026-08-24T07:00:00.000Z') } })
  await prisma.moldingTask.update({ where: { id: cleanSortB.task.id }, data: { createdAt: new Date('2026-08-24T08:00:00.000Z') } })
  await prisma.moldingTask.update({ where: { id: cleanSortC.task.id }, data: { createdAt: new Date('2026-08-24T08:00:00.000Z') } })
  const cleanSortPage = await request('/admin/production/shake-clean-tasks?keyword=CLEAN-SORT&pageSize=20', { headers })
  const cleanSortIds = cleanSortPage.records.map((item) => item.id)
  assert.deepEqual(cleanSortIds, [cleanSortA.task.id, ...[cleanSortB.task.id, cleanSortC.task.id].sort()], '无待落砂但有待清理时按 availableAt，再按 createdAt/id 排序')
  assert.equal(cleanSortPage.records.every((item) => item.earliestPouredAt === null), true, '无待落砂时最早浇注字段应保持为空')

  const fallbackA = await createAdditionalTask('FALLBACK-SORT-A', 200, 1, admin.id)
  const fallbackB = await createAdditionalTask('FALLBACK-SORT-B', 190, 1, admin.id)
  await prisma.shakeBatch.updateMany({ where: { moldingTaskId: { in: [fallbackA.task.id, fallbackB.task.id] } }, data: { remainingQuantity: 0, status: 'CONSUMED' } })
  await prisma.moldingTask.update({ where: { id: fallbackA.task.id }, data: { createdAt: new Date('2026-08-24T09:00:00.000Z') } })
  await prisma.moldingTask.update({ where: { id: fallbackB.task.id }, data: { createdAt: new Date('2026-08-24T10:00:00.000Z') } })
  const fallbackPage = await request('/admin/production/shake-clean-tasks?keyword=FALLBACK-SORT&pageSize=20', { headers })
  assert.deepEqual(fallbackPage.records.map((item) => item.id), [fallbackA.task.id, fallbackB.task.id], '无待落砂/待清理时按任务 createdAt 稳定兜底')
  const tasksAfterCleaning = (await request('/admin/production/shake-clean-tasks', { headers })).records
  assert.equal(tasksAfterCleaning.find((item) => item.id === fixture.moldingTask.id).blankOutputQuantity, 3, '列表应直接返回有效毛坯产出数量')
  const cleaningRetry = await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify(cleaningBody) })
  assert.equal(cleaningRetry.id, cleaningReport.id)
  const remainingCleanOptions = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/options`, { headers })
  await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify({
    ...cleaningBody, requestId: `${prefix}-CLEAN-OVER`, goodQty: 999, scrapQty: 0, defects: [],
    batchVersions: remainingCleanOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) }, 400)
  const originalNextEdge = await prisma.processRoutingEdge.findFirstOrThrow({ where: { routingVersionId: fixture.shakeNode.routingVersionId, sourceNodeId: fixture.shakeNode.id, targetNodeId: fixture.nextNode.id } })
  await prisma.processRoutingEdge.delete({ where: { id: originalNextEdge.id } })
  const warehouseReport = await request('/admin/production/shake-clean/cleaning/reports', { method: 'POST', headers, body: JSON.stringify({
    ...cleaningBody, requestId: `${prefix}-CLEAN-REQ-2`, goodQty: 1, scrapQty: 0, defects: [],
    batchVersions: remainingCleanOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) })
  assert.equal(warehouseReport.blankOutput.status, 'WAITING_WAREHOUSE')
  assert.equal(warehouseReport.blankOutput.nextRoutingNodeId, null)
  assert.equal(await prisma.inspectionBatch.count({ where: { sourceBlankOutputBatchId: warehouseReport.blankOutput.id } }), 0, '无后继节点不应生成终检队列')
  await prisma.processRoutingEdge.create({ data: { routingVersionId: fixture.shakeNode.routingVersionId, sourceNodeId: fixture.shakeNode.id, targetNodeId: fixture.nextNode.id } })

  await prisma.processRoutingNode.update({ where: { id: fixture.nextNode.id }, data: { operationCode: `${prefix}-NEXT` } })
  await prisma.blankOutputBatch.update({ where: { id: warehouseReport.blankOutput.id }, data: {
    nextRoutingNodeId: fixture.nextNode.id,
    nextOperationCodeSnapshot: `${prefix}-NEXT`,
    nextOperationNameSnapshot: '非终检后续工序',
    status: 'WAITING_NEXT_OPERATION',
  } })
  assert.equal(await prisma.$transaction((tx) => ensureInspectionBatchForBlankOutput(tx, warehouseReport.blankOutput.id)), null)
  assert.equal(await prisma.inspectionBatch.count({ where: { sourceBlankOutputBatchId: warehouseReport.blankOutput.id } }), 0, '非 OP-INSP 后继不应生成终检队列')
  await prisma.processRoutingNode.update({ where: { id: fixture.nextNode.id }, data: { operationCode: 'OP-INSP' } })
  await prisma.blankOutputBatch.update({ where: { id: warehouseReport.blankOutput.id }, data: {
    nextOperationCodeSnapshot: 'OP-INSP',
    nextOperationNameSnapshot: '成品终检',
    status: 'CANCELED',
  } })
  assert.equal(await prisma.$transaction((tx) => ensureInspectionBatchForBlankOutput(tx, warehouseReport.blankOutput.id)), null)
  assert.equal(await prisma.inspectionBatch.count({ where: { sourceBlankOutputBatchId: warehouseReport.blankOutput.id } }), 0, '已取消毛坯批次不应生成终检队列')

  await prisma.inspectionBatch.delete({ where: { id: inspectionCreated.id } })
  const firstInspectionBackfill = await backfillInspectionBatches(prisma)
  assert.equal(firstInspectionBackfill.created, 1)
  assert.equal(firstInspectionBackfill.processed >= 1, true)
  const secondInspectionBackfill = await backfillInspectionBatches(prisma)
  assert.equal(secondInspectionBackfill.created, 0)
  assert.equal(await prisma.inspectionBatch.count({ where: { sourceBlankOutputBatchId: cleaningReport.blankOutput.id } }), 1, '历史回填重复执行不得重复生成')

  await request(`/admin/production/shake-clean/shake-reports/${shakeReport1.id}/reverse`, { method: 'POST', headers, body: JSON.stringify({ versionNo: shakeReport1.versionNo, reason: '下游未撤销保护测试' }) }, 400)
  const reversedCleaning = await request(`/admin/production/shake-clean/cleaning-reports/${cleaningReport.id}/reverse`, { method: 'POST', headers, body: JSON.stringify({ versionNo: cleaningReport.versionNo, reason: '测试清理撤销' }) })
  assert.equal(reversedCleaning.status, 'REVERSED')
  assert.equal(reversedCleaning.reversedByNameSnapshot, '系统管理员')
  assert.equal(reversedCleaning.blankOutput.status, 'CANCELED')
  const reversedShake = await request(`/admin/production/shake-clean/shake-reports/${shakeReport1.id}/reverse`, { method: 'POST', headers, body: JSON.stringify({ versionNo: shakeReport1.versionNo, reason: '测试落砂撤销' }) })
  assert.equal(reversedShake.status, 'REVERSED')
  assert.equal(reversedShake.reversedByNameSnapshot, '系统管理员')

  await prisma.shakeBatch.updateMany({ where: { moldingTaskId: fixture.moldingTask.id, status: { not: 'CANCELED' } }, data: { remainingQuantity: 0, status: 'CONSUMED' } })
  await prisma.cleaningBatch.updateMany({ where: { moldingTaskId: fixture.moldingTask.id, status: { not: 'CANCELED' } }, data: { remainingQuantity: 0, status: 'CONSUMED' } })
  let statusList = (await request('/admin/production/shake-clean-tasks', { headers })).records
  assert.equal(statusList.find((item) => item.id === fixture.moldingTask.id).executionStatus, 'WAITING_POURING')
  await prisma.moldingTask.update({ where: { id: fixture.moldingTask.id }, data: { status: 'COMPLETED' } })
  statusList = (await request('/admin/production/shake-clean-tasks', { headers })).records
  assert.equal(statusList.find((item) => item.id === fixture.moldingTask.id).executionStatus, 'COMPLETED')
  assert.equal(statusList.find((item) => item.id === fixture.moldingTask.id).cooling, null, '无待落砂批次时冷却状态应为空')

  const restrictedLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify(restrictedCredentials) })
  const restrictedHeaders = { authorization: `Bearer ${restrictedLogin.token}` }
  const miniViewTasks = (await request('/mini/production/shake-clean-tasks', { headers: restrictedHeaders })).records
  assert.deepEqual(miniViewTasks.map((item) => item.id), [fixture.miniTask.task.id], '小程序 OWN 数据范围只能返回归属任务')
  await prisma.businessDataOwnership.create({ data: {
    entityType: 'production:molding_tasks', entityId: fixture.sortedTask.task.id,
    createdByUserId: restrictedUser.id, ownerUserId: restrictedUser.id,
  } })
  const restrictedCursorFirst = await request('/mini/production/shake-clean-tasks?pageSize=1', { headers: restrictedHeaders })
  assert.equal(restrictedCursorFirst.total, 2, '受限用户 cursor total 只能统计可见数据')
  const restrictedCursorSecond = await request(`/mini/production/shake-clean-tasks?cursor=${encodeURIComponent(restrictedCursorFirst.nextCursor)}&pageSize=1`, { headers: restrictedHeaders })
  assert.equal(restrictedCursorSecond.total, 2)
  assert.equal([...restrictedCursorFirst.records, ...restrictedCursorSecond.records].every((item) => [fixture.miniTask.task.id, fixture.sortedTask.task.id].includes(item.id)), true, 'cursor 后续页不能越过数据范围')
  assert.equal(miniViewTasks[0].allowedActions.shakeReport, false)
  assert.equal(miniViewTasks[0].allowedActions.cleanReport, false)
  const miniOptionsView = await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/options`, { headers: restrictedHeaders })
  assert.equal(miniOptionsView.allowedActions.shakeReport, false)
  await request(`/mini/production/shake-clean-tasks/${fixture.moldingTask.id}/options`, { headers: restrictedHeaders }, 404)
  assert.deepEqual(await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/reports`, { headers: restrictedHeaders }), { shakeReports: [], cleaningReports: [] })
  assert.equal((await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/trace`, { headers: restrictedHeaders })).shakeBatches.length, 1)
  assert.equal((await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/defect-options`, { headers: restrictedHeaders })).length, 6)
  await request('/mini/production/shake-clean/shake/check', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({ moldingTaskId: fixture.miniTask.task.id, quantity: 1 }) }, 403)
  await request('/mini/production/shake-clean/shake/reports', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({
    moldingTaskId: fixture.miniTask.task.id, requestId: `${prefix}-MINI-SHAKE-DENIED`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 4, scrapQty: 0, batchVersions: miniOptionsView.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) }, 403)
  await prisma.role.update({ where: { id: fixture.restrictedRole.id }, data: { permissions: ['mini.production.shake_clean.view', 'mini.production.shake_clean.shake_report'] } })
  const miniShakeEnabled = (await request('/mini/production/shake-clean-tasks', { headers: restrictedHeaders })).records
  assert.equal(miniShakeEnabled[0].allowedActions.shakeReport, true)
  assert.equal(miniShakeEnabled[0].allowedActions.cleanReport, false)
  assert.equal((await request('/mini/production/shake-clean/shake/check', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({ moldingTaskId: fixture.miniTask.task.id, quantity: 4 }) })).code, 'READY')
  const miniShakeReport = await request('/mini/production/shake-clean/shake/reports', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({
    moldingTaskId: fixture.miniTask.task.id, requestId: `${prefix}-MINI-SHAKE`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 4, scrapQty: 0, batchVersions: miniOptionsView.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) })
  assert.equal(miniShakeReport.goodQty, 4)
  const miniCleaningOptions = await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/options`, { headers: restrictedHeaders })
  assert.equal(miniCleaningOptions.allowedActions.cleanReport, false)
  await request('/mini/production/shake-clean/cleaning/reports', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({
    moldingTaskId: fixture.miniTask.task.id, requestId: `${prefix}-MINI-CLEAN-DENIED`, stationEquipmentCode: fixture.codes.clean,
    goodQty: 4, scrapQty: 0, batchVersions: miniCleaningOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) }, 403)
  await prisma.role.update({ where: { id: fixture.restrictedRole.id }, data: { permissions: ['mini.production.shake_clean.view', 'mini.production.shake_clean.shake_report', 'mini.production.shake_clean.clean_report'] } })
  const miniCleanEnabled = (await request('/mini/production/shake-clean-tasks', { headers: restrictedHeaders })).records
  assert.equal(miniCleanEnabled.find((item) => item.id === fixture.miniTask.task.id).allowedActions.cleanReport, true)
  const miniRemainingBefore = (await prisma.cleaningBatch.aggregate({ where: { moldingTaskId: fixture.miniTask.task.id, status: { not: 'CANCELED' } }, _sum: { remainingQuantity: true } }))._sum.remainingQuantity
  const staleMiniVersions = miniCleaningOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo: versionNo + 99 }))
  await request('/mini/production/shake-clean/cleaning/reports', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({
    moldingTaskId: fixture.miniTask.task.id, requestId: `${prefix}-MINI-CLEAN-STALE`, stationEquipmentCode: fixture.codes.clean,
    goodQty: 4, scrapQty: 0, batchVersions: staleMiniVersions,
  }) }, 409)
  const miniRemainingAfterStale = (await prisma.cleaningBatch.aggregate({ where: { moldingTaskId: fixture.miniTask.task.id, status: { not: 'CANCELED' } }, _sum: { remainingQuantity: true } }))._sum.remainingQuantity
  assert.equal(miniRemainingAfterStale, miniRemainingBefore, '清理批次旧版本冲突后余量不得变化')
  const miniCleaningReport = await request('/mini/production/shake-clean/cleaning/reports', { method: 'POST', headers: restrictedHeaders, body: JSON.stringify({
    moldingTaskId: fixture.miniTask.task.id, requestId: `${prefix}-MINI-CLEAN`, stationEquipmentCode: fixture.codes.clean,
    goodQty: 4, scrapQty: 0, batchVersions: miniCleaningOptions.cleaningBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) })
  assert.equal(miniCleaningReport.goodQty, 4)
  const miniReports = await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/reports`, { headers: restrictedHeaders })
  assert.equal(miniReports.shakeReports.length, 1)
  assert.equal(miniReports.cleaningReports.length, 1)
  const miniTrace = await request(`/mini/production/shake-clean-tasks/${fixture.miniTask.task.id}/trace`, { headers: restrictedHeaders })
  assert.equal(miniTrace.blankOutputBatches.length, 1)

  const concurrentTask = await createAdditionalTask('CONCURRENT', 4, 4, admin.id)
  const concurrentOptions = await request(`/admin/production/shake-clean-tasks/${concurrentTask.task.id}/options`, { headers })
  const concurrentBody = (requestId) => ({
    moldingTaskId: concurrentTask.task.id, requestId, stationEquipmentCode: fixture.codes.shake,
    goodQty: 4, scrapQty: 0,
    batchVersions: concurrentOptions.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
    confirmedEarlyShake: true,
  })
  await Promise.allSettled([
    request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify(concurrentBody(`${prefix}-CONCURRENT-A`)) }),
    request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify(concurrentBody(`${prefix}-CONCURRENT-B`)) }),
  ])
  const concurrentRemaining = (await prisma.shakeBatch.aggregate({ where: { moldingTaskId: concurrentTask.task.id, status: { not: 'CANCELED' } }, _sum: { remainingQuantity: true } }))._sum.remainingQuantity || 0
  const concurrentConsumed = (await prisma.shakeBatchConsumption.aggregate({ where: { shakeBatch: { moldingTaskId: concurrentTask.task.id }, shakeReport: { status: 'ACTIVE' } }, _sum: { quantity: true } }))._sum.quantity || 0
  assert.equal(concurrentRemaining + concurrentConsumed, 4, '同任务双报工后数量必须守恒')
  assert.equal(concurrentRemaining >= 0 && concurrentConsumed <= 4, true, '同任务双报工不得超扣')

  const reverseRaceTask = await createAdditionalTask('REVERSE-RACE', 3, 4, admin.id)
  const reverseRaceOptions = await request(`/admin/production/shake-clean-tasks/${reverseRaceTask.task.id}/options`, { headers })
  const firstRaceReport = await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
    moldingTaskId: reverseRaceTask.task.id, requestId: `${prefix}-REVERSE-RACE-FIRST`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 2, scrapQty: 0, batchVersions: reverseRaceOptions.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), confirmedEarlyShake: true,
  }) })
  const reverseRaceCurrent = await request(`/admin/production/shake-clean-tasks/${reverseRaceTask.task.id}/options`, { headers })
  await Promise.allSettled([
    request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
      moldingTaskId: reverseRaceTask.task.id, requestId: `${prefix}-REVERSE-RACE-SECOND`, stationEquipmentCode: fixture.codes.shake,
      goodQty: 2, scrapQty: 0, batchVersions: reverseRaceCurrent.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), confirmedEarlyShake: true,
    }) }),
    request(`/admin/production/shake-clean/shake-reports/${firstRaceReport.id}/reverse`, { method: 'POST', headers, body: JSON.stringify({ versionNo: firstRaceReport.versionNo, reason: '并发守恒测试' }) }),
  ])
  const reverseRaceRemaining = (await prisma.shakeBatch.aggregate({ where: { moldingTaskId: reverseRaceTask.task.id, status: { not: 'CANCELED' } }, _sum: { remainingQuantity: true } }))._sum.remainingQuantity || 0
  const reverseRaceConsumed = (await prisma.shakeBatchConsumption.aggregate({ where: { shakeBatch: { moldingTaskId: reverseRaceTask.task.id }, shakeReport: { status: 'ACTIVE' } }, _sum: { quantity: true } }))._sum.quantity || 0
  assert.equal(reverseRaceRemaining + reverseRaceConsumed, 4, '报工与撤销并发后数量必须守恒')

  const backfillRaceTask = await createAdditionalTask('BACKFILL-RACE', 20, 2, admin.id, false)
  const newerPouredAt = new Date(Date.now() - 2 * 60_000)
  const newerPouringReport = await prisma.pouringReport.create({ data: {
    code: `${prefix}-PR-BACKFILL-NEW`, requestId: `${prefix}-PR-REQ-BACKFILL-NEW`, heatOrderTransferId: transfer.id,
    moldingTaskId: backfillRaceTask.task.id, workOrderId: backfillRaceTask.workOrder.id, pouringRoutingNodeId: pourNode.id,
    stationEquipmentCode: codes.pouring, heatOrderCodeSnapshot: heatOrder.code, transferDeviceCodeSnapshot: codes.ladle,
    transferDeviceNameSnapshot: '测试浇注包', stationEquipmentNameSnapshot: '测试浇注工位', workOrderCodeSnapshot: backfillRaceTask.workOrder.code,
    productCodeSnapshot: codes.product, productNameSnapshot: '补建并发测试', pouringOperationCodeSnapshot: 'OP-POUR', pouringOperationNameSnapshot: '合型浇注',
    goodQty: 2, theoreticalWeightKg: 24, actualWeightKg: 24, transferBalanceBeforeKg: 1000, transferBalanceAfterKg: 976,
    holdMinutesSnapshot: 10, holdLevelSnapshot: 'NORMAL', operatorUserId: admin.id, operatorNameSnapshot: admin.name,
    reportedAt: newerPouredAt, shakeQueueResolution: 'CREATED',
  } })
  await prisma.shakeBatch.create({ data: {
    code: `${prefix}-SB-BACKFILL-NEW`, sourcePouringReportId: newerPouringReport.id, moldingTaskId: backfillRaceTask.task.id,
    workOrderId: backfillRaceTask.workOrder.id, routingVersionId: routingVersion.id, shakeRoutingNodeId: shakeNode.id,
    workOrderCodeSnapshot: backfillRaceTask.workOrder.code, productCodeSnapshot: codes.product, productNameSnapshot: '补建并发测试',
    shakeOperationCodeSnapshot: 'OP-SHAKE', shakeOperationNameSnapshot: '落砂清理', originalQuantity: 2, remainingQuantity: 2,
    pouredAt: newerPouredAt, coolingDurationMinutesSnapshot: 0,
  } })
  const preBackfillOptions = await prisma.shakeBatch.findMany({ where: { moldingTaskId: backfillRaceTask.task.id }, select: { id: true, versionNo: true } })
  await request('/admin/production/shake-clean-tasks', { headers })
  assert.equal(await prisma.shakeBatch.count({ where: { sourcePouringReportId: backfillRaceTask.pouringReport.id } }), 0, '正常列表查询必须保持只读，不得补建历史批次')
  await request(`/admin/production/shake-clean-tasks/${backfillRaceTask.task.id}/options`, { headers }, 409)
  const [backgroundResult, liveReportResult] = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      const result = await backfillShakeBatches(tx, { moldingTaskIds: [backfillRaceTask.task.id], limit: 100 })
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      return result
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
      moldingTaskId: backfillRaceTask.task.id, requestId: `${prefix}-BACKFILL-RACE-REPORT`, stationEquipmentCode: fixture.codes.shake,
      goodQty: 1, scrapQty: 0, batchVersions: preBackfillOptions, confirmedEarlyShake: true,
    }) }, 409),
  ])
  assert.equal(backgroundResult.status, 'fulfilled', '独立后台补建事务应成功提交')
  assert.equal(liveReportResult.status, 'fulfilled', '现场报工应明确返回补建或版本冲突，而不是破坏数量')
  const backfillOptions = await request(`/admin/production/shake-clean-tasks/${backfillRaceTask.task.id}/options`, { headers })
  await request('/admin/production/shake-clean/shake/reports', { method: 'POST', headers, body: JSON.stringify({
    moldingTaskId: backfillRaceTask.task.id, requestId: `${prefix}-BACKFILL-RACE-REPORT-RETRY`, stationEquipmentCode: fixture.codes.shake,
    goodQty: 1, scrapQty: 0, batchVersions: backfillOptions.shakeBatchVersions.map(({ id, versionNo }) => ({ id, versionNo })), confirmedEarlyShake: true,
  }) })
  const backfillConsumption = await prisma.shakeBatchConsumption.findFirstOrThrow({
    where: { shakeReport: { moldingTaskId: backfillRaceTask.task.id, status: 'ACTIVE' } }, include: { shakeBatch: true }, orderBy: { createdAt: 'asc' },
  })
  assert.equal(backfillConsumption.shakeBatch.sourcePouringReportId, backfillRaceTask.pouringReport.id, '补建与报工并发时必须先消费较早浇注批次')
  const backfillRemaining = (await prisma.shakeBatch.aggregate({ where: { moldingTaskId: backfillRaceTask.task.id, status: { not: 'CANCELED' } }, _sum: { remainingQuantity: true } }))._sum.remainingQuantity || 0
  const backfillConsumed = (await prisma.shakeBatchConsumption.aggregate({ where: { shakeBatch: { moldingTaskId: backfillRaceTask.task.id }, shakeReport: { status: 'ACTIVE' } }, _sum: { quantity: true } }))._sum.quantity || 0
  assert.equal(backfillRemaining + backfillConsumed, 4, '后台补建与现场报工并发后数量必须守恒')
  const adminMiniTasks = (await request('/mini/production/shake-clean-tasks', { headers })).records
  for (const taskId of [fixture.moldingTask.id, fixture.sortedTask.task.id, fixture.miniTask.task.id]) {
    assert.equal(adminMiniTasks.some((item) => item.id === taskId), true, '超管小程序查询应返回全部基础测试任务')
  }
  await prisma.systemWarehouse.createMany({ data: [
    { code: 'BLANK_WAREHOUSE', name: '铸件毛坯库', type: 'BLANK', system: true, status: 'ENABLED' },
    { code: 'RETURN_MELT_WAREHOUSE', name: '回炉料仓', type: 'RETURN_MELT', system: true, status: 'ENABLED' },
  ], skipDuplicates: true })
  const inspectionDefect = await prisma.defectCode.create({ data: { code: `${prefix}-INSP-CRACK`, name: '终检裂纹', category: '终检', status: '启用' } })
  await prisma.defectOperation.create({ data: { defectCodeId: inspectionDefect.id, operationCode: 'OP-INSP' } })
  const inspectionOptions = await request(`/admin/production/inspection-tasks/${fixture.miniTask.workOrder.id}/options`, { headers })
  assert.equal(inspectionOptions.remainingQuantity, 4)
  await request('/admin/production/inspection/reports', { method: 'POST', headers, body: JSON.stringify({
    workOrderId: fixture.miniTask.workOrder.id, requestId: `${prefix}-INSP-STALE`, goodQty: 4, reworkQty: 0, scrapQty: 0,
    batchVersions: inspectionOptions.batchVersions.map(({ id, versionNo }) => ({ id, versionNo: versionNo + 1 })),
  }) }, 409)
  const inspectionBody = {
    workOrderId: fixture.miniTask.workOrder.id, requestId: `${prefix}-INSP-1`, goodQty: 2, reworkQty: 1, scrapQty: 1,
    batchVersions: inspectionOptions.batchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
    defects: [{ defectCode: inspectionDefect.code, quantity: 2 }], imageUrl: '/uploads/inspection-crack.jpg',
  }
  const inspectionReport = await request('/admin/production/inspection/reports', { method: 'POST', headers, body: JSON.stringify(inspectionBody) })
  assert.equal(inspectionReport.goodQty, 2)
  assert.equal(inspectionReport.reworkQty, 1)
  assert.equal(inspectionReport.scrapQty, 1)
  assert.equal(Number(inspectionReport.scrapWeightKg), 10)
  assert.equal(inspectionReport.blankWarehouseReceipt.quantity, 2)
  assert.equal(inspectionReport.blankWarehouseReceipt.inventoryBatch.currentQuantity, 2)
  assert.equal(inspectionReport.scrapWriteOff.quantity, 1)
  assert.equal(inspectionReport.reworkTask.remainingQuantity, 1)
  const inspectionReportRetry = await request('/admin/production/inspection/reports', { method: 'POST', headers, body: JSON.stringify(inspectionBody) })
  assert.equal(inspectionReportRetry.id, inspectionReport.id, '终检重复请求必须返回原报告')
  assert.equal(await prisma.blankWarehouseReceipt.count({ where: { sourceInspectionReportId: inspectionReport.id } }), 1)
  assert.equal(await prisma.scrapWriteOff.count({ where: { sourceInspectionReportId: inspectionReport.id } }), 1)
  const reworkTask = await prisma.cleaningReworkTask.findUniqueOrThrow({ where: { sourceInspectionReportId: inspectionReport.id } })
  const inspectionDetail = await request(`/admin/production/inspection-tasks/${fixture.miniTask.workOrder.id}`, { headers })
  assert.equal(inspectionDetail.cleaningReworkTasks[0].allowedActions.report, true, '返修动作必须由后端详情 DTO 返回')
  const reworkReport = await request('/admin/production/cleaning-rework/reports', { method: 'POST', headers, body: JSON.stringify({
    taskId: reworkTask.id, requestId: `${prefix}-REWORK-1`, goodQty: 1, scrapQty: 0, equipmentCode: fixture.codes.clean, versionNo: reworkTask.versionNo,
  }) })
  assert.equal(reworkReport.goodQty, 1)
  assert.equal(reworkReport.outputInspectionBatch.remainingQuantity, 1)
  await request(`/admin/production/inspection-reports/${inspectionReport.id}/reverse`, { method: 'POST', headers, body: JSON.stringify({ versionNo: inspectionReport.versionNo, reason: '已有返修下游' }) }, 409)
  const secondOptions = await request(`/admin/production/inspection-tasks/${fixture.miniTask.workOrder.id}/options`, { headers })
  const secondInspection = await request('/admin/production/inspection/reports', { method: 'POST', headers, body: JSON.stringify({
    workOrderId: fixture.miniTask.workOrder.id, requestId: `${prefix}-INSP-2`, goodQty: 1, reworkQty: 0, scrapQty: 0,
    batchVersions: secondOptions.batchVersions.map(({ id, versionNo }) => ({ id, versionNo })),
  }) })
  assert.equal(secondInspection.goodQty, 1)
  assert.equal(await prisma.blankWarehouseReceipt.count({ where: { workOrderId: fixture.miniTask.workOrder.id } }), 2)
  assert.equal(await prisma.blankInventoryLedger.count({ where: { workOrderId: fixture.miniTask.workOrder.id } }), 2)
  assert.equal(await prisma.returnMeltInventoryLedger.count({ where: { workOrderId: fixture.miniTask.workOrder.id } }), 1)
  const reportHistory = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/reports`, { headers })
  assert.equal(reportHistory.shakeReports.length, 2)
  assert.equal(reportHistory.cleaningReports.length, 2)
  const trace = await request(`/admin/production/shake-clean-tasks/${fixture.moldingTask.id}/trace`, { headers })
  assert.equal(trace.shakeBatches.length, 2)
  assert.equal(trace.blankOutputBatches.length, 2)
  console.log(JSON.stringify({ ok: true, suite: 'shake-clean-execution', schema: schemaName }))
} catch (error) {
  testError = error
} finally {
  await stopApi().catch(() => {})
  await prisma?.$disconnect().catch(() => {})
  if (schemaCreated) await managementPrisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {})
  await managementPrisma?.$disconnect().catch(() => {})
}

if (testError) throw testError
