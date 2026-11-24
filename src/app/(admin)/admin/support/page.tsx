import { createClient } from '@/lib/supabase/server'
import { SupportClient } from './support-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { UUID_PATTERN, escapeIlike } from '@/lib/admin-orders'
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

const TICKET_COLUMNS = `
      *,
      profiles!support_tickets_user_id_profiles_fkey (email, phone),
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
    // PostgREST는 ilike 값의 *를 와일드카드로 바꾼다. 이메일에는 쓰지 않는 글자라 빼고 찾는다.
    const emailKeyword = keyword.replaceAll('*', '')
    // 상한보다 하나 더 읽어 넘쳤는지 알아낸다. 쪽을 넘겨도 같은 회원들이 잡히게 id 순으로 읽는다.
    const usersResult = emailKeyword
      ? await supabase.from('profiles').select('id').ilike('email', `%${escapeIlike(emailKeyword)}%`).order('id').limit(SEARCH_MATCH_LIMIT + 1)
      : { data: [], error: null }
    if (usersResult.error) throw new Error(usersResult.error.message)
    const matchedUsers = usersResult.data ?? []
    searchTruncated = matchedUsers.length > SEARCH_MATCH_LIMIT
    searchFilter = buildSupportTicketSearchFilter(keyword, matchedUsers.slice(0, SEARCH_MATCH_LIMIT).map((user) => user.id))
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

  const { data: tickets, error: ticketsError } = pagination.totalCount === 0
    ? { data: [], error: null }
    : await ticketsQuery
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
  if (ticketsError) throw new Error(ticketsError.message)

  // ?ticket=<id>: 그 문의 한 건을 따로 읽어 상세 창을 연다(현재 쪽·필터에 없어도, 회원이 삭제한 문의여도).
  const ticketId = resolvedSearchParams.ticket && UUID_PATTERN.test(resolvedSearchParams.ticket) ? resolvedSearchParams.ticket : null
  const { data: linkedTicket } = ticketId
    ? await supabase.from('support_tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle()
    : { data: null }
  // 10번: 탈퇴 회원 문의는 RLS 로 위 목록·링크에서 빠진다. 서버 키로 건수(대표에게는 id·접수일)만 읽어 따로 보여 준다.
  const isOwner = access.role === 'owner'
  const [withdrawnTickets, linkedTicketWithdrawn, withdrawalPolicy] = await Promise.all([
    readWithdrawnSupportTickets({ withRows: isOwner }),
    ticketId && !linkedTicket ? isWithdrawnMemberTicket(ticketId) : Promise.resolve(false),
    isOwner ? readMemberWithdrawalPolicy() : Promise.resolve(null),
  ])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl"><AdminMenuName href="/admin/support" fallback="고객지원 관리" /></h1>
        <p className="text-gray-500 mt-1">고객 문의 카테고리와 티켓을 관리합니다</p>
      </div>

      {resolvedSearchParams.ticket && !linkedTicket && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {linkedTicketWithdrawn
            ? '탈퇴 회원의 문의(법정 보존)입니다. 아래 \'탈퇴 회원\' 줄에서 대표가 사유를 적고 열람할 수 있습니다.'
            : '링크의 문의를 찾지 못했습니다. 아래 목록에서 찾아 주세요.'}
        </div>
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
        tickets={tickets || []}
        ticketCounts={ticketCounts}
        pagination={{ page: pagination.page, pageSize: pagination.pageSize, totalCount: pagination.totalCount }}
        searchTruncated={searchTruncated}
        linkedTicket={linkedTicket}
        initialCategories={categories || []}
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
