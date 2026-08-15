import { EyeOutlined, SendOutlined, ToolOutlined } from '@ant-design/icons'
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Select, Space, Table, Tag, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { resolveCoreTaskEntry } from '../../utils/coremaking'
import { createWorkOrder, fetchWorkOrder, fetchWorkOrderOptions, fetchWorkOrderPreview, updateWorkOrder, workOrderRecordToPreview, type WorkOrderPayload, type WorkOrderPreview, type WorkOrderRecord } from '../../utils/production'
import { hasPermission } from '../../utils/roles'
import { CoreReadinessPanel } from './CoreReadinessPanel'
import { CoreTaskGenerationModal } from './CoreTaskGenerationModal'

type FormValues = Omit<WorkOrderPayload, 'plannedStartDate' | 'plannedDeliveryDate'> & { plannedStartDate?: dayjs.Dayjs; plannedDeliveryDate: dayjs.Dayjs }

export function WorkOrderWorkbenchPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [form] = Form.useForm<FormValues>()
  const [options, setOptions] = useState<Array<{ code: string; name: string }>>([])
  const [preview, setPreview] = useState<WorkOrderPreview | null>(null)
  const [record, setRecord] = useState<WorkOrderRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [generationOpen, setGenerationOpen] = useState(false)
  const viewing = Boolean(id && !location.pathname.endsWith('/edit'))
  const canCreateCoreTask = hasPermission('production.core_task.create')
  const canViewCoreTask = hasPermission('production.core_task.view')
  const canSave = hasPermission(id ? 'production.work_order.edit' : 'production.work_order.create')

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
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工单信息刷新失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <SubPageHeader
        title={viewing ? '生产工单详情' : id ? '编辑生产工单' : '新建生产工单'}
        description="工单提交后立即进入待合炉排产池，产生有效炉次分配后关键字段将锁定。"
        onBack={() => navigate('/dashboard/production/work-orders')}
        extra={<Space>
          {viewing && (record?.coreTaskCount || 0) > 0 && canViewCoreTask && <Button icon={<EyeOutlined />} onClick={() => navigate(`/dashboard/production/core-tasks?workOrderId=${record?.id}`)}>制芯任务</Button>}
          {viewing && coreTaskEntry === 'GENERATE' && <Button type="primary" icon={<ToolOutlined />} onClick={() => setGenerationOpen(true)}>生成制芯任务</Button>}
          {!viewing && canSave && <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void save()}>提交排产</Button>}
        </Space>}
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
      <Card title="绑定工艺路线预览" className="production-section-card">
        <Table rowKey="id" size="small" pagination={false} dataSource={preview?.routingNodes || []} columns={[
          { title: '顺序', dataIndex: 'seqNo', width: 80 },
          { title: '工序编码', dataIndex: 'operationCode', width: 150 },
          { title: '工序名称', dataIndex: 'operationName' },
          { title: '默认设备', dataIndex: 'equipment', render: (items: Array<{ name: string }>) => items.map((item) => item.name).join('、') || '-' },
          { title: '标准节拍', dataIndex: 'standardCycleSeconds', width: 120, render: (value?: number) => value ? `${value} 秒` : '-' },
        ]} />
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
    </>
  )
}
