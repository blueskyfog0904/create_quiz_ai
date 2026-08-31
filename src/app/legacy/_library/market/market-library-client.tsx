'use client'

import { useMemo, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import type { MarketLibraryRow } from '@/lib/market-items-server'
import { withWorkspacePrefix, type WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketLibraryClientProps {
  rows: MarketLibraryRow[]
  workspaceSubject: WorkspaceSubject
  browseMarketHref: string
}

type SortOption = 'latest' | 'name'
type RefundTarget = MarketLibraryRow['refundTargets'][number]

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

export default function MarketLibraryClient({
  rows,
  workspaceSubject,
  browseMarketHref,
}: MarketLibraryClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('latest')
  const [refundSubmitting, setRefundSubmitting] = useState<string | null>(null)

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const nextRows = rows.filter((row) => {
      if (keyword && !(`${row.title} ${row.categoryTitle} ${row.summary || ''}`.toLowerCase().includes(keyword))) {
        return false
      }

      return true
    })

    nextRows.sort((a, b) => {
      if (sort === 'name') {
        return a.title.localeCompare(b.title, 'ko')
      }
      return b.purchasedAt.localeCompare(a.purchasedAt)
    })

    return nextRows
  }, [rows, search, sort])

  const purchaseOrderByItemId = useMemo(() => {
    const orderedRows = rows.slice().sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))
    return new Map(orderedRows.map((row, index) => [row.itemId, index + 1]))
  }, [rows])

  const navigateToDetail = (detailHref: string | null) => {
    if (!detailHref) return
    router.push(withWorkspacePrefix(workspaceSubject, detailHref))
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, detailHref: string | null) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      navigateToDetail(detailHref)
    }
  }

  const handleRefundRequest = async (
    event: MouseEvent<HTMLButtonElement>,
    target: RefundTarget
  ) => {
    event.stopPropagation()

    if (target.status !== 'available') {
      alert(target.reason ?? '현재 환불 신청할 수 없습니다.')
      return
    }

    if (!confirm(`${target.label} 환불을 신청하시겠습니까?`)) {
      return
    }

    setRefundSubmitting(target.targetId)
    try {
      const response = await fetch('/api/market/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetKind: target.targetKind,
          targetId: target.targetId,
        }),
      })
      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        throw new Error(result?.error?.message ?? '환불 신청 처리에 실패했습니다.')
      }

      alert('환불 신청이 접수되었습니다.')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : '환불 신청 처리에 실패했습니다.')
    } finally {
      setRefundSubmitting(null)
    }
  }

  const downloadableCount = rows.filter((row) => row.pdfAvailable || row.hwpAvailable || row.zipAvailable).length
  const v2DownloadableCount = rows.filter((row) => row.v2DownloadFiles.length > 0).length
  const latestPurchaseDate = rows.length > 0 ? rows.map((row) => row.purchasedAt).sort((a, b) => b.localeCompare(a))[0] : null

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">문제마켓 관리</h1>
          <p className="mt-2 text-gray-500">구매한 문제마켓 상품과 다운로드 가능한 파일을 관리합니다.</p>
        </div>
        <Button asChild>
          <WorkspaceLink href={browseMarketHref} subject={workspaceSubject}>문제마켓 둘러보기</WorkspaceLink>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">총 구매 상품</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">다운로드 가능 상품</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">{downloadableCount + v2DownloadableCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">최근 구매일</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold text-gray-900">{formatDate(latestPurchaseDate)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>검색 / 정렬</CardTitle>
          <CardDescription>상품명 검색과 최소 필터를 제공합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),180px]">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 검색" />
            <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
              <option value="latest">최근 구매순</option>
              <option value="name">이름순</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>구매 내역</CardTitle>
          <CardDescription>총 {filteredRows.length}건</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredRows.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-gray-500">
              <p className="font-medium">아직 구매한 문제마켓 상품이 없습니다.</p>
              <p className="mt-2 text-sm">문제마켓에서 필요한 자료를 구매하면 이곳에서 다시 다운로드할 수 있습니다.</p>
              <Button asChild className="mt-4">
                <WorkspaceLink href={browseMarketHref} subject={workspaceSubject}>문제마켓 보러가기</WorkspaceLink>
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-white">
              <div className="overflow-x-auto sm:overflow-visible">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead className="border-t-2 border-slate-950 bg-slate-50 text-slate-700">
                    <tr className="border-b">
                      <th className="w-[46px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[64px] sm:px-3">번호</th>
                      <th className="w-[96px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[120px] sm:px-3">카테고리</th>
                      <th className="px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:px-3">상품 정보</th>
                      <th className="w-[88px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[112px] sm:px-3">구매일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => {
                      const detailHref = row.categorySlug ? `/market/${row.categorySlug}/items/${row.itemId}` : null
                      const refundTarget = row.refundTargets.find((target) => target.status === 'available')
                        ?? null

                      return (
                        <tr
                          key={row.itemId}
                          role={detailHref ? 'link' : undefined}
                          tabIndex={detailHref ? 0 : undefined}
                          onClick={() => navigateToDetail(detailHref)}
                          onKeyDown={(event) => handleRowKeyDown(event, detailHref)}
                          className={`border-b border-slate-200 bg-white transition hover:bg-slate-50/80 ${detailHref ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900' : ''}`}
                        >
                          <td className="px-2 py-2 text-center text-slate-500 whitespace-nowrap sm:px-3">{purchaseOrderByItemId.get(row.itemId) ?? index + 1}</td>
                          <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap sm:px-3">{row.categoryTitle}</td>
                          <td className="min-w-0 px-2 py-2 sm:px-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {detailHref ? (
                                  <WorkspaceLink
                                    href={detailHref}
                                    subject={workspaceSubject}
                                    className="min-w-0 truncate font-semibold text-slate-900 hover:text-slate-600"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    {row.title}
                                  </WorkspaceLink>
                                ) : (
                                  <span className="min-w-0 truncate font-semibold text-slate-900">{row.title}</span>
                                )}
                                {refundTarget && (
                                  <Button
                                    key={`${refundTarget.targetKind}:${refundTarget.targetId}`}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    disabled={refundSubmitting === refundTarget.targetId}
                                    title={refundTarget.reason ?? undefined}
                                    onClick={(event) => handleRefundRequest(event, refundTarget)}
                                  >
                                    환불 신청
                                  </Button>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-center text-slate-600 sm:px-3">{formatDate(row.purchasedAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
