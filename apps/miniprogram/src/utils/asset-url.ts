function resolveAssetUrl(value: string, apiBaseUrl: string) {
  if (!value.startsWith('/api/uploads/')) return value

  const serverBaseUrl = apiBaseUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
  return `${serverBaseUrl}${value}`
}

export function resolveAssetUrls<T>(value: T, apiBaseUrl: string): T {
  if (typeof value === 'string') {
    return resolveAssetUrl(value, apiBaseUrl) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveAssetUrls(item, apiBaseUrl)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveAssetUrls(item, apiBaseUrl)]),
    ) as T
  }

  return value
}
