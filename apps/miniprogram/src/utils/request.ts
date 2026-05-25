interface RequestOptions<T> {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: string | WechatMiniprogram.IAnyObject | ArrayBuffer
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
          resolve(body.data as T)
          return
        }
        reject(new Error(body.message || '请求失败'))
      },
      fail: reject,
    })
  })
}
