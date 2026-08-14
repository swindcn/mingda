import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { ImageUploadField } from '../../components/ImageUploadField'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { apiRequest } from '../../services/api'
import { loadDictionaries } from '../../utils/dictionaries'
import {
  createModelingRecord,
  deleteModelingRecord,
  fetchModelingOptions,
  fetchModelingRecords,
  updateModelingRecord,
} from '../../utils/modeling'
import type { MoldArchiveRecord, ModelingOptions, ModelingRecord } from '../../utils/modeling'
import { hasPermission } from '../../utils/roles'
import { MoldCoreBoxEditor } from './MoldCoreBoxEditor'

const emptyOptions: ModelingOptions = {
  workshops: [], lines: [], teams: [], items: [], materials: [], molds: [], moldDevelopments: [], shifts: [], suppliers: [], employees: [],
}

function optionLabel(record: ModelingRecord) {
  return `${record.name || record.code}（${record.code}）`
}

function normalizeMoldRecord(record: MoldArchiveRecord): MoldArchiveRecord {
  return {
    ...record,
    images: Array.isArray(record.images) ? record.images : [],
    coreBoxes: Array.isArray(record.coreBoxes)
      ? record.coreBoxes.map((item) => ({ ...item, id: item.id || item.code, images: Array.isArray(item.images) ? item.images : [] }))
      : [],
  }
}

export function MoldArchivePage() {
  const [form] = Form.useForm<MoldArchiveRecord>()
  const location = useLocation()
  const handledSource = useRef('')
  const [records, setRecords] = useState<MoldArchiveRecord[]>([])
  const [options, setOptions] = useState<ModelingOptions>(emptyOptions)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<MoldArchiveRecord | null>(null)
  const [viewing, setViewing] = useState(false)
  const dictionaries = loadDictionaries()

  const canCreate = hasPermission('mold.model.create')
  const canEdit = hasPermission('mold.model.edit')
  const canDelete = hasPermission('mold.model.delete')
  const canCoreBoxCreate = hasPermission('mold.corebox.create')
  const canCoreBoxEdit = hasPermission('mold.corebox.edit')

  const refresh = async (nextKeyword = keyword) => {
    setLoading(true)
    try {
      const [nextRecords, nextOptions] = await Promise.all([
        fetchModelingRecords('molds', { keyword: nextKeyword }),
        fetchModelingOptions(),
      ])
      setRecords((nextRecords as MoldArchiveRecord[]).map(normalizeMoldRecord))
      setOptions(nextOptions)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模具档案加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh('') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sourceId = new URLSearchParams(location.search).get('fromMoldDevelopment') || ''
    if (!sourceId || sourceId === handledSource.current) return
    handledSource.current = sourceId
    if (!canCreate) {
      message.error('无权新建模具档案')
      return
    }
    void apiRequest<{
      code: string
      productCode: string
      productName: string
      moldName?: string
      moldType?: string
      supplierId?: string
      flowRecords?: Array<{ key: string; images?: string[] }>
    }>(`/mobile/molds/${sourceId}?viewer=admin`).then((detail) => {
      const images = detail.flowRecords?.find((record) => record.key === 'receive')?.images || []
      setEditing(null)
      setViewing(false)
      form.resetFields()
      form.setFieldsValue({
        code: `${detail.code}-MOLD`,
        name: detail.moldName || `${detail.productName}模具`,
        itemCode: detail.productCode,
        moldType: detail.moldType,
        supplierCode: detail.supplierId,
        sourceMoldDevelopmentCode: detail.code,
        images,
        coreBoxes: [],
        usedLife: 0,
        status: '启用',
      })
      setModalOpen(true)
    }).catch((error) => message.error(error instanceof Error ? error.message : '开发单数据带入失败'))
  }, [canCreate, form, location.search])

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setViewing(false)
    form.resetFields()
  }

  const openCreate = () => {
    setEditing(null)
    setViewing(false)
    form.resetFields()
    form.setFieldsValue({ images: [], coreBoxes: [], usedLife: 0, status: '启用' } as Partial<MoldArchiveRecord>)
    setModalOpen(true)
  }

  const openRecord = (record: MoldArchiveRecord, readOnly: boolean) => {
    setEditing(record)
    setViewing(readOnly)
    form.resetFields()
    form.setFieldsValue(normalizeMoldRecord(record))
    setModalOpen(true)
  }

  const submit = async (values: MoldArchiveRecord) => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        ...values,
        hasCoreBox: values.coreBoxes.some((item) => item.status !== '停用'),
      }
      if (editing && !canCoreBoxEdit) {
        delete payload.coreBoxes
        delete payload.hasCoreBox
      }
      if (editing) await updateModelingRecord('molds', editing.code, payload)
      else await createModelingRecord('molds', payload)
      message.success(editing ? '模具档案已更新' : '模具档案已新增')
      closeModal()
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = (record: MoldArchiveRecord) => Modal.confirm({
    title: '确认删除',
    content: `确定删除 ${record.name} 吗？`,
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await deleteModelingRecord('molds', record.code)
        message.success('删除成功')
        await refresh()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败')
      }
    },
  })

  const columns = useMemo<TableColumnsType<MoldArchiveRecord>>(() => [
    { title: '编码', dataIndex: 'code', key: 'code', width: 150 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 210 },
    { title: '关联物料', dataIndex: 'itemCode', key: 'itemCode', width: 220, render: (value) => optionLabel(options.items.find((item) => item.code === value) || { id: String(value), code: String(value), name: String(value) }) },
    { title: '模具供应商', dataIndex: 'supplierName', key: 'supplierName', width: 190, render: (value) => value || '-' },
    { title: '模具类型', dataIndex: 'moldType', key: 'moldType', width: 120 },
    { title: '规格型号', dataIndex: 'specModel', key: 'specModel', width: 130 },
    { title: '关联开发单号', dataIndex: 'sourceMoldDevelopmentCode', key: 'sourceMoldDevelopmentCode', width: 140, render: (value) => value || '-' },
    { title: '型腔数', dataIndex: 'cavityCount', key: 'cavityCount', width: 90 },
    { title: '芯盒数', key: 'coreBoxCount', width: 90, render: (_, record) => record.coreBoxes.filter((item) => item.status !== '停用').length },
    { title: '使用寿命', dataIndex: 'maxLife', key: 'maxLife', width: 110 },
    { title: '已用次数', dataIndex: 'usedLife', key: 'usedLife', width: 110 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (value) => <Tag color={value === '启用' ? 'green' : 'default'}>{value}</Tag> },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 180,
      render: (_, record) => <TableActions actions={[
        { key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => openRecord(record, true) },
        ...(canEdit ? [{ key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => openRecord(record, false) }] : []),
        ...(canDelete ? [{ key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined />, onClick: () => confirmDelete(record) }] : []),
      ]} />,
    },
  ], [canDelete, canEdit, options.items])

  const sourceOptions = options.moldDevelopments.map((item) => ({ label: `${item.code} · ${item.name || ''}`, value: item.code }))

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">模具档案</h1><p className="page-description">维护模具及其多套芯盒主档，为 BOM、制芯和工装寿命管理提供基础数据。</p></div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
        </Space>
      </div>
      <Card>
        <Input allowClear prefix={<SearchOutlined />} value={keyword} placeholder="搜索模具编码、名称或状态" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} style={{ width: 360, marginBottom: 16 }} />
        <ResizableTable storageKey="modeling-molds-widths" rowKey="code" columns={columns} dataSource={records} loading={loading} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }} />
      </Card>
      <Modal
        title={viewing ? '查看模具档案' : editing ? '编辑模具档案' : '新增模具档案'}
        open={modalOpen}
        width={1120}
        onCancel={closeModal}
        destroyOnHidden
        footer={viewing ? <Button onClick={closeModal}>关闭</Button> : <Space><Button onClick={closeModal}>取消</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
          <div className="mold-archive-grid">
            <Form.Item name="code" label="模具编码" rules={[{ required: true, message: '请输入模具编码' }, { pattern: /^[^\s\u4e00-\u9fff]+$/, message: '不能包含中文或空格' }]}><Input disabled={viewing || Boolean(editing)} /></Form.Item>
            <Form.Item name="name" label="模具名称" rules={[{ required: true, message: '请输入模具名称' }]}><Input disabled={viewing} /></Form.Item>
            <Form.Item name="itemCode" label="关联物料" rules={[{ required: true, message: '请选择关联物料' }]}><Select disabled={viewing} showSearch optionFilterProp="label" options={options.items.map((item) => ({ label: optionLabel(item), value: item.code }))} /></Form.Item>
            <Form.Item name="supplierCode" label="模具供应商"><Select disabled={viewing} allowClear showSearch optionFilterProp="label" options={options.suppliers.map((item) => ({ label: optionLabel(item), value: item.code }))} /></Form.Item>
            <Form.Item name="moldType" label="模具类型"><Select disabled={viewing} allowClear options={dictionaries.moldTypes.map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="specModel" label="规格型号"><Input disabled={viewing} /></Form.Item>
            <Form.Item name="sourceMoldDevelopmentCode" label="关联开发单号"><Select disabled={viewing || Boolean(editing?.sourceMoldDevelopmentCode)} allowClear showSearch optionFilterProp="label" options={sourceOptions} /></Form.Item>
            <Form.Item name="status" label="状态"><Select disabled={viewing} options={[{ value: '启用' }, { value: '停用' }]} /></Form.Item>
            <Form.Item name="remark" label="备注"><Input disabled={viewing} /></Form.Item>
            <Form.Item name="cavityCount" label="型腔数"><InputNumber disabled={viewing} min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="maxLife" label="使用寿命"><InputNumber disabled={viewing} min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="usedLife" label="已用次数"><InputNumber disabled={viewing} min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
          </div>
          <Form.Item name="images" label="模具图片"><ImageUploadField readOnly={viewing} /></Form.Item>
          <MoldCoreBoxEditor
            form={form}
            readOnly={viewing}
            canCreate={canCoreBoxCreate && (!editing || canCoreBoxEdit)}
            canEdit={canCoreBoxEdit}
          />
        </Form>
      </Modal>
    </>
  )
}
