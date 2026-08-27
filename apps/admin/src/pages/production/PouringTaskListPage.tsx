import { EyeOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Input, Progress, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { fetchPouringTasks, holdColors, holdLabels, pouringStatusColors, pouringStatusLabels, type PouringExecutionStatus, type PouringTask } from '../../utils/pouring'
import { hasPermission } from '../../utils/roles'

const tabs: Array<{ key: PouringExecutionStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: '全部' }, { key: 'WAITING', label: '待浇注' }, { key: 'PARTIAL', label: '浇注中' },
  { key: 'WAITING_MOLDING', label: '等待后续造型' }, { key: 'COMPLETED', label: '已完成' },
]

const readPageParam = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function PouringTaskListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStateKey = searchParams.toString()
  const workOrderId = searchParams.get('workOrderId') || undefined
  const urlKeyword = searchParams.get('keyword') || ''
  const urlStatus = (searchParams.get('status') as PouringExecutionStatus) || 'ALL'
  const urlPage = readPageParam(searchParams.get('page'), 1)
  const urlPageSize = readPageParam(searchParams.get('pageSize'), 10)
  const [keyword, setKeyword] = useState(urlKeyword)
  const [status, setStatus] = useState<PouringExecutionStatus | 'ALL'>(urlStatus)
  const [page, setPage] = useState(urlPage)
  const [pageSize, setPageSize] = useState(urlPageSize)
  const [records, setRecords] = useState<PouringTask[]>([])
  const [loading, setLoading] = useState(false)
  const refresh = async (nextStatus = status) => {
    setLoading(true)
    try {
      setRecords(await fetchPouringTasks({ keyword: keyword.trim(), status: nextStatus, workOrderId }))
    } catch (error) { message.error(error instanceof Error ? error.message : '待浇队列加载失败') }
    finally { setLoading(false) }
  }
  const updateQuery = (nextKeyword = keyword.trim(), nextStatus = status, nextPage = page, nextPageSize = pageSize) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (nextKeyword) next.set('keyword', nextKeyword)
    else next.delete('keyword')
    if (nextStatus === 'ALL') next.delete('status')
    else next.set('status', nextStatus)
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
    setKeyword(urlKeyword)
    setStatus(urlStatus)
    setPage(urlPage)
    setPageSize(urlPageSize)
    queueMicrotask(() => void refresh(urlStatus))
    // URL is the source of truth, including browser back/forward navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateKey])
  const columns: TableColumnsType<PouringTask> = [
    { title: '造型派工单', dataIndex: 'moldingTaskCode', key: 'moldingTaskCode', width: 175 },
    { title: '生产工单', dataIndex: 'workOrderCode', key: 'workOrderCode', width: 165 },
    { title: '产品', key: 'product', width: 220, render: (_, row) => `${row.productName}（${row.productCode}）` },
    { title: '模具', dataIndex: 'moldName', key: 'moldName', width: 160 },
    { title: '造型/已浇/待浇', key: 'quantity', width: 150, render: (_, row) => `${row.moldedQuantity} / ${row.pouredQuantity} / ${row.remainingQuantity} 箱` },
    { title: '浇注进度', key: 'progress', width: 150, render: (_, row) => <Progress size="small" percent={Math.min(100, Number((row.pouredQuantity / Math.max(1, row.moldedQuantity) * 100).toFixed(1)))} /> },
    { title: '合型停留', key: 'hold', width: 135, render: (_, row) => <Tag color={holdColors[row.holdLevel]}>{row.holdMinutes} 分钟 · {holdLabels[row.holdLevel]}</Tag> },
    { title: '状态', dataIndex: 'executionStatus', key: 'executionStatus', width: 125, render: (value: PouringExecutionStatus) => <Tag color={pouringStatusColors[value]}>{pouringStatusLabels[value]}</Tag> },
    { title: '最早合型时间', dataIndex: 'earliestClosingTime', key: 'earliestClosingTime', width: 175, render: (value: string | null) => value ? new Date(value).toLocaleString() : '-' },
    { title: '操作', key: 'actions', fixed: 'right', width: 90, render: (_, row) => <TableActions actions={hasPermission('production.pouring.view') ? [{ key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => navigate(`/dashboard/production/pouring-tasks/${row.moldingTaskId}${detailQuery() ? `?${detailQuery()}` : ''}`) }] : []} /> },
  ]
  return <>
    <div className="page-header"><div><h1 className="page-title">合型浇注</h1><p className="page-description">绑定待浇砂型与铁水包次，记录浇注数量、重量和批次追溯。</p></div><Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => updateQuery(keyword.trim(), status, 1, pageSize)}>查询</Button></div>
    <Card><div className="production-query-row">
        <Input allowClear prefix={<SearchOutlined />} value={keyword} placeholder="派工单/工单/产品" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => updateQuery(keyword.trim(), status, 1, pageSize)} />
        {workOrderId && <Tag closable onClose={clearWorkOrderFilter}>当前生产工单</Tag>}
        <div className="production-status-filters">
          {tabs.map((item) => <Button key={item.key} type={status === item.key ? 'primary' : 'default'} onClick={() => { setStatus(item.key); updateQuery(keyword.trim(), item.key, 1, pageSize) }}>{item.label}</Button>)}
        </div>
      </div>
      <ResizableTable storageKey="production-pouring-task-widths" rowKey="moldingTaskId" columns={columns} dataSource={records} loading={loading} pagination={{ current: page, pageSize, total: records.length, showSizeChanger: true, onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); updateQuery(keyword.trim(), status, nextPage, nextPageSize) } }} locale={{ emptyText: '暂无待浇注任务' }} />
    </Card>
  </>
}
