'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  MEMBER_SUSPENSION_POLICY_CACHE_TAG,
  readMemberSuspensionPolicyUncached,
} from '@/lib/member-suspension-policy-server'
import { describeMemberSuspensionError, type MemberSuspensionPolicy } from '@/lib/member-suspension'

// 12번 묶음(계획 6-3, 대표 전용): 이용 정지 안내 문구·사유 분류·최대 정지 일수. 저장·revision 비교·작업 기록은
// DB 함수 save_member_suspension_policy 가 같은 거래에서 한다(대표 확인도 다시 함). 저장 뒤 회원 화면 캐시를 바로 버린다.

export type MemberSuspensionPolicyAdminData =
  | { ok: true; policy: MemberSuspensionPolicy; inUseCodes: string[] }
  | { ok: false; error: string }

async function loadAdminView(): Promise<MemberSuspensionPolicyAdminData> {
  const [policy, used] = await Promise.all([
    readMemberSuspensionPolicyUncached(),
    (createAdminClient() as unknown as SupabaseClient).from('member_suspensions').select('reason_code'),
  ])
  if (!policy || used.error) return { ok: false, error: '이용 정지 설정을 불러오지 못했습니다.' }
  const inUseCodes = [...new Set((used.data ?? []).map((row: { reason_code: string }) => row.reason_code))].sort()
  return { ok: true, policy, inUseCodes }
}

export async function getMemberSuspensionPolicyAdminData(): Promise<MemberSuspensionPolicyAdminData> {
  await assertAdminActionPermission('owner')
  return loadAdminView()
}

export type MemberSuspensionPolicySaveResult =
  | { success: true; changed: boolean; data: MemberSuspensionPolicyAdminData }
  | { success: false; error: string; code: string; data: MemberSuspensionPolicyAdminData | null }

export async function saveMemberSuspensionPolicyAction(
  expectedRevision: number,
  value: Pick<MemberSuspensionPolicy, 'maxRestrictedDays' | 'texts' | 'reasonCategories'>
): Promise<MemberSuspensionPolicySaveResult> {
  const access = await assertAdminActionPermission('owner')
  if (!Number.isInteger(expectedRevision) || !value || typeof value !== 'object') {
    return { success: false, error: '입력값을 확인해 주세요.', code: 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID', data: null }
  }
  const { data, error } = await (createAdminClient() as unknown as SupabaseClient).rpc('save_member_suspension_policy', {
    p_actor_id: access.userId,
    p_expected_revision: expectedRevision,
    p_value: { maxRestrictedDays: value.maxRestrictedDays, texts: value.texts, reasonCategories: value.reasonCategories },
  })
  if (error) {
    const view = describeMemberSuspensionError(error.message)
    // 판 충돌이면 최신 값을 다시 읽어 돌려준다.
    const latest = view.code === 'MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT' ? await loadAdminView() : null
    const detail = view.code === 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID' || view.code === 'MEMBER_SUSPENSION_POLICY_CODE_IN_USE'
      ? ` (${error.message.split(':').slice(1).join(':').trim() || view.code})`
      : ''
    return { success: false, error: `${view.message}${detail}`, code: view.code, data: latest }
  }
  const changed = (data as { changed?: unknown } | null)?.changed === true
  if (changed) {
    revalidateTag(MEMBER_SUSPENSION_POLICY_CACHE_TAG, { expire: 0 })
    revalidatePath('/admin/users')
  }
  return { success: true, changed, data: await loadAdminView() }
}
