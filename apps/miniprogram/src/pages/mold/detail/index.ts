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
    showInternalRecords: false,
    hasDevelopmentRecords: false,
    isSupplierEmployee: false,
    loading: false,
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      id: query.id || '',
      isSupplierEmployee: wx.getStorageSync('mingda_is_supplier_employee') === true,
      showInternalRecords: wx.getStorageSync('mingda_user_type') !== 'SUPPLIER' && wx.getStorageSync('mingda_user_type') !== 'CUSTOMER',
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
    const permissions = mold.permissions
    this.setData({
      mold,
      canConfirmDrawing: Boolean(permissions?.canConfirmDrawing),
      canShip: Boolean(permissions?.canShip),
      canReceive: Boolean(permissions?.canReceive),
      showBottomActions: Boolean(permissions?.canTrial || permissions?.canBatch || permissions?.canEvaluate),
      hasDevelopmentRecords: Boolean(mold.productionRecords.length || mold.terminationRecord),
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
