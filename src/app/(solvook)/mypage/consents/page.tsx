import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { getConsentSenderName, readMyOptionalConsents, readSignupConsentTexts } from '@/lib/signup-consent-server'
import { OptionalConsentsView } from './optional-consents-view'

export const metadata: Metadata = {
  title: '선택 동의 관리',
}

export default async function MyConsentsPage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/consents')}`)
  }

  const [entries, texts, senderName] = await Promise.all([
    readMyOptionalConsents(userId),
    readSignupConsentTexts(),
    getConsentSenderName(),
  ])

  return (
    <OptionalConsentsView
      entries={entries}
      resultTemplate={texts?.optionalResultTemplate ?? null}
      senderName={senderName}
    />
  )
}
