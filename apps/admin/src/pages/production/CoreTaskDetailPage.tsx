/* eslint-disable react-refresh/only-export-components -- list and detail share the same capability-safe action launchers */
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { FormInstance } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type { RefObject } from 'react'
import { createRef, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { ApiRequestError } from '../../services/api'
import {
  cancelCoreTask,
  dispatchCoreTask,
  dryCoreBatch,
  fetchCoreInventoryBatch,
  fetchCoreTask,
  fetchCoreTaskOptions,
  reportCoreTask,
  startCoreTask,
  type CoreBatchRecord,
  type CoreTaskOptions,
  type CoreTaskRecord,
} from '../../utils/coremaking'
import { createLatestRequestGate } from '../../utils/latestRequest'
import { hasPermission } from '../../utils/roles'
import { CoreBatchLabel } from './CoreBatchLabel'

export const coreTaskStatusLabels = {
  PENDING_DISPATCH: '待派工', WAITING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELED: '已取消',
}
export const coreTaskStatusColors = {
  PENDING_DISPATCH: 'default', WAITING: 'processing', IN_PROGRESS: 'blue', COMPLETED: 'success', CANCELED: 'error',
}

type RefreshAction = () => Promise<void>
type Capability = 'canDispatch' | 'canCancel' | 'canStart' | 'canReport'
type DispatchFormValues = { equipmentCode: string; teamCode: string; plannedStartAt: Dayjs; remark?: string }
type ReportFormValues = { qualifiedQuantity: number; scrapQuantity: number; shiftCode: string; sandBatchCode?: string; dryingRequired: boolean; defectReason?: string; remark?: string }

async function latestCoreTask(record: CoreTaskRecord, capability: Capability, refresh: RefreshAction) {
  const latest = await fetchCoreTask(record.id)
  if (latest[capability]) return latest
  message.warning('任务状态已变化，页面已刷新')
  await refresh()
  return null
}

async function submitWithConflictRefresh(action: () => Promise<void>, refresh: RefreshAction) {
  try {
    await action()
    return true
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      message.warning('数据已被其他用户更新，请刷新后重试；页面已刷新')
      await refresh()
      return false
    }
    message.error(error instanceof Error ? error.message : '操作失败')
    throw error
  }
}

function DispatchFields({ record, options, formRef }: { record: CoreTaskRecord; options: CoreTaskOptions; formRef: RefObject<FormInstance<DispatchFormValues> | null> }) {
  const [equipmentCode, setEquipmentCode] = useState(record.equipmentCode)
  const equipment = options.equipment.find((item) => item.code === equipmentCode)
  return <Form ref={formRef} layout="vertical" initialValues={{ equipmentCode: record.equipmentCode || undefined, teamCode: record.teamCode || undefined, plannedStartAt: record.plannedStartAt ? dayjs(record.plannedStartAt) : undefined, remark: record.remark }}>
    <Form.Item name="equipmentCode" label="设备" rules={[{ required: true, message: '请选择设备' }]}><Select showSearch optionFilterProp="label" placeholder="请选择设备" options={options.equipment.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(value) => { setEquipmentCode(value); formRef.current?.setFieldValue('teamCode', undefined) }} /></Form.Item>
    <Form.Item name="teamCode" label="班组" rules={[{ required: true, message: '请选择班组' }]}><Select showSearch optionFilterProp="label" disabled={!equipment} placeholder="请选择班组" options={options.teams.filter((item) => item.workshopCode === equipment?.workshopCode).map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item>
    <Form.Item name="plannedStartAt" label="计划时间" rules={[{ required: true, message: '请选择计划时间' }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
    <Form.Item name="remark" label="备注"><Input.TextArea rows={2} maxLength={200} /></Form.Item>
  </Form>
}

function ReportFields({ options, formRef }: { options: CoreTaskOptions; formRef: RefObject<FormInstance<ReportFormValues> | null> }) {
  return <Form ref={formRef} layout="vertical" initialValues={{ qualifiedQuantity: 0, scrapQuantity: 0, dryingRequired: true }}>
    <Form.Item name="qualifiedQuantity" label="合格数" rules={[{ required: true, type: 'number', min: 1, message: '合格数必须大于 0' }]}><InputNumber min={1} precision={0} placeholder="请输入合格数" style={{ width: '100%' }} /></Form.Item>
    <Form.Item name="scrapQuantity" label="报废数" rules={[{ required: true, type: 'number', min: 0, message: '报废数不能小于 0' }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
    <Form.Item name="shiftCode" label="班次" rules={[{ required: true, message: '请选择班次' }]}><Select showSearch optionFilterProp="label" placeholder="请选择班次" options={options.shifts.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item>
    <Form.Item name="sandBatchCode" label="混砂批次"><Input placeholder="选填" /></Form.Item>
    <Form.Item name="dryingRequired" label="是否烘干" valuePropName="checked"><Switch checkedChildren="需要" unCheckedChildren="无需" /></Form.Item>
    <Form.Item name="defectReason" label="缺陷原因" dependencies={['scrapQuantity']} rules={[({ getFieldValue }) => ({ validator: (_, value) => getFieldValue('scrapQuantity') > 0 && !String(value || '').trim() ? Promise.reject(new Error('存在报废数量时请填写缺陷原因')) : Promise.resolve() })]}><Input placeholder="有报废时填写" /></Form.Item>
    <Form.Item name="remark" label="备注"><Input.TextArea rows={2} maxLength={200} /></Form.Item>
  </Form>
}

export async function openCoreDispatch(record: CoreTaskRecord, refresh: RefreshAction) {
  const latest = await latestCoreTask(record, 'canDispatch', refresh)
  if (!latest) return
  const options = await fetchCoreTaskOptions(latest.id)
  const formRef = createRef<FormInstance<DispatchFormValues>>()
  Modal.confirm({
    title: '派工', width: 560, okText: '确认派工', cancelText: '取消',
    content: <DispatchFields record={latest} options={options} formRef={formRef} />,
    onOk: async () => {
      const values = await formRef.current!.validateFields()
      const submitted = await submitWithConflictRefresh(() => dispatchCoreTask(latest.id, { versionNo: latest.versionNo, ...values, plannedStartAt: values.plannedStartAt.toISOString() }).then(() => undefined), refresh)
      if (submitted) { message.success('派工已更新'); await refresh() }
    },
  })
}

export async function openCoreCancel(record: CoreTaskRecord, refresh: RefreshAction) {
  const latest = await latestCoreTask(record, 'canCancel', refresh)
  if (!latest) return
  const formRef = createRef<FormInstance<{ reason: string }>>()
  Modal.confirm({ title: '取消制芯任务', content: <Form ref={formRef} layout="vertical"><Form.Item name="reason" label="取消理由" rules={[{ required: true, whitespace: true, message: '请输入取消理由' }]}><Input.TextArea rows={3} maxLength={200} placeholder="请输入取消理由" /></Form.Item></Form>, okText: '确认取消', cancelText: '返回', okButtonProps: { danger: true }, onOk: async () => { const { reason } = await formRef.current!.validateFields(); const submitted = await submitWithConflictRefresh(() => cancelCoreTask(latest.id, { versionNo: latest.versionNo, reason }).then(() => undefined), refresh); if (submitted) { message.success('任务已取消'); await refresh() } } })
}

export async function openCoreStart(record: CoreTaskRecord, refresh: RefreshAction) {
  const latest = await latestCoreTask(record, 'canStart', refresh)
  if (!latest) return
  Modal.confirm({ title: '开始制芯', content: `确认开始任务 ${latest.code}？`, okText: '开始', cancelText: '取消', onOk: async () => { const submitted = await submitWithConflictRefresh(() => startCoreTask(latest.id, { versionNo: latest.versionNo }).then(() => undefined), refresh); if (submitted) { message.success('任务已开始'); await refresh() } } })
}

export async function openCoreReport(record: CoreTaskRecord, refresh: RefreshAction) {
  const latest = await latestCoreTask(record, 'canReport', refresh)
  if (!latest) return
  const options = await fetchCoreTaskOptions(latest.id)
  const formRef = createRef<FormInstance<ReportFormValues>>()
  Modal.confirm({
    title: '制芯报工', width: 560, okText: '提交报工', cancelText: '取消',
    content: <ReportFields options={options} formRef={formRef} />,
    onOk: async () => {
      const values = await formRef.current!.validateFields()
      const submitted = await submitWithConflictRefresh(() => reportCoreTask(latest.id, { versionNo: latest.versionNo, ...values }).then(() => undefined), refresh)
      if (submitted) { message.success('报工已提交并生成砂芯批次'); await refresh() }
    },
  })
}

export function CoreTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [record, setRecord] = useState<CoreTaskRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [labelBatch, setLabelBatch] = useState<CoreBatchRecord | null>(null)
  const [taskRequestGate] = useState(() => createLatestRequestGate())
  const [labelRequestGate] = useState(() => createLatestRequestGate())
  const currentIdRef = useRef(id)
  const canDispatch = hasPermission('production.core_task.dispatch')
  const canCancel = hasPermission('production.core_task.cancel')
  const canStart = hasPermission('production.core_task.start')
  const canReport = hasPermission('production.core_task.report')
  const canDry = hasPermission('production.core_task.dry')
  const canViewInventory = hasPermission('production.core_inventory.view')

  const refresh = async () => {
    const requestedId = id
    if (currentIdRef.current !== requestedId) return
    setLoading(true); setError('')
    await taskRequestGate.run(
      () => fetchCoreTask(requestedId),
      {
        success: (result) => { if (currentIdRef.current === requestedId) setRecord(result) },
        error: (reason) => { if (currentIdRef.current === requestedId) setError(reason instanceof Error ? reason.message : '制芯任务详情加载失败') },
        settled: () => { if (currentIdRef.current === requestedId) setLoading(false) },
      },
    )
  }
  useEffect(() => { currentIdRef.current = id }, [id])

  useEffect(() => {
    // Route identity changes invalidate the displayed record before loading its replacement.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(null)
    void refresh()
    return () => { taskRequestGate.invalidate(); labelRequestGate.invalidate() }
    // Refresh intentionally snapshots the route id for request identity checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const showLabel = async (batchId: string) => {
    await labelRequestGate.run(
      () => fetchCoreInventoryBatch(batchId),
      {
        success: setLabelBatch,
        error: (reason) => message.error(reason instanceof Error ? reason.message : '批次标签加载失败'),
      },
    )
  }
  const dryBatch = async (batch: NonNullable<NonNullable<CoreTaskRecord['reports']>[number]['batch']>) => {
    const taskId = record?.id
    if (!taskId) return
    const options = await fetchCoreTaskOptions(taskId)
    const formRef = createRef<FormInstance<{ equipmentCode: string }>>()
    Modal.confirm({
      title: '确认烘干',
      content: <Form ref={formRef} layout="vertical"><Form.Item name="equipmentCode" label="烘干设备" rules={[{ required: true, message: '请选择烘干设备' }]}><Select showSearch optionFilterProp="label" placeholder="请选择烘干设备" options={options.dryingEquipment.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item></Form>,
      okText: '确认烘干', cancelText: '取消',
      onOk: async () => {
        const { equipmentCode } = await formRef.current!.validateFields()
        const submitted = await submitWithConflictRefresh(() => dryCoreBatch(batch.id, { versionNo: batch.versionNo, equipmentCode }).then(() => undefined), refresh)
        if (submitted) { message.success('批次已确认烘干'); await refresh() }
      },
    })
  }
  const run = (action: Promise<void>) => void action.catch((reason) => message.error(reason instanceof Error ? reason.message : '操作失败'))

  if (!record) return <Card loading={loading}>{error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}</Card>
  return <>
    <SubPageHeader title="制芯任务详情" description={`${record.code} · ${record.productName}`} onBack={() => {
      const next = new URLSearchParams(searchParams)
      const fromWorkOrderId = next.get('fromWorkOrderId')
      const fromPage = next.get('fromPage')
      const fromPageSize = next.get('fromPageSize')
      next.delete('fromWorkOrderId')
      next.delete('fromPage')
      next.delete('fromPageSize')
      if (fromWorkOrderId) next.set('workOrderId', fromWorkOrderId)
      if (fromPage) next.set('page', fromPage)
      if (fromPageSize) next.set('pageSize', fromPageSize)
      navigate(`/dashboard/production/core-tasks${next.size ? `?${next}` : ''}`)
    }} extra={<Space>
      {record.canDispatch && canDispatch && <Button type="primary" icon={<SendOutlined />} onClick={() => run(openCoreDispatch(record, refresh))}>派工</Button>}
      {record.canStart && canStart && <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => run(openCoreStart(record, refresh))}>开始</Button>}
      {record.canReport && canReport && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => run(openCoreReport(record, refresh))}>报工</Button>}
      {record.canCancel && canCancel && <Button danger icon={<CloseCircleOutlined />} onClick={() => run(openCoreCancel(record, refresh))}>取消</Button>}
    </Space>} />
    {error && <Alert className="coremaking-load-error" type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}
    <Card title="基础信息" loading={loading}>
      <Descriptions bordered size="small" column={4}>
        <Descriptions.Item label="任务编号">{record.code}</Descriptions.Item><Descriptions.Item label="状态"><Tag color={coreTaskStatusColors[record.status]}>{coreTaskStatusLabels[record.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="生产工单">{record.workOrderCode}</Descriptions.Item><Descriptions.Item label="产品">{record.productName}（{record.productCode}）</Descriptions.Item>
        <Descriptions.Item label="芯盒">{record.coreBoxName}（{record.coreBoxCode}）</Descriptions.Item><Descriptions.Item label="模具">{record.moldName}（{record.moldCode}）</Descriptions.Item>
        <Descriptions.Item label="工序">{record.operationName}（{record.operationCode}）</Descriptions.Item><Descriptions.Item label="预计废品率">{(record.expectedScrapRate * 100).toFixed(2)}%</Descriptions.Item>
        <Descriptions.Item label="设备">{record.equipmentName || '-'}</Descriptions.Item><Descriptions.Item label="班组">{record.teamName || '-'}</Descriptions.Item>
        <Descriptions.Item label="计划时间">{record.plannedStartAt ? new Date(record.plannedStartAt).toLocaleString() : '-'}</Descriptions.Item><Descriptions.Item label="更新时间">{new Date(record.updatedAt).toLocaleString()}</Descriptions.Item>
      </Descriptions>
    </Card>
    <Card title="计划与累计" className="production-section-card">
      <Descriptions bordered size="small" column={4}><Descriptions.Item label="计划需求">{record.plannedQuantity}</Descriptions.Item><Descriptions.Item label="计划压盒">{record.plannedPressCount}</Descriptions.Item><Descriptions.Item label="累计合格">{record.qualifiedQuantity}</Descriptions.Item><Descriptions.Item label="累计报废">{record.scrapQuantity}</Descriptions.Item></Descriptions>
    </Card>
    <Card title="派工记录" className="production-section-card">
      <Table rowKey="id" size="small" pagination={false} dataSource={record.equipmentCode ? [record] : []} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未派工" /> }} columns={[
        { title: '设备', dataIndex: 'equipmentName', render: (value: string, row) => `${value}（${row.equipmentCode}）` }, { title: '班组', dataIndex: 'teamName', render: (value: string, row) => `${value}（${row.teamCode}）` }, { title: '计划时间', dataIndex: 'plannedStartAt', render: (value: string) => new Date(value).toLocaleString() }, { title: '备注', dataIndex: 'remark', render: (value: string) => value || '-' },
      ]} />
    </Card>
    <Card title="报工记录" className="production-section-card">
      <Table rowKey="id" size="small" pagination={false} dataSource={record.reports || []} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报工记录" /> }} columns={[
        { title: '报工时间', dataIndex: 'reportedAt', width: 180, render: (value: string) => new Date(value).toLocaleString() }, { title: '操作人', dataIndex: 'operatorName', width: 110 }, { title: '班次', dataIndex: 'shiftCode', width: 100 }, { title: '合格数', dataIndex: 'qualifiedQuantity', width: 90 }, { title: '报废数', dataIndex: 'scrapQuantity', width: 90 }, { title: '混砂批次', dataIndex: 'sandBatchCode', width: 130, render: (value: string) => value || '-' }, { title: '烘干', dataIndex: 'dryingRequired', width: 80, render: (value: boolean) => value ? '需要' : '无需' }, { title: '缺陷原因/备注', key: 'remark', render: (_, row) => [row.defectReason, row.remark].filter(Boolean).join('；') || '-' },
        { title: '批次', dataIndex: 'batch', width: 210, render: (batch) => batch ? <Space size={4}><Typography.Text>{batch.code}</Typography.Text>{canViewInventory && <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => void showLabel(batch.id)}>标签</Button>}{batch.status === 'UNDRIED' && canDry && <Button type="link" size="small" onClick={() => run(dryBatch(batch))}>烘干</Button>}</Space> : '-' },
      ]} />
    </Card>
    <CoreBatchLabel batch={labelBatch} open={Boolean(labelBatch)} onClose={() => setLabelBatch(null)} />
  </>
}
