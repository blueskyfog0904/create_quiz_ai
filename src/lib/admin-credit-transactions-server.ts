import { createAdminClient } from '@/lib/supabase/bypass'
import { getKstPeriodStarts } from '@/lib/kst-period'
import { getListPagination } from '@/lib/list-pagination'

// 관리자 '크레딧 관리'. 거래 유형은 credit_transactions.type(purchase / consume / refund)이 기준이고,
// 충전과 관리자 지급은 같은 purchase라서 원천(credit_sources.source_category)으로 구분한다.

export const ADMIN_CREDIT_TRANSACTION_TYPES = ['purchase', 'consume', 'refund'] as const
export type AdminCreditTransactionType = (typeof ADMIN_CREDIT_TRANSACTION_TYPES)[number]

export interface AdminCreditTransaction {
  id: string
  user_id: string
  type: string
  amount: number
  description: string | null
  created_at: string
  resource_type: string | null
  resource_id: string | null
  source_category: string | null
  user: { email: string | null; display_tag: string } | null
}

export interface AdminCreditMonthlyStats {
  year: number
  month: number
  // 충전·지급으로 들어온 크레딧(+), 사용(−), 사용 취소로 되돌려 준 크레딧(+), 환불로 회수한 크레딧(−)
  added: number
  consumed: number
  restored: number
  recovered: number
}

export interface AdminCreditTransactionListResult {
  transactions: AdminCreditTransaction[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  query: string
  type: AdminCreditTransactionType | 'all'
  // 집계를 읽지 못했으면 null(화면에 0이 아니라 '확인 불가')
  monthlyStats: AdminCreditMonthlyStats | null
}

const TRANSACTION_COLUMNS = 'id, user_id, type, amount, description, created_at, resource_type, resource_id, source_id'
const RANGE_NOT_SATISFIABLE_ERROR_CODE = 'PGRST103'
const STATS_CHUNK_SIZE = 1000
// 이메일 검색으로 찾는 회원 수 상한(조건에 넣는 id가 너무 많아지지 않게)
const SEARCH_USER_LIMIT = 50

export function normalizeAdminCreditTransactionType(value: unknown): AdminCreditTransactionType | 'all' {
  return (ADMIN_CREDIT_TRANSACTION_TYPES as readonly string[]).includes(String(value))
    ? (value as AdminCreditTransactionType)
    : 'all'
}

export function summarizeCreditTransactions(rows: Array<{ type: string; amount: number }>) {
  const summary = { added: 0, consumed: 0, restored: 0, recovered: 0 }
  for (const row of rows) {
    if (row.type === 'purchase') summary.added += row.amount
    else if (row.type === 'consume') summary.consumed += row.amount
    else if (row.type === 'refund' && row.amount >= 0) summary.restored += row.amount
    else if (row.type === 'refund') summary.recovered += row.amount
  }
  return summary
}

function escapeIlike(keyword: string) {
  return keyword.replace(/[\\%_]/g, '\\$&')
}

async function readMonthlyStats(): Promise<AdminCreditMonthlyStats | null> {
  const supabase = createAdminClient()
  const { monthStart, year, month } = getKstPeriodStarts()
  const rows: Array<{ type: string; amount: number }> = []

  // PostgREST 기본 상한(1000행)에 잘리지 않게 끝까지 나눠 읽는다.
  for (let offset = 0; ; offset += STATS_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('type, amount')
      .gte('created_at', monthStart)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + STATS_CHUNK_SIZE - 1)

    if (error) {
      console.error('[admin-credits] 이번 달 집계를 읽지 못했습니다.', { message: error.message })
      return null
    }
    rows.push(...(data ?? []))
    if (!data || data.length < STATS_CHUNK_SIZE) break
  }

  return { year, month, ...summarizeCreditTransactions(rows) }
}

export async function listAdminCreditTransactions(input: {
  type?: unknown
  q?: string | null
  page?: unknown
  pageSize?: unknown
}): Promise<AdminCreditTransactionListResult> {
  const supabase = createAdminClient()
  const type = normalizeAdminCreditTransactionType(input.type)
  const query = (input.q ?? '').trim()

  // 검색어가 이메일에 맞는 회원의 거래도 함께 찾는다.
  let matchedUserIds: string[] = []
  if (query) {
    const { data: matchedUsers, error: usersError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', `%${escapeIlike(query)}%`)
      .limit(SEARCH_USER_LIMIT)
    if (usersError) throw new Error(usersError.message)
    matchedUserIds = (matchedUsers ?? []).map((user) => user.id)
  }

  function transactionQuery(head = false) {
    let builder = supabase.from('credit_transactions').select(TRANSACTION_COLUMNS, { count: 'exact', head })
    if (type !== 'all') {
      builder = builder.eq('type', type)
    }
    if (query) {
      const conditions = [`description.ilike.${JSON.stringify(`%${escapeIlike(query)}%`)}`]
      if (matchedUserIds.length > 0) {
        conditions.push(`user_id.in.(${matchedUserIds.join(',')})`)
      }
      builder = builder.or(conditions.join(','))
    }
    return builder
  }
  function pageQuery(offset: number, pageSize: number) {
    return transactionQuery()
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
  }

  const requested = getListPagination(Number.MAX_SAFE_INTEGER, input.page, input.pageSize)
  let pageResult = await pageQuery(requested.offset, requested.pageSize)
  let totalCount = pageResult.count ?? 0
  if (pageResult.error?.code === RANGE_NOT_SATISFIABLE_ERROR_CODE) {
    const { count, error: countError } = await transactionQuery(true)
    if (countError) throw new Error(countError.message)
    totalCount = count ?? 0
  } else if (pageResult.error) {
    throw new Error(pageResult.error.message)
  }

  const pagination = getListPagination(totalCount, input.page, input.pageSize)
  if (pagination.totalCount > 0 && pagination.offset !== requested.offset) {
    pageResult = await pageQuery(pagination.offset, pagination.pageSize)
    if (pageResult.error) throw new Error(pageResult.error.message)
  }

  const rows = pagination.totalCount > 0 ? (pageResult.data ?? []) : []
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)))
  const sourceIds = Array.from(new Set(rows.map((row) => row.source_id).filter((id): id is string => Boolean(id))))

  const [profilesResult, sourcesResult, monthlyStats] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('id, email, display_tag').in('id', userIds)
      : Promise.resolve({ data: [], error: null } as const),
    sourceIds.length > 0
      ? supabase.from('credit_sources').select('id, source_category').in('id', sourceIds)
      : Promise.resolve({ data: [], error: null } as const),
    readMonthlyStats(),
  ])
  // 회원·원천 정보를 못 읽어도 거래 목록은 보여 준다(해당 칸만 비어 보인다).
  if (profilesResult.error) console.error('[admin-credits] 회원 정보를 읽지 못했습니다.', { message: profilesResult.error.message })
  if (sourcesResult.error) console.error('[admin-credits] 원천 정보를 읽지 못했습니다.', { message: sourcesResult.error.message })

  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]))
  const categoryBySourceId = new Map((sourcesResult.data ?? []).map((source) => [source.id, source.source_category]))

  return {
    transactions: rows.map((row) => {
      const profile = profileById.get(row.user_id)
      return {
        id: row.id,
        user_id: row.user_id,
        type: row.type,
        amount: row.amount,
        description: row.description,
        created_at: row.created_at,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        source_category: row.source_id ? categoryBySourceId.get(row.source_id) ?? null : null,
        user: profile ? { email: profile.email, display_tag: profile.display_tag } : null,
      }
    }),
    totalCount: pagination.totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
    query,
    type,
    monthlyStats,
  }
}
