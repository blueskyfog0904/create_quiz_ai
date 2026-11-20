import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { normalizeConsentNextPath } from '@/lib/auth-paths'
import { buildConsentPagePath } from '@/lib/consent-gate'
import { extractConsentErrorCode } from '@/lib/signup-consent'
import {
  getConsentSenderName,
  loadConsentFormData,
  readItemIdsWithCurrentRecord,
  readProfileConsentState,
} from '@/lib/signup-consent-server'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import { ConsentClient, ConsentUnavailable } from './consent-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '약관 동의',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null

export default async function ConsentPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const rawNext = firstParam(params.next)

  // 비로그인으로 왔다가 로그인해 login=success 가 이 주소에 붙었으면, 화면을 그리기 전에 그 값을 next 안으로 옮긴다
  // (전역 로그인 완료 창이 여기서 뜨거나 닫힐 때 값을 지우지 않게 — 원래 화면에서 담기·구매가 이어진다).
  if (firstParam(params.login) === 'success') {
    const nextUrl = new URL(normalizeConsentNextPath(rawNext), 'http://localhost')
    nextUrl.searchParams.set('login', 'success')
    redirect(buildConsentPagePath(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`))
  }

  const next = normalizeConsentNextPath(rawNext)
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?${new URLSearchParams({ next: buildConsentPagePath(next) }).toString()}`)
  }

  const profileState = await readProfileConsentState(userId)
  if (!profileState.ok) {
    return <ConsentUnavailable kind="retry" />
  }
  if (!profileState.profile) {
    return <ConsentUnavailable kind="profile_missing" />
  }
  // 카카오 가입을 마치지 않았으면 카카오 가입 단계가 먼저다.
  if (profileState.profile.provider === 'kakao' && !profileState.profile.signupCompleted) {
    redirect(`/signup?${new URLSearchParams({ provider: 'kakao', signup: '1', next }).toString()}`)
  }

  // 미들웨어와 같은 판정(사용자 세션). 성공 응답이 빈 배열일 때만 이동한다 — 오류면 이동하지 않는다(왕복 방지).
  const supabase = await createClient() as unknown as SupabaseClient
  const { data: missing, error } = await supabase.rpc('get_my_missing_required_consents')
  if (error) {
    return extractConsentErrorCode(error.message) === 'CONSENT_PROFILE_MISSING'
      ? <ConsentUnavailable kind="profile_missing" />
      : <ConsentUnavailable kind="retry" />
  }
  if (!Array.isArray(missing)) {
    return <ConsentUnavailable kind="retry" />
  }
  if (missing.length === 0) {
    redirect(next)
  }

  const [form, senderName, footer] = await Promise.all([loadConsentFormData(), getConsentSenderName(), getSolvookFooterData()])
  if (!form.ok) {
    return <ConsentUnavailable kind={form.code === 'CONSENT_POLICY_UNAVAILABLE' ? 'policy_unavailable' : 'retry'} />
  }
  const optionalItems = form.items.filter((item) => !item.required)
  const recorded = await readItemIdsWithCurrentRecord(userId, optionalItems)
  if (!recorded) {
    return <ConsentUnavailable kind="retry" />
  }

  const missingIds = new Set(missing as string[])
  const items = form.items.filter((item) => (item.required ? missingIds.has(item.id) : !recorded.has(item.id)))
  const revised = items.some((item) => item.required && Boolean(item.note))

  return (
    <ConsentClient
      items={items}
      texts={form.texts}
      privacyPolicyHref={form.privacyPolicyHref}
      senderName={senderName}
      next={next}
      revised={revised}
      customerCenter={[footer.cs.phone, footer.cs.email].filter(Boolean).join(' · ')}
    />
  )
}
