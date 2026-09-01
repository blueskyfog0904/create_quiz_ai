import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendSlackNotification } from '@/lib/slack'

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

function getCategoryName(snapshot: unknown) {
  if (snapshot && typeof snapshot === 'object' && 'name' in snapshot) {
    const name = (snapshot as { name?: unknown }).name
    return typeof name === 'string' && name.trim() ? name : '미분류'
  }

  return '미분류'
}

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

    // Fetch profile for Slack notification
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email, phone')
      .eq('id', user.id)
      .single()

    // Send Slack Notification
    const userName = profile?.name || user.email || 'Unknown User'
    const userContact = profile?.phone || profile?.email || 'No contact info'
    const categoryName = getCategoryName(ticket?.category_snapshot)
    
    // Format Date: yyyy-mm-dd-hh-mm
    const now = new Date()
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`

    await sendSlackNotification(
      `🔔 *새로운 1:1 문의가 등록되었습니다*`,
      {
        '보낸 시간': formattedDate,
        '사용자': `${userName} (${userContact})`,
        '카테고리': categoryName,
        '제목': parsed.data.subject,
        '내용': parsed.data.message,
      }
    )

    return NextResponse.json({ success: true, ticket })

  } catch (error) {
    console.error('Support ticket creation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '문의 등록에 실패했습니다.' },
      { status: 500 }
    )
  }
}

// PATCH - Admin reply compatibility endpoint. New admin UI uses /api/admin/support/tickets/[id].
export async function PATCH(request: NextRequest) {
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

    const body = await request.json()
    const { ticketId, adminResponse, status } = body

    if (!ticketId || !adminResponse) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Update Ticket
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .update({
        admin_response: adminResponse,
        status: status || 'resolved',
        responded_at: new Date().toISOString(),
      })
      .eq('id', ticketId)
      .select()
      .single()

    if (error) throw error

    // Create Notification for User
    if (ticket) {
      await supabase.from('notifications').insert({
        user_id: ticket.user_id,
        type: 'inquiry_reply',
        title: '문의하신 내용에 답변이 등록되었습니다.',
        message: `제목: ${ticket.subject}\n\n답변을 확인해보세요.`,
        link: '/mypage/support'
      })
    }

    return NextResponse.json({ success: true, ticket })

  } catch (error) {
    console.error('Support ticket update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '답변 등록 실패' },
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
