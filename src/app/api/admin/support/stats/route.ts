import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check Admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get Pending Ticket Count
    const { count, error } = await supabase
      .from('support_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    if (error) throw error

    return NextResponse.json({ pendingCount: count || 0 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
