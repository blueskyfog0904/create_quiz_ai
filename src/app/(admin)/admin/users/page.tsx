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

    .limit(20)

  // Fetch credits for these users
  const userIds = users?.map(u => u.id) || []
  let creditMap: Record<string, number> = {}
  
  if (userIds.length > 0) {
    const { data: credits } = await supabase
      .from('user_credits')
      .select('user_id, balance')
      .in('user_id', userIds)
    
    credits?.forEach(c => {
      creditMap[c.user_id] = c.balance
    })
  }

  const usersWithCredits = users?.map(u => ({
    ...u,
    credit_balance: creditMap[u.id] || 0
  })) || []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">사용자 관리</h1>
        <p className="text-gray-500 mt-1">가입된 사용자를 조회하고 관리합니다</p>
      </div>

      <UsersClient initialUsers={usersWithCredits} totalCount={count || 0} />
    </div>
  )
}

