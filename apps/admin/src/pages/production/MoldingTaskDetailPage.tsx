import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, PlayCircleOutlined, RollbackOutlined } from '@ant-design/icons'
import { Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Timeline, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ApiRequestError } from '../../services/api'
import { SubPageHeader } from '../../components/SubPageHeader'
import {
  cancelMoldingTask,
  dispatchMoldingTask,
  fetchMoldingDefects,
  fetchMoldingTask,
  moldingStatusColors,
  moldingStatusLabels,
  previewMoldingTask,
  reportMoldingTask,
  reverseMoldingReport,
  startMoldingTask,
  type MoldingDefectOption,
  type MoldingTask,
  type MoldingTaskPreview,
} from '../../utils/molding'
import { hasPermission } from '../../utils/roles'

type ActionMode = 'dispatch' | 'report' | 'cancel' | 'reverse' | null

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `molding-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function MoldingTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [task, setTask] = useState<MoldingTask | null>(null)
  const [preview, setPreview] = useState<MoldingTaskPreview | null>(null)
  const [defects, setDefects] = useState<MoldingDefectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<ActionMode>(null)
  const [reverseReportId, setReverseReportId] = useState('')
  const [form] = Form.useForm()
  const selectedLine = Form.useWatch('productionLineCode', form)
  const finishTask = Form.useWatch('finishTask', form)
  const reportGoodQty = Number(Form.useWatch('goodQty', form) || 0)

  const refresh = async () => {
    setLoading(true)
    try { setTask(await fetchMoldingTask(id)) }
    catch (error) { message.error(error instanceof Error ? error.message : '任务详情加载失败') }
    finally { setLoading(false) }
  }

  // Reload only when the routed task identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void refresh()) }, [id])

  const openAction = async (nextMode: Exclude<ActionMode, null>, reportId = '') => {
    if (!task) return
    form.resetFields()
    setMode(nextMode)
    setReverseReportId(reportId)
    if (nextMode === 'dispatch') {
      const result = await previewMoldingTask(task.workOrderId, { moldCode: task.moldCode, routingNodeId: task.routingNodeId })
      setPreview(result)
      form.setFieldsValue({ productionLineCode: task.productionLineCode, teamCode: task.teamCode || undefined, plannedStartAt: task.plannedStartAt ? dayjs(task.plannedStartAt) : undefined })
    }
    if (nextMode === 'report') {
      const result = await fetchMoldingDefects(task.id)
      setDefects(result)
      const remaining = Math.max(0, task.planBoxQty - task.completedGoodQty)
      form.setFieldsValue({ goodQty: remaining, scrapQty: 0, finishTask: remaining > 0, defects: [] })
    }
  }

  const handleConflict = async (error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 409) {
      message.warning('数据已被其他终端更新，已刷新当前页面')
      setMode(null)
      await refresh()
      return true
    }
    return false
  }

  const start = () => {
    if (!task) return
    Modal.confirm({
      title: '确认开始生产', content: `确定开始 ${task.code} 吗？`, okText: '开始生产', cancelText: '取消',
      onOk: async () => {
        try { setTask(await startMoldingTask(task.id, task.versionNo)); message.success('任务已开始') }
        catch (error) { if (!(await handleConflict(error))) message.error(error instanceof Error ? error.message : '开工失败') }
      },
    })
  }

  const submitAction = async () => {
    if (!task || !mode) return
    try {
      const values = await form.validateFields()
      setLoading(true)
      let result: MoldingTask
      if (mode === 'dispatch') {
        result = await dispatchMoldingTask(task.id, { versionNo: task.versionNo, productionLineCode: values.productionLineCode, teamCode: values.teamCode, plannedStartAt: values.plannedStartAt?.toISOString() })
      } else if (mode === 'report') {
        const defectRows = (values.defects || []).map((item: { defectCode: string; quantity: number; remark?: string }) => item)
        const scrapQty = Number(values.scrapQty || 0)
        if (defectRows.reduce((sum: number, item: { quantity: number }) => sum + Number(item.quantity || 0), 0) !== scrapQty) throw new Error('缺陷数量合计必须等于本次废品箱数')
        const nextGood = task.completedGoodQty + Number(values.goodQty || 0)
        if (nextGood > task.planBoxQty) {
          await new Promise<void>((resolve, reject) => Modal.confirm({ title: '确认超产报工', content: `提交后将超出计划 ${nextGood - task.planBoxQty} 箱，是否继续？`, onOk: () => resolve(), onCancel: () => reject(new Error('已取消提交')) }))
        }
        result = await reportMoldingTask(task.id, { versionNo: task.versionNo, requestId: requestId(), goodQty: Number(values.goodQty), scrapQty, finishTask: Boolean(values.finishTask), earlyCompletionReason: values.earlyCompletionReason, defects: defectRows, remark: values.remark })
      } else if (mode === 'reverse') {
        result = await reverseMoldingReport(reverseReportId, { versionNo: task.versionNo, reason: values.reason })
      } else {
        result = await cancelMoldingTask(task.id, { versionNo: task.versionNo, reason: values.reason })
      }
      setTask(result)
      setMode(null)
      message.success(mode === 'report' ? '报工已提交' : mode === 'reverse' ? '报工已撤销' : mode === 'cancel' ? '任务已取消' : '派工已更新')
    } catch (error) {
      if (error instanceof Error && error.message === '已取消提交') return
      if (!(await handleConflict(error))) message.error(error instanceof Error ? error.message : '操作失败')
    } finally { setLoading(false) }
  }

  const selectedWorkshop = preview?.productionLines.find((item) => item.code === selectedLine)?.workshopCode
  const teamOptions = (preview?.teams || []).filter((item) => item.workshopCode === selectedWorkshop)
  const needsEarlyReason = Boolean(task && finishTask && task.completedGoodQty + reportGoodQty < task.planBoxQty)
  const timeline = useMemo(() => (task?.reports || []).map((report) => ({
    color: report.status === 'REVERSED' ? 'gray' : 'blue',
    children: <div><strong>{report.reportCode}</strong> · 合格 {report.goodQty} 箱 / 废品 {report.scrapQty} 箱<br /><span>{report.operatorName} · {new Date(report.reportedAt).toLocaleString()}</span>{report.status === 'REVERSED' && <><br /><Tag>已撤销</Tag>{report.reverseReason}</>}</div>,
  })), [task])

  if (!task) return <Card loading={loading}>任务不存在</Card>

  return <>
    <SubPageHeader title="造型下芯任务详情" description="查看派工快照、砂芯齐套、报工和库存倒冲记录。" onBack={() => {
      const next = new URLSearchParams(searchParams)
      const fromWorkOrderId = next.get('fromWorkOrderId')
      const fromPage = next.get('fromPage')
      const fromPageSize = next.get('fromPageSize')
      next.delete('fromWorkOrderId')
      next.delete('fromPage')
      next.delete('fromPageSize')
      if (fromWorkOrderId) next.set('workOrderId', fromWorkOrderId)
      if (next.get('fromStatus')) {
        next.set('status', next.get('fromStatus')!)
        next.delete('fromStatus')
      }
      if (fromPage) next.set('page', fromPage)
      if (fromPageSize) next.set('pageSize', fromPageSize)
      navigate(`/dashboard/production/molding-tasks${next.size ? `?${next}` : ''}`)
    }} extra={<Space>
      {task.allowedActions.dispatch && hasPermission('production.molding.dispatch') && <Button icon={<EditOutlined />} onClick={() => void openAction('dispatch')}>{task.status === 'DISPATCHED' ? '调整派工' : '派工'}</Button>}
      {task.allowedActions.start && hasPermission('production.molding.start') && <Button type="primary" icon={<PlayCircleOutlined />} onClick={start}>开始</Button>}
      {task.allowedActions.report && hasPermission('production.molding.report') && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void openAction('report')}>报工</Button>}
      {task.allowedActions.cancel && hasPermission('production.molding.cancel') && <Button danger icon={<CloseCircleOutlined />} onClick={() => void openAction('cancel')}>取消</Button>}
    </Space>} />
    <Card title="任务信息">
      <Descriptions bordered size="small" column={4}>
        <Descriptions.Item label="任务编号">{task.code}</Descriptions.Item><Descriptions.Item label="生产工单">{task.workOrderCode}</Descriptions.Item>
        <Descriptions.Item label="状态"><Tag color={moldingStatusColors[task.displayStatus]}>{moldingStatusLabels[task.displayStatus]}</Tag></Descriptions.Item><Descriptions.Item label="进度"><Progress size="small" percent={Math.min(100, Number(((task.completedGoodQty / Math.max(1, task.planBoxQty)) * 100).toFixed(1)))} /></Descriptions.Item>
        <Descriptions.Item label="产品" span={2}>{task.productName}（{task.productCode}）</Descriptions.Item><Descriptions.Item label="模具" span={2}>{task.moldName}（{task.moldCode}，{task.cavityCount} 穴）</Descriptions.Item>
        <Descriptions.Item label="生产线">{task.productionLineName}</Descriptions.Item><Descriptions.Item label="班组">{task.teamName || '-'}</Descriptions.Item><Descriptions.Item label="计划箱数">{task.planBoxQty}</Descriptions.Item><Descriptions.Item label="合格/废品">{task.completedGoodQty} / {task.completedScrapQty}</Descriptions.Item>
      </Descriptions>
    </Card>
    <Card title="下芯配方与齐套" className="production-section-card"><Table rowKey="coreBoxCode" size="small" pagination={false} dataSource={task.readiness.requirements.length ? task.readiness.requirements : task.coreRequirements} columns={[
      { title: '芯盒编码', dataIndex: 'coreBoxCode' }, { title: '砂芯/芯盒', dataIndex: 'coreBoxName' }, { title: '每箱需求', dataIndex: 'quantityPerBox' }, { title: '剩余需求', key: 'remainingRequiredQuantity', render: (_, row) => row.remainingRequiredQuantity ?? row.requiredQuantity },
      { title: '可用库存', dataIndex: 'available', render: (value?: number) => value ?? '-' }, { title: '缺口', dataIndex: 'shortage', render: (value?: number) => value ? <Tag color="red">{value}</Tag> : 0 },
    ]} locale={{ emptyText: '当前任务无需砂芯' }} /></Card>
    <Card title="报工记录" className="production-section-card"><Timeline items={timeline.length ? timeline : [{ color: 'gray', children: '暂无报工记录' }]} />
      <Table rowKey="id" size="small" pagination={false} dataSource={task.reports || []} columns={[
        { title: '报工单号', dataIndex: 'reportCode' }, { title: '合格', dataIndex: 'goodQty', width: 80 }, { title: '废品', dataIndex: 'scrapQty', width: 80 }, { title: '报工人', dataIndex: 'operatorName', width: 100 }, { title: '报工时间', dataIndex: 'reportedAt', render: (value: string) => new Date(value).toLocaleString() },
        { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value === 'ACTIVE' ? '有效' : '已撤销'}</Tag> },
        { title: '操作', width: 90, render: (_, report) => report.status === 'ACTIVE' && task.allowedActions.reverse && hasPermission('production.molding.reverse') ? <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => void openAction('reverse', report.id)}>撤销</Button> : '-' },
      ]} />
    </Card>
    <Modal open={mode !== null} title={mode === 'dispatch' ? '调整派工' : mode === 'report' ? '完工报工' : mode === 'reverse' ? '撤销报工' : '取消任务'} okText="确认" cancelText="取消" confirmLoading={loading} onOk={() => void submitAction()} onCancel={() => setMode(null)} destroyOnHidden>
      <Form form={form} layout="vertical">
        {mode === 'dispatch' && <><Form.Item name="productionLineCode" label="生产线" rules={[{ required: true }]}><Select options={(preview?.productionLines || []).map((item) => ({ value: item.code, label: `${item.name}（${item.workshopName}）` }))} onChange={() => form.setFieldValue('teamCode', undefined)} /></Form.Item><Form.Item name="teamCode" label="执行班组" rules={[{ required: true }]}><Select options={teamOptions.map((item) => ({ value: item.code, label: item.name }))} /></Form.Item><Form.Item name="plannedStartAt" label="计划开始时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item></>}
        {mode === 'report' && <><div className="production-form-grid"><Form.Item name="goodQty" label="本次合格箱数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="scrapQty" label="本次废品箱数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></div><Form.Item name="finishTask" label="完工状态"><Select options={[{ value: false, label: '继续生产' }, { value: true, label: '本任务已结束' }]} /></Form.Item>{needsEarlyReason && <Form.Item name="earlyCompletionReason" label="提前结束原因" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>}<Form.List name="defects">{(fields, { add, remove }) => <>{fields.map((field) => <Space key={field.key} align="baseline" style={{ display: 'flex' }}><Form.Item {...field} name={[field.name, 'defectCode']} rules={[{ required: true }]}><Select style={{ width: 190 }} placeholder="缺陷代码" options={defects.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item><Form.Item {...field} name={[field.name, 'quantity']} rules={[{ required: true }]}><InputNumber min={1} precision={0} placeholder="数量" /></Form.Item><Form.Item {...field} name={[field.name, 'remark']}><Input placeholder="备注" /></Form.Item><Button type="link" danger onClick={() => remove(field.name)}>删除</Button></Space>)}<Button type="dashed" block onClick={() => add()}>添加缺陷</Button></>}</Form.List><Form.Item name="remark" label="报工备注"><Input.TextArea rows={2} /></Form.Item></>}
        {(mode === 'cancel' || mode === 'reverse') && <Form.Item name="reason" label={mode === 'reverse' ? '撤销原因' : '取消原因'} rules={[{ required: true }]}><Input.TextArea rows={3} maxLength={300} /></Form.Item>}
      </Form>
    </Modal>
  </>
}
