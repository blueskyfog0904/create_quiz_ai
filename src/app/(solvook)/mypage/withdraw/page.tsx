import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { WithdrawView } from './_components/withdraw-view'

export const metadata: Metadata = {
  title: '회원 탈퇴 | 써머썬 연구소',
  description: '계정과 모든 데이터를 영구 삭제합니다.',
}

export default async function WithdrawPage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/withdraw')}`)
  }

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()

  return (
    <Suspense fallback={null}>
      <WithdrawView email={authData.user?.email || ''} />
    </Suspense>
  )
}
