import { FireOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Card, DatePicker, Empty, Form, InputNumber, Modal, Progress, Select, Space, Tabs, Tag, Typography, message } from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResizableTable } from '../../components/ResizableTable'
import { ApiRequestError } from '../../services/api'
import { checkHeatOrderConflicts, createHeatOrder, fetchMeltPool, fetchMeltPoolOptions, type HeatScheduleConflict, type MeltPoolGroup, type WorkOrderRecord } from '../../utils/production'
import { hasPermission } from '../../utils/roles'
import { EquipmentScheduleOverview } from './EquipmentScheduleOverview'

interface ScheduleForm {
  workshopCode: string
  furnaceCode: string
  recipeCode: string
  teamCode: string
  plannedStartAt: dayjs.Dayjs
  plannedFinishAt: dayjs.Dayjs
}

function roundWeight(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizeZero(value: number) {
  return Object.is(value, -0) ? 0 : value
}

function isFinitePositive(value: number) {
  return Number.isFinite(value) && value > 0
}

export function MeltSchedulingPage() {
  const [form] = Form.useForm<ScheduleForm>()
  const [groups, setGroups] = useState<MeltPoolGroup[]>([])
  const [materialCode, setMaterialCode] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [options, setOptions] = useState<Awaited<ReturnType<typeof fetchMeltPoolOptions>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [dataStale, setDataStale] = useState(false)
  const [loadError, setLoadError] = useState('')
  const mountedRef = useRef(false)
  const materialCodeRef = useRef('')
  const optionsRequestIdRef = useRef(0)
  const conflictRequestIdRef = useRef(0)
  const [conflicts, setConflicts] = useState<HeatScheduleConflict[]>([])
  const canCreate = hasPermission('production.schedule.create')
  const currentGroup = groups.find((group) => group.materialGradeCode === materialCode)
  const selectedWorkshopCode = Form.useWatch('workshopCode', form)
  const selectedFurnaceCode = Form.useWatch('furnaceCode', form)
  const selectedRecipeCode = Form.useWatch('recipeCode', form)
  const plannedStartAt = Form.useWatch('plannedStartAt', form)
  const plannedFinishAt = Form.useWatch('plannedFinishAt', form)
  const selectedFurnace = options?.furnaces.find((item) => item.code === selectedFurnaceCode)
  const selectedRecipe = options?.recipes.find((item) => item.code === selectedRecipeCode)

  const reconcileFormOptions = useCallback((nextOptions: Awaited<ReturnType<typeof fetchMeltPoolOptions>>) => {
    const workshopCode = form.getFieldValue('workshopCode')
    const validWorkshopCode = nextOptions.workshops.some((item) => item.code === workshopCode) ? workshopCode : undefined
    const furnaceCode = form.getFieldValue('furnaceCode')
    const furnace = nextOptions.furnaces.find((item) => item.code === furnaceCode && item.workshopCode === validWorkshopCode)
    if (!furnace) {
      form.setFieldsValue({ workshopCode: validWorkshopCode, furnaceCode: undefined, recipeCode: undefined, teamCode: undefined })
      return
    }

    const recipeCode = form.getFieldValue('recipeCode')
    const teamCode = form.getFieldValue('teamCode')
    form.setFieldsValue({
      recipeCode: nextOptions.recipes.some((recipe) => recipe.code === recipeCode && recipe.furnaceCodes.includes(furnace.code)) ? recipeCode : undefined,
      teamCode: nextOptions.teams.some((team) => team.code === teamCode && team.workshopCode === furnace.workshopCode) ? teamCode : undefined,
    })
  }, [form])

  const loadOptions = useCallback(async (code: string, requestId: number) => {
    try {
      const result = await fetchMeltPoolOptions(code)
      if (!mountedRef.current || optionsRequestIdRef.current !== requestId || materialCodeRef.current !== code) return
      reconcileFormOptions(result)
      setOptions(result)
      setDataStale(false)
    } catch (error) {
      if (!mountedRef.current || optionsRequestIdRef.current !== requestId || materialCodeRef.current !== code) return
      const errorMessage = error instanceof Error ? error.message : '排产选项加载失败'
      setLoadError(errorMessage)
      message.error(errorMessage)
    } finally {
      if (mountedRef.current && optionsRequestIdRef.current === requestId && materialCodeRef.current === code) setLoading(false)
    }
  }, [reconcileFormOptions])

  const refresh = useCallback(async () => {
    const requestId = ++optionsRequestIdRef.current
    setLoading(true)
    setDataStale(true)
    setLoadError('')
    try {
      const result = await fetchMeltPool()
      if (!mountedRef.current || optionsRequestIdRef.current !== requestId) return
      setGroups(result.groups)
      const currentMaterial = materialCodeRef.current
      const nextMaterial = result.groups.some((group) => group.materialGradeCode === currentMaterial) ? currentMaterial : result.groups[0]?.materialGradeCode || ''
      if (nextMaterial !== currentMaterial) {
        form.setFieldsValue({ workshopCode: undefined, furnaceCode: undefined, recipeCode: undefined, teamCode: undefined })
      }
      materialCodeRef.current = nextMaterial
      setMaterialCode(nextMaterial)
      setSelectedIds([])
      setQuantities({})
      setOptions(null)
      if (nextMaterial) await loadOptions(nextMaterial, requestId)
      else if (mountedRef.current && optionsRequestIdRef.current === requestId) {
        setDataStale(false)
        setLoading(false)
      }
    } catch (error) {
      if (!mountedRef.current || optionsRequestIdRef.current !== requestId) return
      const errorMessage = error instanceof Error ? error.message : '排产池加载失败'
      setLoadError(errorMessage)
      message.error(errorMessage)
      setLoading(false)
    }
  }, [form, loadOptions])

  useEffect(() => {
    if (!selectedRecipe?.durationConfigured || !plannedStartAt) return
    form.setFieldValue('plannedFinishAt', plannedStartAt.add(selectedRecipe.occupancyDurationMinutes, 'minute'))
    queueMicrotask(() => setConflicts([]))
  }, [form, plannedStartAt, selectedRecipe])

  useEffect(() => {
    if (!selectedFurnaceCode || !plannedStartAt || !plannedFinishAt || !plannedFinishAt.isAfter(plannedStartAt)) {
      queueMicrotask(() => setConflicts([]))
      return
    }
    const requestId = ++conflictRequestIdRef.current
    const timer = window.setTimeout(() => {
      void checkHeatOrderConflicts({ furnaceCode: selectedFurnaceCode, plannedStartAt: plannedStartAt.toISOString(), plannedFinishAt: plannedFinishAt.toISOString() })
        .then((result) => { if (conflictRequestIdRef.current === requestId) setConflicts(result.conflicts) })
        .catch(() => { if (conflictRequestIdRef.current === requestId) setConflicts([]) })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [plannedFinishAt, plannedStartAt, selectedFurnaceCode])

  useEffect(() => {
    mountedRef.current = true
    let canceled = false
    queueMicrotask(() => {
      if (!canceled) void refresh()
    })
    return () => {
      canceled = true
      mountedRef.current = false
      optionsRequestIdRef.current += 1
    }
  }, [refresh])

  const changeMaterial = useCallback(async (code: string) => {
    const requestId = ++optionsRequestIdRef.current
    materialCodeRef.current = code
    setMaterialCode(code)
    setSelectedIds([])
    setQuantities({})
    form.resetFields()
    setOptions(null)
    setLoading(true)
    setDataStale(true)
    setLoadError('')
    await loadOptions(code, requestId)
  }, [form, loadOptions])

  const selectedOrders = useMemo(() => (currentGroup?.orders || []).filter((order) => selectedIds.includes(order.id)), [currentGroup, selectedIds])
  const targetWeightKg = roundWeight(selectedOrders.reduce((sum, order) => {
    const quantity = Number(quantities[order.id])
    const unitGrossWeightKg = Number(order.unitGrossWeightKg)
    if (!isFinitePositive(quantity) || !isFinitePositive(unitGrossWeightKg)) return sum
    const allocationWeightKg = roundWeight(quantity * unitGrossWeightKg)
    const nextTotal = sum + allocationWeightKg
    return isFinitePositive(allocationWeightKg) && Number.isFinite(nextTotal) ? nextTotal : sum
  }, 0))
  const totalQuantity = selectedOrders.reduce((sum, order) => {
    const quantity = Number(quantities[order.id])
    const nextTotal = sum + quantity
    return isFinitePositive(quantity) && Number.isFinite(nextTotal) ? nextTotal : sum
  }, 0)
  const rawCapacityKg = Number(selectedFurnace?.capacityKg)
  const capacityKg = isFinitePositive(rawCapacityKg) ? rawCapacityKg : 0
  const remainingCapacityKg = normalizeZero(roundWeight(capacityKg - targetWeightKg))
  const isOverCapacity = capacityKg > 0 && remainingCapacityKg < 0
  const calculatedUtilization = capacityKg ? targetWeightKg / capacityKg * 100 : 0
  const utilization = Number.isFinite(calculatedUtilization) ? calculatedUtilization : 0
  const progressPercent = Math.min(100, Math.max(0, Number(utilization.toFixed(1))))
  const availableFurnaces = selectedWorkshopCode ? (options?.furnaces || []).filter((item) => item.workshopCode === selectedWorkshopCode) : []
  const availableRecipes = selectedFurnace
    ? (options?.recipes || []).filter((recipe) => recipe.furnaceCodes.includes(selectedFurnaceCode) && recipe.durationConfigured)
    : []
  const availableTeams = selectedFurnace
    ? (options?.teams || []).filter((team) => team.workshopCode === selectedFurnace.workshopCode)
    : []
  const unavailableReason = options && !options.furnaces.length ? options.unavailableReason : ''

  const generate = async () => {
    try {
      if (dataStale || loadError) throw new Error('排产数据尚未刷新成功，请点击查询重试')
      const values = await form.validateFields()
      if (!mountedRef.current) return
      if (!selectedOrders.length) throw new Error('请至少选择一张生产工单')
      const validWorkshop = options?.workshops.find((item) => item.code === values.workshopCode)
      if (!validWorkshop) throw new Error('所选熔炼车间已不可用，请重新选择')
      const validFurnace = options?.furnaces.find((item) => item.code === values.furnaceCode && item.workshopCode === values.workshopCode)
      if (!validFurnace) throw new Error('所选熔炼设备已不可用，请重新选择')
      if (!isFinitePositive(Number(validFurnace.capacityKg))) throw new Error('所选熔炼设备单炉容量无效，请检查设备配置')
      if (!availableRecipes.some((recipe) => recipe.code === values.recipeCode)) throw new Error('所选配方与当前熔炼设备不匹配，请重新选择')
      if (!availableTeams.some((team) => team.code === values.teamCode)) throw new Error('所选班组不属于设备所在车间，请重新选择')
      if (isOverCapacity) throw new Error(`当前组合超出单炉容量 ${Math.abs(remainingCapacityKg).toFixed(2)} kg`)
      if (selectedOrders.some((order) => {
        const quantity = Number(quantities[order.id])
        const remainingQuantity = Number(order.remainingQuantity)
        return !Number.isInteger(quantity) || !isFinitePositive(quantity) || !isFinitePositive(remainingQuantity) || quantity > remainingQuantity
      })) {
        throw new Error('本炉分配件数必须是大于 0 且不超过剩余件数的整数')
      }
      if (selectedOrders.some((order) => !isFinitePositive(Number(order.unitGrossWeightKg)))) {
        throw new Error('选中工单的单件浇注毛重异常，请检查工单数据')
      }
      if (selectedOrders.some((order) => !isFinitePositive(roundWeight(Number(quantities[order.id]) * Number(order.unitGrossWeightKg))))) {
        throw new Error('选中工单的目标铁水重量超出有效数值范围，请调整分配件数')
      }
      const payload = {
        materialGradeCode: materialCode,
        workshopCode: values.workshopCode,
        furnaceCode: values.furnaceCode,
        recipeCode: values.recipeCode,
        teamCode: values.teamCode,
        plannedStartAt: values.plannedStartAt.toISOString(),
        plannedFinishAt: values.plannedFinishAt.toISOString(),
        allocations: selectedOrders.map((order) => ({ workOrderId: order.id, quantity: quantities[order.id] })),
      }
      setSubmitting(true)
      let heat
      try {
        heat = await createHeatOrder(payload)
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 409 || error.conflictCode !== 'HEAT_SCHEDULE_CONFLICT') throw error
        const conflictRows = (error.data as { conflicts?: HeatScheduleConflict[] } | null)?.conflicts || []
        await new Promise<void>((resolve, reject) => Modal.confirm({
          title: '设备排程时间冲突',
          content: <div><p>目标设备在该时间段已有排程，是否仍然下达？</p>{conflictRows.map((item) => <div key={item.id}>{item.code}：{dayjs(item.plannedStartAt).format('MM-DD HH:mm')} - {dayjs(item.plannedFinishAt).format('MM-DD HH:mm')}</div>)}</div>,
          okText: '确认下达', cancelText: '取消', onOk: () => resolve(), onCancel: () => reject(new Error('已取消下达')),
        }))
        heat = await createHeatOrder({ ...payload, confirmScheduleConflict: true })
      }
      if (!mountedRef.current) return
      setSelectedIds([])
      setQuantities({})
      form.resetFields()
      setOptions(null)
      setDataStale(true)
      setLoading(true)
      message.success(`熔炼任务 ${heat.code} 已下发`)
      await refresh()
    } catch (error) {
      if (mountedRef.current && error instanceof Error) message.error(error.message)
    } finally {
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const columns: TableColumnsType<WorkOrderRecord> = [
    { title: '工单编号', dataIndex: 'code', key: 'code', width: 145 },
    { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 150 },
    { title: '剩余件数', dataIndex: 'remainingQuantity', key: 'remainingQuantity', width: 90, render: (value: number) => `${value} 件` },
    { title: '剩余铁水', dataIndex: 'remainingWeightKg', key: 'remainingWeightKg', width: 105, render: (value: number) => `${value} kg` },
    { title: '计划交期', dataIndex: 'plannedDeliveryDate', key: 'plannedDeliveryDate', width: 105 },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, render: (value: string) => value === 'URGENT' ? <Tag color="red">紧急</Tag> : <Tag>普通</Tag> },
    {
      title: '本炉分配', key: 'quantity', width: 115,
      render: (_, order) => <InputNumber disabled={!selectedIds.includes(order.id)} min={1} max={order.remainingQuantity} precision={0} value={quantities[order.id]} placeholder="件数" onChange={(value) => setQuantities((current) => ({ ...current, [order.id]: Number(value || 0) }))} />,
    },
  ]

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">合炉排产</h1><p className="page-description">按材质隔离待排需求，按整数件数拆分并组合为熔炼任务。</p></div>
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void refresh()}>查询</Button>
      </div>
      {loadError && <Alert className="melt-load-error" type="error" showIcon message="排产数据加载失败" description={loadError} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}
      {!groups.length ? <Card loading={loading && !loadError}>{loadError ? <Empty description="加载失败，请重试" /> : <Empty description="暂无待排产工单" />}</Card> : <>
        <Tabs activeKey={materialCode} onChange={(code) => void changeMaterial(code)} items={groups.map((group) => ({ key: group.materialGradeCode, label: `${group.materialGradeName}（待排 ${(group.remainingWeightKg / 1000).toFixed(2)} t）` }))} />
        <div className="melt-scheduling-layout">
          <Card className="melt-pool-panel">
            <ResizableTable
              storageKey="melt-pool-widths"
              rowKey="id"
              columns={columns}
              dataSource={currentGroup?.orders || []}
              loading={loading}
              pagination={false}
              rowSelection={{
                selectedRowKeys: selectedIds,
                onChange: (keys) => {
                  const ids = keys.map(String)
                  setSelectedIds(ids)
                  setQuantities((current) => Object.fromEntries(ids.map((id) => [id, current[id] || currentGroup?.orders.find((order) => order.id === id)?.remainingQuantity || 0])))
                },
              }}
            />
          </Card>
          <Card title="排产凑吨计算器" className="melt-calculator-panel">
            <Form form={form} layout="vertical" className="melt-calculator-form">
              <Form.Item name="workshopCode" label="熔炼车间" rules={[{ required: true, message: '请选择熔炼车间' }]}>
                <Select showSearch optionFilterProp="label" placeholder="请选择车间" options={(options?.workshops || []).map((item) => ({ label: `${item.name}（${item.code}）`, value: item.code }))} onChange={() => form.setFieldsValue({ furnaceCode: undefined, recipeCode: undefined, teamCode: undefined })} />
              </Form.Item>
              <Form.Item
                name="furnaceCode"
                label="目标熔炼设备"
                rules={[{ required: true, message: '请选择熔炼设备' }]}
                extra={unavailableReason ? <Typography.Text type="danger">{unavailableReason}</Typography.Text> : undefined}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  loading={loading}
                  placeholder="请选择设备"
                  notFoundContent={unavailableReason || '暂无可用熔炼设备'}
                  options={availableFurnaces.map((item) => ({
                    label: `${item.name}（${isFinitePositive(Number(item.capacityKg)) ? `${(item.capacityKg / 1000).toFixed(2)} t/炉` : '容量无效'}）`,
                    value: item.code,
                  }))}
                  onChange={() => form.setFieldsValue({ recipeCode: undefined, teamCode: undefined })}
                />
              </Form.Item>
              <Form.Item name="recipeCode" label="选用配方" rules={[{ required: true, message: '请选择配方' }]} extra={selectedFurnace && !availableRecipes.length ? <Typography.Text type="danger">当前设备的已生效配方尚未维护标准时长，请先停用配方并补充时长。</Typography.Text> : undefined}>
                <Select placeholder="请选择已配置时长的生效配方" options={availableRecipes.map((item) => ({ label: `${item.name} / ${item.version}（${item.occupancyDurationMinutes} 分钟）`, value: item.code }))} />
              </Form.Item>
              <Form.Item name="teamCode" label="执行班组" rules={[{ required: true, message: '请选择执行班组' }]}>
                <Select placeholder="请选择设备车间班组" options={availableTeams.map((item) => ({ label: `${item.name}（${item.workshopName}）`, value: item.code }))} />
              </Form.Item>
              <Form.Item name="plannedStartAt" label="计划开始时间" rules={[{ required: true, message: '请选择计划开始时间' }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="plannedFinishAt" label="预计完成时间" rules={[{ required: true, message: '请选择预计完成时间' }, { validator: (_, value) => !value || !plannedStartAt || value.isAfter(plannedStartAt) ? Promise.resolve() : Promise.reject(new Error('预计完成时间必须晚于计划开始时间')) }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
              {selectedRecipe && <div className="melt-duration-summary"><Space wrap size="small"><Tag>熔炼 {selectedRecipe.meltingDurationMinutes} 分钟</Tag><Tag>转运 {selectedRecipe.transferDurationMinutes} 分钟</Tag><Tag>清炉 {selectedRecipe.cleaningDurationMinutes} 分钟</Tag><Tag color="blue">合计 {selectedRecipe.occupancyDurationMinutes} 分钟</Tag></Space></div>}
              {conflicts.length > 0 && <Alert type="warning" showIcon message={`当前时间段与 ${conflicts.length} 个炉次冲突`} description={conflicts.map((item) => `${item.code}（${dayjs(item.plannedStartAt).format('HH:mm')} - ${dayjs(item.plannedFinishAt).format('HH:mm')}）`).join('、')} />}
            </Form>
            <div className="melt-calculator-summary">
              <div><Typography.Text type="secondary">已选工单</Typography.Text><strong>{selectedOrders.length} 张</strong></div>
              <div><Typography.Text type="secondary">分配件数</Typography.Text><strong>{totalQuantity} 件</strong></div>
              <div><Typography.Text type="secondary">目标铁水</Typography.Text><strong>{targetWeightKg.toFixed(2)} kg</strong></div>
              <div><Typography.Text type="secondary">单炉容量</Typography.Text><strong>{capacityKg ? `${capacityKg.toFixed(2)} kg` : '-'}</strong></div>
              <div>
                <Typography.Text type="secondary">剩余产能</Typography.Text>
                <Typography.Text strong type={isOverCapacity ? 'danger' : undefined}>{capacityKg ? `${remainingCapacityKg.toFixed(2)} kg` : '-'}</Typography.Text>
              </div>
            </div>
            <Progress percent={progressPercent} status={isOverCapacity ? 'exception' : 'normal'} format={() => capacityKg ? `${utilization.toFixed(1)}%` : '-'} />
            {isOverCapacity && <Typography.Text type="danger">当前组合超出单炉容量 {Math.abs(remainingCapacityKg).toFixed(2)} kg，请减少分配件数。</Typography.Text>}
            {canCreate && <Button type="primary" block icon={<FireOutlined />} disabled={loading || dataStale || Boolean(loadError) || !selectedOrders.length || !capacityKg || isOverCapacity} loading={submitting} onClick={() => void generate()}>生成熔炼任务</Button>}
          </Card>
        </div>
      </>}
      <EquipmentScheduleOverview preferredWorkshopCode={selectedWorkshopCode} />
    </>
  )
}
