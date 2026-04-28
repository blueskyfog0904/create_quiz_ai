'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { MarketLibraryRow } from '@/lib/market-items-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketLibraryClientProps {
  rows: MarketLibraryRow[]
  workspaceSubject: WorkspaceSubject
  browseMarketHref: string
}

type SortOption = 'latest' | 'name'
type AssetFilter = 'all' | 'pdf' | 'hwp'

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('ko-KR')
}

export default function MarketLibraryClient({
  rows,
  workspaceSubject,
  browseMarketHref,
}: MarketLibraryClientProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('latest')
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all')

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const nextRows = rows.filter((row) => {
      if (keyword && !(`${row.title} ${row.categoryTitle} ${row.summary || ''}`.toLowerCase().includes(keyword))) {
        return false
      }

      if (assetFilter === 'pdf' && !row.pdfOwned) {
        return false
      }

      if (assetFilter === 'hwp' && !row.hwpOwned) {
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
  }, [assetFilter, rows, search, sort])

  const downloadableCount = rows.filter((row) => row.pdfAvailable || row.hwpAvailable).length
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
            <p className="text-3xl font-bold text-gray-900">{downloadableCount}</p>
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
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),180px,180px]">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 검색" />
            <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
              <option value="latest">최근 구매순</option>
              <option value="name">이름순</option>
            </select>
            <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value as AssetFilter)} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
              <option value="all">전체</option>
              <option value="pdf">PDF 포함</option>
              <option value="hwp">HWP & PDF 포함</option>
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
            <>
              <div className="hidden md:block overflow-hidden rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>상품 정보</TableHead>
                      <TableHead>카테고리</TableHead>
                      <TableHead>구매 상태</TableHead>
                      <TableHead>구매일</TableHead>
                      <TableHead>액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow key={row.itemId}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-gray-900">{row.title}</p>
                            {row.summary ? <p className="text-xs text-gray-500">{row.summary}</p> : null}
                          </div>
                        </TableCell>
                        <TableCell>{row.categoryTitle}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={row.pdfOwned ? 'default' : 'outline'}>PDF {row.pdfOwned ? '보유' : '미보유'}</Badge>
                            <Badge variant={row.hwpOwned ? 'default' : 'outline'}>HWP & PDF {row.hwpOwned ? '보유' : '미보유'}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(row.purchasedAt)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {row.pdfOwned ? (row.pdfAvailable ? <Button asChild size="sm" variant="outline"><a href={row.pdfDownloadUrl || '#'}>PDF 다운로드</a></Button> : <Button size="sm" variant="outline" disabled>PDF 점검 중</Button>) : null}
                            {row.hwpOwned ? (row.hwpAvailable ? <Button asChild size="sm" variant="outline"><a href={row.hwpDownloadUrl || '#'}>HWP 다운로드</a></Button> : <Button size="sm" variant="outline" disabled>HWP & PDF 점검 중</Button>) : null}
                            {row.categorySlug ? <Button asChild size="sm"><WorkspaceLink href={`/market/${row.categorySlug}/items/${row.itemId}`} subject={workspaceSubject}>상세 보기</WorkspaceLink></Button> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 md:hidden">
                {filteredRows.map((row) => (
                  <Card key={row.itemId}>
                    <CardContent className="space-y-4 pt-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-gray-900">{row.title}</p>
                          <Badge>구매 완료</Badge>
                        </div>
                        <p className="text-sm text-gray-500">{row.categoryTitle} · {formatDate(row.purchasedAt)}</p>
                        {row.summary ? <p className="text-sm text-gray-600">{row.summary}</p> : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant={row.pdfOwned ? 'default' : 'outline'}>PDF {row.pdfOwned ? '보유' : '미보유'}</Badge>
                        <Badge variant={row.hwpOwned ? 'default' : 'outline'}>HWP & PDF {row.hwpOwned ? '보유' : '미보유'}</Badge>
                      </div>

                      <div className="grid gap-2">
                        {row.pdfOwned ? (row.pdfAvailable ? <Button asChild variant="outline"><a href={row.pdfDownloadUrl || '#'}>PDF 다운로드</a></Button> : <Button variant="outline" disabled>PDF 점검 중</Button>) : null}
                        {row.hwpOwned ? (row.hwpAvailable ? <Button asChild variant="outline"><a href={row.hwpDownloadUrl || '#'}>HWP 다운로드</a></Button> : <Button variant="outline" disabled>HWP & PDF 점검 중</Button>) : null}
                        {row.categorySlug ? <Button asChild><WorkspaceLink href={`/market/${row.categorySlug}/items/${row.itemId}`} subject={workspaceSubject}>상세 보기</WorkspaceLink></Button> : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
