'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Coins, Filter, Calendar } from 'lucide-react'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminMetricCard, AdminMetricGrid } from '@/components/admin/kit/admin-metric-card'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { formatSignedCredits } from '@/lib/admin-format'
import { adminStatusTone, creditAmountTone } from '@/lib/admin-status-tone'
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
  // 크레딧 지급(credits.grant). 없으면 지급 버튼을 그리지 않는다.
  canGrantCredits: boolean
}

function amountClass(amount: number, kindTone: string) {
  const tone = creditAmountTone(amount, kindTone)
  return tone ? ADMIN_TONE_TEXT_CLASSES[tone] : 'text-[var(--studio-ink)]'
}

// 목록·검색·유형·페이지는 서버가 정한다(주소의 type·q·page·pageSize). 이 화면은 받은 값을 그대로 그린다.
export function CreditsClient({ transactions, totalCount, page, pageSize, query, type, monthlyStats, canGrantCredits }: CreditsClientProps) {
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
  const stats = [
    { title: '충전·지급', value: monthlyStats?.added, sub: '결제 충전, 관리자 지급, 환불 지급' },
    { title: '사용', value: monthlyStats?.consumed, sub: '자료 구매 등' },
    { title: '사용 취소', value: monthlyStats?.restored, sub: '구매 환불로 되돌려 준 크레딧' },
    { title: '환불·관리자 회수', value: monthlyStats?.recovered, sub: '결제 환불·관리자 회수로 빠진 크레딧' },
    { title: '탈퇴 소멸', value: monthlyStats?.forfeited, sub: '회원 탈퇴로 사라진 크레딧(사용 아님)' },
  ]

  const columns: AdminDataTableColumn<AdminCreditTransaction>[] = [
    {
      key: 'createdAt',
      header: '일시',
      className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]',
      cell: (t) => (
        <div className="flex items-center gap-2">
          <Calendar aria-hidden="true" className="h-3 w-3" />
          {new Date(t.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
        </div>
      ),
    },
    {
      key: 'member',
      header: '사용자',
      pii: true,
      cell: (t) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{formatMemberDisplayName(t.user?.email, t.user?.display_tag)}</span>
          <span className="text-xs text-[var(--studio-muted)]">{t.user?.email || '-'}</span>
        </div>
      ),
    },
    {
      key: 'kind',
      header: '유형',
      cell: (t) => {
        const kind = getAdminCreditTransactionKind(t)
        return <AdminStatusBadge label={kind.label} tone={adminStatusTone('creditTransaction', kind.tone)} />
      },
    },
    {
      key: 'description',
      header: '내용',
      cell: (t) => (
        <>
          <div className="text-sm">{t.description}</div>
          {t.resource_type && (
            <div className="mt-0.5 text-xs text-[var(--studio-muted)]">
              {t.resource_type} #{t.resource_id?.slice(0, 8)}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'amount',
      header: '금액',
      numeric: true,
      cell: (t) => <span className={`font-bold ${amountClass(t.amount, getAdminCreditTransactionKind(t).tone)}`}>{formatSignedCredits(t.amount)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <GrantCreditDialog
        open={isGrantDialogOpen}
        onOpenChange={setIsGrantDialogOpen}
        onSuccess={() => router.refresh()}
      />

      <AdminMetricGrid>
        {stats.map((stat) => (
          <AdminMetricCard
            key={stat.title}
            title={stat.title}
            value={formatSignedCredits(stat.value)}
            valueUnavailable={stat.value === undefined}
            sub={`${statsPeriod} · ${stat.sub}`}
          />
        ))}
      </AdminMetricGrid>

      <AdminFilterBar
        className="mb-0"
        search={
          <form onSubmit={handleSearch} className="flex w-full gap-2 sm:w-96" role="search">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--studio-muted)]" />
              <Input
                placeholder="이메일, 내역 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                aria-label="크레딧 거래 검색"
                data-admin-pii=""
              />
            </div>
            <Button type="submit" variant="brand">검색</Button>
          </form>
        }
        filters={
          <>
            <Select value={type} onValueChange={(value) => router.push(buildHref({ type: value === 'all' ? null : value, page: 1 }))}>
              <SelectTrigger className="w-[150px] max-sm:w-full" aria-label="거래 유형">
                <div className="flex items-center gap-2">
                  <Filter aria-hidden="true" className="h-4 w-4 text-[var(--studio-muted)]" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 내역</SelectItem>
                <SelectItem value="purchase">충전·지급</SelectItem>
                <SelectItem value="consume">사용</SelectItem>
                <SelectItem value="refund">환불·회수</SelectItem>
                <SelectItem value="withdrawal_forfeit">탈퇴 소멸</SelectItem>
              </SelectContent>
            </Select>
            {canGrantCredits ? (
              <Button variant="brand" onClick={() => setIsGrantDialogOpen(true)} className="gap-2 max-sm:w-full">
                <Coins aria-hidden="true" className="h-4 w-4" />
                크레딧 지급
              </Button>
            ) : null}
          </>
        }
        resultCount={totalCount}
      />

      <AdminDataTable
        caption="크레딧 거래 목록"
        columns={columns}
        rows={transactions}
        getRowKey={(t) => t.id}
        minWidth={760}
        state={transactions.length === 0 ? (
          <AdminTableState kind="empty" message={query || type !== 'all' ? '조건에 맞는 거래 내역이 없습니다.' : '거래 내역이 없습니다.'} />
        ) : undefined}
      />

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
