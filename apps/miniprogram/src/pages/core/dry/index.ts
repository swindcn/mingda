import { dryCoreBatch, getCoreDryingBatches, getCoreExecutionOptions } from '../../../services/api'
import { CoreExecutionOptions, CoreInventoryBatch } from '../../../types/business'

function estimateExpiry(batch: CoreInventoryBatch | undefined) {
  if (!batch?.shelfLifeHours) return '未配置保质期'
  return new Date(Date.now() + batch.shelfLifeHours * 3_600_000).toLocaleString()
}

Page({
  data: {
    id: '', batches: [] as CoreInventoryBatch[], options: null as CoreExecutionOptions | null,
    batchIndex: -1, batchId: '', versionNo: 0, equipmentIndex: -1, equipmentCode: '',
    estimatedExpiresAt: '-', loading: false, submitting: false,
  },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || '' }); void this.loadData() },
  onPullDownRefresh() { void this.loadData().finally(() => wx.stopPullDownRefresh()) },
  async loadData() {
    if (!this.data.id) return
    this.setData({ loading: true })
    try {
      const [batches, options] = await Promise.all([getCoreDryingBatches(this.data.id), getCoreExecutionOptions(this.data.id)])
      const selected = batches.find((item) => item.id === this.data.batchId) || batches[0]
      const batchIndex = selected ? batches.findIndex((item) => item.id === selected.id) : -1
      const equipmentIndex = options.dryingEquipment.findIndex((item) => item.code === this.data.equipmentCode)
      this.setData({
        batches, options, batchIndex, batchId: selected?.id || '', versionNo: selected?.versionNo || 0,
        estimatedExpiresAt: estimateExpiry(selected), equipmentIndex, equipmentCode: equipmentIndex >= 0 ? this.data.equipmentCode : '',
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '烘干数据加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  selectBatch(event: WechatMiniprogram.TouchEvent) {
    const batchIndex = Number(event.currentTarget.dataset.index)
    const batch = this.data.batches[batchIndex]
    if (batch) this.setData({ batchIndex, batchId: batch.id, versionNo: batch.versionNo, estimatedExpiresAt: estimateExpiry(batch) })
  },
  selectEquipment(event: WechatMiniprogram.PickerChange) {
    const equipmentIndex = Number(event.detail.value)
    this.setData({ equipmentIndex, equipmentCode: this.data.options?.dryingEquipment[equipmentIndex]?.code || '' })
  },
  async submit() {
    if (this.data.submitting) return
    if (!this.data.batchId) { wx.showToast({ title: '请选择待烘干批次', icon: 'none' }); return }
    if (!this.data.equipmentCode) { wx.showToast({ title: '请选择烘干设备', icon: 'none' }); return }
    this.setData({ submitting: true })
    try {
      await dryCoreBatch(this.data.batchId, { versionNo: this.data.versionNo, equipmentCode: this.data.equipmentCode })
      wx.showToast({ title: '已确认烘干', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '烘干失败，请刷新重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
