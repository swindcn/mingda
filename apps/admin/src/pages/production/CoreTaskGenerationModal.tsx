import { Alert, DatePicker, Empty, Input, InputNumber, Modal, Select, Table, Typography, message } from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { ApiRequestError } from '../../services/api'
import {
  calculateCorePlan,
  createCoreTasks,
  previewCoreTasks,
  type CoreTaskInput,
  type CoreTaskPreview,
  type CoreTaskPreviewRow,
} from '../../utils/coremaking'
import { hasPermission } from '../../utils/roles'

type GenerationRow = CoreTaskPreviewRow & CoreTaskInput

function assignmentRows(preview: CoreTaskPreview): GenerationRow[] {
  const defaultNode = preview.routingNodes[0]
  return preview.rows.map((row) => ({
    ...row,
    routingNodeId: defaultNode?.id,
    equipmentCode: undefined,
    teamCode: undefined,
    plannedStartAt: undefined,
    remark: '',
  }))
}

export function CoreTaskGenerationModal({
  open,
  workOrderId,
  workOrderQuantity,
  onClose,
  onSuccess,
}: {
  open: boolean
  workOrderId: string
  workOrderQuantity: number
  onClose: () => void
  onSuccess: () => Promise<void> | void
}) {
  const [preview, setPreview] = useState<CoreTaskPreview | null>(null)
  const [rows, setRows] = useState<GenerationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const canCreate = hasPermission('production.core_task.create')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await previewCoreTasks(workOrderId, { rows: [] })
      setPreview(result)
      setRows(assignmentRows(result))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '制芯任务预览加载失败')
    } finally {
      setLoading(false)
    }
  }

  // Opening the modal starts a fresh server preview.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (open) void load() }, [open, workOrderId])

  const patchRow = (coreBoxCode: string, value: Partial<GenerationRow>) => {
    setRows((current) => current.map((row) => row.coreBoxCode === coreBoxCode ? { ...row, ...value } : row))
  }

  const payloadRows = useMemo<CoreTaskInput[]>(() => rows.map((row) => ({
    coreBoxCode: row.coreBoxCode,
    expectedScrapRate: row.expectedScrapRate,
    routingNodeId: row.routingNodeId,
    equipmentCode: row.equipmentCode,
    teamCode: row.teamCode,
    plannedStartAt: row.plannedStartAt,
    remark: row.remark,
  })), [rows])

  const submit = async () => {
    if (!canCreate) return
    if (!rows.length) throw new Error('没有可生成的芯盒任务')
    for (const row of rows) {
      if (!row.routingNodeId) throw new Error(`请选择芯盒 ${row.coreBoxCode} 的制芯工序`)
      if ((row.equipmentCode || row.teamCode || row.plannedStartAt) && !(row.equipmentCode && row.teamCode && row.plannedStartAt)) {
        throw new Error(`芯盒 ${row.coreBoxCode} 的设备、班组和计划时间需要完整填写`)
      }
    }
    setSubmitting(true)
    try {
      await previewCoreTasks(workOrderId, { rows: payloadRows })
      await createCoreTasks(workOrderId, { rows: payloadRows })
      message.success('制芯任务已生成')
      await onSuccess()
      onClose()
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) {
        message.warning('制芯任务已被其他用户生成，工单与预览已刷新')
        await onSuccess()
        await load()
        return
      }
      message.error(reason instanceof Error ? reason.message : '制芯任务生成失败')
      throw reason
    } finally {
      setSubmitting(false)
    }
  }

  const columns: TableColumnsType<GenerationRow> = [
    { title: '芯盒', dataIndex: 'coreBoxName', key: 'coreBoxName', width: 170, render: (value, row) => <div><Typography.Text strong>{value}</Typography.Text><br /><Typography.Text type="secondary">{row.coreBoxCode}</Typography.Text></div> },
    { title: '预计废品率', dataIndex: 'expectedScrapRate', key: 'expectedScrapRate', width: 130, render: (value: number, row) => <InputNumber min={0} max={9999} precision={2} value={Number((value * 100).toFixed(2))} addonAfter="%" onChange={(percent) => { const expectedScrapRate = Number(percent || 0) / 100; patchRow(row.coreBoxCode, { expectedScrapRate, ...calculateCorePlan(workOrderQuantity, row.quantityPerProduct, expectedScrapRate, row.cavityCount) }) }} /> },
    { title: '需求量', dataIndex: 'plannedQuantity', key: 'plannedQuantity', width: 90 },
    { title: '压盒次数', dataIndex: 'plannedPressCount', key: 'plannedPressCount', width: 100 },
    { title: '工序', dataIndex: 'routingNodeId', key: 'routingNodeId', width: 180, render: (value: string, row) => <Select value={value} style={{ width: '100%' }} options={(preview?.routingNodes || []).map((item) => ({ value: item.id, label: `${item.seqNo}. ${item.operationName}` }))} onChange={(routingNodeId) => patchRow(row.coreBoxCode, { routingNodeId, equipmentCode: undefined, teamCode: undefined })} /> },
    { title: '设备', dataIndex: 'equipmentCode', key: 'equipmentCode', width: 180, render: (value: string, row) => { const node = preview?.routingNodes.find((item) => item.id === row.routingNodeId); return <Select allowClear showSearch optionFilterProp="label" value={value || undefined} style={{ width: '100%' }} placeholder="可后续派工" options={(node?.equipment || []).filter((item) => item.status === '启用').map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(equipmentCode) => patchRow(row.coreBoxCode, { equipmentCode, teamCode: undefined })} /> } },
    { title: '班组', dataIndex: 'teamCode', key: 'teamCode', width: 170, render: (value: string, row) => { const node = preview?.routingNodes.find((item) => item.id === row.routingNodeId); const equipment = node?.equipment.find((item) => item.code === row.equipmentCode); return <Select allowClear showSearch optionFilterProp="label" disabled={!equipment} value={value || undefined} style={{ width: '100%' }} placeholder="可后续派工" options={(preview?.teams || []).filter((item) => item.workshopCode === equipment?.workshopCode).map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))} onChange={(teamCode) => patchRow(row.coreBoxCode, { teamCode })} /> } },
    { title: '计划时间', dataIndex: 'plannedStartAt', key: 'plannedStartAt', width: 190, render: (value: string, row) => <DatePicker showTime value={value ? dayjs(value) : null} style={{ width: '100%' }} onChange={(date) => patchRow(row.coreBoxCode, { plannedStartAt: date?.toISOString() })} /> },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 180, render: (value: string, row) => <Input value={value} maxLength={200} onChange={(event) => patchRow(row.coreBoxCode, { remark: event.target.value })} /> },
  ]

  return <Modal open={open} title={`生成制芯任务${preview ? ` · ${preview.workOrderCode}` : ''}`} width="min(1320px, 96vw)" okText="生成任务" cancelText="取消" okButtonProps={{ disabled: !canCreate || !rows.length }} confirmLoading={submitting} onOk={submit} onCancel={onClose} destroyOnHidden>
    {error && <Alert type="error" showIcon message={error} action={<a onClick={() => void load()}>重试</a>} />}
    {!error && <Table rowKey="coreBoxCode" size="small" loading={loading} pagination={false} columns={columns} dataSource={rows} scroll={{ x: 1390 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待生成的芯盒任务" /> }} />}
  </Modal>
}
