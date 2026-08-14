export function extractScannedCode(raw: string) {
  const text = raw.trim()
  const queryCode = text.match(/[?&](?:code|batch)=([^&]+)/)?.[1]
  if (queryCode) {
    try {
      return decodeURIComponent(queryCode)
    } catch {
      return queryCode
    }
  }
  return text.split('/').filter(Boolean).pop() || text
}
