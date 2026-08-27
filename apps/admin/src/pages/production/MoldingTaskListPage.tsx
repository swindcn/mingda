import { EyeOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Input, Progress, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { fetchMoldingTasks, moldingStatusColors, moldingStatusLabels, type MoldingDisplayStatus, type MoldingTask } from '../../utils/molding'
import { hasPermission } from '../../utils/roles'

const tabs: Array<{ key: MoldingDisplayStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING', label: '待派工' },
  { key: 'DISPATCHED', label: '已派工' },
  { key: 'IN_PROGRESS', label: '生产中' },
  { key: 'COMPLETED', label: '已完工' },
  { key: 'CANCELED', label: '已取消' },
]

const readPageParam = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function MoldingTaskListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStateKey = searchParams.toString()
  const workOrderId = searchParams.get('workOrderId') || undefined
  const urlKeyword = searchParams.get('keyword') || ''
  const urlStatus = (searchParams.get('status') as MoldingDisplayStatus) || 'ALL'
  const urlPage = readPageParam(searchParams.get('page'), 1)
  const urlPageSize = readPageParam(searchParams.get('pageSize'), 10)
  const [records, setRecords] = useState<MoldingTask[]>([])
  const [keyword, setKeyword] = useState(urlKeyword)
  const [status, setStatus] = useState<MoldingDisplayStatus | 'ALL'>(urlStatus)
  const [page, setPage] = useState(urlPage)
  const [pageSize, setPageSize] = useState(urlPageSize)
  const [loading, setLoading] = useState(false)
  const canView = hasPermission('production.molding.view')

  const refresh = async (nextStatus = status) => {
    setLoading(true)
    try {
      const result = await fetchMoldingTasks({ keyword: keyword.trim(), status: nextStatus, workOrderId })
      setRecords(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '造型任务加载失败')
    } finally {
      setLoading(false)
    }
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

  const columns: TableColumnsType<MoldingTask> = [
    { title: '任务编号', dataIndex: 'code', key: 'code', width: 170 },
    { title: '生产工单', dataIndex: 'workOrderCode', key: 'workOrderCode', width: 160 },
    { title: '产品', key: 'product', width: 220, render: (_, row) => `${row.productName}（${row.productCode}）` },
    { title: '模具', key: 'mold', width: 210, render: (_, row) => `${row.moldName}（${row.moldCode}）` },
    { title: '生产线', dataIndex: 'productionLineName', key: 'productionLineName', width: 140 },
    { title: '班组', dataIndex: 'teamName', key: 'teamName', width: 120, render: (value: string) => value || '-' },
    { title: '计划/完成', key: 'quantity', width: 120, render: (_, row) => `${row.completedGoodQty} / ${row.planBoxQty} 箱` },
    { title: '进度', key: 'progress', width: 150, render: (_, row) => <Progress size="small" percent={Math.min(100, Number(((row.completedGoodQty / Math.max(1, row.planBoxQty)) * 100).toFixed(1)))} /> },
    { title: '砂芯齐套', key: 'readiness', width: 150, render: (_, row) => <Tag color={row.readiness.ready ? 'green' : 'orange'}>{row.readiness.ready ? '已齐套' : row.readiness.startable ? `部分齐套 · 可生产${row.readiness.maxProducibleBoxQty}箱` : '未齐套'}</Tag> },
    { title: '状态', dataIndex: 'displayStatus', key: 'displayStatus', width: 115, render: (value: MoldingDisplayStatus) => <Tag color={moldingStatusColors[value]}>{moldingStatusLabels[value]}</Tag> },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 175, render: (value: string) => new Date(value).toLocaleString() },
    { title: '操作', key: 'actions', fixed: 'right', width: 90, render: (_, row) => <TableActions actions={canView ? [{ key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => navigate(`/dashboard/production/molding-tasks/${row.id}${detailQuery() ? `?${detailQuery()}` : ''}`) }] : []} /> },
  ]

  return <>
    <div className="page-header"><div><h1 className="page-title">造型下芯</h1><p className="page-description">跟踪造型派工、砂芯齐套、批次报工和库存倒冲。</p></div>{canView && <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => updateQuery(keyword.trim(), status, 1, pageSize)}>查询</Button>}</div>
    <Card>
      <div className="production-query-row">
        <Input allowClear prefix={<SearchOutlined />} value={keyword} placeholder="任务/工单/产品" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => updateQuery(keyword.trim(), status, 1, pageSize)} />
        {workOrderId && <Tag closable onClose={clearWorkOrderFilter}>当前生产工单</Tag>}
        <div className="production-status-filters">
          {tabs.map((item) => <Button key={item.key} type={status === item.key ? 'primary' : 'default'} onClick={() => { setStatus(item.key); updateQuery(keyword.trim(), item.key, 1, pageSize) }}>{item.label}</Button>)}
        </div>
      </div>
      <ResizableTable storageKey="production-molding-task-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ current: page, pageSize, total: records.length, showSizeChanger: true, onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); updateQuery(keyword.trim(), status, nextPage, nextPageSize) } }} locale={{ emptyText: '暂无造型下芯任务' }} />
    </Card>
  </>
}
