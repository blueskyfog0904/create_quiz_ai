import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { ProfileView } from './_components/profile-view'

export const metadata: Metadata = {
  title: '내정보 관리 | 써머썬 연구소',
  description: '이름·이메일·휴대폰 번호 확인과 비밀번호 변경',
}

export default async function ProfilePage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/profile')}`)
  }

  const supabase = await createClient()
  const [{ data: authData }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('profiles')
      .select('name, phone, created_at')
      .eq('id', userId)
      .single(),
  ])

  return (
    <Suspense fallback={null}>
      <ProfileView
        email={authData.user?.email ?? ''}
        name={profile?.name ?? null}
        phone={profile?.phone ?? null}
        createdAt={profile?.created_at ?? null}
      />
    </Suspense>
  )
}
