import { getCoreTasks } from '../../../services/api'
import { CoreTaskStatus, MobileCoreTaskSummary } from '../../../types/business'
import { createLatestRequestGate } from '../../../utils/latest-request'

const latestRequest = createLatestRequestGate()

const tabs: Array<{ key: CoreTaskStatus; label: string }> = [
  { key: 'WAITING', label: '待生产' },
  { key: 'IN_PROGRESS', label: '生产中' },
  { key: 'COMPLETED', label: '已完成' },
]

const labels: Record<CoreTaskStatus, string> = {
  PENDING_DISPATCH: '待派工', WAITING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELED: '已取消',
}

const tones: Record<CoreTaskStatus, string> = {
  PENDING_DISPATCH: 'muted', WAITING: 'waiting', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELED: 'muted',
}

function display(records: MobileCoreTaskSummary[]) {
  return [...records]
    .sort((left, right) => new Date(right.plannedStartAt || right.createdAt).getTime() - new Date(left.plannedStartAt || left.createdAt).getTime())
    .map((record) => ({
      ...record,
      statusText: labels[record.status],
      statusTone: tones[record.status],
      plannedStartText: record.plannedStartAt ? new Date(record.plannedStartAt).toLocaleString() : '-',
    }))
}

Page({
  data: { tabs, activeTab: 'WAITING' as CoreTaskStatus, records: [] as MobileCoreTaskSummary[], loading: false },
  onShow() { void this.loadRecords() },
  onUnload() { latestRequest.invalidate() },
  onPullDownRefresh() { void this.loadRecords().finally(() => wx.stopPullDownRefresh()) },
  async loadRecords() {
    const requestId = latestRequest.next()
    const status = this.data.activeTab
    this.setData({ loading: true })
    try {
      const records = await getCoreTasks(status)
      if (!latestRequest.isCurrent(requestId)) return
      this.setData({ records: display(records) })
    } catch (error) {
      if (!latestRequest.isCurrent(requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '制芯任务加载失败', icon: 'none' })
    } finally {
      if (latestRequest.isCurrent(requestId)) this.setData({ loading: false })
    }
  },
  changeTab(event: WechatMiniprogram.TouchEvent) {
    this.setData({ activeTab: event.currentTarget.dataset.key as CoreTaskStatus, records: [] })
    void this.loadRecords()
  },
  openDetail(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/core/detail/index?id=${event.currentTarget.dataset.id}` })
  },
})
