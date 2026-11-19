import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const CreateTicketSchema = z.object({
  categoryId: z.string().uuid({ message: '문의 카테고리를 선택해주세요.' }),
  subject: z.string().trim().min(1, '제목을 입력해주세요.'),
  message: z.string().trim().min(1, '내용을 입력해주세요.'),
})

const UpdateTicketSchema = z.object({
  ticketId: z.string().uuid(),
  categoryId: z.string().uuid({ message: '문의 카테고리를 선택해주세요.' }),
  subject: z.string().trim().min(1, '제목을 입력해주세요.'),
  message: z.string().trim().min(1, '내용을 입력해주세요.'),
})

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

    const body = await request.json().catch(() => null)
    const parsed = CreateTicketSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '문의 내용을 확인해주세요.' },
        { status: 400 }
      )
    }

    const { data: ticket, error } = await supabase.rpc('create_support_ticket', {
      p_category_id: parsed.data.categoryId,
      p_subject: parsed.data.subject,
      p_message: parsed.data.message,
    })

    if (error) {
      throw error
    }

    // 관리자 알림(화면·슬랙)은 문의 행이 생길 때 DB가 남기는 관리자 이벤트(support_ticket_created)로 간다.
    return NextResponse.json({ success: true, ticket })

  } catch (error) {
    console.error('Support ticket creation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '문의 등록에 실패했습니다.' },
      { status: 500 }
    )
  }
}

// PUT - User update ticket
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const parsed = UpdateTicketSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Missing fields' }, { status: 400 })
    }

    const { error } = await supabase.rpc('update_own_pending_support_ticket', {
      p_ticket_id: parsed.data.ticketId,
      p_category_id: parsed.data.categoryId,
      p_subject: parsed.data.subject,
      p_message: parsed.data.message,
    })

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Support ticket update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '수정 실패' },
      { status: 500 }
    )
  }
}

// DELETE - User soft delete ticket
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing ticket ID' }, { status: 400 })
    }

    const { error } = await supabase.rpc('soft_delete_own_support_ticket', {
      p_ticket_id: id,
    })

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Support ticket delete error:', JSON.stringify(error, null, 2))
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '삭제 실패', details: JSON.stringify(error) },
      { status: 500 }
    )
  }
}
