import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma, PrismaClient } from '@prisma/client'

const apiRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8'))
const seedSource = readFileSync(resolve(apiRoot, 'scripts/seed-final-inspection-warehouses.mjs'), 'utf8')

const prisma = new PrismaClient()
const delegates = [
  'systemWarehouse',
  'inspectionBatch',
  'inspectionReport',
  'cleaningReworkTask',
  'blankInventoryBatch',
  'blankWarehouseReceipt',
  'scrapWriteOff',
  'returnMeltInventoryLedger',
]

try {
  assert.match(packageJson.scripts['test:final-inspection-execution'], /^npm run prisma:generate && /, 'model test must regenerate Prisma Client first')
  assert.match(seedSource, /prisma\.\$transaction\(async \(tx\)/, 'warehouse compatibility checks must run in an interactive transaction')
  assert.match(seedSource, /isolationLevel:\s*Prisma\.TransactionIsolationLevel\.Serializable/, 'warehouse seed must use Serializable isolation')
  assert.match(seedSource, /MAX_ATTEMPTS\s*=\s*3/, 'warehouse seed must cap retries at three attempts')
  assert.match(seedSource, /P2034/, 'warehouse seed must retry serialization conflicts')
  assert.match(seedSource, /tx\.systemWarehouse\.findMany/, 'warehouse compatibility reads must use the transaction client')
  assert.doesNotMatch(seedSource, /prisma\.systemWarehouse\.findMany/, 'warehouse compatibility reads must not happen outside the transaction')
  for (const delegate of delegates) {
    assert.ok(prisma[delegate], `${delegate} delegate is required`)
  }
  const enumValues = (name) => {
    const found = Prisma.dmmf.datamodel.enums.find((item) => item.name === name)
    assert.ok(found, `${name} enum is required`)
    return found.values.map((item) => item.name)
  }
  assert.deepEqual(enumValues('WarehouseType'), ['BLANK', 'RETURN_MELT'])
  assert.deepEqual(enumValues('WarehouseStatus'), ['ENABLED', 'DISABLED'])
  const model = (name) => Prisma.dmmf.datamodel.models.find((item) => item.name === name)
  const field = (modelName, fieldName) => {
    const found = model(modelName)?.fields.find((item) => item.name === fieldName)
    assert.ok(found, `${modelName}.${fieldName} is required`)
    return found
  }
  for (const name of [
    'productCode',
    'routingVersionId',
    'inspectionRoutingNodeId',
    'productCodeSnapshot',
    'routingCodeSnapshot',
    'routingNameSnapshot',
    'routingVersionSnapshot',
    'inspectionRoutingNodeCodeSnapshot',
    'inspectionRoutingNodeNameSnapshot',
    'operationCodeSnapshot',
  ]) {
    field('InspectionReport', name)
  }
  for (const name of ['product', 'routingVersion', 'inspectionRoutingNode']) {
    assert.equal(field('InspectionReport', name).kind, 'object', `InspectionReport.${name} must be a relation`)
    assert.equal(field('InspectionReport', name).relationOnDelete, 'Restrict', `InspectionReport.${name} must restrict deletes`)
  }
  assert.equal(field('InspectionReport', 'workOrder').relationOnDelete, 'Restrict', 'InspectionReport.workOrder must restrict deletes')
  assert.equal(field('InspectionReport', 'image').isList, false, 'InspectionReport.image must be singular')
  assert.equal(field('InspectionReportImage', 'inspectionReportId').isUnique, true, 'InspectionReportImage.inspectionReportId must be unique')
  for (const modelName of ['BlankInventoryLedger', 'ReturnMeltInventoryLedger']) {
    assert.equal(field(modelName, 'eventKey').isUnique, true, `${modelName}.eventKey must be unique`)
    for (const name of ['warehouseCodeSnapshot', 'warehouseNameSnapshot', 'productCodeSnapshot', 'productNameSnapshot', 'workOrderCodeSnapshot']) {
      field(modelName, name)
    }
    for (const name of ['warehouse', 'product', 'workOrder']) {
      assert.equal(field(modelName, name).relationOnDelete, 'Restrict', `${modelName}.${name} must restrict deletes`)
    }
  }
  assert.equal(field('ReturnMeltInventoryLedger', 'sourceWriteOff').relationOnDelete, 'Restrict', 'ReturnMeltInventoryLedger.sourceWriteOff must restrict deletes')
  for (const fieldName of ['scrapWeightKg']) {
    const found = field('InspectionReport', fieldName)
    assert.equal(found.type, 'Decimal', `InspectionReport.${fieldName} must be Decimal`)
    assert.deepEqual(found.nativeType, ['Decimal', ['14', '4']], `InspectionReport.${fieldName} must be Decimal(14,4)`)
  }
  for (const modelName of ['CleaningReworkReport', 'ReturnMeltInventoryLedger']) {
    for (const fieldName of modelName === 'CleaningReworkReport' ? ['scrapWeightKg'] : ['weightChangeKg', 'balanceAfterKg']) {
      const found = field(modelName, fieldName)
      assert.equal(found.type, 'Decimal', `${modelName}.${fieldName} must be Decimal`)
      assert.deepEqual(found.nativeType, ['Decimal', ['14', '4']], `${modelName}.${fieldName} must be Decimal(14,4)`)
    }
  }
  const serviceSource = readFileSync(resolve(apiRoot, 'src/production/final-inspection.service.ts'), 'utf8')
  const controllerSource = readFileSync(resolve(apiRoot, 'src/production/final-inspection.controller.ts'), 'utf8')
  assert.match(serviceSource, /class FinalInspectionService/, '终检服务必须存在')
  assert.match(serviceSource, /TransactionIsolationLevel\.Serializable/, '终检写入必须使用串行化事务')
  assert.match(serviceSource, /eventKey/, '库存流水必须使用事件键防重')
  assert.match(serviceSource, /OP-INSP/, '终检缺陷必须绑定终检工序')
  assert.match(serviceSource, /canViewRework/, '终检详情必须按清理返修查看权限裁剪返修数据')
  assert.match(serviceSource, /allowedActions/, '终检与返修动作必须由服务端返回')
  assert.match(controllerSource, /inspection\/reports/, '终检报工接口必须存在')
  assert.match(controllerSource, /cleaning-rework\/reports/, '清理返修报工接口必须存在')
  process.stdout.write(`${JSON.stringify({ ok: true, suite: 'final-inspection-execution-models' })}\n`)
} finally {
  await prisma.$disconnect()
}
