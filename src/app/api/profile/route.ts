import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'

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
    name: z.string().trim().min(1).max(60),
    phone: phoneSchema.optional(),
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
      .select('id, email, name, phone, signup_completed')
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

  const { data, error } = await adminSupabase
    .from('profiles')
    .update({
      email,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      kakao_email: email,
      kakao_id: kakaoId,
      provider: 'kakao',
      signup_completed: true,
    })
    .eq('id', user.id)
    .select('id, email, name, phone, signup_completed')
    .single()

  if (error) {
    console.error('[Profile API] Failed to complete Kakao signup:', error)
    return NextResponse.json({ error: '카카오 회원정보 저장에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ profile: data })
}
