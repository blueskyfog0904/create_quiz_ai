import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { extractConsentErrorCode, getConsentErrorMessage } from '@/lib/signup-consent'
import { loadConsentFormData } from '@/lib/signup-consent-server'

const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .refine((value) => value === '' || /^01[016789]-\d{3,4}-\d{4}$/.test(value), {
    message: '휴대폰 번호 형식이 올바르지 않습니다.',
  })

const profileMutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_phone'),
    phone: phoneSchema,
  }).strict(),
  z.object({
    action: z.literal('complete_kakao_signup'),
    phone: phoneSchema.optional(),
    // 약관 동의는 필수다(배포 중 옛 화면은 400 — 새로고침하면 동의 화면이 보인다).
    consents: z.array(z.object({
      item_id: z.string().uuid(),
      version: z.number().int().min(1),
      agreed: z.boolean(),
    }).strict()).min(1).max(50),
  }).strict(),
])

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const parsed = profileMutationSchema.safeParse(body)
  if (!parsed.success) {
    if (body && typeof body === 'object' && (body as JsonRecord).action === 'complete_kakao_signup' && !('consents' in (body as JsonRecord))) {
      return NextResponse.json({ error: '화면을 새로고침한 뒤 다시 시도해 주세요.', code: 'CONSENT_INPUT_INVALID' }, { status: 400 })
    }
    return NextResponse.json(
      {
        error: '입력값을 확인해 주세요.',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()

  if (parsed.data.action === 'update_phone') {
    const { data, error } = await adminSupabase
      .from('profiles')
      .update({ phone: parsed.data.phone || null })
      .eq('id', user.id)
      .select('id, email, phone, signup_completed')
      .single()

    if (error) {
      console.error('[Profile API] Failed to update phone:', error)
      return NextResponse.json({ error: '프로필 업데이트에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ profile: data })
  }

  const kakaoIdentity = user.identities?.find((identity) => identity.provider === 'kakao')
  const provider = firstText(user.app_metadata?.provider, kakaoIdentity?.provider)

  if (provider !== 'kakao' || !kakaoIdentity) {
    return NextResponse.json({ error: '카카오 가입 세션이 아닙니다.' }, { status: 403 })
  }

  const userMetadata = asRecord(user.user_metadata)
  const identityData = asRecord(kakaoIdentity.identity_data)
  const kakaoAccount = asRecord(userMetadata.kakao_account)
  const email = firstText(
    user.email,
    userMetadata.email,
    identityData.email,
    kakaoAccount.email
  )
  const kakaoId = firstText(
    identityData.sub,
    identityData.id,
    userMetadata.sub,
    kakaoIdentity.id
  )

  // 3시간 절대 만료와 기준을 맞춘다(미들웨어가 확인한 회원과 세션 회원이 같을 때만).
  if ((await getRequestAuthUserId()) !== user.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 필수 약관의 연결 문서·개인정보처리방침을 불러올 수 없으면 가입을 마치지 않는다.
  const form = await loadConsentFormData()
  if (!form.ok) {
    return NextResponse.json({ error: getConsentErrorMessage(form.code), code: form.code }, { status: 503 })
  }

  // 동의 기록 + 프로필 갱신을 한 트랜잭션으로(이미 완료면 아무것도 바꾸지 않고 지금 상태를 돌려준다).
  const { data, error } = await (adminSupabase as unknown as SupabaseClient).rpc('complete_kakao_signup_with_consents', {
    p_user_id: user.id,
    p_items: parsed.data.consents,
    p_email: email,
    p_phone: parsed.data.phone || null,
    p_kakao_email: email,
    p_kakao_id: kakaoId,
  })

  if (error) {
    const code = extractConsentErrorCode(error.message)
    if (code) {
      return NextResponse.json({ error: getConsentErrorMessage(code), code }, { status: 400 })
    }
    console.error('[Profile API] Failed to complete Kakao signup:', { code: error.code })
    return NextResponse.json({ error: '카카오 회원정보 저장에 실패했습니다.' }, { status: 500 })
  }

  const result = data as { profile?: unknown; consentResults?: unknown } | null
  return NextResponse.json({ profile: result?.profile ?? null, consentResults: result?.consentResults ?? [] })
}
