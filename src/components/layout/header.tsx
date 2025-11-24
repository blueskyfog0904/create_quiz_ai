import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

export async function Header() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  let profile = null
  let isAdmin = false
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('name, is_admin')
      .eq('id', user.id)
      .single()
    profile = data
    isAdmin = data?.is_admin || false
  }

  return (
    <header className="border-b bg-white sticky top-0 z-50">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="font-bold text-xl text-primary">AI영어문제팩토리</Link>
        <nav className="flex gap-4">
          {user ? (
            <>
              <Link href="/generate">
                <Button variant="ghost">문제 생성</Button>
              </Link>
              <Link href="/bank">
                <Button variant="ghost">문제 은행</Button>
              </Link>
              <Link href="/community-bank">
                <Button variant="ghost">커뮤니티 은행</Button>
              </Link>
              <Link href="/exam-papers">
                <Button variant="ghost">문제지</Button>
              </Link>
              {isAdmin && (
                <Link href="/admin/questions/upload">
                  <Button variant="ghost" className="text-orange-600">관리자 업로드</Button>
                </Link>
              )}
              <div className="flex items-center gap-3 ml-2 border-l pl-4">
                <span className="text-sm text-gray-600">{profile?.name || user.email}</span>
                <LogoutButton />
              </div>
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
      </div>
    </header>
  )
}

