const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class ApiRequestError<T = unknown> extends Error {
  readonly status: number
  readonly code: number
  readonly data: T | null
  readonly conflictCode?: string

  constructor(message: string, status: number, code: number, data: T | null, conflictCode?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.data = data
    this.conflictCode = conflictCode
  }
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
  const body = (await response.json()) as ApiResponse<T> & { conflictCode?: string }

  if (!response.ok || body.code !== 0) {
    throw new ApiRequestError(body.message || '请求失败', response.status, body.code, body.data, body.conflictCode)
  }

  return body.data
}

async function responseErrorMessage(response: Response, fallback: string) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as Partial<ApiResponse<unknown>>
      return body.message || fallback
    } catch {
      return fallback
    }
  }

  const statusText = response.statusText || '请求失败'
  return `请求失败：${response.status} ${statusText}`
}

export interface ResourceParseResult {
  fileName: string
  markdown: string
  sourceName: string
  sourceType: string
}

export async function convertResourceFile(file: File) {
  const token = window.localStorage.getItem('mingda-admin-token')
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/admin/resource-parser/convert`, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  })
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, '解析失败'))
  }

  const body = (await response.json()) as ApiResponse<ResourceParseResult>

  if (body.code !== 0) {
    throw new Error(body.message || '解析失败')
  }

  return body.data
}

export interface UploadedImageResult {
  url: string
  filename: string
  originalName: string
  mimeType: string
  size: number
}

export async function uploadImageFile(file: File) {
  const token = window.localStorage.getItem('mingda-admin-token')
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/admin/uploads/images`, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  })
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, '上传失败'))
  }

  const body = (await response.json()) as ApiResponse<UploadedImageResult>

  if (body.code !== 0) {
    throw new Error(body.message || '上传失败')
  }

  return body.data
}
