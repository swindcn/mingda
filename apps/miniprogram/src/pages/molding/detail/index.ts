import { getMoldingTaskDetail, startMoldingTask } from '../../../services/api'
import { MobileMoldingTask, MoldingDisplayStatus } from '../../../types/business'

const labels: Record<MoldingDisplayStatus, string> = { PENDING: '待派工', DISPATCHED: '已派工', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELED: '已取消' }

Page({
  data: { id: '', task: null as MobileMoldingTask | null, loading: false },
  onLoad(options: Record<string, string>) { this.setData({ id: options.id || '' }) },
  onShow() { if (this.data.id) void this.loadTask() },
  onPullDownRefresh() { void this.loadTask().finally(() => wx.stopPullDownRefresh()) },
  async loadTask() {
    this.setData({ loading: true })
    try { const task = await getMoldingTaskDetail(this.data.id); this.setData({ task: { ...task, statusText: labels[task.displayStatus] } }) }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '任务加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  startTask() {
    const task = this.data.task
    if (!task) return
    const warning = task.startWarning ? `${task.startWarning}。` : ''
    wx.showModal({ title: '确认开工', content: `${warning}确定开始 ${task.code} 吗？`, success: async (result) => {
      if (!result.confirm) return
      try { const next = await startMoldingTask(task.id, task.versionNo); this.setData({ task: { ...next, statusText: labels[next.displayStatus] } }); wx.showToast({ title: '已开始生产', icon: 'success' }) }
      catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '开工失败', icon: 'none' }); void this.loadTask() }
    } })
  },
  goReport() { wx.navigateTo({ url: `/pages/molding/report/index?id=${this.data.id}` }) },
})
