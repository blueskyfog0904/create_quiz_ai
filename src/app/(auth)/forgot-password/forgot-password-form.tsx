'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { requestPasswordReset } from '../../auth/password-reset-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export function ForgotPasswordForm({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [isLoading, setIsLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleRequest(formData: FormData) {
    setIsLoading(true)
    try {
      const result = await requestPasswordReset(formData)
      if (result.success) {
        setNotice(result.message)
      } else {
        toast.error(result.error)
      }
    } catch (error) {
      console.error('Password reset request error:', error)
      toast.error('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center tracking-tight">비밀번호 재설정</CardTitle>
          <CardDescription className="text-center text-gray-500 break-keep">
            가입할 때 쓴 이메일을 입력하면 재설정 링크를 보내 드립니다
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {isLoggedIn && !notice && (
            <div className="rounded-md bg-gray-50 text-sm text-gray-600 px-3 py-2 border border-gray-200 break-keep">
              지금 로그인되어 있습니다. 기존 비밀번호를 알고 있으면{' '}
              <Link href="/mypage/profile" className="underline underline-offset-4 hover:text-primary font-medium">회원정보</Link>
              에서 바로 바꿀 수 있습니다.
            </div>
          )}
          {notice ? (
            <div role="status" className="rounded-md bg-green-50 text-sm text-green-700 px-3 py-3 border border-green-200 break-keep leading-relaxed">
              {notice}
            </div>
          ) : (
            <form action={handleRequest}>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">이메일</Label>
                  <Input id="email" name="email" type="email" placeholder="name@example.com" autoComplete="email" required className="h-11" />
                </div>
                <p className="text-xs text-gray-500 break-keep">
                  카카오로 가입한 계정은 비밀번호가 없습니다. 로그인 화면에서 카카오 로그인을 이용해 주세요.
                </p>
                <Button className="w-full h-11 mt-2 text-md font-medium" type="submit" disabled={isLoading}>
                  {isLoading ? '보내는 중...' : '재설정 메일 받기'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 pb-8">
          <div className="text-sm text-center text-gray-500">
            <Link href="/login" className="underline underline-offset-4 hover:text-primary font-medium">로그인으로 돌아가기</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
