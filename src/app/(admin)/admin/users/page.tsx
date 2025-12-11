import { createClient } from '@/lib/supabase/server'
import { UsersClient } from './users-client'

export default async function AdminUsersPage() {
  const supabase = await createClient()

  // Fetch initial users
  const { data: users, count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">사용자 관리</h1>
        <p className="text-gray-500 mt-1">가입된 사용자를 조회하고 관리합니다</p>
      </div>

      <UsersClient initialUsers={users || []} totalCount={count || 0} />
    </div>
  )
}

