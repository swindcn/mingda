import { CheckOutlined, CloudUploadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Drawer, Form, Input, InputNumber, Select, Space, Switch, Tabs, Tag, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { hasPermission } from '../../utils/roles'
import {
  activateProcessRouting,
  createProcessRouting,
  fetchProcessRouting,
  fetchProcessRoutingOptions,
  updateRoutingApplicableProducts,
  updateProcessRouting,
  type ProcessRoutingPayload,
  type ProcessRoutingRecord,
  type RouteType,
  type RoutingNodeRecord,
  type RoutingOptions,
} from '../../utils/processRoutings'
import { RoutingCanvas } from './routing/RoutingCanvas'
import { RoutingApplicableProducts } from './routing/RoutingApplicableProducts'

const routeTypeOptions: Array<{ label: string; value: RouteType }> = [
  { label: '熔炼副线', value: 'MELT_BRANCH' },
  { label: '制芯副线', value: 'CORE_BRANCH' },
  { label: '造型主线', value: 'MOLD_MAIN' },
  { label: '关键汇合', value: 'MERGE_POINT' },
  { label: '汇合后主线', value: 'AFTER_MERGE' },
]

const statusLabels = { DRAFT: '草稿', ACTIVE: '已生效', DISABLED: '已停用' }

interface BasicValues {
  code: string
  name: string
  remark?: string
}

export function ProcessRoutingWorkbenchPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const [basicForm] = Form.useForm<BasicValues>()
  const [nodeForm] = Form.useForm<RoutingNodeRecord>()
  const lastInitializedNodeId = useRef<string | undefined>(undefined)
  const [options, setOptions] = useState<RoutingOptions>({ products: [], operations: [], equipment: [] })
  const [record, setRecord] = useState<ProcessRoutingRecord>()
  const [productCodes, setProductCodes] = useState<string[]>([])
  const [nodes, setNodes] = useState<RoutingNodeRecord[]>([])
  const [edges, setEdges] = useState<ProcessRoutingRecord['edges']>([])
  const [operationKeyword, setOperationKeyword] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const isNew = location.pathname.endsWith('/new')
  const editRoute = location.pathname.endsWith('/edit')
  const editable = (isNew || editRoute) && hasPermission(isNew ? 'model.routing.create' : 'model.routing.edit')
  const canActivate = hasPermission('model.routing.activate')

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchProcessRoutingOptions(), id ? fetchProcessRouting(id) : Promise.resolve(undefined)])
      .then(([nextOptions, detail]) => {
        if (cancelled) return
        setOptions(nextOptions)
        if (detail) {
          setRecord(detail)
          setNodes(detail.nodes)
          setEdges(detail.edges)
          setProductCodes(detail.productCodes)
          basicForm.setFieldsValue({ code: detail.code, name: detail.name, remark: detail.remark })
        } else {
          setProductCodes([])
          basicForm.setFieldsValue({ code: '', name: '', remark: '' })
        }
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '路线详情加载失败'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [basicForm, id])

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)
  const isShakeCleaningNode = Boolean(selectedNode && (selectedNode.operationCode === 'OP-SHAKE' || selectedNode.section === '清理'))
  useEffect(() => {
    if (lastInitializedNodeId.current === selectedNodeId) return
    lastInitializedNodeId.current = selectedNodeId
    nodeForm.resetFields()
    if (selectedNode) {
      nodeForm.setFieldsValue({
        ...selectedNode,
        coolingDurationMinutes: selectedNode.coolingDurationMinutes ?? 0,
      })
    }
  }, [nodeForm, nodes, selectedNodeId])

  const operations = useMemo(() => {
    const key = operationKeyword.trim().toLowerCase()
    return options.operations.filter((operation) => !key || `${operation.code}${operation.name}${operation.section}`.toLowerCase().includes(key))
  }, [operationKeyword, options.operations])

  const syncSelectedNode = (_: Partial<RoutingNodeRecord>, values: RoutingNodeRecord) => {
    if (!selectedNodeId) return
    const operation = options.operations.find((item) => item.code === values.operationCode)
    const pouring = Boolean(operation?.pouringMergePoint)
    const routeType = pouring ? 'MERGE_POINT' : values.routeType
    setNodes((current) => current.map((node) => node.id === selectedNodeId ? {
      ...node,
      ...values,
      routeType,
      requireFurnaceBatch: pouring || Boolean(values.requireFurnaceBatch),
      requireLadle: pouring || Boolean(values.requireLadle),
      requireCoreBatch: pouring || Boolean(values.requireCoreBatch),
      positionX: node.positionX,
      positionY: node.positionY,
    } : node))
  }

  const save = async (activate: boolean) => {
    try {
      const values = await basicForm.validateFields()
      setSaving(true)
      const payload: ProcessRoutingPayload = { ...values, productCodes, nodes, edges }
      const saved = record ? await updateProcessRouting(record.id, payload) : await createProcessRouting(payload)
      if (activate) {
        const active = await activateProcessRouting(saved.id)
        message.success('工艺路线已发布生效')
        navigate(`/dashboard/model/routing/${active.id}`, { replace: true, state: location.state })
      } else {
        message.success(record ? '路线草稿已更新' : '路线草稿已保存')
        setRecord(saved)
        setProductCodes(saved.productCodes)
        setNodes(saved.nodes)
        setEdges(saved.edges)
        if (!record) navigate(`/dashboard/model/routing/${saved.id}/edit`, { replace: true, state: location.state })
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工艺路线保存失败，请检查必填项和路线配置')
    } finally {
      setSaving(false)
    }
  }

  const productEditable = isNew
    ? hasPermission('model.routing.create')
    : Boolean(record && record.status !== 'DISABLED' && hasPermission('model.routing.edit'))

  const changeApplicableProducts = async (nextCodes: string[]) => {
    if (!record) {
      setProductCodes(nextCodes)
      return
    }
    const updated = await updateRoutingApplicableProducts(record.id, nextCodes)
    setRecord(updated)
    setProductCodes(updated.productCodes)
  }

  const refreshApplicableProducts = async () => {
    if (!record) return
    const updated = await fetchProcessRouting(record.id)
    setRecord(updated)
    setProductCodes(updated.productCodes)
  }

  if (loading) return null

  return <div className="routing-workbench-page">
    <SubPageHeader
      title={isNew ? '新建工艺路线' : `${record?.name || '工艺路线'} ${record?.version || ''}`}
      description="通过标准工序库配置主副线并行、浇注汇合和后续生产工序。"
      onBack={() => navigate(`/dashboard/model/routing${location.state?.returnSearch || ''}`)}
      extra={<Space>
        {record && <Tag color={record.status === 'ACTIVE' ? 'success' : record.status === 'DRAFT' ? 'gold' : 'default'}>{statusLabels[record.status]}</Tag>}
        {editable && <Button onClick={() => void save(false)} loading={saving}>保存草稿</Button>}
        {editable && canActivate && <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => void save(true)} loading={saving}>发布生效</Button>}
      </Space>}
    />

    <Tabs className="routing-workbench-tabs" items={[
      {
        key: 'route',
        label: '工艺线路',
        children: <>
          <Card className="routing-basic-card">
            <Form form={basicForm} layout="vertical" disabled={!editable}>
              <div className="routing-basic-grid">
                <Form.Item name="code" label="路线编号" rules={[{ required: true, message: '请输入路线编号' }, { pattern: /^[^\s\u4e00-\u9fff]+$/, message: '编码不能包含中文或空格' }]}><Input disabled={Boolean(record)} /></Form.Item>
                <Form.Item name="name" label="路线名称" rules={[{ required: true, message: '请输入路线名称' }]}><Input /></Form.Item>
                <Form.Item label="路线版本"><Input disabled value={record?.version || 'V1.0'} /></Form.Item>
                <Form.Item name="remark" label="备注" className="routing-basic-remark"><Input /></Form.Item>
              </div>
            </Form>
          </Card>
          <div className="routing-editor-layout">
            <Card className="operation-library" title="标准工序库" size="small">
              <Input allowClear prefix={<SearchOutlined />} placeholder="搜索工序" value={operationKeyword} onChange={(event) => setOperationKeyword(event.target.value)} />
              <div className="operation-library-list">
                {operations.map((operation) => <div
                  key={operation.code}
                  className="operation-library-item"
                  draggable={editable}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/mingda-operation', operation.code)
                    event.dataTransfer.setData('text/plain', operation.code)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <div><strong>{operation.name}</strong><Tag>{operation.section}</Tag></div>
                  <span>{operation.code} · {operation.reportMode === 'BATCH' ? '批次报工' : '单件报工'}</span>
                </div>)}
              </div>
            </Card>
            <Card className="routing-canvas-card" size="small" title={<span>路线编排 <small>{editable ? '从左侧拖入工序，连接节点建立前后关系' : '查看模式'}</small></span>}>
              <RoutingCanvas nodes={nodes} edges={edges} operations={options.operations} editable={editable} onNodesChange={setNodes} onEdgesChange={setEdges} onSelectNode={setSelectedNodeId} />
            </Card>
          </div>
        </>,
      },
      {
        key: 'products',
        label: `适用产品（${productCodes.length}）`,
        children: <RoutingApplicableProducts
          products={options.products}
          selectedCodes={productCodes}
          currentRoutingCode={record?.code}
          defaultProductCodes={record?.defaultProductCodes || []}
          editable={productEditable}
          saved={Boolean(record)}
          onChange={changeApplicableProducts}
          onRefresh={refreshApplicableProducts}
        />,
      },
    ]} />

    <Drawer title="工序节点配置" open={Boolean(selectedNode)} onClose={() => setSelectedNodeId(undefined)} width={420} mask={false} destroyOnHidden>
      {selectedNode && <Form form={nodeForm} layout="vertical" disabled={!editable} onValuesChange={syncSelectedNode}>
        <div className="routing-node-summary"><strong>{selectedNode.operationName}</strong><span>{selectedNode.operationCode} · {selectedNode.section}</span></div>
        <Form.Item name="operationCode" hidden><Input /></Form.Item>
        <Form.Item name="routeType" label="路线属性"><Select disabled={Boolean(selectedNode.pouringMergePoint)} options={routeTypeOptions} /></Form.Item>
        <div className="routing-drawer-switches">
          <Form.Item name="reportEnabled" label="报工采集点" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="qualityControlEnabled" label="质检控制点" valuePropName="checked"><Switch /></Form.Item>
        </div>
        <Form.Item name="qualityRequirement" label="质检要求"><Input placeholder="如：光谱首检、温度/球化、100%全检" /></Form.Item>
        <Form.Item name="equipmentCodes" label="适用设备"><Select mode="multiple" showSearch optionFilterProp="label" options={options.equipment.map((item) => ({ label: `${item.name}（${item.code}）${item.workshopName ? ` · ${item.workshopName}` : ''}`, value: item.code }))} /></Form.Item>
        <Form.Item name="standardCycleSeconds" label="标准节拍（秒）"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
        {isShakeCleaningNode && <Form.Item name="coolingDurationMinutes" label="要求冷却时长（分钟）"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>}
        <div className="routing-binding-title">生产绑定规则 {selectedNode.pouringMergePoint && <Tag color="orange" icon={<CheckOutlined />}>浇注强制</Tag>}</div>
        <div className="routing-drawer-switches routing-binding-switches">
          <Form.Item name="requireFurnaceBatch" label="炉批次" valuePropName="checked"><Switch disabled={Boolean(selectedNode.pouringMergePoint) || !editable} /></Form.Item>
          <Form.Item name="requireLadle" label="铁水包号" valuePropName="checked"><Switch disabled={Boolean(selectedNode.pouringMergePoint) || !editable} /></Form.Item>
          <Form.Item name="requireCoreBatch" label="砂芯批次" valuePropName="checked"><Switch disabled={Boolean(selectedNode.pouringMergePoint) || !editable} /></Form.Item>
        </div>
        <Form.Item name="remark" label="节点备注"><Input.TextArea rows={3} /></Form.Item>
      </Form>}
    </Drawer>
  </div>
}
