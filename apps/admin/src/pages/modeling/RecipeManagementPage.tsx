import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { hasPermission } from '../../utils/roles'
import {
  activateRecipe,
  cloneRecipe,
  createRecipe,
  deleteRecipe,
  disableRecipe,
  fetchRecipeDetail,
  fetchRecipeOptions,
  fetchRecipes,
  updateRecipe,
} from '../../utils/recipes'
import type {
  RecipeItem,
  RecipeOptions,
  RecipePayload,
  RecipeRecord,
  RecipeStatus,
} from '../../utils/recipes'

const statusLabels: Record<RecipeStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '已生效',
  DISABLED: '已停用',
}

const statusColors: Record<RecipeStatus, string> = {
  DRAFT: 'default',
  ACTIVE: 'green',
  DISABLED: 'red',
}

const categoryOptions = [
  { label: '原材料', value: 'RAW' },
  { label: '回炉料', value: 'RETURN' },
  { label: '辅料/合金', value: 'ADDITIVE' },
]

const statusFilterOptions: Array<{ label: string; value?: RecipeStatus }> = [
  { label: '全部' },
  { label: '草稿', value: 'DRAFT' },
  { label: '已生效', value: 'ACTIVE' },
  { label: '已停用', value: 'DISABLED' },
]

function nextVersionPreview(version: string) {
  const matched = /^V(\d+)\.0$/.exec(version)
  return matched ? `V${Number(matched[1]) + 1}.0` : version
}

type RecipeFormValues = RecipePayload & { code?: string }

export function RecipeManagementPage() {
  const [form] = Form.useForm<RecipeFormValues>()
  const [records, setRecords] = useState<RecipeRecord[]>([])
  const [options, setOptions] = useState<RecipeOptions>({ materials: [], furnaces: [], rawMaterials: [] })
  const [keyword, setKeyword] = useState('')
  const [materialGradeCode, setMaterialGradeCode] = useState<string>()
  const [furnaceCode, setFurnaceCode] = useState<string>()
  const [status, setStatus] = useState<RecipeStatus>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RecipeRecord | null>(null)
  const [viewing, setViewing] = useState(false)
  const meltingDuration = Form.useWatch('meltingDurationMinutes', form) || 0
  const transferDuration = Form.useWatch('transferDurationMinutes', form) || 0
  const cleaningDuration = Form.useWatch('cleaningDurationMinutes', form) || 0

  const canCreate = hasPermission('model.recipe.create')
  const canEdit = hasPermission('model.recipe.edit')
  const canDelete = hasPermission('model.recipe.delete')
  const canClone = hasPermission('model.recipe.clone')
  const canActivate = hasPermission('model.recipe.activate')
  const canDisable = hasPermission('model.recipe.disable')

  const refresh = async (nextStatus?: RecipeStatus | null) => {
    const queryStatus = nextStatus === null ? undefined : nextStatus ?? status
    setLoading(true)
    try {
      const [nextRecords, nextOptions] = await Promise.all([
        fetchRecipes({ keyword, materialGradeCode, furnaceCode, status: queryStatus }),
        fetchRecipeOptions(),
      ])
      setRecords(nextRecords)
      setOptions(nextOptions)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '配方数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
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
    form.setFieldsValue({ version: 'V1.0', baseWeightKg: 1000, meltingDurationMinutes: 0, transferDurationMinutes: 0, cleaningDurationMinutes: 0, furnaceCodes: [], targetElements: [], items: [] })
    setModalOpen(true)
  }

  const openRecord = async (record: RecipeRecord, readOnly: boolean) => {
    setLoading(true)
    try {
      const detail = await fetchRecipeDetail(record.code)
      setEditing(detail)
      setViewing(readOnly || (detail.status !== 'DRAFT' && detail.status !== 'DISABLED'))
      form.setFieldsValue({
        code: detail.code,
        name: detail.name,
        materialGradeCode: detail.materialGradeCode,
        furnaceCodes: detail.furnaceCodes,
        version: !readOnly && detail.status === 'DISABLED' ? nextVersionPreview(detail.version) : detail.version,
        baseWeightKg: detail.baseWeightKg,
        meltingDurationMinutes: detail.meltingDurationMinutes,
        transferDurationMinutes: detail.transferDurationMinutes,
        cleaningDurationMinutes: detail.cleaningDurationMinutes,
        targetElements: detail.targetElements,
        items: detail.items,
        remark: detail.remark,
      })
      setModalOpen(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '配方详情加载失败')
    } finally {
      setLoading(false)
    }
  }

  const applyMaterialElements = (code: string) => {
    const material = options.materials.find((item) => item.code === code)
    form.setFieldValue('targetElements', (material?.elements || []).map((item) => ({ ...item })))
  }

  const handleMaterialChange = (code: string) => {
    const current = form.getFieldValue('targetElements') || []
    if (!current.length) {
      applyMaterialElements(code)
      return
    }
    Modal.confirm({
      title: '是否重新带入化学成分',
      content: '当前已维护目标化学成分，重新带入会覆盖现有内容。',
      okText: '重新带入',
      cancelText: '保留现有内容',
      onOk: () => applyMaterialElements(code),
    })
  }

  const recalculateItems = (baseWeight: number) => {
    const items = (form.getFieldValue('items') || []).map((item: RecipeItem) => {
      if (item.materialCategory === 'ADDITIVE' || item.ratio === undefined || item.ratio === null) return item
      return { ...item, quantity: Number((baseWeight * Number(item.ratio) / 100).toFixed(4)), unit: 'kg' }
    })
    form.setFieldValue('items', items)
  }

  const recalculateItem = (index: number) => {
    const baseWeight = Number(form.getFieldValue('baseWeightKg') || 0)
    const items = [...(form.getFieldValue('items') || [])]
    const item = items[index]
    if (!item || item.materialCategory === 'ADDITIVE') return
    items[index] = {
      ...item,
      quantity: item.ratio === undefined || item.ratio === null ? undefined : Number((baseWeight * Number(item.ratio) / 100).toFixed(4)),
      unit: 'kg',
    }
    form.setFieldValue('items', items)
  }

  const persist = async (activate: boolean) => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const saved = editing
        ? await updateRecipe(editing.code, values)
        : await createRecipe(values)
      if (activate) {
        await activateRecipe(saved.code)
        message.success('配方已提交生效')
      } else {
        message.success(editing ? '配方草稿已更新' : '配方草稿已保存')
      }
      closeModal()
      await refresh()
    } catch (error) {
      if (error instanceof Error) message.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const confirmClone = (record: RecipeRecord) => {
    Modal.confirm({
      title: '确认复制配方',
      content: `确定基于 [${record.name}] 创建新配方吗？`,
      okText: '复制',
      cancelText: '取消',
      onOk: async () => {
        try {
          const cloned = await cloneRecipe(record.code)
          message.success(`已生成草稿 ${cloned.code}`)
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '配方复制失败')
        }
      },
    })
  }

  const confirmDisable = (record: RecipeRecord) => {
    Modal.confirm({
      title: '确认停用配方',
      content: `停用后配方 [${record.name}] 可修改，保存修改时版本将自动升级。`,
      okText: '停用',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await disableRecipe(record.code)
          message.success('配方已停用')
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '配方停用失败')
        }
      },
    })
  }

  const confirmActivate = (record: RecipeRecord) => {
    Modal.confirm({
      title: '确认提交生效',
      content: `确定将配方 [${record.name}] 提交生效吗？生效后不能再编辑。`,
      okText: '提交生效',
      cancelText: '取消',
      onOk: async () => {
        try {
          await activateRecipe(record.code)
          message.success('配方已生效')
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '配方生效失败')
        }
      },
    })
  }

  const confirmDelete = (record: RecipeRecord) => {
    Modal.confirm({
      title: '确认删除草稿',
      content: `确定删除配方草稿 [${record.name}] 吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteRecipe(record.code)
          message.success('配方草稿已删除')
          await refresh()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '配方删除失败')
        }
      },
    })
  }

  const columns = useMemo<TableColumnsType<RecipeRecord>>(() => [
    { title: '配方编码', dataIndex: 'code', key: 'code', width: 165 },
    { title: '配方名称', dataIndex: 'name', key: 'name', width: 210 },
    { title: '材质牌号', dataIndex: 'materialGradeName', key: 'materialGradeName', width: 180, render: (_, record) => record.materialGradeName || record.materialGradeCode },
    { title: '适用炉型', dataIndex: 'furnaceNames', key: 'furnaceNames', width: 220, render: (value: string[]) => value?.join('、') || '-' },
    { title: '版本号', dataIndex: 'version', key: 'version', width: 100 },
    { title: '基准重量', dataIndex: 'baseWeightKg', key: 'baseWeightKg', width: 115, render: (value: number) => `${value || 0} kg` },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: RecipeStatus) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
    { title: '创建人', dataIndex: 'createdByName', key: 'createdByName', width: 120, render: (value: string) => value || '-' },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 165 },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 210,
      render: (_, record) => (
        <TableActions actions={[
          { key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => void openRecord(record, true) },
          ...((record.status === 'DRAFT' || record.status === 'DISABLED') && canEdit ? [{ key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => void openRecord(record, false) }] : []),
          ...(record.status === 'DRAFT' && canActivate ? [{ key: 'activate', label: '生效', icon: <CheckCircleOutlined />, onClick: () => confirmActivate(record) }] : []),
          ...(canClone ? [{ key: 'clone', label: '复制', icon: <CopyOutlined />, onClick: () => confirmClone(record) }] : []),
          ...(record.status === 'ACTIVE' && canDisable ? [{ key: 'disable', label: '停用', icon: <StopOutlined />, danger: true, onClick: () => confirmDisable(record) }] : []),
          ...(record.status === 'DRAFT' && canDelete ? [{ key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => confirmDelete(record) }] : []),
        ]} />
      ),
    },
  ], [canActivate, canClone, canDelete, canDisable, canEdit])

  const canSave = editing ? canEdit : canCreate
  const canSubmitFromModal = canSave && canActivate && editing?.status !== 'DISABLED'
  const materialOptions = options.materials.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))
  const furnaceOptions = options.furnaces.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))
  const rawMaterialOptions = options.rawMaterials.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">熔炼配方</h1>
          <p className="page-description">维护材质牌号、适用炉型、目标化学成分和标准配料。</p>
        </div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
        </Space>
      </div>

      <Card>
        <div className="recipe-query-grid">
          <Input allowClear prefix={<SearchOutlined />} placeholder="配方编码/名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="材质牌号" value={materialGradeCode} options={materialOptions} onChange={setMaterialGradeCode} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="适用炉型" value={furnaceCode} options={furnaceOptions} onChange={setFurnaceCode} />
          <div className="recipe-status-filters" aria-label="配方状态">
            {statusFilterOptions.map((item) => (
              <Button
                key={item.value || 'ALL'}
                autoInsertSpace={false}
                type={status === item.value ? 'primary' : 'default'}
                onClick={() => {
                  setStatus(item.value)
                  void refresh(item.value ?? null)
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>

        </div>
        <ResizableTable
          storageKey="modeling-recipes-widths"
          rowKey="code"
          columns={columns}
          dataSource={records}
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={viewing ? '查看熔炼配方' : editing ? '编辑熔炼配方' : '新建熔炼配方'}
        open={modalOpen}
        width={1180}
        onCancel={closeModal}
        destroyOnHidden
        footer={viewing ? <Button onClick={closeModal}>关闭</Button> : (
          <Space>
            <Button onClick={closeModal}>取消</Button>
            {canSave && <Button loading={saving} onClick={() => void persist(false)}>保存为草稿</Button>}
            {canSubmitFromModal && <Button type="primary" loading={saving} onClick={() => void persist(true)}>提交生效</Button>}
          </Space>
        )}
      >
        <Form form={form} layout="vertical" disabled={viewing}>
          <Typography.Title level={5} className="recipe-section-title">基本信息</Typography.Title>
          <div className="recipe-basic-grid">
            <Form.Item name="code" label="配方编码"><Input disabled placeholder="保存后自动生成" /></Form.Item>
            <Form.Item name="name" label="配方名称" rules={[{ required: true, message: '请输入配方名称' }]}><Input /></Form.Item>
            <Form.Item name="materialGradeCode" label="材质牌号" rules={[{ required: true, message: '请选择材质牌号' }]}>
              <Select showSearch optionFilterProp="label" options={materialOptions} onChange={handleMaterialChange} />
            </Form.Item>
            <Form.Item name="furnaceCodes" label="适用炉型" rules={[{ required: true, message: '请选择适用炉型' }]}>
              <Select mode="multiple" showSearch optionFilterProp="label" options={furnaceOptions} />
            </Form.Item>
            <Form.Item name="version" label="版本号" rules={[{ required: true, message: '请输入版本号' }]}><Input disabled /></Form.Item>
            <Form.Item name="baseWeightKg" label="基准重量（kg）" rules={[{ required: true, message: '请输入基准重量' }]}>
              <InputNumber min={0.0001} style={{ width: '100%' }} onChange={(value) => recalculateItems(Number(value || 0))} />
            </Form.Item>
          </div>
          <div className="recipe-duration-grid">
            <Form.Item name="meltingDurationMinutes" label="熔炼时长（分钟）" rules={[{ required: true }, { type: 'integer', min: 0, message: '请输入非负整数' }]}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="transferDurationMinutes" label="转运时长（分钟）" rules={[{ required: true }, { type: 'integer', min: 0, message: '请输入非负整数' }]}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="cleaningDurationMinutes" label="清炉时长（分钟）" rules={[{ required: true }, { type: 'integer', min: 0, message: '请输入非负整数' }]}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <div className="recipe-duration-total">标准设备占用时长：<strong>{Number(meltingDuration) + Number(transferDuration) + Number(cleaningDuration)} 分钟</strong></div>
          </div>

          <Typography.Title level={5} className="recipe-section-title">目标化学成分（炉前光谱化验标准）</Typography.Title>
          <div className="recipe-detail-header recipe-element-grid"><span>元素</span><span>目标下限（%）</span><span>目标上限（%）</span><span>单位</span><span>备注/控制要点</span><span /></div>
          <Form.List name="targetElements">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key} className="recipe-detail-row recipe-element-grid">
                    <Form.Item name={[field.name, 'elementName']} rules={[{ required: true, message: '请选择元素' }]}><Input placeholder="元素" /></Form.Item>
                    <Form.Item name={[field.name, 'minValue']}><InputNumber min={0} precision={6} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name={[field.name, 'maxValue']}><InputNumber min={0} precision={6} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name={[field.name, 'unit']}><Input placeholder="%" /></Form.Item>
                    <Form.Item name={[field.name, 'remark']}><Input placeholder="控制要点" /></Form.Item>
                    {!viewing && <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />}
                  </div>
                ))}
                {!viewing && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ unit: '%' })}>添加元素</Button>}
              </>
            )}
          </Form.List>

          <Typography.Title level={5} className="recipe-section-title">标准配料与辅料明细</Typography.Title>
          <div className="recipe-detail-header recipe-item-grid"><span>物料</span><span>物料类型</span><span>配料分类</span><span>投料比例（%）</span><span>标准用量（kg）</span><span>备注</span><span /></div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Form.Item key={field.key} noStyle shouldUpdate>
                    {() => {
                      const row = (form.getFieldValue('items') || [])[field.name] as RecipeItem | undefined
                      const material = options.rawMaterials.find((item) => item.code === row?.itemCode)
                      const additive = row?.materialCategory === 'ADDITIVE'
                      return (
                        <div className="recipe-detail-row recipe-item-grid">
                          <Form.Item name={[field.name, 'itemCode']} rules={[{ required: true, message: '请选择物料' }]}>
                            <Select showSearch optionFilterProp="label" options={rawMaterialOptions} onChange={() => form.setFieldValue(['items', field.name, 'unit'], 'kg')} />
                          </Form.Item>
                          <span className="recipe-readonly-cell">{material?.type || '-'}</span>
                          <Form.Item name={[field.name, 'materialCategory']} rules={[{ required: true, message: '请选择分类' }]}>
                            <Select options={categoryOptions} onChange={() => recalculateItem(field.name)} />
                          </Form.Item>
                          <Form.Item name={[field.name, 'ratio']}>
                            <InputNumber disabled={additive || viewing} min={0} max={100} precision={4} style={{ width: '100%' }} onChange={() => recalculateItem(field.name)} />
                          </Form.Item>
                          <Form.Item name={[field.name, 'quantity']}>
                            <InputNumber disabled={!additive || viewing} min={0} precision={4} style={{ width: '100%' }} />
                          </Form.Item>
                          <Form.Item name={[field.name, 'remark']}><Input placeholder="备注" /></Form.Item>
                          {!viewing && <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />}
                        </div>
                      )
                    }}
                  </Form.Item>
                ))}
                {!viewing && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ materialCategory: 'RAW', unit: 'kg' })}>添加配料</Button>}
              </>
            )}
          </Form.List>

          <Form.Item name="remark" label="备注" style={{ marginTop: 20 }}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
