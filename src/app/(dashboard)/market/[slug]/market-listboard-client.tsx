'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileSearch, FileText } from 'lucide-react'
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

const PER_PAGE_OPTIONS = [10, 20, 30] as const

function formatPublishedDate(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

export default function MarketListboardClient({ categorySlug, workspaceSubject, rows }: MarketListboardClientProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState<number>(10)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))
  const activePage = Math.min(currentPage, totalPages)

  const pagedRows = useMemo(() => {
    const start = (activePage - 1) * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [activePage, rows, rowsPerPage])

  const visiblePageNumbers = useMemo(() => {
    const windowSize = 5
    const start = Math.max(1, activePage - 2)
    const end = Math.min(totalPages, start + windowSize - 1)
    const adjustedStart = Math.max(1, end - windowSize + 1)
    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index)
  }, [activePage, totalPages])

  const prefetchSamplePreview = (itemId: string) => {
    setSamplePreviewItemId(itemId)
    setSamplePreviewPrefetchKey((key) => key + 1)
  }

  const openSamplePreview = (itemId: string) => {
    setSamplePreviewItemId(itemId)
    setIsSamplePreviewOpen(true)
  }

  const renderSamplePreviewButton = (row: MarketListboardRow) => {
    if (!row.sample.available) {
      return (
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-300"
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-500 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
        aria-label={`${row.title} 샘플보기`}
        title="샘플보기"
        onFocus={() => prefetchSamplePreview(row.itemId)}
        onMouseEnter={() => prefetchSamplePreview(row.itemId)}
        onClick={() => openSamplePreview(row.itemId)}
      >
        <FileSearch className="h-4 w-4" aria-hidden="true" />
      </button>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-4 font-semibold text-slate-800">검색 조건에 맞는 자료가 없습니다.</p>
        <p className="mt-2 text-sm text-slate-500">검색 조건을 초기화해보세요.</p>
        <Button asChild variant="outline" className="mt-5">
          <WorkspaceLink href={`/market/${categorySlug}`}>검색 조건 초기화</WorkspaceLink>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="overflow-x-auto sm:overflow-visible">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="border-t-2 border-slate-950 bg-slate-50 text-slate-700">
              <tr className="border-b">
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
                  <tr key={row.itemId} className="border-b border-slate-200 bg-white transition hover:bg-slate-50/80">
                    <td className="px-2 py-2 text-center text-slate-500 whitespace-nowrap sm:px-3">{row.rowNumber}</td>
                    <td className="min-w-0 px-2 py-2 sm:px-3">
                      <div className="flex min-w-0 items-center">
                        <WorkspaceLink href={href} className="block min-w-0 truncate font-semibold text-slate-900 hover:text-slate-600">
                          {row.title}
                        </WorkspaceLink>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center sm:px-3">
                      {renderSamplePreviewButton(row)}
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 sm:px-3">
                      {row.viewCount.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-center text-slate-600 sm:px-3">{formatPublishedDate(row.publishedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 space-y-4 pb-[env(safe-area-inset-bottom)]">
        <div className="grid gap-3 rounded-xl border bg-white px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="text-center text-xs text-slate-500 md:text-left">
            총 {rows.length}건 · {activePage}/{totalPages} 페이지
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 justify-self-center">
            <Button type="button" variant="ghost" size="sm" disabled={activePage === 1} onClick={() => setCurrentPage(1)} aria-label="첫 페이지">
              첫 페이지
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={activePage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} aria-label="이전 페이지">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {visiblePageNumbers.map((pageNumber) => (
              <Button key={pageNumber} type="button" variant={pageNumber === activePage ? 'default' : 'ghost'} size="sm" onClick={() => setCurrentPage(pageNumber)} aria-label={`${pageNumber} 페이지`}>
                {pageNumber}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="icon-sm" disabled={activePage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} aria-label="다음 페이지">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={activePage === totalPages} onClick={() => setCurrentPage(totalPages)} aria-label="마지막 페이지">
              끝 페이지
            </Button>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600 md:justify-end">
            <label htmlFor="market-rows-per-page">표시 개수</label>
            <select
              id="market-rows-per-page"
              value={rowsPerPage}
              onChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setCurrentPage(1)
              }}
              className="flex h-9 rounded-md border bg-white px-3 text-sm"
            >
              {PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {samplePreviewItemId ? (
        <MarketSamplePreviewDialog
          key={samplePreviewItemId}
          itemId={samplePreviewItemId}
          workspaceSubject={workspaceSubject}
          open={isSamplePreviewOpen}
          prefetchKey={samplePreviewPrefetchKey}
          onOpenChange={setIsSamplePreviewOpen}
        />
      ) : null}
    </>
  )
}
