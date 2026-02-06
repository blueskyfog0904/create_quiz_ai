'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreditCard, Calendar, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'

export interface PaymentItem {
    id: string
    created_at: string
    amount: number
    status: 'completed' | 'refunded' | 'failed' | string
    payment_method: string
    pricing_plans: {
        name: string
    } | null
}

interface PaymentListProps {
    payments: PaymentItem[]
}

export function PaymentList({ payments }: PaymentListProps) {
    if (payments.length === 0) {
        return (
            <div className="border-2 border-dashed rounded-lg p-12 text-center bg-gray-50/50">
                <CreditCard className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">결제 내역이 없습니다</h3>
                <p className="text-gray-500">
                    아직 크레딧을 구매하신 내역이 없습니다.
                </p>
            </div>
        )
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">결제 완료</Badge>
            case 'refunded':
                return <Badge variant="secondary" className="bg-gray-100 text-gray-700 hover:bg-gray-100 border-none">환불 완료</Badge>
            case 'failed':
                return <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100 border-none">결제 실패</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed':
                return <CheckCircle2 className="h-5 w-5 text-green-500" />
            case 'refunded':
                return <AlertCircle className="h-5 w-5 text-gray-400" />
            case 'failed':
                return <XCircle className="h-5 w-5 text-red-500" />
            default:
                return <CreditCard className="h-5 w-5 text-gray-400" />
        }
    }

    return (
        <div className="space-y-4">
            {payments.map((payment) => (
                <Card key={payment.id} className="overflow-hidden hover:shadow-md transition-shadow">
                    <CardContent className="p-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 gap-4">
                            {/* Left: Info */}
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-gray-100 rounded-full mt-1 sm:mt-0">
                                    {getStatusIcon(payment.status)}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-semibold text-gray-900">
                                            {payment.pricing_plans?.name || '크레딧 충전'}
                                        </h3>
                                        {getStatusBadge(payment.status)}
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="h-3.5 w-3.5" />
                                            {format(new Date(payment.created_at), 'yyyy년 MM월 dd일 HH:mm', { locale: ko })}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <CreditCard className="h-3.5 w-3.5" />
                                            {payment.payment_method === 'toss' ? '토스페이먼츠' : payment.payment_method}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Amount */}
                            <div className="text-right pl-14 sm:pl-0">
                                <span className={`text-lg font-bold ${payment.status === 'refunded' ? 'text-gray-400 line-through' :
                                        payment.status === 'failed' ? 'text-red-500' : 'text-gray-900'
                                    }`}>
                                    ₩{payment.amount.toLocaleString()}
                                </span>
                                {payment.status === 'refunded' && (
                                    <p className="text-xs text-red-500 font-medium">환불됨</p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
