import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { createAdminClient } from '@/lib/supabase/bypass'

export const dynamic = 'force-dynamic'

// 13번 8-2: 지급 창의 회원 찾기. 브라우저가 DB 를 직접 읽지 않게 서버 키로 찾는다(가드 credits.grant).
// 탈퇴 회원·관리자 계정은 돌려주지 않고, 돌려주기 전에 member_search 로 열람 기록을 남긴다(남기지 못하면 결과를 보내지 않음 — Q4 가).
const SEARCH_LIMIT = 5

// ilike 패턴의 와일드카드(% _)와 이스케이프 문자를 글자 그대로 찾게 한다. PostgREST 가 *를 와일드카드로 바꾸므로 뺀다.
function escapeIlike(keyword: string) {
  return keyword.replaceAll('*', '').replace(/[\\%_]/g, '\\$&')
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminApiPermission('credits.grant')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const query = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 100)
  if (!escapeIlike(query)) return NextResponse.json({ success: true, users: [] })

  const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
    .from('profiles')
    .select('id, email, display_tag')
    .ilike('email', `%${escapeIlike(query)}%`)
    .is('withdrawn_at', null)
    .not('is_admin', 'is', true)
    .order('email')
    .limit(SEARCH_LIMIT)
  if (error) {
    console.error('[admin-users-search] 회원을 찾지 못했습니다.', { code: error.code })
    return NextResponse.json({ error: '회원을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  const users = (data ?? []) as Array<{ id: string; email: string | null; display_tag: string }>

  const logged = await recordMemberAccess({
    access: guard.access,
    screen: 'member_search',
    memberIds: users.map((user) => user.id),
    fields: ['email'],
    context: { count: users.length },
    requestMeta: adminRequestMeta(request),
  })
  if (!logged) {
    return NextResponse.json({ error: '회원 정보 열람 기록을 남기지 못해 검색 결과를 보일 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
  return NextResponse.json({ success: true, users })
}
