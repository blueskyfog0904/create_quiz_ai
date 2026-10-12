import Link from 'next/link'
import { StudioContainer } from '@/components/design-system/studio-container'

// (solvook) 그룹 안의 404 화면. 그룹 레이아웃 안에서 그려져 헤더·푸터가 유지된다.
export default function SolvookNotFound() {
  return (
    <StudioContainer className="py-20 text-center">
      <h1 className="text-2xl font-bold text-[var(--studio-ink)]">페이지를 찾을 수 없습니다.</h1>
      <p className="mt-3 text-sm text-[var(--studio-muted)]">주소가 바뀌었거나 더 이상 공개되지 않는 페이지입니다.</p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-11 items-center justify-center rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-5 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        홈으로
      </Link>
    </StudioContainer>
  )
}
