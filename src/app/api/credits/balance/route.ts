import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { CreditService } from '@/lib/credits'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const balance = await CreditService.getBalance(user.id)

    return NextResponse.json({ balance })
  } catch (error) {
    console.error('Failed to fetch credit balance:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
