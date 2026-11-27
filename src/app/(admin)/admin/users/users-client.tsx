'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Mail, Phone, Plus } from 'lucide-react'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { updateListQuery } from '@/lib/list-pagination'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import type { AdminUserListItem } from '@/lib/admin-users-server'
import { GrantCreditDialog } from '../credits/grant-credit-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { formatCredits } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'

// 역할 이름(지금 화면 그대로)
const ROLE_LABELS: Record<string, string> = {
  teacher: '교사',
  instructor: '강사',
  student: '학생',
  parent: '학부모',
  academy_instructor: '학원강사',
}

interface UsersClientProps {
  users: AdminUserListItem[]
  totalCount: number
  page: number
  pageSize: number
  query: string
  // 12번: '정지 중만 보기'
  suspendedOnly: boolean
  // 크레딧 지급(credits.grant). 없으면 지급 버튼을 그리지 않는다.
  canGrantCredits: boolean
}

// 목록·검색·페이지는 서버가 정한다(주소의 q·page·pageSize). 이 화면은 받은 값을 그대로 그린다.
export function UsersClient({ users, totalCount, page, pageSize, query, suspendedOnly, canGrantCredits }: UsersClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState(query)
  // 지급 창에는 대상 회원의 식별 정보만 넘긴다(창은 이 값이 바뀔 때 입력을 초기화하므로 같은 객체를 유지한다).
  const [selectedUser, setSelectedUser] = useState<Pick<AdminUserListItem, 'id' | 'email' | 'display_tag'> | null>(null)
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false)

  const buildHref = (changes: Record<string, string | number | null>) => {
    const next = updateListQuery(new URLSearchParams({
      ...(query ? { q: query } : {}),
      ...(suspendedOnly ? { suspended: '1' } : {}),
      page: String(page),
      pageSize: String(pageSize),
    }).toString(), changes)
    return next ? `/admin/users?${next}` : '/admin/users'
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(buildHref({ q: search.trim() || null, page: 1 }))
  }

  const openGrantDialog = (user: AdminUserListItem) => {
    setSelectedUser({ id: user.id, email: user.email, display_tag: user.display_tag })
    setIsGrantDialogOpen(true)
  }

  // 날짜 표기는 지금 모양(toLocaleDateString ko-KR) 그대로(20번: 대표가 바꾸기로 정하기 전까지).
  const columns: AdminDataTableColumn<AdminUserListItem>[] = [
    {
      key: 'member',
      header: '회원',
      // 표시 이름은 이메일에서 온다(화면 비교 때 가린다).
      pii: true,
      cell: (user) => (
        <div className="min-w-0 space-y-1">
          <Link href={`/admin/users/${user.id}`} className="break-all font-medium text-[var(--studio-ink)] hover:underline">
            {formatMemberDisplayName(user.email, user.display_tag)}
          </Link>
          <div className="flex flex-wrap items-center gap-1">
            {user.is_admin && (
              <AdminStatusBadge label="관리자" tone="info" />
            )}
            {/* 정지 범위와 관계없이 정지는 빨강(5-1 회원 줄) */}
            {user.suspended && (
              <AdminStatusBadge label="정지" tone={adminStatusTone('member', 'restricted')} />
            )}
            {user.suspended === null && (
              <AdminStatusBadge label="정지 여부 확인 불가" tone="neutral" />
            )}
            {user.withdrawn_at && (
              <AdminStatusBadge label={`탈퇴 ${new Date(user.withdrawn_at).toLocaleDateString('ko-KR')}`} tone={adminStatusTone('member', 'withdrawn')} />
            )}
            {user.provider && (
              <AdminStatusBadge label={user.provider} tone="neutral" />
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: '연락처',
      pii: true,
      className: 'text-sm text-[var(--studio-muted)]',
      cell: (user) => (
        <div className="flex flex-col gap-0.5 break-all">
          {user.email && (
            <span className="flex items-center gap-1">
              <Mail aria-hidden="true" className="h-3 w-3 shrink-0" />
              {user.email}
            </span>
          )}
          {user.phone && (
            <span className="flex items-center gap-1">
              <Phone aria-hidden="true" className="h-3 w-3 shrink-0" />
              {user.phone}
            </span>
          )}
        </div>
      ),
    },
    { key: 'organization', header: '소속', className: 'text-sm', cell: (user) => user.organization || '-' },
    { key: 'role', header: '역할', className: 'text-sm', cell: (user) => (user.role ? ROLE_LABELS[user.role] ?? user.role : '-') },
    {
      key: 'createdAt',
      header: '가입일',
      className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]',
      cell: (user) => new Date(user.created_at).toLocaleDateString('ko-KR'),
    },
    {
      key: 'credits',
      header: '크레딧',
      numeric: true,
      className: 'whitespace-nowrap font-semibold',
      cell: (user) => (user.credit_balance === null ? '잔액 확인 불가' : formatCredits(user.credit_balance)),
    },
    ...(canGrantCredits
      ? [{
          key: 'actions',
          header: '작업',
          align: 'right' as const,
          // 탈퇴 회원에게는 크레딧을 지급할 수 없다(DB가 MEMBER_WITHDRAWN 으로 거절).
          cell: (user: AdminUserListItem) => (!user.withdrawn_at ? (
            <Button size="sm" variant="adminTable" className="gap-1" onClick={() => openGrantDialog(user)}>
              <Plus aria-hidden="true" className="h-3 w-3" />
              크레딧 지급
            </Button>
          ) : null),
        }]
      : []),
  ]

  return (
    <div className="space-y-6">
      <GrantCreditDialog
        open={isGrantDialogOpen}
        onOpenChange={setIsGrantDialogOpen}
        initialUser={selectedUser}
        onSuccess={() => router.refresh()}
      />

      <AdminFilterBar
        className="mb-0"
        search={
          <form onSubmit={handleSearch} className="flex w-full gap-2 sm:w-96">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--studio-muted)]" />
              <Input
                placeholder="이메일, 전화번호, 소속으로 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                aria-label="사용자 검색"
                data-admin-pii=""
              />
            </div>
            <Button type="submit" variant="brand">검색</Button>
          </form>
        }
        filters={
          <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--studio-text)]">
            <input
              type="checkbox"
              checked={suspendedOnly}
              onChange={(event) => router.push(buildHref({ suspended: event.target.checked ? '1' : null, page: 1 }))}
            />
            정지 중만 보기
          </label>
        }
        resultCount={totalCount}
      />

      <AdminDataTable
        caption="회원 목록"
        columns={columns}
        rows={users}
        getRowKey={(user) => user.id}
        minWidth={900}
        state={users.length === 0 ? (
          <AdminTableState kind="empty" message={query || suspendedOnly ? '검색 결과가 없습니다.' : '가입한 사용자가 없습니다.'} />
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
