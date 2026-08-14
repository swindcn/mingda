import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import {
  activateBom,
  cloneBom,
  createBom,
  createBomVersion,
  deleteBom,
  disableBom,
  fetchBomDetail,
  fetchBomOptions,
  fetchBoms,
  updateBom,
} from '../../utils/castingBoms'
import type { BomItem, BomOptions, BomPayload, BomRecord, BomStatus } from '../../utils/castingBoms'
import { hasPermission } from '../../utils/roles'

const statusLabels: Record<BomStatus, string> = { DRAFT: '草稿', ACTIVE: '已生效', DISABLED: '已停用' }
const statusColors: Record<BomStatus, string> = { DRAFT: 'default', ACTIVE: 'green', DISABLED: 'red' }
const statusOptions: Array<{ label: string; value?: BomStatus }> = [
  { label: '全部' },
  { label: '草稿', value: 'DRAFT' },
  { label: '已生效', value: 'ACTIVE' },
  { label: '已停用', value: 'DISABLED' },
]

type BomFormValues = BomPayload & { version?: string; status?: BomStatus }

export function CastingBomManagementPage() {
  const [form] = Form.useForm<BomFormValues>()
  const [records, setRecords] = useState<BomRecord[]>([])
  const [options, setOptions] = useState<BomOptions>({ products: [], materials: [], physicalItems: [], creators: [], molds: [], coreBoxes: [], activeRecipes: [] })
  const [keyword, setKeyword] = useState('')
  const [materialGradeCode, setMaterialGradeCode] = useState<string>()
  const [createdByUserId, setCreatedByUserId] = useState<string>()
  const [status, setStatus] = useState<BomStatus>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BomRecord | null>(null)
  const [viewing, setViewing] = useState(false)

  const canCreate = hasPermission('model.bom.create')
  const canEdit = hasPermission('model.bom.edit')
  const canDelete = hasPermission('model.bom.delete')
  const canClone = hasPermission('model.bom.clone')
  const canActivate = hasPermission('model.bom.activate')
  const canDisable = hasPermission('model.bom.disable')
  const canNewVersion = hasPermission('model.bom.new_version')

  const refresh = async (nextStatus?: BomStatus | null) => {
    const queryStatus = nextStatus === null ? undefined : nextStatus ?? status
    setLoading(true)
    try {
      const [nextRecords, nextOptions] = await Promise.all([
        fetchBoms({ keyword, materialGradeCode, createdByUserId, status: queryStatus }),
        fetchBomOptions(),
      ])
      setRecords(nextRecords)
      setOptions(nextOptions)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'BOM 数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
    // The initial request intentionally uses the initial query state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    form.setFieldsValue({ version: 'V1.0', status: 'DRAFT', moldCodes: [], coreBoxCodes: [], items: [] })
    setModalOpen(true)
  }

  const openRecord = async (record: BomRecord, readOnly: boolean) => {
    setLoading(true)
    try {
      const detail = await fetchBomDetail(record.id)
      setEditing(detail)
      setViewing(readOnly)
      form.setFieldsValue({
        productCode: detail.productCode,
        materialGradeCode: detail.materialGradeCode,
        moldCodes: detail.moldCodes,
        coreBoxCodes: detail.coreBoxCodes,
        netWeightKg: detail.netWeightKg,
        grossWeightKg: detail.grossWeightKg,
        version: detail.version,
        status: detail.status,
        items: detail.items,
        remark: detail.remark,
      })
      setModalOpen(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'BOM 详情加载失败')
    } finally {
      setLoading(false)
    }
  }

  const selectedGradeCode = Form.useWatch('materialGradeCode', form)
  const selectedMoldCodes = Form.useWatch('moldCodes', form) || []
  const netWeight = Number(Form.useWatch('netWeightKg', form) || 0)
  const grossWeight = Number(Form.useWatch('grossWeightKg', form) || 0)
  const yieldRate = grossWeight > 0 ? netWeight / grossWeight * 100 : 0
  const returnWeight = Math.max(0, grossWeight - netWeight)
  const availableRecipes = options.activeRecipes.filter((recipe) => recipe.materialGradeCode === selectedGradeCode)
  const moldRecords = [...options.molds, ...(editing?.molds || [])].filter((item, index, records) => records.findIndex((record) => record.code === item.code) === index)
  const coreBoxRecords = [...options.coreBoxes, ...(editing?.coreBoxes || [])].filter((item, index, records) => records.findIndex((record) => record.code === item.code) === index)
  const availableMolds = moldRecords
  const selectedMoldSet = new Set(selectedMoldCodes)
  const availableCoreBoxes = coreBoxRecords.filter((item) => selectedMoldSet.has(item.moldCode))

  const handleProductChange = (code: string) => {
    const product = options.products.find((item) => item.code === code)
    if (product?.materialGradeCode) form.setFieldValue('materialGradeCode', product.materialGradeCode)
    form.setFieldValue('moldCodes', [])
    form.setFieldValue('coreBoxCodes', [])
  }

  const handleMoldChange = (codes: string[]) => {
    const selected = new Set(codes)
    const newlySelected = new Set(codes.filter((code) => !selectedMoldCodes.includes(code)))
    const validCoreBoxCodes = (form.getFieldValue('coreBoxCodes') || []).filter((code: string) => {
      const coreBox = coreBoxRecords.find((item) => item.code === code)
      return Boolean(coreBox && selected.has(coreBox.moldCode))
    })
    const boundCoreBoxCodes = options.coreBoxes
      .filter((item) => newlySelected.has(item.moldCode))
      .map((item) => item.code)
    form.setFieldValue('coreBoxCodes', Array.from(new Set([...validCoreBoxCodes, ...boundCoreBoxCodes])))
  }

  const persist = async (activate: boolean) => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const saved = editing ? await updateBom(editing.id, values) : await createBom(values)
      if (activate) {
        await activateBom(saved.id)
        message.success('BOM 已提交生效')
      } else {
        message.success(editing ? 'BOM 草稿已更新' : 'BOM 草稿已保存')
      }
      closeModal()
      await refresh()
    } catch (error) {
      if (error instanceof Error) message.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const runConfirmed = (title: string, content: string, action: () => Promise<unknown>, success: string, danger = false) => {
    Modal.confirm({
      title,
      content,
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger },
      onOk: async () => {
        try {
          await action()
          message.success(success)
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '操作失败')
        }
      },
    })
  }

  const handleClone = (record: BomRecord) => {
    let targetProductCode = ''
    Modal.confirm({
      title: '克隆 BOM 到其他产品',
      content: (
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="请选择目标产品或半成品"
          style={{ width: '100%', marginTop: 12 }}
          options={options.products.filter((item) => item.code !== record.productCode).map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))}
          onChange={(value) => { targetProductCode = value }}
        />
      ),
      okText: '克隆',
      cancelText: '取消',
      onOk: async () => {
        if (!targetProductCode) {
          message.error('请选择目标产品')
          throw new Error('请选择目标产品')
        }
        await cloneBom(record.id, targetProductCode)
        message.success('BOM 已克隆为目标产品草稿')
        await refresh()
      },
    })
  }

  const columns: TableColumnsType<BomRecord> = [
    { title: '产品编码', dataIndex: 'productCode', key: 'productCode', width: 170 },
    { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 210 },
    { title: '材质牌号', dataIndex: 'materialGradeName', key: 'materialGradeName', width: 170 },
    { title: '毛坯净重', dataIndex: 'netWeightKg', key: 'netWeightKg', width: 120, render: (value: number) => `${value} kg` },
    { title: '浇注毛重', dataIndex: 'grossWeightKg', key: 'grossWeightKg', width: 120, render: (value: number) => `${value} kg` },
    { title: '工艺收得率', dataIndex: 'yieldRate', key: 'yieldRate', width: 125, render: (value: number) => `${value.toFixed(2)}%` },
    { title: '版本号', dataIndex: 'version', key: 'version', width: 100 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: BomStatus) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
    { title: '创建人', dataIndex: 'createdByName', key: 'createdByName', width: 120, render: (value: string) => value || '-' },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 170 },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 220,
      render: (_, record) => <TableActions actions={[
        { key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => void openRecord(record, true) },
        ...(record.status === 'DRAFT' && canEdit ? [{ key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => void openRecord(record, false) }] : []),
        ...(record.status === 'DRAFT' && canActivate ? [{ key: 'activate', label: '生效', icon: <CheckCircleOutlined />, onClick: () => runConfirmed('提交生效', `确认启用 ${record.productName} ${record.version} 吗？`, () => activateBom(record.id), 'BOM 已生效') }] : []),
        ...((record.status === 'ACTIVE' || record.status === 'DISABLED') && canNewVersion ? [{ key: 'new-version', label: '新版本', icon: <FileAddOutlined />, onClick: () => runConfirmed('创建新版本', `基于 ${record.version} 创建下一版本草稿吗？`, () => createBomVersion(record.id), '新版本草稿已创建') }] : []),
        ...(canClone ? [{ key: 'clone', label: '克隆', icon: <CopyOutlined />, onClick: () => handleClone(record) }] : []),
        ...(record.status === 'ACTIVE' && canDisable ? [{ key: 'disable', label: '停用', icon: <StopOutlined />, danger: true, onClick: () => runConfirmed('停用 BOM', `确认停用 ${record.productName} ${record.version} 吗？`, () => disableBom(record.id), 'BOM 已停用', true) }] : []),
        ...(record.status === 'DRAFT' && canDelete ? [{ key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => runConfirmed('删除草稿', `确认删除 ${record.productName} ${record.version} 吗？`, () => deleteBom(record.id), 'BOM 草稿已删除', true) }] : []),
      ]} />,
    },
  ]

  const productOptions = options.products.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))
  const materialOptions = options.materials.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))
  const physicalItemOptions = options.physicalItems.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">铸造 BOM</h1><p className="page-description">维护铸件重量参数、物理用料和可追溯 BOM 版本。</p></div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
        </Space>
      </div>
      <Card>
        <div className="bom-query-row">
          <Input allowClear prefix={<SearchOutlined />} placeholder="产品编码/名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="材质牌号" value={materialGradeCode} options={materialOptions} onChange={setMaterialGradeCode} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="创建人" value={createdByUserId} options={options.creators.map((item) => ({ label: item.name, value: item.id }))} onChange={setCreatedByUserId} />
          <div className="bom-status-filters" aria-label="BOM 状态">
            {statusOptions.map((item) => <Button key={item.value || 'ALL'} autoInsertSpace={false} type={status === item.value ? 'primary' : 'default'} onClick={() => { setStatus(item.value); void refresh(item.value ?? null) }}>{item.label}</Button>)}
          </div>
        </div>
        <ResizableTable storageKey="casting-bom-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ pageSize: 10 }} />
      </Card>

      <Modal title={viewing ? '查看铸造 BOM' : editing ? '编辑铸造 BOM' : '新建铸造 BOM'} open={modalOpen} width={1180} onCancel={closeModal} destroyOnHidden footer={viewing ? <Button onClick={closeModal}>关闭</Button> : <Space><Button onClick={closeModal}>取消</Button><Button loading={saving} onClick={() => void persist(false)}>保存草稿</Button>{canActivate && <Button type="primary" loading={saving} onClick={() => void persist(true)}>提交生效</Button>}</Space>}>
        <Form form={form} layout="vertical" disabled={viewing}>
          <Typography.Title level={5} className="bom-section-title">产品基本信息与重量参数</Typography.Title>
          <div className="bom-basic-grid">
            <Form.Item name="productCode" label="产品" rules={[{ required: true, message: '请选择产品' }]}><Select disabled={Boolean(editing)} showSearch optionFilterProp="label" options={productOptions} onChange={handleProductChange} /></Form.Item>
            <Form.Item name="materialGradeCode" label="材质牌号" rules={[{ required: true, message: '请选择材质牌号' }]}><Select showSearch optionFilterProp="label" options={materialOptions} /></Form.Item>
            <Form.Item name="version" label="BOM 版本"><Input disabled /></Form.Item>
            <Form.Item label="状态"><Input disabled value={statusLabels[editing?.status || 'DRAFT']} /></Form.Item>
            <Form.Item name="netWeightKg" label="毛坯净重（kg）" rules={[{ required: true, message: '请输入毛坯净重' }]}><InputNumber min={0.0001} precision={4} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="grossWeightKg" label="浇注毛重（kg）" rules={[{ required: true, message: '请输入浇注毛重' }]}><InputNumber min={0.0001} precision={4} style={{ width: '100%' }} /></Form.Item>
            <div className="bom-calculated-field"><span>工艺收得率</span><strong>{yieldRate ? `${yieldRate.toFixed(2)}%` : '-'}</strong></div>
            <div className="bom-calculated-field"><span>单件回料重量</span><strong>{grossWeight >= netWeight && grossWeight ? `${returnWeight.toFixed(4)} kg` : '-'}</strong></div>
          </div>

          <Typography.Title level={5} className="bom-section-title">生产工装</Typography.Title>
          <div className="bom-tooling-grid">
            <Form.Item name="moldCodes" label="生产模具">
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                placeholder="请选择生产模具"
                options={availableMolds.map((item) => ({
                  label: `${item.name}（${item.code}） · ${item.itemName || item.itemCode}`,
                  value: item.code,
                }))}
                onChange={handleMoldChange}
              />
            </Form.Item>
            <Form.Item name="coreBoxCodes" label="芯盒工装">
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                placeholder="请选择芯盒工装"
                options={availableCoreBoxes.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))}
              />
            </Form.Item>
          </div>

          <Typography.Title level={5} className="bom-section-title">零件物理用料明细</Typography.Title>
          <div className="bom-detail-header bom-item-grid"><span>物料</span><span>物料类型</span><span>单件标准用量</span><span>单位</span><span>损耗率（%）</span><span>备注</span><span /></div>
          <Form.List name="items">
            {(fields, { add, remove }) => <>
              {fields.map((field) => <Form.Item key={field.key} noStyle shouldUpdate>{() => {
                const row = (form.getFieldValue('items') || [])[field.name] as BomItem | undefined
                const item = options.physicalItems.find((option) => option.code === row?.itemCode)
                return <div className="bom-detail-row bom-item-grid">
                  <Form.Item name={[field.name, 'itemCode']} rules={[{ required: true, message: '请选择物料' }]}><Select showSearch optionFilterProp="label" options={physicalItemOptions} onChange={(code) => { const selected = options.physicalItems.find((option) => option.code === code); form.setFieldValue(['items', field.name, 'unit'], selected?.unit || '件') }} /></Form.Item>
                  <span className="bom-readonly-cell">{item?.type || row?.itemType || '-'}</span>
                  <Form.Item name={[field.name, 'standardQuantity']} rules={[{ required: true, message: '请输入用量' }]}><InputNumber min={0.0001} precision={4} style={{ width: '100%' }} /></Form.Item>
                  <Form.Item name={[field.name, 'unit']} rules={[{ required: true, message: '请输入单位' }]}><Input /></Form.Item>
                  <Form.Item name={[field.name, 'lossRate']}><InputNumber min={0} max={100} precision={4} style={{ width: '100%' }} /></Form.Item>
                  <Form.Item name={[field.name, 'remark']}><Input /></Form.Item>
                  {!viewing && <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />}
                </div>
              }}</Form.Item>)}
              {!viewing && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ standardQuantity: 1, lossRate: 0 })}>添加用料</Button>}
            </>}
          </Form.List>

          <Typography.Title level={5} className="bom-section-title">关联材质可用熔炼配方</Typography.Title>
          {!selectedGradeCode || !availableRecipes.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selectedGradeCode ? '当前材质暂无已生效配方' : '请先选择材质牌号'} /> : <div className="bom-recipe-list">{availableRecipes.map((recipe) => <div key={recipe.code} className="bom-recipe-row"><div><strong>{recipe.name}</strong><span>{recipe.code} / {recipe.version}</span></div><div>适用炉型：{recipe.furnaceNames.join('、') || '-'}</div><div>1 吨配比：{recipe.items.map((item) => `${item.itemName} ${item.ratio ? `${item.ratio}%` : `${item.quantity}${item.unit}`}`).join(' | ')}</div></div>)}</div>}
          <Form.Item name="remark" label="备注" style={{ marginTop: 20 }}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
