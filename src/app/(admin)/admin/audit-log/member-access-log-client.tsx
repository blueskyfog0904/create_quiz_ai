'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { useListQuery } from '@/hooks/use-list-query'
import { ADMIN_MEMBER_ACCESS_FIELDS, ADMIN_MEMBER_ACCESS_SCREENS } from '@/lib/admin-member-access-log'
import { labelOf } from '@/lib/admin-orders'
import type { AdminMemberAccessLogResult } from '@/lib/admin-member-access-log-view-server'

const FILTER_SELECT_CLASS = 'h-10 rounded-md border border-input bg-background px-3 text-sm max-sm:w-full'
const FIELD_LABELS: Record<string, string> = ADMIN_MEMBER_ACCESS_FIELDS
const SCREEN_LABELS: Record<string, string> = ADMIN_MEMBER_ACCESS_SCREENS

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'

// 13번 8-3: 개인정보 열람 기록(대표 전용). 목록·필터·쪽은 주소(actor, screen, member, from, to, page, pageSize)가 정하고 서버가 거른다.
// 이메일은 다시 펼치지 않는다: 회원은 표시 이름(앞 3명)과 회원 상세 링크만. 이 탭을 연 것도 서버가 기록한다.
export function MemberAccessLogClient() {
  const listQuery = useListQuery()
  const { page, pageSize, setPage, setPageSize } = listQuery
  const actor = listQuery.params.get('actor') ?? ''
  const screen = listQuery.params.get('screen') ?? ''
  const member = listQuery.params.get('member') ?? ''
  const from = listQuery.params.get('from') ?? ''
  const to = listQuery.params.get('to') ?? ''
  const setFilter = (key: string, value: string) => listQuery.update({ [key]: value, page: 1 })

  const [loaded, setLoaded] = useState<{ key: string; data: AdminMemberAccessLogResult | null; error: string | null } | null>(null)

  const requestParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  for (const [key, value] of Object.entries({ actor, screen, member, from, to })) {
    if (value) requestParams.set(key, value)
  }
  const requestKey = requestParams.toString()
  const isLoading = loaded?.key !== requestKey
  const data = isLoading ? null : loaded.data
  const loadError = isLoading ? null : loaded.error

  useEffect(() => {
    let ignore = false
    fetch(`/api/admin/audit-log/access?${requestKey}`)
      .then(async (response) => {
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) throw new Error(result?.error ?? '열람 기록을 불러오지 못했습니다.')
        if (!ignore) setLoaded({ key: requestKey, data: result.data, error: null })
      })
      .catch((error) => {
        // 읽지 못한 것을 "기록 없음"으로 보이지 않게 오류로 알린다.
        if (!ignore) setLoaded({ key: requestKey, data: null, error: error instanceof Error ? error.message : '열람 기록을 불러오지 못했습니다.' })
      })
    return () => {
      ignore = true
    }
  }, [requestKey])

  const hasFilter = Boolean(actor || screen || member || from || to)

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        관리자가 회원 연락처(이메일·전화)를 보여 주는 화면을 연 기록입니다. 기록은 고치거나 지울 수 없습니다.
        탈퇴 회원 보관 기록 열람은{' '}
        <Link href="/admin/audit-log?tab=actions&action=withdrawn_record_view" className="text-blue-700 hover:underline">작업 기록의 &apos;탈퇴 회원 보관 기록 열람&apos;</Link>
        에서 봅니다.
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-4 shadow-sm">
        <select value={actor} onChange={(event) => setFilter('actor', event.target.value)} aria-label="처리자" className={FILTER_SELECT_CLASS}>
          <option value="">전체 처리자</option>
          {(data?.actors ?? []).map((item) => <option key={item.id} value={item.id}>{item.loginId}</option>)}
          {actor && data && !data.actors.some((item) => item.id === actor) && <option value={actor}>선택한 처리자</option>}
        </select>
        <select value={screen} onChange={(event) => setFilter('screen', event.target.value)} aria-label="화면" className={FILTER_SELECT_CLASS}>
          <option value="">전체 화면</option>
          {Object.entries(ADMIN_MEMBER_ACCESS_SCREENS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="flex items-center gap-2 text-sm text-gray-500 max-sm:w-full">
          <Input type="date" value={from} max={to || undefined} onChange={(event) => setFilter('from', event.target.value)} aria-label="시작일(한국 시간)" className="w-40 max-sm:w-full" />
          <span>~</span>
          <Input type="date" value={to} min={from || undefined} onChange={(event) => setFilter('to', event.target.value)} aria-label="종료일(한국 시간)" className="w-40 max-sm:w-full" />
        </div>
        {member && (
          <span className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-sm">
            회원: {data?.member?.name ?? member.slice(0, 8)}
            <button type="button" onClick={() => setFilter('member', '')} className="text-blue-700 hover:underline">필터 해제</button>
          </span>
        )}
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">열람 기록을 불러오지 못했습니다: {loadError}</p>
          <p className="mt-1">기록이 없는 것이 아닙니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.</p>
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="max-md:min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>시각</TableHead>
                <TableHead>처리자</TableHead>
                <TableHead>화면</TableHead>
                <TableHead>회원</TableHead>
                <TableHead>항목</TableHead>
                <TableHead>사유</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">불러오는 중…</TableCell></TableRow>
              ) : !data ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-red-700">열람 기록을 불러오지 못했습니다.</TableCell></TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {hasFilter ? '조건에 맞는 기록이 없습니다.' : '기록이 없습니다.'}
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-gray-500">{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell className="text-sm">{row.actor ?? <span className="font-mono text-xs text-gray-400">{row.actorId.slice(0, 8)}</span>}</TableCell>
                    <TableCell className="text-sm">{labelOf(SCREEN_LABELS, row.screen)}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {row.members.map((item) => (
                          <Link key={item.id} href={`/admin/users/${item.id}`} className="hover:underline">
                            {item.withdrawn ? '탈퇴 회원' : item.name ?? item.id.slice(0, 8)}
                          </Link>
                        ))}
                        {row.memberCount > row.members.length && <span className="text-gray-500">외 {row.memberCount - row.members.length}명</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{row.fields.map((field) => labelOf(FIELD_LABELS, field)).join(', ') || '-'}</TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm" title={row.reason ?? undefined}>{row.reason ?? '-'}</TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">{row.ipPrefix ?? '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && (
        <StudioListPagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
    </div>
  )
}
