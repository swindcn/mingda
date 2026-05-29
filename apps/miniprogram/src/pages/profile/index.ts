Page({
  data: {
    username: '1',
  },

  onShow() {
    this.setData({
      username: wx.getStorageSync('mingda_display_name') || wx.getStorageSync('mingda_login_account') || '1',
    })
  },

  logout() {
    wx.removeStorageSync('mingda_token')
    wx.redirectTo({ url: '/pages/login/index' })
  },
})
