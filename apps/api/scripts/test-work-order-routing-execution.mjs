import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma, PrismaClient } from '@prisma/client'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultDatabaseUrl = 'postgresql://mingda:mingda_dev_password@127.0.0.1:5433/mingda_casting?schema=public'
const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl
const schemaPath = path.resolve(scriptDir, '../prisma/schema.prisma')
const migrationPath = path.resolve(scriptDir, '../prisma/migrations/20260826195000_work_order_melt_release/migration.sql')
const allocationRoutingMigrationPath = path.resolve(scriptDir, '../prisma/migrations/20260827090000_heat_allocation_routing_node/migration.sql')
const backfillPath = path.resolve(scriptDir, './backfill-work-order-melt-release.mjs')
const packagePath = path.resolve(scriptDir, '../package.json')
const schema = await readFile(schemaPath, 'utf8')
const migration = await readFile(migrationPath, 'utf8')
const allocationRoutingMigration = await readFile(allocationRoutingMigrationPath, 'utf8')
const backfill = await readFile(backfillPath, 'utf8')
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
const productionSource = await readFile(path.resolve(scriptDir, '../src/production/production.service.ts'), 'utf8')
const heatControllerSource = await readFile(path.resolve(scriptDir, '../src/production/heat-execution.controller.ts'), 'utf8')
const meltSchedulingControllerSource = await readFile(path.resolve(scriptDir, '../src/production/melt-scheduling.controller.ts'), 'utf8')
const moldingControllerSource = await readFile(path.resolve(scriptDir, '../src/production/molding.controller.ts'), 'utf8')
const moldingSource = await readFile(path.resolve(scriptDir, '../src/production/molding.service.ts'), 'utf8')
const pouringControllerSource = await readFile(path.resolve(scriptDir, '../src/production/pouring.controller.ts'), 'utf8')
const pouringSource = await readFile(path.resolve(scriptDir, '../src/production/pouring.service.ts'), 'utf8')
const shakeControllerSource = await readFile(path.resolve(scriptDir, '../src/production/shake-clean.controller.ts'), 'utf8')
const shakeSource = await readFile(path.resolve(scriptDir, '../src/production/shake-clean.service.ts'), 'utf8')
const inspectionTypesSource = await readFile(path.resolve(scriptDir, '../src/production/final-inspection.types.ts'), 'utf8')
const inspectionControllerSource = await readFile(path.resolve(scriptDir, '../src/production/final-inspection.controller.ts'), 'utf8')
const inspectionSource = await readFile(path.resolve(scriptDir, '../src/production/final-inspection.service.ts'), 'utf8')
const coremakingSource = await readFile(path.resolve(scriptDir, '../src/production/coremaking.service.ts'), 'utf8')
const moldingUtilsSource = await readFile(path.resolve(scriptDir, '../../admin/src/utils/molding.ts'), 'utf8')
const productionUtilsSource = await readFile(path.resolve(scriptDir, '../../admin/src/utils/production.ts'), 'utf8')
const pouringUtilsSource = await readFile(path.resolve(scriptDir, '../../admin/src/utils/pouring.ts'), 'utf8')
const shakeUtilsSource = await readFile(path.resolve(scriptDir, '../../admin/src/utils/shakeClean.ts'), 'utf8')
const inspectionUtilsSource = await readFile(path.resolve(scriptDir, '../../admin/src/utils/finalInspection.ts'), 'utf8')
const executionTypesPath = path.resolve(scriptDir, '../src/production/work-order-routing-execution.types.ts')
const executionServicePath = path.resolve(scriptDir, '../src/production/work-order-routing-execution.service.ts')
const appModuleSource = await readFile(path.resolve(scriptDir, '../src/app.module.ts'), 'utf8')
const workOrderControllerSource = await readFile(path.resolve(scriptDir, '../src/production/work-order.controller.ts'), 'utf8')
const productionPermissionGuardSource = await readFile(path.resolve(scriptDir, '../src/production/production-permission.guard.ts'), 'utf8')
const adminDefaultPermissionsSource = await readFile(path.resolve(scriptDir, '../src/shared/admin-default-permissions.ts'), 'utf8')
const adminRolesSource = await readFile(path.resolve(scriptDir, '../../admin/src/utils/roles.ts'), 'utf8')

const workOrder = schema.match(/model WorkOrder \{[\s\S]*?\n\}/)?.[0]
assert.ok(workOrder, 'WorkOrder model must exist')

assert.match(workOrder, /meltReleasedAt\s+DateTime\?/, 'WorkOrder must persist meltReleasedAt')
assert.match(workOrder, /meltReleasedByUserId\s+String\?/, 'WorkOrder must persist meltReleasedByUserId')
assert.match(
  workOrder,
  /meltReleasedBy\s+User\?\s+@relation\("WorkOrderMeltReleaser", fields: \[meltReleasedByUserId\], references: \[id\], onUpdate: Cascade, onDelete: SetNull\)/,
  'WorkOrder must define the melt releaser relation',
)
assert.match(workOrder, /@@index\(\[meltReleasedAt\]\)/, 'WorkOrder must index meltReleasedAt')
assert.match(workOrder, /@@index\(\[meltReleasedByUserId\]\)/, 'WorkOrder must index meltReleasedByUserId')

const allocation = schema.match(/model HeatOrderAllocation \{[\s\S]*?\n\}/)?.[0]
assert.ok(allocation, 'HeatOrderAllocation model must exist')
const meltRelease = schema.match(/model WorkOrderMeltRelease \{[\s\S]*?\n\}/)?.[0]
assert.ok(meltRelease, 'WorkOrderMeltRelease model must exist')
assert.match(meltRelease, /workOrderId\s+String/, 'WorkOrderMeltRelease must reference a work order')
assert.match(meltRelease, /routingNodeId\s+String/, 'WorkOrderMeltRelease must reference a routing node')
assert.match(meltRelease, /releasedAt\s+DateTime/, 'WorkOrderMeltRelease must persist the release time')
assert.match(meltRelease, /releasedByUserId\s+String\?/, 'WorkOrderMeltRelease must persist an optional release user')
assert.match(meltRelease, /workOrder\s+WorkOrder/, 'WorkOrderMeltRelease must define the work-order relation')
assert.match(meltRelease, /routingNode\s+ProcessRoutingNode/, 'WorkOrderMeltRelease must define the routing-node relation')
assert.match(meltRelease, /releasedBy\s+User\?/, 'WorkOrderMeltRelease must define the release-user relation')
assert.match(meltRelease, /@@unique\(\[workOrderId, routingNodeId\]\)/, 'WorkOrderMeltRelease must prevent duplicate node releases')
assert.match(allocation, /routingNodeId\s+String\?/, 'HeatOrderAllocation must persist an optional routing node')
assert.match(
  allocation,
  /routingNode\s+ProcessRoutingNode\?\s+@relation\("HeatOrderAllocationRoutingNode", fields: \[routingNodeId\], references: \[id\], onDelete: SetNull\)/,
  'HeatOrderAllocation must define the nullable routing node relation',
)
assert.match(allocation, /@@index\(\[routingNodeId\]\)/, 'HeatOrderAllocation must index routingNodeId')
assert.match(allocationRoutingMigration, /ADD COLUMN IF NOT EXISTS\s+"routingNodeId"\s+TEXT/i, 'Migration must add nullable allocation routing node')
assert.match(allocationRoutingMigration, /CREATE INDEX IF NOT EXISTS\s+"HeatOrderAllocation_routingNodeId_idx"/i, 'Migration must index allocation routing node')
assert.match(allocationRoutingMigration, /FOREIGN KEY\s*\("routingNodeId"\)[\s\S]*REFERENCES\s+"ProcessRoutingNode"\s*\("id"\)[\s\S]*ON DELETE SET NULL/i, 'Migration must add the allocation routing node FK')
const meltReleaseMigrationPath = path.resolve(scriptDir, '../prisma/migrations/20260827093000_work_order_melt_release_by_node/migration.sql')
const meltReleaseMigration = await readFile(meltReleaseMigrationPath, 'utf8')
assert.match(meltReleaseMigration, /CREATE TABLE IF NOT EXISTS\s+"WorkOrderMeltRelease"/i, 'Migration must create node-level melt releases')
assert.match(meltReleaseMigration, /"workOrderId"\s+TEXT\s+NOT NULL/i, 'Migration must require the work-order id')
assert.match(meltReleaseMigration, /"routingNodeId"\s+TEXT\s+NOT NULL/i, 'Migration must require the routing-node id')
assert.match(meltReleaseMigration, /CREATE UNIQUE INDEX[\s\S]*ON\s+"WorkOrderMeltRelease"\s*\("workOrderId",\s*"routingNodeId"\)/i, 'Migration must enforce one release per work-order node')
assert.match(productionSource, /meltReleases:\s*\{\s*some:/, 'melt pool must query node-level release records')
assert.match(productionSource, /meltRoutingNodeId/, 'melt pool must preserve the released routing node')
assert.match(productionSource, /routingNodeId[\s\S]*processRoutingNode/, 'melt allocation creation must resolve a locked routing node')
assert.match(productionSource, /routingNodeId:\s*resolvedRoutingNodeId/, 'melt allocation creation must persist the resolved routing node')
assert.match(workOrderControllerSource, /@Body\(\) body:\s*\{\s*routingNodeId\?: string\s*\}/, 'melt release must accept the selected routing node')

assert.match(migration, /ADD COLUMN IF NOT EXISTS\s+"meltReleasedAt"\s+TIMESTAMP\(3\)/i, 'Migration must add meltReleasedAt idempotently')
assert.match(migration, /ADD COLUMN IF NOT EXISTS\s+"meltReleasedByUserId"\s+TEXT/i, 'Migration must add meltReleasedByUserId idempotently')
assert.match(migration, /UPDATE\s+"WorkOrder"[\s\S]*SET\s+"meltReleasedAt"\s*=\s*"createdAt"[\s\S]*WHERE\s+"meltReleasedAt"\s+IS\s+NULL/i, 'Migration must backfill existing work orders')
assert.match(migration, /CREATE INDEX IF NOT EXISTS\s+"WorkOrder_meltReleasedAt_idx"\s+ON\s+"WorkOrder"\s*\("meltReleasedAt"\)/i, 'Migration must create the melt release time index')
assert.match(migration, /CREATE INDEX IF NOT EXISTS\s+"WorkOrder_meltReleasedByUserId_idx"\s+ON\s+"WorkOrder"\s*\("meltReleasedByUserId"\)/i, 'Migration must create the melt releaser index')
assert.match(migration, /FOREIGN KEY\s*\("meltReleasedByUserId"\)[\s\S]*REFERENCES\s+"User"\s*\("id"\)[\s\S]*ON DELETE SET NULL[\s\S]*ON UPDATE CASCADE/i, 'Migration must add the melt releaser FK semantics')

assert.match(backfill, /--before=<ISO timestamp>/, 'Backfill must document the required cutoff option')
assert.match(backfill, /MELT_RELEASE_BACKFILL_BEFORE/, 'Backfill must support the cutoff environment variable')
assert.match(backfill, /meltReleasedAt[\s\S]*IS NULL[\s\S]*createdAt[\s\S]*cutoff/i, 'Backfill must update only null releases created before the cutoff')
assert.match(backfill, /cutoff[\s\S]*updated/, 'Backfill output must include cutoff and updated count')
assert.doesNotMatch(packageJson.scripts['backfill:work-order-melt-release'], /--before=/, 'Backfill package command must accept the cutoff through npm arguments or environment')

const user = schema.match(/model User \{[\s\S]*?\n\}/)?.[0]
assert.ok(user, 'User model must exist')
assert.match(
  user,
  /meltReleasedWorkOrders\s+WorkOrder\[\]\s+@relation\("WorkOrderMeltReleaser"\)/,
  'User must define the inverse melt releaser relation',
)

const workOrderDmmf = Prisma.dmmf.datamodel.models.find((model) => model.name === 'WorkOrder')
assert.ok(workOrderDmmf, 'Generated Prisma DMMF must contain WorkOrder')

const workOrderFields = new Map(workOrderDmmf.fields.map((field) => [field.name, field]))
assert.equal(workOrderFields.get('meltReleasedAt')?.kind, 'scalar', 'DMMF must expose meltReleasedAt as a scalar')
assert.equal(workOrderFields.get('meltReleasedAt')?.type, 'DateTime', 'DMMF must expose meltReleasedAt as DateTime')
assert.equal(workOrderFields.get('meltReleasedAt')?.isRequired, false, 'meltReleasedAt must remain optional')
assert.equal(workOrderFields.get('meltReleasedByUserId')?.kind, 'scalar', 'DMMF must expose meltReleasedByUserId as a scalar')
assert.equal(workOrderFields.get('meltReleasedByUserId')?.type, 'String', 'DMMF must expose meltReleasedByUserId as String')
assert.equal(workOrderFields.get('meltReleasedByUserId')?.isRequired, false, 'meltReleasedByUserId must remain optional')
assert.equal(workOrderFields.get('meltReleasedBy')?.kind, 'object', 'DMMF must expose meltReleasedBy as a relation')
assert.equal(workOrderFields.get('meltReleasedBy')?.type, 'User', 'meltReleasedBy must target User')
assert.equal(workOrderFields.get('meltReleasedBy')?.isList, false, 'meltReleasedBy must be singular')

const userDmmf = Prisma.dmmf.datamodel.models.find((model) => model.name === 'User')
assert.ok(userDmmf, 'Generated Prisma DMMF must contain User')
const inverseRelation = userDmmf.fields.find((field) => field.name === 'meltReleasedWorkOrders')
assert.equal(inverseRelation?.kind, 'object', 'DMMF must expose the inverse melt releaser relation')
assert.equal(inverseRelation?.type, 'WorkOrder', 'Inverse melt releaser relation must target WorkOrder')
assert.equal(inverseRelation?.isList, true, 'Inverse melt releaser relation must be a list')

const allocationDmmf = Prisma.dmmf.datamodel.models.find((model) => model.name === 'HeatOrderAllocation')
assert.ok(allocationDmmf, 'Generated Prisma DMMF must contain HeatOrderAllocation')
const allocationFields = new Map(allocationDmmf.fields.map((field) => [field.name, field]))
assert.equal(allocationFields.get('routingNodeId')?.kind, 'scalar', 'DMMF must expose allocation routingNodeId')
assert.equal(allocationFields.get('routingNodeId')?.type, 'String', 'allocation routingNodeId must be String')
assert.equal(allocationFields.get('routingNodeId')?.isRequired, false, 'allocation routingNodeId must remain optional')
assert.equal(allocationFields.get('routingNode')?.kind, 'object', 'DMMF must expose allocation routing node relation')
assert.equal(allocationFields.get('routingNode')?.type, 'ProcessRoutingNode', 'allocation routing node relation must target ProcessRoutingNode')
const meltReleaseDmmf = Prisma.dmmf.datamodel.models.find((model) => model.name === 'WorkOrderMeltRelease')
assert.ok(meltReleaseDmmf, 'Generated Prisma DMMF must contain WorkOrderMeltRelease')
const meltReleaseFields = new Map(meltReleaseDmmf.fields.map((field) => [field.name, field]))
assert.equal(meltReleaseFields.get('workOrder')?.type, 'WorkOrder', 'melt release work-order relation must target WorkOrder')
assert.equal(meltReleaseFields.get('routingNode')?.type, 'ProcessRoutingNode', 'melt release routing-node relation must target ProcessRoutingNode')
assert.equal(meltReleaseFields.get('releasedBy')?.type, 'User', 'melt release user relation must target User')

async function verifyDatabaseMetadata(databaseUrl) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'WorkOrder'
        AND column_name IN ('meltReleasedAt', 'meltReleasedByUserId')
    `)
    const columnNames = new Set(columns.map((column) => column.column_name))
    assert.ok(columnNames.has('meltReleasedAt'), 'Database must contain WorkOrder.meltReleasedAt')
    assert.ok(columnNames.has('meltReleasedByUserId'), 'Database must contain WorkOrder.meltReleasedByUserId')

    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'WorkOrder'
    `)
    const indexDefinitions = indexes.map((index) => `${index.indexname} ${index.indexdef}`)
    assert.ok(
      indexDefinitions.some((definition) => /meltReleasedAt/.test(definition)),
      'Database must have an index covering WorkOrder.meltReleasedAt',
    )
    assert.ok(
      indexDefinitions.some((definition) => /meltReleasedByUserId/.test(definition)),
      'Database must have an index covering WorkOrder.meltReleasedByUserId',
    )
    const allocationColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'HeatOrderAllocation'
        AND column_name = 'routingNodeId'
    `)
    assert.equal(allocationColumns.length, 1, 'Database must contain HeatOrderAllocation.routingNodeId')
    assert.ok(
      (await prisma.$queryRawUnsafe(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'HeatOrderAllocation'
      `)).map((index) => `${index.indexname} ${index.indexdef}`).some((definition) => /HeatOrderAllocation.*routingNodeId|routingNodeId.*HeatOrderAllocation/.test(definition)),
      'Database must have an index covering HeatOrderAllocation.routingNodeId',
    )
    console.log('Work-order routing database metadata passed')
  } finally {
    await prisma.$disconnect()
  }
}

console.log('Work-order routing schema and Prisma DMMF contract passed')
assert.match(
  productionSource,
  /meltReleasedAt:\s*\{\s*not:\s*null\s*\}/,
  'melt pool must require explicit melt release',
)
assert.doesNotMatch(
  productionSource,
  /data:\s*\{[^}]*meltReleasedAt:\s*new Date\(\)/s,
  'work-order creation must not auto-release melt',
)
console.log('Work-order melt release source contract passed')

// Task 5: every admin list must accept workOrderId and constrain the database query before pagination/aggregation.
assert.match(coremakingSource, /filters\.workOrderId[\s\S]*workOrderId:\s*filters\.workOrderId/, 'core list must keep workOrderId in the Prisma where clause')
assert.match(heatControllerSource, /@Query\('workOrderId'\) workOrderId\?: string/, 'heat list controller must accept workOrderId')
assert.match(heatControllerSource, /listHeatOrders\(request, status, workOrderId, false\)/, 'heat list controller must forward workOrderId')
assert.match(productionSource, /listHeatOrders\(request: RequestWithAdmin, status\?: string, workOrderId\?: string/, 'heat list service must accept workOrderId')
assert.match(productionSource, /allocations:\s*\{\s*some:\s*\{\s*workOrderId\s*\}\s*\}/, 'heat list must filter through allocations relation in Prisma where')
assert.match(meltSchedulingControllerSource, /@Query\('workOrderId'\) workOrderId\?: string/, 'melt pool controller must accept workOrderId')
assert.match(meltSchedulingControllerSource, /meltPool\(request, workOrderId\?\.trim\(\)\)/, 'melt pool controller must forward workOrderId')
assert.match(productionSource, /meltPool\(request: RequestWithAdmin, workOrderId\?: string/, 'melt pool service must accept workOrderId')
assert.match(productionSource, /workOrderId[\s\S]*AND:\s*\[\{\s*id:\s*workOrderId\s*\}\][\s\S]*meltReleasedAt/, 'melt pool must combine workOrderId with release filtering in database where')

assert.match(moldingControllerSource, /@Query\('workOrderId'\) workOrderId\?: string/, 'molding list controller must accept workOrderId')
assert.match(moldingControllerSource, /listTasks\(request, \{ keyword, status, workOrderId \}\)/, 'molding list controller must forward workOrderId')
assert.match(moldingSource, /filters\.workOrderId[\s\S]*workOrderId:\s*filters\.workOrderId/, 'molding list must filter in Prisma where')

assert.match(pouringControllerSource, /@Query\('workOrderId'\) workOrderId\?: string/, 'pouring list controller must accept workOrderId')
assert.match(pouringControllerSource, /listQueue\(request, \{ keyword, status, workOrderId \}\)/, 'pouring list controller must forward workOrderId')
assert.match(pouringSource, /query\.workOrderId[\s\S]*workOrderId:\s*query\.workOrderId/, 'pouring list must constrain batches in Prisma where')

assert.match(shakeControllerSource, /@Query\(\) query: ShakeCleanListQuery/, 'shake-clean list controller must pass the typed query object')
assert.match(shakeControllerSource, /ShakeCleanListQuery/, 'shake-clean list controller must expose the typed workOrderId query')
assert.match(shakeSource, /query\.workOrderId[\s\S]*mt\."workOrderId"\s*=\s*\$\{query\.workOrderId\}/, 'shake-clean list must constrain the SQL source rows by workOrderId')

assert.match(inspectionTypesSource, /workOrderId\?: string/, 'inspection list query must define workOrderId')
assert.match(inspectionControllerSource, /@Get\('inspection-tasks'\)[\s\S]*@Query\(\) query/, 'inspection list controller must pass the query object')
assert.match(inspectionSource, /query\.workOrderId[\s\S]*AND:\s*\[\{\s*id:\s*query\.workOrderId\s*\}\]/, 'inspection list must filter work orders in Prisma where without overriding visibility scope')

assert.match(moldingUtilsSource, /fetchMoldingTasks\(params: \{[^}]*workOrderId\?: string/s, 'molding utils must accept workOrderId')
assert.match(moldingUtilsSource, /query\.set\('workOrderId', params\.workOrderId\)/, 'molding utils must forward workOrderId')
assert.match(productionUtilsSource, /fetchHeatOrders\(status\?: HeatOrderStatus, workOrderId\?: string\)/, 'heat utils must accept workOrderId')
assert.match(productionUtilsSource, /query\.set\('workOrderId', workOrderId\)/, 'heat utils must forward workOrderId')
assert.match(productionUtilsSource, /fetchMeltPool\(workOrderId\?: string\)/, 'melt pool utils must accept workOrderId')
assert.match(productionUtilsSource, /workOrderId=\$\{encodeURIComponent\(workOrderId\)\}/, 'melt pool utils must forward workOrderId')
assert.match(pouringUtilsSource, /fetchPouringTasks\(params: \{[^}]*workOrderId\?: string/s, 'pouring utils must accept workOrderId')
assert.match(pouringUtilsSource, /query\.set\('workOrderId', params\.workOrderId\)/, 'pouring utils must forward workOrderId')
assert.match(shakeUtilsSource, /fetchShakeCleanTasks\(params: \{[^}]*workOrderId\?: string/s, 'shake-clean utils must accept workOrderId')
assert.match(shakeUtilsSource, /query\.set\('workOrderId', params\.workOrderId\)/, 'shake-clean utils must forward workOrderId')
assert.match(inspectionUtilsSource, /fetchInspectionTasks\(params: \{[^}]*workOrderId\?: string/s, 'inspection utils must accept workOrderId')
assert.match(inspectionUtilsSource, /workOrderId/, 'inspection utils must forward workOrderId')
console.log('Work-order list workOrderId source contracts passed')

const executionTypes = await readFile(executionTypesPath, 'utf8')
const executionServiceSource = await readFile(executionServicePath, 'utf8')
assert.match(executionTypes, /ExecutionModule/, 'routing execution types must define execution modules')
assert.match(executionTypes, /WorkOrderRoutingExecutionNode/, 'routing execution types must define node DTO')
assert.match(executionServiceSource, /class WorkOrderRoutingExecutionService/, 'routing execution service must exist')
assert.match(appModuleSource, /WorkOrderRoutingExecutionService/, 'routing execution service must be registered')

// Task 4: routing execution reads and manual melt release are protected API actions.
assert.match(workOrderControllerSource, /WorkOrderRoutingExecutionService/, 'work-order controller must inject routing execution service')
assert.match(workOrderControllerSource, /@Get\(':id\/routing-execution'\)[\s\S]*routingExecution\.getSummary/, 'controller must expose the routing execution summary endpoint')
assert.match(workOrderControllerSource, /@Post\(':id\/melt-release'\)[\s\S]*routingExecution\.releaseMelt/, 'controller must expose the melt release endpoint')
assert.match(productionPermissionGuardSource, /routing-execution\$[\s\S]*production\.work_order\.view/, 'routing summary must map to work-order view permission')
assert.match(productionPermissionGuardSource, /melt-release\$[\s\S]*production\.schedule\.release/, 'melt release must map to schedule release permission')
assert.match(adminDefaultPermissionsSource, /'production\.schedule\.release'/, 'admin defaults must include schedule release permission')
assert.match(adminRolesSource, /'production\.schedule\.release'/, 'admin role permission tree must include schedule release permission')
assert.match(executionServiceSource, /\$transaction\([\s\S]*FOR UPDATE/, 'melt release must lock the work order in a transaction')
assert.match(executionServiceSource, /productionStatus\s*===\s*'CLOSED'[\s\S]*ConflictException/, 'melt release must reject closed work orders')
assert.match(executionServiceSource, /updateMany\([\s\S]*meltReleasedAt\s*:\s*null/, 'melt release must be idempotent and persist only the first release')
assert.match(executionServiceSource, /CORE_INCOMPLETE|制芯未完成/, 'melt release must return a soft warning for incomplete coremaking')
assert.match(executionServiceSource, /CORE_DRYING|待烘干/, 'melt release must return a soft warning for pending drying')
assert.match(executionServiceSource, /routingNodeId\?: string/, 'melt release must validate the selected routing node')
assert.doesNotMatch(executionServiceSource, /compactNames/, 'execution summary must return complete equipment and team names')

const {
  classifyExecutionModule,
  summarizeStatuses,
  summarizeWorkOrderExecution,
  releasedMeltRoutingNodeIds,
  WorkOrderRoutingExecutionService,
} = await import('../dist/production/work-order-routing-execution.service.js')

assert.equal(classifyExecutionModule({ code: 'OP-CORE', section: '其他' }), 'CORE')
assert.equal(classifyExecutionModule({ code: 'CUSTOM-CORE', section: '制芯' }), 'CORE')
assert.equal(classifyExecutionModule({ code: 'OP-POUR', section: '浇注' }), 'POURING')
assert.equal(classifyExecutionModule({ code: 'CUSTOM-UNKNOWN', section: '后处理' }), 'UNSUPPORTED')
assert.deepEqual(summarizeStatuses(['WAITING', 'COMPLETED']), {
  progressStatus: 'PARTIAL_COMPLETED',
  progressLabel: '部分完成',
})
assert.deepEqual(summarizeStatuses(['PARTIAL']), {
  progressStatus: 'PARTIAL_COMPLETED',
  progressLabel: '部分完成',
})
assert.deepEqual(summarizeStatuses(['CONSUMED']), {
  progressStatus: 'COMPLETED',
  progressLabel: '已完成',
})

const fixture = summarizeWorkOrderExecution({
  id: 'wo-1',
  plannedQuantity: 10,
  meltReleasedAt: null,
  routingVersion: {
    nodes: [
      { id: 'node-core', seqNo: 10, operationCode: 'OP-CORE', operation: { name: '射芯制芯', section: '制芯' } },
      { id: 'node-custom', seqNo: 20, operationCode: 'CUSTOM-UNKNOWN', operation: { name: '后处理', section: '后处理' } },
    ],
  },
  bomVersion: { coreBoxes: [{ coreBoxCode: 'CORE-1' }] },
  coreTasks: [{ id: 'core-task-1', routingNodeId: 'node-core', coreBoxCode: 'CORE-1', plannedQuantity: 10, qualifiedQuantity: 4, scrapQuantity: 0, status: 'IN_PROGRESS', equipmentCode: 'EQ-1', equipmentNameSnapshot: '实际制芯机', teamCode: 'TEAM-1', teamNameSnapshot: '实际制芯班组' }],
  allocations: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
const coreNode = fixture.find((node) => node.nodeId === 'node-core')
assert.deepEqual(coreNode?.equipmentNames, ['实际制芯机'], 'summary must use actual task equipment')
assert.deepEqual(coreNode?.teamNames, ['实际制芯班组'], 'summary must use actual task team')
assert.equal(coreNode?.progressCurrent, 4)
assert.equal(coreNode?.progressTotal, 10)
assert.equal(fixture.find((node) => node.nodeId === 'node-custom')?.action, 'NONE')
const canceledCoreFixture = summarizeWorkOrderExecution({
  id: 'wo-canceled-core',
  plannedQuantity: 10,
  meltReleasedAt: null,
  routingVersion: {
    nodes: [{ id: 'node-core-canceled', seqNo: 10, operationCode: 'OP-CORE', operation: { name: '射芯制芯', section: '制芯' } }],
  },
  bomVersion: { coreBoxes: [{ coreBoxCode: 'CORE-1' }] },
  coreTasks: [{ id: 'canceled-core-task', routingNodeId: 'node-core-canceled', coreBoxCode: 'CORE-1', plannedQuantity: 10, qualifiedQuantity: 0, status: 'CANCELED', equipmentCode: 'EQ-CANCELED', equipmentNameSnapshot: '已取消设备', teamCode: 'TEAM-CANCELED', teamNameSnapshot: '已取消班组' }],
  allocations: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
const canceledCoreNode = canceledCoreFixture[0]
assert.equal(canceledCoreNode?.dispatchStatus, 'RELEASED', 'canceled core history still counts as dispatched')
assert.equal(canceledCoreNode?.action, 'VIEW', 'canceled core history must be view-only')
assert.equal(canceledCoreNode?.actionPermission, 'production.core_task.view', 'VIEW action must use the view permission')
assert.equal(canceledCoreNode?.progressStatus, 'CANCELED', 'canceled core history must show canceled progress')
assert.deepEqual(canceledCoreNode?.equipmentNames, [], 'canceled core task must not provide effective equipment')
assert.deepEqual(canceledCoreNode?.teamNames, [], 'canceled core task must not provide effective team')
assert.equal(canceledCoreNode?.progressTotal, null, 'canceled core task must not contribute effective quantity')
const mixedCoreFixture = summarizeWorkOrderExecution({
  id: 'wo-mixed-core',
  plannedQuantity: 10,
  meltReleasedAt: null,
  routingVersion: {
    nodes: [{ id: 'node-core-mixed', seqNo: 10, operationCode: 'OP-CORE', operation: { name: '射芯制芯', section: '制芯' } }],
  },
  bomVersion: { coreBoxes: [{ coreBoxCode: 'CORE-1' }, { coreBoxCode: 'CORE-2' }] },
  coreTasks: [
    { id: 'canceled-core-task-1', routingNodeId: 'node-core-mixed', coreBoxCode: 'CORE-1', plannedQuantity: 10, qualifiedQuantity: 0, status: 'CANCELED', equipmentCode: 'EQ-CANCELED', equipmentNameSnapshot: '已取消设备', teamCode: 'TEAM-CANCELED', teamNameSnapshot: '已取消班组' },
    { id: 'active-core-task-2', routingNodeId: 'node-core-mixed', coreBoxCode: 'CORE-2', plannedQuantity: 10, qualifiedQuantity: 6, status: 'IN_PROGRESS', equipmentCode: 'EQ-ACTIVE', equipmentNameSnapshot: '有效设备', teamCode: 'TEAM-ACTIVE', teamNameSnapshot: '有效班组' },
  ],
  allocations: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
const mixedCoreNode = mixedCoreFixture[0]
assert.equal(mixedCoreNode?.dispatchStatus, 'RELEASED', 'all historical core-box tasks must cover dispatch even when one was canceled')
assert.equal(mixedCoreNode?.action, 'VIEW', 'full historical core-box coverage must be view-only')
assert.deepEqual(mixedCoreNode?.equipmentNames, ['有效设备'], 'mixed core progress must use only active task equipment')
assert.deepEqual(mixedCoreNode?.teamNames, ['有效班组'], 'mixed core progress must use only active task team')
assert.equal(mixedCoreNode?.progressCurrent, 6, 'mixed core progress must exclude canceled quantity')
assert.equal(mixedCoreNode?.progressTotal, 10, 'mixed core total must exclude canceled quantity')
const restrictedFixture = summarizeWorkOrderExecution({
  ...fixture,
  routingVersion: { nodes: [{ id: 'node-core-pending', seqNo: 10, operationCode: 'OP-CORE', operation: { name: '射芯制芯', section: '制芯' } }] },
  coreTasks: [],
}, ['production.core_task.view'])
assert.equal(restrictedFixture[0]?.action, 'CREATE')
assert.equal(restrictedFixture[0]?.actionPermission, 'production.core_task.create')
assert.equal(restrictedFixture[0]?.actionEnabled, false, 'create action must be disabled without create permission')

const allModules = summarizeWorkOrderExecution({
  id: 'wo-2',
  plannedQuantity: 100,
  meltCompletedQuantity: 20,
  meltReleasedAt: '2026-08-26T08:00:00.000Z',
  routingVersion: {
    nodes: [
      { id: 'melt', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼', section: '熔炼' } },
      { id: 'molding', seqNo: 20, operationCode: 'OP-MOLD', operation: { name: '造型下芯', section: '造型' } },
      { id: 'pouring', seqNo: 30, operationCode: 'OP-POUR', operation: { name: '合型浇注', section: '浇注' } },
      { id: 'shake', seqNo: 40, operationCode: 'OP-SHAKE', operation: { name: '落砂清理', section: '清理' } },
      { id: 'inspection', seqNo: 50, operationCode: 'OP-INSP', operation: { name: '成品终检', section: '质检' } },
    ],
  },
  bomVersion: { coreBoxes: [] },
  coreTasks: [],
  allocations: [
    { workOrderId: 'wo-2', allocatedQuantity: 60, heatOrder: { status: 'IN_PROGRESS', furnaceNameSnapshot: '1号中频炉', teamNameSnapshot: '熔炼甲班' } },
    { workOrderId: 'wo-2', allocatedQuantity: 40, heatOrder: { status: 'CANCELED', furnaceNameSnapshot: '2号中频炉', teamNameSnapshot: '熔炼乙班' } },
  ],
  moldingTasks: [{ id: 'molding-task', routingNodeId: 'molding', status: 'COMPLETED', planPieceQty: 100, planBoxQty: 25, completedGoodQty: 25, productionLineNameSnapshot: '造型1线', teamNameSnapshot: '造型甲班' }],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [{ id: 'shake-batch', shakeRoutingNodeId: 'shake', originalQuantity: 60, remainingQuantity: 20, status: 'PARTIAL' }],
  shakeReports: [{ id: 'shake-report', shakeRoutingNodeId: 'shake', stationEquipmentNameSnapshot: '落砂机1号' }],
  cleaningBatches: [{ id: 'clean-batch', shakeRoutingNodeId: 'shake', originalQuantity: 40, remainingQuantity: 40, status: 'WAITING' }],
  cleaningReports: [],
  inspectionBatches: [{ id: 'inspection-batch', inspectionRoutingNodeId: 'inspection', originalQuantity: 30, remainingQuantity: 30, status: 'WAITING' }],
  inspectionReports: [],
})
const meltNode = allModules.find((node) => node.nodeId === 'melt')
assert.equal(meltNode?.dispatchStatus, 'RELEASED')
assert.equal(meltNode?.action, 'VIEW')
assert.equal(meltNode?.actionPermission, 'production.heat.view', 'released melt node VIEW action must use heat view permission')
assert.equal(meltNode?.progressCurrent, 20, 'melt progress must use actually completed quantity, not scheduled allocation')
assert.deepEqual(meltNode?.equipmentNames, ['1号中频炉'])
const moldingNode = allModules.find((node) => node.nodeId === 'molding')
assert.equal(moldingNode?.progressStatus, 'COMPLETED')
assert.equal(moldingNode?.progressCurrent, 25, 'molding progress must use completed box quantity')
assert.equal(moldingNode?.progressTotal, 25, 'molding progress total must use planned box quantity, not planned pieces')
assert.equal(allModules.find((node) => node.nodeId === 'pouring')?.dispatchStatus, 'WAITING_UPSTREAM')
const shakeNode = allModules.find((node) => node.nodeId === 'shake')
assert.equal(shakeNode?.module, 'SHAKE_CLEAN')
assert.match(shakeNode?.progressText || '', /落砂 40\/60 件，清理 0\/40 件/)
assert.equal(allModules.find((node) => node.nodeId === 'inspection')?.action, 'VIEW')
const noWarningMeltFixture = summarizeWorkOrderExecution({
  id: 'wo-no-warning-melt',
  plannedQuantity: 100,
  meltReleasedAt: null,
  routingVersion: {
    nodes: [{ id: 'melt-no-warning', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼', section: '熔炼' } }],
  },
  bomVersion: { coreBoxes: [] },
  coreTasks: [],
  allocations: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
assert.equal(noWarningMeltFixture[0]?.actionHint, '', 'unreleased melt node must not show stale core/drying warning without real warnings')
const canceledMeltFixture = summarizeWorkOrderExecution({
  id: 'wo-canceled-melt',
  plannedQuantity: 100,
  meltReleasedAt: '2026-08-26T08:00:00.000Z',
  routingVersion: {
    nodes: [{ id: 'melt', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼', section: '熔炼' } }],
  },
  bomVersion: { coreBoxes: [] },
  allocations: [{ workOrderId: 'wo-canceled-melt', allocatedQuantity: 100, heatOrder: { status: 'CANCELED', furnaceNameSnapshot: '已取消熔炉', teamNameSnapshot: '已取消班组' } }],
  coreTasks: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
const canceledMeltNode = canceledMeltFixture.find((node) => node.nodeId === 'melt')
assert.equal(canceledMeltNode?.progressStatus, 'CANCELED', 'only canceled melt heats must show canceled progress')
assert.equal(canceledMeltNode?.action, 'VIEW', 'only canceled melt heats must be view-only')

const unreleasedMeltFixture = summarizeWorkOrderExecution({
  id: 'wo-unreleased-melt',
  plannedQuantity: 100,
  meltReleasedAt: null,
  routingVersion: { nodes: [{ id: 'melt', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼', section: '熔炼' } }] },
  bomVersion: { coreBoxes: [] },
  coreTasks: [],
  allocations: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
assert.equal(unreleasedMeltFixture[0]?.action, 'RELEASE_MELT')
assert.equal(unreleasedMeltFixture[0]?.actionPermission, 'production.schedule.release', 'RELEASE_MELT action must use schedule release permission')

const multiMeltFixture = summarizeWorkOrderExecution({
  id: 'wo-multi-melt',
  plannedQuantity: 10,
  meltReleasedAt: '2026-08-26T08:00:00.000Z',
  routingVersion: {
    nodes: [
      { id: 'melt-a', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼A', section: '熔炼' } },
      { id: 'melt-b', seqNo: 20, operationCode: 'OP-MELT', operation: { name: '电炉熔炼B', section: '熔炼' } },
    ],
  },
  bomVersion: { coreBoxes: [] },
  allocations: [
    { workOrderId: 'wo-multi-melt', routingNodeId: 'melt-a', allocatedQuantity: 4, heatOrder: { status: 'IN_PROGRESS', furnaceNameSnapshot: '熔炉A', teamNameSnapshot: '甲班' } },
    { workOrderId: 'wo-multi-melt', routingNodeId: 'melt-b', allocatedQuantity: 6, heatOrder: { status: 'IN_PROGRESS', furnaceNameSnapshot: '熔炉B', teamNameSnapshot: '乙班' } },
  ],
  meltReleases: [{ routingNodeId: 'melt-a', releasedAt: '2026-08-26T08:00:00.000Z', releasedByUserId: 'release-user' }],
  coreTasks: [],
  moldingTasks: [],
  pouringMoldBatches: [],
  pouringReports: [],
  shakeBatches: [],
  shakeReports: [],
  cleaningBatches: [],
  cleaningReports: [],
  inspectionBatches: [],
  inspectionReports: [],
})
const meltANode = multiMeltFixture.find((node) => node.nodeId === 'melt-a')
const meltBNode = multiMeltFixture.find((node) => node.nodeId === 'melt-b')
assert.equal(meltANode?.progressCurrent, 4, 'melt node A must only aggregate its own allocations')
assert.equal(meltANode?.action, 'VIEW', 'released melt node A must be viewable')
assert.equal(meltBNode?.action, 'RELEASE_MELT', 'unreleased melt node B must remain releasable')
assert.equal(meltBNode?.progressCurrent, null, 'unreleased melt node B must not aggregate allocations')
assert.deepEqual(meltANode?.equipmentNames, ['熔炉A'])
assert.deepEqual(meltBNode?.equipmentNames, [])
assert.deepEqual(releasedMeltRoutingNodeIds({
  meltReleasedAt: '2026-08-26T08:00:00.000Z',
  routingVersion: { nodes: [{ id: 'melt-a', operationCode: 'OP-MELT' }, { id: 'melt-b', operationCode: 'OP-MELT' }] },
  meltReleases: [{ routingNodeId: 'melt-a' }],
}), ['melt-a'], 'melt pool must return only explicitly released node A')
assert.deepEqual(releasedMeltRoutingNodeIds({
  meltReleasedAt: '2026-08-26T08:00:00.000Z',
  routingVersion: { nodes: [{ id: 'melt-a', operationCode: 'OP-MELT' }, { id: 'melt-b', operationCode: 'OP-MELT' }] },
  meltReleases: [],
}), [], 'legacy work-order release must not guess a node in a multi-melt route')
const fullNamesFixture = summarizeWorkOrderExecution({
  id: 'wo-full-names',
  plannedQuantity: 10,
  meltReleasedAt: '2026-08-26T08:00:00.000Z',
  routingVersion: { nodes: [{ id: 'melt-full', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼', section: '熔炼' } }] },
  bomVersion: { coreBoxes: [] },
  allocations: [
    { workOrderId: 'wo-full-names', routingNodeId: 'melt-full', allocatedQuantity: 2, heatOrder: { status: 'IN_PROGRESS', furnaceNameSnapshot: '熔炉A', teamNameSnapshot: '甲班' } },
    { workOrderId: 'wo-full-names', routingNodeId: 'melt-full', allocatedQuantity: 3, heatOrder: { status: 'IN_PROGRESS', furnaceNameSnapshot: '熔炉B', teamNameSnapshot: '乙班' } },
    { workOrderId: 'wo-full-names', routingNodeId: 'melt-full', allocatedQuantity: 5, heatOrder: { status: 'IN_PROGRESS', furnaceNameSnapshot: '熔炉C', teamNameSnapshot: '丙班' } },
  ],
  coreTasks: [], moldingTasks: [], pouringMoldBatches: [], pouringReports: [], shakeBatches: [], shakeReports: [], cleaningBatches: [], cleaningReports: [], inspectionBatches: [], inspectionReports: [],
})
assert.deepEqual(fullNamesFixture[0]?.equipmentNames, ['熔炉A', '熔炉B', '熔炉C'], 'summary must return all equipment names')
assert.deepEqual(fullNamesFixture[0]?.teamNames, ['甲班', '乙班', '丙班'], 'summary must return all team names')
console.log('Work-order routing execution summary helpers passed')

async function verifyMeltReleaseBehavior() {
  const state = {
    productionStatus: 'RELEASED',
    meltReleasedAt: null,
    meltReleasedByUserId: null,
    hasMeltNode: true,
    meltNodes: [{ id: 'melt' }],
    meltReleaseRecords: [],
  }
  const executionContext = {
    id: 'wo-release-test',
    plannedQuantity: 10,
    meltReleasedAt: null,
    routingVersion: { nodes: [{ id: 'melt', seqNo: 10, operationCode: 'OP-MELT', operation: { name: '电炉熔炼', section: '熔炼' } }] },
    meltReleases: [],
    bomVersion: { coreBoxes: [] },
    coreTasks: [],
    allocations: [],
    moldingTasks: [],
    pouringMoldBatches: [],
    pouringReports: [],
    shakeBatches: [],
    shakeReports: [],
    cleaningBatches: [],
    cleaningReports: [],
    inspectionBatches: [],
    inspectionReports: [],
  }
  const request = { adminUser: { id: 'release-user', name: 'release-user', username: 'admin', userType: 'SUPER_ADMIN', departmentId: null, permissions: [], dataScope: 'ALL', dataScopes: ['ALL'], customDepartments: [] } }
  const prisma = {
    $transaction: async (callback) => callback({
      $queryRaw: async () => [{ id: 'wo-release-test' }],
      workOrder: {
        findUnique: async (args) => args.select ? state : { ...executionContext, meltReleasedAt: state.meltReleasedAt },
        updateMany: async (args) => {
          state.meltReleasedAt = args.data.meltReleasedAt
          state.meltReleasedByUserId = args.data.meltReleasedByUserId
          return { count: 1 }
        },
      },
      workOrderMeltRelease: {
        findUnique: async ({ where }) => state.meltReleaseRecords.find((item) => item.workOrderId === where.workOrderId_routingNodeId.workOrderId && item.routingNodeId === where.workOrderId_routingNodeId.routingNodeId) || null,
        create: async ({ data }) => {
          const record = { id: `release-${state.meltReleaseRecords.length + 1}`, ...data }
          state.meltReleaseRecords.push(record)
          return record
        },
      },
      processRoutingNode: {
        count: async () => state.hasMeltNode ? state.meltNodes.length : 0,
        findMany: async () => state.hasMeltNode ? state.meltNodes : [],
      },
      coreProductionTask: { findMany: async () => [{ status: 'IN_PROGRESS' }] },
      coreInventoryBatch: { count: async () => 1 },
    }),
    workOrder: {
      findUnique: async () => ({ ...executionContext, meltReleasedAt: state.meltReleasedAt, meltReleases: state.meltReleaseRecords }),
    },
    processRoutingNode: { count: async () => 1, findMany: async () => state.meltNodes },
    coreProductionTask: { findMany: async () => [{ status: 'IN_PROGRESS' }] },
    coreInventoryBatch: { count: async () => 1 },
  }
  const service = new WorkOrderRoutingExecutionService(prisma)
  const first = await service.releaseMelt(request, 'wo-release-test')
  assert.equal(first.released, true)
  assert.equal(first.alreadyReleased, false)
  assert.equal(first.meltReleasedByUserId, 'release-user')
  assert.deepEqual(first.warnings.map((warning) => warning.code), ['CORE_INCOMPLETE', 'CORE_DRYING_PENDING'])
  assert.equal(first.nodes[0]?.action, 'VIEW')

  const second = await service.releaseMelt(request, 'wo-release-test')
  assert.equal(second.released, false)
  assert.equal(second.alreadyReleased, true)
  assert.equal(second.meltReleasedAt, first.meltReleasedAt)

  state.productionStatus = 'CLOSED'
  await assert.rejects(() => service.releaseMelt(request, 'wo-release-test'), /已关闭的生产工单不能下达熔炼排产/)
  state.productionStatus = 'RELEASED'
  state.meltReleasedAt = null
  state.hasMeltNode = false
  await assert.rejects(() => service.releaseMelt(request, 'wo-release-test'), /工艺路线不包含熔炼工序/)
  state.hasMeltNode = true
  state.meltNodes = [{ id: 'melt-a' }, { id: 'melt-b' }]
  await assert.rejects(() => service.releaseMelt(request, 'wo-release-test'), /多个熔炼工序，请明确选择熔炼工序/)
  const selected = await service.releaseMelt(request, 'wo-release-test', 'melt-b')
  assert.equal(selected.routingNodeId, 'melt-b')
  await assert.rejects(() => service.releaseMelt(request, 'wo-release-test', 'not-on-route'), /不属于工单锁定路线/)
  console.log('Work-order melt release behavior passed')
}

await verifyMeltReleaseBehavior()

async function verifyMeltPoolIntegration(databaseUrl) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  let temporarilyUnreleasedId = null
  let temporarilyUnreleasedAt = null
  const rollbackMessage = 'WORK_ORDER_MELT_RELEASE_TEST_ROLLBACK'
  try {
    await prisma.$transaction(async (tx) => {
      const candidates = await tx.workOrder.findMany({
        where: { productionStatus: { not: 'CLOSED' } },
        select: { id: true, meltReleasedAt: true, plannedQuantity: true, scheduledQuantity: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      const released = candidates.find((item) => item.meltReleasedAt && item.scheduledQuantity < item.plannedQuantity)
      const candidateForUnreleased = candidates.find((item) => item.id !== released?.id && item.scheduledQuantity < item.plannedQuantity)
      if (!released || !candidateForUnreleased) throw new Error('Work-order melt pool integration requires two open work orders')

      temporarilyUnreleasedId = candidateForUnreleased.id
      temporarilyUnreleasedAt = candidateForUnreleased.meltReleasedAt
      await tx.workOrder.update({ where: { id: temporarilyUnreleasedId }, data: { meltReleasedAt: null } })

      const { ProductionService } = await import('../dist/production/production.service.js')
      const service = new ProductionService(tx)
      const allAccessRequest = { adminUser: {
        id: 'integration-test',
        name: 'integration-test',
        username: 'admin',
        userType: 'SUPER_ADMIN',
        departmentId: null,
        permissions: [],
        dataScope: 'ALL',
        dataScopes: ['ALL'],
        customDepartments: [],
      } }
      const pool = await service.meltPool(allAccessRequest)
      const poolOrderIds = new Set(pool.groups.flatMap((group) => group.orders.map((order) => order.id)))
      assert.equal(poolOrderIds.has(released.id), true, 'released open work order must be present in melt pool')
      assert.equal(poolOrderIds.has(temporarilyUnreleasedId), false, 'unreleased open work order must be absent from melt pool')
      const workOrderList = await service.listWorkOrders(allAccessRequest)
      assert.equal(workOrderList.some((order) => order.id === temporarilyUnreleasedId), true, 'unreleased work order must remain in the normal work-order list')

      const restrictedRequest = { adminUser: {
        id: 'integration-restricted-user',
        name: 'integration-restricted-user',
        username: 'integration-restricted-user',
        userType: 'EMPLOYEE',
        departmentId: null,
        permissions: [],
        dataScope: 'OWN',
        dataScopes: ['OWN'],
        customDepartments: [],
      } }
      const restrictedPool = await service.meltPool(restrictedRequest)
      const restrictedOrderIds = new Set(restrictedPool.groups.flatMap((group) => group.orders.map((order) => order.id)))
      assert.equal(restrictedOrderIds.has(released.id), false, 'released order outside SELF scope must not be returned')

      throw new Error(rollbackMessage)
    })
    throw new Error('melt pool integration transaction unexpectedly committed')
  } finally {
    if (temporarilyUnreleasedId) {
      const restored = await prisma.workOrder.findUnique({ where: { id: temporarilyUnreleasedId }, select: { meltReleasedAt: true } })
      assert.equal(restored?.meltReleasedAt?.getTime() ?? null, temporarilyUnreleasedAt?.getTime() ?? null, 'melt pool integration must not persist temporary changes')
    }
    await prisma.$disconnect()
  }
}

await verifyDatabaseMetadata(databaseUrl)
try {
  await verifyMeltPoolIntegration(databaseUrl)
} catch (error) {
  if (!(error instanceof Error) || error.message !== 'WORK_ORDER_MELT_RELEASE_TEST_ROLLBACK') throw error
  console.log('Work-order melt pool integration passed')
}
