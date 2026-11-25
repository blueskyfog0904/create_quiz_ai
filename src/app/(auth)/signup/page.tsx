import { UpcomingPolicyNotice } from '@/components/legal/upcoming-policy-notice'
import SignupClient, { type SignupConsentForm } from './signup-client'
import { getConsentSenderName, loadConsentFormData } from '@/lib/signup-consent-server'

// 가입 화면: 약관 동의 항목·안내 문구는 서버가 서비스 키로 읽어 넘긴다(비로그인 화면이라 세션으로는 읽을 수 없다).
export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const [form, senderName] = await Promise.all([loadConsentFormData(), getConsentSenderName()])
  const consentForm: SignupConsentForm = form.ok
    ? { ok: true, items: form.items, texts: form.texts, privacyPolicyHref: form.privacyPolicyHref, senderName }
    : { ok: false, code: form.code }
  return <SignupClient consentForm={consentForm} upcomingNotice={<UpcomingPolicyNotice />} />
}
