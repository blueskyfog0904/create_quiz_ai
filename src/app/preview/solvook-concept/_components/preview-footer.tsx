import Image from 'next/image'
import Link from 'next/link'
import { StudioContainer } from '@/components/design-system'

const previewRoot = '/preview/solvook-concept'
const boardHref = `${previewRoot}/boards/ebs-literature`

export function PreviewFooter() {
  return (
    <footer className="studio-reference-gutter mt-auto border-t border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <StudioContainer className="grid gap-8 py-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Link
            href={previewRoot}
            className="inline-flex min-h-11 min-w-11 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
          >
            <Image
              src="/preview/solvook-concept/brand-mark.svg"
              alt=""
              aria-hidden="true"
              width={34}
              height={34}
            />
            <span className="font-extrabold tracking-[-0.02em] text-[var(--studio-ink)]">
              써머썬 스튜디오
            </span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-6 text-[var(--studio-muted)]">
            수업에 필요한 지문과 문제를 탐색하고, 나만의 시험 자료로 연결하는
            선생님용 워크스페이스 시안입니다.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-bold text-[var(--studio-ink)]">자료 탐색</h2>
          <nav aria-label="푸터 자료 탐색" className="mt-3 flex flex-col items-start gap-2 text-sm">
            <Link
              className="inline-flex min-h-11 min-w-11 items-center rounded-md outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              href={boardHref}
            >
              EBS 국어 문학
            </Link>
            <Link
              className="inline-flex min-h-11 min-w-11 items-center rounded-md outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              href={`${boardHref}?sort=latest`}
            >
              최근 등록 자료
            </Link>
            <Link
              className="inline-flex min-h-11 min-w-11 items-center rounded-md outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              href={`${boardHref}?view=question-bank`}
            >
              문제은행
            </Link>
          </nav>
        </div>

        <div>
          <h2 className="text-sm font-bold text-[var(--studio-ink)]">시안 안내</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--studio-muted)]">
            이 페이지는 디자인 검토용 정적 프리뷰이며 실제 구매·저장 기능은
            연결되어 있지 않습니다.
          </p>
        </div>
      </StudioContainer>

      <div className="border-t border-[var(--studio-border)]">
        <StudioContainer className="flex flex-col gap-2 py-5 text-xs text-[var(--studio-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 써머썬 스튜디오. Preview concept.</p>
          <p>독자 제작 브랜드·합성 콘텐츠 사용</p>
        </StudioContainer>
      </div>
    </footer>
  )
}
