import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StudioContainer } from '@/components/design-system'
import { SiteBoardPostBody, formatSiteBoardDate } from '@/components/site-board/site-board-post-body'
import { NOTICE_LIST_PATH } from '@/lib/site-board'
import { getNotice, getSiteBoardContent } from '@/lib/site-board-server'

// 14번 8절: 공지 상세. 없는·숨김·삭제 글은 이 경로 전용 not-found(DB 문구). 가린 글은 게시할 수 없어 회원 화면에 나오지 않는다.
// 게시 뒤 제목·본문·링크가 바뀌었으면 '수정' 날짜를 함께 보인다.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const [content, post] = await Promise.all([getSiteBoardContent(), getNotice(id)])
  return { title: post ? post.title : content.notice.notFoundTitle }
}

export default async function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [content, post] = await Promise.all([getSiteBoardContent(), getNotice(id)])
  if (!post) notFound()

  const updated = post.contentUpdatedAt ? formatSiteBoardDate(post.contentUpdatedAt) : ''
  return (
    <StudioContainer className="py-8 sm:py-12">
      <article className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="border-b border-[var(--studio-border)] pb-5">
          <h1 className="break-keep text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)] [overflow-wrap:anywhere] sm:text-3xl">
            {post.title}
          </h1>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--studio-muted)]">
            <time dateTime={post.publishedAt ?? undefined}>{formatSiteBoardDate(post.publishedAt)}</time>
            {updated ? (
              <span>
                {content.notice.updatedLabel} <time dateTime={post.contentUpdatedAt ?? undefined}>{updated}</time>
              </span>
            ) : null}
          </p>
        </header>
        <SiteBoardPostBody body={post.body} linkUrl={post.linkUrl} linkLabel={post.linkLabel} />
        <div className="border-t border-[var(--studio-border)] pt-5">
          <Link
            href={NOTICE_LIST_PATH}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-5 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            {content.notice.backToListLabel}
          </Link>
        </div>
      </article>
    </StudioContainer>
  )
}
