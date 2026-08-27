import { getShakeCleanDefects, getShakeCleanOptions, getShakeCleanReports, getShakeCleanTrace } from '../../../services/api'
import { MobileShakeCleanOptions, ShakeCleanDefectOption, ShakeCleanExecutionStatus, ShakeCleanReports, ShakeCleanTrace } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'

interface PageState { latestRequest?: LatestRequestGate; unloaded?: boolean }
const stateOf = (page: unknown) => page as PageState
const current = (state: PageState, gate: LatestRequestGate, id: number) => !state.unloaded && state.latestRequest === gate && gate.isCurrent(id)
const statusLabels: Record<ShakeCleanExecutionStatus, string> = {
  WAITING_POURING: '等待后续浇注', WAITING_SHAKE: '待落砂', SHAKING: '落砂中',
  WAITING_CLEANING: '待清理', CLEANING: '清理中', COMPLETED: '已完成',
}
type DisplayOptions = MobileShakeCleanOptions & { statusText: string }

Page({
  data: { id: '', options: null as DisplayOptions | null, reports: null as ShakeCleanReports | null, trace: null as ShakeCleanTrace | null, defects: [] as ShakeCleanDefectOption[], loading: false },
  onLoad(query: Record<string, string>) { const state = stateOf(this); state.latestRequest = createLatestRequestGate(); state.unloaded = false; this.setData({ id: query.id || '' }); void this.loadDetail() },
  onUnload() { const state = stateOf(this); state.unloaded = true; state.latestRequest?.invalidate() },
  onShow() { if (this.data.id && this.data.options) void this.loadDetail() },
  onPullDownRefresh() { void this.loadDetail().finally(() => wx.stopPullDownRefresh()) },
  async loadDetail() {
    const state = stateOf(this); const gate = state.latestRequest; if (state.unloaded || !gate) return
    const requestId = gate.next()
    const id = this.data.id
    if (!id) return
    this.setData({ loading: true })
    try {
      const [options, reports, trace, defects] = await Promise.all([getShakeCleanOptions(id), getShakeCleanReports(id), getShakeCleanTrace(id), getShakeCleanDefects(id)])
      if (!current(state, gate, requestId)) return
      this.setData({ options: { ...options, statusText: statusLabels[options.executionStatus] || '未知状态' }, reports, trace, defects })
    } catch (error) { if (current(state, gate, requestId)) wx.showToast({ title: error instanceof Error ? error.message : '详情加载失败', icon: 'none' }) }
    finally { if (current(state, gate, requestId)) this.setData({ loading: false }) }
  },
  goShakeReport() { if (this.data.options?.allowedActions.shakeReport) wx.navigateTo({ url: `/pages/shake-clean/shake-report/index?id=${encodeURIComponent(this.data.id)}` }) },
  goCleanReport() { if (this.data.options?.allowedActions.cleanReport) wx.navigateTo({ url: `/pages/shake-clean/clean-report/index?id=${encodeURIComponent(this.data.id)}` }) },
})
