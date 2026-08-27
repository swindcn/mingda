import { CheckCircleOutlined, RollbackOutlined, ToolOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Form, Image, Input, InputNumber, Modal, Select, Space, Tabs, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ImageUploadField } from '../../components/ImageUploadField'
import { ResizableTable } from '../../components/ResizableTable'
import { SubPageHeader } from '../../components/SubPageHeader'
import { TableActions } from '../../components/TableActions'
import { ApiRequestError } from '../../services/api'
import { fetchInspectionDefects, fetchInspectionTask, fetchReworkTask, reportInspection, reportRework, reverseInspection, type DefectOption, type InspectionReport, type InspectionTaskDetail, type ReworkTask } from '../../utils/finalInspection'
import { hasPermission } from '../../utils/roles'

const requestId = (prefix: string) => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function FinalInspectionTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [detail, setDetail] = useState<InspectionTaskDetail | null>(null)
  const [defects, setDefects] = useState<DefectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportRequestId, setReportRequestId] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [reverseTarget, setReverseTarget] = useState<InspectionReport | null>(null)
  const [reworkTarget, setReworkTarget] = useState<ReworkTask | null>(null)
  const [reworkRequestId, setReworkRequestId] = useState('')
  const [reportForm] = Form.useForm()
  const [reverseForm] = Form.useForm()
  const [reworkForm] = Form.useForm()
  const scrapQty = Number(Form.useWatch('scrapQty', reportForm) || 0)
  const reworkQty = Number(Form.useWatch('reworkQty', reportForm) || 0)

  const refresh = async () => {
    try {
      setLoading(true)
      const [next, nextDefects] = await Promise.all([fetchInspectionTask(id), fetchInspectionDefects(id)])
      setDetail(next); setDefects(nextDefects)
    } catch (error) { message.error(error instanceof Error ? error.message : '终检详情加载失败') } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() /* Route id is the refresh boundary. */ /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id])

  const openReport = () => {
    if (!detail) return
    setReportRequestId(requestId('inspection')); setImages([])
    reportForm.setFieldsValue({ goodQty: detail.options.remainingQuantity, reworkQty: 0, scrapQty: 0, scrapWeightKg: undefined, defects: [] })
    setReportOpen(true)
  }

  const submitReport = async () => {
    if (!detail) return
    try {
      const values = await reportForm.validateFields()
      const good = Number(values.goodQty || 0); const rework = Number(values.reworkQty || 0); const scrap = Number(values.scrapQty || 0)
      if (good + rework + scrap <= 0 || good + rework + scrap > detail.options.remainingQuantity) throw new Error(`本次总数必须大于 0 且不超过 ${detail.options.remainingQuantity}`)
      const defectTotal = (values.defects || []).reduce((sum: number, row: { quantity?: number }) => sum + Number(row.quantity || 0), 0)
      if (defectTotal > rework + scrap) throw new Error('缺陷数量不能超过返修与报废数量')
      setLoading(true)
      await reportInspection({
        workOrderId: id,
        requestId: reportRequestId,
        goodQty: good,
        reworkQty: rework,
        scrapQty: scrap,
        ...(values.scrapWeightKg === undefined || values.scrapWeightKg === null ? {} : { scrapWeightKg: Number(values.scrapWeightKg) }),
        batchVersions: detail.options.batchVersions.map(({ id: batchId, versionNo }) => ({ id: batchId, versionNo })),
        defects: values.defects || [],
        imageUrl: images[0],
        remark: values.remark,
      })
      message.success('终检结果已提交'); setReportOpen(false); await refresh()
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) { message.warning('数据已被其他终端更新，请刷新后重试'); setReportOpen(false); await refresh() }
      else message.error(error instanceof Error ? error.message : '终检提交失败')
    } finally { setLoading(false) }
  }

  const submitReverse = async () => {
    if (!reverseTarget) return
    try { const values = await reverseForm.validateFields(); setLoading(true); await reverseInspection(reverseTarget.id, reverseTarget.versionNo, values.reason); message.success('终检报告已撤销'); setReverseTarget(null); await refresh() }
    catch (error) { message.error(error instanceof Error ? error.message : '撤销失败') } finally { setLoading(false) }
  }

  const openRework = async (task: ReworkTask) => {
    try { setLoading(true); const loaded = await fetchReworkTask(task.id); setReworkRequestId(requestId('rework')); setReworkTarget(loaded); reworkForm.setFieldsValue({ goodQty: loaded.remainingQuantity, scrapQty: 0, scrapWeightKg: undefined, equipmentCode: loaded.equipment?.[0]?.code }) }
    catch (error) { message.error(error instanceof Error ? error.message : '返修任务加载失败') } finally { setLoading(false) }
  }

  const submitRework = async () => {
    if (!reworkTarget) return
    try {
      const values = await reworkForm.validateFields(); const good = Number(values.goodQty || 0); const scrap = Number(values.scrapQty || 0)
      if (good + scrap <= 0 || good + scrap > reworkTarget.remainingQuantity) throw new Error(`本次总数必须大于 0 且不超过 ${reworkTarget.remainingQuantity}`)
      setLoading(true); await reportRework({
        taskId: reworkTarget.id,
        requestId: reworkRequestId,
        goodQty: good,
        scrapQty: scrap,
        ...(values.scrapWeightKg === undefined || values.scrapWeightKg === null ? {} : { scrapWeightKg: Number(values.scrapWeightKg) }),
        equipmentCode: values.equipmentCode,
        versionNo: reworkTarget.versionNo,
        remark: values.remark,
      })
      message.success('返修报工已提交，合格数量已重新进入待检队列'); setReworkTarget(null); await refresh()
    } catch (error) { if (error instanceof ApiRequestError && error.status === 409) { message.warning('任务已更新，请刷新后重试'); setReworkTarget(null); await refresh() } else message.error(error instanceof Error ? error.message : '返修提交失败') } finally { setLoading(false) }
  }

  if (!detail) return <Card loading={loading}>终检任务不存在</Card>
  const canReport = detail.options.allowedActions.report && hasPermission('production.inspection.report')
  const canReverse = detail.options.allowedActions.reverse && hasPermission('production.inspection.reverse')

  return <>
    <SubPageHeader title="成品终检详情" description="记录合格入库、清理返修和报废回炉，保留从清理批次到库存流水的追溯关系。" onBack={() => {
      const next = new URLSearchParams(searchParams); const status = searchParams.get('fromStatus'); const keyword = searchParams.get('fromKeyword'); const workOrderId = searchParams.get('fromWorkOrderId'); const fromPage = searchParams.get('fromPage'); const fromPageSize = searchParams.get('fromPageSize'); next.delete('fromStatus'); next.delete('fromKeyword'); next.delete('fromWorkOrderId'); next.delete('fromPage'); next.delete('fromPageSize'); if (status && status !== 'ALL') next.set('status', status); if (keyword) next.set('keyword', keyword); if (workOrderId) next.set('workOrderId', workOrderId); if (fromPage) next.set('page', fromPage); if (fromPageSize) next.set('pageSize', fromPageSize); navigate(`/dashboard/production/inspection-tasks${next.size ? `?${next}` : ''}`)
    }} extra={canReport ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={openReport}>终检报工</Button> : undefined} />
    <Card loading={loading}>
      <Tabs items={[
        { key: 'info', label: '任务信息', children: <Descriptions bordered size="small" column={{ xs: 1, sm: 2, xl: 4 }}>
          <Descriptions.Item label="生产工单">{detail.code}</Descriptions.Item><Descriptions.Item label="产品编码">{detail.productCodeSnapshot}</Descriptions.Item><Descriptions.Item label="产品名称">{detail.productNameSnapshot}</Descriptions.Item><Descriptions.Item label="材质">{detail.materialGradeNameSnapshot}</Descriptions.Item>
          <Descriptions.Item label="计划数量">{detail.plannedQuantity} 件</Descriptions.Item><Descriptions.Item label="剩余待检">{detail.options.remainingQuantity} 件</Descriptions.Item><Descriptions.Item label="返修中">{detail.options.openReworkQuantity} 件</Descriptions.Item><Descriptions.Item label="已入库">{detail.completedQuantity} 件</Descriptions.Item>
        </Descriptions> },
        { key: 'reports', label: '终检记录', children: <ResizableTable storageKey="production-inspection-report-widths" rowKey="id" size="small" pagination={false} dataSource={detail.inspectionReports} columns={[
          { title: '质检单号', dataIndex: 'code', width: 170 }, { title: '合格/返修/报废', width: 145, render: (_, row: InspectionReport) => `${row.goodQty} / ${row.reworkQty} / ${row.scrapQty}` },
          { title: '回炉重量', dataIndex: 'scrapWeightKg', width: 105, render: (value: number) => `${value} kg` }, { title: '质检员/时间', width: 210, render: (_, row: InspectionReport) => `${row.operatorNameSnapshot} · ${new Date(row.reportedAt).toLocaleString()}` },
          { title: '缺陷', width: 180, render: (_, row: InspectionReport) => row.defects.length ? row.defects.map((item) => `${item.defectNameSnapshot}×${item.quantity}`).join('，') : '-' },
          { title: '图片', width: 80, render: (_, row: InspectionReport) => row.image?.imageUrl ? <Image width={44} height={44} style={{ objectFit: 'cover' }} src={row.image.imageUrl} /> : '-' },
          { title: '入库单', width: 160, render: (_, row: InspectionReport) => row.blankWarehouseReceipt?.code || '-' }, { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value === 'ACTIVE' ? '有效' : '已撤销'}</Tag> },
          { title: '操作', fixed: 'right' as const, width: 90, render: (_, row: InspectionReport) => <TableActions actions={row.status === 'ACTIVE' && canReverse ? [{ key: 'reverse', label: '撤销', icon: <RollbackOutlined />, onClick: () => { reverseForm.resetFields(); setReverseTarget(row) } }] : []} /> },
        ]} /> },
        { key: 'reworks', label: `返修任务（${detail.cleaningReworkTasks.length}）`, children: <ResizableTable storageKey="production-cleaning-rework-widths" rowKey="id" size="small" pagination={false} dataSource={detail.cleaningReworkTasks} columns={[
          { title: '返修单号', dataIndex: 'code' }, { title: '原始/剩余', render: (_, row: ReworkTask) => `${row.originalQuantity} / ${row.remainingQuantity} 件` }, { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{value}</Tag> },
          { title: '操作', fixed: 'right' as const, width: 100, render: (_, row: ReworkTask) => <TableActions actions={row.allowedActions?.report && hasPermission('production.cleaning_rework.report') ? [{ key: 'report', label: '报工', icon: <ToolOutlined />, onClick: () => void openRework(row) }] : []} /> },
        ]} /> },
      ]} />
    </Card>

    <Modal open={reportOpen} title="成品终检报工" width={780} okText="提交质检结果" cancelText="取消" confirmLoading={loading} onOk={() => void submitReport()} onCancel={() => setReportOpen(false)} destroyOnHidden>
      <Form form={reportForm} layout="vertical">
        <div className="production-form-grid"><Form.Item name="goodQty" label="合格件数" rules={[{ required: true }]}><InputNumber min={0} max={detail.options.remainingQuantity} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="reworkQty" label="返修件数" rules={[{ required: true }]}><InputNumber min={0} max={detail.options.remainingQuantity} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="scrapQty" label="报废件数" rules={[{ required: true }]}><InputNumber min={0} max={detail.options.remainingQuantity} precision={0} style={{ width: '100%' }} /></Form.Item></div>
        <Space style={{ marginBottom: 16 }}><Button onClick={() => reportForm.setFieldsValue({ goodQty: detail.options.remainingQuantity, reworkQty: 0, scrapQty: 0 })}>一键全部合格</Button><Typography.Text type="secondary">当前待检 {detail.options.remainingQuantity} 件</Typography.Text></Space>
        {scrapQty > 0 && <Form.Item name="scrapWeightKg" label="实际回炉重量（kg）"><InputNumber min={0} precision={4} style={{ width: '100%' }} placeholder={`默认 ${Number((scrapQty * detail.options.unitNetWeightKg).toFixed(4))}`} /></Form.Item>}
        {reworkQty + scrapQty > 0 && <Form.List name="defects">{(fields, { add, remove }) => <><Button size="small" onClick={() => add({ quantity: 1 })}>添加缺陷</Button>{fields.map((field) => <Space key={field.key} align="baseline" style={{ display: 'flex', marginTop: 8 }}><Form.Item {...field} name={[field.name, 'defectCode']} rules={[{ required: true }]}><Select style={{ width: 240 }} placeholder="缺陷" options={defects.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item><Form.Item {...field} name={[field.name, 'quantity']} rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item><Button type="link" danger onClick={() => remove(field.name)}>删除</Button></Space>)}</>}</Form.List>}
        <Form.Item label="缺陷图片（最多一张）"><ImageUploadField value={images} onChange={setImages} maxCount={1} /></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
    <Modal open={Boolean(reverseTarget)} title="撤销终检" okText="确认撤销" onOk={() => void submitReverse()} onCancel={() => setReverseTarget(null)} confirmLoading={loading} destroyOnHidden><Form form={reverseForm} layout="vertical"><Form.Item name="reason" label="撤销原因" rules={[{ required: true, message: '请填写撤销原因' }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
    <Modal open={Boolean(reworkTarget)} title="清理返修报工" okText="提交返修结果" onOk={() => void submitRework()} onCancel={() => setReworkTarget(null)} confirmLoading={loading} destroyOnHidden>
      <Form form={reworkForm} layout="vertical"><Form.Item name="equipmentCode" label="清理设备" rules={[{ required: true, message: '请选择设备' }]}><Select options={(reworkTarget?.equipment || []).map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} /></Form.Item><div className="production-form-grid"><Form.Item name="goodQty" label="返修合格数"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item><Form.Item name="scrapQty" label="返修报废数"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></div><Form.Item name="scrapWeightKg" label="回炉重量（kg）"><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item></Form>
    </Modal>
  </>
}
