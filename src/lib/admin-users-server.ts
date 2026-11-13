import { createAdminClient } from '@/lib/supabase/bypass'
import { getListPagination } from '@/lib/list-pagination'

// 관리자 '사용자 관리' 목록. 검색·페이지 나눔은 서버에서 하고, 화면에 쓰는 컬럼만 읽는다.

export interface AdminUserListItem {
  id: string
  email: string | null
  display_tag: string
  phone: string | null
  organization: string | null
  role: string | null
  is_admin: boolean | null
  provider: string | null
  created_at: string
  // 지금 쓸 수 있는 크레딧. 잔액을 읽지 못했으면 null(화면에 0이 아니라 '확인 불가'로 보여 준다).
  credit_balance: number | null
}

export interface AdminUserListResult {
  users: AdminUserListItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  query: string
}

const USER_COLUMNS = 'id, email, display_tag, phone, organization, role, is_admin, provider, created_at'
const SEARCH_COLUMNS = ['email', 'phone', 'organization'] as const
const RANGE_NOT_SATISFIABLE_ERROR_CODE = 'PGRST103'

// ilike 패턴의 와일드카드(% _)와 이스케이프 문자를 글자 그대로 찾게 한다.
export function buildAdminUserSearchFilter(keyword: string) {
  const escaped = keyword.replace(/[\\%_]/g, '\\$&')
  return SEARCH_COLUMNS.map((column) => `${column}.ilike.${JSON.stringify(`%${escaped}%`)}`).join(',')
}

// 쓸 수 있는 크레딧 = 사용 중(active)이고 만료되지 않은 원천의 남은 수량 합(get_credit_balance_snapshot의 spendable_balance와 같은 기준).
export function sumSpendableCredits(
  sources: Array<{ user_id: string; remaining_credits: number | null }>
) {
  const balances = new Map<string, number>()
  for (const source of sources) {
    balances.set(source.user_id, (balances.get(source.user_id) ?? 0) + (source.remaining_credits ?? 0))
  }
  return balances
}

export async function listAdminUsers(input: { q?: string | null; page?: unknown; pageSize?: unknown }): Promise<AdminUserListResult> {
  const supabase = createAdminClient()
  const query = (input.q ?? '').trim()

  function userQuery(head = false) {
    let builder = supabase.from('profiles').select(USER_COLUMNS, { count: 'exact', head })
    if (query) {
      builder = builder.or(buildAdminUserSearchFilter(query))
    }
    return builder
  }
  function pageQuery(offset: number, pageSize: number) {
    return userQuery()
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
  }

  // 개수와 요청한 페이지를 한 번에 읽고, 요청 페이지가 마지막 페이지를 넘었을 때만 마지막 페이지로 다시 읽는다.
  const requested = getListPagination(Number.MAX_SAFE_INTEGER, input.page, input.pageSize)
  let usersResult = await pageQuery(requested.offset, requested.pageSize)
  let totalCount = usersResult.count ?? 0
  if (usersResult.error?.code === RANGE_NOT_SATISFIABLE_ERROR_CODE) {
    const { count, error: countError } = await userQuery(true)
    if (countError) throw new Error(countError.message)
    totalCount = count ?? 0
  } else if (usersResult.error) {
    throw new Error(usersResult.error.message)
  }

  const pagination = getListPagination(totalCount, input.page, input.pageSize)
  if (pagination.totalCount > 0 && pagination.offset !== requested.offset) {
    usersResult = await pageQuery(pagination.offset, pagination.pageSize)
    if (usersResult.error) throw new Error(usersResult.error.message)
  }

  const profiles = pagination.totalCount > 0 ? (usersResult.data ?? []) : []
  const userIds = profiles.map((profile) => profile.id)

  let balances: Map<string, number> | null = new Map()
  if (userIds.length > 0) {
    const { data: sources, error: sourcesError } = await supabase
      .from('credit_sources')
      .select('user_id, remaining_credits')
      .in('user_id', userIds)
      .eq('status', 'active')
      // 다 쓴 원천(0)은 합에 영향이 없으므로 읽지 않는다(행 수 상한에 걸려 잔액이 작게 나오는 일을 줄인다).
      .gt('remaining_credits', 0)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

    if (sourcesError) {
      // 잔액을 못 읽어도 회원 목록은 보여 준다(잔액 칸만 '확인 불가').
      console.error('[admin-users] 크레딧 잔액을 읽지 못했습니다.', { message: sourcesError.message })
      balances = null
    } else {
      balances = sumSpendableCredits(sources ?? [])
    }
  }

  return {
    users: profiles.map((profile) => ({
      ...profile,
      credit_balance: balances ? balances.get(profile.id) ?? 0 : null,
    })),
    totalCount: pagination.totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
    query,
  }
}
