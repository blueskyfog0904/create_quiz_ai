import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { hasPaymentRecordsBlockingWithdrawal } from '@/lib/withdraw-eligibility'
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

    const body = await request.json().catch(() => null)
    const confirmEmail = body?.confirmEmail

    // Verify email matches
    if (confirmEmail !== user.email) {
      return NextResponse.json(
        { error: '이메일 주소가 일치하지 않습니다.' },
        { status: 400 }
      )
    }

    // 관리자 계정은 여기서 지우지 않는다(대표 관리자가 0명이 되는 길을 막는다). 관리자 ID 관리에서 처리한다.
    const { data: profile, error: profileLookupError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()
    if (profileLookupError) {
      throw new Error(`profiles 조회 실패: ${profileLookupError.message}`)
    }
    if (profile?.is_admin) {
      return NextResponse.json(
        { error: '관리자 계정은 탈퇴할 수 없습니다.' },
        { status: 403 }
      )
    }

    // RLS를 우회해 확실히 지워야 하므로 service role로 삭제한다.
    // (유저 세션 클라이언트는 delete가 RLS에 막혀도 에러 없이 0건 삭제로 끝난다)
    const admin = createAdminClient()

    // 결제 이력(payment_orders/checkout_attempts)은 재무 감사를 위해 profiles를
    // ON DELETE RESTRICT로 참조하므로, 이 경우 계정 삭제가 불가능하다.
    if (await hasPaymentRecordsBlockingWithdrawal(admin, user.id)) {
      return NextResponse.json(
        { error: '결제 이력이 있는 계정은 관련 법령에 따른 기록 보존을 위해 즉시 삭제할 수 없습니다. 고객지원(1:1 문의)으로 탈퇴를 요청해주세요.' },
        { status: 409 }
      )
    }

    const deletions: Array<{ table: 'exam_papers' | 'questions' | 'support_tickets' | 'credit_transactions'; column: string }> = [
      { table: 'exam_papers', column: 'user_id' },
      { table: 'questions', column: 'user_id' },
      { table: 'support_tickets', column: 'user_id' },
      { table: 'credit_transactions', column: 'user_id' },
    ]

    for (const { table, column } of deletions) {
      const { error } = await admin.from(table).delete().eq(column, user.id)
      if (error) {
        throw new Error(`${table} 삭제 실패: ${error.message}`)
      }
    }

    const { error: profileError } = await admin
      .from('profiles')
      .delete()
      .eq('id', user.id)
    if (profileError) {
      throw new Error(`profiles 삭제 실패: ${profileError.message}`)
    }

    // auth 계정까지 삭제해야 재로그인·재가입 충돌이 없다.
    const { error: authError } = await admin.auth.admin.deleteUser(user.id)
    if (authError) {
      throw new Error(`계정 삭제 실패: ${authError.message}`)
    }

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
