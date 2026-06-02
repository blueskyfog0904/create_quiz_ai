import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { SupportClient } from './support-client'

export default async function SupportPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  const [{ data: categories }, { data: tickets }] = await Promise.all([
    supabase
      .from('support_ticket_categories')
      .select('*')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('support_tickets')
      .select(`
        *,
        support_ticket_categories!support_tickets_category_id_fkey (
          id,
          slug,
          name,
          is_active,
          deleted_at
        )
      `)
      .eq('user_id', user.id)
      .eq('is_deleted_by_user', false)
      .order('created_at', { ascending: false }),
  ])

  return (
    <SupportClient
      tickets={tickets || []}
      categories={categories || []}
      userId={user.id}
    />
  )
}
