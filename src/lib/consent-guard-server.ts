import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdminAccountEmail } from '@/lib/admin-accounts-shared'
import { extractConsentErrorCode } from '@/lib/signup-consent'
import { checkMemberSuspensionForApi } from '@/lib/member-suspension-server'

// 돈 API(충전 주문·자료 구매·크레딧 차감 생성)의 실제 강제: 필수 약관에 동의하지 않은 회원은 막는다(실패하면 막는다).
// 화면 이동(미들웨어)은 최선 노력이고, 여기가 마지막 관문이다. 인증 확인 직후, 첫 DB 쓰기·외부 호출 전에 부른다.
// 12번 5-1: 동의를 통과하면 같은 자리에서 이용 정지(쓰기)도 본다 — 막히면 MEMBER_SUSPENDED·SUSPENSION_CHECK_FAILED(문구는 정책 값).
type ConsentBlockCode = 'CONSENT_REQUIRED' | 'CONSENT_CHECK_FAILED' | 'CONSENT_PROFILE_MISSING' | 'ADMIN_ACCOUNT_NOT_MEMBER'
export type ConsentBlock = { status: 403 | 503; code: ConsentBlockCode | 'MEMBER_SUSPENDED' | 'SUSPENSION_CHECK_FAILED'; message: string }

const CONSENT_BLOCK_MESSAGES: Record<ConsentBlockCode, string> = {
  CONSENT_REQUIRED: '약관 동의가 필요합니다. 동의 화면으로 이동합니다.',
  CONSENT_CHECK_FAILED: '약관 동의 여부를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  CONSENT_PROFILE_MISSING: '회원 정보를 찾지 못했습니다. 로그아웃한 뒤 다시 로그인해 주세요.',
  ADMIN_ACCOUNT_NOT_MEMBER: '관리자 계정으로는 구매·충전·생성을 할 수 없습니다. 일반 회원 계정으로 이용해 주세요.',
}

function block(status: ConsentBlock['status'], code: ConsentBlockCode): ConsentBlock {
  return { status, code, message: CONSENT_BLOCK_MESSAGES[code] }
}

export async function checkMemberConsentForApi(
  supabase?: SupabaseClient,
  user?: Pick<User, 'id' | 'email'> | null
): Promise<ConsentBlock | null> {
  try {
    const client = supabase ?? (await createClient() as unknown as SupabaseClient)
    const sessionUser = user ?? (await client.auth.getUser()).data.user
    if (!sessionUser) {
      return block(503, 'CONSENT_CHECK_FAILED')
    }
    // 관리자 ID 계정(내부 도메인)은 회원이 아니다 — 권한이 해제된 관리자 ID 도 여기서 막는다.
    if (isAdminAccountEmail(sessionUser.email ?? '')) {
      return block(403, 'ADMIN_ACCOUNT_NOT_MEMBER')
    }
    const { data, error } = await client.rpc('get_my_missing_required_consents')
    if (error) {
      return extractConsentErrorCode(error.message) === 'CONSENT_PROFILE_MISSING'
        ? block(403, 'CONSENT_PROFILE_MISSING')
        : block(503, 'CONSENT_CHECK_FAILED')
    }
    if (!Array.isArray(data)) {
      return block(503, 'CONSENT_CHECK_FAILED')
    }
    if (data.length > 0) {
      return block(403, 'CONSENT_REQUIRED')
    }
    return await checkMemberSuspensionForApi(sessionUser.id, 'write')
  } catch {
    return block(503, 'CONSENT_CHECK_FAILED')
  }
}

// 응답 모양은 API 쪽 관례를 따른다. 화면은 code 로 동의 화면 이동을 판단한다(src/lib/consent-client.ts).
export function consentBlockResponse(result: ConsentBlock, style: 'structured' | 'plain') {
  if (style === 'structured') {
    return NextResponse.json(
      { success: false, code: result.code, error: { code: result.code, message: result.message } },
      { status: result.status }
    )
  }
  return NextResponse.json({ error: result.message, code: result.code }, { status: result.status })
}
