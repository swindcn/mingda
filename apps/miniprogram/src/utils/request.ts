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
      header: {
        Authorization: token ? `Bearer ${token}` : '',
        'content-type': 'application/json',
      },
      success: (response) => {
        const body = response.data as { code?: number; data?: T; message?: string }
        if (body.code === 0) {
          resolve(resolveAssetUrls(body.data as T, app.globalData.apiBaseUrl))
          return
        }
        reject(new Error(body.message || '请求失败'))
      },
      fail: reject,
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
