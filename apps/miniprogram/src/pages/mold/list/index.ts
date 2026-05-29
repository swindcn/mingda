import { getMolds } from '../../../services/api'
import { MoldDevelopmentItem, MoldStatus } from '../../../types/business'

type ArchiveTab = 'active' | 'completed' | 'cancelled'

const archiveTabs: Array<{ key: ArchiveTab; label: string }> = [
  { key: 'active', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已中止' },
]

Page({
  data: {
    keyword: '',
    archiveTab: 'active' as ArchiveTab,
    archiveTabs,
    molds: [] as MoldDevelopmentItem[],
    allMolds: [] as MoldDevelopmentItem[],
    username: '1',
    isSupplierEmployee: false,
    loading: false,
  },

  onShow() {
    this.setData({
      username: wx.getStorageSync('mingda_display_name') || wx.getStorageSync('mingda_login_account') || '1',
      isSupplierEmployee: wx.getStorageSync('mingda_is_supplier_employee') === true,
    })
    void this.loadMolds()
  },

  onPullDownRefresh() {
    void this.loadMolds().finally(() => wx.stopPullDownRefresh())
  },

  async loadMolds() {
    this.setData({ loading: true })
    try {
      const allMolds = await getMolds(this.data.keyword)
      this.setData({
        allMolds,
        molds: this.filterMolds(allMolds, this.data.archiveTab),
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '模具列表加载失败',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  filterMolds(molds: MoldDevelopmentItem[], archiveTab: ArchiveTab) {
    const statusMap: Record<ArchiveTab, (status: MoldStatus) => boolean> = {
      active: (status) => status !== '已完成' && status !== '已中止',
      completed: (status) => status === '已完成',
      cancelled: (status) => status === '已中止',
    }
    return molds.filter((mold) => statusMap[archiveTab](mold.status))
  },

  onArchiveTabTap(event: WechatMiniprogram.TouchEvent) {
    const archiveTab = event.currentTarget.dataset.key as ArchiveTab
    this.setData({
      archiveTab,
      molds: this.filterMolds(this.data.allMolds, archiveTab),
    })
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value.trim() })
    void this.loadMolds()
  },

  goBack() {
    wx.navigateBack()
  },

  logout() {
    wx.removeStorageSync('mingda_token')
    wx.redirectTo({ url: '/pages/login/index' })
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/mold/detail/index?id=${id}` })
  },
})
