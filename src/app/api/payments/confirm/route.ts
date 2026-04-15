/**
 * 결제 승인 API
 * 
 * POST /api/payments/confirm
 * - 토스페이먼츠 결제 승인 API 호출
 * - 성공 시 크레딧 지급
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CreditService } from '@/lib/credits'

export const dynamic = 'force-dynamic'

interface ConfirmRequest {
    paymentKey: string
    orderId: string
    amount: number
    planId: string
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        // 로그인 확인
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json(
                { error: '로그인이 필요합니다.' },
                { status: 401 }
            )
        }

        const body: ConfirmRequest = await request.json()
        const { paymentKey, orderId, amount, planId } = body

        // 필수 파라미터 검증
        if (!paymentKey || !orderId || !amount || !planId) {
            return NextResponse.json(
                { error: '필수 파라미터가 누락되었습니다.' },
                { status: 400 }
            )
        }

        // 요금제 정보 조회 및 금액 검증
        const { data: plan, error: planError } = await supabase
            .from('pricing_plans')
            .select('*')
            .eq('id', planId)
            .eq('is_active', true)
            .single()

        if (planError || !plan) {
            return NextResponse.json(
                { error: '유효하지 않은 요금제입니다.' },
                { status: 400 }
            )
        }

        // 금액 검증 (위변조 방지)
        if (plan.price !== amount) {
            return NextResponse.json(
                { error: '결제 금액이 일치하지 않습니다.' },
                { status: 400 }
            )
        }

        // 토스페이먼츠 시크릿 키
        const secretKey = process.env.TOSS_SECRET_KEY
        if (!secretKey) {
            console.error('TOSS_SECRET_KEY 환경 변수가 설정되지 않았습니다.')
            return NextResponse.json(
                { error: '결제 설정 오류가 발생했습니다.' },
                { status: 500 }
            )
        }

        // Base64 인코딩된 Authorization 헤더
        const authHeader = Buffer.from(`${secretKey}:`).toString('base64')

        // 토스페이먼츠 결제 승인 API 호출
        const confirmResponse = await fetch(
            'https://api.tosspayments.com/v1/payments/confirm',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${authHeader}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    paymentKey,
                    orderId,
                    amount,
                }),
            }
        )

        const confirmData = await confirmResponse.json()

        // 결제 승인 실패
        if (!confirmResponse.ok) {
            console.error('토스페이먼츠 결제 승인 실패:', confirmData)
            return NextResponse.json(
                {
                    error: confirmData.message || '결제 승인에 실패했습니다.',
                    code: confirmData.code
                },
                { status: 400 }
            )
        }

        // 결제 성공 - 크레딧 지급
        try {
            // purchaseCredits(userId, planId, credits, price, paymentMethod, paymentKey)
            const result = await CreditService.purchaseCredits(
                user.id,
                planId,
                plan.credits,
                plan.price,
                confirmData.method || 'card',
                paymentKey,
                'plan_purchase'
            )

            // 결제 정보에 orderId 추가 (payment_history는 purchaseCredits에서 이미 생성됨)
            await supabase
                .from('payment_history')
                .update({ order_id: orderId })
                .eq('source_id', result.sourceId)

            return NextResponse.json({
                success: true,
                message: '결제가 완료되었습니다.',
                credits: plan.credits,
                newBalance: result.newBalance,
                payment: {
                    orderId: confirmData.orderId,
                    orderName: confirmData.orderName,
                    method: confirmData.method,
                    totalAmount: confirmData.totalAmount,
                    approvedAt: confirmData.approvedAt,
                }
            })
        } catch (creditError) {
            // 크레딧 지급 실패 (결제는 성공했지만 크레딧 지급 실패)
            console.error('크레딧 지급 오류:', creditError)

            // TODO: 결제 취소 API 호출 또는 관리자 알림

            return NextResponse.json(
                {
                    error: '크레딧 지급 중 오류가 발생했습니다. 고객센터로 문의해주세요.',
                    paymentKey: paymentKey // 관리자 확인용
                },
                { status: 500 }
            )
        }

    } catch (error) {
        console.error('결제 승인 API 오류:', error)
        return NextResponse.json(
            { error: '결제 처리 중 오류가 발생했습니다.' },
            { status: 500 }
        )
    }
}
