import { getCoreTasks } from '../../../services/api'
import { CoreTaskStatus, MobileCoreTask } from '../../../types/business'

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

function display(records: MobileCoreTask[]) {
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
  data: { tabs, activeTab: 'WAITING' as CoreTaskStatus, records: [] as MobileCoreTask[], loading: false },
  onShow() { void this.loadRecords() },
  onPullDownRefresh() { void this.loadRecords().finally(() => wx.stopPullDownRefresh()) },
  async loadRecords() {
    this.setData({ loading: true })
    try {
      this.setData({ records: display(await getCoreTasks(this.data.activeTab)) })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '制芯任务加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
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
