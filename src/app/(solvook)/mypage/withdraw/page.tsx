import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { hasPaymentRecordsBlockingWithdrawal } from '@/lib/withdraw-eligibility'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { WithdrawView, type WithdrawBlockedReason } from './_components/withdraw-view'

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

  // 탈퇴 route(/api/auth/withdraw)가 막는 계정에는 폼 대신 안내를 미리 보여 준다.
  // 조회가 실패하면 폼을 그대로 보여 준다(최종 판정은 route가 한다).
  let blockedReason: WithdrawBlockedReason | null = null
  const user = authData.user
  try {
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle()
      if (profile?.is_admin) {
        blockedReason = 'admin'
      } else if (await hasPaymentRecordsBlockingWithdrawal(createAdminClient(), user.id)) {
        blockedReason = 'payment'
      }
    }
  } catch (error) {
    console.error('Withdraw eligibility lookup error:', error)
  }

  return (
    <Suspense fallback={null}>
      <WithdrawView email={user?.email || ''} blockedReason={blockedReason} />
    </Suspense>
  )
}
