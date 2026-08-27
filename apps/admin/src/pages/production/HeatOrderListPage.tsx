import { CloseCircleOutlined, EyeOutlined, FireOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons'
import { Button, Card, Input, Modal, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { cancelHeatOrder, fetchHeatOrders, heatStatusColors, heatStatusLabels, type HeatOrderRecord, type HeatOrderStatus } from '../../utils/production'
import { hasPermission } from '../../utils/roles'
import { openHeatComplete, openHeatStart, openHeatTransfer } from './HeatExecutionActions'

const statusOptions: Array<{ label: string; value?: HeatOrderStatus }> = [
  { label: '全部' }, { label: '待生产', value: 'WAITING' }, { label: '熔炼中', value: 'IN_PROGRESS' }, { label: '转运中', value: 'TRANSFERRING' }, { label: '已完成', value: 'COMPLETED' }, { label: '已撤销', value: 'CANCELED' },
]

const readPageParam = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function HeatOrderListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStateKey = searchParams.toString()
  const workOrderId = searchParams.get('workOrderId') || undefined
  const urlStatus = (searchParams.get('status') as HeatOrderStatus) || undefined
  const urlPage = readPageParam(searchParams.get('page'), 1)
  const urlPageSize = readPageParam(searchParams.get('pageSize'), 10)
  const [records, setRecords] = useState<HeatOrderRecord[]>([])
  const [status, setStatus] = useState<HeatOrderStatus | undefined>(urlStatus)
  const [page, setPage] = useState(urlPage)
  const [pageSize, setPageSize] = useState(urlPageSize)
  const [loading, setLoading] = useState(false)
  const canStart = hasPermission('production.heat.start')
  const canTransfer = hasPermission('production.heat.transfer')
  const canComplete = hasPermission('production.heat.complete')
  const canCancel = hasPermission('production.schedule.cancel')

  const refresh = async (nextStatus = status) => {
    setLoading(true)
    try { setRecords(await fetchHeatOrders(nextStatus, workOrderId)) } catch (error) { message.error(error instanceof Error ? error.message : '熔炼任务加载失败') } finally { setLoading(false) }
  }
  const updateQuery = (nextStatus = status, nextPage = page, nextPageSize = pageSize) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (nextStatus) next.set('status', nextStatus)
    else next.delete('status')
    if (nextPage === 1) next.delete('page')
    else next.set('page', String(nextPage))
    if (nextPageSize === 10) next.delete('pageSize')
    else next.set('pageSize', String(nextPageSize))
    return next
  }, { replace: true })
  const clearWorkOrderFilter = () => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    next.delete('workOrderId')
    return next
  }, { replace: true })
  const detailQuery = () => {
    const next = new URLSearchParams(searchParams)
    if (workOrderId) {
      next.delete('workOrderId')
      next.set('fromWorkOrderId', workOrderId)
    }
    const currentPage = next.get('page')
    const currentPageSize = next.get('pageSize')
    if (currentPage) { next.delete('page'); next.set('fromPage', currentPage) }
    if (currentPageSize) { next.delete('pageSize'); next.set('fromPageSize', currentPageSize) }
    return next.toString()
  }
  useEffect(() => {
    setStatus(urlStatus)
    setPage(urlPage)
    setPageSize(urlPageSize)
    queueMicrotask(() => void refresh(urlStatus))
    // URL is the source of truth, including browser back/forward navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateKey])

  const runCancel = (record: HeatOrderRecord) => {
    let reason = ''
    Modal.confirm({
      title: '撤销熔炼任务', content: <Input.TextArea rows={3} placeholder="请输入撤销原因" onChange={(event) => { reason = event.target.value }} />, okText: '撤销', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { if (!reason.trim()) throw new Error('请输入撤销原因'); await cancelHeatOrder(record.id, record.versionNo, reason); message.success('炉次已撤销，分配数量已返回排产池'); await refresh() },
    })
  }

  const reportActionError = (action: Promise<void>) => void action.catch((error) => message.error(error instanceof Error ? error.message : '操作失败'))

  const columns: TableColumnsType<HeatOrderRecord> = [
    { title: '炉次编号', dataIndex: 'code', key: 'code', width: 175 },
    { title: '材质牌号', dataIndex: 'materialGradeName', key: 'materialGradeName', width: 145 },
    { title: '目标吨位', dataIndex: 'targetWeightKg', key: 'targetWeightKg', width: 115, render: (value: number) => `${(value / 1000).toFixed(2)} t` },
    { title: '熔炼设备', dataIndex: 'furnaceName', key: 'furnaceName', width: 155 },
    { title: '实际熔炉', dataIndex: 'actualFurnaceName', key: 'actualFurnaceName', width: 155, render: (value: string) => value || '-' },
    { title: '配方编号', dataIndex: 'recipeCode', key: 'recipeCode', width: 165 },
    { title: '执行班组', dataIndex: 'teamName', key: 'teamName', width: 125 },
    { title: '计划开始', dataIndex: 'plannedStartAt', key: 'plannedStartAt', width: 175, render: (value: string) => value ? new Date(value).toLocaleString() : '-' },
    { title: '预计完成', dataIndex: 'plannedFinishAt', key: 'plannedFinishAt', width: 175, render: (value: string, record) => new Date(value || record.plannedOutputAt).toLocaleString() },
    { title: '占用时长', dataIndex: 'occupancyDurationMinutes', key: 'occupancyDurationMinutes', width: 110, render: (value: number | null) => value === null ? '-' : `${value} 分钟` },
    { title: '排程冲突', dataIndex: 'hasScheduleConflict', key: 'hasScheduleConflict', width: 100, render: (value: boolean) => value ? <Tag color="error">已确认</Tag> : '-' },
    { title: '实际出炉', dataIndex: 'actualOutputWeightKg', key: 'actualOutputWeightKg', width: 120, render: (value: number | null) => value === null ? '-' : `${value} kg` },
    { title: '转运累计', dataIndex: 'transferTotalWeightKg', key: 'transferTotalWeightKg', width: 120, render: (value: number) => value ? `${value} kg` : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: HeatOrderStatus) => <Tag color={heatStatusColors[value]}>{heatStatusLabels[value]}</Tag> },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 210,
      render: (_, record) => <TableActions actions={[
        { key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => navigate(`/dashboard/production/heat-orders/${record.id}${detailQuery() ? `?${detailQuery()}` : ''}`) },
        ...(record.canStart && canStart ? [{ key: 'start', label: '开始', icon: <FireOutlined />, onClick: () => reportActionError(openHeatStart(record, refresh)) }] : []),
        ...(record.canTransfer && canTransfer ? [{ key: 'transfer', label: '转运', icon: <SwapOutlined />, onClick: () => reportActionError(openHeatTransfer(record, refresh)) }] : []),
        ...(record.canComplete && canComplete ? [{ key: 'complete', label: '完成', icon: <FireOutlined />, onClick: () => reportActionError(openHeatComplete(record, refresh)) }] : []),
        ...(record.status === 'WAITING' && canCancel ? [{ key: 'cancel', label: '撤销', icon: <CloseCircleOutlined />, danger: true, onClick: () => runCancel(record) }] : []),
      ]} />,
    },
  ]

  return <>
    <div className="page-header">
      <div><h1 className="page-title">熔炼执行</h1><p className="page-description">监控已下发炉次，查看班组执行和实际出炉结果。</p></div>
      <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => updateQuery(status, 1, pageSize)}>查询</Button>
    </div>
    <Card>
      <div className="production-query-row">
        {workOrderId && <Tag closable onClose={clearWorkOrderFilter}>当前生产工单</Tag>}
        <div className="production-status-filters">
          {statusOptions.map((item) => <Button key={item.value || 'ALL'} type={status === item.value ? 'primary' : 'default'} onClick={() => { setStatus(item.value); updateQuery(item.value, 1, pageSize) }}>{item.label}</Button>)}
        </div>
      </div>
      <ResizableTable storageKey="production-heat-order-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ current: page, pageSize, total: records.length, showSizeChanger: true, onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); updateQuery(status, nextPage, nextPageSize) } }} />
    </Card>
  </>
}
