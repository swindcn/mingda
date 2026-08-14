import { getCoreTaskDetail, startCoreTask } from '../../../services/api'
import { CoreBatchStatus, CoreTaskStatus, MobileCoreTask } from '../../../types/business'

const taskLabels: Record<CoreTaskStatus, string> = {
  PENDING_DISPATCH: '待派工', WAITING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELED: '已取消',
}
const batchLabels: Record<CoreBatchStatus, string> = {
  UNDRIED: '待烘干', AVAILABLE: '可用', WARNING: '临期', EXPIRED: '已失效', LOCKED: '已锁定', SCRAPPED: '已报废', CONSUMED: '已用完',
}

function decorate(record: MobileCoreTask) {
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

function permissions() {
  return wx.getStorageSync('mingda_permissions') || []
}

Page({
  data: {
    id: '', record: null as ReturnType<typeof decorate> | null, loading: false, starting: false,
    canStartLocal: false, canReportLocal: false, canDryLocal: false,
  },
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || '' }) },
  onShow() {
    const current = permissions()
    const superUser = wx.getStorageSync('mingda_user_type') === 'SUPER_ADMIN'
    this.setData({
      canStartLocal: superUser || current.includes('mini.production.core.start'),
      canReportLocal: superUser || current.includes('mini.production.core.report'),
      canDryLocal: superUser || current.includes('mini.production.core.dry'),
    })
    if (this.data.id) void this.loadDetail()
  },
  onPullDownRefresh() { void this.loadDetail().finally(() => wx.stopPullDownRefresh()) },
  async loadDetail() {
    this.setData({ loading: true })
    try {
      this.setData({ record: decorate(await getCoreTaskDetail(this.data.id)) })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '任务详情加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  async startTask() {
    const record = this.data.record
    if (!record || this.data.starting || !record.canStart || !this.data.canStartLocal) return
    const modal = await wx.showModal({ title: '开始制芯', content: `确认开始任务 ${record.code}？`, confirmText: '确认开始' })
    if (!modal.confirm) return
    this.setData({ starting: true })
    try {
      await startCoreTask(record.id, { versionNo: record.versionNo })
      wx.showToast({ title: '已开始生产', icon: 'success' })
      await this.loadDetail()
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '开始失败，请刷新重试', icon: 'none' })
    } finally {
      this.setData({ starting: false })
    }
  },
  openReport() {
    const record = this.data.record
    if (record?.canReport && this.data.canReportLocal) wx.navigateTo({ url: `/pages/core/report/index?id=${record.id}&versionNo=${record.versionNo}` })
  },
  openDry() {
    const record = this.data.record
    if (record?.canDry && this.data.canDryLocal) wx.navigateTo({ url: `/pages/core/dry/index?id=${record.id}` })
  },
})
