import { login as loginApi } from '../../services/api'

Page({
  data: {
    username: '',
    password: '',
    rememberPassword: false,
    showPassword: false,
    loading: false,
  },

  onLoad() {
    const rememberPassword = wx.getStorageSync('mingda_remember') === true
    if (rememberPassword) {
      this.setData({
        username: wx.getStorageSync('mingda_username') || '',
        password: wx.getStorageSync('mingda_password') || '',
        rememberPassword,
      })
    }
  },

  onUsernameInput(event: WechatMiniprogram.Input) {
    this.setData({ username: event.detail.value })
  },

  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: event.detail.value })
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  toggleRemember() {
    this.setData({ rememberPassword: !this.data.rememberPassword })
  },

  async login() {
    if (!this.data.username || !this.data.password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    try {
      const result = await loginApi({
        username: this.data.username,
        password: this.data.password,
      })

      if (this.data.rememberPassword) {
        wx.setStorageSync('mingda_username', this.data.username)
        wx.setStorageSync('mingda_password', this.data.password)
        wx.setStorageSync('mingda_remember', true)
      } else {
        wx.removeStorageSync('mingda_username')
        wx.removeStorageSync('mingda_password')
        wx.removeStorageSync('mingda_remember')
      }

      wx.setStorageSync('mingda_username', result.user.name)
      wx.setStorageSync('mingda_token', result.token)
      wx.setStorageSync('mingda_user_type', result.user.userType)
      wx.setStorageSync('mingda_is_supplier_employee', Boolean(result.user.isSupplierEmployee))
      getApp<IAppOption>().globalData.token = result.token
      getApp<IAppOption>().globalData.userType = result.user.userType
      getApp<IAppOption>().globalData.isSupplierEmployee = Boolean(result.user.isSupplierEmployee)
      wx.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '登录失败',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
  },
})
