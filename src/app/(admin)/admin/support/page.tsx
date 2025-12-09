import { createClient } from '@/lib/supabase/server'
import { SupportClient } from './support-client'

export default async function AdminSupportPage() {
  const supabase = await createClient()

  // Fetch support tickets
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select(`
      *,
      profiles:user_id (name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">고객지원 관리</h1>
        <p className="text-gray-500 mt-1">고객 문의 티켓을 관리합니다</p>
      </div>

      <SupportClient initialTickets={tickets || []} />
    </div>
  )
}

