'use server'

import { getRequestAuthUserId } from '@/lib/request-auth'
import { recordUserConsents } from '@/lib/signup-consent-server'

// 선택 동의 켜기·끄기(마케팅 철회 경로). 필수 재동의 전·거부한 회원도 쓸 수 있다(미들웨어 판정 제외 경로).
// 철회는 숨긴 항목에도 받고, 동의는 보이는 현재 버전에만 받는다(DB 함수가 판정).
export async function setOptionalConsentAction(itemId: string, version: number, agreed: boolean) {
  const userId = await getRequestAuthUserId()
  if (!userId) {
    return { ok: false as const, code: 'CONSENT_AUTH_REQUIRED' }
  }
  if (typeof itemId !== 'string' || !Number.isInteger(version) || typeof agreed !== 'boolean') {
    return { ok: false as const, code: 'CONSENT_INPUT_INVALID' }
  }
  return recordUserConsents(userId, [{ item_id: itemId, version, agreed }], 'mypage')
}
