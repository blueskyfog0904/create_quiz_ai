import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { ProfileView } from './_components/profile-view'

export const metadata: Metadata = {
  title: '내정보 관리',
  description: '이메일·휴대폰 번호 확인과 비밀번호 변경',
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
      .select('phone, created_at, display_tag, is_admin')
      .eq('id', userId)
      .single(),
  ])

  return (
    <Suspense fallback={null}>
      <ProfileView
        email={authData.user?.email ?? ''}
        displayName={formatMemberDisplayName(authData.user?.email, profile?.display_tag)}
        phone={profile?.phone ?? null}
        createdAt={profile?.created_at ?? null}
        // 관리자 계정의 비밀번호는 관리자 비밀번호 변경 화면에서 바꾼다(10번 묶음 6-10).
        adminPasswordHref={profile?.is_admin ? '/admin/my-password' : null}
      />
    </Suspense>
  )
}
