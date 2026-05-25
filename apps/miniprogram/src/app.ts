App<IAppOption>({
  globalData: {
    apiBaseUrl: 'http://124.223.2.193/api',
    token: '',
    userType: '',
    isSupplierEmployee: false,
  },
  onLaunch() {
    const token = wx.getStorageSync('mingda_token')
    if (token) {
      this.globalData.token = token
    }
    this.globalData.userType = wx.getStorageSync('mingda_user_type') || ''
    this.globalData.isSupplierEmployee = wx.getStorageSync('mingda_is_supplier_employee') === true
  },
})
