import { getPouringTasks } from '../../../services/api'
import { MobilePouringTask, PouringExecutionStatus } from '../../../types/business'

const tabs: Array<{ key: PouringExecutionStatus; label: string }> = [
  { key: 'WAITING', label: '待浇注' }, { key: 'PARTIAL', label: '浇注中' },
  { key: 'WAITING_MOLDING', label: '等造型' }, { key: 'COMPLETED', label: '已完成' },
]
const statusLabels: Record<PouringExecutionStatus, string> = { WAITING: '待浇注', PARTIAL: '浇注中', WAITING_MOLDING: '等待后续造型', COMPLETED: '已完成' }
const statusTones: Record<PouringExecutionStatus, string> = { WAITING: 'pending', PARTIAL: 'active', WAITING_MOLDING: 'muted', COMPLETED: 'done' }
const holdLabels = { NORMAL: '正常', WARNING: '请优先浇注', CRITICAL: '严重超时' }
const holdTones = { NORMAL: 'success', WARNING: 'warning', CRITICAL: 'danger' }

Page({
  data: { tabs, activeTab: 'WAITING' as PouringExecutionStatus, records: [] as MobilePouringTask[], loading: false },
  onShow() { void this.loadRecords() },
  onPullDownRefresh() { void this.loadRecords().finally(() => wx.stopPullDownRefresh()) },
  async loadRecords() {
    this.setData({ loading: true })
    try {
      const records = await getPouringTasks(this.data.activeTab)
      this.setData({ records: records.map((item) => ({ ...item, statusText: statusLabels[item.executionStatus], statusTone: statusTones[item.executionStatus], holdText: `${item.holdMinutes}分钟 · ${holdLabels[item.holdLevel]}`, holdTone: holdTones[item.holdLevel] })) })
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '待浇任务加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  changeTab(event: WechatMiniprogram.TouchEvent) { this.setData({ activeTab: event.currentTarget.dataset.key, records: [] }); void this.loadRecords() },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/pouring/detail/index?id=${event.currentTarget.dataset.id}` }) },
})
