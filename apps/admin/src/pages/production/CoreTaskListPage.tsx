import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, PlayCircleOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, Select, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { fetchCoreTasks, type CoreTaskRecord, type CoreTaskStatus } from '../../utils/coremaking'
import { hasPermission } from '../../utils/roles'
import { coreTaskStatusColors, coreTaskStatusLabels, openCoreCancel, openCoreDispatch, openCoreReport, openCoreStart } from './CoreTaskDetailPage'

const statusOptions: Array<{ label: string; value: CoreTaskStatus | 'ALL' }> = [
  { label: '全部', value: 'ALL' }, { label: '待派工', value: 'PENDING_DISPATCH' }, { label: '待生产', value: 'WAITING' }, { label: '生产中', value: 'IN_PROGRESS' }, { label: '已完成', value: 'COMPLETED' }, { label: '已取消', value: 'CANCELED' },
]

export function CoreTaskListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const workOrderId = searchParams.get('workOrderId') || undefined
  const [records, setRecords] = useState<CoreTaskRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<CoreTaskStatus | 'ALL'>('ALL')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const canView = hasPermission('production.core_task.view')
  const canDispatch = hasPermission('production.core_task.dispatch')
  const canCancel = hasPermission('production.core_task.cancel')
  const canStart = hasPermission('production.core_task.start')
  const canReport = hasPermission('production.core_task.report')

  const refresh = async () => {
    setLoading(true); setError('')
    try { setRecords(await fetchCoreTasks({ keyword: keyword.trim(), status, workOrderId })) } catch (reason) { setError(reason instanceof Error ? reason.message : '制芯任务加载失败') } finally { setLoading(false) }
  }
  // Refresh when the optional work-order scope changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [workOrderId])
  const run = (action: Promise<void>) => void action.catch((reason) => message.error(reason instanceof Error ? reason.message : '操作加载失败'))

  const columns: TableColumnsType<CoreTaskRecord> = [
    { title: '任务编号', dataIndex: 'code', key: 'code', width: 170 },
    { title: '生产工单', dataIndex: 'workOrderCode', key: 'workOrderCode', width: 160 },
    { title: '产品', key: 'product', width: 210, render: (_, row) => `${row.productName}（${row.productCode}）` },
    { title: '芯盒', key: 'coreBox', width: 210, render: (_, row) => `${row.coreBoxName}（${row.coreBoxCode}）` },
    { title: '计划量', dataIndex: 'plannedQuantity', key: 'plannedQuantity', width: 90 },
    { title: '合格数', dataIndex: 'qualifiedQuantity', key: 'qualifiedQuantity', width: 90 },
    { title: '报废数', dataIndex: 'scrapQuantity', key: 'scrapQuantity', width: 90 },
    { title: '设备', dataIndex: 'equipmentName', key: 'equipmentName', width: 150, render: (value: string) => value || '-' },
    { title: '班组', dataIndex: 'teamName', key: 'teamName', width: 130, render: (value: string) => value || '-' },
    { title: '计划开始', dataIndex: 'plannedStartAt', key: 'plannedStartAt', width: 175, render: (value: string) => value ? new Date(value).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: CoreTaskStatus) => <Tag color={coreTaskStatusColors[value]}>{coreTaskStatusLabels[value]}</Tag> },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 175, render: (value: string) => new Date(value).toLocaleString() },
    { title: '操作', key: 'actions', fixed: 'right', width: 210, render: (_, record) => <TableActions actions={[
      ...(canView ? [{ key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => navigate(`/dashboard/production/core-tasks/${record.id}`) }] : []),
      ...(record.canDispatch && canDispatch ? [{ key: 'dispatch', label: '派工', icon: <SendOutlined />, onClick: () => run(openCoreDispatch(record, refresh)) }] : []),
      ...(record.canStart && canStart ? [{ key: 'start', label: '开始', icon: <PlayCircleOutlined />, onClick: () => run(openCoreStart(record, refresh)) }] : []),
      ...(record.canReport && canReport ? [{ key: 'report', label: '报工', icon: <CheckCircleOutlined />, onClick: () => run(openCoreReport(record, refresh)) }] : []),
      ...(record.canCancel && canCancel ? [{ key: 'cancel', label: '取消', icon: <CloseCircleOutlined />, danger: true, onClick: () => run(openCoreCancel(record, refresh)) }] : []),
    ]} /> },
  ]

  return <>
    <div className="page-header"><div><h1 className="page-title">制芯任务</h1><p className="page-description">按芯盒跟踪计划派工、班组执行和报工入库。</p></div>{canView && <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>}</div>
    <Card>
      <div className="production-query-row"><Input allowClear prefix={<SearchOutlined />} placeholder="任务/工单/产品/芯盒" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} /><Select value={status} style={{ width: 132 }} options={statusOptions} onChange={setStatus} /></div>
      {error && <Alert className="coremaking-load-error" type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}
      <ResizableTable storageKey="production-core-task-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ pageSize: 10 }} locale={{ emptyText: '暂无制芯任务' }} />
    </Card>
  </>
}
