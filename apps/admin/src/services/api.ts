const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export async function apiRequest<T>(path: string, options?: RequestInit) {
  const token = window.localStorage.getItem('mingda-admin-token')
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  })
  const body = (await response.json()) as ApiResponse<T>

  if (!response.ok || body.code !== 0) {
    throw new Error(body.message || '请求失败')
  }

  return body.data
}
