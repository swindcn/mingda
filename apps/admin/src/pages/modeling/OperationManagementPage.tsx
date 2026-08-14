import { CheckCircleOutlined, EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { hasPermission } from '../../utils/roles'
import {
  createOperation,
  disableOperation,
  enableOperation,
  fetchOperationOptions,
  fetchOperations,
  updateOperation,
  type OperationPayload,
  type OperationRecord,
} from '../../utils/operations'

const reportModeLabels = { BATCH: '批次报工', SINGLE: '单件报工' }

export function OperationManagementPage() {
  const [form] = Form.useForm<OperationPayload>()
  const [records, setRecords] = useState<OperationRecord[]>([])
  const [sections, setSections] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<OperationRecord>()
  const canCreate = hasPermission('model.operation.create')
  const canEdit = hasPermission('model.operation.edit')
  const canDisable = hasPermission('model.operation.disable')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, options] = await Promise.all([fetchOperations({ keyword: keyword.trim() || undefined, status }), fetchOperationOptions()])
      setRecords(list)
      setSections(options.sections)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工序数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const showCreate = () => {
    setEditing(undefined)
    form.setFieldsValue({ name: '', section: sections[0], reportMode: 'BATCH', qualityControlPoint: false, pouringMergePoint: false, remark: '' })
    setOpen(true)
  }

  const showEdit = (record: OperationRecord) => {
    setEditing(record)
    form.setFieldsValue({ ...record })
    setOpen(true)
  }

  const persist = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) await updateOperation(editing.id, values)
      else await createOperation(values)
      message.success(editing ? '工序已更新' : '工序已新增')
      setOpen(false)
      await refresh()
    } catch (error) {
      if (error instanceof Error) message.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<OperationRecord> = [
    { title: '工序编码', dataIndex: 'code', width: 150 },
    { title: '工序名称', dataIndex: 'name', width: 160 },
    { title: '所属工段', dataIndex: 'section', width: 110 },
    { title: '报工采集模式', dataIndex: 'reportMode', width: 130, render: (value: keyof typeof reportModeLabels) => reportModeLabels[value] },
    { title: '质量控制点', dataIndex: 'qualityControlPoint', width: 115, render: (value: boolean) => value ? <Tag color="blue">是</Tag> : '否' },
    { title: '浇注汇合点', dataIndex: 'pouringMergePoint', width: 115, render: (value: boolean) => value ? <Tag color="orange">是</Tag> : '否' },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={value === 'ENABLED' ? 'success' : 'default'}>{value === 'ENABLED' ? '启用' : '禁用'}</Tag> },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false }) },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 150,
      render: (_, record) => <TableActions actions={[
        ...(canEdit ? [{ key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => showEdit(record) }] : []),
        ...(canDisable && record.status === 'ENABLED' ? [{ key: 'disable', label: '禁用', danger: true, icon: <StopOutlined />, onClick: () => Modal.confirm({ title: '确认禁用该工序？', content: '历史路线仍会保留该工序，新路线将不能再选择。', okButtonProps: { danger: true }, onOk: async () => { await disableOperation(record.id); message.success('工序已禁用'); await refresh() } }) }] : []),
        ...(canDisable && record.status === 'DISABLED' ? [{ key: 'enable', label: '启用', icon: <CheckCircleOutlined />, onClick: async () => { await enableOperation(record.id); message.success('工序已启用'); await refresh() } }] : []),
      ]} />,
    },
  ]

  return <div className="page-shell">
    <div className="page-header">
      <div><h1 className="page-title">工序管理</h1><p className="page-description">维护铸造标准工序，统一报工采集和质量控制节点。</p></div>
      <Space>
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={showCreate}>新增</Button>}
      </Space>
    </div>
    <Card>
      <div className="operation-query-row">
        <Input allowClear prefix={<SearchOutlined />} placeholder="搜索工序编码、名称或工段" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} />
        <Select allowClear placeholder="状态" value={status} options={[{ label: '启用', value: 'ENABLED' }, { label: '禁用', value: 'DISABLED' }]} onChange={setStatus} />
      </div>
      <ResizableTable storageKey="operation-master-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} scroll={{ x: 1200 }} pagination={{ pageSize: 10 }} />
    </Card>
    <Modal title={editing ? '编辑工序' : '新增工序'} open={open} onCancel={() => setOpen(false)} onOk={() => void persist()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical">
        <div className="operation-form-grid">
          <Form.Item name="code" label="工序编码" rules={[{ required: true, message: '请输入工序编码' }, { pattern: /^[^\s\u4e00-\u9fff]+$/, message: '编码不能包含中文或空格' }]}><Input disabled={Boolean(editing)} /></Form.Item>
          <Form.Item name="name" label="工序名称" rules={[{ required: true, message: '请输入工序名称' }]}><Input /></Form.Item>
          <Form.Item name="section" label="所属工段" rules={[{ required: true, message: '请选择所属工段' }]}><Select options={sections.map((value) => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="reportMode" label="报工采集模式" rules={[{ required: true }]}><Select options={[{ label: '批次报工', value: 'BATCH' }, { label: '单件报工', value: 'SINGLE' }]} /></Form.Item>
          <Form.Item name="qualityControlPoint" label="质量控制点" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="pouringMergePoint" label="浇注汇合点" valuePropName="checked"><Switch /></Form.Item>
        </div>
        <Form.Item name="remark" label="备注"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
  </div>
}
