import { getInspectionTask } from '../../../services/api'
import { CleaningReworkTask, InspectionTaskDetail, InspectionTaskStatus } from '../../../types/business'

const statusLabels: Record<InspectionTaskStatus, string> = { WAITING: '待检验', INSPECTING: '检验中', REWORKING: '返修中', COMPLETED: '已完成' }
function taskStatus(detail: InspectionTaskDetail): InspectionTaskStatus {
  if (detail.options.openReworkQuantity > 0) return 'REWORKING'
  if (detail.options.remainingQuantity <= 0) return 'COMPLETED'
  return detail.inspectionReports.some((item) => item.status === 'ACTIVE') ? 'INSPECTING' : 'WAITING'
}

Page({
  data: { id: '', detail: null as (InspectionTaskDetail & { statusText: string }) | null, loading: false },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || '' }); void this.loadDetail() },
  onShow() { if (this.data.detail) void this.loadDetail() },
  onPullDownRefresh() { void this.loadDetail().finally(() => wx.stopPullDownRefresh()) },
  async loadDetail() { if (!this.data.id) return; this.setData({ loading: true }); try { const detail = await getInspectionTask(this.data.id); this.setData({ detail: { ...detail, statusText: statusLabels[taskStatus(detail)] } }) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '详情加载失败', icon: 'none' }) } finally { this.setData({ loading: false }) } },
  goReport() { if (this.data.detail?.options.allowedActions.report) wx.navigateTo({ url: `/pages/inspection/report/index?id=${encodeURIComponent(this.data.id)}` }) },
  goRework(event: WechatMiniprogram.TouchEvent) { const task = this.data.detail?.cleaningReworkTasks.find((item: CleaningReworkTask) => item.id === String(event.currentTarget.dataset.id)); if (task?.allowedActions?.report && task.remainingQuantity > 0) wx.navigateTo({ url: `/pages/inspection/rework-report/index?id=${encodeURIComponent(task.id)}` }) },
  previewImage(event: WechatMiniprogram.TouchEvent) { const url = String(event.currentTarget.dataset.url || ''); if (url) wx.previewImage({ current: url, urls: [url] }) },
})
