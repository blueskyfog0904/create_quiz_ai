import Link from 'next/link'
import { cn } from '@/lib/utils'

// 16번 6절: 벨·알림 목록 항목의 모양(동작 없음). 관리자 '알림' 화면 미리보기도 같은 부품을 쓴다.
// 공지 알림(type = 'announcement')에는 머리표(DB broadcast.memberLabel)를 글자로 붙인다. 머리표를 못 읽으면 붙이지 않는다.

export const ANNOUNCEMENT_NOTIFICATION_TYPE = 'announcement'

export interface NotificationItemData {
  title: string
  message: string
  type?: string | null
  link?: string | null
  is_read?: boolean | null
  created_at?: string | null
}

export function NotificationHeadTag({ type, memberLabel, className }: { type?: string | null; memberLabel?: string | null; className?: string }) {
  if (type !== ANNOUNCEMENT_NOTIFICATION_TYPE || !memberLabel) return null
  return (
    <span className={cn('mr-1.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold leading-none bg-gray-900 text-white', className)}>
      {memberLabel}
    </span>
  )
}

// 헤더 벨 팝오버 한 항목의 글(제목·내용·날짜). 클릭·읽음 처리는 벨이 한다.
export function NotificationBellItemBody({ notification, memberLabel }: { notification: NotificationItemData; memberLabel?: string | null }) {
  return (
    <div className="space-y-1">
      <p className={cn('text-sm font-medium', !notification.is_read && 'text-blue-700')}>
        <NotificationHeadTag type={notification.type} memberLabel={memberLabel} />
        {notification.title}
      </p>
      <p className="text-xs text-gray-500 line-clamp-2">
        {notification.message}
      </p>
      {notification.created_at ? (
        <p className="text-[10px] text-gray-400">
          {new Date(notification.created_at).toLocaleDateString()}
        </p>
      ) : null}
    </div>
  )
}

// /mypage/notifications 목록 한 항목의 글(조회만). 날짜 글은 부르는 쪽이 만든다(한국 시간).
export function NotificationListItemBody({
  notification,
  memberLabel,
  createdAtLabel,
  linkClassName,
}: {
  notification: NotificationItemData
  memberLabel?: string | null
  createdAtLabel: string | null
  linkClassName?: string
}) {
  return (
    <>
      <p className="text-base font-semibold text-[var(--studio-ink)] break-keep">
        <NotificationHeadTag type={notification.type} memberLabel={memberLabel} />
        {notification.title}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--studio-text)]">{notification.message}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--studio-muted)]">
        {createdAtLabel ? <span>{createdAtLabel}</span> : null}
        {notification.link ? (
          <Link href={notification.link} className={linkClassName}>
            바로가기 →
          </Link>
        ) : null}
      </p>
    </>
  )
}
