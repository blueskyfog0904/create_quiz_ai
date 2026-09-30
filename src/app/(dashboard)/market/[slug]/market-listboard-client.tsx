'use client'

import { useMemo, useRef, useState } from 'react'
import { FileSearch, FileText } from 'lucide-react'
import {
  StudioEmptyState,
} from '@/components/design-system'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { useListQuery } from '@/hooks/use-list-query'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import { Button } from '@/components/ui/button'
import type { MarketListboardRow } from '@/lib/market-items-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import MarketSamplePreviewDialog from './items/[itemId]/market-sample-preview-dialog'

interface MarketListboardClientProps {
  categorySlug: string
  workspaceSubject: WorkspaceSubject
  rows: MarketListboardRow[]
  isLoggedIn: boolean
}

function formatPublishedDate(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

export default function MarketListboardClient({ categorySlug, workspaceSubject, rows }: MarketListboardClientProps) {
  const listQuery = useListQuery()
  const { page: currentPage, pageSize: rowsPerPage, setPage: setCurrentPage } = listQuery
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)
  const sampleTriggerRef = useRef<HTMLButtonElement | null>(null)

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))
  const activePage = Math.min(currentPage, totalPages)

  const pagedRows = useMemo(() => {
    const start = (activePage - 1) * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [activePage, rows, rowsPerPage])

  const prefetchSamplePreview = (itemId: string) => {
    setSamplePreviewItemId(itemId)
    setSamplePreviewPrefetchKey((key) => key + 1)
  }

  const openSamplePreview = (itemId: string, trigger: HTMLButtonElement) => {
    sampleTriggerRef.current = trigger
    setSamplePreviewItemId(itemId)
    setIsSamplePreviewOpen(true)
  }

  const renderSamplePreviewButton = (row: MarketListboardRow) => {
    if (!row.sample.available) {
      return (
        <span
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]"
          aria-label={`${row.title} 샘플 없음`}
          title="샘플 없음"
        >
          <FileSearch className="h-4 w-4" aria-hidden="true" />
        </span>
      )
    }

    return (
      <button
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--studio-control-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] transition hover:border-[var(--studio-primary)] hover:bg-[var(--studio-primary-soft)] hover:text-[var(--studio-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
        aria-label={`${row.title} 샘플보기`}
        title="샘플보기"
        onFocus={() => prefetchSamplePreview(row.itemId)}
        onMouseEnter={() => prefetchSamplePreview(row.itemId)}
        onClick={(event) => openSamplePreview(row.itemId, event.currentTarget)}
      >
        <FileSearch className="h-4 w-4" aria-hidden="true" />
      </button>
    )
  }

  if (rows.length === 0) {
    return (
      <StudioEmptyState
        icon={<FileText className="size-6" />}
        title="검색 조건에 맞는 자료가 없습니다."
        description="검색 조건을 초기화해보세요."
        action={(
          <Button asChild variant="brandOutline">
            <WorkspaceLink href={`/market/${categorySlug}`}>검색 조건 초기화</WorkspaceLink>
          </Button>
        )}
      />
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
        <div className="overflow-x-auto sm:overflow-visible">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="border-t-2 border-[var(--studio-ink)] bg-[var(--studio-background)] text-[var(--studio-text)]">
              <tr className="border-b border-[var(--studio-border)]">
                <th className="w-[46px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[64px] sm:px-3">번호</th>
                <th className="px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:px-3">자료명</th>
                <th className="w-[52px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[72px] sm:px-3">샘플</th>
                <th className="w-[58px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[78px] sm:px-3">조회</th>
                <th className="w-[88px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[112px] sm:px-3">날짜</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const href = `/market/${categorySlug}/items/${row.itemId}`

                return (
                  <tr key={row.itemId} className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)] transition hover:bg-[var(--studio-primary-soft)]">
                    <td className="px-2 py-2 text-center text-[var(--studio-muted)] whitespace-nowrap sm:px-3">{row.rowNumber}</td>
                    <td className="min-w-0 px-2 py-2 sm:px-3">
                      <div className="flex min-w-0 items-center">
                        <WorkspaceLink href={href} className="block min-w-0 truncate font-semibold text-[var(--studio-ink)] hover:text-[var(--studio-primary)]">
                          {row.title}
                        </WorkspaceLink>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center sm:px-3">
                      {renderSamplePreviewButton(row)}
                    </td>
                    <td className="px-2 py-2 text-center text-[var(--studio-text)] sm:px-3">
                      {row.viewCount.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-center text-[var(--studio-text)] sm:px-3">{formatPublishedDate(row.publishedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <StudioListPagination page={activePage} pageSize={rowsPerPage} totalCount={rows.length} onPageChange={setCurrentPage} onPageSizeChange={listQuery.setPageSize} />

      {samplePreviewItemId ? (
        <MarketSamplePreviewDialog
          key={samplePreviewItemId}
          itemId={samplePreviewItemId}
          workspaceSubject={workspaceSubject}
          open={isSamplePreviewOpen}
          prefetchKey={samplePreviewPrefetchKey}
          onOpenChange={setIsSamplePreviewOpen}
          returnFocusRef={sampleTriggerRef}
        />
      ) : null}
    </>
  )
}
