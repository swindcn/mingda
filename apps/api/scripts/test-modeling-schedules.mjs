const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
const suffix = Date.now().toString(36)
const shiftCode = `TEST-SHIFT-${suffix}`
const scheduleDate = '2099-01-01'
let token
let scheduleId

async function request(path, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => null)
  if (response.status !== expectedStatus) throw new Error(`${path} 应返回 ${expectedStatus}，实际 ${response.status}: ${JSON.stringify(body)}`)
  if (expectedStatus >= 200 && expectedStatus < 300 && body?.code !== 0) throw new Error(`${path} 返回业务错误: ${JSON.stringify(body)}`)
  return body?.data
}

try {
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: '13665068911' }),
  }, 201)
  token = login.token

  const options = await request('/admin/modeling/options')
  if (!options.workshops.some((item) => item.code === 'WS-CORE-01')) throw new Error('建模选项缺少制芯车间')
  if (!options.teams.some((item) => item.code === 'TEAM-CORE-A')) throw new Error('建模选项缺少制芯班组')

  const createdShift = await request('/admin/modeling/shifts', {
    method: 'POST',
    body: JSON.stringify({ code: shiftCode, name: '测试班次', startTime: '08:00', endTime: '17:00', crossDay: false, status: '启用' }),
  }, 201)
  if (createdShift.startTime !== '08:00' || createdShift.endTime !== '17:00') throw new Error('班次主档新增时间未正确保存')
  const updatedShift = await request(`/admin/modeling/shifts/${shiftCode}`, {
    method: 'PUT',
    body: JSON.stringify({ code: shiftCode, name: '测试班次-修改', startTime: '09:00', endTime: '18:00', crossDay: false, status: '启用' }),
  })
  if (updatedShift.startTime !== '09:00' || updatedShift.endTime !== '18:00') throw new Error('班次主档编辑时间未正确保存')

  const createdSchedule = await request('/admin/modeling/schedules', {
    method: 'POST',
    body: JSON.stringify({ date: scheduleDate, workshopCode: 'WS-CORE-01', shiftCode, teamCode: 'TEAM-CORE-A', remark: '接口测试' }),
  }, 201)
  scheduleId = createdSchedule.id
  const listed = await request(`/admin/modeling/schedules?startDate=${scheduleDate}&endDate=${scheduleDate}&workshopCode=WS-CORE-01`)
  if (!listed.some((item) => item.id === scheduleId && item.shiftCode === shiftCode && item.teamCode === 'TEAM-CORE-A')) throw new Error('动态排班新增后查询不到')

  await request('/admin/modeling/schedules/batch-generate', {
    method: 'POST',
    body: JSON.stringify({ startDate: scheduleDate, endDate: scheduleDate, workshopCode: 'WS-CORE-01', shiftCodes: [shiftCode, 'NOT-EXIST-SHIFT'], teamCodes: ['TEAM-CORE-A'] }),
  }, 400)
  await request('/admin/modeling/schedules/batch-generate', {
    method: 'POST',
    body: JSON.stringify({ startDate: scheduleDate, endDate: scheduleDate, workshopCode: 'WS-CORE-01', shiftCodes: [shiftCode], teamCodes: ['TEAM-MELT-A'] }),
  }, 400)

  console.log(JSON.stringify({ ok: true, assertions: 8, shiftCode, scheduleId }))
} finally {
  if (scheduleId) await request(`/admin/modeling/schedules/${scheduleId}`, { method: 'DELETE' }).catch(() => null)
  await request(`/admin/modeling/shifts/${shiftCode}`, { method: 'DELETE' }).catch(() => null)
}
