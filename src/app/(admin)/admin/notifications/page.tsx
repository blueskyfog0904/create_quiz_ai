import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { readMemberNotificationTextsForAdmin } from '@/lib/member-notifications-server'
import { readBroadcastTermsOptions, readMemberBroadcastHistory, readPublishedNoticeOptions } from '@/lib/member-broadcast-server'
import { readPiiAllowedContacts } from '@/lib/site-board-server'
import { NotificationsAdmin, type NotificationsAdminTab } from './notifications-admin'

export const dynamic = 'force-dynamic'

interface AdminNotificationsPageProps {
  searchParams?: Promise<{ tab?: string; postId?: string }>
}

const TABS: readonly NotificationsAdminTab[] = ['texts', 'broadcast', 'history']

// 16번 7절: 회원 알림 문구·공지 알림 보내기·보낸 기록(대표만, Q1). 쓰기는 서버 액션 → DB 함수만.
// 14번 공지 편집 창의 [이 공지로 알림 보내기]가 ?tab=broadcast&postId=… 로 연다.
export default async function AdminNotificationsPage({ searchParams }: AdminNotificationsPageProps) {
  await requireAdminPagePermission('owner')
  const params = searchParams ? await searchParams : {}
  const [texts, history, notices, terms, piiAllowed] = await Promise.all([
    readMemberNotificationTextsForAdmin(),
    readMemberBroadcastHistory(),
    readPublishedNoticeOptions(),
    readBroadcastTermsOptions(),
    readPiiAllowedContacts(),
  ])
  const tab = TABS.includes(params.tab as NotificationsAdminTab) ? (params.tab as NotificationsAdminTab) : 'texts'
  const postId = typeof params.postId === 'string' ? params.postId.toLowerCase() : null
  return (
    <NotificationsAdmin
      texts={texts}
      history={history}
      notices={notices}
      terms={terms}
      piiAllowed={piiAllowed}
      initialTab={tab}
      initialPostId={postId && notices.some((notice) => notice.id === postId) ? postId : null}
    />
  )
}
