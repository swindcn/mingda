import { EyeOutlined, LockOutlined, PrinterOutlined, SearchOutlined, StopOutlined, UnlockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Table, Tag, message } from 'antd'
import type { FormInstance, TableColumnsType } from 'antd'
import { createRef, useEffect, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { TableActions } from '../../components/TableActions'
import { ApiRequestError } from '../../services/api'
import {
  dryCoreBatch,
  fetchCoreInventory,
  fetchCoreInventoryBatch,
  fetchCoreInventoryOptions,
  lockCoreBatch,
  loadLatestCoreBatchLabel,
  remainingCoreHours,
  resolveCoreInventoryPage,
  scrapCoreBatch,
  unlockCoreBatch,
  type CoreBatchRecord,
  type CoreBatchStatus,
} from '../../utils/coremaking'
import { createLatestRequestGate } from '../../utils/latestRequest'
import { hasPermission } from '../../utils/roles'
import { CoreBatchLabel } from './CoreBatchLabel'

const batchStatusLabels = { UNDRIED: '待烘干', AVAILABLE: '可用', WARNING: '临期', EXPIRED: '过期', LOCKED: '冻结', SCRAPPED: '报废', CONSUMED: '耗尽' }
const batchStatusColors = { UNDRIED: 'processing', AVAILABLE: 'success', WARNING: 'warning', EXPIRED: 'error', LOCKED: 'purple', SCRAPPED: 'error', CONSUMED: 'default' }
const batchFilters: Array<{ label: string; value: CoreBatchStatus | 'ALL' }> = [
  { label: '全部', value: 'ALL' }, { label: '待烘干', value: 'UNDRIED' }, { label: '可用', value: 'AVAILABLE' }, { label: '临期', value: 'WARNING' }, { label: '过期', value: 'EXPIRED' }, { label: '冻结', value: 'LOCKED' }, { label: '报废', value: 'SCRAPPED' }, { label: '耗尽', value: 'CONSUMED' },
]
const ledgerLabels: Record<string, string> = { PRODUCED: '报工入库', DRIED: '确认烘干', LOCKED: '冻结', UNLOCKED: '解冻', SCRAPPED: '报废', CONSUMED: '领用' }

export function CoreInventoryPage() {
  const [records, setRecords] = useState<CoreBatchRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<CoreBatchStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<CoreBatchRecord | null>(null)
  const [labelBatch, setLabelBatch] = useState<CoreBatchRecord | null>(null)
  const [listRequestGate] = useState(() => createLatestRequestGate())
  const [detailRequestGate] = useState(() => createLatestRequestGate())
  const [labelRequestGate] = useState(() => createLatestRequestGate())
  const canView = hasPermission('production.core_inventory.view')
  const canDry = hasPermission('production.core_inventory.dry')
  const canLock = hasPermission('production.core_inventory.lock')
  const canScrap = hasPermission('production.core_inventory.scrap')

  const refresh = async (nextPage = page, nextPageSize = pageSize, nextStatus = status, nextKeyword = keyword.trim()) => {
    setLoading(true); setError('')
    await listRequestGate.run(async () => {
      let result = await fetchCoreInventory({ page: nextPage, pageSize: nextPageSize, status: nextStatus, keyword: nextKeyword })
      const resolvedPage = resolveCoreInventoryPage(nextPage, result.items.length, result.totalPages)
      if (resolvedPage !== result.page) {
        result = await fetchCoreInventory({ page: resolvedPage, pageSize: nextPageSize, status: nextStatus, keyword: nextKeyword })
      }
      return result
    }, {
      success: (result) => {
        setRecords(result.items); setPage(result.page); setPageSize(result.pageSize); setTotal(result.total)
      },
      error: (reason) => setError(reason instanceof Error ? reason.message : '砂芯库存加载失败'),
      settled: () => setLoading(false),
    })
  }
  useEffect(() => {
    // Initial query synchronizes the remote inventory into local page state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(1)
    return () => { listRequestGate.invalidate(); detailRequestGate.invalidate(); labelRequestGate.invalidate() }
    // The initial query deliberately snapshots the default filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDetail = async (id: string) => {
    await detailRequestGate.run(
      () => fetchCoreInventoryBatch(id),
      {
        success: setDetail,
        error: (reason) => message.error(reason instanceof Error ? reason.message : '批次详情加载失败'),
      },
    )
  }
  const refreshAfterAction = async () => { await refresh(); if (detail) await loadDetail(detail.id) }
  const submit = async (action: () => Promise<unknown>) => {
    try { await action(); await refreshAfterAction(); return true } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) { message.warning('数据已被其他用户更新，请刷新后重试；页面已刷新'); await refreshAfterAction(); return false }
      message.error(reason instanceof Error ? reason.message : '库存操作失败'); throw reason
    }
  }
  const openDetail = async (record: CoreBatchRecord) => {
    await loadDetail(record.id)
  }
  const openLabel = async (record: CoreBatchRecord) => {
    await loadLatestCoreBatchLabel(
      labelRequestGate,
      record.id,
      {
        success: setLabelBatch,
        error: (reason) => message.error(reason instanceof Error ? reason.message : '批次标签加载失败'),
      },
    )
  }
  const runDry = async (record: CoreBatchRecord) => {
    const latest = await fetchCoreInventoryBatch(record.id)
    const options = await fetchCoreInventoryOptions()
    const formRef = createRef<FormInstance<{ equipmentCode: string }>>()
    Modal.confirm({
      title: '确认烘干',
      content: <Form ref={formRef} layout="vertical"><Form.Item name="equipmentCode" label="烘干设备" rules={[{ required: true, message: '请选择烘干设备' }]}><Select showSearch optionFilterProp="label" placeholder="请选择真实烘干设备" options={options.dryingEquipment.map((item) => ({ value: item.code, label: `${item.name}（${item.code}） · ${item.equipmentType}` }))} /></Form.Item></Form>,
      okText: '确认烘干', cancelText: '取消',
      onOk: async () => {
        const { equipmentCode } = await formRef.current!.validateFields()
        if (await submit(() => dryCoreBatch(latest.id, { versionNo: latest.versionNo, equipmentCode }))) message.success('批次已确认烘干')
      },
    })
  }
  const runReasonAction = async (record: CoreBatchRecord, action: 'lock' | 'scrap') => {
    const latest = await fetchCoreInventoryBatch(record.id)
    const label = action === 'lock' ? '冻结' : '报废'
    const formRef = createRef<FormInstance<{ reason: string }>>()
    Modal.confirm({
      title: `${label}砂芯批次`,
      content: <Form ref={formRef} layout="vertical"><Form.Item name="reason" label={`${label}理由`} rules={[{ required: true, whitespace: true, message: `请输入${label}理由` }]}><Input.TextArea rows={3} maxLength={200} placeholder={`请输入${label}理由`} /></Form.Item></Form>,
      okText: `确认${label}`, cancelText: '取消', okButtonProps: action === 'scrap' ? { danger: true } : undefined,
      onOk: async () => {
        const { reason } = await formRef.current!.validateFields()
        const request = () => action === 'lock'
          ? lockCoreBatch(latest.id, { versionNo: latest.versionNo, reason })
          : scrapCoreBatch(latest.id, { versionNo: latest.versionNo, reason })
        if (await submit(request)) message.success(`批次已${label}`)
      },
    })
  }
  const runUnlock = async (record: CoreBatchRecord) => {
    const latest = await fetchCoreInventoryBatch(record.id)
    Modal.confirm({ title: '解冻砂芯批次', content: `确认解冻批次 ${latest.code}？`, okText: '确认解冻', cancelText: '取消', onOk: async () => { if (await submit(() => unlockCoreBatch(latest.id, { versionNo: latest.versionNo }))) message.success('批次已解冻') } })
  }
  const run = (action: Promise<void>) => void action.catch((reason) => message.error(reason instanceof Error ? reason.message : '操作失败'))

  const columns: TableColumnsType<CoreBatchRecord> = [
    { title: '批次编号', dataIndex: 'code', key: 'code', width: 235 },
    { title: '剩余小时', dataIndex: 'expiresAt', key: 'remainingHours', width: 110, render: (value: string, row) => row.status === 'UNDRIED' ? '待起算' : remainingCoreHours(value) === null ? '长期有效' : `${remainingCoreHours(value)} 小时` },
    { title: '芯盒', key: 'coreBox', width: 220, render: (_, row) => `${row.coreBoxName}（${row.coreBoxCode}）` },
    { title: '产品', key: 'product', width: 220, render: (_, row) => `${row.productName}（${row.productCode}）` },
    { title: '生产工单', dataIndex: 'workOrderCode', key: 'workOrderCode', width: 160 },
    { title: '初始数量', dataIndex: 'initialQuantity', key: 'initialQuantity', width: 100 },
    { title: '当前数量', dataIndex: 'currentQuantity', key: 'currentQuantity', width: 100 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: CoreBatchStatus) => <Tag color={batchStatusColors[value]}>{batchStatusLabels[value]}</Tag> },
    { title: '失效时间', dataIndex: 'expiresAt', key: 'expiresAt', width: 175, render: (value: string, row) => row.status === 'UNDRIED' ? '烘干后起算' : value ? new Date(value).toLocaleString() : '长期有效' },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 175, render: (value: string) => new Date(value).toLocaleString() },
    { title: '操作', key: 'actions', fixed: 'right', width: 220, render: (_, record) => <TableActions actions={[
      ...(canView ? [{ key: 'detail', label: '详情', icon: <EyeOutlined />, onClick: () => void openDetail(record) }, { key: 'label', label: '标签', icon: <PrinterOutlined />, onClick: () => void openLabel(record) }] : []),
      ...(record.status === 'UNDRIED' && canDry ? [{ key: 'dry', label: '烘干', onClick: () => run(runDry(record)) }] : []),
      ...(['AVAILABLE', 'WARNING', 'EXPIRED'].includes(record.status) && record.currentQuantity > 0 && canLock ? [{ key: 'lock', label: '冻结', icon: <LockOutlined />, onClick: () => run(runReasonAction(record, 'lock')) }] : []),
      ...(record.status === 'LOCKED' && canLock ? [{ key: 'unlock', label: '解冻', icon: <UnlockOutlined />, onClick: () => run(runUnlock(record)) }] : []),
      ...(!['SCRAPPED', 'CONSUMED'].includes(record.status) && record.currentQuantity > 0 && canScrap ? [{ key: 'scrap', label: '报废', icon: <StopOutlined />, danger: true, onClick: () => run(runReasonAction(record, 'scrap')) }] : []),
    ]} /> },
  ]

  return <>
    <div className="page-header"><div><h1 className="page-title">砂芯库存</h1><p className="page-description">按批次管理烘干、保质期、冻结与报废状态。</p></div>{canView && <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => { setPage(1); void refresh(1) }}>查询</Button>}</div>
    <Card>
      <div className="production-query-row">
        <Input allowClear prefix={<SearchOutlined />} placeholder="批次/芯盒/产品/工单" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1) }} onPressEnter={() => void refresh(1)} />
        <div className="production-status-filters">
          {batchFilters.map((item) => <Button key={item.value} type={status === item.value ? 'primary' : 'default'} onClick={() => { setStatus(item.value); setPage(1); void refresh(1, pageSize, item.value) }}>{item.label}</Button>)}
        </div>
      </div>
      {error && <Alert className="coremaking-load-error" type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}
      <ResizableTable storageKey="production-core-inventory-widths" rowKey="id" columns={columns} dataSource={records} loading={loading} locale={{ emptyText: '暂无砂芯库存' }} pagination={{ current: page, pageSize, total, onChange: (nextPage, nextPageSize) => void refresh(nextPage, nextPageSize) }} />
    </Card>
    <Modal open={Boolean(detail)} title="砂芯批次详情" width={880} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} onCancel={() => setDetail(null)} destroyOnHidden>
      {detail && <><Descriptions bordered size="small" column={3}><Descriptions.Item label="批次编号" span={2}>{detail.code}</Descriptions.Item><Descriptions.Item label="状态"><Tag color={batchStatusColors[detail.status]}>{batchStatusLabels[detail.status]}</Tag></Descriptions.Item><Descriptions.Item label="芯盒">{detail.coreBoxName}（{detail.coreBoxCode}）</Descriptions.Item><Descriptions.Item label="产品">{detail.productName}（{detail.productCode}）</Descriptions.Item><Descriptions.Item label="生产工单">{detail.workOrderCode}</Descriptions.Item><Descriptions.Item label="当前/初始">{detail.currentQuantity} / {detail.initialQuantity}</Descriptions.Item><Descriptions.Item label="烘干设备">{detail.dryingEquipmentName || '-'}</Descriptions.Item><Descriptions.Item label="失效时间">{detail.expiresAt ? new Date(detail.expiresAt).toLocaleString() : '-'}</Descriptions.Item><Descriptions.Item label="冻结理由">{detail.lockReason || '-'}</Descriptions.Item><Descriptions.Item label="报废理由">{detail.scrapReason || '-'}</Descriptions.Item></Descriptions><Table className="core-inventory-ledger" rowKey="id" size="small" pagination={false} dataSource={detail.ledgers || []} locale={{ emptyText: '暂无库存流水' }} columns={[{ title: '动作', dataIndex: 'action', render: (value: string) => ledgerLabels[value] || value }, { title: '数量变化', dataIndex: 'quantityChange', render: (value: number) => value > 0 ? `+${value}` : value }, { title: '结存', dataIndex: 'quantityAfter' }, { title: '操作人', dataIndex: 'operatorName' }, { title: '时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString() }, { title: '理由', dataIndex: 'reason', render: (value: string) => value || '-' }]} /></>}
    </Modal>
    <CoreBatchLabel batch={labelBatch} open={Boolean(labelBatch)} onClose={() => setLabelBatch(null)} />
  </>
}
