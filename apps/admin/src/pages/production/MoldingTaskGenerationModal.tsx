import { Alert, DatePicker, Descriptions, Form, Input, Modal, Select, Table, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { ApiRequestError } from '../../services/api'
import { createMoldingTask, previewMoldingTask, type MoldingTaskPreview } from '../../utils/molding'

interface FormValues {
  routingNodeId?: string
  moldCode: string
  productionLineCode: string
  teamCode?: string
  plannedStartAt?: dayjs.Dayjs
  remark?: string
}

export function MoldingTaskGenerationModal({
  open, workOrderId, onClose, onSuccess,
}: {
  open: boolean
  workOrderId: string
  onClose: () => void
  onSuccess: (taskId: string) => Promise<void> | void
}) {
  const [form] = Form.useForm<FormValues>()
  const [preview, setPreview] = useState<MoldingTaskPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const selectedLine = Form.useWatch('productionLineCode', form)

  const load = async (selection: { moldCode?: string; routingNodeId?: string } = {}) => {
    setLoading(true)
    try {
      const result = await previewMoldingTask(workOrderId, selection)
      setPreview(result)
      form.setFieldsValue({
        routingNodeId: result.selectedRoutingNodeId,
        moldCode: result.selectedMoldCode || undefined,
      })
      return result
    } catch (error) {
      message.error(error instanceof Error ? error.message : '造型任务预览加载失败')
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    form.resetFields()
    queueMicrotask(() => {
      setPreview(null)
      void load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workOrderId])

  const refreshSelection = async (patch: { moldCode?: string; routingNodeId?: string }) => {
    const current = form.getFieldsValue()
    await load({ moldCode: patch.moldCode ?? current.moldCode, routingNodeId: patch.routingNodeId ?? current.routingNodeId })
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      const task = await createMoldingTask(workOrderId, {
        moldCode: values.moldCode,
        routingNodeId: values.routingNodeId,
        productionLineCode: values.productionLineCode,
        teamCode: values.teamCode,
        plannedStartAt: values.plannedStartAt?.toISOString(),
        remark: values.remark,
      })
      message.success('造型下芯任务已生成')
      await onSuccess(task.id)
      onClose()
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) message.warning('该工单已生成造型任务，请刷新后查看')
      else if (error instanceof Error) message.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const line = preview?.productionLines.find((item) => item.code === selectedLine)
  const teams = (preview?.teams || []).filter((item) => item.workshopCode === line?.workshopCode)

  return <Modal open={open} title={`生成造型下芯任务${preview ? ` · ${preview.workOrderCode}` : ''}`} width={920} okText="生成任务" cancelText="取消" confirmLoading={loading} onOk={() => void submit()} onCancel={onClose} destroyOnHidden>
    {preview?.existingTask && <Alert type="warning" showIcon message={`当前工序已生成任务 ${preview.existingTask.code}`} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical">
      <div className="production-form-grid">
        <Form.Item name="routingNodeId" label="造型工序" rules={[{ required: true, message: '请选择造型工序' }]}>
          <Select options={(preview?.routingNodes || []).map((item) => ({ value: item.id, label: `${item.seqNo}. ${item.operationName}` }))} onChange={(routingNodeId) => void refreshSelection({ routingNodeId })} />
        </Form.Item>
        <Form.Item name="moldCode" label="生产模具" rules={[{ required: true, message: '请选择生产模具' }]}>
          <Select showSearch optionFilterProp="label" options={(preview?.molds || []).map((item) => ({ value: item.code, label: `${item.name}（${item.code}，${item.cavityCount} 穴）` }))} onChange={(moldCode) => void refreshSelection({ moldCode })} />
        </Form.Item>
        <Form.Item name="productionLineCode" label="生产线" rules={[{ required: true, message: '请选择生产线' }]}>
          <Select showSearch optionFilterProp="label" options={(preview?.productionLines || []).map((item) => ({ value: item.code, label: `${item.name}（${item.workshopName}）` }))} onChange={() => form.setFieldValue('teamCode', undefined)} />
        </Form.Item>
        <Form.Item name="teamCode" label="执行班组" rules={[{ required: true, message: '请选择执行班组' }]}>
          <Select disabled={!selectedLine} showSearch optionFilterProp="label" options={teams.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} />
        </Form.Item>
        <Form.Item name="plannedStartAt" label="计划开始时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
      </div>
      <Form.Item name="remark" label="备注"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
    </Form>
    {preview && <Descriptions bordered size="small" column={4} style={{ marginBottom: 16 }}>
      <Descriptions.Item label="计划件数">{preview.planPieceQty} 件</Descriptions.Item>
      <Descriptions.Item label="模具型腔">{preview.cavityCount || '-'} 穴</Descriptions.Item>
      <Descriptions.Item label="计划箱数">{preview.planBoxQty ?? '-'} 箱</Descriptions.Item>
      <Descriptions.Item label="砂芯种类">{preview.coreRequirements.length} 种</Descriptions.Item>
    </Descriptions>}
    <Table rowKey="coreBoxCode" size="small" pagination={false} dataSource={preview?.coreRequirements || []} columns={[
      { title: '芯盒编码', dataIndex: 'coreBoxCode', width: 160 },
      { title: '砂芯/芯盒', dataIndex: 'coreBoxName' },
      { title: '单件芯件比', dataIndex: 'quantityPerProduct', width: 110 },
      { title: '每箱需求', dataIndex: 'quantityPerBox', width: 100, render: (value: number) => `${value} 个` },
      { title: '任务总需求', dataIndex: 'requiredQuantity', width: 120, render: (value: number) => `${value} 个` },
    ]} locale={{ emptyText: '当前模具无需砂芯' }} />
  </Modal>
}
