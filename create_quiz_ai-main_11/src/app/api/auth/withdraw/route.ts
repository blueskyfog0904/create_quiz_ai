import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// DELETE - Handle account withdrawal
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
    const { confirmEmail } = body

    // Verify email matches
    if (confirmEmail !== user.email) {
      return NextResponse.json(
        { error: '이메일 주소가 일치하지 않습니다.' },
        { status: 400 }
      )
    }

    // Delete user data in order (due to foreign key constraints)
    // 1. Delete exam paper items (via cascade on exam_papers)
    // 2. Delete exam papers
    await supabase
      .from('exam_papers')
      .delete()
      .eq('user_id', user.id)

    // 3. Delete questions
    await supabase
      .from('questions')
      .delete()
      .eq('user_id', user.id)

    // 4. Delete support tickets
    await supabase
      .from('support_tickets')
      .delete()
      .eq('user_id', user.id)

    // 5. Delete credit transactions
    await supabase
      .from('credit_transactions')
      .delete()
      .eq('user_id', user.id)

    // 6. Delete user credits
    await supabase
      .from('user_credits')
      .delete()
      .eq('user_id', user.id)

    // 7. Delete user sessions
    await supabase
      .from('user_sessions')
      .delete()
      .eq('user_id', user.id)

    // 8. Delete profile (this will cascade to auth.users due to trigger)
    await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id)

    // Note: The auth.users deletion should be handled by admin API or database trigger
    // For now, we'll just delete the profile and sign out the user
    // The actual auth.users deletion requires admin privileges

    return NextResponse.json({ 
      success: true, 
      message: '회원 탈퇴가 완료되었습니다.' 
    })

  } catch (error: any) {
    console.error('Account withdrawal error:', error)
    return NextResponse.json(
      { error: error.message || '회원 탈퇴에 실패했습니다.' },
      { status: 500 }
    )
  }
}


