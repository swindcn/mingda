import { getHeatOrders } from '../../../services/api'
import { HeatOrderStatus, MobileHeatOrder } from '../../../types/business'

const tabs: Array<{ key: HeatOrderStatus; label: string }> = [
  { key: 'WAITING', label: '待生产' },
  { key: 'IN_PROGRESS', label: '生产中' },
  { key: 'TRANSFERRING', label: '转运中' },
  { key: 'COMPLETED', label: '已完成' },
]
const labels: Record<HeatOrderStatus, string> = { WAITING: '待生产', IN_PROGRESS: '熔炼中', TRANSFERRING: '转运中', COMPLETED: '已完成', CANCELED: '已撤销' }
const tones: Record<HeatOrderStatus, string> = { WAITING: 'waiting', IN_PROGRESS: 'active', TRANSFERRING: 'active', COMPLETED: 'done', CANCELED: 'muted' }

function display(items: MobileHeatOrder[]) {
  return items.map((item) => ({
    ...item,
    statusText: labels[item.status],
    statusTone: tones[item.status],
    plannedStartText: item.plannedStartAt ? new Date(item.plannedStartAt).toLocaleString() : '-',
  }))
}

Page({
  data: { tabs, activeTab: 'WAITING' as HeatOrderStatus, records: [] as MobileHeatOrder[], loading: false },
  onShow() { void this.loadRecords() },
  onPullDownRefresh() { void this.loadRecords().finally(() => wx.stopPullDownRefresh()) },
  async loadRecords() {
    this.setData({ loading: true })
    try { this.setData({ records: display(await getHeatOrders(this.data.activeTab)) }) } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '熔炼任务加载失败', icon: 'none' }) } finally { this.setData({ loading: false }) }
  },
  changeTab(event: WechatMiniprogram.TouchEvent) {
    this.setData({ activeTab: event.currentTarget.dataset.key as HeatOrderStatus })
    void this.loadRecords()
  },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/heat/detail/index?id=${event.currentTarget.dataset.id}` }) },
})
