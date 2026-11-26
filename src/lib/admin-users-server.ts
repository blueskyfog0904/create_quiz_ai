import type { SupabaseClient } from '@supabase/supabase-js'
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
  // 탈퇴(익명화)한 회원이면 그 시각(10번 묶음). 개인정보 칸은 비어 있다.
  withdrawn_at: string | null
  // 지금 쓸 수 있는 크레딧. 잔액을 읽지 못했으면 null(화면에 0이 아니라 '확인 불가'로 보여 준다).
  credit_balance: number | null
  // 12번: 지금 정지 중(이용 제한·로그인 차단)인지. 읽지 못했으면 null(배지 없이 '확인 불가').
  suspended: boolean | null
}

export interface AdminUserListResult {
  users: AdminUserListItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  query: string
  // 12번: '정지 중만 보기'
  suspendedOnly: boolean
}

const USER_COLUMNS = 'id, email, display_tag, phone, organization, role, is_admin, provider, created_at, withdrawn_at'
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

// 12번: 활성 정지(해제 안 됨이고 끝나는 날이 없거나 지나지 않음)인 회원 id. userIds 를 주면 그 회원들만 본다.
async function readActiveSuspendedUserIds(userIds?: string[]) {
  let builder = (createAdminClient() as unknown as SupabaseClient).from('member_suspensions')
    .select('user_id')
    .is('lifted_at', null)
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
  if (userIds) builder = builder.in('user_id', userIds)
  const { data, error } = await builder
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((row: { user_id: string }) => row.user_id))
}

export async function listAdminUsers(input: { q?: string | null; page?: unknown; pageSize?: unknown; suspended?: unknown }): Promise<AdminUserListResult> {
  const supabase = createAdminClient()
  const query = (input.q ?? '').trim()
  const suspendedOnly = input.suspended === '1'
  // '정지 중만 보기': 정지 행을 먼저 읽어 그 회원만 고른다(읽지 못하면 목록 전체가 오류 — 잘못된 목록을 보이지 않게).
  const suspendedIds = suspendedOnly ? [...await readActiveSuspendedUserIds()] : null

  function userQuery(head = false) {
    let builder = supabase.from('profiles').select(USER_COLUMNS, { count: 'exact', head })
    if (query) {
      builder = builder.or(buildAdminUserSearchFilter(query))
    }
    if (suspendedIds) {
      // 정지 중인 회원이 없으면 어떤 id 와도 맞지 않는 값으로 빈 목록을 만든다.
      builder = builder.in('id', suspendedIds.length > 0 ? suspendedIds : ['00000000-0000-0000-0000-000000000000'])
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

  let suspended: Set<string> | null = new Set()
  if (userIds.length > 0) {
    try {
      suspended = await readActiveSuspendedUserIds(userIds)
    } catch (error) {
      // 정지 여부를 못 읽어도 회원 목록은 보여 준다(배지 칸만 '확인 불가').
      console.error('[admin-users] 정지 여부를 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
      suspended = null
    }
  }

  return {
    users: profiles.map((profile) => ({
      ...profile,
      credit_balance: balances ? balances.get(profile.id) ?? 0 : null,
      suspended: suspended ? suspended.has(profile.id) : null,
    })),
    totalCount: pagination.totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
    query,
    suspendedOnly,
  }
}
