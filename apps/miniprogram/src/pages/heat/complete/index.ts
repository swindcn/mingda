import { completeHeatProduction } from '../../../services/api'

Page({
  data: { id: '', versionNo: 0, targetWeightKg: 0, transferTotalWeightKg: 0, actualOutputWeightKg: '', remark: '', submitting: false },
  onLoad(query: Record<string, string>) {
    const transferTotal = Number(query.transferTotal || 0)
    this.setData({ id: query.id || '', versionNo: Number(query.versionNo || 0), targetWeightKg: Number(query.target || 0), transferTotalWeightKg: transferTotal, actualOutputWeightKg: String(transferTotal || query.target || '') })
  },
  inputWeight(event: WechatMiniprogram.Input) { this.setData({ actualOutputWeightKg: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  async submit() {
    if (this.data.submitting) return
    const weight = Number(this.data.actualOutputWeightKg)
    if (!Number.isFinite(weight) || weight <= 0) { wx.showToast({ title: '请输入有效的实际出炉重量', icon: 'none' }); return }
    this.setData({ submitting: true })
    try { await completeHeatProduction(this.data.id, { versionNo: this.data.versionNo, actualOutputWeightKg: weight, remark: this.data.remark.trim() }); wx.showToast({ title: '生产已完成', icon: 'success' }); setTimeout(() => wx.navigateBack(), 600) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' }) } finally { this.setData({ submitting: false }) }
  },
})
