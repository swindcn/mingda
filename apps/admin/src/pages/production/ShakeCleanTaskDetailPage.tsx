import { CheckCircleOutlined, ClearOutlined, RollbackOutlined, WarningOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd'
import type { FormInstance } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { ApiRequestError } from '../../services/api'
import { createLatestRequestGate } from '../../utils/latestRequest'
import { hasPermission } from '../../utils/roles'
import {
  checkShake,
  fetchShakeCleanDefects,
  fetchShakeCleanOptions,
  fetchShakeCleanReports,
  fetchShakeCleanTrace,
  normalizeShakeCleanDefects,
  reportCleaning,
  reportShake,
  reverseCleaningReport,
  reverseShakeReport,
  shakeCleanStatusColors,
  shakeCleanStatusLabels,
  type CleaningReport,
  type ShakeCleanDefectOption,
  type ShakeCleanOptions,
  type ShakeCleanReports,
  type ShakeCleanTrace,
  type ShakeReport,
} from '../../utils/shakeClean'

type Phase = 'SHAKE' | 'CLEANING'
type ReportToReverse = { phase: Phase; report: ShakeReport | CleaningReport }

function newRequestId(phase: Phase) {
  return globalThis.crypto?.randomUUID?.() || `${phase.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function QuantityControl({ form, name, maximum }: { form: FormInstance; name: string; maximum: number }) {
  const adjust = (step: number) => {
    const current = Number(form.getFieldValue(name) || 0)
    form.setFieldValue(name, Math.max(0, Math.min(maximum, current + step)))
  }
  return <Space.Compact block>
    <Button onClick={() => adjust(-10)}>-10</Button>
    <Button onClick={() => adjust(-1)}>-1</Button>
    <Form.Item name={name} noStyle rules={[{ required: true, message: '请输入数量' }]}><InputNumber min={0} max={maximum} precision={0} style={{ width: '100%' }} /></Form.Item>
    <Button onClick={() => adjust(1)}>+1</Button>
    <Button onClick={() => adjust(10)}>+10</Button>
    <Button type="primary" ghost onClick={() => form.setFieldValue(name, maximum)}>一键拉满</Button>
  </Space.Compact>
}

function DefectFields({ defects, scrapQty }: { defects: ShakeCleanDefectOption[]; scrapQty: number }) {
  if (scrapQty <= 0) return null
  return <Form.List name="defects">{(fields, { add, remove }) => <>
    <Space style={{ marginBottom: 8 }}><Typography.Text strong>缺陷明细</Typography.Text><Button size="small" onClick={() => add({ quantity: 1 })}>添加缺陷</Button></Space>
    {fields.map((field) => <Space key={field.key} align="baseline" wrap style={{ display: 'flex', flexWrap: 'wrap', width: '100%' }}>
      <Form.Item {...field} name={[field.name, 'defectCode']} rules={[{ required: true, message: '请选择缺陷' }]}><Select showSearch optionFilterProp="label" style={{ width: 240 }} placeholder="缺陷" options={defects.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item>
      <Form.Item {...field} name={[field.name, 'quantity']} rules={[{ required: true, message: '请输入数量' }]}><InputNumber min={1} precision={0} placeholder="数量" /></Form.Item>
      <Form.Item {...field} name={[field.name, 'remark']}><Input placeholder="备注" /></Form.Item>
      <Button type="link" danger onClick={() => remove(field.name)}>删除</Button>
    </Space>)}
    <Typography.Text type="secondary">缺陷数量合计必须等于废品数量。</Typography.Text>
  </>}</Form.List>
}

export function ShakeCleanTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [options, setOptions] = useState<ShakeCleanOptions | null>(null)
  const [reports, setReports] = useState<ShakeCleanReports>({ shakeReports: [], cleaningReports: [] })
  const [trace, setTrace] = useState<ShakeCleanTrace>({ shakeBatches: [], cleaningBatches: [], blankOutputBatches: [] })
  const [defects, setDefects] = useState<ShakeCleanDefectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [phaseRequestId, setPhaseRequestId] = useState('')
  const [reverseTarget, setReverseTarget] = useState<ReportToReverse | null>(null)
  const [form] = Form.useForm()
  const [reverseForm] = Form.useForm()
  const scrapQty = Number(Form.useWatch('scrapQty', form) || 0)
  const [requestGate] = useState(() => createLatestRequestGate())

  useEffect(() => {
    if (scrapQty <= 0 && (form.getFieldValue('defects') || []).length > 0) form.setFieldValue('defects', [])
  }, [form, scrapQty])

  const refresh = async () => {
    setLoading(true)
    let loadedOptions: ShakeCleanOptions | null = null
    await requestGate.run(() => Promise.all([
      fetchShakeCleanOptions(id), fetchShakeCleanReports(id), fetchShakeCleanTrace(id), fetchShakeCleanDefects(id),
    ]), {
      success: ([nextOptions, nextReports, nextTrace, nextDefects]) => {
        loadedOptions = nextOptions
        setOptions(nextOptions)
        setReports(nextReports)
        setTrace(nextTrace)
        setDefects(nextDefects)
      },
      error: (error) => message.error(error instanceof Error ? error.message : '落砂清理任务加载失败'),
      settled: () => setLoading(false),
    })
    return loadedOptions
  }

  useEffect(() => {
    requestGate.invalidate()
    setOptions(null)
    setReports({ shakeReports: [], cleaningReports: [] })
    setTrace({ shakeBatches: [], cleaningBatches: [], blankOutputBatches: [] })
    setDefects([])
    void refresh()
    return () => requestGate.invalidate()
    // The request intentionally snapshots the current route id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const openReport = async (nextPhase: Phase) => {
    const latest = await refresh() as ShakeCleanOptions | null
    if (!latest) return
    const maximum = nextPhase === 'SHAKE' ? latest.shakeRemaining : latest.cleaningRemaining
    form.resetFields()
    form.setFieldsValue({ goodQty: maximum, scrapQty: 0, riseringScrapWeightKg: 0, defects: [] })
    setPhaseRequestId(newRequestId(nextPhase))
    setPhase(nextPhase)
  }

  const submitReport = async () => {
    if (!options || !phase) return
    try {
      const values = await form.validateFields()
      const defectRows = (values.defects || []) as Array<{ defectCode: string; quantity: number; remark?: string }>
      const goodQty = Number(values.goodQty || 0)
      const scrap = Number(values.scrapQty || 0)
      const submittedDefects = normalizeShakeCleanDefects(scrap, defectRows)
      const defectTotal = submittedDefects.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
      if (defectTotal !== scrap) throw new Error('缺陷数量合计必须等于废品数量')
      const availableQuantity = phase === 'SHAKE' ? options.shakeRemaining : options.cleaningRemaining
      if (goodQty + scrap <= 0) throw new Error('本次报工数量必须大于 0')
      if (goodQty + scrap > availableQuantity) throw new Error(`本次报工总数不能超过待处理数量 ${availableQuantity}`)
      setLoading(true)
      if (phase === 'SHAKE') {
        const checked = await checkShake({ moldingTaskId: id, quantity: goodQty + scrap })
        let confirmedEarlyShake = false
        if (checked.code === 'EARLY_SHAKE') {
          await new Promise<void>((resolve, reject) => Modal.confirm({
            title: '冷却未到期', icon: <WarningOutlined />,
            content: `还需冷却约 ${checked.remainingCoolingMinutes} 分钟。提前落砂可能造成铸件变形或开裂，是否继续？`,
            okText: '确认提前落砂', cancelText: '取消', onOk: () => resolve(), onCancel: () => reject(new Error('已取消提交')),
          }))
          confirmedEarlyShake = true
        }
        await reportShake({
          moldingTaskId: id, requestId: phaseRequestId, stationEquipmentCode: values.stationEquipmentCode,
          goodQty, scrapQty: scrap, confirmedEarlyShake, defects: submittedDefects, remark: values.remark,
          batchVersions: options.shakeBatchVersions.map(({ id: batchId, versionNo }) => ({ id: batchId, versionNo })),
        })
        message.success('落砂报工已提交')
      } else {
        await reportCleaning({
          moldingTaskId: id, requestId: phaseRequestId, stationEquipmentCode: values.stationEquipmentCode,
          goodQty, scrapQty: scrap, riseringScrapWeightKg: Number(values.riseringScrapWeightKg || 0), defects: submittedDefects, remark: values.remark,
          batchVersions: options.cleaningBatchVersions.map(({ id: batchId, versionNo }) => ({ id: batchId, versionNo })),
        })
        message.success('清理报工已提交')
      }
      setPhase(null)
      await refresh()
    } catch (error) {
      if (error instanceof Error && error.message === '已取消提交') return
      if (error instanceof ApiRequestError && error.status === 409) {
        message.warning('数据已被其他终端更新，请刷新后重新提交')
        await refresh()
      } else {
        message.error(error instanceof Error ? error.message : '报工提交失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const submitReverse = async () => {
    if (!reverseTarget) return
    try {
      const values = await reverseForm.validateFields()
      setLoading(true)
      const report = reverseTarget.report
      if (reverseTarget.phase === 'SHAKE') await reverseShakeReport(report.id, report.versionNo, values.reason)
      else await reverseCleaningReport(report.id, report.versionNo, values.reason)
      message.success('报工已撤销')
      setReverseTarget(null)
      await refresh()
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        message.warning('数据已被其他终端更新，请刷新后重试')
        setReverseTarget(null)
        await refresh()
      } else message.error(error instanceof Error ? error.message : '撤销报工失败')
    } finally {
      setLoading(false)
    }
  }

  if (!options) return <Card loading={loading}>落砂清理任务不存在</Card>

  const canShake = options.allowedActions.shakeReport && hasPermission('production.shake_clean.shake_report')
  const canClean = options.allowedActions.cleanReport && hasPermission('production.shake_clean.clean_report')
  const canReverse = options.allowedActions.reverse && hasPermission('production.shake_clean.reverse')
  const totalProgress = options.shakeOriginal + options.cleaningOriginal
  const completedProgress = totalProgress - options.shakeRemaining - options.cleaningRemaining
  const reportMaximum = phase === 'SHAKE' ? options.shakeRemaining : options.cleaningRemaining
  const equipment = phase === 'SHAKE' ? options.shakeEquipment : options.cleaningEquipment
  const blankOutputQuantity = trace.blankOutputBatches.filter((batch) => batch.status !== 'CANCELED').reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)

  const reverseAction = (currentPhase: Phase, report: ShakeReport | CleaningReport) => report.status === 'ACTIVE' && canReverse
    ? <TableActions actions={[{ key: 'reverse', label: '撤销', shortLabel: '撤销', icon: <RollbackOutlined />, onClick: () => { reverseForm.resetFields(); setReverseTarget({ phase: currentPhase, report }) } }]} />
    : '-'

  const tabItems = [
    { key: 'info', label: '任务信息', children: <Descriptions bordered size="small" column={{ xs: 1, sm: 2, xl: 4 }}>
      <Descriptions.Item label="造型派工单">{options.moldingTaskCode}</Descriptions.Item>
      <Descriptions.Item label="生产工单">{options.workOrderCode}</Descriptions.Item>
      <Descriptions.Item label="状态"><Tag color={shakeCleanStatusColors[options.executionStatus]}>{shakeCleanStatusLabels[options.executionStatus]}</Tag></Descriptions.Item>
      <Descriptions.Item label="执行进度"><Progress size="small" percent={totalProgress ? Math.min(100, Number((completedProgress / totalProgress * 100).toFixed(1))) : 0} /></Descriptions.Item>
      <Descriptions.Item label="产品" span={2}>{options.productName}（{options.productCode}）</Descriptions.Item>
      <Descriptions.Item label="浇注件数">{options.shakeOriginal} 件</Descriptions.Item>
      <Descriptions.Item label="合格毛坯">{blankOutputQuantity} 件</Descriptions.Item>
      <Descriptions.Item label="待落砂">{options.shakeRemaining} 件</Descriptions.Item>
      <Descriptions.Item label="待清理">{options.cleaningRemaining} 件</Descriptions.Item>
      <Descriptions.Item label="冷却状态" span={2}>{options.cooling?.earlyShake
        ? <Typography.Text type="danger">冷却未到期，还需约 {options.cooling.remainingCoolingMinutes} 分钟；允许确认风险后落砂。</Typography.Text>
        : <Tag color="green">{options.cooling ? '已达到冷却时长' : '当前无待落砂批次'}</Tag>}</Descriptions.Item>
    </Descriptions> },
    { key: 'shake', label: '落砂记录', children: <ResizableTable storageKey="production-shake-report-widths" rowKey="id" size="small" pagination={false} dataSource={reports.shakeReports} columns={[
      { title: '报工单号', dataIndex: 'code', width: 170 },
      { title: '设备', dataIndex: 'stationEquipmentNameSnapshot', width: 140 },
      { title: '合格/废品', key: 'qty', width: 110, render: (_, report: ShakeReport) => `${report.goodQty} / ${report.scrapQty} 件` },
      { title: '冷却', key: 'cooling', width: 170, render: (_, report: ShakeReport) => <Tag color={report.earlyShake ? 'red' : 'green'}>{report.actualCoolingMinutesSnapshot} / {report.requiredCoolingMinutesSnapshot} 分钟</Tag> },
      { title: '报工人/时间', key: 'operator', width: 210, render: (_, report: ShakeReport) => `${report.operatorNameSnapshot} · ${new Date(report.reportedAt).toLocaleString()}` },
      { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value === 'ACTIVE' ? '有效' : '已撤销'}</Tag> },
      { title: '操作', fixed: 'right' as const, width: 90, render: (_, report: ShakeReport) => reverseAction('SHAKE', report) },
    ]} locale={{ emptyText: '暂无落砂记录' }} /> },
    { key: 'clean', label: '清理记录', children: <ResizableTable storageKey="production-cleaning-report-widths" rowKey="id" size="small" pagination={false} dataSource={reports.cleaningReports} columns={[
      { title: '报工单号', dataIndex: 'code', width: 170 },
      { title: '设备', dataIndex: 'stationEquipmentNameSnapshot', width: 140 },
      { title: '合格/废品', key: 'qty', width: 110, render: (_, report: CleaningReport) => `${report.goodQty} / ${report.scrapQty} 件` },
      { title: '切割浇冒口重量', dataIndex: 'riseringScrapWeightKg', width: 145, render: (value: number) => `${value} kg` },
      { title: '报工人/时间', key: 'operator', width: 210, render: (_, report: CleaningReport) => `${report.operatorNameSnapshot} · ${new Date(report.reportedAt).toLocaleString()}` },
      { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value === 'ACTIVE' ? '有效' : '已撤销'}</Tag> },
      { title: '操作', fixed: 'right' as const, width: 90, render: (_, report: CleaningReport) => reverseAction('CLEANING', report) },
    ]} locale={{ emptyText: '暂无清理记录' }} /> },
    { key: 'trace', label: '批次追溯', children: <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Table rowKey="id" size="small" pagination={false} dataSource={trace.shakeBatches} columns={[
        { title: '待落砂批次', dataIndex: 'id', ellipsis: true }, { title: '原始/剩余', render: (_, row) => `${row.originalQuantity} / ${row.remainingQuantity} 件` },
        { title: '浇注时间', dataIndex: 'pouredAt', render: (value: string) => new Date(value).toLocaleString() }, { title: '状态', dataIndex: 'status' },
      ]} />
      <Table rowKey="id" size="small" pagination={false} dataSource={trace.cleaningBatches} columns={[
        { title: '待清理批次', dataIndex: 'id', ellipsis: true }, { title: '原始/剩余', render: (_, row) => `${row.originalQuantity} / ${row.remainingQuantity} 件` },
        { title: '可清理时间', dataIndex: 'availableAt', render: (value: string) => new Date(value).toLocaleString() }, { title: '状态', dataIndex: 'status' },
      ]} />
      <Table rowKey="id" size="small" pagination={false} dataSource={trace.blankOutputBatches} columns={[
        { title: '毛坯批次', dataIndex: 'code' }, { title: '合格数量', dataIndex: 'quantity', render: (value: number) => `${value} 件` },
        { title: '后续工序', dataIndex: 'nextOperationNameSnapshot', render: (value: string | null) => value || '待入库' }, { title: '状态', dataIndex: 'status' },
      ]} />
    </Space> },
  ]

  return <>
    <SubPageHeader title="落砂清理详情" description="一个工艺节点内分阶段记录落砂和清理打磨，保留浇注至毛坯的完整批次追溯。" onBack={() => {
      const next = new URLSearchParams(searchParams)
      const fromStatus = searchParams.get('fromStatus')
      const fromKeyword = searchParams.get('fromKeyword')
      const fromWorkOrderId = searchParams.get('fromWorkOrderId')
      const fromPage = searchParams.get('fromPage')
      const fromPageSize = searchParams.get('fromPageSize')
      next.delete('fromStatus')
      next.delete('fromKeyword')
      next.delete('fromWorkOrderId')
      next.delete('fromPage')
      next.delete('fromPageSize')
      if (fromStatus && fromStatus !== 'ALL') next.set('status', fromStatus)
      if (fromKeyword) next.set('keyword', fromKeyword)
      if (fromWorkOrderId) next.set('workOrderId', fromWorkOrderId)
      if (fromPage) next.set('page', fromPage)
      if (fromPageSize) next.set('pageSize', fromPageSize)
      navigate(`/dashboard/production/shake-clean-tasks${next.size ? `?${next}` : ''}`)
    }} extra={<Space>
      {canShake && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void openReport('SHAKE')}>落砂报工</Button>}
      {canClean && <Button type="primary" icon={<ClearOutlined />} onClick={() => void openReport('CLEANING')}>清理报工</Button>}
    </Space>} />
    <Card loading={loading}><Tabs items={tabItems} /></Card>

    <Modal open={Boolean(phase)} title={phase === 'SHAKE' ? '落砂报工' : '清理报工'} okText="提交报工" cancelText="取消" confirmLoading={loading} onOk={() => void submitReport()} onCancel={() => setPhase(null)} width={780} destroyOnHidden>
      <Form form={form} layout="vertical">
        <div className="production-form-grid">
          <Form.Item name="stationEquipmentCode" label={phase === 'SHAKE' ? '落砂设备' : '清理设备'} rules={[{ required: true, message: '请选择设备' }]}><Select showSearch optionFilterProp="label" options={equipment.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item>
          {phase === 'CLEANING' && <Form.Item name="riseringScrapWeightKg" label="切割浇冒口重量（kg）"><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item>}
        </div>
        <Form.Item label={phase === 'SHAKE' ? '本次落砂合格数' : '本次清理合格数'}><QuantityControl form={form} name="goodQty" maximum={reportMaximum} /></Form.Item>
        <Form.Item label="本次废品数"><QuantityControl form={form} name="scrapQty" maximum={reportMaximum} /></Form.Item>
        <DefectFields defects={defects} scrapQty={scrapQty} />
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
      </Form>
    </Modal>

    <Modal open={Boolean(reverseTarget)} title="撤销报工" okText="确认撤销" cancelText="取消" confirmLoading={loading} onOk={() => void submitReverse()} onCancel={() => setReverseTarget(null)} destroyOnHidden>
      <Form form={reverseForm} layout="vertical"><Form.Item name="reason" label="撤销原因" rules={[{ required: true, message: '请填写撤销原因' }]}><Input.TextArea rows={3} maxLength={300} /></Form.Item></Form>
    </Modal>
  </>
}
