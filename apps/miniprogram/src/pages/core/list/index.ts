import { getCoreTasks } from '../../../services/api'
import { CoreTaskStatus, MobileCoreTaskSummary } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'

interface ListPageRequestState {
  latestRequest?: LatestRequestGate
  unloaded?: boolean
}

function requestState(page: unknown) {
  return page as ListPageRequestState
}

function isRequestCurrent(state: ListPageRequestState, gate: LatestRequestGate, requestId: number) {
  return !state.unloaded && state.latestRequest === gate && gate.isCurrent(requestId)
}

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
  onLoad() {
    const state = requestState(this)
    state.latestRequest = createLatestRequestGate()
    state.unloaded = false
  },
  onShow() { void this.loadRecords() },
  onUnload() {
    const state = requestState(this)
    state.unloaded = true
    state.latestRequest?.invalidate()
  },
  onPullDownRefresh() {
    const state = requestState(this)
    void this.loadRecords().finally(() => { if (!state.unloaded) wx.stopPullDownRefresh() })
  },
  async loadRecords() {
    const state = requestState(this)
    const gate = state.latestRequest
    if (state.unloaded || !gate) return
    const requestId = gate.next()
    const status = this.data.activeTab
    this.setData({ loading: true })
    try {
      const records = await getCoreTasks(status)
      if (!isRequestCurrent(state, gate, requestId)) return
      this.setData({ records: display(records) })
    } catch (error) {
      if (!isRequestCurrent(state, gate, requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '制芯任务加载失败', icon: 'none' })
    } finally {
      if (isRequestCurrent(state, gate, requestId)) this.setData({ loading: false })
    }
  },
  changeTab(event: WechatMiniprogram.TouchEvent) {
    if (requestState(this).unloaded) return
    this.setData({ activeTab: event.currentTarget.dataset.key as CoreTaskStatus, records: [] })
    void this.loadRecords()
  },
  openDetail(event: WechatMiniprogram.TouchEvent) {
    if (requestState(this).unloaded) return
    wx.navigateTo({ url: `/pages/core/detail/index?id=${event.currentTarget.dataset.id}` })
  },
})
