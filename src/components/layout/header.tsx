import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HeaderClient } from './header-client'

export async function Header() {
  const supabase = await createClient()
  let user = null

  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
  }

  let profile = null
  let isAdmin = false
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('name, email, is_admin, credits')
      .eq('id', user.id)
      .single()
    profile = data
    isAdmin = data?.is_admin || false
  }

  // 크레딧 잔액은 profiles.credits에서 바로 읽음
  const creditBalance = profile?.credits ?? 0

  return (
    <header className="border-b bg-white sticky top-0 z-50">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="font-bold text-xl text-primary">AI영어문제팩토리</Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex gap-1 items-center">
          {user ? (
            <>
              <Link href="/generate">
                <Button variant="ghost">AI문제생성</Button>
              </Link>
              <Link href="/bank">
                <Button variant="ghost">문제은행</Button>
              </Link>
              <Link href="/pricing">
                <Button variant="ghost">요금제</Button>
              </Link>

              {/* 내 라이브러리 드롭다운 - Client Component */}
              <HeaderClient
                isLoggedIn={true}
                userName={profile?.name || profile?.email || user.email || ''}
                isAdmin={isAdmin}
                creditBalance={creditBalance}
              />
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost">로그인</Button>
              </Link>
              <Link href="/signup">
                <Button>회원가입</Button>
              </Link>
            </>
          )}
        </nav>

        {/* Mobile Navigation - Client Component */}
        <div className="md:hidden">
          <HeaderClient
            isLoggedIn={!!user}
            userName={profile?.name || profile?.email || user?.email || ''}
            isAdmin={isAdmin}
            creditBalance={creditBalance}
            isMobile={true}
          />
        </div>
      </div>
    </header>
  )
}
