import {
  CalendarOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Button, Card, Form, Modal, Select, Space, Tag, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import {
  batchGenerateSchedules,
  createModelingRecord,
  deleteModelingRecord,
  fetchModelingOptions,
  fetchModelingRecords,
  updateModelingRecord,
} from '../../utils/modeling'
import type { ModelingOptions, ModelingRecord } from '../../utils/modeling'
import { hasPermission } from '../../utils/roles'

function monthDays(month: dayjs.Dayjs) {
  const start = month.startOf('month').startOf('week')
  const end = month.endOf('month').endOf('week')
  const days: dayjs.Dayjs[] = []
  let cursor = start
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    days.push(cursor)
    cursor = cursor.add(1, 'day')
  }
  return days
}

function optionLabel(record?: ModelingRecord) {
  if (!record) return ''
  return `${record.name || record.code}（${record.code || record.id}）`
}

export function ShiftSchedulePage() {
  const [form] = Form.useForm()
  const [batchForm] = Form.useForm()
  const [options, setOptions] = useState<ModelingOptions | null>(null)
  const [records, setRecords] = useState<ModelingRecord[]>([])
  const [month, setMonth] = useState(() => dayjs())
  const [workshopCode, setWorkshopCode] = useState<string>()
  const [editing, setEditing] = useState<ModelingRecord | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const formWorkshopCode = Form.useWatch('workshopCode', form)
  const batchWorkshopCode = Form.useWatch('workshopCode', batchForm)

  const canCreate = hasPermission('model.schedule.create')
  const canEdit = hasPermission('model.schedule.edit')
  const canDelete = hasPermission('model.schedule.delete')
  const canBatch = hasPermission('model.schedule.batch')

  const refresh = async () => {
    setLoading(true)
    try {
      const nextOptions = await fetchModelingOptions()
      const nextWorkshop = workshopCode || String(nextOptions.workshops[0]?.code || '')
      setOptions(nextOptions)
      setWorkshopCode(nextWorkshop)
      setRecords(
        await fetchModelingRecords('schedules', {
          startDate: month.startOf('month').format('YYYY-MM-DD'),
          endDate: month.endOf('month').format('YYYY-MM-DD'),
          workshopCode: nextWorkshop,
        }),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '排班数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [month, workshopCode])

  const recordsByDate = useMemo(() => {
    const map = new Map<string, ModelingRecord[]>()
    records.forEach((record) => {
      const key = String(record.date || '')
      map.set(key, [...(map.get(key) || []), record])
    })
    return map
  }, [records])

  const getShift = (code: unknown) => options?.shifts.find((item) => item.code === code)
  const getTeam = (code: unknown) => options?.teams.find((item) => item.code === code)
  const activeShifts = (options?.shifts || []).filter((item) => item.status === '启用')
  const workshopTeams = (options?.teams || []).filter(
    (item) => item.status === '启用' && (!formWorkshopCode || item.workshopCode === formWorkshopCode),
  )
  const batchWorkshopTeams = (options?.teams || []).filter(
    (item) => item.status === '启用' && (!batchWorkshopCode || item.workshopCode === batchWorkshopCode),
  )

  const openCreate = (date?: string) => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ date, workshopCode })
    setModalOpen(true)
  }

  const openEdit = (record: ModelingRecord) => {
    setEditing(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const submit = async (values: Record<string, unknown>) => {
    try {
      if (editing) {
        await updateModelingRecord('schedules', editing.id, values)
        message.success('排班已更新')
      } else {
        await createModelingRecord('schedules', values)
        message.success('排班已新增')
      }
      setModalOpen(false)
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  const remove = async (record: ModelingRecord) => {
    Modal.confirm({
      title: '确认删除排班',
      content: `${record.date} ${optionLabel(getShift(record.shiftCode))}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteModelingRecord('schedules', record.id)
          message.success('删除成功')
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败')
        }
      },
    })
  }

  const submitBatch = async (values: Record<string, unknown>) => {
    try {
      await batchGenerateSchedules({
        startDate: String(values.startDate || ''),
        endDate: String(values.endDate || ''),
        workshopCode: String(values.workshopCode || ''),
        shiftCodes: values.shiftCodes as string[],
        teamCodes: values.teamCodes as string[],
      })
      message.success('排班已生成')
      setBatchOpen(false)
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '一键生成失败')
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">动态排班表</h1>
          <p className="page-description">按月维护车间、班次与班组排班，支持一键生成轮换排班。</p>
        </div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={refresh}>
            查询
          </Button>
          {canBatch && (
          <Button icon={<CalendarOutlined />} onClick={() => { batchForm.resetFields(); batchForm.setFieldsValue({ workshopCode }); setBatchOpen(true) }}>
              一键生成
            </Button>
          )}
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(month.format('YYYY-MM-DD'))}>
              新增排班
            </Button>
          )}
        </Space>
      </div>

      <Card>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
          <Space>
            <Select
              style={{ width: 220 }}
              value={workshopCode}
              options={(options?.workshops || []).map((record) => ({
                label: optionLabel(record),
                value: String(record.code),
              }))}
              onChange={setWorkshopCode}
            />
            <Button onClick={() => setMonth(month.subtract(1, 'month'))}>上月</Button>
            <Tag color="blue" style={{ padding: '4px 12px', fontSize: 14 }}>
              {month.format('YYYY年MM月')}
            </Tag>
            <Button onClick={() => setMonth(month.add(1, 'month'))}>下月</Button>
          </Space>
        </Space>

        <div className="schedule-calendar">
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <div key={day} className="schedule-weekday">
              {day}
            </div>
          ))}
          {monthDays(month).map((day) => {
            const date = day.format('YYYY-MM-DD')
            const dayRecords = recordsByDate.get(date) || []
            const muted = !day.isSame(month, 'month')
            return (
              <div key={date} className={`schedule-day ${muted ? 'is-muted' : ''}`}>
                <div className="schedule-day-header">
                  <span>{day.date()}</span>
                  {canCreate && (
                    <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openCreate(date)} />
                  )}
                </div>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {dayRecords.map((record) => (
                    <div key={record.id} className="schedule-card">
                      <div>
                        <strong>{String(getShift(record.shiftCode)?.name || record.shiftCode || '')}</strong>
                        <span>{String(getTeam(record.teamCode)?.name || record.teamCode || '')}</span>
                      </div>
                      <Space size={0}>
                        {canEdit && (
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
                        )}
                        {canDelete && (
                          <Button
                            danger
                            type="link"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => remove(record)}
                          />
                        )}
                      </Space>
                    </div>
                  ))}
                </Space>
              </div>
            )
          })}
        </div>
      </Card>

      <Modal
        title={editing ? '编辑排班' : '新增排班'}
        open={modalOpen}
        okText="保存"
        cancelText="取消"
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="date" label="日期" rules={[{ required: true, message: '请输入日期' }]}>
            <input className="ant-input" type="date" />
          </Form.Item>
          <Form.Item name="workshopCode" label="车间" rules={[{ required: true, message: '请选择车间' }]}>
            <Select
              options={(options?.workshops || []).map((record) => ({ label: optionLabel(record), value: record.code }))}
            />
          </Form.Item>
          <Form.Item name="shiftCode" label="班次" rules={[{ required: true, message: '请选择班次' }]}>
            <Select options={activeShifts.map((record) => ({ label: optionLabel(record), value: record.code }))} />
          </Form.Item>
          <Form.Item name="teamCode" label="班组" rules={[{ required: true, message: '请选择班组' }]}>
            <Select
              options={workshopTeams.map((record) => ({ label: optionLabel(record), value: record.code }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="一键生成排班"
        open={batchOpen}
        okText="生成"
        cancelText="取消"
        onCancel={() => setBatchOpen(false)}
        onOk={() => batchForm.submit()}
        destroyOnHidden
      >
        <Form form={batchForm} layout="vertical" onFinish={submitBatch} initialValues={{ workshopCode }}>
          <Space style={{ width: '100%' }}>
            <Form.Item name="startDate" label="开始日期" rules={[{ required: true, message: '请选择开始日期' }]}>
              <input className="ant-input" type="date" />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期" rules={[{ required: true, message: '请选择结束日期' }]}>
              <input className="ant-input" type="date" />
            </Form.Item>
          </Space>
          <Form.Item name="workshopCode" label="车间" rules={[{ required: true, message: '请选择车间' }]}>
            <Select
              options={(options?.workshops || []).map((record) => ({ label: optionLabel(record), value: record.code }))}
            />
          </Form.Item>
          <Form.Item name="shiftCodes" label="班次" rules={[{ required: true, message: '请选择班次' }]}>
            <Select
              mode="multiple"
              options={activeShifts.map((record) => ({ label: optionLabel(record), value: record.code }))}
            />
          </Form.Item>
          <Form.Item name="teamCodes" label="班组轮换顺序" rules={[{ required: true, message: '请选择班组' }]}>
            <Select
              mode="multiple"
              options={batchWorkshopTeams.map((record) => ({ label: optionLabel(record), value: record.code }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
