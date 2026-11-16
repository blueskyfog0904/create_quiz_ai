import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { markAdminAlertsSeen } from '@/lib/admin-alerts-server'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 본문은 { eventId: <uuid> } 하나만 받는다(화면에 보인 가장 최근 이벤트). 확인 시각은 서버가 그 이벤트에서 읽는다.
async function readEventId(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const keys = Object.keys(body)
    const eventId = (body as { eventId?: unknown }).eventId
    if (keys.length !== 1 || typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) return null
    return eventId
  } catch {
    return null
  }
}

export async function POST(request: Request) {
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

    const eventId = await readEventId(request)
    if (!eventId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const result = await markAdminAlertsSeen(user.id, eventId)
    if (result === 'not_found') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    if (result === 'failed') {
      return NextResponse.json({ error: 'Failed to mark alerts seen' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error marking admin alerts seen:', error)
    return NextResponse.json({ error: 'Failed to mark alerts seen' }, { status: 500 })
  }
}
