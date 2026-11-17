'use server'

import { assertAdminFeatureEnabled } from '@/lib/admin-features-server'
import { AdminPermissionError, assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface RoleData {
    value: string
    label: string
    sort_order: number
    is_active: boolean
}

export async function createRole(data: RoleData) {
  await assertAdminFeatureEnabled('signup_roles')
    const supabase = await createClient()

    try {
        await assertAdminActionPermission('owner')
    } catch (error) {
        if (error instanceof AdminPermissionError) return { error: error.message }
        throw error
    }

    const { data: newRole, error } = await supabase
        .from('user_roles')
        .insert({
            value: data.value,
            label: data.label,
            sort_order: data.sort_order,
            is_active: data.is_active
        })
        .select()
        .single()

    if (error) {
        console.error('Error creating role:', error)
        if (error.code === '23505') {
            return { error: '이미 존재하는 저장값입니다.' }
        }
        return { error: error.message }
    }

    revalidatePath('/admin/roles')
    revalidatePath('/signup')

    return { data: newRole }
}

export async function updateRole(id: string, data: Partial<RoleData>) {
  await assertAdminFeatureEnabled('signup_roles')
    const supabase = await createClient()

    try {
        await assertAdminActionPermission('owner')
    } catch (error) {
        if (error instanceof AdminPermissionError) return { error: error.message }
        throw error
    }

    const { error } = await supabase
        .from('user_roles')
        .update({
            label: data.label,
            sort_order: data.sort_order,
            is_active: data.is_active
        })
        .eq('id', id)

    if (error) {
        console.error('Error updating role:', error)
        return { error: error.message }
    }

    revalidatePath('/admin/roles')
    revalidatePath('/signup')

    return { success: true }
}

export async function deleteRole(id: string) {
  await assertAdminFeatureEnabled('signup_roles')
    const supabase = await createClient()

    try {
        await assertAdminActionPermission('owner')
    } catch (error) {
        if (error instanceof AdminPermissionError) return { error: error.message }
        throw error
    }

    const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('id', id)

    if (error) {
        console.error('Error deleting role:', error)
        return { error: error.message }
    }

    revalidatePath('/admin/roles')
    revalidatePath('/signup')

    return { success: true }
}
