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

function compileProductionPermissionMatcher() {
  const source = sourceFile('apps/api/src/production/production-permission.guard.ts')
  const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'hasAnyProductionPermission')
  assert.ok(declaration, 'guard should use a standalone has-any permission matcher')
  const output = ts.transpileModule(`${declaration.getText(source)}\nexports.hasAnyProductionPermission = hasAnyProductionPermission`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  Function('exports', 'hasAdminPermission', output)(exports, (user, permission) => user.permissions.includes(permission))
  return exports.hasAnyProductionPermission
}

function compileFirstAccessibleRoute() {
  const source = sourceFile('apps/admin/src/layouts/AppLayout.tsx', ts.ScriptKind.TSX)
  const declaration = source.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'firstAccessibleRoute',
  )
  assert.ok(declaration, 'firstAccessibleRoute should remain a standalone pure resolver')
  const output = ts.transpileModule(`${declaration.getText(source)}\nexports.firstAccessibleRoute = firstAccessibleRoute`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  Function('exports', output)(exports)
  return exports.firstAccessibleRoute
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

test('backend administrator defaults have one duplicate-free source covered by frontend defaults', () => {
  const defaultsPath = 'apps/api/src/shared/admin-default-permissions.ts'
  const defaultsFile = path.join(repoRoot, defaultsPath)
  assert.equal(fs.existsSync(defaultsFile), true, `${defaultsPath} should be the single permission list source`)

  const backendPermissions = literalModuleValues(sourceFile(defaultsPath)).get('ADMIN_DEFAULT_PERMISSIONS')
  assert.equal(new Set(backendPermissions).size, backendPermissions.length, 'backend administrator defaults should not contain duplicates')

  const apiSourceRoot = path.join(repoRoot, 'apps/api/src')
  const permissionListDefinitions = fs.readdirSync(apiSourceRoot, { recursive: true })
    .filter((relativePath) => typeof relativePath === 'string' && relativePath.endsWith('.ts'))
    .flatMap((relativePath) => {
      const source = fs.readFileSync(path.join(apiSourceRoot, relativePath), 'utf8')
      return /(?:const|let|var)\s+(?:adminPermissions|ADMIN_DEFAULT_PERMISSIONS)\s*(?::[^=]+)?=\s*\[/.test(source)
        ? [path.posix.join('apps/api/src', relativePath)]
        : []
    })
  assert.deepEqual(permissionListDefinitions, [defaultsPath])

  const controllerPaths = [
    'apps/api/src/basic-data.controller.ts',
    'apps/api/src/mold-development.controller.ts',
  ]
  for (const relativePath of controllerPaths) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    assert.match(source, /import \{ ADMIN_DEFAULT_PERMISSIONS \} from '\.\/shared\/admin-default-permissions'/)
    assert.doesNotMatch(source, /const adminPermissions\s*=\s*\[/)
    assert.match(source, /permissions: ADMIN_DEFAULT_PERMISSIONS/)
  }

  const frontendDefaults = literalModuleValues(sourceFile('apps/admin/src/utils/roles.ts'))
    .get('initialRoles')
    .find((role) => role.name === '系统管理员').permissions
  const pureGroupKeys = new Set(['admin', 'basic', 'mold', 'model', 'process', 'production', 'mini', 'mini.production'])
  const backendExecutablePermissions = backendPermissions.filter((permission) => !pureGroupKeys.has(permission))
  assert.deepEqual(
    backendExecutablePermissions.filter((permission) => !frontendDefaults.includes(permission)),
    [],
    'frontend administrator defaults should include every backend executable permission',
  )
  assert.deepEqual([...adminPermissionKeys, ...miniPermissionKeys].filter((permission) => !backendPermissions.includes(permission)), [])
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

test('dashboard and denied pages resolve the first permitted menu route without redirect loops', () => {
  const appLayout = sourceFile('apps/admin/src/layouts/AppLayout.tsx', ts.ScriptKind.TSX)
  const menu = literalModuleValues(appLayout).get('allMenuItems')
  const firstAccessibleRoute = compileFirstAccessibleRoute()

  assert.equal(
    firstAccessibleRoute(menu, (permission) => permission === 'production.core_task.view'),
    '/dashboard/production/core-tasks',
  )
  assert.equal(
    firstAccessibleRoute(menu, (permission) => ['production.work_order.view', 'production.core_task.view'].includes(permission)),
    '/dashboard/production/work-orders',
  )
  assert.equal(firstAccessibleRoute(menu, () => false), '/dashboard/resources/parser')

  const firstRouteByPermission = new Map()
  function collect(items) {
    for (const item of items) {
      if (item.children?.length) collect(item.children)
      else if (item.permission && !firstRouteByPermission.has(item.permission)) firstRouteByPermission.set(item.permission, item.key)
    }
  }
  collect(menu)
  for (const [permission, route] of firstRouteByPermission) {
    assert.equal(firstAccessibleRoute(menu, (candidate) => candidate === permission), route, permission)
  }

  const appSource = fs.readFileSync(path.join(adminRoot, 'src/App.tsx'), 'utf8')
  assert.equal((appSource.match(/<PermissionLanding/g) || []).length, 2, 'dashboard index and denied pages should share PermissionLanding')
  assert.doesNotMatch(appSource, /Navigate to="\/dashboard\/mold\/development"/)
  assert.match(appSource, /<Route path="\/login" element=\{<LoginPage \/>\} \/>/)
  assert.match(appSource, /if \(!authenticated\)[\s\S]*?<Navigate to="\/login" replace \/>/)
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
    ['POST', '/admin/production/core-batches/batch-1/dry', ['production.core_task.dry', 'production.core_inventory.dry']],
    ['POST', '/admin/production/core-batches/batch-1/lock', 'production.core_inventory.lock'],
    ['POST', '/admin/production/core-batches/batch-1/unlock', 'production.core_inventory.lock'],
    ['POST', '/admin/production/core-batches/batch-1/scrap', 'production.core_inventory.scrap'],
    ['GET', '/admin/production/work-orders/wo-1/core-readiness', 'production.work_order.view'],
    ['GET', '/mini/production/core-tasks', 'mini.production.core.view'],
    ['GET', '/mini/production/core-tasks/task-1', 'mini.production.core.view'],
    ['GET', '/mini/production/core-tasks/task-1/execution-options', 'mini.production.core.view'],
    ['GET', '/mini/production/core-tasks/task-1/drying-batches', 'mini.production.core.view'],
    ['POST', '/mini/production/core-tasks/task-1/start', 'mini.production.core.start'],
    ['POST', '/mini/production/core-tasks/task-1/report', 'mini.production.core.report'],
    ['POST', '/mini/production/core-batches/batch-1/dry', 'mini.production.core.dry'],
  ]

  for (const [method, requestPath, permission] of cases) {
    assert.deepEqual(permissionFor({ method, path: requestPath }), permission, `${method} ${requestPath}`)
  }
  for (const [method, requestPath, permission] of cases) {
    assert.deepEqual(permissionFor({ method, path: `${requestPath}/` }), permission, `${method} ${requestPath}/`)
    assert.deepEqual(permissionFor({ method, path: `${requestPath}///?source=test` }), permission, `${method} ${requestPath} query`)
  }

  const rejectedCases = [
    ['GET', '/admin/production/work-orders/wo-1/core-tasks/preview'],
    ['GET', '/admin/production/work-orders/wo-1/core-tasks'],
    ['POST', '/admin/production/core-tasks/task-1/dispatch'],
    ['GET', '/admin/production/core-tasks/task-1/cancel'],
    ['GET', '/admin/production/core-tasks/task-1/start'],
    ['GET', '/admin/production/core-tasks/task-1/report'],
    ['GET', '/admin/production/core-batches/batch-1/dry'],
    ['GET', '/admin/production/core-batches/batch-1/lock'],
    ['GET', '/admin/production/core-batches/batch-1/unlock'],
    ['GET', '/admin/production/core-batches/batch-1/scrap'],
    ['POST', '/admin/production/core-tasks/task-1/unknown'],
    ['POST', '/admin/production/core-tasks/task-1'],
  ]
  for (const [method, requestPath] of rejectedCases) {
    assert.throws(() => permissionFor({ method, path: requestPath }), undefined, `${method} ${requestPath}`)
  }
  const operationPermissions = cases.filter(([method]) => method !== 'GET').flatMap(([, , permission]) => permission)
  assert.equal(operationPermissions.includes('production.core_task.view'), false)
  assert.equal(operationPermissions.includes('production.core_inventory.view'), false)
  assert.equal(operationPermissions.includes('production.core_inventory.manage'), false)
})

test('admin batch drying accepts task or inventory dry permission but never view permission', () => {
  const permissionFor = compilePermissionResolver()
  const hasAnyProductionPermission = compileProductionPermissionMatcher()
  const requirement = permissionFor({ method: 'POST', path: '/admin/production/core-batches/batch-1/dry' })
  assert.equal(hasAnyProductionPermission({ permissions: ['production.core_task.dry'] }, requirement), true)
  assert.equal(hasAnyProductionPermission({ permissions: ['production.core_inventory.dry'] }, requirement), true)
  assert.equal(hasAnyProductionPermission({ permissions: ['production.core_task.view', 'production.core_inventory.view'] }, requirement), false)
  assert.equal(hasAnyProductionPermission({ permissions: [] }, requirement), false)
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
