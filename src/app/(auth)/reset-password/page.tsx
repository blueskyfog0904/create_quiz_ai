import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RESET_CONFIRM_PATH,
  PASSWORD_RESET_ERROR_MESSAGES,
  PASSWORD_RESET_REQUEST_PATH,
  isRecoveryMarkerValid,
  parseRecoveryTokenHash,
  resolvePasswordResetError,
  resolveRecoverySessionKey,
} from '@/lib/password-reset'
import { ResetPasswordForm } from './reset-password-form'

export const metadata: Metadata = {
  title: '새 비밀번호 설정',
  robots: { index: false },
  // 주소에 든 token_hash가 다른 사이트로 새지 않게 한다(같은 사이트로 보내는 "계속" POST의 Origin은 유지된다).
  referrer: 'same-origin',
}

type SearchParams = { token_hash?: string | string[]; type?: string | string[]; error?: string | string[] }

function ResetCard({ description, children, footer }: { description: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center tracking-tight">새 비밀번호 설정</CardTitle>
          <CardDescription className="text-center text-gray-500 break-keep">{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">{children}</CardContent>
        {footer && <CardFooter className="flex flex-col gap-2 pb-8">{footer}</CardFooter>}
      </Card>
    </div>
  )
}

const requestAgainLink = (
  <div className="text-sm text-center text-gray-500">
    <Link href={PASSWORD_RESET_REQUEST_PATH} className="underline underline-offset-4 hover:text-primary font-medium">재설정 메일 다시 요청하기</Link>
  </div>
)

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams

  // 1) 메일 링크로 들어온 경우: 여기서는 토큰을 검증하지 않는다(메일 서비스가 링크를 미리 열어도 토큰이 쓰이지 않게).
  //    사람이 "계속"을 눌러 POST를 보낼 때 /auth/confirm이 검증한다.
  if (params.token_hash !== undefined) {
    const tokenHash = parseRecoveryTokenHash(params.token_hash, params.type)
    if (!tokenHash) {
      return (
        <ResetCard description="링크를 확인할 수 없습니다" footer={requestAgainLink}>
          <div role="alert" className="rounded-md bg-red-50 text-sm text-red-600 px-3 py-2 border border-red-200 break-keep">
            {PASSWORD_RESET_ERROR_MESSAGES.invalid_link}
          </div>
        </ResetCard>
      )
    }
    return (
      <ResetCard description="아래 버튼을 누르면 새 비밀번호를 입력하는 화면으로 이동합니다" footer={requestAgainLink}>
        <form method="post" action={PASSWORD_RESET_CONFIRM_PATH}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value="recovery" />
          <Button className="w-full h-11 text-md font-medium" type="submit">계속</Button>
        </form>
      </ResetCard>
    )
  }

  // 2) 링크 확인 실패(만료·재사용·다른 브라우저·관리자 계정)
  const errorCode = resolvePasswordResetError(params.error)
  if (errorCode) {
    return (
      <ResetCard description="비밀번호를 재설정할 수 없습니다" footer={errorCode === 'admin' || errorCode === 'kakao' ? undefined : requestAgainLink}>
        <div role="alert" className="rounded-md bg-red-50 text-sm text-red-600 px-3 py-2 border border-red-200 break-keep">
          {PASSWORD_RESET_ERROR_MESSAGES[errorCode]}
        </div>
      </ResetCard>
    )
  }

  // 3) 새 비밀번호 입력: 메일 링크로 들어온 세션(복구 표시 쿠키가 지금 세션과 맞을 때)에만 보여 준다. 그 밖에는 요청 화면으로.
  //    표시 쿠키는 서명이 없는 화면용 표시다(src/lib/password-reset.ts 주석 참고).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: { session } } = await supabase.auth.getSession()
  const marker = (await cookies()).get(PASSWORD_RECOVERY_COOKIE)?.value
  if (!user || !isRecoveryMarkerValid(marker, resolveRecoverySessionKey(session?.access_token, user.id))) {
    redirect(PASSWORD_RESET_REQUEST_PATH)
  }

  return (
    <ResetCard description={`${user.email ?? '계정'}의 새 비밀번호를 입력해 주세요`}>
      <ResetPasswordForm />
    </ResetCard>
  )
}
