import { getPouringOptions, getPouringReports } from '../../../services/api'
import { MobilePouringOptions, MobilePouringReport } from '../../../types/business'

Page({
  data: { id: '', options: null as MobilePouringOptions | null, reports: [] as MobilePouringReport[], holdText: '', holdTone: 'success', loading: false },
  onLoad(options: Record<string, string>) { this.setData({ id: options.id || '' }) },
  onShow() { if (this.data.id) void this.loadDetail() },
  async loadDetail() {
    this.setData({ loading: true })
    try {
      const [options, reports] = await Promise.all([getPouringOptions(this.data.id), getPouringReports(this.data.id)])
      const level = options.holdMinutes > 120 ? 'CRITICAL' : options.holdMinutes >= 90 ? 'WARNING' : 'NORMAL'
      this.setData({ options, reports: reports.map((item) => ({ ...item, reportedAt: new Date(item.reportedAt).toLocaleString() })), holdText: level === 'CRITICAL' ? '严重超时' : level === 'WARNING' ? '请优先浇注' : '正常', holdTone: level === 'CRITICAL' ? 'danger' : level === 'WARNING' ? 'warning' : 'success' })
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '详情加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  goReport() { wx.navigateTo({ url: `/pages/pouring/report/index?id=${this.data.id}` }) },
})
