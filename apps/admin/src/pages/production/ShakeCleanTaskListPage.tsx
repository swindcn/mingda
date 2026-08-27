import { EyeOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Input, Progress, Space, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { createLatestRequestGate } from '../../utils/latestRequest'
import {
  fetchShakeCleanTasks,
  shakeCleanStatusColors,
  shakeCleanStatusLabels,
  type ShakeCleanExecutionStatus,
  type ShakeCleanTask,
} from '../../utils/shakeClean'
import { hasPermission } from '../../utils/roles'

const statusTabs: Array<{ key: ShakeCleanExecutionStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'WAITING_SHAKE', label: '待落砂' },
  { key: 'SHAKING', label: '落砂中' },
  { key: 'WAITING_CLEANING', label: '待清理' },
  { key: 'CLEANING', label: '清理中' },
  { key: 'WAITING_POURING', label: '等待后续浇注' },
  { key: 'COMPLETED', label: '已完成' },
]

const readPageParam = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function progress(task: ShakeCleanTask) {
  const total = task.shakeOriginal + task.cleaningOriginal
  const completed = total - task.shakeRemaining - task.cleaningRemaining
  return total > 0 ? Math.min(100, Number((completed / total * 100).toFixed(1))) : 0
}

function coolingCell(task: ShakeCleanTask) {
  if (!task.cooling) return <Tag>无待落砂</Tag>
  return <Space size={4} wrap>
    <Tag color={task.cooling.earlyShake ? 'red' : 'green'}>{task.cooling.earlyShake ? `未到期 ${task.cooling.remainingCoolingMinutes} 分钟` : '可落砂'}</Tag>
    <span>{task.earliestPouredAt ? new Date(task.earliestPouredAt).toLocaleString() : '-'}</span>
  </Space>
}

export function ShakeCleanTaskListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStateKey = searchParams.toString()
  const workOrderId = searchParams.get('workOrderId') || undefined
  const urlKeyword = searchParams.get('keyword') || ''
  const urlStatus = (searchParams.get('status') as ShakeCleanExecutionStatus) || 'ALL'
  const urlPage = readPageParam(searchParams.get('page'), 1)
  const urlPageSize = readPageParam(searchParams.get('pageSize'), 20)
  const [keyword, setKeyword] = useState(urlKeyword)
  const [status, setStatus] = useState<ShakeCleanExecutionStatus | 'ALL'>(urlStatus)
  const [page, setPage] = useState(urlPage)
  const [pageSize, setPageSize] = useState(urlPageSize)
  const [total, setTotal] = useState(0)
  const [records, setRecords] = useState<ShakeCleanTask[]>([])
  const [loading, setLoading] = useState(false)
  const [requestGate] = useState(() => createLatestRequestGate())

  const refresh = async (nextPage = page, nextPageSize = pageSize, nextStatus = status, nextKeyword = keyword.trim()) => {
    setLoading(true)
    await requestGate.run(() => fetchShakeCleanTasks({ page: nextPage, pageSize: nextPageSize, status: nextStatus, keyword: nextKeyword, workOrderId }), {
      success: (result) => {
        setRecords(result.records)
        setTotal(result.total)
      },
      error: (error) => message.error(error instanceof Error ? error.message : '落砂清理任务加载失败'),
      settled: () => setLoading(false),
    })
  }
  const updateQuery = (nextKeyword = keyword.trim(), nextStatus = status, nextPage = page, nextPageSize = pageSize) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (nextKeyword) next.set('keyword', nextKeyword)
    else next.delete('keyword')
    if (nextStatus === 'ALL') next.delete('status')
    else next.set('status', nextStatus)
    if (nextPage === 1) next.delete('page')
    else next.set('page', String(nextPage))
    if (nextPageSize === 20) next.delete('pageSize')
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
    const currentStatus = searchParams.get('status')
    const currentKeyword = searchParams.get('keyword')
    if (currentStatus) next.set('fromStatus', currentStatus)
    if (currentKeyword) next.set('fromKeyword', currentKeyword)
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
    setKeyword(urlKeyword)
    setStatus(urlStatus)
    setPage(urlPage)
    setPageSize(urlPageSize)
    void refresh(urlPage, urlPageSize, urlStatus, urlKeyword)
    return () => requestGate.invalidate()
    // URL is the source of truth, including browser back/forward navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateKey])

  const columns: TableColumnsType<ShakeCleanTask> = [
    { title: '造型派工单', dataIndex: 'code', key: 'code', width: 170 },
    { title: '生产工单', dataIndex: 'workOrderCode', key: 'workOrderCode', width: 165 },
    { title: '产品', key: 'product', width: 230, render: (_, row) => `${row.productName}（${row.productCode}）` },
    { title: '浇注件数', dataIndex: 'shakeOriginal', key: 'shakeOriginal', width: 105, render: (value: number) => `${value} 件` },
    { title: '待落砂', dataIndex: 'shakeRemaining', key: 'shakeRemaining', width: 95, render: (value: number) => `${value} 件` },
    { title: '待清理', dataIndex: 'cleaningRemaining', key: 'cleaningRemaining', width: 95, render: (value: number) => `${value} 件` },
    { title: '合格毛坯', dataIndex: 'blankOutputQuantity', key: 'blankOutputQuantity', width: 105, render: (value: number) => `${value} 件` },
    {
      title: '冷却/最早浇注', key: 'cooling', width: 175,
      render: (_, row) => coolingCell(row),
    },
    { title: '执行进度', key: 'progress', width: 145, render: (_, row) => <Progress size="small" percent={progress(row)} /> },
    { title: '状态', dataIndex: 'executionStatus', key: 'executionStatus', width: 125, render: (value: ShakeCleanExecutionStatus) => <Tag color={shakeCleanStatusColors[value]}>{shakeCleanStatusLabels[value]}</Tag> },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 90,
      render: (_, row) => <TableActions actions={hasPermission('production.shake_clean.view') ? [{
        key: 'view', label: '查看', icon: <EyeOutlined />,
        onClick: () => navigate(`/dashboard/production/shake-clean-tasks/${row.id}${detailQuery() ? `?${detailQuery()}` : ''}`),
      }] : []} />,
    },
  ]

  return <>
    <div className="page-header">
      <div><h1 className="page-title">落砂清理</h1><p className="page-description">衔接浇注批次，按冷却提示完成落砂、清理打磨和毛坯产出追溯。</p></div>
      <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
    </div>
    <Card>
      <div className="production-query-row">
        <Input allowClear prefix={<SearchOutlined />} value={keyword} placeholder="派工单/工单/产品" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => updateQuery(keyword.trim(), status, 1, pageSize)} />
        {workOrderId && <Tag closable onClose={clearWorkOrderFilter}>当前生产工单</Tag>}
        <div className="production-status-filters">
          {statusTabs.map((item) => <Button key={item.key} type={status === item.key ? 'primary' : 'default'} onClick={() => { setStatus(item.key); updateQuery(keyword.trim(), item.key, 1, pageSize) }}>{item.label}</Button>)}
        </div>
      </div>
      <ResizableTable storageKey="production-shake-clean-task-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); updateQuery(keyword.trim(), status, nextPage, nextPageSize) } }} locale={{ emptyText: '暂无落砂清理任务' }} />
    </Card>
  </>
}
