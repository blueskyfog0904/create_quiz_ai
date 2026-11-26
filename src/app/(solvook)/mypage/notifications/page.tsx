import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { createClient } from '@/lib/supabase/server'
import { getListPagination } from '@/lib/list-pagination'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { NotificationListItemBody } from '@/components/notifications/notification-item'
import { getMemberNotificationTexts } from '@/lib/member-notifications-server'

export const metadata: Metadata = {
  title: '알림',
  description: '받은 알림 전체를 확인합니다.',
}

function formatKoreanDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const pageLinkClassName =
  'inline-flex min-h-11 items-center rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-4 text-sm font-medium text-[var(--studio-ink)] outline-none transition-colors hover:border-[var(--studio-primary-border)] hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

// 조회만 한다. 읽음 처리는 헤더 벨이 맡는다.
export default async function MypageNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/notifications')}`)
  }

  const supabase = await createClient()
  const { count, error: countError } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countError) {
    throw new Error(countError.message)
  }

  const { page: requestedPage } = await searchParams
  const pagination = getListPagination(count ?? 0, requestedPage, undefined)

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('id, title, message, link, type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id')
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1)

  if (error) {
    throw new Error(error.message)
  }

  // 16번: 공지 알림 머리표(DB 문구). 읽지 못하면 머리표 없이 보인다.
  const memberLabel = (await getMemberNotificationTexts())?.broadcast.memberLabel ?? null

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">알림</h1>

      {pagination.totalCount === 0 ? (
        <div className="mt-6">
          <StudioEmptyState
            title="알림이 없습니다"
            description="아직 받은 알림이 없습니다."
          />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--studio-border)] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
          {(notifications ?? []).map((notification) => (
            <li key={notification.id} className="px-4 py-4 sm:px-5">
              <NotificationListItemBody
                notification={notification}
                memberLabel={memberLabel}
                createdAtLabel={notification.created_at ? formatKoreanDateTime(notification.created_at) : null}
                linkClassName="font-semibold text-[var(--studio-primary)] outline-none transition-colors hover:text-[var(--studio-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              />
            </li>
          ))}
        </ul>
      )}

      {pagination.totalPages > 1 ? (
        <nav aria-label="알림 페이지" className="mt-6 flex items-center justify-between gap-3">
          {pagination.page > 1 ? (
            <Link href={`/mypage/notifications?page=${pagination.page - 1}`} className={pageLinkClassName}>
              이전
            </Link>
          ) : <span />}
          <p className="text-sm text-[var(--studio-muted)]">
            {pagination.page} / {pagination.totalPages} 페이지
          </p>
          {pagination.page < pagination.totalPages ? (
            <Link href={`/mypage/notifications?page=${pagination.page + 1}`} className={pageLinkClassName}>
              다음
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  )
}
