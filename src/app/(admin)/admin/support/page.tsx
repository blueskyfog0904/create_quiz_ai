import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SupportClient, type Ticket } from './support-client'
import type { SupportReplyTemplateRow } from './reply-template-tools'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { UUID_PATTERN } from '@/lib/admin-orders'
import { attachMemberContacts } from '@/lib/admin-member-access-log-server'
import { findSupportMemberIdsByEmail, readLockedSupportCategoryIds } from '@/lib/admin-support-server'
import { readSupportPageContentForAdmin } from '@/lib/support-page-content-server'
import { getSiteBrand } from '@/lib/site-brand-server'
import { buildSupportTicketSearchFilter } from '@/lib/admin-support'
import { getListPagination } from '@/lib/list-pagination'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { withdrawalText } from '@/lib/member-withdrawal'
import { readMemberWithdrawalPolicy } from '@/lib/member-withdrawal-server'
import { isWithdrawnMemberTicket, readWithdrawnSupportTickets } from '@/lib/withdrawn-member-redaction-server'
import { WithdrawnTicketsPanel } from './withdrawn-tickets-panel'

interface AdminSupportPageProps {
  searchParams?: Promise<{
    status?: string
    categoryId?: string
    q?: string
    includeDeleted?: string
    page?: string
    pageSize?: string
    ticket?: string
  }>
}

// 13번 8-2: 행은 세션으로 읽는다(탈퇴 회원 행은 RLS 가 뺀다). 회원 이메일은 끼워 읽지 않고 attachMemberContacts 가 서버 키로 붙이며 열람 기록을 남긴다.
const TICKET_COLUMNS = `
      *,
      support_ticket_categories!support_tickets_category_id_fkey (id, slug, name, is_active, deleted_at)
    ` as const

// 검색어로 찾는 회원 수 상한(조건에 넣는 id가 너무 많아지지 않게). 주문 조회와 같은 방식이다.
const SEARCH_MATCH_LIMIT = 50

export default async function AdminSupportPage({ searchParams }: AdminSupportPageProps) {
  const access = await requireAdminPagePermission('support.manage')
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const statusFilter = resolvedSearchParams.status || 'all'
  // 주소를 손으로 고쳐 uuid가 아닌 값이 오면 조건 없이(전체) 본다.
  const rawCategoryId = resolvedSearchParams.categoryId
  const categoryFilter = rawCategoryId && (rawCategoryId === 'uncategorized' || UUID_PATTERN.test(rawCategoryId)) ? rawCategoryId : 'all'
  const queryText = resolvedSearchParams.q || ''
  const includeDeleted = resolvedSearchParams.includeDeleted === 'true'

  const { data: categories } = await supabase
    .from('support_ticket_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  // 건수 카드는 필터와 무관한 전체 기준이다. 세지 못하면 null(화면에서 0과 구분한다).
  const head = { count: 'exact', head: true } as const
  const [pendingResult, resolvedResult, deletedResult] = await Promise.all([
    supabase.from('support_tickets').select('id', head).eq('status', 'pending').eq('is_deleted_by_user', false),
    supabase.from('support_tickets').select('id', head).eq('status', 'resolved').eq('is_deleted_by_user', false),
    supabase.from('support_tickets').select('id', head).eq('is_deleted_by_user', true),
  ])
  const ticketCounts = {
    pending: pendingResult.error ? null : pendingResult.count ?? 0,
    resolved: resolvedResult.error ? null : resolvedResult.count ?? 0,
    deleted: deletedResult.error ? null : deletedResult.count ?? 0,
  }

  let searchFilter: string | null = null
  let searchTruncated = false
  const keyword = queryText.trim()
  if (keyword) {
    // 회원 이메일 검색은 서버 키 함수가 맞는 회원 id 만 돌려준다(탈퇴 회원 제외, 상한+1로 넘침 확인). 검색어는 기록에 넣지 않는다.
    const matched = await findSupportMemberIdsByEmail(keyword, SEARCH_MATCH_LIMIT)
    searchTruncated = matched.truncated
    searchFilter = buildSupportTicketSearchFilter(keyword, matched.ids)
  }

  // 페이지가 총 페이지를 넘으면 range가 실패하므로, 건수를 먼저 세고 페이지를 맞춘다.
  let countQuery = supabase.from('support_tickets').select('id', head)
  let ticketsQuery = supabase.from('support_tickets').select(TICKET_COLUMNS)

  if (!includeDeleted) {
    countQuery = countQuery.eq('is_deleted_by_user', false)
    ticketsQuery = ticketsQuery.eq('is_deleted_by_user', false)
  }

  if (statusFilter !== 'all') {
    if (statusFilter === 'deleted') {
      countQuery = countQuery.eq('is_deleted_by_user', true)
      ticketsQuery = ticketsQuery.eq('is_deleted_by_user', true)
    } else {
      countQuery = countQuery.eq('status', statusFilter)
      ticketsQuery = ticketsQuery.eq('status', statusFilter)
    }
  }

  if (categoryFilter !== 'all') {
    if (categoryFilter === 'uncategorized') {
      countQuery = countQuery.is('category_id', null)
      ticketsQuery = ticketsQuery.is('category_id', null)
    } else {
      countQuery = countQuery.eq('category_id', categoryFilter)
      ticketsQuery = ticketsQuery.eq('category_id', categoryFilter)
    }
  }

  if (searchFilter) {
    countQuery = countQuery.or(searchFilter)
    ticketsQuery = ticketsQuery.or(searchFilter)
  }

  const { count, error: countError } = await countQuery
  if (countError) throw new Error(countError.message)
  const pagination = getListPagination(count ?? 0, resolvedSearchParams.page, resolvedSearchParams.pageSize)

  const { data: ticketRows, error: ticketsError } = pagination.totalCount === 0
    ? { data: [], error: null }
    : await ticketsQuery
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
  if (ticketsError) throw new Error(ticketsError.message)

  // ?ticket=<id>: 그 문의 한 건을 따로 읽어 상세 창을 연다(현재 쪽·필터에 없어도, 회원이 삭제한 문의여도).
  const ticketId = resolvedSearchParams.ticket && UUID_PATTERN.test(resolvedSearchParams.ticket) ? resolvedSearchParams.ticket : null
  const { data: linkedTicketRow } = ticketId
    ? await supabase.from('support_tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle()
    : { data: null }
  // 목록과 바로 여는 문의에 회원 이메일을 붙인다(목록에는 전화번호를 싣지 않는다 — 상세 창이 회원 요약에서 받음).
  const listRows = [...(ticketRows ?? []), ...(linkedTicketRow ? [linkedTicketRow] : [])]
  const { rows: ticketsWithContacts } = await attachMemberContacts({
    access,
    screen: 'support.list',
    rows: listRows,
    userIdOf: (row) => row.user_id,
    fields: ['email'],
    context: { page: pagination.page, searched: Boolean(keyword), resultCount: listRows.length, ...(ticketId ? { linkedTicketId: ticketId } : {}) },
    shape: (row, contact): Ticket => ({ ...row, profiles: contact ? { email: contact.email, phone: null } : null }),
  })
  const tickets = ticketsWithContacts.slice(0, (ticketRows ?? []).length)
  const linkedTicket = linkedTicketRow ? ticketsWithContacts[ticketsWithContacts.length - 1] : null
  // 10번: 탈퇴 회원 문의는 RLS 로 위 목록·링크에서 빠진다. 서버 키로 건수(대표에게는 id·접수일)만 읽어 따로 보여 준다.
  const isOwner = access.role === 'owner'
  const [withdrawnTickets, linkedTicketWithdrawn, withdrawalPolicy, pageContent, templatesResult, siteBrand, lockedCategoryIds] = await Promise.all([
    readWithdrawnSupportTickets({ withRows: isOwner }),
    ticketId && !linkedTicket ? isWithdrawnMemberTicket(ticketId) : Promise.resolve(false),
    isOwner ? readMemberWithdrawalPolicy() : Promise.resolve(null),
    // 13번: 빈칸 표시·수정 사유 안내(답변 창)와 '안내 문구' 탭(대표)
    readSupportPageContentForAdmin(),
    // 13번 6절: 답변 템플릿(RLS 가 support.manage 로 거른다). 숨긴 것은 빼고 순서대로.
    (supabase as unknown as SupabaseClient).from('support_reply_templates').select('*').is('deleted_at', null)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    getSiteBrand(),
    readLockedSupportCategoryIds(categories ?? []),
  ])
  if (templatesResult.error) {
    console.error('[admin-support] 답변 템플릿을 읽지 못했습니다.', { code: templatesResult.error.code })
  }

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/support" fallback="고객지원 관리" />}
        description="고객 문의 카테고리와 티켓을 관리합니다"
      />

      {resolvedSearchParams.ticket && !linkedTicket && (
        // 전처럼 화면 읽기가 바로 읽는다(role="alert")
        <AdminNotice kind="warning" role="alert" className="mb-6">
          {linkedTicketWithdrawn
            ? '탈퇴 회원의 문의(법정 보존)입니다. 아래 \'탈퇴 회원\' 줄에서 대표가 사유를 적고 열람할 수 있습니다.'
            : '링크의 문의를 찾지 못했습니다. 아래 목록에서 찾아 주세요.'}
        </AdminNotice>
      )}

      <WithdrawnTicketsPanel
        summary={withdrawnTickets}
        isOwner={isOwner}
        highlightTicketId={linkedTicketWithdrawn ? ticketId : null}
        reasonGuide={withdrawalText(withdrawalPolicy, 'reasonGuide')}
      />

      <SupportClient
        // 주소(필터·쪽·바로 여는 문의)가 바뀌면 화면 상태를 새로 시작한다. 열려 있던 상세 창이 남지 않고, 새 ?ticket= 이 열린다.
        key={JSON.stringify(resolvedSearchParams)}
        tickets={tickets}
        ticketCounts={ticketCounts}
        pagination={{ page: pagination.page, pageSize: pagination.pageSize, totalCount: pagination.totalCount }}
        searchTruncated={searchTruncated}
        linkedTicket={linkedTicket}
        initialCategories={categories || []}
        lockedCategoryIds={lockedCategoryIds}
        initialTemplates={templatesResult.error ? null : (templatesResult.data ?? []) as SupportReplyTemplateRow[]}
        pageContent={pageContent.status === 'ok' ? pageContent.content : null}
        pageContentStatus={pageContent.status}
        siteName={siteBrand.name}
        isOwner={isOwner}
        initialFilters={{
          status: statusFilter,
          categoryId: categoryFilter,
          q: queryText,
          includeDeleted,
        }}
      />
    </div>
  )
}
