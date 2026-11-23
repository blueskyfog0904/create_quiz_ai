'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import {
  MARKET_PURCHASE_POLICY_TEXT_KEYS,
  normalizeMarketPurchasePolicyText,
  validateMarketPurchasePolicyTexts,
  type MarketPurchasePolicy,
  type MarketPurchasePolicyTexts,
} from '@/lib/market-purchase-policy'
import { readMarketPurchasePolicyUncached, saveMarketPurchasePolicyTexts } from '@/lib/market-purchase-policy-server'

// 관리자 사이트 기본 정보 > 구매 고지. 읽기 실패면 null(화면은 저장을 막는다).
export async function getMarketPurchasePolicyAdminData(): Promise<MarketPurchasePolicy | null> {
  await requireAdmin()
  await assertAdminActionPermission('site.manage')
  return readMarketPurchasePolicyUncached()
}

// 문구만 저장한다. 환불 기간(refundDays)은 받지 않고 DB 값을 그대로 둔다(값 변경은 8번 묶음).
export async function saveMarketPurchasePolicyAction(
  input: MarketPurchasePolicyTexts
): Promise<{ success: true; data: MarketPurchasePolicy } | { success: false; error: string }> {
  await requireAdmin()
  const access = await assertAdminActionPermission('site.manage')

  const texts = {} as MarketPurchasePolicyTexts
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) {
    texts[key] = normalizeMarketPurchasePolicyText(String(input?.[key] ?? ''))
  }
  const invalid = validateMarketPurchasePolicyTexts(texts)
  if (invalid) return { success: false, error: invalid }

  try {
    const saved = await saveMarketPurchasePolicyTexts(texts)
    // 상품 상세·장바구니는 캐시 태그(revalidateTag)로 바로 새 문구를 읽는다.
    revalidatePath('/admin/footer')
    await recordAdminAudit({
      actorId: access.userId,
      action: 'market_purchase_policy_update',
      targetType: 'system_settings',
      details: { key: 'market_purchase_policy', refundDays: saved.refundDays },
    })
    return { success: true, data: saved }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '구매 고지 저장에 실패했습니다.' }
  }
}
