import { CheckCircleOutlined, RollbackOutlined, WarningOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { SubPageHeader } from '../../components/SubPageHeader'
import { ApiRequestError } from '../../services/api'
import {
  checkPouring,
  fetchPouringDefects,
  fetchPouringOptions,
  fetchPouringReports,
  holdColors,
  holdLabels,
  reportPouring,
  reversePouringReport,
  type PouringDefectOption,
  type PouringOptions,
  type PouringReport,
} from '../../utils/pouring'
import { hasPermission } from '../../utils/roles'

function requestId() { return globalThis.crypto?.randomUUID?.() || `pouring-${Date.now()}-${Math.random().toString(36).slice(2)}` }

export function PouringTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [options, setOptions] = useState<PouringOptions | null>(null)
  const [reports, setReports] = useState<PouringReport[]>([])
  const [defects, setDefects] = useState<PouringDefectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reverseReport, setReverseReport] = useState<PouringReport | null>(null)
  const [form] = Form.useForm()
  const [reverseForm] = Form.useForm()
  const scrapQty = Number(Form.useWatch('scrapQty', form) || 0)

  const refresh = async () => {
    setLoading(true)
    try {
      const [nextOptions, nextReports] = await Promise.all([fetchPouringOptions(id), fetchPouringReports(id)])
      setOptions(nextOptions); setReports(nextReports)
    } catch (error) { message.error(error instanceof Error ? error.message : '浇注任务加载失败') }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void refresh()) }, [id])

  const openReport = async () => {
    if (!options) return
    try {
      setDefects(await fetchPouringDefects(id))
      form.resetFields()
      form.setFieldsValue({ goodQty: options.remainingQuantity, scrapQty: 0, defects: [] })
      setReportOpen(true)
    } catch (error) { message.error(error instanceof Error ? error.message : '报工选项加载失败') }
  }

  const submitReport = async () => {
    if (!options) return
    try {
      const values = await form.validateFields()
      const defectsValue = (values.defects || []) as Array<{ defectCode: string; quantity: number; remark?: string }>
      if (defectsValue.reduce((sum, row) => sum + Number(row.quantity || 0), 0) !== Number(values.scrapQty || 0)) throw new Error('缺陷数量合计必须等于浇注废品箱数')
      setLoading(true)
      const input = { moldingTaskId: id, heatOrderTransferId: values.heatOrderTransferId, stationEquipmentCode: values.stationEquipmentCode, goodQty: Number(values.goodQty), scrapQty: Number(values.scrapQty), actualWeightKg: values.actualWeightKg === undefined ? undefined : Number(values.actualWeightKg) }
      const checked = await checkPouring(input)
      if (values.actualWeightKg === undefined) form.setFieldValue('actualWeightKg', checked.actualWeightKg)
      if (checked.warningCodes.length) {
        const warnings = [
          ...(checked.warningCodes.includes('CRITICAL_HOLD') ? [`合型已停留 ${checked.holdMinutes} 分钟，存在吸潮风险`] : []),
          ...(checked.warningCodes.includes('TRANSFER_OVERDRAW') ? [`铁水将超用 ${checked.overdrawWeightKg} kg，提交后包次余额为 ${checked.transferBalanceAfterKg} kg`] : []),
        ]
        await new Promise<void>((resolve, reject) => Modal.confirm({ title: '确认浇注警告', icon: <WarningOutlined />, content: warnings.join('；'), okText: '确认提交', cancelText: '取消', onOk: () => resolve(), onCancel: () => reject(new Error('已取消提交')) }))
      }
      await reportPouring({ ...input, actualWeightKg: checked.actualWeightKg, requestId: requestId(), transferVersionNo: checked.transferVersionNo, confirmedWarningCodes: checked.warningCodes, defects: defectsValue, remark: values.remark })
      message.success('浇注报工已提交')
      setReportOpen(false)
      await refresh()
    } catch (error) {
      if (error instanceof Error && error.message === '已取消提交') return
      if (error instanceof ApiRequestError && error.status === 409) { message.warning('数据已被其他终端更新，请刷新后重新提交'); await refresh() }
      else message.error(error instanceof Error ? error.message : '浇注报工失败')
    } finally { setLoading(false) }
  }

  const submitReverse = async () => {
    if (!reverseReport) return
    try {
      const values = await reverseForm.validateFields()
      setLoading(true)
      await reversePouringReport(reverseReport.id, reverseReport.transferVersionNo, values.reason)
      message.success('浇注报工已撤销')
      setReverseReport(null)
      await refresh()
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) { message.warning('数据已被其他终端更新，请刷新后重试'); setReverseReport(null); await refresh() }
      else message.error(error instanceof Error ? error.message : '撤销失败')
    } finally { setLoading(false) }
  }

  if (!options) return <Card loading={loading}>浇注任务不存在</Card>
  const holdLevel = options.holdMinutes > 120 ? 'CRITICAL' : options.holdMinutes >= 90 ? 'WARNING' : 'NORMAL'
  return <>
    <SubPageHeader title="合型浇注详情" description="按包次绑定铁水、砂型批次和浇注结果，所有数量保留批次追溯。" onBack={() => {
      const next = new URLSearchParams(searchParams)
      const fromWorkOrderId = next.get('fromWorkOrderId')
      const fromPage = next.get('fromPage')
      const fromPageSize = next.get('fromPageSize')
      next.delete('fromWorkOrderId')
      next.delete('fromPage')
      next.delete('fromPageSize')
      if (fromWorkOrderId) next.set('workOrderId', fromWorkOrderId)
      if (next.get('fromStatus') === 'ALL') next.delete('fromStatus')
      else if (next.get('fromStatus')) { next.set('status', next.get('fromStatus')!); next.delete('fromStatus') }
      if (next.get('fromKeyword')) { next.set('keyword', next.get('fromKeyword')!); next.delete('fromKeyword') }
      if (fromPage) next.set('page', fromPage)
      if (fromPageSize) next.set('pageSize', fromPageSize)
      navigate(`/dashboard/production/pouring-tasks${next.size ? `?${next}` : ''}`)
    }} extra={options.remainingQuantity > 0 && hasPermission('production.pouring.report') ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void openReport()}>浇注报工</Button> : undefined} />
    <Card title="待浇任务信息">
      <Descriptions bordered size="small" column={4}>
        <Descriptions.Item label="造型派工单">{options.moldingTaskCode}</Descriptions.Item><Descriptions.Item label="生产工单">{options.workOrderCode}</Descriptions.Item>
        <Descriptions.Item label="材质牌号">{options.materialGradeName}（{options.materialGradeCode}）</Descriptions.Item><Descriptions.Item label="待浇数量">{options.remainingQuantity} 箱</Descriptions.Item>
        <Descriptions.Item label="产品" span={2}>{options.productName}（{options.productCode}）</Descriptions.Item>
        <Descriptions.Item label="最早合型时间">{options.earliestClosingTime ? new Date(options.earliestClosingTime).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="合型停留"><Tag color={holdColors[holdLevel]}>{options.holdMinutes} 分钟 · {holdLabels[holdLevel]}</Tag></Descriptions.Item>
      </Descriptions>
    </Card>
    <Card title="浇注报工记录" className="production-section-card"><Table rowKey="id" size="small" dataSource={reports} pagination={false} columns={[
      { title: '报工单号', dataIndex: 'code', width: 175 }, { title: '炉次/包次', key: 'heat', width: 210, render: (_, row) => `${row.heatOrderCodeSnapshot} / ${row.transferDeviceNameSnapshot}` },
      { title: '浇注工位', dataIndex: 'stationEquipmentNameSnapshot', width: 140 }, { title: '合格/废品', key: 'qty', width: 110, render: (_, row) => `${row.goodQty} / ${row.scrapQty} 箱` },
      { title: '理论/实际重量', key: 'weight', width: 150, render: (_, row) => `${row.theoreticalWeightKg} / ${row.actualWeightKg} kg` },
      { title: '包次余额', dataIndex: 'transferBalanceAfterKg', width: 110, render: (value: number) => <span style={{ color: value < 0 ? '#ff4d4f' : undefined }}>{value} kg</span> },
      { title: '停留', key: 'hold', width: 130, render: (_, row) => <Tag color={holdColors[row.holdLevelSnapshot]}>{row.holdMinutesSnapshot} 分钟</Tag> },
      { title: '报工人/时间', key: 'operator', width: 190, render: (_, row) => `${row.operatorNameSnapshot} · ${new Date(row.reportedAt).toLocaleString()}` },
      { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value === 'ACTIVE' ? '有效' : '已撤销'}</Tag> },
      { title: '操作', fixed: 'right' as const, width: 90, render: (_, row) => row.status === 'ACTIVE' && hasPermission('production.pouring.reverse') ? <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => { reverseForm.resetFields(); setReverseReport(row) }}>撤销</Button> : '-' },
    ]} locale={{ emptyText: '暂无浇注报工记录' }} /></Card>
    <Modal open={reportOpen} title="浇注报工" okText="检查并提交" cancelText="取消" confirmLoading={loading} onOk={() => void submitReport()} onCancel={() => setReportOpen(false)} width={760} destroyOnHidden>
      <Form form={form} layout="vertical"><div className="production-form-grid">
        <Form.Item name="heatOrderTransferId" label="铁水包次" rules={[{ required: true, message: '请选择铁水包次' }]}><Select showSearch optionFilterProp="label" options={options.transfers.map((item) => ({ value: item.id, label: `${item.heatOrderCode} · ${item.transferDeviceName} · 余额 ${item.balanceKg} kg` }))} /></Form.Item>
        <Form.Item name="stationEquipmentCode" label="浇注工位" rules={[{ required: true, message: '请选择浇注工位' }]}><Select options={options.stations.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item>
        <Form.Item name="goodQty" label="本次浇注箱数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="scrapQty" label="浇注废品箱数" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="actualWeightKg" label="实际浇注重量（kg）" tooltip="留空时按箱数、型腔数和单件浇注毛重自动计算"><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item>
      </div>{scrapQty > 0 && <Form.List name="defects">{(fields, { add, remove }) => <><Space style={{ marginBottom: 8 }}><strong>浇注缺陷</strong><Button size="small" onClick={() => add()}>添加</Button></Space>{fields.map((field) => <Space key={field.key} align="baseline" style={{ display: 'flex' }}><Form.Item {...field} name={[field.name, 'defectCode']} rules={[{ required: true }]}><Select style={{ width: 220 }} placeholder="缺陷" options={defects.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item><Form.Item {...field} name={[field.name, 'quantity']} rules={[{ required: true }]}><InputNumber min={1} precision={0} placeholder="数量" /></Form.Item><Form.Item {...field} name={[field.name, 'remark']}><Input placeholder="备注" /></Form.Item><Button type="link" danger onClick={() => remove(field.name)}>删除</Button></Space>)}</>}</Form.List>}<Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item></Form>
    </Modal>
    <Modal open={Boolean(reverseReport)} title="撤销浇注报工" okText="确认撤销" cancelText="取消" confirmLoading={loading} onOk={() => void submitReverse()} onCancel={() => setReverseReport(null)} destroyOnHidden><Form form={reverseForm} layout="vertical"><Form.Item name="reason" label="撤销原因" rules={[{ required: true }]}><Input.TextArea rows={3} maxLength={300} /></Form.Item></Form></Modal>
  </>
}
