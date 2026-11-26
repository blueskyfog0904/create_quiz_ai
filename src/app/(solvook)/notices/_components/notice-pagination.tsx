'use client'

import { StudioPagination } from '@/components/design-system'

// 공지 목록 쪽 나눔(링크로 이동 — 주소 ?page=N, 1쪽은 쿼리 없음).
export function NoticePagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null
  return (
    <StudioPagination
      page={page}
      totalPages={totalPages}
      onPageChange={() => undefined}
      getPageHref={(target) => (target <= 1 ? '/notices' : `/notices?page=${target}`)}
    />
  )
}
