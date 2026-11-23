'use server'

import { createClient } from '@/lib/supabase/server'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { revalidatePath } from 'next/cache'
import { Database } from '@/types/supabase'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { normalizePricingPlanDisplayText, PRICING_PLAN_DESCRIPTION_MAX_LENGTH } from '@/lib/pricing-plan-display'
import { savePricingPageContent } from '@/lib/pricing-page-content-server'
import type { PricingPageContent } from '@/lib/pricing-page-content'
import {
    normalizePointChargePolicyText,
    POINT_CHARGE_CHECKOUT_ITEM_KEYS,
    POINT_CHARGE_POLICY_SETTING_KEY,
    validatePointChargePolicyTexts,
    type PointChargeCheckoutItems,
    type PointChargePolicy,
    type PointChargePolicyTexts,
} from '@/lib/point-charge-policy'
import { computePointChargeNoticeSha256, savePointChargePolicyTexts } from '@/lib/point-charge-policy-server'

export type PricingPlan = Database['public']['Tables']['pricing_plans']['Row']
export type PricingPlanInsert = Database['public']['Tables']['pricing_plans']['Insert']
export type PricingPlanUpdate = Database['public']['Tables']['pricing_plans']['Update']

export async function getPricingPlans() {
    await assertAdminActionPermission('pricing.manage')
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('pricing_plans')
        .select('*')
        .order('sort_order', { ascending: true })

    if (error) throw new Error(error.message)
    return data
}

export async function upsertPricingPlan(data: PricingPlanInsert) {
    const supabase = await createClient()

    const access = await assertAdminActionPermission('pricing.manage')

    if (
        !Number.isInteger(data.price) ||
        data.price < MIN_POINT_CHARGE_AMOUNT ||
        data.price > MAX_POINT_CHARGE_AMOUNT
    ) {
        throw new Error('가격은 1,000원 이상 100,000원 이하여야 합니다.')
    }

    if (!Number.isInteger(data.credits) || data.credits < 1) {
        throw new Error('제공 크레딧은 1 이상이어야 합니다.')
    }

    // 배지·할인 문구: 앞뒤 공백을 떼고, 비어 있으면 null, 20자를 넘으면 오류.
    const badgeText = normalizePricingPlanDisplayText(data.badge_text, '배지 문구')
    const discountText = normalizePricingPlanDisplayText(data.discount_text, '할인·혜택 문구')
    // 설명: 충전 화면 상품 줄의 작은 글씨. 앞뒤 공백을 떼고 60자 이하, 비면 null.
    const description = (typeof data.description === 'string' ? data.description.trim() : '') || null
    if (description && description.length > PRICING_PLAN_DESCRIPTION_MAX_LENGTH) {
        throw new Error(`설명은 ${PRICING_PLAN_DESCRIPTION_MAX_LENGTH}자 이하여야 합니다.`)
    }

    // 작업 기록용: id를 들고 와도 그 요금제가 없으면 새로 만들어진다. 저장 전 값을 읽어 추가·수정을 가른다(읽지 못하면 id 유무로).
    const PLAN_AUDIT_COLUMNS = 'id, name, price, credits, is_active, badge_text, discount_text'
    const existing = data.id
        ? await supabase.from('pricing_plans').select(PLAN_AUDIT_COLUMNS).eq('id', data.id).maybeSingle()
        : null
    const before = existing && !existing.error ? existing.data : null
    const isCreate = data.id ? Boolean(existing && !existing.error && !existing.data) : true

    const { data: saved, error } = await supabase
        .from('pricing_plans')
        .upsert({ ...data, description, badge_text: badgeText, discount_text: discountText })
        .select(PLAN_AUDIT_COLUMNS)

    if (error) throw new Error(error.message)

    // 저장된 뒤 작업 기록을 남긴다(실패해도 결과는 그대로).
    const plan = saved?.[0]
    await recordAdminAudit({
        actorId: access.userId,
        action: isCreate ? 'pricing_plan_create' : 'pricing_plan_update',
        targetType: 'pricing_plan',
        targetId: plan?.id ?? data.id ?? null,
        details: { before, after: plan ?? null },
    })

    revalidatePath('/admin/pricing')
    return { success: true }
}

export async function deletePricingPlan(id: string) {
    const supabase = await createClient()

    const access = await assertAdminActionPermission('pricing.manage')

    const { data: deleted, error } = await supabase
        .from('pricing_plans')
        .delete()
        .eq('id', id)
        .select('id, name, price, credits, is_active')

    if (error) throw new Error(error.message)

    // 실제로 지운 행이 있을 때만 기록한다.
    if (deleted && deleted.length > 0) {
        await recordAdminAudit({
            actorId: access.userId,
            action: 'pricing_plan_delete',
            targetType: 'pricing_plan',
            targetId: id,
            details: { before: deleted[0] },
        })
    }

    revalidatePath('/admin/pricing')
    return { success: true }
}

export async function togglePlanStatus(id: string, isActive: boolean) {
    const supabase = await createClient()

    const access = await assertAdminActionPermission('pricing.manage')

    const { data: updated, error } = await supabase
        .from('pricing_plans')
        .update({ is_active: isActive })
        .eq('id', id)
        .select('id, name')

    if (error) throw new Error(error.message)
    // 바뀐 행이 없으면(없는 요금제·권한 문제) 성공으로 보이지 않게 한다.
    if (!updated || updated.length === 0) throw new Error('요금제를 찾지 못했습니다.')

    await recordAdminAudit({
        actorId: access.userId,
        action: 'pricing_plan_status_change',
        targetType: 'pricing_plan',
        targetId: id,
        details: { name: updated[0].name, is_active: isActive },
    })

    revalidatePath('/admin/pricing')
    return { success: true }
}

// 충전 화면(/pricing) 문구. 요금제와 같은 권한(pricing.manage)으로 고친다.
// 운영 빌드에서는 서버 액션이 던진 오류 문구가 화면에 전달되지 않으므로, 검사 오류는 결과 값으로 돌려준다.
export async function savePricingPageContentAction(
    input: PricingPageContent
): Promise<{ success: true; data: PricingPageContent } | { success: false; error: string }> {
    const access = await assertAdminActionPermission('pricing.manage')
    let saved: PricingPageContent
    try {
        saved = await savePricingPageContent(input)
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '충전 화면 문구를 저장하지 못했습니다.' }
    }

    // 저장된 뒤 작업 기록을 남긴다(실패해도 결과는 그대로). 문구 전문은 길어 기록에 담지 않는다.
    await recordAdminAudit({
        actorId: access.userId,
        action: 'pricing_page_content_update',
        targetType: 'pricing_page_content',
    })

    revalidatePath('/pricing')
    revalidatePath('/admin/pricing')
    return { success: true, data: saved }
}

// 결제 전 확인·크레딧 화면 문구(system_settings 'point_charge_policy'). 요금제와 같은 권한(pricing.manage)으로 고친다.
// 환불 기간(refundDays)은 이 화면에서 바꾸지 않는다(약관 문장과 함께 스크립트로). 폼을 연 때의 version 으로 낙관적 잠금.
type PointChargePolicySaveInput = { texts: PointChargePolicyTexts; expectedVersion: number }

export async function savePointChargePolicyTextsAction(
    input: PointChargePolicySaveInput
): Promise<{ success: true; data: PointChargePolicy } | { success: false; error: string }> {
    const access = await assertAdminActionPermission('pricing.manage')
    if (!Number.isInteger(input?.expectedVersion) || !input.texts || typeof input.texts !== 'object') {
        return { success: false, error: '저장할 문구가 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }
    }
    const raw = input.texts
    const text = (value: unknown) => normalizePointChargePolicyText(typeof value === 'string' ? value : '')
    const checkoutItems = {} as PointChargeCheckoutItems
    for (const key of POINT_CHARGE_CHECKOUT_ITEM_KEYS) checkoutItems[key] = text(raw.checkoutItems?.[key])
    const refundBlockReasons: Record<string, string> = {}
    for (const [code, value] of Object.entries(raw.refundBlockReasons ?? {})) {
        if (/^[A-Z][A-Z0-9_]+$/.test(code)) refundBlockReasons[code] = text(value)
    }
    const texts: PointChargePolicyTexts = {
        checkoutTitle: text(raw.checkoutTitle),
        checkoutItems,
        minorNotice: text(raw.minorNotice),
        agreeLabel: text(raw.agreeLabel),
        creditsGuide: text(raw.creditsGuide),
        refundRequestConfirm: (Array.isArray(raw.refundRequestConfirm) ? raw.refundRequestConfirm : [])
            .map(text).filter((line) => line !== ''),
        refundRequestAccepted: text(raw.refundRequestAccepted),
        refundBlockReasons,
    }
    const invalid = validatePointChargePolicyTexts(texts)
    if (invalid) return { success: false, error: invalid }

    let saved: { before: PointChargePolicy; after: PointChargePolicy }
    try {
        saved = await savePointChargePolicyTexts(texts, input.expectedVersion)
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '충전 정책 문구를 저장하지 못했습니다.' }
    }

    // 저장된 뒤 작업 기록을 남긴다(실패해도 결과는 그대로). 문구 전문 대신 바뀐 키와 새 지문을 남긴다.
    const textKeys = ['checkoutTitle', 'checkoutItems', 'minorNotice', 'agreeLabel', 'creditsGuide',
        'refundRequestConfirm', 'refundRequestAccepted', 'refundBlockReasons'] as const
    const changedKeys = textKeys.filter((key) => JSON.stringify(saved.before[key]) !== JSON.stringify(saved.after[key]))
    await recordAdminAudit({
        actorId: access.userId,
        action: 'point_charge_policy_update',
        targetType: 'system_settings',
        targetId: POINT_CHARGE_POLICY_SETTING_KEY,
        details: {
            changed_keys: changedKeys,
            version_before: saved.before.version,
            version_after: saved.after.version,
            refund_days: saved.after.refundDays,
            notice_sha256_before: computePointChargeNoticeSha256(saved.before),
            notice_sha256_after: computePointChargeNoticeSha256(saved.after),
        },
    })

    revalidatePath('/checkout')
    revalidatePath('/mypage/credits')
    revalidatePath('/admin/pricing')
    return { success: true, data: saved.after }
}
