import { Alert, DatePicker, Empty, Form, Input, InputNumber, Modal, Select, Table, Typography, message } from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { ApiRequestError } from '../../services/api'
import {
  buildCoreTaskGenerationRows,
  calculateCorePlan,
  changeCoreTaskRoutingNode,
  createCoreTasks,
  previewCoreTasks,
  validateCoreTaskGenerationRows,
  type CoreTaskInput,
  type CoreTaskPreview,
  type CoreTaskGenerationRow,
} from '../../utils/coremaking'
import { createLatestRequestGate } from '../../utils/latestRequest'
import { hasPermission } from '../../utils/roles'

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
  const [rows, setRows] = useState<CoreTaskGenerationRow[]>([])
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [requestGate] = useState(() => createLatestRequestGate())
  const canCreate = hasPermission('production.core_task.create')

  const load = async () => {
    setLoading(true)
    setError('')
    setValidationErrors({})
    await requestGate.run(
      () => previewCoreTasks(workOrderId, { rows: [] }),
      {
        success: (result) => {
          setPreview(result)
          setRows(buildCoreTaskGenerationRows(result))
        },
        error: (reason) => setError(reason instanceof Error ? reason.message : '制芯任务预览加载失败'),
        settled: () => setLoading(false),
      },
    )
  }

  useEffect(() => {
    // Opening the modal starts a fresh server preview.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load()
    else requestGate.invalidate()
    return () => requestGate.invalidate()
    // Each opening deliberately snapshots its work-order identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workOrderId])

  const patchRow = (coreBoxCode: string, value: Partial<CoreTaskGenerationRow>) => {
    setRows((current) => current.map((row) => row.coreBoxCode === coreBoxCode ? { ...row, ...value } : row))
    setValidationErrors((current) => {
      if (!current[coreBoxCode]) return current
      const next = { ...current }
      delete next[coreBoxCode]
      return next
    })
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
    if (!rows.length) {
      message.error('没有可生成的芯盒任务')
      return
    }
    const errors = validateCoreTaskGenerationRows(rows)
    setValidationErrors(errors)
    if (Object.keys(errors).length) {
      message.error('请完善表格中的任务配置')
      return
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

  const columns: TableColumnsType<CoreTaskGenerationRow> = [
    { title: '芯盒', dataIndex: 'coreBoxName', key: 'coreBoxName', width: 170, render: (value, row) => <div><Typography.Text strong>{value}</Typography.Text><br /><Typography.Text type="secondary">{row.coreBoxCode}</Typography.Text></div> },
    { title: '预计废品率', dataIndex: 'expectedScrapRate', key: 'expectedScrapRate', width: 130, render: (value: number, row) => <InputNumber min={0} max={9999} precision={2} value={Number((value * 100).toFixed(2))} addonAfter="%" onChange={(percent) => { const expectedScrapRate = Number(percent || 0) / 100; patchRow(row.coreBoxCode, { expectedScrapRate, ...calculateCorePlan(workOrderQuantity, row.quantityPerProduct, expectedScrapRate, row.cavityCount) }) }} /> },
    { title: '需求量', dataIndex: 'plannedQuantity', key: 'plannedQuantity', width: 90 },
    { title: '压盒次数', dataIndex: 'plannedPressCount', key: 'plannedPressCount', width: 100 },
    { title: '工序', dataIndex: 'routingNodeId', key: 'routingNodeId', width: 210, render: (value: string, row) => <Form.Item validateStatus={validationErrors[row.coreBoxCode] ? 'error' : undefined} help={validationErrors[row.coreBoxCode]} style={{ marginBottom: 0 }}><Select value={value} placeholder="请选择工序" style={{ width: '100%' }} options={(preview?.routingNodes || []).map((item) => ({ value: item.id, label: `${item.seqNo}. ${item.operationName}` }))} onChange={(routingNodeId) => { const changed = changeCoreTaskRoutingNode(row, routingNodeId); patchRow(row.coreBoxCode, changed) }} /></Form.Item> },
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
