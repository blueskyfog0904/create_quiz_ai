'use client'

/**
 * 관리자 환불 관리 클라이언트 컴포넌트
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Clock,
    CheckCircle,
    XCircle,
    RefreshCcw,
    Loader2,
    Coins
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { refundRequiresRecovery } from '@/lib/payment-review-actions'

export interface RefundRequest {
    id: string
    user_id: string
    source_id: string
    reason: string | null
    status:
        | 'pending_review'
        | 'processing'
        | 'completed'
        | 'rejected'
        | 'retryable_failed'
        | 'manual_review'
    provider: 'toss' | 'kakaopay' | 'payapp'
    origin: 'user' | 'external_cancel' | 'partial_cancel'
    admin_note: string | null
    refund_amount: number | null
    provider_cancel_transaction_key: string | null
    provider_cancelled_at: string | null
    attempt_count: number
    last_error_code: string | null
    last_error_message: string | null
    created_at: string
    updated_at: string
    user: {
        id: string
        email: string | null
    } | null
    source: {
        id: string
        initial_credits: number
        remaining_credits: number
        purchased_at: string
        plan: {
            name: string
            price: number
        } | null
    } | null
    processor: {
        id: string
        email: string | null
    } | null
    order: {
        expected_amount: number
        transaction: {
            partial_cancel_feedback_recorded_at: string | null
        } | null
    } | null
}

const requiresRecovery = (request: RefundRequest) => refundRequiresRecovery({
    origin: request.origin,
    partialCancelMarker: Boolean(request.order?.transaction?.partial_cancel_feedback_recorded_at),
    lastErrorCode: request.last_error_code,
})

const isWholeNumberBetween = (value: string, min: number, max: number) => {
    if (!/^[0-9]+$/.test(value.trim())) return false
    const parsed = Number(value)
    return parsed >= min && parsed <= max
}

interface RefundsClientProps {
    requests: RefundRequest[]
    stats: {
        pendingCount: number
        completedCount: number
        rejectedCount: number
        attentionCount: number
    }
}

type ProcessAction = 'approve' | 'reject' | 'complete_manual'
type ExternalMethod = 'payapp_cancel_request' | 'bank_transfer' | 'provider_admin_cancel'

const externalMethodLabels: Record<ExternalMethod, string> = {
    payapp_cancel_request: '페이앱 취소 요청(정산금 반환)',
    bank_transfer: '고객 계좌 송금',
    provider_admin_cancel: '결제사 관리자에서 취소',
}

export function RefundsClient({ requests, stats }: RefundsClientProps) {
    const router = useRouter()
    const [statusFilter, setStatusFilter] = useState('pending_review')
    const [isProcessDialogOpen, setIsProcessDialogOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<RefundRequest | null>(null)
    const [processAction, setProcessAction] = useState<ProcessAction>('approve')
    const [adminNote, setAdminNote] = useState('')
    const [externalMethod, setExternalMethod] = useState<ExternalMethod>('payapp_cancel_request')
    const [refundAmount, setRefundAmount] = useState('')
    const [recoveredCredits, setRecoveredCredits] = useState('')
    const [providerNotCancelledConfirmed, setProviderNotCancelledConfirmed] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // 필터링된 요청
    const filteredRequests = requests.filter(r =>
        statusFilter === 'all' || r.status === statusFilter
    )

    const getProviderLabel = (provider: RefundRequest['provider']) =>
        provider === 'payapp' ? '페이앱' : provider === 'kakaopay' ? '카카오페이' : '일반결제'

    // 상태 배지
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending_review':
                return <Badge className="bg-yellow-100 text-yellow-700"><Clock className="w-3 h-3 mr-1" />대기중</Badge>
            case 'processing':
                return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />처리중</Badge>
            case 'completed':
                return <Badge className="bg-green-100 text-green-700"><CheckCircle className="w-3 h-3 mr-1" />환불 완료</Badge>
            case 'rejected':
                return <Badge className="bg-red-100 text-red-700"><XCircle className="w-3 h-3 mr-1" />거부</Badge>
            case 'retryable_failed':
                return <Badge className="bg-orange-100 text-orange-700">재처리 필요</Badge>
            case 'manual_review':
                return <Badge variant="destructive">수동 확인 필요</Badge>
            default:
                return <Badge>{status}</Badge>
        }
    }

    // 처리 다이얼로그 열기
    const openProcessDialog = (request: RefundRequest, action: ProcessAction) => {
        setSelectedRequest(request)
        setProcessAction(action)
        setAdminNote('')
        setExternalMethod(request.provider === 'payapp' ? 'payapp_cancel_request' : 'provider_admin_cancel')
        // 부분취소 건의 refund_amount는 신청 기준액(전액)이므로 실제 환불액을 직접 입력하게 한다.
        setRefundAmount(!requiresRecovery(request) && request.refund_amount ? String(request.refund_amount) : '')
        setRecoveredCredits('')
        setProviderNotCancelledConfirmed(false)
        setIsProcessDialogOpen(true)
    }

    const selectedRequiresRecovery = selectedRequest ? requiresRecovery(selectedRequest) : false
    const maxRefundAmount = selectedRequest?.order?.expected_amount ?? selectedRequest?.source?.plan?.price ?? 0
    const remainingCredits = selectedRequest?.source?.remaining_credits ?? 0
    const manualCompletionReady = processAction !== 'complete_manual' ||
        (adminNote.trim().length > 0 &&
            isWholeNumberBetween(refundAmount, 1, maxRefundAmount) &&
            (!selectedRequiresRecovery || isWholeNumberBetween(recoveredCredits, 0, remainingCredits)))
    // 수동 확인 환불을 거절하려면 결제사 미취소 확인과 처리 메모가 모두 필요하다.
    const rejectingManualReview = processAction === 'reject' && selectedRequest?.status === 'manual_review'
    const rejectReady = !rejectingManualReview ||
        (providerNotCancelledConfirmed && adminNote.trim().length > 0)
    const noteRequired = processAction === 'complete_manual' || rejectingManualReview

    // 환불 처리
    const handleProcess = async () => {
        if (!selectedRequest) return

        setIsSubmitting(true)
        try {
            const response = await fetch('/api/admin/refunds', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: selectedRequest.id,
                    action: processAction,
                    adminNote: adminNote || undefined,
                    ...(processAction === 'reject' && selectedRequest.status === 'manual_review'
                        ? { providerNotCancelledConfirmed }
                        : {}),
                    ...(processAction === 'complete_manual'
                        ? {
                            externalMethod,
                            refundAmount: Number(refundAmount),
                            ...(selectedRequiresRecovery
                                ? { recoveredCredits: Number(recoveredCredits) }
                                : {}),
                        }
                        : {}),
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || '처리 중 오류가 발생했습니다.')
            }

            toast.success(data.message)
            setIsProcessDialogOpen(false)
            router.refresh()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold"><AdminMenuName href="/admin/refunds" fallback="환불 요청 관리" /></h1>
                    <p className="text-gray-500">사용자의 환불 요청을 검토하고 처리합니다.</p>
                </div>
                <Button variant="outline" onClick={() => router.refresh()}>
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    새로고침
                </Button>
            </div>

            {/* 통계 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="cursor-pointer hover:bg-yellow-50 transition-colors" onClick={() => setStatusFilter('pending_review')}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">대기중</CardTitle>
                        <Clock className="h-4 w-4 text-yellow-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-700">{stats.pendingCount}</div>
                    </CardContent>
                </Card>
                <Card className="cursor-pointer hover:bg-green-50 transition-colors" onClick={() => setStatusFilter('completed')}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">환불 완료</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-700">{stats.completedCount}</div>
                    </CardContent>
                </Card>
                <Card className="cursor-pointer hover:bg-red-50 transition-colors" onClick={() => setStatusFilter('rejected')}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">거부됨</CardTitle>
                        <XCircle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-700">{stats.rejectedCount}</div>
                    </CardContent>
                </Card>
                <Card className="cursor-pointer hover:bg-orange-50 transition-colors" onClick={() => setStatusFilter('retryable_failed')}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">확인 필요</CardTitle>
                        <RefreshCcw className="h-4 w-4 text-orange-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-700">{stats.attentionCount}</div>
                    </CardContent>
                </Card>
            </div>

            {/* 필터 */}
            <div className="flex items-center gap-4">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="상태 필터" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="pending_review">대기중</SelectItem>
                        <SelectItem value="processing">처리중</SelectItem>
                        <SelectItem value="completed">환불 완료</SelectItem>
                        <SelectItem value="retryable_failed">재처리 필요</SelectItem>
                        <SelectItem value="manual_review">수동 확인 필요</SelectItem>
                        <SelectItem value="rejected">거부됨</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* 요청 테이블 */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>요청일</TableHead>
                                <TableHead>사용자</TableHead>
                                <TableHead>요금제</TableHead>
                                <TableHead>크레딧</TableHead>
                                <TableHead>금액</TableHead>
                                <TableHead>사유</TableHead>
                                <TableHead>상태</TableHead>
                                <TableHead>결제 처리</TableHead>
                                <TableHead className="text-right">처리</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredRequests.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                                        해당 상태의 환불 요청이 없습니다.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredRequests.map((request) => (
                                    <TableRow key={request.id}>
                                        <TableCell className="text-sm text-gray-500">
                                            {new Date(request.created_at).toLocaleDateString('ko-KR')}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium">{request.user ? formatMemberDisplayName(request.user.email, request.user.id) : '알 수 없음'}</span>
                                                <span className="text-xs text-gray-400">{request.user?.email}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>{request.source?.plan?.name || '-'}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Coins className="h-4 w-4 text-yellow-500" />
                                                {request.source?.initial_credits?.toLocaleString() || 0}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            ₩{request.source?.plan?.price?.toLocaleString() || 0}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={request.reason || ''}>
                                            {request.reason || '-'}
                                        </TableCell>
                                        <TableCell>
                                            {getStatusBadge(request.status)}
                                            {request.origin !== 'user' && (
                                                <p className="mt-1 text-xs text-gray-500">
                                                    {request.origin === 'partial_cancel' ? '결제사 부분취소 확인 중' : '결제사 취소 확인 중'}
                                                </p>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[220px] text-xs text-gray-500">
                                            <p className="mb-1 font-medium text-gray-700">
                                                {getProviderLabel(request.provider)}
                                            </p>
                                            {request.provider_cancel_transaction_key ? (
                                                <div className="space-y-1">
                                                    <p>취소 거래키</p>
                                                    <p
                                                        className="truncate"
                                                        title={request.provider_cancel_transaction_key}
                                                    >
                                                        {request.provider_cancel_transaction_key}
                                                    </p>
                                                </div>
                                            ) : request.last_error_message ? (
                                                <div className="space-y-1">
                                                    <p className="font-medium text-red-600">
                                                        {request.last_error_code || '처리 오류'}
                                                    </p>
                                                    <p title={request.last_error_message}>
                                                        {request.last_error_message}
                                                    </p>
                                                </div>
                                            ) : (
                                                <span>시도 {request.attempt_count || 0}회</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {['pending_review', 'retryable_failed'].includes(request.status) ? (
                                                <div className="flex gap-2 justify-end">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-green-600 hover:bg-green-50"
                                                        onClick={() => openProcessDialog(request, 'approve')}
                                                    >
                                                        승인
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-red-600 hover:bg-red-50"
                                                        onClick={() => openProcessDialog(request, 'reject')}
                                                    >
                                                        거부
                                                    </Button>
                                                </div>
                                            ) : request.status === 'manual_review' ? (
                                                <div className="flex gap-2 justify-end">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => openProcessDialog(request, 'complete_manual')}
                                                    >
                                                        수동 완료
                                                    </Button>
                                                    {request.origin === 'user' && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="text-red-600 hover:bg-red-50"
                                                            onClick={() => openProcessDialog(request, 'reject')}
                                                        >
                                                            거부
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-sm text-gray-400">
                                                    {request.processor?.email ? extractAdminLoginId(request.processor.email) : '처리됨'}
                                                </span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* 처리 다이얼로그 */}
            <Dialog open={isProcessDialogOpen} onOpenChange={setIsProcessDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {processAction === 'complete_manual'
                                ? '수동 환불 완료'
                                : `환불 ${processAction === 'approve' ? '승인' : '거부'}`}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedRequest && (
                                <>
                                    <strong>{selectedRequest.user ? formatMemberDisplayName(selectedRequest.user.email, selectedRequest.user.id) : '알 수 없음'}</strong>님의 {' '}
                                    <strong>{selectedRequest.source?.plan?.name}</strong> 요금제 ({selectedRequest.source?.initial_credits?.toLocaleString()} 크레딧) 환불 요청
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {processAction === 'approve' && (
                            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                <p className="text-sm text-green-700">
                                    승인 시 {selectedRequest ? getProviderLabel(selectedRequest.provider) : '원 결제수단'}으로 ₩{selectedRequest?.source?.plan?.price?.toLocaleString() || 0}을 먼저 취소한 뒤,
                                    취소 성공이 확인되면 {selectedRequest?.source?.initial_credits?.toLocaleString() || 0} 크레딧을 회수합니다.
                                </p>
                            </div>
                        )}

                        {processAction === 'reject' && (
                            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                <p className="text-sm text-red-700">
                                    거부 시 환불 요청이 취소되고, 해당 크레딧은 다시 사용 가능 상태가 됩니다.
                                </p>
                            </div>
                        )}

                        {processAction === 'reject' && selectedRequest?.status === 'manual_review' && (
                            <label className="flex items-start gap-2 text-sm text-gray-700">
                                <Checkbox
                                    checked={providerNotCancelledConfirmed}
                                    onCheckedChange={(checked) => setProviderNotCancelledConfirmed(checked === true)}
                                    className="mt-0.5"
                                />
                                결제사 관리자에서 이 결제가 취소되지 않았음을 확인했습니다.
                            </label>
                        )}

                        {processAction === 'complete_manual' && (
                            <div className="space-y-4">
                                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                                    <p className="text-sm text-amber-800">
                                        {selectedRequest?.provider === 'payapp'
                                            ? '페이앱 관리자에서 취소 요청(정산금 반환) 또는 고객 계좌 송금을 마친 뒤 완료 처리하세요.'
                                            : '결제사 관리자에서 취소하거나 고객 계좌 송금을 마친 뒤 완료 처리하세요.'}
                                        {' '}완료하면 크레딧을 회수하고 환불 요청을 완료로 기록합니다.
                                    </p>
                                    {selectedRequiresRecovery && (
                                        <p className="mt-2 text-sm font-medium text-amber-900">
                                            부분취소된 결제입니다. 고객에게 실제로 환불한 총액과 회수할 크레딧을 직접 입력하세요.
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label htmlFor="manual-external-method" className="text-sm font-medium text-gray-700 mb-2 block">외부 처리 방식</label>
                                    <Select value={externalMethod} onValueChange={(value) => setExternalMethod(value as ExternalMethod)}>
                                        <SelectTrigger id="manual-external-method">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(Object.keys(externalMethodLabels) as ExternalMethod[]).map((method) => (
                                                <SelectItem key={method} value={method}>{externalMethodLabels[method]}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label htmlFor="manual-refund-amount" className="text-sm font-medium text-gray-700 mb-2 block">
                                        고객에게 실제로 환불한 총액 (원, 결제 금액 {maxRefundAmount.toLocaleString()}원 이하)
                                    </label>
                                    <Input
                                        id="manual-refund-amount"
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={maxRefundAmount}
                                        value={refundAmount}
                                        onChange={(e) => setRefundAmount(e.target.value)}
                                    />
                                </div>
                                {selectedRequiresRecovery ? (
                                    <div>
                                        <label htmlFor="manual-recovered-credits" className="text-sm font-medium text-gray-700 mb-2 block">
                                            회수할 크레딧 (필수, 0 이상 {remainingCredits.toLocaleString()} 이하)
                                        </label>
                                        <Input
                                            id="manual-recovered-credits"
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            max={remainingCredits}
                                            value={recoveredCredits}
                                            onChange={(e) => setRecoveredCredits(e.target.value)}
                                        />
                                        <p className="mt-1 text-xs text-gray-500">
                                            남은 크레딧 {remainingCredits.toLocaleString()} / 구매 {selectedRequest?.source?.initial_credits?.toLocaleString() ?? 0}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-600">
                                        남은 크레딧 {remainingCredits.toLocaleString()}을 모두 회수합니다.
                                    </p>
                                )}
                            </div>
                        )}

                        <div>
                            <label htmlFor="refund-admin-note" className="text-sm font-medium text-gray-700 mb-2 block">
                                {noteRequired ? '처리 메모 (필수)' : '관리자 메모 (선택)'}
                            </label>
                            <Textarea
                                id="refund-admin-note"
                                placeholder="처리 관련 메모를 입력하세요..."
                                value={adminNote}
                                onChange={(e) => setAdminNote(e.target.value)}
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter className="justify-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsProcessDialogOpen(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button
                            onClick={handleProcess}
                            disabled={isSubmitting || !manualCompletionReady || !rejectReady}
                            className={processAction === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    처리 중...
                                </>
                            ) : (
                                processAction === 'approve'
                                    ? '원 결제수단 환불'
                                    : processAction === 'complete_manual' ? '완료 처리' : '거부'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
