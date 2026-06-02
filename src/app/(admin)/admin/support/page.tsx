import { createClient } from '@/lib/supabase/server'
import { SupportClient } from './support-client'

interface AdminSupportPageProps {
  searchParams?: Promise<{
    status?: string
    categoryId?: string
    q?: string
    includeDeleted?: string
  }>
}

export default async function AdminSupportPage({ searchParams }: AdminSupportPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const statusFilter = resolvedSearchParams.status || 'all'
  const categoryFilter = resolvedSearchParams.categoryId || 'all'
  const queryText = resolvedSearchParams.q || ''
  const includeDeleted = resolvedSearchParams.includeDeleted === 'true'

  const { data: categories } = await supabase
    .from('support_ticket_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  let ticketsQuery = supabase
    .from('support_tickets')
    .select(`
      *,
      profiles!support_tickets_user_id_profiles_fkey (name, email, phone),
      support_ticket_categories!support_tickets_category_id_fkey (id, slug, name, is_active, deleted_at)
    `)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!includeDeleted) {
    ticketsQuery = ticketsQuery.eq('is_deleted_by_user', false)
  }

  if (statusFilter !== 'all') {
    if (statusFilter === 'deleted') {
      ticketsQuery = ticketsQuery.eq('is_deleted_by_user', true)
    } else {
      ticketsQuery = ticketsQuery.eq('status', statusFilter)
    }
  }

  if (categoryFilter !== 'all') {
    if (categoryFilter === 'uncategorized') {
      ticketsQuery = ticketsQuery.is('category_id', null)
    } else {
      ticketsQuery = ticketsQuery.eq('category_id', categoryFilter)
    }
  }

  if (queryText.trim()) {
    const keyword = queryText.trim().replaceAll(',', ' ')
    ticketsQuery = ticketsQuery.or(`subject.ilike.%${keyword}%,message.ilike.%${keyword}%`)
  }

  const { data: tickets } = await ticketsQuery

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">고객지원 관리</h1>
        <p className="text-gray-500 mt-1">고객 문의 카테고리와 티켓을 관리합니다</p>
      </div>

      <SupportClient
        initialTickets={tickets || []}
        initialCategories={categories || []}
        initialFilters={{
          status: statusFilter,
          categoryId: categoryFilter,
          q: queryText,
          includeDeleted,
        }}
      />
    </div>
  )
}
