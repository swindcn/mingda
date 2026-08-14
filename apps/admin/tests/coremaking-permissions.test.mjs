import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(adminRoot, '../..')

function sourceFile(relativePath, scriptKind = ts.ScriptKind.TS) {
  const filePath = path.join(repoRoot, relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind)
}

function variableInitializers(source) {
  const values = new Map()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) values.set(declaration.name.text, declaration.initializer)
    }
  }
  return values
}

function literalModuleValues(source) {
  const initializers = variableInitializers(source)
  const cache = new Map()

  function evaluate(node) {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
      return evaluate(node.expression)
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isIdentifier(node)) return get(node.text)
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.flatMap((element) => ts.isSpreadElement(element) ? evaluate(element.expression) : [evaluate(element)])
    }
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(node.properties.flatMap((property) => {
        if (!ts.isPropertyAssignment(property)) return []
        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
        return name ? [[name, evaluate(property.initializer)]] : []
      }))
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return undefined
    return undefined
  }

  function get(name) {
    if (cache.has(name)) return cache.get(name)
    const initializer = initializers.get(name)
    assert.ok(initializer, `missing literal variable ${name}`)
    const value = evaluate(initializer)
    cache.set(name, value)
    return value
  }

  return { get }
}

function flattenPermissionTree(nodes) {
  return nodes.flatMap((node) => [node.key, ...flattenPermissionTree(node.children || [])])
}

function treeNode(nodes, key) {
  for (const node of nodes) {
    if (node.key === key) return node
    const child = treeNode(node.children || [], key)
    if (child) return child
  }
  return undefined
}

function compileCoremakingClient() {
  const filePath = path.join(adminRoot, 'src/utils/coremaking.ts')
  const source = fs.readFileSync(filePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const calls = []
  const apiRequest = (requestPath, options) => {
    calls.push({ path: requestPath, options })
    return { requestPath, options }
  }
  const module = { exports: {} }
  const require = (specifier) => {
    assert.equal(specifier, '../services/api')
    return { apiRequest }
  }
  Function('require', 'module', 'exports', output)(require, module, module.exports)
  return { client: module.exports, calls }
}

function compilePermissionResolver() {
  const source = sourceFile('apps/api/src/production/production-permission.guard.ts')
  const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'permissionFor')
  assert.ok(declaration, 'permissionFor should remain a standalone pure resolver')
  const output = ts.transpileModule(`${declaration.getText(source)}\nexports.permissionFor = permissionFor`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  Function('exports', 'NotFoundException', output)(exports, class NotFoundException extends Error {})
  return exports.permissionFor
}

const adminPermissionKeys = [
  'production.core_task.view',
  'production.core_task.create',
  'production.core_task.dispatch',
  'production.core_task.edit',
  'production.core_task.cancel',
  'production.core_task.start',
  'production.core_task.report',
  'production.core_task.dry',
  'production.core_inventory.view',
  'production.core_inventory.dry',
  'production.core_inventory.lock',
  'production.core_inventory.scrap',
]

const miniPermissionKeys = [
  'mini.production.core.view',
  'mini.production.core.start',
  'mini.production.core.report',
  'mini.production.core.dry',
]

test('backend administrator defaults grant every coremaking permission', () => {
  const expectedPermissions = [...adminPermissionKeys, ...miniPermissionKeys]
  const defaultSources = [
    'apps/api/src/basic-data.controller.ts',
    'apps/api/src/mold-development.controller.ts',
  ]

  for (const relativePath of defaultSources) {
    const permissions = literalModuleValues(sourceFile(relativePath)).get('adminPermissions')
    assert.deepEqual(
      expectedPermissions.filter((permission) => !permissions.includes(permission)),
      [],
      `${relativePath} should grant all coremaking permissions`,
    )
  }
})

test('coremaking permissions are selectable and granted to the default administrator', () => {
  const roles = literalModuleValues(sourceFile('apps/admin/src/utils/roles.ts'))
  const productionKeys = roles.get('productionPermissionKeys')
  const miniKeys = roles.get('miniProgramPermissionKeys')
  const adminTree = roles.get('adminPermissionTree')
  const miniTree = roles.get('miniProgramPermissionTree')
  const defaultAdmin = roles.get('initialRoles').find((role) => role.name === '系统管理员')

  assert.deepEqual(adminPermissionKeys.filter((key) => !productionKeys.includes(key)), [])
  assert.deepEqual(miniPermissionKeys.filter((key) => !miniKeys.includes(key)), [])
  assert.deepEqual(adminPermissionKeys.filter((key) => !flattenPermissionTree(adminTree).includes(key)), [])
  assert.deepEqual(miniPermissionKeys.filter((key) => !flattenPermissionTree(miniTree).includes(key)), [])
  assert.deepEqual([...adminPermissionKeys, ...miniPermissionKeys].filter((key) => !defaultAdmin.permissions.includes(key)), [])

  const taskGroup = treeNode(adminTree, 'group.production.core_task')
  const inventoryGroup = treeNode(adminTree, 'group.production.core_inventory')
  assert.deepEqual(taskGroup.children.map((node) => node.key), adminPermissionKeys.slice(0, 8))
  assert.deepEqual(inventoryGroup.children.map((node) => node.key), adminPermissionKeys.slice(8))
  assert.equal(new Set(adminPermissionKeys).size, adminPermissionKeys.length)
})

test('coremaking navigation and routes require their own view permissions', () => {
  const menu = literalModuleValues(sourceFile('apps/admin/src/layouts/AppLayout.tsx', ts.ScriptKind.TSX)).get('allMenuItems')
  const productionMenu = menu.find((item) => item.key === '/dashboard/production')
  assert.deepEqual(
    productionMenu.children.filter((item) => item.key.includes('/core-')).map(({ key, label, permission }) => ({ key, label, permission })),
    [
      { key: '/dashboard/production/core-tasks', label: '制芯任务', permission: 'production.core_task.view' },
      { key: '/dashboard/production/core-inventory', label: '砂芯库存', permission: 'production.core_inventory.view' },
    ],
  )

  const app = sourceFile('apps/admin/src/App.tsx', ts.ScriptKind.TSX)
  const guardedRoutes = new Map()
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === 'Route') {
      const attributes = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(app), attribute.initializer]))
      const routePath = attributes.get('path')
      const element = attributes.get('element')
      if (routePath && ts.isStringLiteral(routePath) && element && ts.isJsxExpression(element) && ts.isCallExpression(element.expression)) {
        const call = element.expression
        if (call.expression.getText(app) === 'protectedPage' && ts.isStringLiteral(call.arguments[0])) {
          guardedRoutes.set(routePath.text, call.arguments[0].text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(app)

  assert.equal(guardedRoutes.get('production/core-tasks'), 'production.core_task.view')
  assert.equal(guardedRoutes.get('production/core-tasks/:id'), 'production.core_task.view')
  assert.equal(guardedRoutes.get('production/core-inventory'), 'production.core_inventory.view')
})

test('production guard resolves the minimum permission for every coremaking path', () => {
  const permissionFor = compilePermissionResolver()
  const cases = [
    ['POST', '/admin/production/work-orders/wo-1/core-tasks/preview', 'production.core_task.create'],
    ['POST', '/admin/production/work-orders/wo-1/core-tasks', 'production.core_task.create'],
    ['GET', '/admin/production/core-tasks', 'production.core_task.view'],
    ['GET', '/admin/production/core-tasks/task-1', 'production.core_task.view'],
    ['PUT', '/admin/production/core-tasks/task-1/dispatch', 'production.core_task.dispatch'],
    ['POST', '/admin/production/core-tasks/task-1/cancel', 'production.core_task.cancel'],
    ['POST', '/admin/production/core-tasks/task-1/start', 'production.core_task.start'],
    ['POST', '/admin/production/core-tasks/task-1/report', 'production.core_task.report'],
    ['GET', '/admin/production/core-inventory', 'production.core_inventory.view'],
    ['GET', '/admin/production/core-inventory/batch-1', 'production.core_inventory.view'],
    ['POST', '/admin/production/core-batches/batch-1/dry', 'production.core_inventory.dry'],
    ['POST', '/admin/production/core-batches/batch-1/lock', 'production.core_inventory.lock'],
    ['POST', '/admin/production/core-batches/batch-1/unlock', 'production.core_inventory.lock'],
    ['POST', '/admin/production/core-batches/batch-1/scrap', 'production.core_inventory.scrap'],
    ['GET', '/admin/production/work-orders/wo-1/core-readiness', 'production.work_order.view'],
    ['GET', '/mini/production/core-tasks', 'mini.production.core.view'],
    ['POST', '/mini/production/core-tasks/task-1/start', 'mini.production.core.start'],
    ['POST', '/mini/production/core-tasks/task-1/report', 'mini.production.core.report'],
    ['POST', '/mini/production/core-batches/batch-1/dry', 'mini.production.core.dry'],
  ]

  for (const [method, requestPath, permission] of cases) {
    assert.equal(permissionFor({ method, path: requestPath }), permission, `${method} ${requestPath}`)
  }
  const operationPermissions = cases.filter(([method]) => method !== 'GET').map(([, , permission]) => permission)
  assert.equal(operationPermissions.includes('production.core_task.view'), false)
  assert.equal(operationPermissions.includes('production.core_inventory.view'), false)
  assert.equal(operationPermissions.includes('production.core_inventory.manage'), false)
})

test('coremaking admin client covers task, readiness, reporting and paginated inventory APIs', () => {
  const { client, calls } = compileCoremakingClient()
  const rows = [{ coreBoxCode: 'CORE A', routingNodeId: 'node/1' }]
  const dispatch = { versionNo: 1, equipmentCode: 'EQ-1', teamCode: 'TEAM-1', plannedStartAt: '2026-08-14T08:00:00.000Z' }
  const report = { versionNo: 2, qualifiedQuantity: 10, scrapQuantity: 1, shiftCode: 'DAY', dryingRequired: true }

  client.fetchCoreReadiness('wo/1')
  client.previewCoreTasks('wo/1', { rows })
  client.createCoreTasks('wo/1', { rows })
  client.fetchCoreTasks({ keyword: '水 道', status: 'WAITING', workOrderId: 'wo/1' })
  client.fetchCoreTask('task/1')
  client.dispatchCoreTask('task/1', dispatch)
  client.cancelCoreTask('task/1', { versionNo: 2, reason: '调整计划' })
  client.startCoreTask('task/1', { versionNo: 2 })
  client.reportCoreTask('task/1', report)
  client.fetchCoreInventory({ page: 2, pageSize: 50, status: 'WARNING', keyword: '水 道' })
  client.fetchCoreInventoryBatch('batch/1')
  client.dryCoreBatch('batch/1', { versionNo: 1, equipmentCode: 'DRY-1' })
  client.lockCoreBatch('batch/1', { versionNo: 2, reason: '复检' })
  client.unlockCoreBatch('batch/1', { versionNo: 3 })
  client.scrapCoreBatch('batch/1', { versionNo: 4, reason: '超差' })

  assert.deepEqual(calls.map(({ path: requestPath }) => requestPath), [
    '/admin/production/work-orders/wo%2F1/core-readiness',
    '/admin/production/work-orders/wo%2F1/core-tasks/preview',
    '/admin/production/work-orders/wo%2F1/core-tasks',
    '/admin/production/core-tasks?keyword=%E6%B0%B4+%E9%81%93&status=WAITING&workOrderId=wo%2F1',
    '/admin/production/core-tasks/task%2F1',
    '/admin/production/core-tasks/task%2F1/dispatch',
    '/admin/production/core-tasks/task%2F1/cancel',
    '/admin/production/core-tasks/task%2F1/start',
    '/admin/production/core-tasks/task%2F1/report',
    '/admin/production/core-inventory?page=2&pageSize=50&status=WARNING&keyword=%E6%B0%B4+%E9%81%93',
    '/admin/production/core-inventory/batch%2F1',
    '/admin/production/core-batches/batch%2F1/dry',
    '/admin/production/core-batches/batch%2F1/lock',
    '/admin/production/core-batches/batch%2F1/unlock',
    '/admin/production/core-batches/batch%2F1/scrap',
  ])
  assert.deepEqual(calls.map(({ options }) => options?.method || 'GET'), [
    'GET', 'POST', 'POST', 'GET', 'GET', 'PUT', 'POST', 'POST', 'POST', 'GET', 'GET', 'POST', 'POST', 'POST', 'POST',
  ])
  assert.deepEqual(JSON.parse(calls[5].options.body), dispatch)
  assert.deepEqual(JSON.parse(calls[8].options.body), report)
})
