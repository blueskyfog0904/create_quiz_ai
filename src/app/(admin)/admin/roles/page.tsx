import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RolesClient } from './roles-client'

export default async function AdminRolesPage() {
    const supabase = await createClient()

    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        redirect('/login')
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        redirect('/')
    }

    // Fetch all roles (including inactive)
    const { data: roles, error } = await supabase
        .from('user_roles')
        .select('*')
        .order('sort_order', { ascending: true })

    if (error) {
        console.error('Error fetching roles:', error)
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">회원가입 관리</h1>
                <p className="text-gray-500 mt-1">회원가입 시 선택 가능한 역할을 관리합니다.</p>
            </div>

            <RolesClient initialRoles={roles || []} />
        </div>
    )
}
