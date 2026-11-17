import type { Metadata } from 'next'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata: Metadata = {
  title: '비밀번호 재설정',
  robots: { index: false },
}

export default async function ForgotPasswordPage() {
  const userId = await getRequestAuthUserId()

  return <ForgotPasswordForm isLoggedIn={Boolean(userId)} />
}
