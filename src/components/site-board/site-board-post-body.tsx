import Link from 'next/link'
import { PolicyDocumentContent } from '@/components/legal/policy-document-content'
import { isAllowedSiteBoardLink } from '@/lib/site-board'

// 14번: 공지·FAQ 회원 그리기 부품 하나(공지 상세·FAQ 답·관리자 미리보기가 같이 쓴다).
// 본문은 서식 없는 글(문단·'- ' 목록·'## ' 소제목) — 약관 화면과 같은 그리기라 HTML 을 넣지 않는다. 링크는 사이트 안 주소 1개(선택).
interface SiteBoardPostBodyProps {
  body: string
  linkUrl: string | null
  linkLabel: string | null
}

export function SiteBoardPostBody({ body, linkUrl, linkLabel }: SiteBoardPostBodyProps) {
  const showLink = Boolean(linkUrl && linkLabel && isAllowedSiteBoardLink(linkUrl))
  return (
    <div className="flex flex-col gap-5 break-keep">
      <PolicyDocumentContent content={body} />
      {showLink ? (
        <div>
          <Link
            href={linkUrl as string}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-5 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            {linkLabel}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

const KST_DATE = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })

// 게시일·수정일(한국 날짜). 값이 없거나 깨졌으면 빈 글.
export function formatSiteBoardDate(iso: string | null) {
  const ms = iso ? Date.parse(iso) : Number.NaN
  return Number.isFinite(ms) ? KST_DATE.format(new Date(ms)) : ''
}
