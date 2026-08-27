import { dryCoreBatches, getCoreDryingBatches, getCoreExecutionOptions } from '../../../services/api'
import { CoreExecutionOptions, CoreInventoryBatch } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'
import { isConflict } from '../../../utils/request'

interface DryPageRequestState {
  latestRequest?: LatestRequestGate
  unloaded?: boolean
}

function requestState(page: unknown) {
  return page as DryPageRequestState
}

function isRequestCurrent(state: DryPageRequestState, gate: LatestRequestGate, requestId: number) {
  return !state.unloaded && state.latestRequest === gate && gate.isCurrent(requestId)
}

function estimateExpiry(batch: CoreInventoryBatch | undefined) {
  if (!batch?.shelfLifeHours) return '未配置保质期'
  return new Date(Date.now() + batch.shelfLifeHours * 3_600_000).toLocaleString()
}

Page({
  data: {
    id: '', batches: [] as CoreInventoryBatch[], displayBatches: [] as Array<CoreInventoryBatch & { selected: boolean }>, options: null as CoreExecutionOptions | null,
    selectedBatchIds: [] as string[], selectedCount: 0, equipmentIndex: -1, equipmentCode: '',
    estimatedExpiresAt: '-', loading: false, submitting: false,
  },
  onLoad(query: Record<string, string>) {
    const state = requestState(this)
    state.latestRequest = createLatestRequestGate()
    state.unloaded = false
    this.setData({ id: query.id || '' })
    void this.loadData()
  },
  onUnload() {
    const state = requestState(this)
    state.unloaded = true
    state.latestRequest?.invalidate()
  },
  onPullDownRefresh() {
    const state = requestState(this)
    void this.loadData().finally(() => { if (!state.unloaded) wx.stopPullDownRefresh() })
  },
  async loadData() {
    const state = requestState(this)
    const gate = state.latestRequest
    if (state.unloaded || !gate || !this.data.id) return
    const requestId = gate.next()
    this.setData({ loading: true })
    try {
      const [batches, options] = await Promise.all([getCoreDryingBatches(this.data.id), getCoreExecutionOptions(this.data.id)])
      if (!isRequestCurrent(state, gate, requestId)) return
      const currentIds = new Set(this.data.selectedBatchIds)
      const selectedBatchIds = batches.filter((item) => currentIds.size ? currentIds.has(item.id) : true).map((item) => item.id)
      const selected = new Set(selectedBatchIds)
      const equipmentIndex = options.dryingEquipment.findIndex((item) => item.code === this.data.equipmentCode)
      this.setData({
        batches, displayBatches: batches.map((item) => ({ ...item, selected: selected.has(item.id) })),
        options, selectedBatchIds, selectedCount: selectedBatchIds.length,
        estimatedExpiresAt: this.estimateSelectedExpiry(batches, selectedBatchIds), equipmentIndex, equipmentCode: equipmentIndex >= 0 ? this.data.equipmentCode : '',
      })
    } catch (error) {
      if (!isRequestCurrent(state, gate, requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '烘干数据加载失败', icon: 'none' })
    } finally {
      if (isRequestCurrent(state, gate, requestId)) this.setData({ loading: false })
    }
  },
  estimateSelectedExpiry(batches: CoreInventoryBatch[], selectedBatchIds: string[]) {
    if (selectedBatchIds.length !== 1) return selectedBatchIds.length ? '多个批次以服务端计算为准' : '-'
    return estimateExpiry(batches.find((item) => item.id === selectedBatchIds[0]))
  },
  toggleBatch(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    const selected = new Set(this.data.selectedBatchIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    const selectedBatchIds = this.data.batches.filter((item) => selected.has(item.id)).map((item) => item.id)
    this.setData({
      selectedBatchIds,
      selectedCount: selectedBatchIds.length,
      displayBatches: this.data.batches.map((item) => ({ ...item, selected: selected.has(item.id) })),
      estimatedExpiresAt: this.estimateSelectedExpiry(this.data.batches, selectedBatchIds),
    })
  },
  selectEquipment(event: WechatMiniprogram.PickerChange) {
    const equipmentIndex = Number(event.detail.value)
    this.setData({ equipmentIndex, equipmentCode: this.data.options?.dryingEquipment[equipmentIndex]?.code || '' })
  },
  async submit() {
    const state = requestState(this)
    if (state.unloaded || this.data.submitting) return
    if (!this.data.selectedBatchIds.length) { wx.showToast({ title: '请选择待烘干批次', icon: 'none' }); return }
    if (!this.data.equipmentCode) { wx.showToast({ title: '请选择烘干设备', icon: 'none' }); return }
    const selected = this.data.batches.filter((item) => this.data.selectedBatchIds.includes(item.id))
    this.setData({ submitting: true })
    try {
      await dryCoreBatches({ equipmentCode: this.data.equipmentCode, batches: selected.map((item) => ({ id: item.id, versionNo: item.versionNo })) })
      if (state.unloaded) return
      wx.showToast({ title: '已确认烘干', icon: 'success' })
      setTimeout(() => { if (!state.unloaded) wx.navigateBack() }, 600)
    } catch (error) {
      if (state.unloaded) return
      if (isConflict(error)) {
        await this.loadData()
        if (state.unloaded) return
      }
      wx.showToast({ title: error instanceof Error ? error.message : '烘干失败，请刷新重试', icon: 'none' })
    } finally {
      if (!state.unloaded) this.setData({ submitting: false })
    }
  },
})
