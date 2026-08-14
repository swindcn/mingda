import { Input, InputNumber, Modal, Select, Space, Typography, message } from 'antd'
import { ApiRequestError } from '../../services/api'
import {
  completeHeatOrder,
  fetchHeatExecutionOptions,
  fetchHeatOrder,
  startHeatOrder,
  transferHeatOrder,
  type HeatOrderRecord,
} from '../../utils/production'

type RefreshAction = () => Promise<void>
type HeatAction = 'start' | 'transfer' | 'complete'

const actionFlags: Record<HeatAction, keyof Pick<HeatOrderRecord, 'canStart' | 'canTransfer' | 'canComplete'>> = {
  start: 'canStart',
  transfer: 'canTransfer',
  complete: 'canComplete',
}

async function latestHeatForAction(record: HeatOrderRecord, action: HeatAction, refresh: RefreshAction) {
  const latest = await fetchHeatOrder(record.id)
  if (latest[actionFlags[action]]) return latest
  message.warning('数据已被其他终端更新，页面已刷新')
  await refresh()
  return null
}

async function submitWithConflictRefresh(action: () => Promise<void>, refresh: RefreshAction) {
  try {
    await action()
    return true
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      message.warning('数据已被其他终端更新，页面已刷新')
      await refresh()
      return false
    }
    message.error(error instanceof Error ? error.message : '操作失败')
    throw error
  }
}

export async function openHeatStart(record: HeatOrderRecord, refresh: RefreshAction) {
  const latest = await latestHeatForAction(record, 'start', refresh)
  if (!latest) return
  const options = await fetchHeatExecutionOptions(latest.id)
  let furnaceCode = options.actualFurnaceCode || options.plannedFurnaceCode
  Modal.confirm({
    title: '开始熔炼生产',
    width: 520,
    content: <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">计划熔炉：{options.plannedFurnaceName}（{options.plannedFurnaceCode}）</Typography.Text>
      <Select
        showSearch
        optionFilterProp="label"
        defaultValue={furnaceCode}
        style={{ width: '100%' }}
        placeholder="请选择实际熔炉"
        options={options.furnaces.map((item) => ({
          value: item.code,
          label: `${item.name}（${item.code}）${item.isPlanned ? ' · 计划设备' : ''}`,
        }))}
        onChange={(value) => { furnaceCode = value }}
      />
    </Space>,
    okText: '开始生产',
    cancelText: '取消',
    onOk: async () => {
      if (!furnaceCode) throw new Error('请选择实际熔炉')
      const changed = furnaceCode !== options.plannedFurnaceCode
      if (changed) {
        const confirmed = await new Promise<boolean>((resolve) => Modal.confirm({
          title: '确认更换熔炉',
          content: `所选熔炉与计划熔炉不一致，确认更换并更新炉次实际绑定关系吗？`,
          okText: '确认更换',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }))
        if (!confirmed) return
      }
      const submitted = await submitWithConflictRefresh(
        () => startHeatOrder(latest.id, { versionNo: latest.versionNo, actualFurnaceCode: furnaceCode, confirmFurnaceChange: changed }).then(() => undefined),
        refresh,
      )
      if (!submitted) return
      message.success('炉次已开始生产')
      await refresh()
    },
  })
}

export async function openHeatTransfer(record: HeatOrderRecord, refresh: RefreshAction) {
  const latest = await latestHeatForAction(record, 'transfer', refresh)
  if (!latest) return
  const options = await fetchHeatExecutionOptions(latest.id)
  let transferDeviceCode = ''
  let weightKg = 0
  let remark = ''
  Modal.confirm({
    title: '转运出炉',
    width: 520,
    content: <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">可转运数量：<Typography.Text strong>{options.remainingTransferWeightKg.toFixed(2)} kg</Typography.Text></Typography.Text>
      <Select
        showSearch
        optionFilterProp="label"
        style={{ width: '100%' }}
        placeholder="请选择浇注包或球化包"
        options={options.transferDevices.map((item) => ({ value: item.code, label: `${item.name}（${item.code}） · ${item.equipmentType}` }))}
        onChange={(value) => { transferDeviceCode = value }}
      />
      <InputNumber min={0.01} max={options.remainingTransferWeightKg} precision={2} addonAfter="kg" style={{ width: '100%' }} placeholder="请输入本次转运重量" onChange={(value) => { weightKg = Number(value || 0) }} />
      <Input.TextArea rows={3} placeholder="转运备注（选填）" onChange={(event) => { remark = event.target.value }} />
    </Space>,
    okText: '确认转运',
    cancelText: '取消',
    onOk: async () => {
      if (!transferDeviceCode) throw new Error('请选择转运包设备')
      if (weightKg <= 0) throw new Error('转运重量必须大于 0')
      if (weightKg > options.remainingTransferWeightKg) throw new Error(`转运重量不能超过 ${options.remainingTransferWeightKg.toFixed(2)} kg`)
      const submitted = await submitWithConflictRefresh(
        () => transferHeatOrder(latest.id, { versionNo: latest.versionNo, transferDeviceCode, weightKg, remark }).then(() => undefined),
        refresh,
      )
      if (!submitted) return
      message.success('转运记录已提交')
      await refresh()
    },
  })
}

export async function openHeatComplete(record: HeatOrderRecord, refresh: RefreshAction) {
  const latest = await latestHeatForAction(record, 'complete', refresh)
  if (!latest) return
  let actual = latest.transferTotalWeightKg
  let remark = ''
  Modal.confirm({
    title: '完成熔炼生产',
    content: <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">转运累计：{latest.transferTotalWeightKg.toFixed(2)} kg</Typography.Text>
      <InputNumber min={0.01} precision={2} defaultValue={actual} addonAfter="kg" style={{ width: '100%' }} onChange={(value) => { actual = Number(value || 0) }} />
      <Input.TextArea rows={3} placeholder="完工备注（选填）" onChange={(event) => { remark = event.target.value }} />
    </Space>,
    okText: '完成生产',
    cancelText: '取消',
    onOk: async () => {
      if (actual <= 0) throw new Error('实际出炉重量必须大于 0')
      const submitted = await submitWithConflictRefresh(
        () => completeHeatOrder(latest.id, latest.versionNo, actual, remark).then(() => undefined),
        refresh,
      )
      if (!submitted) return
      message.success('炉次已完成')
      await refresh()
    },
  })
}
