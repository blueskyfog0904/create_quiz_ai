'use client'

import { useState } from 'react'
import { login } from '../../auth/actions'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

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
          // Force full page reload to ensure session is properly set
          window.location.href = '/'
        } else {
          toast.error('세션을 확인할 수 없습니다. 다시 시도해주세요.')
          setIsLoading(false)
        }
      }
    } catch (error: any) {
      console.error('Login error:', error)
      toast.error('로그인 중 오류가 발생했습니다.')
      setIsLoading(false)
    }
  }

  async function handleKakaoLogin() {
    setIsLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
          <div className="grid gap-2">
             <Button variant="outline" onClick={handleKakaoLogin} disabled={isLoading} className="w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90 border-none h-11 shadow-sm font-medium">
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
                계정이 없으신가요? <Link href="/signup" className="underline underline-offset-4 hover:text-primary font-medium ml-1">회원가입</Link>
            </div>
        </CardFooter>
      </Card>
    </div>
  )
}
