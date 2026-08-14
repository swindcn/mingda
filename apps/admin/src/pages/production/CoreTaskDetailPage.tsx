/* eslint-disable react-refresh/only-export-components -- list and detail share the same capability-safe action launchers */
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, DatePicker, Descriptions, Empty, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { ApiRequestError } from '../../services/api'
import {
  cancelCoreTask,
  dispatchCoreTask,
  dryCoreBatch,
  fetchCoreInventoryBatch,
  fetchCoreInventoryOptions,
  fetchCoreTask,
  fetchCoreTaskOptions,
  reportCoreTask,
  startCoreTask,
  type CoreBatchRecord,
  type CoreTaskOptions,
  type CoreTaskRecord,
} from '../../utils/coremaking'
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

function DispatchFields({ record, options, onChange }: { record: CoreTaskRecord; options: CoreTaskOptions; onChange: (value: { equipmentCode: string; teamCode: string; plannedStartAt: string; remark: string }) => void }) {
  const [equipmentCode, setEquipmentCode] = useState(record.equipmentCode)
  const [teamCode, setTeamCode] = useState(record.teamCode)
  const [plannedStartAt, setPlannedStartAt] = useState(record.plannedStartAt)
  const [remark, setRemark] = useState(record.remark)
  const equipment = options.equipment.find((item) => item.code === equipmentCode)
  const change = (next: Partial<{ equipmentCode: string; teamCode: string; plannedStartAt: string; remark: string }>) => {
    const value = { equipmentCode, teamCode, plannedStartAt, remark, ...next }
    setEquipmentCode(value.equipmentCode); setTeamCode(value.teamCode); setPlannedStartAt(value.plannedStartAt); setRemark(value.remark); onChange(value)
  }
  return <div className="core-action-form">
    <label>设备</label><Select showSearch optionFilterProp="label" value={equipmentCode || undefined} placeholder="请选择设备" options={options.equipment.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(value) => change({ equipmentCode: value, teamCode: '' })} />
    <label>班组</label><Select showSearch optionFilterProp="label" disabled={!equipment} value={teamCode || undefined} placeholder="请选择班组" options={options.teams.filter((item) => item.workshopCode === equipment?.workshopCode).map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(value) => change({ teamCode: value })} />
    <label>计划时间</label><DatePicker showTime value={plannedStartAt ? dayjs(plannedStartAt) : null} onChange={(value) => change({ plannedStartAt: value?.toISOString() || '' })} />
    <label>备注</label><Input.TextArea rows={2} value={remark} maxLength={200} onChange={(event) => change({ remark: event.target.value })} />
  </div>
}

function ReportFields({ options, onChange }: { options: CoreTaskOptions; onChange: (value: { qualifiedQuantity: number; scrapQuantity: number; shiftCode: string; sandBatchCode: string; dryingRequired: boolean; defectReason: string; remark: string }) => void }) {
  const [value, setValue] = useState({ qualifiedQuantity: 0, scrapQuantity: 0, shiftCode: '', sandBatchCode: '', dryingRequired: true, defectReason: '', remark: '' })
  const change = (next: Partial<typeof value>) => { const merged = { ...value, ...next }; setValue(merged); onChange(merged) }
  return <div className="core-action-form">
    <label>合格数</label><InputNumber min={1} precision={0} value={value.qualifiedQuantity || null} placeholder="请输入合格数" onChange={(next) => change({ qualifiedQuantity: Number(next || 0) })} />
    <label>报废数</label><InputNumber min={0} precision={0} value={value.scrapQuantity} onChange={(next) => change({ scrapQuantity: Number(next || 0) })} />
    <label>班次</label><Select showSearch optionFilterProp="label" value={value.shiftCode || undefined} placeholder="请选择班次" options={options.shifts.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(shiftCode) => change({ shiftCode })} />
    <label>混砂批次</label><Input value={value.sandBatchCode} placeholder="选填" onChange={(event) => change({ sandBatchCode: event.target.value })} />
    <label>是否烘干</label><Switch checked={value.dryingRequired} checkedChildren="需要" unCheckedChildren="无需" onChange={(dryingRequired) => change({ dryingRequired })} />
    <label>缺陷原因</label><Input value={value.defectReason} placeholder="有报废时填写" onChange={(event) => change({ defectReason: event.target.value })} />
    <label>备注</label><Input.TextArea rows={2} value={value.remark} onChange={(event) => change({ remark: event.target.value })} />
  </div>
}

export async function openCoreDispatch(record: CoreTaskRecord, refresh: RefreshAction) {
  const latest = await latestCoreTask(record, 'canDispatch', refresh)
  if (!latest) return
  const options = await fetchCoreTaskOptions(latest.id)
  let values = { equipmentCode: latest.equipmentCode, teamCode: latest.teamCode, plannedStartAt: latest.plannedStartAt, remark: latest.remark }
  Modal.confirm({
    title: '派工', width: 560, okText: '确认派工', cancelText: '取消',
    content: <DispatchFields record={latest} options={options} onChange={(next) => { values = next }} />,
    onOk: async () => {
      if (!values.equipmentCode || !values.teamCode || !values.plannedStartAt) throw new Error('请完整选择设备、班组和计划时间')
      const submitted = await submitWithConflictRefresh(() => dispatchCoreTask(latest.id, { versionNo: latest.versionNo, ...values }).then(() => undefined), refresh)
      if (submitted) { message.success('派工已更新'); await refresh() }
    },
  })
}

export async function openCoreCancel(record: CoreTaskRecord, refresh: RefreshAction) {
  const latest = await latestCoreTask(record, 'canCancel', refresh)
  if (!latest) return
  let reason = ''
  Modal.confirm({ title: '取消制芯任务', content: <Input.TextArea rows={3} placeholder="请输入取消理由" onChange={(event) => { reason = event.target.value }} />, okText: '确认取消', cancelText: '返回', okButtonProps: { danger: true }, onOk: async () => { if (!reason.trim()) throw new Error('请输入取消理由'); const submitted = await submitWithConflictRefresh(() => cancelCoreTask(latest.id, { versionNo: latest.versionNo, reason }).then(() => undefined), refresh); if (submitted) { message.success('任务已取消'); await refresh() } } })
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
  let values = { qualifiedQuantity: 0, scrapQuantity: 0, shiftCode: '', sandBatchCode: '', dryingRequired: true, defectReason: '', remark: '' }
  Modal.confirm({
    title: '制芯报工', width: 560, okText: '提交报工', cancelText: '取消',
    content: <ReportFields options={options} onChange={(next) => { values = next }} />,
    onOk: async () => {
      if (values.qualifiedQuantity < 1) throw new Error('合格数必须大于 0')
      if (!values.shiftCode) throw new Error('请选择班次')
      if (values.scrapQuantity > 0 && !values.defectReason.trim()) throw new Error('存在报废数量时请填写缺陷原因')
      const submitted = await submitWithConflictRefresh(() => reportCoreTask(latest.id, { versionNo: latest.versionNo, ...values }).then(() => undefined), refresh)
      if (submitted) { message.success('报工已提交并生成砂芯批次'); await refresh() }
    },
  })
}

export function CoreTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [record, setRecord] = useState<CoreTaskRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [labelBatch, setLabelBatch] = useState<CoreBatchRecord | null>(null)
  const canDispatch = hasPermission('production.core_task.dispatch')
  const canCancel = hasPermission('production.core_task.cancel')
  const canStart = hasPermission('production.core_task.start')
  const canReport = hasPermission('production.core_task.report')
  const canDry = hasPermission('production.core_inventory.dry')
  const canViewInventory = hasPermission('production.core_inventory.view')

  const refresh = async () => {
    setLoading(true); setError('')
    try { setRecord(await fetchCoreTask(id)) } catch (reason) { setError(reason instanceof Error ? reason.message : '制芯任务详情加载失败') } finally { setLoading(false) }
  }
  // Refresh when route identity changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [id])

  const showLabel = async (batchId: string) => {
    try { setLabelBatch(await fetchCoreInventoryBatch(batchId)) } catch (reason) { message.error(reason instanceof Error ? reason.message : '批次标签加载失败') }
  }
  const dryBatch = async (batch: NonNullable<NonNullable<CoreTaskRecord['reports']>[number]['batch']>) => {
    const latest = await fetchCoreInventoryBatch(batch.id)
    const options = await fetchCoreInventoryOptions()
    let equipmentCode = ''
    Modal.confirm({ title: '确认烘干', content: <Select showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="请选择烘干设备" options={options.dryingEquipment.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(value) => { equipmentCode = value }} />, okText: '确认烘干', cancelText: '取消', onOk: async () => { if (!equipmentCode) throw new Error('请选择烘干设备'); const submitted = await submitWithConflictRefresh(() => dryCoreBatch(latest.id, { versionNo: latest.versionNo, equipmentCode }).then(() => undefined), refresh); if (submitted) { message.success('批次已确认烘干'); await refresh() } } })
  }
  const run = (action: Promise<void>) => void action.catch((reason) => message.error(reason instanceof Error ? reason.message : '操作失败'))

  if (!record) return <Card loading={loading}>{error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}</Card>
  return <>
    <SubPageHeader title="制芯任务详情" description={`${record.code} · ${record.productName}`} onBack={() => navigate('/dashboard/production/core-tasks')} extra={<Space>
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
