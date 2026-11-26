import 'server-only'

import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  MEMBER_SUSPENSION_POLICY_SETTING_KEY,
  parseMemberSuspensionPolicy,
  type MemberSuspensionPolicy,
} from '@/lib/member-suspension'

// 12번 묶음: 이용 정지 정책(문구·사유 분류·최대 일수) 읽기. 서비스 키로만 읽는다. 저장은 DB 함수 save_member_suspension_policy 가
// 대표 확인·revision 비교·작업 기록까지 한다(관리자 서버 액션이 부른 뒤 revalidateTag(KEY, { expire: 0 })).
export const MEMBER_SUSPENSION_POLICY_CACHE_TAG = MEMBER_SUSPENSION_POLICY_SETTING_KEY

async function readPolicyFromDb(): Promise<MemberSuspensionPolicy> {
  const db = createAdminClient() as unknown as SupabaseClient
  const { data, error } = await db.from('system_settings').select('value').eq('key', MEMBER_SUSPENSION_POLICY_SETTING_KEY).maybeSingle()
  if (error) throw new Error(error.message)
  const policy = parseMemberSuspensionPolicy(data?.value ?? null)
  if (!policy) throw new Error('MEMBER_SUSPENSION_POLICY_INVALID')
  return policy
}

// 캐시 함수 안에서는 실패를 throw 해서 null 이 캐시되지 않게 한다.
const readCachedPolicy = unstable_cache(readPolicyFromDb, [`${MEMBER_SUSPENSION_POLICY_SETTING_KEY}:v1`], {
  revalidate: 60,
  tags: [MEMBER_SUSPENSION_POLICY_CACHE_TAG],
})

// 회원 화면(한 줄 안내·안내 화면·로그인 문구·API 막힘 문구): 읽지 못하면 null(대체 문구 셋만 쓰고 나머지 문단은 그리지 않음).
export async function getMemberSuspensionPolicyCached(): Promise<MemberSuspensionPolicy | null> {
  try {
    return await readCachedPolicy()
  } catch (error) {
    console.error('[member-suspension] 정책 읽기 실패', error instanceof Error ? error.message : error)
    return null
  }
}

// 관리자 화면(정지 창·문구 편집 카드): 캐시 없이 읽는다(revision 비교). 읽지 못하면 null.
export async function readMemberSuspensionPolicyUncached(): Promise<MemberSuspensionPolicy | null> {
  try {
    return await readPolicyFromDb()
  } catch (error) {
    console.error('[member-suspension] 정책 읽기 실패', error instanceof Error ? error.message : error)
    return null
  }
}
