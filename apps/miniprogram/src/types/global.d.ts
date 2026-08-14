/// <reference path="../../node_modules/miniprogram-api-typings/index.d.ts" />

interface IAppOption {
  globalData: {
    apiBaseUrl: string
    token: string
    userType?: string
    isSupplierEmployee?: boolean
    permissions?: string[]
  }
}
