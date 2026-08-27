import { getShakeCleanTasks } from '../../../services/api'
import { MobileShakeCleanTask, ShakeCleanExecutionStatus } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'
import { mergeUniqueById } from '../../../utils/shake-clean'

interface PageState { latestRequest?: LatestRequestGate; unloaded?: boolean }
const stateOf = (page: unknown) => page as PageState
const current = (state: PageState, gate: LatestRequestGate, id: number) => !state.unloaded && state.latestRequest === gate && gate.isCurrent(id)

const PAGE_SIZE = 20
const tabs: Array<{ key: 'ALL' | ShakeCleanExecutionStatus; label: string }> = [
  { key: 'ALL', label: '全部' }, { key: 'WAITING_POURING', label: '等待后续浇注' }, { key: 'WAITING_SHAKE', label: '待落砂' }, { key: 'SHAKING', label: '落砂中' },
  { key: 'WAITING_CLEANING', label: '待清理' }, { key: 'CLEANING', label: '清理中' }, { key: 'COMPLETED', label: '已完成' },
]
const statusMeta: Record<ShakeCleanExecutionStatus, { text: string; tone: string }> = {
  WAITING_SHAKE: { text: '待落砂', tone: 'warning' }, SHAKING: { text: '落砂中', tone: 'active' },
  WAITING_CLEANING: { text: '待清理', tone: 'warning' }, CLEANING: { text: '清理中', tone: 'active' },
  WAITING_POURING: { text: '等待后续浇注', tone: 'muted' }, COMPLETED: { text: '已完成', tone: 'success' },
}
function display(record: MobileShakeCleanTask) { const meta = statusMeta[record.executionStatus]; return { ...record, statusText: meta.text, statusTone: meta.tone } }

Page({
  data: { tabs, activeStatus: 'ALL', keyword: '', records: [] as MobileShakeCleanTask[], page: 1, pageSize: PAGE_SIZE, total: 0, nextCursor: null as string | null, loading: false, loadingMore: false },
  onLoad() { const state = stateOf(this); state.latestRequest = createLatestRequestGate(); state.unloaded = false; void this.loadRecords(true) },
  onUnload() { const state = stateOf(this); state.unloaded = true; state.latestRequest?.invalidate() },
  onPullDownRefresh() { const state = stateOf(this); void this.loadRecords(true).finally(() => { if (!state.unloaded) wx.stopPullDownRefresh() }) },
  onReachBottom() { if (!this.data.loading && !this.data.loadingMore && this.data.nextCursor) void this.loadRecords(false) },
  inputKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }) },
  search() { void this.loadRecords(true) },
  changeTab(event: WechatMiniprogram.TouchEvent) { const status = String(event.currentTarget.dataset.status); this.setData({ activeStatus: status }); void this.loadRecords(true) },
  scanCode() { wx.scanCode({ onlyFromCamera: false, success: (result) => { this.setData({ keyword: result.result.trim() }); void this.loadRecords(true) } }) },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/shake-clean/detail/index?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}&status=${this.data.activeStatus}&keyword=${encodeURIComponent(this.data.keyword)}` }) },
  async loadRecords(reset: boolean) {
    const state = stateOf(this); const gate = state.latestRequest; if (state.unloaded || !gate) return
    const requestId = gate.next()
    const page = reset ? 1 : this.data.page + 1
    this.setData(reset ? { loading: true } : { loadingMore: true })
    try {
      const result = await getShakeCleanTasks({ keyword: this.data.keyword.trim() || undefined, status: this.data.activeStatus, page, pageSize: this.data.pageSize, cursor: reset ? undefined : this.data.nextCursor || undefined })
      if (!current(state, gate, requestId)) return
      const next = result.records.map(display)
      this.setData({ records: reset ? next : mergeUniqueById(this.data.records, next), total: result.total, page: result.page, pageSize: result.pageSize, nextCursor: result.nextCursor || null })
    } catch (error) { if (current(state, gate, requestId)) wx.showToast({ title: error instanceof Error ? error.message : '任务加载失败', icon: 'none' }) }
    finally { if (current(state, gate, requestId)) this.setData({ loading: false, loadingMore: false }) }
  },
})
