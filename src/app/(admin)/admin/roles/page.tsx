import { createClient } from '@/lib/supabase/server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { RolesClient } from './roles-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'

export default async function AdminRolesPage() {
    const supabase = await createClient()

    // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
    await requireAdminPagePermission('owner')

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
                <h1 className="text-2xl font-bold text-gray-900"><AdminMenuName href="/admin/roles" fallback="회원가입 관리" /></h1>
                <p className="text-gray-500 mt-1">회원가입 시 선택 가능한 역할을 관리합니다.</p>
            </div>

            <RolesClient initialRoles={roles || []} />
        </div>
    )
}
