'use client'

import { useId } from 'react'
import { StudioPagination } from './studio-pagination'
import { LIST_PAGE_SIZES } from '@/lib/list-pagination'

export function StudioListPagination({
  page, pageSize, totalCount, onPageChange, onPageSizeChange, getPageHref,
}: {
  page: number
  pageSize: number
  totalCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  getPageHref?: (page: number) => string
}) {
  const id = useId()
  const totalPages = Math.ceil(totalCount / pageSize)
  return (
    <div className="studio-theme mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p aria-live="polite">총 {totalCount.toLocaleString()}개{totalCount > 0 ? ` · ${page} / ${totalPages} 페이지` : ''}</p>
        <div className="flex items-center gap-2">
          <label htmlFor={id}>표시 개수</label>
          <select id={id} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}개</option>)}
          </select>
        </div>
      </div>
      {totalPages > 1 && <StudioPagination page={page} totalPages={totalPages} onPageChange={onPageChange} getPageHref={getPageHref} />}
    </div>
  )
}
