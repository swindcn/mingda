import { getMoldingDefects, getMoldingTaskDetail, reportMoldingTask } from '../../../services/api'
import { MobileMoldingTask, MoldingDefectOption } from '../../../types/business'

interface DefectRow { defectCode: string; defectName: string; quantity: number; remark: string; selectedIndex: number }
function makeRequestId() { return `molding-${Date.now()}-${Math.random().toString(36).slice(2)}` }

Page({
  data: { id: '', task: null as MobileMoldingTask | null, defectOptions: [] as MoldingDefectOption[], defectRows: [] as DefectRow[], goodQty: 0, scrapQty: 0, finishTask: true, earlyCompletionReason: '', remark: '', requestId: '', submitting: false },
  async onLoad(options: Record<string, string>) {
    const id = options.id || ''
    this.setData({ id, requestId: makeRequestId() })
    try {
      const [task, defectOptions] = await Promise.all([getMoldingTaskDetail(id), getMoldingDefects(id)])
      const remaining = Math.max(0, task.planBoxQty - task.completedGoodQty)
      const available = task.readiness.maxProducibleBoxQty === null ? remaining : Math.min(remaining, task.readiness.maxProducibleBoxQty)
      this.setData({ task, defectOptions, goodQty: available, finishTask: available >= remaining })
    }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '报工信息加载失败', icon: 'none' }) }
  },
  setQuantities(goodQty: number, scrapQty: number) {
    const nextGoodQty = Math.max(0, goodQty)
    const nextScrapQty = Math.max(0, scrapQty)
    this.setData({
      goodQty: nextGoodQty,
      scrapQty: nextScrapQty,
      ...(nextGoodQty + nextScrapQty === 0 ? { finishTask: true } : {}),
    })
  },
  adjustGood(event: WechatMiniprogram.TouchEvent) { this.setQuantities(this.data.goodQty + Number(event.currentTarget.dataset.delta || 0), this.data.scrapQty) },
  adjustScrap(event: WechatMiniprogram.TouchEvent) { this.setQuantities(this.data.goodQty, this.data.scrapQty + Number(event.currentTarget.dataset.delta || 0)) },
  inputGood(event: WechatMiniprogram.Input) { this.setQuantities(Number(event.detail.value || 0), this.data.scrapQty) },
  inputScrap(event: WechatMiniprogram.Input) { this.setQuantities(this.data.goodQty, Number(event.detail.value || 0)) },
  fillRemaining() {
    const task = this.data.task
    if (!task) return
    const remaining = Math.max(0, task.planBoxQty - task.completedGoodQty)
    const available = task.readiness.maxProducibleBoxQty === null ? remaining : Math.min(remaining, task.readiness.maxProducibleBoxQty)
    this.setData({ goodQty: available, finishTask: available >= remaining })
  },
  changeFinish(event: WechatMiniprogram.TouchEvent) {
    const finishTask = event.currentTarget.dataset.value === 'finish'
    if (!finishTask && this.data.goodQty + this.data.scrapQty === 0) {
      wx.showToast({ title: '零数量报工仅用于结束任务', icon: 'none' })
      return
    }
    this.setData({ finishTask })
  },
  inputEarlyReason(event: WechatMiniprogram.Input) { this.setData({ earlyCompletionReason: event.detail.value }) },
  inputRemark(event: WechatMiniprogram.Input) { this.setData({ remark: event.detail.value }) },
  addDefect() { this.setData({ defectRows: [...this.data.defectRows, { defectCode: '', defectName: '', quantity: 1, remark: '', selectedIndex: -1 }] }) },
  removeDefect(event: WechatMiniprogram.TouchEvent) { const rows = [...this.data.defectRows]; rows.splice(Number(event.currentTarget.dataset.index), 1); this.setData({ defectRows: rows }) },
  chooseDefect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); const selectedIndex = Number(event.detail.value); const option = this.data.defectOptions[selectedIndex]; const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], selectedIndex, defectCode: option.code, defectName: option.name }; this.setData({ defectRows: rows }) },
  inputDefectQty(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], quantity: Math.max(1, Number(event.detail.value || 1)) }; this.setData({ defectRows: rows }) },
  inputDefectRemark(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); const rows = [...this.data.defectRows]; rows[index] = { ...rows[index], remark: event.detail.value }; this.setData({ defectRows: rows }) },
  async submit() {
    const task = this.data.task
    if (!task || this.data.submitting) return
    const reportQuantity = this.data.goodQty + this.data.scrapQty
    if (reportQuantity === 0 && !this.data.finishTask) return wx.showToast({ title: '零数量报工仅用于结束任务', icon: 'none' })
    if (reportQuantity === 0 && !this.data.earlyCompletionReason.trim()) return wx.showToast({ title: '零数量结束任务必须填写结束原因', icon: 'none' })
    const defectTotal = this.data.defectRows.reduce((sum, item) => sum + item.quantity, 0)
    if (this.data.scrapQty > 0 && (!this.data.defectRows.length || this.data.defectRows.some((item) => !item.defectCode))) return wx.showToast({ title: '请选择废品缺陷', icon: 'none' })
    if (defectTotal !== this.data.scrapQty) return wx.showToast({ title: '缺陷数量合计需等于废品数', icon: 'none' })
    const nextGood = task.completedGoodQty + this.data.goodQty
    if (this.data.finishTask && nextGood < task.planBoxQty && !this.data.earlyCompletionReason.trim()) return wx.showToast({ title: '请填写提前结束原因', icon: 'none' })
    const extra = nextGood > task.planBoxQty ? `，将超产 ${nextGood - task.planBoxQty} 箱` : ''
    wx.showModal({ title: '确认提交报工', content: `合格 ${this.data.goodQty} 箱，废品 ${this.data.scrapQty} 箱${extra}，确定提交？`, success: async (result) => {
      if (!result.confirm) return
      this.setData({ submitting: true })
      try {
        await reportMoldingTask(task.id, { versionNo: task.versionNo, requestId: this.data.requestId, goodQty: this.data.goodQty, scrapQty: this.data.scrapQty, finishTask: this.data.finishTask, earlyCompletionReason: this.data.earlyCompletionReason.trim() || undefined, defects: this.data.defectRows.map((item) => ({ defectCode: item.defectCode, quantity: item.quantity, remark: item.remark.trim() || undefined })), remark: this.data.remark.trim() || undefined })
        wx.showToast({ title: '报工成功', icon: 'success' }); setTimeout(() => wx.navigateBack(), 600)
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '报工失败', icon: 'none' }) }
      finally { this.setData({ submitting: false }) }
    } })
  },
})
