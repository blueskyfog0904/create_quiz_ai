import type { Metadata } from 'next'
import Link from 'next/link'
import { StudioContainer, StudioEmptyState, StudioPageHeader } from '@/components/design-system'
import { SUPPORT_PATH, groupFaqPosts } from '@/lib/site-board'
import { getAllPublishedFaqs, getSiteBoardContent } from '@/lib/site-board-server'
import { FaqView, type FaqViewGroup } from './_components/faq-view'

// 14번 8절: 자주 묻는 질문. 게시 FAQ 를 쪽 나눔 없이 한 번에 읽고, 분류 순서(설정 categories) → 분류 안 순서로 묶는다.
// 화면 문구·분류 이름은 모두 DB(site_board_content.faq)다. 조회 기록을 쓰지 않는다.
export async function generateMetadata(): Promise<Metadata> {
  const content = await getSiteBoardContent()
  return { title: content.faq.pageTitle, description: content.faq.pageDescription }
}

const supportLinkClassName =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-5 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

export default async function FaqPage() {
  const content = await getSiteBoardContent()
  const faqs = await getAllPublishedFaqs(content.faq.categories)
  // 게시 글이 0개인 분류 탭은 숨긴다.
  const groups: FaqViewGroup[] = groupFaqPosts(faqs, content.faq.categories)
    .filter((group) => group.posts.length > 0)
    .map((group) => ({
      key: group.category.key,
      label: group.category.label,
      posts: group.posts.map((post) => ({ id: post.id, title: post.title, body: post.body, linkUrl: post.linkUrl, linkLabel: post.linkLabel })),
    }))

  return (
    <>
      <StudioPageHeader title={content.faq.pageTitle} description={content.faq.pageDescription} />
      <StudioContainer className="py-8 sm:py-10">
        {groups.length === 0 ? (
          <StudioEmptyState
            title={content.faq.emptyTitle}
            description={content.faq.supportPrompt}
            action={<Link href={SUPPORT_PATH}>{content.faq.supportLinkLabel}</Link>}
          />
        ) : (
          <div className="flex flex-col gap-10">
            <FaqView groups={groups} allLabel={content.faq.allCategoryLabel} />
            <div className="flex flex-col items-start gap-3 border-t border-[var(--studio-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="break-keep text-sm text-[var(--studio-muted)]">{content.faq.supportPrompt}</p>
              <Link href={SUPPORT_PATH} className={supportLinkClassName}>{content.faq.supportLinkLabel}</Link>
            </div>
          </div>
        )}
      </StudioContainer>
    </>
  )
}
