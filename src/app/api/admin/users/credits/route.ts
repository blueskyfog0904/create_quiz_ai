import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CreditService } from '@/lib/credits'
import { resolveAdminGrantSourceCategory } from '@/lib/credit-source-display'

const GrantCreditSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive('Amount must be positive').max(10000, '한 번에 최대 10,000 크레딧까지만 지급할 수 있습니다.'),
  description: z.string().min(1, 'Description is required'),
  category: z.enum(['compensation', 'event', 'refund', 'other']).default('other')
})

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Auth Check (Admin Only)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role via profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden: Admin only' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { userId, amount, description, category } = GrantCreditSchema.parse(body)

    // 2. Grant Credits
    const categoryLabel = {
      compensation: '보상',
      event: '이벤트',
      refund: '환불',
      other: '기타'
    }[category] || '기타'

    const sourceCategory = resolveAdminGrantSourceCategory(category)

    // 2. Grant Credits via purchaseCredits (관리자 지급)
    const result = await CreditService.purchaseCredits(
      userId,
      null,  // plan_id 없음 (관리자 지급)
      amount,
      0,  // 관리자 지급은 결제 금액 0
      'admin_grant',
      undefined,
      sourceCategory
    )

    // 3. Send Notification
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'info',
      title: '크레딧이 지급되었습니다',
      message: `${categoryLabel} 사유로 ${amount.toLocaleString()} 크레딧이 지급되었습니다. (내용: ${description})`,
      is_read: false
    })

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
    })

  } catch (error: unknown) {
    console.error('Grant Credits Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to grant credits'
    }, { status: 500 })
  }
}
