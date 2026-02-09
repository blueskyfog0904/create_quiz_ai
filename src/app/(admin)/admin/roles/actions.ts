'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface RoleData {
    value: string
    label: string
    sort_order: number
    is_active: boolean
}

export async function createRole(data: RoleData) {
    const supabase = await createClient()

    // Check admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { error: '로그인이 필요합니다.' }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        return { error: '권한이 없습니다.' }
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
    const supabase = await createClient()

    // Check admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { error: '로그인이 필요합니다.' }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        return { error: '권한이 없습니다.' }
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
    const supabase = await createClient()

    // Check admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { error: '로그인이 필요합니다.' }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        return { error: '권한이 없습니다.' }
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
