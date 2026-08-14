import { SearchOutlined, WarningOutlined } from '@ant-design/icons'
import { Button, Card, DatePicker, Empty, Progress, Select, Space, Tag, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router'
import { fetchEquipmentSchedule, fetchEquipmentScheduleWorkshops, heatStatusLabels, type EquipmentScheduleHeat, type EquipmentScheduleResult } from '../../utils/production'
import { hasPermission } from '../../utils/roles'
import { openHeatScheduleAdjustment } from './HeatScheduleAdjustment'
import { finishAtPreservingDuration, isDragMovement, minutesFromTrackX, scheduleStartAt } from './heatScheduleDrag'

interface Props {
  preferredWorkshopCode?: string
}

const deviceStatus = {
  IDLE: { label: '空闲', color: 'default' },
  WAITING: { label: '待生产', color: 'gold' },
  IN_PROGRESS: { label: '生产中', color: 'blue' },
  TRANSFERRING: { label: '转运中', color: 'purple' },
  SCHEDULED: { label: '当天有排程', color: 'cyan' },
} as const

interface DragSession {
  heat: EquipmentScheduleHeat
  sourceFurnaceCode: string
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
}

interface DragPreview {
  heat: EquipmentScheduleHeat
  furnaceCode: string
  startMinutes: number
  valid: boolean
}

export function EquipmentScheduleOverview({ preferredWorkshopCode }: Props) {
  const navigate = useNavigate()
  const [workshops, setWorkshops] = useState<Array<{ code: string; name: string }>>([])
  const [workshopCode, setWorkshopCode] = useState('')
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [result, setResult] = useState<EquipmentScheduleResult | null>(null)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const initialPreferredWorkshopRef = useRef(preferredWorkshopCode)
  const initialDateRef = useRef(date)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const trackRefs = useRef(new Map<string, HTMLDivElement>())
  const dragSessionRef = useRef<DragSession | null>(null)
  const dragPreviewRef = useRef<DragPreview | null>(null)
  const suppressClickRef = useRef('')
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const canAdjustSchedule = hasPermission('production.schedule.adjust')

  const loadSchedule = useCallback(async (nextWorkshopCode: string, nextDate: Dayjs) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const next = await fetchEquipmentSchedule(nextWorkshopCode, nextDate.format('YYYY-MM-DD'))
      if (requestIdRef.current === requestId) setResult(next)
    } catch (error) {
      if (requestIdRef.current === requestId) message.error(error instanceof Error ? error.message : '设备排程加载失败')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let canceled = false
    void fetchEquipmentScheduleWorkshops().then(async (nextWorkshops) => {
      if (canceled) return
      const initialPreferredWorkshop = initialPreferredWorkshopRef.current
      const nextCode = initialPreferredWorkshop && nextWorkshops.some((item) => item.code === initialPreferredWorkshop)
        ? initialPreferredWorkshop
        : nextWorkshops[0]?.code || ''
      setWorkshops(nextWorkshops)
      setWorkshopCode(nextCode)
      if (nextCode) await loadSchedule(nextCode, initialDateRef.current)
    }).catch((error) => {
      if (!canceled) message.error(error instanceof Error ? error.message : '熔炼车间加载失败')
    })
    return () => {
      canceled = true
      requestIdRef.current += 1
    }
  }, [loadSchedule])

  useEffect(() => {
    if (!preferredWorkshopCode || preferredWorkshopCode === workshopCode || !workshops.some((item) => item.code === preferredWorkshopCode)) return
    let canceled = false
    queueMicrotask(() => {
      if (canceled) return
      setWorkshopCode(preferredWorkshopCode)
      void loadSchedule(preferredWorkshopCode, date)
    })
    return () => { canceled = true }
  }, [date, loadSchedule, preferredWorkshopCode, workshopCode, workshops])

  const query = async () => {
    if (!workshopCode) return message.warning('请选择熔炼车间')
    await loadSchedule(workshopCode, date)
  }

  const refreshCurrent = useCallback(async () => {
    if (workshopCode) await loadSchedule(workshopCode, date)
  }, [date, loadSchedule, workshopCode])

  const updateDragPreview = (next: DragPreview | null) => {
    dragPreviewRef.current = next
    setDragPreview(next)
  }

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, heat: EquipmentScheduleHeat, sourceFurnaceCode: string) => {
    if (!canAdjustSchedule || heat.status !== 'WAITING') return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragSessionRef.current = { heat, sourceFurnaceCode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== event.pointerId || !result) return
    if (!session.dragging) {
      if (!isDragMovement(session.startX, session.startY, event.clientX, event.clientY)) return
      session.dragging = true
    }
    event.preventDefault()
    const scroller = timelineScrollRef.current
    if (scroller) {
      const bounds = scroller.getBoundingClientRect()
      if (event.clientX < bounds.left + 48) scroller.scrollLeft -= 28
      else if (event.clientX > bounds.right - 48) scroller.scrollLeft += 28
    }
    const sourceTrack = trackRefs.current.get(session.sourceFurnaceCode)
    if (!sourceTrack) return
    const sourceBounds = sourceTrack.getBoundingClientRect()
    const target = result.devices.find((device) => {
      const bounds = trackRefs.current.get(device.code)?.getBoundingClientRect()
      return Boolean(bounds && event.clientY >= bounds.top && event.clientY <= bounds.bottom)
    })
    if (!target) return updateDragPreview(null)
    const startMinutes = minutesFromTrackX(event.clientX, sourceBounds.left, sourceBounds.width)
    const valid = session.heat.compatibleFurnaceCodes.includes(target.code) && target.capacityKg >= session.heat.targetWeightKg
    updateDragPreview({ heat: session.heat, furnaceCode: target.code, startMinutes, valid })
  }

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const preview = dragPreviewRef.current
    dragSessionRef.current = null
    updateDragPreview(null)
    if (!session.dragging) return
    suppressClickRef.current = session.heat.id
    if (!preview?.valid || !result) {
      if (preview && !preview.valid) message.warning('目标设备不适用于当前配方或容量不足')
      return
    }
    const plannedStartAt = scheduleStartAt(result.windowStart, preview.startMinutes)
    void openHeatScheduleAdjustment({ id: session.heat.id }, refreshCurrent, { furnaceCode: preview.furnaceCode, plannedStartAt })
      .catch((error) => message.error(error instanceof Error ? error.message : '排程调整失败'))
  }

  const cancelDrag = () => {
    dragSessionRef.current = null
    updateDragPreview(null)
  }

  const windowStart = result ? new Date(result.windowStart).getTime() : 0
  const windowMinutes = 24 * 60
  return (
    <Card className="equipment-schedule-overview" title="设备排程概览" extra={
      <Space wrap>
        <Select value={workshopCode || undefined} placeholder="熔炼车间" style={{ width: 180 }} options={workshops.map((item) => ({ label: item.name, value: item.code }))} onChange={setWorkshopCode} />
        <DatePicker value={date} allowClear={false} onChange={(value) => value && setDate(value)} />
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void query()}>查询</Button>
      </Space>
    }>
      {!result ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择车间和日期后查询设备排程" /> : <>
        <div className="equipment-card-grid">
          {result.devices.map((device) => {
            const state = deviceStatus[device.status]
            const summary = device.summary
            return <div className="equipment-status-card" key={device.code}>
              <div className="equipment-status-head"><strong>{device.name}</strong><Space size={4}><Tag color={state.color}>{state.label}</Tag>{device.hasConflict && <Tag color="error" icon={<WarningOutlined />}>存在冲突</Tag>}</Space></div>
              <Typography.Text type="secondary">{device.code} · {device.capacity} {device.capacityUnit}</Typography.Text>
              {summary ? <div className="equipment-summary">
                <div><span>炉次</span><button type="button" onClick={() => navigate(`/dashboard/production/heat-orders/${summary.id}`)}>{summary.code}</button></div>
                <div><span>材质/目标</span><strong>{summary.materialGradeName} · {(summary.targetWeightKg / 1000).toFixed(2)} t</strong></div>
                <div className="equipment-utilization-row">
                  <span>炉次占比</span>
                  <div>
                    <Progress
                      percent={Math.min(100, summary.capacityUtilizationPercent)}
                      status={summary.capacityUtilizationPercent > 100 ? 'exception' : 'normal'}
                      format={() => `${summary.capacityUtilizationPercent.toFixed(1)}%`}
                    />
                    <Typography.Text type={summary.capacityUtilizationPercent > 100 ? 'danger' : 'secondary'}>
                      {(summary.targetWeightKg / 1000).toFixed(2)} t / {(device.capacityKg / 1000).toFixed(2)} t
                    </Typography.Text>
                  </div>
                </div>
                <div><span>计划区间</span><strong>{dayjs(summary.plannedStartAt).format('MM-DD HH:mm')} - {dayjs(summary.plannedFinishAt).format('MM-DD HH:mm')}</strong></div>
                <div><span>包含工单</span><strong>{summary.workOrders.map((item) => item.code).join('、') || '-'}</strong></div>
              </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={result.isToday ? '当前空闲' : '当天无排程'} />}
            </div>
          })}
        </div>
        <div className="equipment-timeline-scroll" ref={timelineScrollRef}>
          <div className="equipment-timeline" style={{ minWidth: 1500 }}>
            <div className="equipment-timeline-header"><span className="equipment-timeline-label">炉号</span><div className="equipment-hour-axis">{Array.from({ length: 25 }, (_, hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, '0')}:00</span>)}</div></div>
            {result.devices.map((device) => <div className="equipment-timeline-row" key={device.code}>
              <span className="equipment-timeline-label" title={device.name}>{device.name}</span>
              <div
                ref={(node) => { if (node) trackRefs.current.set(device.code, node); else trackRefs.current.delete(device.code) }}
                className={`equipment-timeline-track${dragPreview?.furnaceCode === device.code ? dragPreview.valid ? ' is-drag-target' : ' is-drag-invalid' : ''}`}
              >
                {device.heats.map((heat) => {
                  const start = (new Date(heat.visibleStartAt).getTime() - windowStart) / 60_000
                  const finish = (new Date(heat.visibleFinishAt).getTime() - windowStart) / 60_000
                  const draggable = canAdjustSchedule && heat.status === 'WAITING'
                  return <button
                    type="button"
                    key={heat.id}
                    className={`equipment-heat-block equipment-heat-${heat.status.toLowerCase()}${device.conflictHeatCodes.includes(heat.code) ? ' is-conflict' : ''}${draggable ? ' is-draggable' : ''}${dragPreview?.heat.id === heat.id ? ' is-drag-origin' : ''}`}
                    style={{ left: `${start / windowMinutes * 100}%`, width: `${Math.max((finish - start) / windowMinutes * 100, 0.5)}%` }}
                    title={`${heat.code} ${heat.materialGradeName} ${dayjs(heat.plannedStartAt).format('HH:mm')} - ${dayjs(heat.plannedFinishAt).format('HH:mm')}`}
                    onPointerDown={(event) => beginDrag(event, heat, device.code)}
                    onPointerMove={moveDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={cancelDrag}
                    onClick={(event) => {
                      if (suppressClickRef.current === heat.id) {
                        suppressClickRef.current = ''
                        event.preventDefault()
                        return
                      }
                      navigate(`/dashboard/production/heat-orders/${heat.id}`)
                    }}
                  >{heat.code}<small>{heatStatusLabels[heat.status]}</small></button>
                })}
                {dragPreview?.furnaceCode === device.code && (() => {
                  const nextStartAt = scheduleStartAt(result.windowStart, dragPreview.startMinutes)
                  const nextFinishAt = finishAtPreservingDuration(nextStartAt, dragPreview.heat.plannedStartAt, dragPreview.heat.plannedFinishAt)
                  const durationMinutes = (new Date(nextFinishAt).getTime() - new Date(nextStartAt).getTime()) / 60_000
                  return <div
                    className={`equipment-heat-drag-preview${dragPreview.valid ? '' : ' is-invalid'}`}
                    style={{ left: `${dragPreview.startMinutes / windowMinutes * 100}%`, width: `${Math.max(durationMinutes / windowMinutes * 100, 0.5)}%` }}
                  >{dragPreview.heat.code}<small>{dayjs(nextStartAt).format('HH:mm')} - {dayjs(nextFinishAt).format('HH:mm')}</small></div>
                })()}
              </div>
            </div>)}
          </div>
        </div>
      </>}
    </Card>
  )
}
