#!/usr/bin/env node

const baseUrl = process.env.MINGDA_API_BASE_URL || 'http://124.223.2.193/api'
const adminUsername = process.env.MINGDA_ADMIN_USERNAME || 'admin'
const adminPassword = process.env.MINGDA_ADMIN_PASSWORD || '13665068911'
const limitedUsername = process.env.MINGDA_LIMITED_USERNAME || '13600003333'
const limitedPassword = process.env.MINGDA_LIMITED_PASSWORD || '13600003333'
const limitedRoleName = process.env.MINGDA_LIMITED_ROLE_NAME || '生产管理'

const results = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

async function api(path, options = {}) {
  const { response, payload } = await request(path, options)
  if (!response.ok || payload?.code !== 0) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${payload?.message || ''}`)
  }
  return payload.data
}

async function expectCase(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function rolePayload(role, overrides = {}) {
  return {
    name: role.name,
    organization: role.organization,
    app: role.app,
    description: role.description,
    permissions: role.permissions,
    dataScope: role.dataScope,
    dataScopes: role.dataScopes?.length ? role.dataScopes : [role.dataScope],
    customDepartments: role.customDepartments || [],
    columnPermissions: role.columnPermissions || [],
    userIds: role.userIds || [],
    ...overrides,
  }
}

function withPermissions(role, permissions) {
  return Array.from(new Set([...(role.permissions || []), ...permissions]))
}

async function main() {
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: adminUsername, password: adminPassword },
  })
  const adminToken = adminLogin.token
  assert(adminToken, '管理员登录未返回 token')

  const limitedLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: limitedUsername, password: limitedPassword },
  })
  const limitedToken = limitedLogin.token
  assert(limitedToken, '受限用户登录未返回 token')

  const roles = await api('/admin/roles', { token: adminToken })
  const targetRole = roles.find((role) => role.name === limitedRoleName)
  assert(targetRole, `未找到测试角色：${limitedRoleName}`)
  const originalRole = structuredClone(targetRole)

  let createdWorkshopCode = ''

  try {
    await expectCase('角色可保存并返回多个数据行权限', async () => {
      const updated = await api(`/admin/roles/${targetRole.id}`, {
        method: 'PUT',
        token: adminToken,
        body: rolePayload(targetRole, {
          permissions: withPermissions(targetRole, [
            'model.workshop-line.view',
            'model.workshop-line.create',
            'model.workshop-line.delete',
          ]),
          dataScope: 'self',
          dataScopes: ['self', 'custom_departments'],
        }),
      })
      assert(Array.isArray(updated.dataScopes), '角色返回缺少 dataScopes')
      assert(updated.dataScopes.includes('self'), 'dataScopes 缺少 self')
      assert(updated.dataScopes.includes('custom_departments'), 'dataScopes 缺少 custom_departments')
    })

    await expectCase('受限用户重新登录返回多个数据行权限', async () => {
      const relogin = await api('/auth/login', {
        method: 'POST',
        body: { username: limitedUsername, password: limitedPassword },
      })
      assert(Array.isArray(relogin.user?.dataScopes), '登录返回缺少 user.dataScopes')
      assert(relogin.user.dataScopes.includes('self'), '登录 dataScopes 缺少 self')
      assert(relogin.user.dataScopes.includes('custom_departments'), '登录 dataScopes 缺少 custom_departments')
    })

    await expectCase('无基础资料权限时用户列表被拒绝', async () => {
      const { response, payload } = await request('/admin/users', { token: limitedToken })
      assert(response.status === 403, `预期 403，实际 ${response.status}: ${payload?.message || ''}`)
    })

    await expectCase('本人数据范围不返回历史全量建模数据', async () => {
      const records = await api('/admin/modeling/workshops', { token: limitedToken })
      assert(Array.isArray(records), '车间列表响应不是数组')
      assert(records.length === 0, `预期无历史全量数据，实际 ${records.length} 条`)
    })

    await expectCase('只有车间数据列表权限时新增接口被拒绝', async () => {
      await api(`/admin/roles/${targetRole.id}`, {
        method: 'PUT',
        token: adminToken,
        body: rolePayload(targetRole, {
          permissions: ['model.workshop-line.view'],
          dataScope: 'self',
          dataScopes: ['self'],
        }),
      })
      const relogin = await api('/auth/login', {
        method: 'POST',
        body: { username: limitedUsername, password: limitedPassword },
      })
      const { response, payload } = await request('/admin/modeling/workshops', {
        method: 'POST',
        token: relogin.token,
        body: {
          code: `DENY${Date.now().toString().slice(-6)}`,
          name: '无新增权限测试车间',
          type: '熔炼',
          status: '启用',
        },
      })
      assert(response.status === 403, `预期 403，实际 ${response.status}: ${payload?.message || ''}`)
    })

    await expectCase('受限用户只看到自己创建的数据', async () => {
      await api(`/admin/roles/${targetRole.id}`, {
        method: 'PUT',
        token: adminToken,
        body: rolePayload(targetRole, {
          permissions: withPermissions(targetRole, [
            'model.workshop-line.view',
            'model.workshop-line.create',
            'model.workshop-line.delete',
          ]),
          dataScope: 'self',
          dataScopes: ['self', 'custom_departments'],
        }),
      })
      const relogin = await api('/auth/login', {
        method: 'POST',
        body: { username: limitedUsername, password: limitedPassword },
      })
      createdWorkshopCode = `AUTOPERM${Date.now().toString().slice(-6)}`
      await api('/admin/modeling/workshops', {
        method: 'POST',
        token: relogin.token,
        body: {
          code: createdWorkshopCode,
          name: '自动化权限测试车间',
          type: '熔炼',
          status: '启用',
        },
      })
      const records = await api('/admin/modeling/workshops', { token: relogin.token })
      assert(records.some((record) => record.code === createdWorkshopCode), '未看到自己创建的测试车间')
      assert(records.every((record) => record.code === createdWorkshopCode), '列表包含非本人归属数据')
    })
  } finally {
    if (createdWorkshopCode) {
      await request(`/admin/modeling/workshops/${createdWorkshopCode}`, {
        method: 'DELETE',
        token: limitedToken,
      })
    }
    await request(`/admin/roles/${originalRole.id}`, {
      method: 'PUT',
      token: adminToken,
      body: rolePayload(originalRole),
    })
  }

  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} permission tests passed.`)
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
