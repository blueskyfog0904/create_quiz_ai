import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST - Create new support ticket
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
    const { subject, message } = body

    if (!subject?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: '제목과 내용을 모두 입력해주세요.' },
        { status: 400 }
      )
    }

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id: user.id,
        subject: subject.trim(),
        message: message.trim(),
        status: 'pending'
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true, ticket })

  } catch (error: any) {
    console.error('Support ticket creation error:', error)
    return NextResponse.json(
      { error: error.message || '문의 등록에 실패했습니다.' },
      { status: 500 }
    )
  }
}


