import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const guard = await requireAdminApiPermission('support.manage')
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    // Get Pending Ticket Count
    const { count, error } = await supabase
      .from('support_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('is_deleted_by_user', false)

    if (error) throw error

    return NextResponse.json({ pendingCount: count || 0 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
