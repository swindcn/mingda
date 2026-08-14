import { getCoreTaskDetail, startCoreTask } from '../../../services/api'
import { CoreBatchStatus, CoreTaskStatus, MobileCoreTaskDetail } from '../../../types/business'
import { createLatestRequestGate, type LatestRequestGate } from '../../../utils/latest-request'
import { isConflict } from '../../../utils/request'

interface DetailPageRequestState {
  latestRequest?: LatestRequestGate
  unloaded?: boolean
}

function requestState(page: unknown) {
  return page as DetailPageRequestState
}

function isRequestCurrent(state: DetailPageRequestState, gate: LatestRequestGate, requestId: number) {
  return !state.unloaded && state.latestRequest === gate && gate.isCurrent(requestId)
}

const taskLabels: Record<CoreTaskStatus, string> = {
  PENDING_DISPATCH: '待派工', WAITING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELED: '已取消',
}
const batchLabels: Record<CoreBatchStatus, string> = {
  UNDRIED: '待烘干', AVAILABLE: '可用', WARNING: '临期', EXPIRED: '已失效', LOCKED: '已锁定', SCRAPPED: '已报废', CONSUMED: '已用完',
}

function decorate(record: MobileCoreTaskDetail) {
  return {
    ...record,
    statusText: taskLabels[record.status],
    plannedStartText: record.plannedStartAt ? new Date(record.plannedStartAt).toLocaleString() : '-',
    reports: record.reports.map((item) => ({ ...item, reportedAtText: new Date(item.reportedAt).toLocaleString() })),
    batches: record.batches.map((item) => ({
      ...item,
      statusText: batchLabels[item.status],
      createdAtText: new Date(item.createdAt).toLocaleString(),
      expiresAtText: item.expiresAt ? new Date(item.expiresAt).toLocaleString() : '-',
    })),
  }
}

Page({
  data: {
    id: '', record: null as ReturnType<typeof decorate> | null, loading: false, starting: false,
  },
  onLoad(query: Record<string, string>) {
    const state = requestState(this)
    state.latestRequest = createLatestRequestGate()
    state.unloaded = false
    this.setData({ id: query.id || '' })
  },
  onShow() {
    if (!requestState(this).unloaded && this.data.id) void this.loadDetail()
  },
  onUnload() {
    const state = requestState(this)
    state.unloaded = true
    state.latestRequest?.invalidate()
  },
  onPullDownRefresh() {
    const state = requestState(this)
    void this.loadDetail().finally(() => { if (!state.unloaded) wx.stopPullDownRefresh() })
  },
  async loadDetail() {
    const state = requestState(this)
    const gate = state.latestRequest
    if (state.unloaded || !gate) return
    const requestId = gate.next()
    this.setData({ loading: true })
    try {
      const record = await getCoreTaskDetail(this.data.id)
      if (!isRequestCurrent(state, gate, requestId)) return
      this.setData({ record: decorate(record) })
    } catch (error) {
      if (!isRequestCurrent(state, gate, requestId)) return
      wx.showToast({ title: error instanceof Error ? error.message : '任务详情加载失败', icon: 'none' })
    } finally {
      if (isRequestCurrent(state, gate, requestId)) this.setData({ loading: false })
    }
  },
  async startTask() {
    const state = requestState(this)
    const record = this.data.record
    if (state.unloaded || !record || this.data.starting || !record.canStart) return
    const modal = await wx.showModal({ title: '开始制芯', content: `确认开始任务 ${record.code}？`, confirmText: '确认开始' })
    if (state.unloaded || !modal.confirm) return
    this.setData({ starting: true })
    try {
      await startCoreTask(record.id, { versionNo: record.versionNo })
      if (state.unloaded) return
      wx.showToast({ title: '已开始生产', icon: 'success' })
      await this.loadDetail()
    } catch (error) {
      if (state.unloaded) return
      if (isConflict(error)) {
        await this.loadDetail()
        if (state.unloaded) return
      }
      wx.showToast({ title: error instanceof Error ? error.message : '开始失败，请刷新重试', icon: 'none' })
    } finally {
      if (!state.unloaded) this.setData({ starting: false })
    }
  },
  openReport() {
    if (requestState(this).unloaded) return
    const record = this.data.record
    if (record?.canReport) wx.navigateTo({ url: `/pages/core/report/index?id=${record.id}&versionNo=${record.versionNo}` })
  },
  openDry() {
    if (requestState(this).unloaded) return
    const record = this.data.record
    if (record?.canDry) wx.navigateTo({ url: `/pages/core/dry/index?id=${record.id}` })
  },
  openLabel(event: WechatMiniprogram.TouchEvent) {
    if (requestState(this).unloaded) return
    const record = this.data.record
    const batchId = String(event.currentTarget.dataset.id || '')
    if (record && batchId) {
      wx.navigateTo({ url: `/pages/core/label/index?taskId=${encodeURIComponent(record.id)}&batchId=${encodeURIComponent(batchId)}` })
    }
  },
})
