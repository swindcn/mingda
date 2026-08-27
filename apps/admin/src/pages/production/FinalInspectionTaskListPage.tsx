import { EyeOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Input, Progress, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { fetchInspectionTasks, inspectionStatusColors, inspectionStatusLabels, type InspectionStatus, type InspectionTaskRow } from '../../utils/finalInspection'

const tabs: Array<{ key: InspectionStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: '全部' }, { key: 'WAITING', label: '待检验' }, { key: 'INSPECTING', label: '检验中' }, { key: 'REWORKING', label: '返修中' }, { key: 'COMPLETED', label: '已完成' },
]

const readPageParam = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function FinalInspectionTaskListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const urlStateKey = params.toString()
  const workOrderId = params.get('workOrderId') || undefined
  const urlKeyword = params.get('keyword') || ''
  const urlStatus = (params.get('status') as InspectionStatus) || 'ALL'
  const urlPage = readPageParam(params.get('page'), 1)
  const urlPageSize = readPageParam(params.get('pageSize'), 20)
  const [keyword, setKeyword] = useState(urlKeyword)
  const [status, setStatus] = useState<InspectionStatus | 'ALL'>(urlStatus)
  const [page, setPage] = useState(urlPage)
  const [pageSize, setPageSize] = useState(urlPageSize)
  const [total, setTotal] = useState(0)
  const [records, setRecords] = useState<InspectionTaskRow[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = async (nextPage = page, nextSize = pageSize, nextStatus = status, nextKeyword = keyword.trim()) => {
    try {
      setLoading(true)
      const result = await fetchInspectionTasks({ page: nextPage, pageSize: nextSize, keyword: nextKeyword, status: nextStatus, workOrderId })
      setRecords(result.records); setTotal(result.total); setPage(result.page); setPageSize(result.pageSize)
    } catch (error) { message.error(error instanceof Error ? error.message : '终检任务加载失败') } finally { setLoading(false) }
  }
  const updateQuery = (nextKeyword = keyword.trim(), nextStatus = status, nextPage = page, nextPageSize = pageSize) => setParams((current) => {
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
  const clearWorkOrderFilter = () => setParams((current) => {
    const next = new URLSearchParams(current)
    next.delete('workOrderId')
    return next
  }, { replace: true })
  const detailQuery = () => {
    const next = new URLSearchParams(params)
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
    queueMicrotask(() => void refresh(urlPage, urlPageSize, urlStatus, urlKeyword))
    // URL is the source of truth, including browser back/forward navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateKey])

  const columns: TableColumnsType<InspectionTaskRow> = [
    { title: '生产工单', dataIndex: 'code', width: 170 },
    { title: '产品编码', dataIndex: 'productCode', width: 165 },
    { title: '产品名称', dataIndex: 'productName', width: 210 },
    { title: '材质牌号', dataIndex: 'materialGradeName', width: 135 },
    { title: '待检总数', dataIndex: 'originalQuantity', width: 105, render: (value: number) => `${value} 件` },
    { title: '剩余待检', dataIndex: 'remainingQuantity', width: 105, render: (value: number) => `${value} 件` },
    { title: '返修中', dataIndex: 'openReworkQuantity', width: 95, render: (value: number) => `${value} 件` },
    { title: '合格入库', dataIndex: 'qualifiedQuantity', width: 105, render: (value: number) => `${value} 件` },
    { title: '进度', width: 145, render: (_, row) => <Progress size="small" percent={row.originalQuantity ? Math.min(100, Number(((row.originalQuantity - row.remainingQuantity) / row.originalQuantity * 100).toFixed(1))) : 0} /> },
    { title: '状态', dataIndex: 'status', width: 105, render: (value: InspectionStatus) => <Tag color={inspectionStatusColors[value]}>{inspectionStatusLabels[value]}</Tag> },
    { title: '操作', fixed: 'right', width: 90, render: (_, row) => <TableActions actions={[{ key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => navigate(`/dashboard/production/inspection-tasks/${row.id}${detailQuery() ? `?${detailQuery()}` : ''}`) }]} /> },
  ]

  return <>
    <div className="page-header"><div><h1 className="page-title">成品终检</h1><p className="page-description">检验清理后的铸件毛坯，记录合格入库、清理返修和报废回炉。</p></div><Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => updateQuery(keyword.trim(), status, 1, pageSize)}>查询</Button></div>
    <Card>
      <div className="production-query-row">
        <Input allowClear prefix={<SearchOutlined />} value={keyword} placeholder="生产工单/产品编码/名称" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => updateQuery(keyword.trim(), status, 1, pageSize)} />
        {workOrderId && <Tag closable onClose={clearWorkOrderFilter}>当前生产工单</Tag>}
        <div className="production-status-filters">
          {tabs.map((item) => <Button key={item.key} type={status === item.key ? 'primary' : 'default'} onClick={() => { setStatus(item.key); updateQuery(keyword.trim(), item.key, 1, pageSize) }}>{item.label}</Button>)}
        </div>
      </div>
      <ResizableTable storageKey="production-final-inspection-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (next, size) => { setPage(next); setPageSize(size); updateQuery(keyword.trim(), status, next, size) } }} locale={{ emptyText: '暂无终检任务' }} />
    </Card>
  </>
}
