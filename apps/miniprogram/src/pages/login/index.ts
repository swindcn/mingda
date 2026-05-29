import { login as loginApi } from '../../services/api'

function isPhoneAccount(value: string) {
  return /^1\d{10}$/.test(value)
}

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
    const rememberedAccount = wx.getStorageSync('mingda_login_account') || ''
    if (rememberPassword) {
      if (rememberedAccount && !isPhoneAccount(rememberedAccount)) {
        wx.removeStorageSync('mingda_login_account')
        wx.removeStorageSync('mingda_password')
        wx.removeStorageSync('mingda_remember')
        wx.removeStorageSync('mingda_username')
        return
      }

      this.setData({
        username: rememberedAccount,
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
        const loginAccount = result.user.phone || (isPhoneAccount(this.data.username) ? this.data.username : '')
        if (loginAccount) {
          wx.setStorageSync('mingda_login_account', loginAccount)
        } else {
          wx.removeStorageSync('mingda_login_account')
        }
        wx.setStorageSync('mingda_password', this.data.password)
        wx.setStorageSync('mingda_remember', true)
      } else {
        wx.removeStorageSync('mingda_login_account')
        wx.removeStorageSync('mingda_password')
        wx.removeStorageSync('mingda_remember')
      }

      wx.removeStorageSync('mingda_username')
      wx.setStorageSync('mingda_display_name', result.user.name)
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
