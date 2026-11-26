import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeIlike } from '@/lib/admin-orders'
import { MEMBER_WITHDRAWAL_POLICY_SETTING_KEY } from '@/lib/member-withdrawal'
import { createAdminClient } from '@/lib/supabase/bypass'

// 13번 묶음: 관리자 고객지원 화면의 서버 키 읽기. 권한 가드는 부르는 페이지·route 가 먼저 한다.
const db = () => createAdminClient() as unknown as SupabaseClient

// 문의 목록의 회원 이메일 검색(8-2): 세션으로 profiles 를 읽지 않고 서버 키로 맞는 회원 id 만 돌려준다.
// 탈퇴 회원 id 는 돌려주지 않는다. 상한보다 하나 더 읽어 넘쳤는지 알린다(쪽을 넘겨도 같은 회원이 잡히게 id 순).
export async function findSupportMemberIdsByEmail(keyword: string, limit: number): Promise<{ ids: string[]; truncated: boolean }> {
  const emailKeyword = keyword.replaceAll('*', '')
  if (!emailKeyword) return { ids: [], truncated: false }
  const { data, error } = await db()
    .from('profiles')
    .select('id')
    .ilike('email', `%${escapeIlike(emailKeyword)}%`)
    .is('withdrawn_at', null)
    .order('id')
    .limit(limit + 1)
  if (error) throw new Error(`회원 검색 실패: ${error.code ?? ''}`)
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id)
  return { ids: ids.slice(0, limit), truncated: ids.length > limit }
}

// slug 를 바꿀 수 없는 카테고리 id(7절, DB 트리거 guard_support_category_slug 와 같은 규칙 — 화면은 칸을 잠그는 데만 쓴다):
// 문의가 1건이라도 달린 것(회원 삭제·탈퇴 회원 문의 포함 — 서버 키라 RLS 와 무관), 탈퇴 정책 redactionRefundCategorySlugs 에 든 slug.
// 읽지 못하면 모두 잠근다(DB 가 어차피 막으므로 화면이 막는 쪽으로).
export async function readLockedSupportCategoryIds(categories: readonly { id: string; slug: string }[]): Promise<string[]> {
  if (categories.length === 0) return []
  try {
    const [policyResult, ...counts] = await Promise.all([
      db().from('system_settings').select('value').eq('key', MEMBER_WITHDRAWAL_POLICY_SETTING_KEY).maybeSingle(),
      ...categories.map((category) =>
        db().from('support_tickets').select('id', { count: 'exact', head: true }).eq('category_id', category.id)),
    ])
    if (policyResult.error) throw policyResult.error
    const policy = (policyResult.data as { value?: { redactionRefundCategorySlugs?: unknown } } | null)?.value
    const slugs = Array.isArray(policy?.redactionRefundCategorySlugs)
      ? policy.redactionRefundCategorySlugs.filter((slug): slug is string => typeof slug === 'string')
      : []
    return categories
      .filter((category, index) => {
        const result = counts[index]
        if (result.error) throw result.error
        return (result.count ?? 0) > 0 || slugs.includes(category.slug)
      })
      .map((category) => category.id)
  } catch (error) {
    console.error('[admin-support] 카테고리 잠금 여부를 읽지 못했습니다.', { code: (error as { code?: string })?.code })
    return categories.map((category) => category.id)
  }
}
