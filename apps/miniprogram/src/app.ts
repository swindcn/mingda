App<IAppOption>({
  globalData: {
    apiBaseUrl: '__MINGDA_API_BASE_URL__',
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
