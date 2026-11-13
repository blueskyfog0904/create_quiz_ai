'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  Filter,
  Calendar
} from 'lucide-react'
import { GrantCreditDialog } from './grant-credit-dialog'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { getAdminCreditTransactionKind } from '@/lib/admin-credit-transaction-kind'
import { updateListQuery } from '@/lib/list-pagination'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import type {
  AdminCreditMonthlyStats,
  AdminCreditTransaction,
  AdminCreditTransactionType,
} from '@/lib/admin-credit-transactions-server'

interface CreditsClientProps {
  transactions: AdminCreditTransaction[]
  totalCount: number
  page: number
  pageSize: number
  query: string
  type: AdminCreditTransactionType | 'all'
  monthlyStats: AdminCreditMonthlyStats | null
}

const KIND_BADGE_CLASS = {
  green: 'bg-green-100 text-green-700 hover:bg-green-100',
  amber: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  blue: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  red: 'bg-red-100 text-red-700 hover:bg-red-100',
  gray: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
} as const

function formatSigned(amount: number) {
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString()}`
}

// 목록·검색·유형·페이지는 서버가 정한다(주소의 type·q·page·pageSize). 이 화면은 받은 값을 그대로 그린다.
export function CreditsClient({ transactions, totalCount, page, pageSize, query, type, monthlyStats }: CreditsClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState(query)
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false)

  const buildHref = (changes: Record<string, string | number | null>) => {
    const next = updateListQuery(new URLSearchParams({
      ...(type !== 'all' ? { type } : {}),
      ...(query ? { q: query } : {}),
      page: String(page),
      pageSize: String(pageSize),
    }).toString(), changes)
    return next ? `/admin/credits?${next}` : '/admin/credits'
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(buildHref({ q: search.trim() || null, page: 1 }))
  }

  const statsPeriod = monthlyStats ? `${monthlyStats.year}년 ${monthlyStats.month}월 (한국 시간)` : '이번 달'
  const statValue = (value: number | undefined) => (value === undefined ? '확인 불가' : formatSigned(value))

  return (
    <div className="space-y-6">
      <GrantCreditDialog
        open={isGrantDialogOpen}
        onOpenChange={setIsGrantDialogOpen}
        onSuccess={() => router.refresh()}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">충전·지급</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{statValue(monthlyStats?.added)}</div>
            <p className="text-xs text-muted-foreground">{statsPeriod} · 결제 충전, 관리자 지급, 환불 지급</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">사용</CardTitle>
            <ArrowDownLeft className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{statValue(monthlyStats?.consumed)}</div>
            <p className="text-xs text-muted-foreground">{statsPeriod} · 자료 구매 등</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">사용 취소</CardTitle>
            <RotateCcw className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">{statValue(monthlyStats?.restored)}</div>
            <p className="text-xs text-muted-foreground">{statsPeriod} · 구매 환불로 되돌려 준 크레딧</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">환불 회수</CardTitle>
            <RotateCcw className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{statValue(monthlyStats?.recovered)}</div>
            <p className="text-xs text-muted-foreground">{statsPeriod} · 결제 환불로 회수한 크레딧</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <form onSubmit={handleSearch} className="flex flex-1 gap-2 sm:w-96" role="search">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="이메일, 내역 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                aria-label="크레딧 거래 검색"
              />
            </div>
            <Button type="submit" variant="outline">검색</Button>
          </form>
          <Select value={type} onValueChange={(value) => router.push(buildHref({ type: value === 'all' ? null : value, page: 1 }))}>
            <SelectTrigger className="w-[150px]" aria-label="거래 유형">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 내역</SelectItem>
              <SelectItem value="purchase">충전·지급</SelectItem>
              <SelectItem value="consume">사용</SelectItem>
              <SelectItem value="refund">환불</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsGrantDialogOpen(true)}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Coins className="h-4 w-4" />
            크레딧 지급
          </Button>
        </div>
      </div>

      {/* Transaction Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>일시</TableHead>
                <TableHead>사용자</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>내용</TableHead>
                <TableHead className="text-right">금액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {query || type !== 'all' ? '조건에 맞는 거래 내역이 없습니다.' : '거래 내역이 없습니다.'}
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((t) => {
                  const kind = getAdminCreditTransactionKind(t)
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs text-gray-500">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3" />
                          {new Date(t.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{formatMemberDisplayName(t.user?.email, t.user?.display_tag)}</span>
                          <span className="text-xs text-gray-400">{t.user?.email || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={KIND_BADGE_CLASS[kind.tone]}>{kind.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{t.description}</div>
                        {t.resource_type && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            {t.resource_type} #{t.resource_id?.slice(0, 8)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-bold ${t.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatSigned(t.amount)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <StudioListPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={(nextPage) => router.push(buildHref({ page: nextPage }))}
        onPageSizeChange={(nextSize) => router.push(buildHref({ pageSize: nextSize, page: 1 }))}
        getPageHref={(nextPage) => buildHref({ page: nextPage })}
      />
    </div>
  )
}
