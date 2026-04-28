'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, FileText, Sparkles } from 'lucide-react'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { MarketListboardRow } from '@/lib/market-items-server'

interface MarketBoardPreviewClientProps {
  categorySlug: string
  rows: MarketListboardRow[]
}

type AssetKind = 'pdf' | 'hwp'
const ROWS_PER_PAGE = 15

function formatPublishedDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatExamMeta(row: MarketListboardRow) {
  return [
    row.examYear ? `${row.examYear}년` : null,
    row.examMonth ? `${row.examMonth}월` : null,
    row.gradeLevel,
  ].filter(Boolean).join(' · ') || '시험 정보 미등록'
}

function getSelectionKey(itemId: string, assetKind: AssetKind) {
  return `${itemId}:${assetKind}`
}

function getAssetLabel(assetKind: AssetKind) {
  return assetKind === 'pdf' ? 'PDF' : 'HWP & PDF'
}

export default function MarketBoardPreviewClient({ categorySlug, rows }: MarketBoardPreviewClientProps) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return rows.slice(start, start + ROWS_PER_PAGE)
  }, [currentPage, rows])

  const visiblePageNumbers = useMemo(() => {
    const windowSize = 10
    const start = Math.max(1, Math.floor((currentPage - 1) / windowSize) * windowSize + 1)
    const end = Math.min(totalPages, start + windowSize - 1)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [currentPage, totalPages])

  const selectionSummary = useMemo(() => {
    const selectedSet = new Set(selectedKeys)
    let pdfCount = 0
    let hwpCount = 0
    let totalCredits = 0

    for (const row of rows) {
      const hwpKey = getSelectionKey(row.itemId, 'hwp')
      const pdfKey = getSelectionKey(row.itemId, 'pdf')

      if (selectedSet.has(hwpKey) && row.hwp.available && !row.hwp.owned) {
        hwpCount += 1
        totalCredits += row.hwp.price
        continue
      }

      if (selectedSet.has(pdfKey) && row.pdf.available && !row.pdf.owned) {
        pdfCount += 1
        totalCredits += row.pdf.price
      }
    }

    return {
      pdfCount,
      hwpCount,
      totalCredits,
      totalCount: pdfCount + hwpCount,
    }
  }, [rows, selectedKeys])

  const toggleSelection = (itemId: string, assetKind: AssetKind) => {
    const key = getSelectionKey(itemId, assetKind)
    const counterpartKey = getSelectionKey(itemId, assetKind === 'pdf' ? 'hwp' : 'pdf')

    setSelectedKeys((current) => {
      if (current.includes(key)) {
        return current.filter((value) => value !== key)
      }

      return [...current.filter((value) => value !== counterpartKey), key]
    })
  }

  const renderAssetChoice = (row: MarketListboardRow, assetKind: AssetKind) => {
    const asset = assetKind === 'pdf' ? row.pdf : row.hwp
    const key = getSelectionKey(row.itemId, assetKind)
    const checked = selectedKeys.includes(key) && asset.available && !asset.owned
    const label = getAssetLabel(assetKind)

    if (asset.owned) {
      return (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700">
          {label} 보유
        </span>
      )
    }

    if (!asset.available) {
      return (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-400">
          {label} 미제공
        </span>
      )
    }

    return (
      <button
        type="button"
        className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs transition ${checked ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-50'}`}
        aria-pressed={checked}
        aria-label={`${row.title} ${label} ${asset.price.toLocaleString()} 크레딧 선택`}
        onClick={() => toggleSelection(row.itemId, assetKind)}
      >
        <span className={`h-3.5 w-3.5 rounded-[4px] border ${checked ? 'border-white bg-white shadow-inner' : 'border-slate-300 bg-white'}`}>
          {checked ? <span className="block h-full w-full scale-50 rounded-[2px] bg-slate-950" /> : null}
        </span>
        <span className="whitespace-nowrap font-semibold">{label}</span>
        <span className="whitespace-nowrap text-slate-500 group-data-[selected=true]:text-white">{asset.price.toLocaleString()}C</span>
      </button>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-4 font-semibold text-slate-800">검색 조건에 맞는 자료가 없습니다.</p>
        <p className="mt-2 text-sm text-slate-500">게시판형 디자인 테스트에서도 동일한 검색 결과를 사용합니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-slate-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-950">게시판형 디자인 테스트</p>
          <p className="text-xs text-slate-500">실제 결제 API를 호출하지 않는 시각 확인용 페이지입니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Badge variant="secondary" className="rounded-full">선택 {selectionSummary.totalCount}건</Badge>
          <Badge variant="outline" className="rounded-full">PDF {selectionSummary.pdfCount}건</Badge>
          <Badge variant="outline" className="rounded-full">HWP & PDF {selectionSummary.hwpCount}건</Badge>
          <Badge className="rounded-full bg-slate-950 text-white hover:bg-slate-950">{selectionSummary.totalCredits.toLocaleString()}C</Badge>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-collapse text-sm">
            <thead className="border-t-2 border-slate-950 bg-slate-50 text-slate-700">
              <tr className="border-b">
                <th className="w-[74px] px-3 py-3 text-center text-sm font-bold">번호</th>
                <th className="px-3 py-3 text-left text-sm font-bold">자료명</th>
                <th className="w-[310px] px-3 py-3 text-center text-sm font-bold">파일</th>
                <th className="w-[92px] px-3 py-3 text-center text-sm font-bold">조회</th>
                <th className="w-[126px] px-3 py-3 text-center text-sm font-bold">날짜</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const href = `/market/${categorySlug}/items/${row.itemId}`

                return (
                  <tr key={row.itemId} className="border-b border-slate-200 bg-white transition hover:bg-slate-50/80">
                    <td className="px-3 py-3 text-center text-slate-500">{row.rowNumber}</td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <WorkspaceLink href={href} className="truncate font-semibold text-slate-900 hover:text-slate-600">
                          {row.title}
                        </WorkspaceLink>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span>{formatExamMeta(row)}</span>
                          {row.sample.available ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                              <Sparkles className="h-3 w-3" />샘플
                            </span>
                          ) : null}
                          <span className="rounded-full border px-2 py-0.5 font-medium text-slate-600">PDF · HWP & PDF</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {renderAssetChoice(row, 'pdf')}
                        {renderAssetChoice(row, 'hwp')}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center text-slate-600">
                      <span className="inline-flex items-center justify-center gap-1">
                        <Eye className="h-3.5 w-3.5 text-slate-400" />{row.viewCount.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center text-slate-600">{formatPublishedDate(row.publishedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 sm:flex-row">
        <div className="text-xs text-slate-500">
          총 {rows.length}건 · {currentPage}/{totalPages} 페이지
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(1)} aria-label="첫 페이지">
            첫 페이지
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} aria-label="이전 페이지">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {visiblePageNumbers.map((pageNumber) => (
            <Button key={pageNumber} type="button" variant={pageNumber === currentPage ? 'default' : 'ghost'} size="sm" onClick={() => setCurrentPage(pageNumber)} aria-label={`${pageNumber} 페이지`}>
              {pageNumber}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="icon-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} aria-label="다음 페이지">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)} aria-label="마지막 페이지">
            끝 페이지
          </Button>
        </div>
      </div>
    </div>
  )
}
