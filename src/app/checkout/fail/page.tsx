'use client'

/**
 * 결제 실패 페이지
 * 
 * 토스페이먼츠에서 failUrl로 리다이렉트되면 이 페이지가 호출됩니다.
 */

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { XCircle, ArrowLeft, MessageCircle, Loader2 } from 'lucide-react'

function CheckoutFailContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const errorCode = searchParams.get('code') || 'UNKNOWN_ERROR'
    const errorMessage = searchParams.get('message') || '결제 처리 중 오류가 발생했습니다.'

    // 에러 메시지 한글화
    const getErrorDescription = (code: string) => {
        const errorDescriptions: Record<string, string> = {
            'PAY_PROCESS_CANCELED': '결제가 취소되었습니다.',
            'PAY_PROCESS_ABORTED': '결제가 중단되었습니다.',
            'REJECT_CARD_COMPANY': '카드사에서 결제를 거부했습니다.',
            'INVALID_CARD_EXPIRATION': '카드 유효기간이 올바르지 않습니다.',
            'INVALID_CARD_NUMBER': '카드 번호가 올바르지 않습니다.',
            'INVALID_CARD_LOST_OR_STOLEN': '분실 또는 도난된 카드입니다.',
            'NOT_ALLOWED_POINT_USE': '포인트 사용이 불가한 카드입니다.',
            'EXCEED_MAX_DAILY_PAYMENT_COUNT': '일일 결제 한도를 초과했습니다.',
            'EXCEED_MAX_PAYMENT_AMOUNT': '결제 금액 한도를 초과했습니다.',
            'INVALID_STOPPED_CARD': '정지된 카드입니다.',
            'NOT_SUPPORTED_INSTALLMENT_PLAN_CARD': '할부가 지원되지 않는 카드입니다.',
            'BELOW_MINIMUM_AMOUNT': '최소 결제 금액 미만입니다.',
            'INVALID_REQUEST': '잘못된 요청입니다.',
            'NOT_FOUND_TERMINAL_ID': '단말기 정보를 찾을 수 없습니다.',
            'COMMON_ERROR': '일시적인 오류가 발생했습니다.',
            'USER_CANCEL': '사용자가 결제를 취소했습니다.',
        }
        return errorDescriptions[code] || errorMessage
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <XCircle className="w-16 h-16 mx-auto text-red-500" />
                    <CardTitle className="mt-4 text-red-600">결제 실패</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                    <div className="bg-red-50 rounded-lg p-4 space-y-2">
                        <p className="text-center text-gray-700">
                            {getErrorDescription(errorCode)}
                        </p>
                        <p className="text-center text-xs text-gray-400">
                            오류 코드: {errorCode}
                        </p>
                    </div>

                    <div className="space-y-3">
                        <Button
                            className="w-full"
                            onClick={() => router.push('/pricing')}
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            요금제로 돌아가기
                        </Button>

                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => router.push('/mypage/support')}
                        >
                            <MessageCircle className="w-4 h-4 mr-2" />
                            고객센터 문의
                        </Button>
                    </div>

                    <p className="text-center text-xs text-gray-400">
                        문제가 계속되면 고객센터로 문의해주세요.
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}

function CheckoutFailLoading() {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardContent className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </CardContent>
            </Card>
        </div>
    )
}

export default function CheckoutFailPage() {
    return (
        <Suspense fallback={<CheckoutFailLoading />}>
            <CheckoutFailContent />
        </Suspense>
    )
}
