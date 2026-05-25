Page({
  data: {
    username: '1',
  },

  onShow() {
    this.setData({
      username: wx.getStorageSync('mingda_username') || '1',
    })
  },

  logout() {
    wx.removeStorageSync('mingda_token')
    wx.redirectTo({ url: '/pages/login/index' })
  },
})
