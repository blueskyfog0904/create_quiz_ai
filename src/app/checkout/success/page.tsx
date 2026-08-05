'use client'

/**
 * 결제 성공 페이지
 * 
 * 토스페이먼츠에서 successUrl로 리다이렉트되면 이 페이지가 호출됩니다.
 * 결제 승인 API를 호출하여 최종 결제를 완료합니다.
 */

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle, Coins } from 'lucide-react'

function CheckoutSuccessContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [message, setMessage] = useState('')
    const [paymentInfo, setPaymentInfo] = useState<{
        credits?: number
        newBalance?: number
        orderName?: string
        method?: string
    } | null>(null)

    useEffect(() => {
        const confirmPayment = async () => {
            try {
                // URL에서 파라미터 추출
                const paymentKey = searchParams.get('paymentKey')
                const orderId = searchParams.get('orderId')
                const amount = searchParams.get('amount')

                if (!paymentKey || !orderId || !amount) {
                    setStatus('error')
                    setMessage('결제 정보가 올바르지 않습니다.')
                    return
                }

                // 결제 승인 API 호출
                const response = await fetch('/api/payments/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        paymentKey,
                        orderId,
                        amount: parseInt(amount),
                    }),
                })

                const data = await response.json()

                if (response.ok && data.success) {
                    setStatus('success')
                    setMessage('결제가 완료되었습니다!')
                    setPaymentInfo({
                        credits: data.credits,
                        newBalance: data.newBalance,
                        orderName: data.payment?.orderName,
                        method: data.payment?.method,
                    })
                } else {
                    setStatus('error')
                    setMessage(data.error || '결제 승인에 실패했습니다.')
                }
            } catch (error) {
                console.error('결제 승인 오류:', error)
                setStatus('error')
                setMessage('결제 처리 중 오류가 발생했습니다.')
            }
        }

        confirmPayment()
    }, [searchParams])

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    {status === 'loading' && (
                        <>
                            <Loader2 className="w-16 h-16 mx-auto text-blue-500 animate-spin" />
                            <CardTitle className="mt-4">결제 처리 중...</CardTitle>
                        </>
                    )}

                    {status === 'success' && (
                        <>
                            <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
                            <CardTitle className="mt-4 text-green-600">{message}</CardTitle>
                        </>
                    )}

                    {status === 'error' && (
                        <>
                            <XCircle className="w-16 h-16 mx-auto text-red-500" />
                            <CardTitle className="mt-4 text-red-600">결제 실패</CardTitle>
                        </>
                    )}
                </CardHeader>

                <CardContent className="space-y-4">
                    {status === 'loading' && (
                        <p className="text-center text-gray-500">
                            잠시만 기다려주세요. 결제를 확인하고 있습니다.
                        </p>
                    )}

                    {status === 'success' && paymentInfo && (
                        <div className="space-y-4">
                            <div className="bg-green-50 rounded-lg p-4 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">상품명</span>
                                    <span className="font-medium">{paymentInfo.orderName}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">결제수단</span>
                                    <span className="font-medium">{paymentInfo.method}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">충전 크레딧</span>
                                    <span className="font-medium text-green-600">
                                        +{paymentInfo.credits?.toLocaleString()}C
                                    </span>
                                </div>
                            </div>

                            <div className="bg-blue-50 rounded-lg p-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Coins className="w-5 h-5 text-blue-600" />
                                    <span className="text-gray-700">현재 보유 크레딧</span>
                                </div>
                                <span className="text-xl font-bold text-blue-600">
                                    {paymentInfo.newBalance?.toLocaleString()}C
                                </span>
                            </div>

                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => router.push('/mypage/credits')}
                                >
                                    크레딧 내역
                                </Button>
                                <Button
                                    className="flex-1"
                                    onClick={() => router.push('/generate')}
                                >
                                    문제 생성하기
                                </Button>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="space-y-4">
                            <p className="text-center text-gray-600">{message}</p>
                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => router.push('/pricing')}
                                >
                                    다시 시도
                                </Button>
                                <Button
                                    className="flex-1"
                                    onClick={() => router.push('/mypage/support')}
                                >
                                    고객센터
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function CheckoutSuccessLoading() {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardContent className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
                    <p className="mt-4 text-gray-500">결제 처리 중...</p>
                </CardContent>
            </Card>
        </div>
    )
}

export default function CheckoutSuccessPage() {
    return (
        <Suspense fallback={<CheckoutSuccessLoading />}>
            <CheckoutSuccessContent />
        </Suspense>
    )
}
