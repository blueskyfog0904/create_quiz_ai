import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendSlackNotification } from '@/lib/slack'

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

    // Fetch profile for Slack notification
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email, phone')
      .eq('id', user.id)
      .single()

    // Send Slack Notification
    const userName = profile?.name || user.email || 'Unknown User'
    const userContact = profile?.phone || profile?.email || 'No contact info'
    
    // Format Date: yyyy-mm-dd-hh-mm
    const now = new Date()
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`

    await sendSlackNotification(
      `🔔 *새로운 1:1 문의가 등록되었습니다*`,
      {
        '보낸 시간': formattedDate,
        '사용자': `${userName} (${userContact})`,
        '제목': subject,
        '내용': message
      }
    )

    return NextResponse.json({ success: true, ticket })

  } catch (error: any) {
    console.error('Support ticket creation error:', error)
    return NextResponse.json(
      { error: error.message || '문의 등록에 실패했습니다.' },
      { status: 500 }
    )
  }
}

// PATCH - Admin reply
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
        responded_at: new Date().toISOString()
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

  } catch (error: any) {
    console.error('Support ticket update error:', error)
    return NextResponse.json(
      { error: error.message || '답변 등록 실패' },
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

    const body = await request.json()
    const { ticketId, subject, message } = body

    if (!ticketId || !subject?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // 1. Check if ticket exists and belongs to user
    const { data: ticket, error: fetchError } = await supabase
      .from('support_tickets')
      .select('status')
      .eq('id', ticketId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // 2. Check if ticket is pending
    if (ticket.status !== 'pending') {
      return NextResponse.json({ error: '답변이 완료된 문의는 수정할 수 없습니다.' }, { status: 400 })
    }

    // 3. Update ticket
    const { error } = await supabase
      .from('support_tickets')
      .update({
        subject: subject.trim(),
        message: message.trim(),
        // Optional: Update created_at or add updated_at if schema supports it
      })
      .eq('id', ticketId)
      .eq('user_id', user.id)

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Support ticket update error:', error)
    return NextResponse.json(
      { error: error.message || '수정 실패' },
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

    // Soft delete: Update is_deleted_by_user = true
    const { error } = await supabase
      .from('support_tickets')
      .update({ is_deleted_by_user: true })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      throw error // This will be caught by catch block
    }

    return NextResponse.json({ success: true })


  } catch (error: any) {
    console.error('Support ticket delete error:', JSON.stringify(error, null, 2))
    return NextResponse.json(
      { error: error.message || '삭제 실패', details: JSON.stringify(error) }, // Add details for debugging
      { status: 500 }
    )
  }
}
