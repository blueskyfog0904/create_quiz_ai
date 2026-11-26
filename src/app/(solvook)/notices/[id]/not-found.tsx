import Link from 'next/link'
import { StudioContainer } from '@/components/design-system'
import { NOTICE_LIST_PATH } from '@/lib/site-board'
import { getSiteBoardContent } from '@/lib/site-board-server'

// 14번 8절: 공지 상세 전용 not-found(없는·숨김·삭제 글, 팝업 링크가 끊긴 경우). 문구는 DB(notFoundTitle·notFoundDescription·backToListLabel).
export default async function NoticeNotFound() {
  const content = await getSiteBoardContent()
  return (
    <StudioContainer className="py-20 text-center">
      <h1 className="text-2xl font-bold text-[var(--studio-ink)]">{content.notice.notFoundTitle}</h1>
      <p className="mx-auto mt-3 max-w-lg break-keep text-sm text-[var(--studio-muted)]">{content.notice.notFoundDescription}</p>
      <Link
        href={NOTICE_LIST_PATH}
        className="mt-8 inline-flex min-h-11 items-center justify-center rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-5 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        {content.notice.backToListLabel}
      </Link>
    </StudioContainer>
  )
}
