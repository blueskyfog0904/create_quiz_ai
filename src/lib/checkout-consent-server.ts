import 'server-only'

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/bypass'
import { SITE_FOOTER_CONTENT_SETTING_KEY } from '@/lib/footer-content'
import {
  areCheckoutConsentLinksVisible,
  buildCheckoutConsentDraft,
  buildCheckoutConsentText,
  buildMarketCartTextsSource,
  checkMarketCartTexts,
  type CheckoutConsentBundle,
  type CheckoutConsentKind,
  type MarketCartTexts,
} from '@/lib/checkout-consent'
import type { Json } from '@/types/supabase'

// 11번 묶음: 2판 묶음·장바구니 문구 지문(서버 계산). DB 함수 build_checkout_consent_v2·build_market_cart_texts 와 같은 값이다.

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// 정규화하지 않은 바닥글 원본(4-3 (g)). 읽지 못하면 throw — 부르는 쪽이 닫는다.
export async function readRawSiteFooterValue(): Promise<unknown> {
  const { data, error } = await createAdminClient().from('system_settings')
    .select('value').eq('key', SITE_FOOTER_CONTENT_SETTING_KEY).maybeSingle()
  if (error) throw error
  return data?.value ?? null
}

// 2판 묶음(지문 포함). 문구 검사·링크 문서 검사에 걸리면 null. 판은 보지 않는다.
export function buildCheckoutConsentBundle(kind: CheckoutConsentKind, value: unknown, refundDays: number,
  rawFooterValue: unknown): CheckoutConsentBundle | null {
  if (!areCheckoutConsentLinksVisible(rawFooterValue)) return null
  const draft = buildCheckoutConsentDraft(kind, value, refundDays)
  if (!draft) return null
  return { ...draft, noticeSha256: sha256Hex(buildCheckoutConsentText(draft)) }
}

// 링크 검사 없이 문구만으로 만든 2판 묶음(관리자 미리보기·지문 보기용 — 링크 문서가 닫혀 있어도 문구 지문은 보여 준다).
export function buildCheckoutConsentBundleIgnoringLinks(kind: CheckoutConsentKind, value: unknown,
  refundDays: number): CheckoutConsentBundle | null {
  const draft = buildCheckoutConsentDraft(kind, value, refundDays)
  if (!draft) return null
  return { ...draft, noticeSha256: sha256Hex(buildCheckoutConsentText(draft)) }
}

// 장바구니 문구와 지문. 규칙을 어기면 null(결제 칸 닫힘).
export function buildMarketCartTexts(value: unknown): MarketCartTexts | null {
  if (checkMarketCartTexts(value).length > 0) return null
  const record = value as Record<string, string>
  const texts = { cartCheckoutNotice: record.cartCheckoutNotice, partialOwnedConfirmLabel: record.partialOwnedConfirmLabel }
  return { ...texts, cartTextsSha256: sha256Hex(buildMarketCartTextsSource(texts)) }
}

// 2판 검사 실패 경보(실제 DB 판이 2 일 때만 부른다 — 개발 스위치가 판을 바꾼 값에서는 부르지 않는다, 10-1).
export async function recordCheckoutConsentUnavailableAlert(kind: CheckoutConsentKind, details: Record<string, Json | undefined>): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('record_payment_alert', {
      p_code: 'CHECKOUT_CONSENT_V2_UNAVAILABLE',
      p_severity: 'critical',
      p_message: kind === 'market'
        ? '자료 구매 동의(접는 동의) 문구나 링크 문서를 확인하지 못해 장바구니 결제가 막혔습니다. 구매 고지 설정·약관 문서를 확인하거나 되돌림 스크립트로 예전 방식으로 돌리세요.'
        : '충전 결제 동의(접는 동의) 문구나 링크 문서를 확인하지 못해 충전 결제가 막혔습니다. 충전 정책 설정·약관 문서를 확인하거나 되돌림 스크립트로 예전 방식으로 돌리세요.',
      p_details: { ...details, kind, dedupe_key: `checkout_consent_v2:${kind}`, attempted_at: new Date().toISOString() } as Json,
    })
    if (error) console.error('[checkout-consent] 경보 기록 실패', { code: error.code })
  } catch {
    // 경보 기록 실패는 화면 응답과 무관하다.
  }
}
