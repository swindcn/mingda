import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('小程序权限树包含模具开发数据列表权限', () => {
  const roles = read('apps/admin/src/utils/roles.ts')
  const defaults = read('apps/api/src/shared/admin-default-permissions.ts')
  assert.match(roles, /mini\.mold\.development\.view/)
  assert.match(roles, /模具开发-数据列表/)
  assert.match(defaults, /mini\.mold\.development\.view/)
})

test('移动端模具接口强制校验小程序模具开发权限', () => {
  const controller = read('apps/api/src/mold-development.controller.ts')
  assert.match(controller, /requireMobileMoldViewPermission/)
  assert.match(controller, /mini\.mold\.development\.view/)
  assert.match(controller, /mobile\/molds/)
})
