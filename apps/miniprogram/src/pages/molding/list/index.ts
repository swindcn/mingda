import { getMoldingTaskByCode, getMoldingTasks } from '../../../services/api'
import { MobileMoldingTask, MoldingDisplayStatus } from '../../../types/business'

const tabs: Array<{ key: MoldingDisplayStatus; label: string }> = [
  { key: 'PENDING', label: '待派工' }, { key: 'DISPATCHED', label: '已派工' }, { key: 'IN_PROGRESS', label: '生产中' }, { key: 'COMPLETED', label: '已完成' }, { key: 'CANCELED', label: '已取消' },
]
const labels: Record<MoldingDisplayStatus, string> = { PENDING: '待派工', DISPATCHED: '已派工', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELED: '已取消' }
const tones: Record<MoldingDisplayStatus, string> = { PENDING: 'pending', DISPATCHED: 'primary', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELED: 'muted' }

function display(records: MobileMoldingTask[], activeTab: MoldingDisplayStatus) {
  return records.filter((record) => record.displayStatus === activeTab).map((record) => ({
    ...record,
    statusText: labels[record.displayStatus],
    statusTone: tones[record.displayStatus],
    readinessText: record.readiness.ready ? '已齐套' : record.readiness.startable ? `部分齐套 · 可生产${record.readiness.maxProducibleBoxQty}箱` : '未齐套',
    readinessTone: record.readiness.ready ? 'success' : 'warning',
  }))
}

Page({
  data: { tabs, activeTab: 'DISPATCHED' as MoldingDisplayStatus, records: [] as MobileMoldingTask[], taskCode: '', loading: false },
  onShow() { void this.loadRecords() },
  onPullDownRefresh() { void this.loadRecords().finally(() => wx.stopPullDownRefresh()) },
  async loadRecords() {
    this.setData({ loading: true })
    try {
      this.setData({ records: display(await getMoldingTasks(this.data.activeTab), this.data.activeTab) })
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '任务加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  changeTab(event: WechatMiniprogram.TouchEvent) { this.setData({ activeTab: event.currentTarget.dataset.key, records: [] }); void this.loadRecords() },
  inputCode(event: WechatMiniprogram.Input) { this.setData({ taskCode: event.detail.value.trim() }) },
  async searchCode() {
    if (!this.data.taskCode) return wx.showToast({ title: '请输入派工单号', icon: 'none' })
    try { const task = await getMoldingTaskByCode(this.data.taskCode); wx.navigateTo({ url: `/pages/molding/detail/index?id=${task.id}` }) }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '派工单不存在', icon: 'none' }) }
  },
  scanCode() {
    wx.scanCode({ onlyFromCamera: false, success: (result) => { this.setData({ taskCode: result.result.trim() }); void this.searchCode() } })
  },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/molding/detail/index?id=${event.currentTarget.dataset.id}` }) },
})
