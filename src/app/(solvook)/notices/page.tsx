import type { Metadata } from 'next'
import Link from 'next/link'
import { StudioContainer, StudioEmptyState, StudioPageHeader } from '@/components/design-system'
import { formatSiteBoardDate } from '@/components/site-board/site-board-post-body'
import { normalizeListPage } from '@/lib/list-pagination'
import { noticePath, type SiteBoardPost } from '@/lib/site-board'
import { getNoticePage, getSiteBoardContent } from '@/lib/site-board-server'
import { NoticePagination } from './_components/notice-pagination'

// 14번 8절: 공지 목록. 화면 문구는 모두 DB(site_board_content.notice)다 — 읽지 못하면 오류 화면(코드에 기본 문구 없음).
// 고정 글은 첫 쪽 위에 따로, 그 아래 비고정 글을 게시일 최신순으로(쪽 나눔은 비고정 글로만). 조회 기록을 쓰지 않는다.
export async function generateMetadata(): Promise<Metadata> {
  const content = await getSiteBoardContent()
  return { title: content.notice.pageTitle, description: content.notice.pageDescription }
}

function NoticeRow({ post, pinnedLabel }: { post: SiteBoardPost; pinnedLabel: string | null }) {
  return (
    <li className="border-b border-[var(--studio-border)] last:border-b-0">
      <Link
        href={noticePath(post.id)}
        className="flex min-h-14 flex-col gap-1 px-1 py-3 outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <span className="flex min-w-0 items-start gap-2">
          {pinnedLabel ? (
            <span className="mt-0.5 shrink-0 rounded-full bg-[var(--studio-primary)] px-2 py-0.5 text-xs font-bold text-white">
              {pinnedLabel}
            </span>
          ) : null}
          <span className="min-w-0 break-keep font-semibold text-[var(--studio-ink)] [overflow-wrap:anywhere]">{post.title}</span>
        </span>
        <span className="shrink-0 text-sm text-[var(--studio-muted)]">{formatSiteBoardDate(post.publishedAt)}</span>
      </Link>
    </li>
  )
}

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { page } = await searchParams
  const [content, data] = await Promise.all([
    getSiteBoardContent(),
    getNoticePage(normalizeListPage(Array.isArray(page) ? page[0] : page)),
  ])
  const empty = data.pinned.length === 0 && data.totalCount === 0

  return (
    <>
      <StudioPageHeader title={content.notice.pageTitle} description={content.notice.pageDescription} />
      <StudioContainer className="py-8 sm:py-10">
        {empty ? (
          <StudioEmptyState title={content.notice.emptyTitle} description={content.notice.emptyDescription} />
        ) : (
          <div className="flex flex-col gap-6">
            <ul className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-4 sm:px-6">
              {data.pinned.map((post) => (
                <NoticeRow key={post.id} post={post} pinnedLabel={content.notice.pinnedLabel} />
              ))}
              {data.items.map((post) => (
                <NoticeRow key={post.id} post={post} pinnedLabel={null} />
              ))}
            </ul>
            <NoticePagination page={data.page} totalPages={data.totalPages} />
          </div>
        )}
      </StudioContainer>
    </>
  )
}
