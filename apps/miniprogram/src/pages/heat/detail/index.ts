import { getHeatOrderDetail } from '../../../services/api'
import { MobileHeatOrder } from '../../../types/business'

const actionLabels: Record<string, string> = { CREATED: '任务下发', STARTED: '开始生产', TRANSFERRED: '转运出炉', COMPLETED: '完成生产', CANCELED: '撤销任务' }

function decorate(record: MobileHeatOrder) {
  return {
    ...record,
    plannedStartText: record.plannedStartAt ? new Date(record.plannedStartAt).toLocaleString() : '-',
    transfers: record.transfers.map((item) => ({ ...item, timeText: new Date(item.createdAt).toLocaleString() })),
    records: record.records.map((item) => ({ ...item, actionText: actionLabels[item.action] || item.action, timeText: new Date(item.createdAt).toLocaleString() })),
  }
}

Page({
  data: { id: '', record: null as (MobileHeatOrder & { plannedStartText?: string }) | null, loading: false },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || '' }) },
  onShow() { if (this.data.id) void this.loadDetail() },
  async loadDetail() {
    this.setData({ loading: true })
    try { this.setData({ record: decorate(await getHeatOrderDetail(this.data.id)) }) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '详情加载失败', icon: 'none' }) } finally { this.setData({ loading: false }) }
  },
  startProduction() { const record = this.data.record; if (record) wx.navigateTo({ url: `/pages/heat/start/index?id=${record.id}&versionNo=${record.versionNo}` }) },
  transferProduction() { const record = this.data.record; if (record) wx.navigateTo({ url: `/pages/heat/transfer/index?id=${record.id}&versionNo=${record.versionNo}` }) },
  completeProduction() { const record = this.data.record; if (record) wx.navigateTo({ url: `/pages/heat/complete/index?id=${record.id}&versionNo=${record.versionNo}&target=${record.targetWeightKg}&transferTotal=${record.transferTotalWeightKg}` }) },
})
