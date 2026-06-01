import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listProviderConnectionsForAdmin } from '@/lib/ai/provider-connections'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user }
}

export async function GET() {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  try {
    const connections = await listProviderConnectionsForAdmin()
    return NextResponse.json({ data: connections })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch AI provider connections',
    }, { status: 500 })
  }
}
