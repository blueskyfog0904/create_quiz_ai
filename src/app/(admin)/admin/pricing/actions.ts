'use server'

import { createClient } from '@/lib/supabase/server'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { revalidatePath } from 'next/cache'
import { Database } from '@/types/supabase'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { normalizePricingPlanDisplayText } from '@/lib/pricing-plan-display'

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

    // 작업 기록용: id를 들고 와도 그 요금제가 없으면 새로 만들어진다. 저장 전 값을 읽어 추가·수정을 가른다(읽지 못하면 id 유무로).
    const PLAN_AUDIT_COLUMNS = 'id, name, price, credits, is_active, badge_text, discount_text'
    const existing = data.id
        ? await supabase.from('pricing_plans').select(PLAN_AUDIT_COLUMNS).eq('id', data.id).maybeSingle()
        : null
    const before = existing && !existing.error ? existing.data : null
    const isCreate = data.id ? Boolean(existing && !existing.error && !existing.data) : true

    const { data: saved, error } = await supabase
        .from('pricing_plans')
        .upsert({ ...data, badge_text: badgeText, discount_text: discountText })
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
