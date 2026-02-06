'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { Database } from '@/types/supabase'

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

    const { error } = await supabase
        .from('pricing_plans')
        .update({ is_active: isActive })
        .eq('id', id)

    if (error) throw new Error(error.message)

    revalidatePath('/admin/pricing')
    return { success: true }
}
