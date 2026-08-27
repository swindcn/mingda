import { getInspectionTasks } from '../../../services/api'
import { InspectionTaskStatus, InspectionTaskSummary } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'

interface PageState { latestRequest?: LatestRequestGate; unloaded?: boolean }
const stateOf = (page: unknown) => page as PageState
const current = (state: PageState, gate: LatestRequestGate, id: number) => !state.unloaded && state.latestRequest === gate && gate.isCurrent(id)
const tabs: Array<{ key: 'ALL' | InspectionTaskStatus; label: string }> = [
  { key: 'ALL', label: '全部' }, { key: 'WAITING', label: '待检验' }, { key: 'INSPECTING', label: '检验中' }, { key: 'REWORKING', label: '返修中' }, { key: 'COMPLETED', label: '已完成' },
]
const statusMeta: Record<InspectionTaskStatus, { text: string; tone: string }> = {
  WAITING: { text: '待检验', tone: 'warning' }, INSPECTING: { text: '检验中', tone: 'active' }, REWORKING: { text: '返修中', tone: 'pending' }, COMPLETED: { text: '已完成', tone: 'done' },
}

Page({
  data: { tabs, activeStatus: 'ALL', keyword: '', records: [] as InspectionTaskSummary[], page: 1, pageSize: 20, total: 0, loading: false, loadingMore: false },
  onLoad() { const state = stateOf(this); state.latestRequest = createLatestRequestGate(); state.unloaded = false; void this.loadRecords(true) },
  onUnload() { const state = stateOf(this); state.unloaded = true; state.latestRequest?.invalidate() },
  onPullDownRefresh() { void this.loadRecords(true).finally(() => wx.stopPullDownRefresh()) },
  onReachBottom() { if (!this.data.loading && !this.data.loadingMore && this.data.records.length < this.data.total) void this.loadRecords(false) },
  inputKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }) },
  search() { void this.loadRecords(true) },
  changeTab(event: WechatMiniprogram.TouchEvent) { this.setData({ activeStatus: String(event.currentTarget.dataset.status) }); void this.loadRecords(true) },
  scanCode() { wx.scanCode({ onlyFromCamera: false, success: (result) => { this.setData({ keyword: result.result.trim() }); void this.loadRecords(true) } }) },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/inspection/detail/index?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}` }) },
  async loadRecords(reset: boolean) {
    const state = stateOf(this); const gate = state.latestRequest; if (!gate || state.unloaded) return
    const requestId = gate.next(); const page = reset ? 1 : this.data.page + 1
    this.setData(reset ? { loading: true } : { loadingMore: true })
    try {
      const result = await getInspectionTasks({ keyword: this.data.keyword.trim() || undefined, status: this.data.activeStatus, page, pageSize: this.data.pageSize })
      if (!current(state, gate, requestId)) return
      const next = result.records.map((row) => ({ ...row, statusText: statusMeta[row.status].text, statusTone: statusMeta[row.status].tone }))
      this.setData({ records: reset ? next : [...this.data.records, ...next], total: result.total, page: result.page, pageSize: result.pageSize })
    } catch (error) { if (current(state, gate, requestId)) wx.showToast({ title: error instanceof Error ? error.message : '终检任务加载失败', icon: 'none' }) }
    finally { if (current(state, gate, requestId)) this.setData({ loading: false, loadingMore: false }) }
  },
})
