import { Alert, DatePicker, Descriptions, Modal, Select, Space, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import { ApiRequestError } from '../../services/api'
import {
  adjustHeatOrderSchedule,
  fetchHeatOrder,
  fetchMeltPoolOptions,
  type HeatOrderRecord,
  type HeatScheduleConflict,
} from '../../utils/production'

type RefreshAction = () => Promise<void>

export interface HeatScheduleProposal {
  furnaceCode: string
  plannedStartAt: string
}

type HeatOrderReference = Pick<HeatOrderRecord, 'id'>

interface FurnaceOption {
  code: string
  name: string
  capacityKg: number
}

function snapQuarter(value: Dayjs) {
  const minutes = value.hour() * 60 + value.minute()
  return value.startOf('day').add(Math.round(minutes / 15) * 15, 'minute')
}

function finishAt(record: HeatOrderRecord, start: Dayjs) {
  const duration = dayjs(record.plannedFinishAt).diff(dayjs(record.plannedStartAt), 'millisecond')
  return start.add(duration, 'millisecond')
}

function AdjustmentForm({ record, furnaces, onChange }: { record: HeatOrderRecord; furnaces: FurnaceOption[]; onChange: (proposal: HeatScheduleProposal) => void }) {
  const [furnaceCode, setFurnaceCode] = useState(record.furnaceCode)
  const [start, setStart] = useState(() => dayjs(record.plannedStartAt))
  const finish = useMemo(() => finishAt(record, start), [record, start])
  const update = (nextFurnaceCode: string, nextStart: Dayjs) => onChange({ furnaceCode: nextFurnaceCode, plannedStartAt: nextStart.toISOString() })
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <div>
      <Typography.Text>目标熔炉</Typography.Text>
      <Select
        showSearch
        optionFilterProp="label"
        value={furnaceCode}
        style={{ width: '100%', marginTop: 8 }}
        options={furnaces.map((item) => ({ value: item.code, label: `${item.name}（${item.code}） · ${(item.capacityKg / 1000).toFixed(2)} t/炉` }))}
        onChange={(value) => { setFurnaceCode(value); update(value, start) }}
      />
    </div>
    <div>
      <Typography.Text>计划开始时间</Typography.Text>
      <DatePicker
        showTime={{ minuteStep: 15, format: 'HH:mm' }}
        format="YYYY-MM-DD HH:mm"
        value={start}
        allowClear={false}
        style={{ width: '100%', marginTop: 8 }}
        onChange={(value) => {
          if (!value) return
          const next = snapQuarter(value)
          setStart(next)
          update(furnaceCode, next)
        }}
      />
    </div>
    <Descriptions size="small" column={1} bordered items={[{ key: 'finish', label: '预计完成时间', children: finish.format('YYYY-MM-DD HH:mm') }]} />
  </Space>
}

function confirmDialog(title: string, content: React.ReactNode, okText = '确认调整') {
  return new Promise<boolean>((resolve) => Modal.confirm({
    title,
    width: 560,
    content,
    okText,
    cancelText: '取消',
    onOk: () => resolve(true),
    onCancel: () => resolve(false),
  }))
}

function summary(record: HeatOrderRecord, proposal: HeatScheduleProposal, furnaces: FurnaceOption[], conflicts: HeatScheduleConflict[] = []) {
  const nextStart = dayjs(proposal.plannedStartAt)
  const nextFinish = finishAt(record, nextStart)
  const target = furnaces.find((item) => item.code === proposal.furnaceCode)
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Descriptions size="small" column={1} bordered items={[
      { key: 'code', label: '炉次', children: record.code },
      { key: 'furnace', label: '熔炼设备', children: `${record.furnaceName} → ${target?.name || proposal.furnaceCode}` },
      { key: 'start', label: '计划开始', children: `${dayjs(record.plannedStartAt).format('YYYY-MM-DD HH:mm')} → ${nextStart.format('YYYY-MM-DD HH:mm')}` },
      { key: 'finish', label: '预计完成', children: `${dayjs(record.plannedFinishAt).format('YYYY-MM-DD HH:mm')} → ${nextFinish.format('YYYY-MM-DD HH:mm')}` },
    ]} />
    {conflicts.length > 0 && <Alert type="warning" showIcon message={`与 ${conflicts.length} 个炉次存在时间冲突`} description={conflicts.map((item) => `${item.code}（${dayjs(item.plannedStartAt).format('HH:mm')} - ${dayjs(item.plannedFinishAt).format('HH:mm')}）`).join('、')} />}
  </Space>
}

async function submit(record: HeatOrderRecord, proposal: HeatScheduleProposal, furnaces: FurnaceOption[], refresh: RefreshAction, confirmed = false): Promise<boolean> {
  try {
    await adjustHeatOrderSchedule(record.id, { versionNo: record.versionNo, ...proposal, confirmScheduleConflict: confirmed })
    message.success('炉次排程已调整')
    await refresh()
    return true
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.conflictCode === 'HEAT_SCHEDULE_CONFLICT') {
      const data = error.data as { conflicts?: HeatScheduleConflict[] } | null
      const conflicts = data?.conflicts || []
      const accepted = await confirmDialog('排程时间存在冲突', summary(record, proposal, furnaces, conflicts), '仍然调整')
      return accepted ? submit(record, proposal, furnaces, refresh, true) : false
    }
    if (error instanceof ApiRequestError && error.status === 409) {
      message.warning('数据已被其他终端更新，页面已刷新')
      await refresh()
      return false
    }
    message.error(error instanceof Error ? error.message : '排程调整失败')
    return false
  }
}

export async function openHeatScheduleAdjustment(record: HeatOrderReference, refresh: RefreshAction, proposed?: HeatScheduleProposal) {
  const latest = await fetchHeatOrder(record.id)
  if (latest.status !== 'WAITING') {
    message.warning('数据已被其他终端更新，页面已刷新')
    await refresh()
    return
  }
  const options = await fetchMeltPoolOptions(latest.materialGradeCode)
  const recipe = options.recipes.find((item) => item.code === latest.recipeCode)
  const furnaces = options.furnaces.filter((item) => item.workshopCode === latest.workshopCode
    && item.capacityKg >= latest.targetWeightKg
    && Boolean(recipe?.furnaceCodes.includes(item.code)))
  if (!furnaces.length) {
    message.error('当前炉次没有可用的兼容熔炉')
    return
  }

  if (proposed) {
    if (!furnaces.some((item) => item.code === proposed.furnaceCode)) {
      message.error('目标设备不适用于当前配方或容量不足')
      return
    }
    const accepted = await confirmDialog('确认调整炉次排程', summary(latest, proposed, furnaces))
    if (accepted) await submit(latest, proposed, furnaces, refresh)
    return
  }

  let proposal: HeatScheduleProposal = { furnaceCode: latest.furnaceCode, plannedStartAt: latest.plannedStartAt }
  const accepted = await confirmDialog('调整炉次排程', <AdjustmentForm record={latest} furnaces={furnaces} onChange={(value) => { proposal = value }} />)
  if (accepted) await submit(latest, proposal, furnaces, refresh)
}
