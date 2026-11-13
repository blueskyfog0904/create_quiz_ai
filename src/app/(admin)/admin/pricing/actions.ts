'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { Database } from '@/types/supabase'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'

export type PricingPlan = Database['public']['Tables']['pricing_plans']['Row']
export type PricingPlanInsert = Database['public']['Tables']['pricing_plans']['Insert']
export type PricingPlanUpdate = Database['public']['Tables']['pricing_plans']['Update']

export async function getPricingPlans() {
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

    // Check admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) throw new Error('Forbidden')

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

    const { error } = await supabase
        .from('pricing_plans')
        .upsert(data)

    if (error) throw new Error(error.message)

    revalidatePath('/admin/pricing')
    return { success: true }
}

export async function deletePricingPlan(id: string) {
    const supabase = await createClient()

    // Check admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) throw new Error('Forbidden')

    const { error } = await supabase
        .from('pricing_plans')
        .delete()
        .eq('id', id)

    if (error) throw new Error(error.message)

    revalidatePath('/admin/pricing')
    return { success: true }
}

export async function togglePlanStatus(id: string, isActive: boolean) {
    const supabase = await createClient()

    // Check admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) throw new Error('Forbidden')

    const { data: updated, error } = await supabase
        .from('pricing_plans')
        .update({ is_active: isActive })
        .eq('id', id)
        .select('id')

    if (error) throw new Error(error.message)
    // 바뀐 행이 없으면(없는 요금제·권한 문제) 성공으로 보이지 않게 한다.
    if (!updated || updated.length === 0) throw new Error('요금제를 찾지 못했습니다.')

    revalidatePath('/admin/pricing')
    return { success: true }
}
