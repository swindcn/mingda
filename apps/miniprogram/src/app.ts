App<IAppOption>({
  globalData: {
    apiBaseUrl: 'http://127.0.0.1:3000/api',
    token: '',
    userType: '',
    isSupplierEmployee: false,
    permissions: [],
  },
  onLaunch() {
    this.globalData.token = wx.getStorageSync('mingda_token') || ''
    this.globalData.userType = wx.getStorageSync('mingda_user_type') || ''
    this.globalData.isSupplierEmployee = wx.getStorageSync('mingda_is_supplier_employee') === true
    this.globalData.permissions = wx.getStorageSync('mingda_permissions') || []
  },
})
