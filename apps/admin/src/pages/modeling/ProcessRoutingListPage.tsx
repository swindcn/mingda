import { CopyOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons'
import { Button, Card, Checkbox, Form, Input, Modal, Select, Space, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { hasPermission } from '../../utils/roles'
import {
  activateProcessRouting,
  cloneProcessRouting,
  createProcessRoutingVersion,
  deleteProcessRouting,
  disableProcessRouting,
  fetchProcessRoutingOptions,
  fetchProcessRoutings,
  setDefaultRoutingProducts,
  type ProcessRoutingRecord,
  type RoutingOptions,
} from '../../utils/processRoutings'

const statusLabels = { DRAFT: '草稿', ACTIVE: '已生效', DISABLED: '已停用' }
const statusColors = { DRAFT: 'gold', ACTIVE: 'success', DISABLED: 'default' }

export function ProcessRoutingListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [cloneForm] = Form.useForm<{ code: string; name: string }>()
  const [records, setRecords] = useState<ProcessRoutingRecord[]>([])
  const [options, setOptions] = useState<RoutingOptions>({ products: [], operations: [], equipment: [] })
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '')
  const [productCode, setProductCode] = useState<string | undefined>(searchParams.get('productCode') || undefined)
  const [materialGradeCode, setMaterialGradeCode] = useState<string | undefined>(searchParams.get('materialGradeCode') || undefined)
  const [version, setVersion] = useState(searchParams.get('version') || '')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [loading, setLoading] = useState(false)
  const [cloneSource, setCloneSource] = useState<ProcessRoutingRecord>()
  const [defaultSource, setDefaultSource] = useState<ProcessRoutingRecord>()
  const [defaultCodes, setDefaultCodes] = useState<string[]>([])

  const canCreate = hasPermission('model.routing.create')
  const canEdit = hasPermission('model.routing.edit')
  const canDelete = hasPermission('model.routing.delete')
  const canVersion = hasPermission('model.routing.version')
  const canClone = hasPermission('model.routing.clone')
  const canActivate = hasPermission('model.routing.activate')
  const canDisable = hasPermission('model.routing.disable')
  const canDefault = hasPermission('model.routing.default')
  const returnSearch = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const openWorkbench = (path: string) => navigate(path, { state: { returnSearch } })

  const refresh = useCallback(async (nextStatus = status) => {
    setLoading(true)
    const params = { keyword: keyword.trim() || undefined, productCode, materialGradeCode, version: version.trim() || undefined, status: nextStatus || undefined }
    setSearchParams(Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))), { replace: true })
    try {
      const [list, nextOptions] = await Promise.all([fetchProcessRoutings(params), fetchProcessRoutingOptions()])
      setRecords(list)
      setOptions(nextOptions)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工艺路线加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, materialGradeCode, productCode, setSearchParams, status, version])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const materialOptions = Array.from(new Map(options.products.filter((item) => item.materialGradeCode).map((item) => [item.materialGradeCode, { label: `${item.materialGradeName}（${item.materialGradeCode}）`, value: item.materialGradeCode }])).values())
  const productOptions = options.products.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))

  const openClone = (record: ProcessRoutingRecord) => {
    setCloneSource(record)
    cloneForm.setFieldsValue({ code: '', name: `${record.name}复制` })
  }

  const submitClone = async () => {
    if (!cloneSource) return
    try {
      const values = await cloneForm.validateFields()
      const cloned = await cloneProcessRouting(cloneSource.id, values)
      message.success('路线已克隆为草稿')
      setCloneSource(undefined)
      openWorkbench(`/dashboard/model/routing/${cloned.id}/edit`)
    } catch (error) {
      if (error instanceof Error) message.error(error.message)
    }
  }

  const columns: ColumnsType<ProcessRoutingRecord> = [
    { title: '路线编号', dataIndex: 'code', width: 165 },
    { title: '路线名称', dataIndex: 'name', width: 190 },
    { title: '关联产品/半成品', dataIndex: 'products', width: 240, render: (_, record) => record.products.map((item) => item.name).join('、') || '-' },
    { title: '材质牌号', dataIndex: 'materialGrades', width: 170, render: (_, record) => record.materialGrades.map((item) => item.name).join('、') || '-' },
    { title: '版本号', dataIndex: 'version', width: 90 },
    { title: '默认产品', dataIndex: 'defaultProductCount', width: 100, render: (value: number) => `${value} 个` },
    { title: '工序总数', dataIndex: 'nodeCount', width: 100 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: keyof typeof statusLabels) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
    { title: '创建人', dataIndex: 'createdByName', width: 110 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false }) },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 190,
      render: (_, record) => <TableActions actions={[
        { key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => openWorkbench(`/dashboard/model/routing/${record.id}`) },
        ...(canEdit && record.status === 'DRAFT' ? [{ key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => openWorkbench(`/dashboard/model/routing/${record.id}/edit`) }] : []),
        ...(canActivate && record.status === 'DRAFT' ? [{ key: 'activate', label: '发布', onClick: () => Modal.confirm({ title: '确认发布该路线？', content: '发布前系统将校验完整拓扑、工序及设备状态。', onOk: async () => { await activateProcessRouting(record.id); message.success('路线已发布'); await refresh() } }) }] : []),
        ...(canVersion && record.status !== 'DRAFT' ? [{ key: 'version', label: '新版本', onClick: async () => { try { const next = await createProcessRoutingVersion(record.id); openWorkbench(`/dashboard/model/routing/${next.id}/edit`) } catch (error) { message.error(error instanceof Error ? error.message : '创建新版本失败') } } }] : []),
        ...(canClone ? [{ key: 'clone', label: '克隆', icon: <CopyOutlined />, onClick: () => openClone(record) }] : []),
        ...(canDefault && record.status === 'ACTIVE' ? [{ key: 'default', label: '设为默认', onClick: () => { setDefaultSource(record); setDefaultCodes(record.defaultProductCodes) } }] : []),
        ...(canDisable && record.status === 'ACTIVE' ? [{ key: 'disable', label: '停用', danger: true, icon: <StopOutlined />, onClick: () => Modal.confirm({ title: '确认停用该路线？', okButtonProps: { danger: true }, onOk: async () => { await disableProcessRouting(record.id); message.success('路线已停用'); await refresh() } }) }] : []),
        ...(canDelete && record.status === 'DRAFT' ? [{ key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined />, onClick: () => Modal.confirm({ title: '确认删除该草稿？', okButtonProps: { danger: true }, onOk: async () => { await deleteProcessRouting(record.id); message.success('草稿已删除'); await refresh() } }) }] : []),
      ]} />,
    },
  ]

  return <div className="page-shell">
    <div className="page-header">
      <div><h1 className="page-title">工艺路线</h1><p className="page-description">配置多产品复用的铸造主副线工艺、汇合关系和适用设备。</p></div>
      <Space>
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openWorkbench('/dashboard/model/routing/new')}>新增</Button>}
      </Space>
    </div>
    <Card>
      <div className="routing-filter-row">
        <Input allowClear prefix={<SearchOutlined />} placeholder="路线编号/名称/产品" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="产品/半成品" value={productCode} options={productOptions} onChange={setProductCode} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="材质牌号" value={materialGradeCode} options={materialOptions} onChange={setMaterialGradeCode} />
        <Input className="routing-version-filter" allowClear placeholder="版本号" value={version} onChange={(event) => setVersion(event.target.value)} onPressEnter={() => void refresh()} />
        <div className="bom-status-filters" aria-label="路线状态">
          {[['', '全部'], ['DRAFT', '草稿'], ['ACTIVE', '已生效'], ['DISABLED', '已停用']].map(([value, label]) => <Button key={value || 'ALL'} type={status === value ? 'primary' : 'default'} onClick={() => { setStatus(value); void refresh(value) }}>{label}</Button>)}
        </div>
      </div>
      <ResizableTable storageKey="process-routing-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} scroll={{ x: 1750 }} pagination={{ pageSize: 10 }} />
    </Card>

    <Modal title="克隆工艺路线" open={Boolean(cloneSource)} onCancel={() => setCloneSource(undefined)} onOk={() => void submitClone()} destroyOnHidden>
      <Form form={cloneForm} layout="vertical">
        <Form.Item name="code" label="新路线编号" rules={[{ required: true, message: '请输入新路线编号' }, { pattern: /^[^\s\u4e00-\u9fff]+$/, message: '编码不能包含中文或空格' }]}><Input /></Form.Item>
        <Form.Item name="name" label="新路线名称" rules={[{ required: true, message: '请输入新路线名称' }]}><Input /></Form.Item>
      </Form>
    </Modal>

    <Modal title="设置默认路线" open={Boolean(defaultSource)} onCancel={() => setDefaultSource(undefined)} onOk={async () => { if (!defaultSource) return; try { await setDefaultRoutingProducts(defaultSource.id, defaultCodes); message.success('默认路线已更新'); setDefaultSource(undefined); await refresh() } catch (error) { message.error(error instanceof Error ? error.message : '设置默认路线失败') } }} destroyOnHidden>
      <p className="modal-description">勾选本路线作为默认路线的产品。同一产品原有默认路线会自动被替换。</p>
      <Checkbox.Group value={defaultCodes} onChange={(values) => setDefaultCodes(values.map(String))} options={(defaultSource?.products || []).map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))} />
    </Modal>
  </div>
}
