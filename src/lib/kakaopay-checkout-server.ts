import 'server-only'

import crypto from 'node:crypto'

export const KAKAOPAY_READY_TTL_MINUTES = 15
export const KAKAOPAY_RESULT_TTL_SECONDS = 30 * 60
export const KAKAOPAY_RESULT_COOKIE = '__Host-kakaopay-result'

export function createOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashOpaqueToken(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function createKakaoPartnerUserId(userId: string) {
  const secret = process.env.PAYMENT_PARTNER_USER_SECRET?.trim() ?? ''

  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('PAYMENT_PARTNER_USER_SECRET_INVALID')
  }

  return `usr_${crypto
    .createHmac('sha256', secret)
    .update(userId)
    .digest('hex')}`
}
