import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { createClient } from '@/lib/supabase/server'
import { getSupportPageContent } from '@/lib/support-page-content-server'
import { getSiteBoardLinks } from '@/lib/site-board-server'
import { SupportView } from './_components/support-view'

// 13번 9절: 탭 제목·설명도 DB 문구(pageTitle·pageDescription)다. 읽지 못하면 오류 화면(코드에 기본 문구 없음).
export async function generateMetadata(): Promise<Metadata> {
  const content = await getSupportPageContent()
  return {
    title: content.member.pageTitle,
    ...(content.member.pageDescription ? { description: content.member.pageDescription } : {}),
  }
}

export default async function MypageSupportPage() {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/support')}`)
  }

  const supabase = await createClient()

  const [categoriesResult, ticketsResult, content, boardLinks] = await Promise.all([
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
    // 읽기 실패·필수 문구 없음은 예외 → 오류 화면(카테고리·문의를 읽지 못했을 때와 같다)
    getSupportPageContent(),
    // 14번: FAQ 게시 글이 있을 때만 '자주 묻는 질문' 링크(읽기 실패면 링크만 뺀다)
    getSiteBoardLinks(),
  ])
  const faqLink = boardLinks?.links.find((link) => link.key === 'faq') ?? null

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
        texts={content.member}
        faqLink={faqLink ? { href: faqLink.href, label: faqLink.label } : null}
      />
    </Suspense>
  )
}
