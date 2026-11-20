'use server'

import { getRequestAuthUserId } from '@/lib/request-auth'
import { parseConsentSubmission } from '@/lib/signup-consent'
import { recordUserConsents } from '@/lib/signup-consent-server'

// 동의 화면 "동의하고 계속". 회원은 미들웨어가 확인한 값(3시간 만료 반영)으로 정하고, 기록은 서비스 키 함수로만 한다.
// 세션 클라이언트·쿠키 쓰기·revalidatePath 를 하지 않는다(서버 액션 뒤 화면이 다시 그려지며 처리 결과 안내를 건너뛰지 않게).
export async function submitConsentAction(rawItems: string) {
  const userId = await getRequestAuthUserId()
  if (!userId) {
    return { ok: false as const, code: 'CONSENT_AUTH_REQUIRED' }
  }
  const items = parseConsentSubmission(rawItems)
  if (!items) {
    return { ok: false as const, code: 'CONSENT_INPUT_INVALID' }
  }
  return recordUserConsents(userId, items, 'consent_gate')
}
