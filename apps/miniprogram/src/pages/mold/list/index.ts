import { getMolds } from '../../../services/api'
import { MoldDevelopmentItem } from '../../../types/business'

Page({
  data: {
    keyword: '',
    molds: [] as MoldDevelopmentItem[],
    username: '1',
    isSupplierEmployee: false,
    loading: false,
  },

  onShow() {
    this.setData({
      username: wx.getStorageSync('mingda_username') || '1',
      isSupplierEmployee: wx.getStorageSync('mingda_is_supplier_employee') === true,
    })
    void this.loadMolds()
  },

  async loadMolds() {
    this.setData({ loading: true })
    try {
      this.setData({ molds: await getMolds(this.data.keyword) })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '模具列表加载失败',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
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
