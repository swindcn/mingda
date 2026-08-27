import { ArrowLeftOutlined, CalendarOutlined, CloseCircleOutlined, FireOutlined, SwapOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Input, Modal, Space, Table, Tag, Timeline, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { cancelHeatOrder, fetchHeatOrder, heatStatusColors, heatStatusLabels, type HeatOrderRecord } from '../../utils/production'
import { hasPermission } from '../../utils/roles'
import { openHeatComplete, openHeatStart, openHeatTransfer } from './HeatExecutionActions'
import { openHeatScheduleAdjustment } from './HeatScheduleAdjustment'

const actionLabels: Record<string, string> = { CREATED: '任务下发', SCHEDULE_ADJUSTED: '调整排程', STARTED: '开始生产', TRANSFERRED: '转运出炉', COMPLETED: '完成生产', CANCELED: '撤销任务' }

export function HeatOrderDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [record, setRecord] = useState<HeatOrderRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const canStart = hasPermission('production.heat.start')
  const canTransfer = hasPermission('production.heat.transfer')
  const canComplete = hasPermission('production.heat.complete')
  const canCancel = hasPermission('production.schedule.cancel')
  const canAdjustSchedule = hasPermission('production.schedule.adjust')

  const refresh = async () => { setLoading(true); try { setRecord(await fetchHeatOrder(id)) } catch (error) { message.error(error instanceof Error ? error.message : '炉次详情加载失败') } finally { setLoading(false) } }
  useEffect(() => { void refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id])
  useEffect(() => {
    const refreshOnFocus = () => { void refresh() }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const runCancel = () => {
    if (!record) return
    let reason = ''
    Modal.confirm({ title: '撤销熔炼任务', content: <Input.TextArea rows={3} placeholder="请输入撤销原因" onChange={(event) => { reason = event.target.value }} />, okButtonProps: { danger: true }, onOk: async () => { if (!reason.trim()) throw new Error('请输入撤销原因'); await cancelHeatOrder(record.id, record.versionNo, reason); message.success('炉次已撤销'); await refresh() } })
  }
  const reportActionError = (action: Promise<void>) => void action.catch((error) => message.error(error instanceof Error ? error.message : '操作失败'))

  if (!record) return <Card loading={loading} />
  return <>
    <div className="page-header">
      <div><h1 className="page-title">熔炼任务详情</h1><p className="page-description">{record.code} · {record.materialGradeName}</p></div>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => {
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
          navigate(`/dashboard/production/heat-orders${next.size ? `?${next}` : ''}`)
        }}>返回</Button>
        {record.status === 'WAITING' && canAdjustSchedule && <Button type="primary" icon={<CalendarOutlined />} onClick={() => reportActionError(openHeatScheduleAdjustment(record, refresh))}>调整排程</Button>}
        {record.canStart && canStart && <Button type="primary" icon={<FireOutlined />} onClick={() => reportActionError(openHeatStart(record, refresh))}>开始生产</Button>}
        {record.canTransfer && canTransfer && <Button type="primary" icon={<SwapOutlined />} onClick={() => reportActionError(openHeatTransfer(record, refresh))}>转运出炉</Button>}
        {record.canComplete && canComplete && <Button type="primary" icon={<FireOutlined />} onClick={() => reportActionError(openHeatComplete(record, refresh))}>完成生产</Button>}
        {record.status === 'WAITING' && canCancel && <Button danger icon={<CloseCircleOutlined />} onClick={runCancel}>撤销</Button>}
      </Space>
    </div>
    <Card title="炉次基本信息" loading={loading}>
      <Descriptions bordered column={4} size="small">
        <Descriptions.Item label="炉次编号">{record.code}</Descriptions.Item>
        <Descriptions.Item label="状态"><Tag color={heatStatusColors[record.status]}>{heatStatusLabels[record.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="材质牌号">{record.materialGradeName}（{record.materialGradeCode}）</Descriptions.Item>
        <Descriptions.Item label="目标重量">{record.targetWeightKg} kg</Descriptions.Item>
        <Descriptions.Item label="设备">{record.furnaceName}</Descriptions.Item>
        <Descriptions.Item label="实际熔炉">{record.actualFurnaceName || '-'}</Descriptions.Item>
        <Descriptions.Item label="设备容量">{record.furnaceCapacityKg} kg</Descriptions.Item>
        <Descriptions.Item label="熔炼车间">{record.workshopName || '-'}</Descriptions.Item>
        <Descriptions.Item label="配方">{record.recipeName} / {record.recipeVersion}</Descriptions.Item>
        <Descriptions.Item label="执行班组">{record.teamName}</Descriptions.Item>
        <Descriptions.Item label="计划开始">{record.plannedStartAt ? new Date(record.plannedStartAt).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="自动预计完成">{record.calculatedFinishAt ? new Date(record.calculatedFinishAt).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="最终预计完成">{new Date(record.plannedFinishAt || record.plannedOutputAt).toLocaleString()}{record.finishTimeAdjusted ? '（人工调整）' : ''}</Descriptions.Item>
        <Descriptions.Item label="标准占用时长">{record.occupancyDurationMinutes === null ? '-' : `${record.occupancyDurationMinutes} 分钟`}</Descriptions.Item>
        <Descriptions.Item label="排程冲突">{record.hasScheduleConflict ? <Tag color="error">已确认冲突下达</Tag> : '无'}</Descriptions.Item>
        <Descriptions.Item label="时长构成">{record.meltingDurationMinutes === null ? '-' : `熔炼 ${record.meltingDurationMinutes} / 转运 ${record.transferDurationMinutes} / 清炉 ${record.cleaningDurationMinutes} 分钟`}</Descriptions.Item>
        <Descriptions.Item label="开始时间">{record.startedAt ? new Date(record.startedAt).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="完成时间">{record.completedAt ? new Date(record.completedAt).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="实际出炉">{record.actualOutputWeightKg === null ? '-' : `${record.actualOutputWeightKg} kg`}</Descriptions.Item>
        <Descriptions.Item label="转运累计">{record.transferTotalWeightKg ? `${record.transferTotalWeightKg} kg` : '-'}</Descriptions.Item>
      </Descriptions>
    </Card>
    <Card title="转运记录" className="production-section-card">
      <Table rowKey="id" size="small" pagination={false} dataSource={record.transfers} locale={{ emptyText: '暂无转运记录' }} columns={[
        { title: '转运设备', dataIndex: 'transferDeviceName', render: (value: string, row) => `${value}（${row.transferDeviceCode}）` },
        { title: '设备类型', dataIndex: 'equipmentType', width: 110 },
        { title: '转运重量', dataIndex: 'weightKg', width: 130, render: (value: number) => `${value} kg` },
        { title: '操作人', dataIndex: 'operatorName', width: 120 },
        { title: '操作时间', dataIndex: 'createdAt', width: 190, render: (value: string) => new Date(value).toLocaleString() },
        { title: '备注', dataIndex: 'remark' },
      ]} />
    </Card>
    <Card title="工单分配" className="production-section-card">
      <Table rowKey="id" size="small" pagination={false} dataSource={record.allocations} columns={[
        { title: '生产工单', dataIndex: 'workOrderCode' }, { title: '产品编码', dataIndex: 'productCode' }, { title: '产品名称', dataIndex: 'productName' },
        { title: '分配件数', dataIndex: 'allocatedQuantity', render: (value: number) => `${value} 件` }, { title: '计划铁水', dataIndex: 'plannedWeightKg', render: (value: number) => `${value} kg` },
        { title: '实际分摊', dataIndex: 'actualWeightKg', render: (value: number | null) => value === null ? '-' : `${value} kg` },
      ]} />
    </Card>
    <div className="heat-detail-grid production-section-card">
      <Card title="标准配料提示">
        <Table rowKey="itemCode" size="small" pagination={false} dataSource={record.recipeItems} columns={[
          { title: '物料编码', dataIndex: 'itemCode' }, { title: '物料名称', dataIndex: 'itemName' },
          { title: '比例', dataIndex: 'ratio', render: (value: number | null) => value === null ? '-' : `${value}%` },
          { title: '标准用量', dataIndex: 'quantity', render: (value: number | null, row) => value === null ? '-' : `${value} ${row.unit}` },
        ]} />
      </Card>
      <Card title="执行记录">
        <Timeline items={record.records.map((item) => ({ children: <div><Typography.Text strong>{actionLabels[item.action] || item.action}</Typography.Text><div>{item.operatorName} · {new Date(item.createdAt).toLocaleString()}</div>{item.remark && <Typography.Text type="secondary">{item.remark}</Typography.Text>}</div> }))} />
      </Card>
    </div>
  </>
}
