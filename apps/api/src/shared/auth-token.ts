import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_PREFIX = 'db-token-v2'
export const ADMIN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000

interface AdminTokenPayload {
  userId: string
  exp: number
}

function getTokenSecret() {
  return process.env.ADMIN_TOKEN_SECRET || process.env.JWT_SECRET || 'mingda-casting-local-token-secret'
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value: string) {
  return createHmac('sha256', getTokenSecret()).update(value).digest('base64url')
}

function signaturesMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function extractBearerToken(authorization?: string) {
  return authorization?.replace(/^Bearer\s+/i, '').trim() || ''
}

export function signAdminToken(userId: string) {
  const payload: AdminTokenPayload = {
    userId,
    exp: Date.now() + ADMIN_TOKEN_TTL_MS,
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  return `${TOKEN_PREFIX}.${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyAdminToken(token?: string): { userId: string } | null {
  if (!token?.startsWith(`${TOKEN_PREFIX}.`)) return null

  const [, encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null
  if (!signaturesMatch(signature, sign(encodedPayload))) return null

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<AdminTokenPayload>
    if (!payload.userId || typeof payload.exp !== 'number') return null
    if (payload.exp <= Date.now()) return null
    return { userId: payload.userId }
  } catch {
    return null
  }
}
