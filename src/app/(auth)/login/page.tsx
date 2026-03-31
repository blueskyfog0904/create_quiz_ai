'use client'

import { useState, Suspense } from 'react'
import { login } from '../../auth/actions'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { parseWorkspaceSubjectFromPath, stripWorkspacePrefix, withWorkspacePrefix } from '@/lib/workspace-subject'

const errorMessages: Record<string, string> = {
  access_denied: '카카오 로그인 동의가 취소되었습니다. 다시 시도해주세요.',
  user_cancelled: '로그인 동의가 취소되었습니다.',
  invalid_request: '요청 형식이 올바르지 않습니다.',
  server_error: '로그인 처리 중 서버 오류가 발생했습니다.',
  temporarily_unavailable: '현재 인증 서버를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
  kakao_missing_code: '인증 코드가 누락되었습니다. 다시 로그인 시도해주세요.',
  callback_error: '카카오 로그인 처리 중 오류가 발생했습니다.',
}

function getKakaoErrorMessage(error: string | null, description: string | null) {
  if (description) {
    return description
  }

  if (error && errorMessages[error]) {
    return errorMessages[error]
  }

  if (error) {
    return `로그인 오류가 발생했습니다. (${error})`
  }

  return null
}

function getWorkspaceHomePath(path: string) {
  const subject = parseWorkspaceSubjectFromPath(path)
  return subject ? withWorkspacePrefix(subject, '/') : '/'
}

function normalizeInternalPath(path: string | null) {
  if (!path) {
    return '/'
  }

  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/'
  }

  try {
    const url = new URL(trimmed, 'http://localhost')
    const pathname = url.pathname
    const scopedPath = stripWorkspacePrefix(pathname).scopedPath

    if (pathname === '/login' || pathname === '/signup' || scopedPath === '/login' || scopedPath === '/signup') {
      return getWorkspaceHomePath(pathname)
    }

    return `${pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false)
  const searchParams = useSearchParams()

  const next = normalizeInternalPath(searchParams.get('next'))
  const errorCode = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const errorMessage = getKakaoErrorMessage(errorCode, errorDescription)
  const nextQuery = next === '/' ? '' : `?${new URLSearchParams({ next }).toString()}`
  const callbackPath = new URLSearchParams({ next }).toString()

  async function handleEmailLogin(formData: FormData) {
    setIsLoading(true)
    try {
      const result = await login(formData)
      
      if (result?.error) {
        toast.error(result.error)
        setIsLoading(false)
      } else if (result?.success) {
        // Verify session before redirecting
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        
        if (session) {
          toast.success('로그인이 되었습니다.')
          window.location.assign(next)
        } else {
          toast.error('세션을 확인할 수 없습니다. 다시 시도해주세요.')
          setIsLoading(false)
        }
      }
    } catch (error) {
      console.error('Login error:', error)
      const message = error instanceof Error ? error.message : '로그인 중 오류가 발생했습니다.'
      toast.error(message)
      setIsLoading(false)
    }
  }

  async function handleKakaoLogin() {
    if (isLoading) return

    setIsLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackPath}`,
        queryParams: {
          prompt: 'select_account',
          scope: 'account_email,phone_number,name',
        },
      },
    })

    if (error) {
      setIsLoading(false)
      toast.error(error.message)
    }
    // Redirect happens automatically
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center tracking-tight">로그인</CardTitle>
        <CardDescription className="text-center text-gray-500">
            이메일 또는 카카오 계정으로 로그인하세요
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {errorMessage && (
            <div className="rounded-md bg-red-50 text-sm text-red-600 px-3 py-2 border border-red-200">
              {errorMessage}
            </div>
          )}
          <div className="grid gap-2">
            <Button
              variant="outline"
              onClick={handleKakaoLogin}
              disabled={isLoading}
              className="w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90 border-none h-11 shadow-sm font-medium"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C5.373 3 0 6.657 0 11.172c0 2.985 2.328 5.642 5.938 7.07l-1.38 5.105c-.13.48.465.84.866.566l6.06-4.14C11.83 19.83 12.165 19.84 12.5 19.84 19.127 19.84 24.5 16.184 24.5 11.67 24.5 7.156 19.127 3 12 3z"/>
              </svg>
              카카오로 시작하기
            </Button>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500 font-medium">
                또는 이메일로 계속하기
              </span>
            </div>
          </div>
          <form action={handleEmailLogin}>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">이메일</Label>
                <Input id="email" name="email" type="email" placeholder="name@example.com" required className="h-11" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input id="password" name="password" type="password" required className="h-11" />
              </div>
              <Button className="w-full h-11 mt-2 text-md font-medium" type="submit" disabled={isLoading}>
                {isLoading ? '로그인 중...' : '로그인'}
              </Button>
            </div>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 pb-8">
          <div className="text-sm text-center text-gray-500">
            계정이 없으신가요? <Link href={`/signup${nextQuery}`} className="underline underline-offset-4 hover:text-primary font-medium ml-1">회원가입</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
