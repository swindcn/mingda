import { CloseCircleOutlined, EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Input, Modal, Space, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { closeWorkOrder, fetchWorkOrders, type WorkOrderRecord } from '../../utils/production'
import { hasPermission } from '../../utils/roles'

const statusColors: Record<string, string> = {
  待排产: 'default', 部分排产: 'gold', 已排产: 'cyan', 生产中: 'blue', 熔炼完成: 'green', 已完工: 'green', 已关闭: 'red',
}
const statusOptions = [
  { label: '全部', value: '' },
  { label: '待排产', value: 'PENDING' },
  { label: '部分排产', value: 'PARTIAL' },
  { label: '已排产', value: 'FULL' },
  { label: '生产中', value: 'IN_PRODUCTION' },
  { label: '熔炼完成', value: 'MELT_COMPLETED' },
  { label: '已关闭', value: 'CLOSED' },
]

export function WorkOrderListPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<WorkOrderRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const canCreate = hasPermission('production.work_order.create')
  const canEdit = hasPermission('production.work_order.edit')
  const canClose = hasPermission('production.work_order.close')

  const refresh = async (nextStatus = status) => {
    setLoading(true)
    try {
      setRecords(await fetchWorkOrders({ keyword, status: nextStatus || undefined }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生产工单加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const runClose = (record: WorkOrderRecord) => {
    let reason = ''
    Modal.confirm({
      title: '强制关闭生产工单',
      content: <Input.TextArea rows={3} placeholder="请输入关闭原因" onChange={(event) => { reason = event.target.value }} />,
      okText: '关闭工单',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim()) throw new Error('请输入关闭原因')
        await closeWorkOrder(record.id, record.versionNo, reason)
        message.success('生产工单已关闭')
        await refresh()
      },
    })
  }

  const columns: TableColumnsType<WorkOrderRecord> = [
    { title: '工单编号', dataIndex: 'code', key: 'code', width: 155 },
    { title: '产品编码', dataIndex: 'productCode', key: 'productCode', width: 175 },
    { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 190 },
    { title: '材质牌号', dataIndex: 'materialGradeName', key: 'materialGradeName', width: 145 },
    { title: '计划件数', dataIndex: 'plannedQuantity', key: 'plannedQuantity', width: 100, render: (value: number) => `${value} 件` },
    { title: '交货总净重', dataIndex: 'totalNetWeightKg', key: 'totalNetWeightKg', width: 125, render: (value: number) => `${value} kg` },
    { title: '需求总铁水', dataIndex: 'totalMeltWeightKg', key: 'totalMeltWeightKg', width: 125, render: (value: number) => `${value} kg` },
    { title: '已排产', dataIndex: 'scheduledQuantity', key: 'scheduledQuantity', width: 100, render: (value: number) => `${value} 件` },
    { title: '熔炼完成', dataIndex: 'meltCompletedQuantity', key: 'meltCompletedQuantity', width: 105, render: (value: number) => `${value} 件` },
    { title: '计划交期', dataIndex: 'plannedDeliveryDate', key: 'plannedDeliveryDate', width: 120 },
    { title: '状态', dataIndex: 'displayStatus', key: 'displayStatus', width: 105, render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag> },
    { title: '创建人', dataIndex: 'createdByName', key: 'createdByName', width: 110, render: (value: string) => value || '-' },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 175, render: (value: string) => new Date(value).toLocaleString() },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 200,
      render: (_, record) => <TableActions actions={[
        { key: 'view', label: '查看', icon: <EyeOutlined />, onClick: () => navigate(`/dashboard/production/work-orders/${record.id}`) },
        ...(record.canEdit && canEdit ? [{ key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => navigate(`/dashboard/production/work-orders/${record.id}/edit`) }] : []),
        ...(!['CLOSED', 'COMPLETED'].includes(record.productionStatus) && canClose ? [{ key: 'close', label: '关闭', icon: <CloseCircleOutlined />, danger: true, onClick: () => runClose(record) }] : []),
      ]} />,
    },
  ]

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">生产工单</h1><p className="page-description">提交按件生产需求，锁定 BOM 与工艺路线版本并跟踪熔炼排产进度。</p></div>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/dashboard/production/work-orders/new')}>新增</Button>}
        </Space>
      </div>
      <Card>
        <div className="production-query-row">
          <Input allowClear prefix={<SearchOutlined />} placeholder="工单编号/产品编码/名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void refresh()} />
          <div className="production-status-filters">
            {statusOptions.map((item) => <Button key={item.value || 'ALL'} type={status === item.value ? 'primary' : 'default'} onClick={() => { setStatus(item.value); void refresh(item.value) }}>{item.label}</Button>)}
          </div>
        </div>
        <ResizableTable storageKey="production-work-order-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} pagination={{ pageSize: 10 }} />
      </Card>
    </>
  )
}
