/**
 * GET /api/credits/balance
 * 현재 사용자의 크레딧 잔액을 조회합니다.
 */

import { createClient } from '@/lib/supabase/server'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot, logCreditBalanceMismatch, selectDisplayBalance } from '@/lib/credit-balance'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, {
        status: 401,
        headers: {
          'Cache-Control': 'no-store'
        }
      })
    }

    const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

    if (snapshot.hasMismatch) {
      logCreditBalanceMismatch('balance route', user.id, snapshot)
    }

    const displayBalance = selectDisplayBalance(user.id, snapshot)

    return NextResponse.json(
      {
        ...buildCreditBalanceResponseFields(snapshot, displayBalance),
      },
      {
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    )
  } catch (error) {
    console.error('Failed to fetch credit balance:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    )
  }
}
