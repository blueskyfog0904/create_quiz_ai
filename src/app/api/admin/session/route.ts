import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 현재 세션이 관리자(profiles.is_admin)인지 확인한다. 자기 세션 정보만 반환.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ isAdmin: false }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return NextResponse.json({ isAdmin: Boolean(profile?.is_admin) })
}
