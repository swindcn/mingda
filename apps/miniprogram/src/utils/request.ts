import { resolveAssetUrls } from './asset-url'

interface RequestOptions<T> {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: string | WechatMiniprogram.IAnyObject | ArrayBuffer
}

interface UploadOptions<T> {
  url: string
  filePath: string
  name: string
}

export function request<T>({ url, method = 'GET', data }: RequestOptions<T>) {
  const app = getApp<IAppOption>()
  const token = app.globalData.token

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}${url}`,
      method,
      data,
      timeout: 15000,
      header: {
        Authorization: token ? `Bearer ${token}` : '',
        'content-type': 'application/json',
      },
      success: (response) => {
        const body = response.data as { code?: number; data?: T; message?: string }
        if (response.statusCode === 401) {
          wx.removeStorageSync('mingda_token')
          wx.removeStorageSync('mingda_permissions')
          app.globalData.token = ''
          wx.redirectTo({ url: '/pages/login/index' })
          reject(new Error('登录已失效，请重新登录'))
          return
        }
        if (body.code === 0) {
          resolve(resolveAssetUrls(body.data as T, app.globalData.apiBaseUrl))
          return
        }
        reject(new Error(body.message || '请求失败'))
      },
      fail: (error) => reject(new Error(error.errMsg.includes('timeout') ? '请求超时，请稍后重试' : '网络请求失败，请检查网络')),
    })
  })
}

export function uploadFile<T>({ url, filePath, name }: UploadOptions<T>) {
  const app = getApp<IAppOption>()
  const token = app.globalData.token

  return new Promise<T>((resolve, reject) => {
    wx.uploadFile({
      url: `${app.globalData.apiBaseUrl}${url}`,
      filePath,
      name,
      header: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      success: (response) => {
        let body: { code?: number; data?: T; message?: string }
        try {
          body = JSON.parse(response.data) as { code?: number; data?: T; message?: string }
        } catch {
          reject(new Error('上传响应解析失败'))
          return
        }
        if (body.code === 0) {
          resolve(resolveAssetUrls(body.data as T, app.globalData.apiBaseUrl))
          return
        }
        reject(new Error(body.message || '上传失败'))
      },
      fail: reject,
    })
  })
}
