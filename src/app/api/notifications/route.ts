import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET - Fetch my notifications
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })


    // Calculate 24 hours ago
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .or(`is_read.eq.false,created_at.gt.${oneDayAgo}`)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    return NextResponse.json({ notifications })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

import { createAdminClient } from '@/lib/supabase/bypass'

// ... (GET stays same)

// PATCH - Mark as read
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { id, all } = body

    // Use Admin Client to bypass potential RLS restrictions on UPDATE
    const supabaseAdmin = createAdminClient()

    if (all) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
      
      if (error) throw error
    } else if (id) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', user.id)
        
      if (error) throw error
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Notification update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
