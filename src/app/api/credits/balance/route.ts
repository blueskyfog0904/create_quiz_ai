/**
 * GET /api/credits/balance
 * 현재 사용자의 크레딧 잔액을 조회합니다.
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // profiles 테이블에서 credits 조회
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Failed to fetch credit balance:', error)
      return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 })
    }

    return NextResponse.json({
      balance: profile?.credits ?? 0
    })
  } catch (error) {
    console.error('Failed to fetch credit balance:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
