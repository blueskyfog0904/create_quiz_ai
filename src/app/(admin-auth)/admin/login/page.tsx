import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { AdminLoginView } from './_components/admin-login-view'

export const metadata: Metadata = {
  title: '관리자 로그인 | 써머썬 연구소',
  description: '써머썬 연구소 관리자 패널 로그인',
}

export default async function AdminLoginPage() {
  await connection()

  // 이미 관리자로 로그인된 상태면 바로 패널로 보낸다
  const userId = await getRequestAuthUserId()
  if (userId) {
    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single()
    if (profile?.is_admin) {
      redirect('/admin')
    }
  }

  return (
    <Suspense fallback={null}>
      <AdminLoginView />
    </Suspense>
  )
}
