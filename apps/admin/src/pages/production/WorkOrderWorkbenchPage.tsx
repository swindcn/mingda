import { EyeOutlined, SendOutlined, ToolOutlined } from '@ant-design/icons'
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Tooltip, message } from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { resolveCoreTaskEntry } from '../../utils/coremaking'
import { createWorkOrder, fetchWorkOrder, fetchWorkOrderOptions, fetchWorkOrderPreview, fetchWorkOrderRoutingExecution, releaseWorkOrderMelt, updateWorkOrder, workOrderRecordToPreview, type WorkOrderPayload, type WorkOrderPreview, type WorkOrderRecord, type WorkOrderRoutingExecutionNode } from '../../utils/production'
import { hasPermission } from '../../utils/roles'
import { CoreReadinessPanel } from './CoreReadinessPanel'
import { CoreTaskGenerationModal } from './CoreTaskGenerationModal'
import { MoldingTaskGenerationModal } from './MoldingTaskGenerationModal'

type FormValues = Omit<WorkOrderPayload, 'plannedStartDate' | 'plannedDeliveryDate'> & { plannedStartDate?: dayjs.Dayjs; plannedDeliveryDate: dayjs.Dayjs }

const executionStatusColors: Record<WorkOrderRoutingExecutionNode['dispatchStatus'], string> = {
  PENDING: 'default', PARTIAL: 'gold', RELEASED: 'blue', WAITING_UPSTREAM: 'default', UNSUPPORTED: 'default',
}

const executionRoutePaths: Partial<Record<WorkOrderRoutingExecutionNode['module'], string>> = {
  CORE: '/dashboard/production/core-tasks',
  MELT: '/dashboard/production/heat-orders',
  MOLDING: '/dashboard/production/molding-tasks',
  POURING: '/dashboard/production/pouring-tasks',
  SHAKE_CLEAN: '/dashboard/production/shake-clean-tasks',
  INSPECTION: '/dashboard/production/inspection-tasks',
}

function renderCompactNames(values: string[] | undefined) {
  if (!values?.length) return <span>-</span>
  const compact = values.length <= 2 ? values.join('、') : `${values.slice(0, 2).join('、')} 等 ${values.length - 2} 项`
  return <Tooltip title={values.join('、')}>{compact}</Tooltip>
}

function previewToExecutionNodes(nodes: WorkOrderPreview['routingNodes']): WorkOrderRoutingExecutionNode[] {
  return nodes.map((node) => ({
    nodeId: node.id,
    seqNo: node.seqNo,
    operationCode: node.operationCode,
    operationName: node.operationName,
    module: 'UNSUPPORTED',
    dispatchStatus: 'UNSUPPORTED',
    dispatchLabel: '-',
    progressStatus: 'NOT_STARTED',
    progressLabel: '-',
    progressText: '-',
    progressCurrent: null,
    progressTotal: null,
    progressUnit: '件',
    equipmentNames: [],
    teamNames: [],
    taskCount: 0,
    action: 'NONE',
    actionEnabled: false,
    actionPermission: '',
    actionHint: '',
  }))
}

export function WorkOrderWorkbenchPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [form] = Form.useForm<FormValues>()
  const [options, setOptions] = useState<Array<{ code: string; name: string }>>([])
  const [preview, setPreview] = useState<WorkOrderPreview | null>(null)
  const [record, setRecord] = useState<WorkOrderRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [executionNodes, setExecutionNodes] = useState<WorkOrderRoutingExecutionNode[]>([])
  const [generationOpen, setGenerationOpen] = useState(false)
  const [moldingGenerationOpen, setMoldingGenerationOpen] = useState(false)
  const viewing = Boolean(id && !location.pathname.endsWith('/edit'))
  const canCreateCoreTask = hasPermission('production.core_task.create')
  const canViewCoreTask = hasPermission('production.core_task.view')
  const canSave = hasPermission(id ? 'production.work_order.edit' : 'production.work_order.create')
  const canViewMolding = hasPermission('production.molding.view')

  const loadExecutionSummary = async (workOrderId: string) => {
    try {
      setExecutionNodes(await fetchWorkOrderRoutingExecution(workOrderId))
    } catch (error) {
      setExecutionNodes([])
      message.error(error instanceof Error ? error.message : '工序执行摘要加载失败')
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const productOptions = await fetchWorkOrderOptions()
        setOptions(productOptions.products)
        if (id) {
          const detail = await fetchWorkOrder(id)
          setRecord(detail)
          setPreview(workOrderRecordToPreview(detail))
          await loadExecutionSummary(id)
          form.setFieldsValue({
            productCode: detail.productCode,
            bomVersionId: detail.bomVersionId,
            routingVersionId: detail.routingVersionId,
            plannedQuantity: detail.plannedQuantity,
            plannedStartDate: detail.plannedStartDate ? dayjs(detail.plannedStartDate) : undefined,
            plannedDeliveryDate: dayjs(detail.plannedDeliveryDate),
            priority: detail.priority,
            remark: detail.remark,
            versionNo: detail.versionNo,
          })
        } else {
          setExecutionNodes([])
          form.setFieldsValue({ priority: 'NORMAL' })
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '工单信息加载失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [form, id])

  const selectProduct = async (productCode: string) => {
    try {
      const next = await fetchWorkOrderPreview(productCode)
      setPreview(next)
      form.setFieldsValue({ bomVersionId: next.bomVersionId, routingVersionId: next.routingVersionId })
    } catch (error) {
      setPreview(null)
      message.error(error instanceof Error ? error.message : '产品基础数据不完整')
    }
  }

  const save = async () => {
    try {
      const values = await form.validateFields()
      if (!preview) throw new Error('请先选择基础数据完整的产品')
      setLoading(true)
      const payload: WorkOrderPayload = {
        ...values,
        bomVersionId: preview.bomVersionId,
        routingVersionId: preview.routingVersionId,
        plannedStartDate: values.plannedStartDate?.format('YYYY-MM-DD'),
        plannedDeliveryDate: values.plannedDeliveryDate.format('YYYY-MM-DD'),
        versionNo: record?.versionNo,
      }
      const saved = id ? await updateWorkOrder(id, payload) : await createWorkOrder(payload)
      message.success(id ? '生产工单已更新' : '生产工单已提交排产')
      navigate(`/dashboard/production/work-orders/${saved.id}`, { replace: true })
    } catch (error) {
      if (error instanceof Error) message.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const quantity = Number(Form.useWatch('plannedQuantity', form) || 0)
  const totalNet = preview ? quantity * preview.unitNetWeightKg : 0
  const totalMelt = preview ? quantity * preview.unitGrossWeightKg : 0
  const totalReturn = preview ? quantity * preview.unitReturnWeightKg : 0
  const coreTaskEntry = record ? resolveCoreTaskEntry(record, canCreateCoreTask, canViewCoreTask) : 'NONE'

  const refreshRecord = async () => {
    if (!id) return
    setLoading(true)
    try {
      const detail = await fetchWorkOrder(id)
      setRecord(detail)
      setPreview(workOrderRecordToPreview(detail))
      await loadExecutionSummary(id)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工单信息刷新失败')
    } finally {
      setLoading(false)
    }
  }

  const routingRows = viewing ? executionNodes : previewToExecutionNodes(preview?.routingNodes || [])

  const loadMeltReleaseWarnings = async (workOrderId: string) => {
    const latestNodes = await fetchWorkOrderRoutingExecution(workOrderId)
    setExecutionNodes(latestNodes)
    const meltNode = latestNodes.find((item) => item.module === 'MELT')
    if (meltNode?.actionHint) return meltNode.actionHint.split('；').filter(Boolean)
    const coreNode = latestNodes.find((item) => item.module === 'CORE')
    if (!coreNode || coreNode.progressStatus === 'COMPLETED') return []
    return [`制芯工序当前为“${coreNode.progressLabel || '未完成'}”，仍可下达熔炼排产`]
  }

  const openExecutionAction = async (node: WorkOrderRoutingExecutionNode) => {
    if (!record || !node.actionEnabled || !node.actionPermission || !hasPermission(node.actionPermission)) return
    if (node.action === 'CREATE' && node.module === 'CORE') {
      setGenerationOpen(true)
      return
    }
    if (node.action === 'CREATE' && node.module === 'MOLDING') {
      setMoldingGenerationOpen(true)
      return
    }
    if (node.action === 'RELEASE_MELT') {
      try {
        setLoading(true)
        const preflightWarnings = await loadMeltReleaseWarnings(record.id)
        Modal.confirm({
          title: '下达熔炼排产',
          content: preflightWarnings.length
            ? <Space direction="vertical" size={4}>{preflightWarnings.map((warning) => <span key={warning}>{warning}</span>)}<span>确认仍要下达至合炉排产池吗？</span></Space>
            : '当前未检测到可识别的上游风险，确认下达至合炉排产池吗？',
          okText: '确认下达',
          cancelText: '取消',
          onOk: async () => {
            try {
              setLoading(true)
              const result = await releaseWorkOrderMelt(record.id, node.nodeId)
              if (result.warnings.length) {
                Modal.warning({
                  title: '熔炼排产已下达，请关注以下风险',
                  content: <Space direction="vertical" size={4}>{result.warnings.map((warning) => <span key={warning.code}>{warning.message}</span>)}</Space>,
                })
              } else {
                message.success(result.alreadyReleased ? '熔炼排产已下达，无需重复操作' : '熔炼任务已下达')
              }
              await refreshRecord()
            } catch (error) {
              message.error(error instanceof Error ? error.message : '熔炼任务下达失败')
            } finally {
              setLoading(false)
            }
          },
        })
      } catch (error) {
        message.error(error instanceof Error ? error.message : '熔炼风险检查失败，请刷新后重试')
      } finally {
        setLoading(false)
      }
      return
    }
    if (node.action === 'VIEW') {
      const path = executionRoutePaths[node.module]
      if (path) navigate(`${path}?workOrderId=${encodeURIComponent(record.id)}`)
    }
  }

  const routingColumns: TableColumnsType<WorkOrderRoutingExecutionNode> = [
    { title: '顺序', dataIndex: 'seqNo', key: 'seqNo', width: 78 },
    { title: '工序编码', dataIndex: 'operationCode', key: 'operationCode', width: 135 },
    { title: '工序名称', dataIndex: 'operationName', key: 'operationName', width: 150 },
    { title: '工序状态', dataIndex: 'dispatchLabel', key: 'dispatchLabel', width: 105, render: (value: string, node) => <Tag color={executionStatusColors[node.dispatchStatus]}>{value}</Tag> },
    {
      title: '工序进度', key: 'progress', width: 190,
      render: (_, node) => node.progressCurrent !== null && node.progressTotal !== null
        ? <Space size={8}><Progress percent={node.progressTotal ? Math.min(100, Number((node.progressCurrent / node.progressTotal * 100).toFixed(1))) : 0} size="small" style={{ width: 90 }} showInfo={false} /><span>{node.progressText || `${node.progressCurrent}/${node.progressTotal} ${node.progressUnit}`}</span></Space>
        : <span>{node.progressText || node.progressLabel || '-'}</span>,
    },
    { title: '设备', dataIndex: 'equipmentNames', key: 'equipmentNames', width: 180, render: (values: string[]) => renderCompactNames(values) },
    { title: '班组', dataIndex: 'teamNames', key: 'teamNames', width: 150, render: (values: string[]) => renderCompactNames(values) },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 110,
      render: (_, node) => {
        if (['WAIT', 'NONE'].includes(node.action)) return <span aria-disabled="true">{node.action === 'WAIT' ? '等待上游' : '暂未接入'}</span>
        if (!node.actionEnabled || !node.actionPermission || !hasPermission(node.actionPermission)) return null
        const label = node.action === 'VIEW' ? '查看' : node.action === 'RELEASE_MELT' ? '下达' : '生成'
        return <TableActions actions={[{ key: node.action, label, shortLabel: label, icon: node.action === 'VIEW' ? <EyeOutlined /> : node.action === 'RELEASE_MELT' ? <SendOutlined /> : <ToolOutlined />, onClick: () => void openExecutionAction(node) }]} />
      },
    },
  ]

  return (
    <>
      <SubPageHeader
        title={viewing ? '生产工单详情' : id ? '编辑生产工单' : '新建生产工单'}
        description="按工艺路线手动下达各工序任务，任务产生有效分配后关键字段将锁定。"
        onBack={() => navigate('/dashboard/production/work-orders')}
        extra={!viewing && canSave ? <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void save()}>提交排产</Button> : undefined}
      />
      <Form form={form} layout="vertical" disabled={viewing}>
        <Card title="工单基本信息" loading={loading}>
          <div className="production-form-grid">
            <Form.Item name="productCode" label="产品/半成品" rules={[{ required: true, message: '请选择产品或半成品' }]}>
              <Select showSearch optionFilterProp="label" placeholder="请选择产品" options={options.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))} onChange={(value) => void selectProduct(value)} />
            </Form.Item>
            <Form.Item label="材质牌号"><Input value={preview ? `${preview.materialGradeName}（${preview.materialGradeCode}）` : ''} readOnly /></Form.Item>
            <Form.Item label={id ? 'BOM 版本（工单锁定）' : 'BOM 版本（已生效）'}><Input value={preview ? `${preview.bomCode} / ${preview.bomVersion}` : ''} readOnly /></Form.Item>
            <Form.Item label="工艺路线"><Input value={preview ? `${preview.routingName} / ${preview.routingVersion}` : ''} readOnly /></Form.Item>
            <Form.Item name="plannedQuantity" label="计划生产件数" rules={[{ required: true, message: '请输入计划生产件数' }]}><InputNumber min={1} precision={0} addonAfter="件" style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="plannedStartDate" label="计划开工日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="plannedDeliveryDate" label="计划交期" rules={[{ required: true, message: '请选择计划交期' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="priority" label="优先级"><Select options={[{ label: '普通', value: 'NORMAL' }, { label: '紧急', value: 'URGENT' }]} /></Form.Item>
          </div>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Card>
      </Form>
      <Card title="重量与需求计算" className="production-section-card">
        <Descriptions column={4} size="small" bordered>
          <Descriptions.Item label="单件毛坯净重">{preview?.unitNetWeightKg || 0} kg</Descriptions.Item>
          <Descriptions.Item label="单件浇注毛重">{preview?.unitGrossWeightKg || 0} kg</Descriptions.Item>
          <Descriptions.Item label="工艺收得率">{preview?.yieldRate?.toFixed(2) || 0}%</Descriptions.Item>
          <Descriptions.Item label="单件回料重量">{preview?.unitReturnWeightKg || 0} kg</Descriptions.Item>
          <Descriptions.Item label="交货总净重"><strong>{totalNet.toFixed(2)} kg</strong></Descriptions.Item>
          <Descriptions.Item label="铁水总需求"><strong>{totalMelt.toFixed(2)} kg</strong></Descriptions.Item>
          <Descriptions.Item label="预期回收料"><strong>{totalReturn.toFixed(2)} kg</strong></Descriptions.Item>
          <Descriptions.Item label="当前状态">{record ? <Tag color="blue">{record.displayStatus}</Tag> : '提交后进入待排产'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="工艺路线执行" className="production-section-card">
        <ResizableTable<WorkOrderRoutingExecutionNode> storageKey="production-work-order-routing-execution-widths" rowKey="nodeId" size="small" pagination={false} dataSource={routingRows} columns={routingColumns} scroll={{ x: 1100 }} locale={{ emptyText: '暂无工艺路线' }} />
      </Card>
      {record && <Card title="关联熔炼任务" className="production-section-card">
        <Table rowKey="allocationId" size="small" pagination={false} dataSource={record.heatOrders} columns={[
          { title: '炉次编号', dataIndex: 'heatOrderCode' },
          { title: '分配件数', dataIndex: 'allocatedQuantity', render: (value: number) => `${value} 件` },
          { title: '计划铁水', dataIndex: 'plannedWeightKg', render: (value: number) => `${value} kg` },
          { title: '实际分摊', dataIndex: 'actualWeightKg', render: (value: number | null) => value === null ? '-' : `${value} kg` },
          { title: '状态', dataIndex: 'status' },
        ]} />
      </Card>}
      {viewing && record && <Card title="制芯计划" className="production-section-card">
        {coreTaskEntry === 'NOT_REQUIRED' ? <Alert type="info" showIcon message="该工单无需制芯" /> : <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="任务总数">{record.coreTaskSummary.total}</Descriptions.Item>
          <Descriptions.Item label="待派工">{record.coreTaskSummary.pendingDispatch}</Descriptions.Item>
          <Descriptions.Item label="待生产/生产中">{record.coreTaskSummary.waiting} / {record.coreTaskSummary.inProgress}</Descriptions.Item>
          <Descriptions.Item label="已完成/已取消">{record.coreTaskSummary.completed} / {record.coreTaskSummary.canceled}</Descriptions.Item>
        </Descriptions>}
      </Card>}
      {viewing && record && hasPermission('production.work_order.view') && <CoreReadinessPanel workOrderId={record.id} />}
      {viewing && record && <CoreTaskGenerationModal open={generationOpen} workOrderId={record.id} workOrderQuantity={record.plannedQuantity} onClose={() => setGenerationOpen(false)} onSuccess={refreshRecord} />}
      {viewing && record && <MoldingTaskGenerationModal open={moldingGenerationOpen} workOrderId={record.id} onClose={() => setMoldingGenerationOpen(false)} onSuccess={async (taskId) => { await refreshRecord(); if (canViewMolding) navigate(`/dashboard/production/molding-tasks/${taskId}`) }} />}
    </>
  )
}
