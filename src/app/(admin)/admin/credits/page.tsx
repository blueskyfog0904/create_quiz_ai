import { createClient } from '@/lib/supabase/server'
import { CreditsClient } from './credits-client'
import { requireAdmin } from '@/lib/auth'

export default async function AdminCreditsPage() {
  await requireAdmin()
  const supabase = await createClient()

  // Fetch recent transactions first (without join)
  const { data: transactions, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Error fetching transactions:', error)
  }

  // Then fetch profiles for these transactions manually to avoid join issues
  const userIds = Array.from(new Set(transactions?.map(t => t.user_id) || []))
  let profileMap: Record<string, any> = {}

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, name')
        .in('id', userIds)
    
    profiles?.forEach(p => {
        profileMap[p.id] = p
    })
  }

  const safeTransactions = transactions?.map(t => ({
    ...t,
    user: profileMap[t.user_id] || { email: 'Unknown', name: 'Unknown' }
  })) || []

  // Simple stats from the loaded data (MVP)
  const stats = {
    totalGrant: safeTransactions.filter(t => t.amount > 0 && t.transaction_type !== 'system_refund').reduce((acc, t) => acc + t.amount, 0),
    totalConsume: safeTransactions.filter(t => t.amount < 0).reduce((acc, t) => acc + t.amount, 0),
    totalRefund: safeTransactions.filter(t => t.transaction_type === 'system_refund').reduce((acc, t) => acc + t.amount, 0)
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">크레딧 관리</h1>
        <p className="text-gray-500 mt-1">시스템 전체 크레딧 거래 내역을 조회합니다</p>
      </div>

      <CreditsClient 
        initialTransactions={safeTransactions} 
        totalCount={safeTransactions.length} // Just showing count of fetched items
        stats={stats}
      />
    </div>
  )
}
