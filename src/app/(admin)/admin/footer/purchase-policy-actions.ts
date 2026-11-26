'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import {
  MARKET_PURCHASE_POLICY_SETTING_KEY,
  MARKET_PURCHASE_POLICY_TEXT_KEYS,
  normalizeMarketPurchasePolicyText,
  validateMarketPurchasePolicyTexts,
  type MarketPurchasePolicy,
  type MarketPurchasePolicyTexts,
} from '@/lib/market-purchase-policy'
import {
  checkCheckoutConsentKeys,
  checkMarketCartInsufficientTexts,
  checkMarketCartTexts,
  MARKET_CART_INSUFFICIENT_KEYS,
  hasCheckoutConsentKeys,
  MARKET_CART_TEXT_KEYS,
  readCheckoutConsentFormat,
} from '@/lib/checkout-consent'
import {
  CHECKOUT_CONSENT_KEY_NAMES,
  checkoutConsentFingerprintFields,
  diffPolicyTextKeys,
  normalizeCheckoutConsentKeysInput,
  normalizeMarketCartTextsInput,
  summarizeCheckoutConsentProblems,
} from '@/lib/checkout-consent-admin'
import { buildCheckoutConsentBundleIgnoringLinks } from '@/lib/checkout-consent-server'
import {
  computeMarketPurchaseNoticeSha256,
  readMarketPurchasePolicyAdminUncached,
  saveMarketPurchasePolicyTexts,
  type MarketPurchasePolicyAdminData,
} from '@/lib/market-purchase-policy-server'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { buildMarketPurchaseInfo, type MarketPurchaseLink } from '@/lib/market-purchase-info'
import { fillMarketPurchasePolicyTexts } from '@/lib/market-purchase-policy'
import type { Json } from '@/types/supabase'

export interface MarketPurchasePolicyAdminView {
  data: MarketPurchasePolicyAdminData | null
  // 미리보기의 링크 주소(하단 정보). 결제 화면과 같은 값.
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
}

// 관리자 사이트 기본 정보 > 구매 고지. 읽기 실패면 data 가 null(화면은 저장을 막는다).
export async function getMarketPurchasePolicyAdminData(): Promise<MarketPurchasePolicyAdminView> {
  await requireAdmin()
  await assertAdminActionPermission('site.manage')
  const [data, footer] = await Promise.all([readMarketPurchasePolicyAdminUncached(), getSiteFooterContent()])
  const { termsLink, refundPolicyLink } = buildMarketPurchaseInfo(footer)
  return { data, termsLink, refundPolicyLink }
}

export interface MarketPurchasePolicySaveRequest {
  texts: MarketPurchasePolicyTexts
  // 2판 키·장바구니 문구(편집칸이 있을 때만 보냄, 없으면 null)
  consentKeys: unknown
  cartTexts: unknown
  // 잔액 부족 충전 안내·두 버튼 이름(편집칸이 있을 때만 보냄, 없으면 null)
  cartInsufficientTexts?: unknown
  expectedVersion: number
}

// 그때 판 규칙의 지문(11번 9절 작업 기록). 2판이 링크 문서 검사로 막히면 null.
function fingerprintOf(raw: Record<string, Json>, policy: MarketPurchasePolicy, linksVisible: boolean): string | null {
  const format = readCheckoutConsentFormat(raw)
  if (format === 1) {
    const filled = fillMarketPurchasePolicyTexts(policy)
    return computeMarketPurchaseNoticeSha256(filled.checkboxLabel, filled.confirmNotice)
  }
  if (format === 2 && linksVisible) {
    return buildCheckoutConsentBundleIgnoringLinks('market', raw, policy.refundDays)?.noticeSha256 ?? null
  }
  return null
}

// 문구만 저장한다. 환불 기간(refundDays)·판(consentFormat)은 받지 않고 DB 값을 그대로 둔다(판 바꾸기는 스크립트로만).
export async function saveMarketPurchasePolicyAction(
  input: MarketPurchasePolicySaveRequest
): Promise<{ success: true; data: MarketPurchasePolicyAdminData } | { success: false; error: string }> {
  await requireAdmin()
  const access = await assertAdminActionPermission('site.manage')
  if (!input || !Number.isInteger(input.expectedVersion)) {
    return { success: false, error: '저장할 문구가 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }
  }

  const texts = {} as MarketPurchasePolicyTexts
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) {
    texts[key] = normalizeMarketPurchasePolicyText(String(input.texts?.[key] ?? ''))
  }
  const invalid = validateMarketPurchasePolicyTexts(texts)
  if (invalid) return { success: false, error: invalid }

  const current = await readMarketPurchasePolicyAdminUncached()
  if (!current) return { success: false, error: '구매 고지 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  const consentKeys = input.consentKeys == null ? null : normalizeCheckoutConsentKeysInput('market', input.consentKeys)
  const cartTexts = input.cartTexts == null ? null : normalizeMarketCartTextsInput(input.cartTexts)

  // 4-3 (S)~(f)·장바구니 문구 규칙: 2판 키가 있으면 판과 관계없이 늘 검사한다(링크 문서 검사 (g) 는 넣지 않음).
  const merged: Record<string, unknown> = { ...current.raw, ...texts, ...(consentKeys ?? {}), ...(cartTexts ?? {}) }
  if (hasCheckoutConsentKeys(merged)) {
    const problem = summarizeCheckoutConsentProblems(checkCheckoutConsentKeys('market', merged))
    if (problem) return { success: false, error: problem }
  }
  if (MARKET_CART_TEXT_KEYS.some((key) => Object.hasOwn(merged, key))) {
    const problem = summarizeCheckoutConsentProblems(checkMarketCartTexts(merged))
    if (problem) return { success: false, error: problem }
  }

  const rawInsufficient = input.cartInsufficientTexts && typeof input.cartInsufficientTexts === 'object'
    ? input.cartInsufficientTexts as Record<string, unknown> : null
  const cartInsufficientTexts = rawInsufficient
    ? Object.fromEntries(MARKET_CART_INSUFFICIENT_KEYS.map((key) => [key, normalizeMarketPurchasePolicyText(String(rawInsufficient[key] ?? ''))]))
    : null
  if (cartInsufficientTexts) {
    // 빈 값·길이·한 줄·중괄호(세 키 모두)
    const problem = summarizeCheckoutConsentProblems(checkMarketCartInsufficientTexts(cartInsufficientTexts))
    if (problem) return { success: false, error: problem }
  }

  let saved: Awaited<ReturnType<typeof saveMarketPurchasePolicyTexts>>
  try {
    saved = await saveMarketPurchasePolicyTexts({ texts, consentKeys, cartTexts, cartInsufficientTexts, expectedVersion: input.expectedVersion })
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '구매 고지 저장에 실패했습니다.' }
  }

  // 작업 기록(저장 뒤, 실패해도 결과는 그대로): 전후 지문과 판. 지문에 들지 않는 문구 키(장바구니 문구 포함)는 바뀐 키의 전후 전문.
  const format = readCheckoutConsentFormat(saved.after)
  // 저장 전·뒤 지문에 모두 드는 칸만 전문에서 뺀다(이번에 새로 항목에 넣은 본문은 이전 글이 지문에 없으므로 전후 전문을 남긴다).
  const fingerprintBefore = checkoutConsentFingerprintFields('market', readCheckoutConsentFormat(saved.before), saved.before)
  const fingerprintAfter = checkoutConsentFingerprintFields('market', format, saved.after)
  const allKeys = [...MARKET_PURCHASE_POLICY_TEXT_KEYS, ...CHECKOUT_CONSENT_KEY_NAMES, ...MARKET_CART_TEXT_KEYS, ...MARKET_CART_INSUFFICIENT_KEYS]
  const { changedKeys, changes } = diffPolicyTextKeys(saved.before, saved.after, allKeys)
  const changedTexts = Object.fromEntries(Object.entries(changes).filter(([key]) => !(fingerprintBefore.has(key) && fingerprintAfter.has(key))))
  const before = fingerprintOf(saved.before, saved.beforePolicy, current.linksVisible)
  const after = fingerprintOf(saved.after, saved.afterPolicy, current.linksVisible)
  await recordAdminAudit({
    actorId: access.userId,
    action: 'market_purchase_policy_update',
    targetType: 'system_settings',
    targetId: MARKET_PURCHASE_POLICY_SETTING_KEY,
    details: {
      key: MARKET_PURCHASE_POLICY_SETTING_KEY,
      refundDays: saved.afterPolicy.refundDays,
      consent_format: format,
      version_before: saved.beforePolicy.version,
      version_after: saved.afterPolicy.version,
      changed_keys: changedKeys,
      changed_texts: changedTexts as Json,
      notice_sha256_before: before,
      notice_sha256_after: after,
      ...(format === 2 && !current.linksVisible ? { notice_sha256_unavailable: 'link_document' } : {}),
    },
  })

  // 장바구니는 캐시 없이 읽고, 상품 상세는 캐시 태그(revalidateTag)로 바로 새 문구를 읽는다.
  revalidatePath('/admin/footer')
  const next = await readMarketPurchasePolicyAdminUncached()
  if (!next) return { success: false, error: '저장했지만 새 값을 다시 읽지 못했습니다. 새로고침해 주세요.' }
  return { success: true, data: next }
}
