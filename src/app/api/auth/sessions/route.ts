import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// DELETE - Logout specific session or all other sessions
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { sessionId, logoutAll } = body

    if (logoutAll) {
      // Logout all other sessions (keep current)
      const { error } = await supabase
        .from('user_sessions')
        .delete()
        .eq('user_id', user.id)
        .eq('is_current', false)

      if (error) {
        throw error
      }

      return NextResponse.json({ success: true, message: '다른 모든 기기에서 로그아웃되었습니다.' })
    } else if (sessionId) {
      // Logout specific session
      const { error } = await supabase
        .from('user_sessions')
        .delete()
        .eq('id', sessionId)
        .eq('user_id', user.id)

      if (error) {
        throw error
      }

      return NextResponse.json({ success: true, message: '세션이 로그아웃되었습니다.' })
    }

    return NextResponse.json(
      { error: '잘못된 요청입니다.' },
      { status: 400 }
    )

  } catch (error: any) {
    console.error('Session deletion error:', error)
    return NextResponse.json(
      { error: error.message || '세션 삭제에 실패했습니다.' },
      { status: 500 }
    )
  }
}

// POST - Create or update session (called on login)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { device_info, ip_address, user_agent, browser, os, device_type } = body

    // Mark all existing sessions as not current
    await supabase
      .from('user_sessions')
      .update({ is_current: false })
      .eq('user_id', user.id)

    // Create new session record
    const { data: session, error } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        device_info,
        ip_address,
        user_agent,
        browser,
        os,
        device_type,
        is_current: true,
        last_active: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true, session })

  } catch (error: any) {
    console.error('Session creation error:', error)
    return NextResponse.json(
      { error: error.message || '세션 생성에 실패했습니다.' },
      { status: 500 }
    )
  }
}

// PATCH - Update session (e.g., update last_active)
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { sessionId } = body

    const { error } = await supabase
      .from('user_sessions')
      .update({ last_active: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', user.id)

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Session update error:', error)
    return NextResponse.json(
      { error: error.message || '세션 업데이트에 실패했습니다.' },
      { status: 500 }
    )
  }
}


