import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAlertSummary } from '@/lib/admin-alerts-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()

    // Check admin authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(await getAdminAlertSummary(user.id))
  } catch (error) {
    console.error('Error fetching admin alert summary:', error)
    return NextResponse.json({ error: 'Failed to fetch alert summary' }, { status: 500 })
  }
}
