import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { createClient } from '@/lib/supabase/server'
import { SupportView } from './_components/support-view'

export const metadata: Metadata = {
  title: '고객지원 | 써머썬 연구소',
  description: '1:1 문의를 남기고 답변을 확인합니다.',
}

export default async function MypageSupportPage() {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/support')}`)
  }

  const supabase = await createClient()

  const [categoriesResult, ticketsResult] = await Promise.all([
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
      .eq('user_id', userId)
      .eq('is_deleted_by_user', false)
      .order('created_at', { ascending: false }),
  ])

  if (categoriesResult.error) {
    throw new Error(categoriesResult.error.message)
  }
  if (ticketsResult.error) {
    throw new Error(ticketsResult.error.message)
  }

  return (
    <Suspense fallback={null}>
      <SupportView
        tickets={ticketsResult.data || []}
        categories={categoriesResult.data || []}
        userId={userId}
      />
    </Suspense>
  )
}
