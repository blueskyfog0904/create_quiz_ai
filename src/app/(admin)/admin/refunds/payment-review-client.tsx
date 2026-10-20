'use client'

/**
 * 관리자 결제 확인: 수동 확인 주문과 미해소 결제 경보
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { ReviewAction } from '@/lib/payment-review-actions'

export interface PaymentReviewOrder {
    id: string
    order_id: string
    provider: string
    plan_name_snapshot: string
    expected_amount: number
    failure_code: string | null
    failure_message: string | null
    created_at: string
    allowedActions: ReviewAction[]
}

export interface PaymentAlert {
    id: string
    code: string
    severity: string
    message: string
    details: Record<string, unknown> | null
    created_at: string
}

type ExternalMethod = 'payapp_cancel_request' | 'bank_transfer' | 'provider_admin_cancel'

const reviewActionLabels: Record<ReviewAction, string> = {
    paid_confirmed: '결제 확인됨 (크레딧 지급)',
    unpaid_confirmed: '미결제 확인 (만료 처리)',
    cancel_handled: '취소 처리 확인',
}

const externalMethodLabels: Record<ExternalMethod, string> = {
    payapp_cancel_request: '페이앱 취소 요청(정산금 반환)',
    bank_transfer: '고객 계좌 송금',
    provider_admin_cancel: '결제사 관리자에서 취소',
}

const providerLabel = (provider: string) =>
    provider === 'payapp' ? '페이앱' : provider === 'kakaopay' ? '카카오페이' : '일반결제'

export function PaymentReviewClient({
    orders,
    alerts,
}: {
    orders: PaymentReviewOrder[]
    alerts: PaymentAlert[]
}) {
    const router = useRouter()
    const [selectedOrder, setSelectedOrder] = useState<PaymentReviewOrder | null>(null)
    const [action, setAction] = useState<ReviewAction>('unpaid_confirmed')
    const [note, setNote] = useState('')
    const [mulNo, setMulNo] = useState('')
    const [paidAt, setPaidAt] = useState('')
    const [externalMethod, setExternalMethod] = useState<ExternalMethod>('payapp_cancel_request')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const openDialog = (order: PaymentReviewOrder) => {
        setSelectedOrder(order)
        setAction(order.allowedActions[0] ?? 'unpaid_confirmed')
        setNote('')
        setMulNo('')
        setPaidAt('')
        setExternalMethod(order.provider === 'payapp' ? 'payapp_cancel_request' : 'provider_admin_cancel')
    }

    const handleSubmit = async () => {
        if (!selectedOrder) return

        setIsSubmitting(true)
        try {
            const response = await fetch('/api/admin/payments/review', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paymentOrderId: selectedOrder.id,
                    action,
                    note,
                    ...(action === 'paid_confirmed' && mulNo.trim() ? { mulNo: mulNo.trim() } : {}),
                    ...(action === 'paid_confirmed' && paidAt ? { paidAt: new Date(paidAt).toISOString() } : {}),
                    ...(action === 'cancel_handled' ? { externalMethod } : {}),
                }),
            })
            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || '처리 중 오류가 발생했습니다.')
            }

            toast.success(data.message)
            setSelectedOrder(null)
            router.refresh()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertTriangle className="h-5 w-5 text-orange-600" aria-hidden="true" />
                    결제 확인 필요
                </CardTitle>
                <p className="text-sm text-gray-500">
                    수동 확인 주문과 미해소 결제 경보입니다. 취소·부분취소로 격리된 건은 위 환불 요청에서 수동 완료하세요.
                </p>
            </CardHeader>
            <CardContent className="space-y-6">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>주문일</TableHead>
                            <TableHead>주문번호</TableHead>
                            <TableHead>결제사</TableHead>
                            <TableHead>상품·금액</TableHead>
                            <TableHead>사유</TableHead>
                            <TableHead className="text-right">처리</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="py-6 text-center text-gray-500">
                                    수동 확인이 필요한 주문이 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : orders.map((order) => (
                            <TableRow key={order.id}>
                                <TableCell className="text-sm text-gray-500">
                                    {new Date(order.created_at).toLocaleString('ko-KR')}
                                </TableCell>
                                <TableCell className="max-w-[180px] truncate text-xs" title={order.order_id}>
                                    {order.order_id}
                                </TableCell>
                                <TableCell>{providerLabel(order.provider)}</TableCell>
                                <TableCell className="text-sm">
                                    {order.plan_name_snapshot} · ₩{order.expected_amount.toLocaleString()}
                                </TableCell>
                                <TableCell className="max-w-[260px] text-xs">
                                    <p className="font-medium text-red-600">{order.failure_code ?? '-'}</p>
                                    <p className="text-gray-500">{order.failure_message}</p>
                                </TableCell>
                                <TableCell className="text-right">
                                    {order.allowedActions.length > 0 ? (
                                        <Button size="sm" variant="outline" onClick={() => openDialog(order)}>
                                            확인 처리
                                        </Button>
                                    ) : (
                                        <span className="text-xs text-gray-500">위 환불 요청에서 처리</span>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">미해소 결제 경보</h3>
                    {alerts.length === 0 ? (
                        <p className="text-sm text-gray-500">미해소 경보가 없습니다.</p>
                    ) : (
                        <ul className="space-y-2">
                            {alerts.map((alert) => (
                                <li key={alert.id} className="rounded-md border p-3 text-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}>
                                            {alert.severity === 'critical' ? '긴급' : '주의'}
                                        </Badge>
                                        <span className="font-mono text-xs">{alert.code}</span>
                                        <span className="text-xs text-gray-500">
                                            {new Date(alert.created_at).toLocaleString('ko-KR')}
                                        </span>
                                    </div>
                                    <p className="mt-1">{alert.message}</p>
                                    {typeof alert.details?.order_id === 'string' && (
                                        <p className="mt-1 text-xs text-gray-500">주문 {alert.details.order_id}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </CardContent>

            <Dialog open={selectedOrder !== null} onOpenChange={(open) => !open && setSelectedOrder(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>결제 확인 처리</DialogTitle>
                        <DialogDescription>
                            {selectedOrder && `${providerLabel(selectedOrder.provider)} 주문 ${selectedOrder.order_id}`}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="review-action" className="mb-2 block text-sm font-medium text-gray-700">처리</label>
                            <Select value={action} onValueChange={(value) => setAction(value as ReviewAction)}>
                                <SelectTrigger id="review-action">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(selectedOrder?.allowedActions ?? []).map((item) => (
                                        <SelectItem key={item} value={item}>{reviewActionLabels[item]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {action === 'paid_confirmed' && (
                            <>
                                <div>
                                    <label htmlFor="review-mul-no" className="mb-2 block text-sm font-medium text-gray-700">
                                        페이앱 결제요청번호 (결제완료 통보가 없을 때 필수)
                                    </label>
                                    <Input
                                        id="review-mul-no"
                                        inputMode="numeric"
                                        value={mulNo}
                                        onChange={(e) => setMulNo(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="review-paid-at" className="mb-2 block text-sm font-medium text-gray-700">
                                        결제 시각 (비우면 지금)
                                    </label>
                                    <Input
                                        id="review-paid-at"
                                        type="datetime-local"
                                        value={paidAt}
                                        onChange={(e) => setPaidAt(e.target.value)}
                                    />
                                </div>
                            </>
                        )}

                        {action === 'cancel_handled' && (
                            <div>
                                <label htmlFor="review-external-method" className="mb-2 block text-sm font-medium text-gray-700">외부 처리 방식</label>
                                <Select value={externalMethod} onValueChange={(value) => setExternalMethod(value as ExternalMethod)}>
                                    <SelectTrigger id="review-external-method">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(externalMethodLabels) as ExternalMethod[]).map((method) => (
                                            <SelectItem key={method} value={method}>{externalMethodLabels[method]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div>
                            <label htmlFor="review-note" className="mb-2 block text-sm font-medium text-gray-700">
                                처리 메모 (필수)
                            </label>
                            <Textarea
                                id="review-note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
                                placeholder="결제사 관리자에서 확인한 내용을 적어 주세요."
                            />
                        </div>
                    </div>

                    <DialogFooter className="justify-center gap-2">
                        <Button variant="outline" onClick={() => setSelectedOrder(null)} disabled={isSubmitting}>
                            취소
                        </Button>
                        <Button onClick={handleSubmit} disabled={isSubmitting || note.trim().length === 0}>
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    처리 중...
                                </>
                            ) : '처리 기록'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
