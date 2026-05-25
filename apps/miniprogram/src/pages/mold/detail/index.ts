import { confirmDrawing as confirmDrawingApi, getMoldDetail } from '../../../services/api'
import { MoldDevelopmentItem } from '../../../types/business'

Page({
  data: {
    id: '',
    mold: null as MoldDevelopmentItem | null,
    canConfirmDrawing: false,
    canShip: false,
    canReceive: false,
    showBottomActions: false,
    isSupplierEmployee: false,
    loading: false,
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      id: query.id || '',
      isSupplierEmployee: wx.getStorageSync('mingda_is_supplier_employee') === true,
    })
  },

  onShow() {
    if (this.data.id) {
      void this.loadDetail()
    }
  },

  async loadDetail() {
    this.setData({ loading: true })
    try {
      this.applyMoldState(await getMoldDetail(this.data.id))
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '详情加载失败',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  applyMoldState(mold: MoldDevelopmentItem) {
    this.setData({
      mold,
      canConfirmDrawing: mold.status === '待确认',
      canShip: mold.status === '待发货',
      canReceive: mold.status === '待收货',
      showBottomActions: mold.status === '待试产' || mold.status === '试产中',
    })
  },

  goBack() {
    wx.navigateBack()
  },

  logout() {
    wx.removeStorageSync('mingda_token')
    wx.removeStorageSync('mingda_user_type')
    wx.removeStorageSync('mingda_is_supplier_employee')
    wx.redirectTo({ url: '/pages/login/index' })
  },

  previewImage(event: WechatMiniprogram.TouchEvent) {
    const current = event.currentTarget.dataset.src
    const urls = event.currentTarget.dataset.urls || this.data.mold?.images || []
    wx.previewImage({ current, urls })
  },

  confirmDrawing() {
    wx.showModal({
      title: '图纸确认',
      content: '是否确认图纸',
      success: async (result) => {
        if (!result.confirm || !this.data.mold) return

        try {
          this.applyMoldState(await confirmDrawingApi(this.data.mold.id))
          wx.showToast({ title: '已确认' })
        } catch (error) {
          wx.showToast({
            title: error instanceof Error ? error.message : '确认失败',
            icon: 'none',
          })
        }
      },
    })
  },

  openShipping() {
    if (!this.data.mold) return
    wx.navigateTo({ url: `/pages/mold/edit/index?type=shipping&id=${this.data.mold.id}` })
  },

  openReceive() {
    if (!this.data.mold) return
    wx.navigateTo({ url: `/pages/mold/edit/index?type=receive&id=${this.data.mold.id}` })
  },

  openTrial() {
    if (!this.data.mold) return
    wx.navigateTo({ url: `/pages/mold/edit/index?type=trial&id=${this.data.mold.id}` })
  },

  openBatch() {
    if (!this.data.mold) return
    wx.navigateTo({ url: `/pages/mold/edit/index?type=batch&id=${this.data.mold.id}` })
  },

  openEvaluation() {
    if (!this.data.mold) return
    wx.navigateTo({ url: `/pages/mold/edit/index?type=evaluation&id=${this.data.mold.id}` })
  },
})
