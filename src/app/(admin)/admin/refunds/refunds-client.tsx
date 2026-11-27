'use client'

/**
 * 관리자 환불 관리 클라이언트 컴포넌트
 */

import { useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAdminAlerts } from '@/components/admin/admin-alert-context'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
import { RefreshCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { CHARGE_REFUND_REJECT_REASON_MAX, MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE, memberTextHasLongNumber } from '@/lib/member-notifications'
import { MEMBER_FACING_PII_LABELS, memberFacingTextPiiHits } from '@/lib/member-facing-text-pii'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { refundRequiresRecovery } from '@/lib/payment-review-actions'
import type { ManualRefundRecoveryPreview } from '@/lib/manual-refund-recovery-preview'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminMetricCard, AdminMetricGrid } from '@/components/admin/kit/admin-metric-card'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { formatCount, formatCredits, formatWon as formatAdminWon } from '@/lib/admin-format'
import { REFUND_REQUEST_STATUS_LABELS, labelOf } from '@/lib/admin-orders'
import { adminStatusTone } from '@/lib/admin-status-tone'

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
    // 'toss'는 과거 결제 이력용이다.
    provider: 'kakaopay' | 'payapp' | 'toss'
    origin: 'user' | 'external_cancel' | 'partial_cancel'
    admin_note: string | null
    // 16번 Q7: 회원에게 보낸 거절 사유(거절 때 저장, 내부 메모 admin_note 와 따로)
    member_reject_reason?: string | null
    refund_amount: number | null
    provider_cancel_transaction_key: string | null
    provider_cancelled_at: string | null
    attempt_count: number
    last_error_code: string | null
    last_error_message: string | null
    created_at: string
    updated_at: string
    // 10번: 탈퇴 회원 행(서버가 사유·메모를 가려 보냄)
    memberWithdrawn?: boolean
    user: {
        id: string
        email: string | null
        display_tag: string
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
        method: {
            label: string
        } | null
        transaction: {
            cancel_feedback_recorded_at: string | null
            partial_cancel_feedback_recorded_at: string | null
        } | null
    } | null
}

const requiresRecovery = (request: RefundRequest) => refundRequiresRecovery({
    origin: request.origin,
    cancelMarker: Boolean(request.order?.transaction?.cancel_feedback_recorded_at),
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
    // 제목 바로 아래, 환불 요청보다 먼저 보여 줄 영역(결제 경보·수동 확인 주문)
    children?: ReactNode
    // 16번: 거절 사유 개인정보 경고의 예외 값(하단 정보 고객센터 연락처, DB 값)
    piiAllowed: { customerCenter: string; orderEmail: string }
}

// 여러 상태를 묶어 보는 필터. 그 밖의 값은 상태 하나와 그대로 비교한다.
const STATUS_GROUPS: Record<string, RefundRequest['status'][]> = {
    needs_action: ['pending_review', 'retryable_failed', 'manual_review'],
    attention: ['retryable_failed', 'manual_review'],
}

// 표시 금액: 환불 요청에 기록된 금액, 없으면 그 주문의 결제 금액. 요금제의 현재 가격은 결제 뒤에 바뀔 수 있어 쓰지 않는다.
const getRequestAmount = (request: RefundRequest | null) =>
    request?.refund_amount ?? request?.order?.expected_amount ?? null
const formatWon = (amount: number | null) => formatAdminWon(amount)

type ProcessAction = 'approve' | 'reject' | 'complete_manual'
type ExternalMethod = 'payapp_cancel_request' | 'bank_transfer' | 'provider_admin_cancel'

const sourceStatusLabels: Record<string, string> = {
    active: '사용 가능',
    pending_refund: '사용 보류',
    refunded: '환불됨',
}

const formatKstDateTime = (value: string | null) => {
    if (!value) return '없음'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date)
}

const externalMethodLabels: Record<ExternalMethod, string> = {
    payapp_cancel_request: '페이앱 취소 요청(정산금 반환)',
    bank_transfer: '고객 계좌 송금',
    provider_admin_cancel: '결제사 관리자에서 취소',
}

export function RefundsClient({ requests, stats, children, piiAllowed }: RefundsClientProps) {
    const router = useRouter()
    const alerts = useAdminAlerts()
    const [statusFilter, setStatusFilter] = useState('needs_action')
    const [isProcessDialogOpen, setIsProcessDialogOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<RefundRequest | null>(null)
    const [processAction, setProcessAction] = useState<ProcessAction>('approve')
    const [adminNote, setAdminNote] = useState('')
    // 16번 Q7: 회원에게 보낼 거절 사유(필수 — 회원에게 그대로 안내됨). 처리 메모와 따로 둔다.
    const [memberReason, setMemberReason] = useState('')
    // 거절은 됐지만 회원 알림이 실패했을 때 저장된 사유(창이 지우지 않고 보여 준다 — 고객지원으로 그대로 옮길 수 있게)
    const [unsentReason, setUnsentReason] = useState<string | null>(null)
    const [externalMethod, setExternalMethod] = useState<ExternalMethod>('payapp_cancel_request')
    const [refundAmount, setRefundAmount] = useState('')
    const [recoveredCredits, setRecoveredCredits] = useState('')
    const [providerNotCancelledConfirmed, setProviderNotCancelledConfirmed] = useState(false)
    // 수동 완료 원자료(get_manual_refund_recovery_preview). 화면은 값을 보여 주기만 하고 계산하지 않는다.
    const [preview, setPreview] = useState<ManualRefundRecoveryPreview | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // 필터링된 요청
    const filteredRequests = requests.filter(r =>
        statusFilter === 'all' || (STATUS_GROUPS[statusFilter]?.includes(r.status) ?? r.status === statusFilter)
    )

    // 결제수단 이름은 DB(payment_methods.label)에서 읽는다. 라벨이 없는 카카오·과거 결제만 결제사로 표시한다.
    const getProviderLabel = (request: RefundRequest) =>
        request.order?.method?.label ??
        (request.provider === 'kakaopay' ? '카카오페이' : request.provider === 'toss' ? '일반결제(이전)' : '페이앱')

    // 상태 배지(이름은 admin-orders 이름표, 색은 5-1 표)
    const getStatusBadge = (status: string) => (
        <AdminStatusBadge label={labelOf(REFUND_REQUEST_STATUS_LABELS, status)} tone={adminStatusTone('refundRequest', status)} />
    )

    // 처리 다이얼로그 열기
    const openProcessDialog = (request: RefundRequest, action: ProcessAction) => {
        setSelectedRequest(request)
        setProcessAction(action)
        setAdminNote('')
        setMemberReason('')
        setUnsentReason(null)
        setExternalMethod(request.provider === 'payapp' ? 'payapp_cancel_request' : 'provider_admin_cancel')
        // 부분취소 건의 refund_amount는 신청 기준액(전액)이므로 실제 환불액을 직접 입력하게 한다.
        setRefundAmount(!requiresRecovery(request) && request.refund_amount ? String(request.refund_amount) : '')
        setRecoveredCredits('')
        setProviderNotCancelledConfirmed(false)
        setPreview(null)
        setPreviewError(null)
        setIsProcessDialogOpen(true)
        if (action === 'complete_manual') void loadPreview(request.id)
    }

    const previewRequestIdRef = useRef<string | null>(null)
    const loadPreview = async (requestId: string) => {
        // 늦게 온 다른 요청의 응답(오류·로딩 끝 포함)이 지금 연 요청 화면을 덮지 않게 한다.
        previewRequestIdRef.current = requestId
        setPreviewLoading(true)
        try {
            const response = await fetch(`/api/admin/refunds/recovery-preview?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' })
            const data = await response.json().catch(() => null)
            if (previewRequestIdRef.current !== requestId) return
            if (!response.ok || !data?.preview) {
                setPreviewError(data?.error || '회수 원자료를 불러오지 못했습니다. 새로고침해 주세요.')
                return
            }
            setPreview(data.preview as ManualRefundRecoveryPreview)
        } catch {
            if (previewRequestIdRef.current === requestId) setPreviewError('회수 원자료를 불러오지 못했습니다. 새로고침해 주세요.')
        } finally {
            if (previewRequestIdRef.current === requestId) setPreviewLoading(false)
        }
    }

    // 수동 완료는 미리보기의 처리 모드·남은 환불 가능 금액·쓸 수 있는 몫 합(원래 + 다시 지급한 크레딧)을 기준으로 한다.
    // 다른 요청의 늦은 응답이 섞이지 않게 요청 id 가 같을 때만 쓴다.
    const manualPreview = processAction === 'complete_manual' && preview?.request_id === selectedRequest?.id ? preview : null
    const selectedRequiresRecovery = manualPreview
        ? manualPreview.mode === 'partial'
        : selectedRequest ? requiresRecovery(selectedRequest) : false
    const maxRefundAmount = manualPreview
        ? manualPreview.remaining_refundable_amount
        : selectedRequest?.order?.expected_amount ?? selectedRequest?.source?.plan?.price ?? 0
    const remainingCredits = manualPreview ? manualPreview.usable_total : selectedRequest?.source?.remaining_credits ?? 0
    const manualCompletionReady = processAction !== 'complete_manual' ||
        (manualPreview !== null &&
            adminNote.trim().length > 0 &&
            isWholeNumberBetween(refundAmount, 1, maxRefundAmount) &&
            (!selectedRequiresRecovery || isWholeNumberBetween(recoveredCredits, 0, remainingCredits)))
    // 수동 확인 환불을 거절하려면 결제사 미취소 확인과 처리 메모가 모두 필요하다.
    const rejectingManualReview = processAction === 'reject' && selectedRequest?.status === 'manual_review'
    const rejectReady = !rejectingManualReview ||
        (providerNotCancelledConfirmed && adminNote.trim().length > 0)
    const noteRequired = processAction === 'complete_manual' || rejectingManualReview
    // 거절 사유: 1~300자, 개인정보 모양·긴 숫자(계좌·카드번호)면 보내지 않는다(서버·DB 도 다시 막는다)
    const memberReasonText = memberReason.trim()
    const memberReasonPii = processAction === 'reject' ? memberFacingTextPiiHits(memberReasonText, piiAllowed) : []
    const memberReasonLongNumber = processAction === 'reject' && memberTextHasLongNumber(memberReasonText)
    const memberReasonReady = processAction !== 'reject' || (
        memberReasonText.length > 0 && memberReasonText.length <= CHARGE_REFUND_REJECT_REASON_MAX
        && memberReasonPii.length === 0 && !memberReasonLongNumber && unsentReason === null)

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
                    ...(processAction === 'reject' ? { memberReason: memberReasonText } : {}),
                    ...(processAction === 'reject' && selectedRequest.status === 'manual_review'
                        ? { providerNotCancelledConfirmed }
                        : {}),
                    ...(processAction === 'complete_manual'
                        ? {
                            externalMethod,
                            refundAmount: Number(refundAmount),
                            // 전액 모드도 미리보기에서 받은 쓸 수 있는 몫 합을 보낸다(그사이 바뀌면 DB 가 거절 → 새로고침 안내).
                            recoveredCredits: selectedRequiresRecovery ? Number(recoveredCredits) : remainingCredits,
                        }
                        : {}),
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || '처리 중 오류가 발생했습니다.')
            }

            toast.success(data.message)
            if (data.notificationFailed) {
                toast.warning(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE)
                // 거절 알림이 실패하면 저장된 사유를 창에 남겨 보여 준다(다시 거절은 막힌다 — 이미 처리됨).
                if (processAction === 'reject' && typeof data.memberReason === 'string') {
                    setUnsentReason(data.memberReason)
                    router.refresh()
                    alerts?.refresh()
                    return
                }
            }
            setIsProcessDialogOpen(false)
            router.refresh()
            alerts?.refresh()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.')
        } finally {
            setIsSubmitting(false)
        }
    }

    // 날짜 표기는 지금 모양(toLocaleDateString ko-KR) 그대로(20번: 대표가 바꾸기로 정하기 전까지).
    const columns: AdminDataTableColumn<RefundRequest>[] = [
        {
            key: 'createdAt',
            header: '요청일',
            className: 'whitespace-nowrap text-sm text-[var(--studio-muted)]',
            cell: (request) => new Date(request.created_at).toLocaleDateString('ko-KR'),
        },
        {
            key: 'member',
            header: '사용자',
            pii: true,
            cell: (request) => (
                <div className="flex flex-col">
                    <Link href={`/admin/users/${request.user_id}`} className="font-medium hover:underline">{request.memberWithdrawn ? '탈퇴 회원' : request.user ? formatMemberDisplayName(request.user.email, request.user.display_tag) : '알 수 없음'}</Link>
                    <span className="text-xs text-[var(--studio-muted)]">{request.memberWithdrawn ? '법정 보존' : request.user?.email}</span>
                </div>
            ),
        },
        { key: 'plan', header: '요금제', cell: (request) => request.source?.plan?.name || '-' },
        { key: 'credits', header: '크레딧', numeric: true, className: 'whitespace-nowrap', cell: (request) => formatCredits(request.source?.initial_credits || 0) },
        {
            key: 'amount',
            header: '금액',
            numeric: true,
            className: 'whitespace-nowrap',
            cell: (request) => (
                <>
                    {formatWon(getRequestAmount(request))}
                    {/* 부분취소 건의 기록 금액은 실제 환불액이 아니라 신청 기준액(전액)이다. */}
                    {requiresRecovery(request) && request.status !== 'completed' && (
                        <p className="text-xs text-[var(--studio-muted)]">신청 기준액</p>
                    )}
                </>
            ),
        },
        {
            key: 'reason',
            header: '사유',
            // 회원이 적은 사유·보낸 거절 사유는 화면 비교 때 가린다.
            pii: true,
            className: 'max-w-[200px] truncate',
            cell: (request) => (
                <span title={request.reason || ''}>
                    {request.memberWithdrawn ? '가림' : request.reason || '-'}
                    {/* 16번: 회원에게 보낸 거절 사유(요청 상세) */}
                    {request.status === 'rejected' && !request.memberWithdrawn && request.member_reject_reason && (
                        <p className="mt-1 whitespace-normal text-xs text-[var(--admin-tone-danger-text)]" title={request.member_reject_reason}>
                            보낸 거절 사유: {request.member_reject_reason}
                        </p>
                    )}
                </span>
            ),
        },
        {
            key: 'status',
            header: '상태',
            cell: (request) => (
                <>
                    {getStatusBadge(request.status)}
                    {request.origin !== 'user' && (
                        <p className="mt-1 text-xs text-[var(--studio-muted)]">
                            {request.origin === 'partial_cancel' ? '결제사 부분취소 확인 중' : '결제사 취소 확인 중'}
                        </p>
                    )}
                </>
            ),
        },
        {
            key: 'provider',
            header: '결제 처리',
            className: 'max-w-[220px] text-xs text-[var(--studio-muted)]',
            cell: (request) => (
                <>
                    <p className="mb-1 font-medium text-[var(--studio-text)]">
                        {getProviderLabel(request)}
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
                            <p className="font-medium text-[var(--admin-tone-danger-text)]">
                                {request.last_error_code || '처리 오류'}
                            </p>
                            <p title={request.last_error_message}>
                                {request.last_error_message}
                            </p>
                        </div>
                    ) : (
                        <span>시도 {request.attempt_count || 0}회</span>
                    )}
                </>
            ),
        },
        {
            key: 'actions',
            header: '처리',
            align: 'right',
            cell: (request) => (['pending_review', 'retryable_failed'].includes(request.status) ? (
                <div className="flex gap-2 justify-end">
                    <Button
                        size="sm"
                        variant="adminTable"
                        onClick={() => openProcessDialog(request, 'approve')}
                    >
                        승인
                    </Button>
                    <Button
                        size="sm"
                        variant="adminTable"
                        className="text-[var(--admin-tone-danger-text)]"
                        onClick={() => openProcessDialog(request, 'reject')}
                    >
                        거부
                    </Button>
                </div>
            ) : request.status === 'manual_review' ? (
                <div className="flex gap-2 justify-end">
                    <Button
                        size="sm"
                        variant="adminTable"
                        onClick={() => openProcessDialog(request, 'complete_manual')}
                    >
                        수동 완료
                    </Button>
                    {request.origin === 'user' && (
                        <Button
                            size="sm"
                            variant="adminTable"
                            className="text-[var(--admin-tone-danger-text)]"
                            onClick={() => openProcessDialog(request, 'reject')}
                        >
                            거부
                        </Button>
                    )}
                </div>
            ) : (
                <span className="text-sm text-[var(--studio-muted)]">
                    {request.processor?.email ? extractAdminLoginId(request.processor.email) : '처리됨'}
                </span>
            )),
        },
    ]

    // 카드를 누르면 그 상태로 거른다(지금 동작 그대로). 고른 카드는 눌림 표시.
    const statCards = [
        { title: '대기중', value: stats.pendingCount, filter: 'pending_review' },
        { title: '환불 완료', value: stats.completedCount, filter: 'completed' },
        { title: '거부됨', value: stats.rejectedCount, filter: 'rejected' },
        { title: '확인 필요', value: stats.attentionCount, filter: 'attention' },
    ]

    return (
        <div className="space-y-6">
            <AdminPageHeader
                className="mb-0"
                title={<AdminMenuName href="/admin/refunds" fallback="환불 요청 관리" />}
                description="사용자의 환불 요청을 검토하고 처리합니다."
                tools={
                    <Button
                        variant="brandOutline"
                        onClick={() => {
                            router.refresh()
                            alerts?.refresh()
                        }}
                    >
                        <RefreshCcw aria-hidden="true" className="h-4 w-4 mr-2" />
                        새로고침
                    </Button>
                }
            />

            {children}

            {/* 통계 카드 */}
            <AdminMetricGrid>
                {statCards.map((card) => (
                    <AdminMetricCard
                        key={card.filter}
                        title={card.title}
                        value={formatCount(card.value)}
                        pressed={statusFilter === card.filter}
                        onPress={() => setStatusFilter(card.filter)}
                    />
                ))}
            </AdminMetricGrid>

            {/* 필터(화면 안 상태 — 주소에 남기지 않는 지금 방식 그대로) */}
            <AdminFilterBar
                className="mb-0"
                filters={
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[280px] max-w-full" aria-label="상태 필터">
                            <SelectValue placeholder="상태 필터" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="needs_action">처리할 건 (대기·재처리·수동 확인)</SelectItem>
                            <SelectItem value="attention">확인 필요 (재처리·수동 확인)</SelectItem>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="pending_review">대기중</SelectItem>
                            <SelectItem value="processing">처리중</SelectItem>
                            <SelectItem value="completed">환불 완료</SelectItem>
                            <SelectItem value="retryable_failed">재처리 필요</SelectItem>
                            <SelectItem value="manual_review">수동 확인 필요</SelectItem>
                            <SelectItem value="rejected">거부됨</SelectItem>
                        </SelectContent>
                    </Select>
                }
                resultCount={filteredRequests.length}
            />

            {/* 요청 테이블 */}
            <AdminDataTable
                caption="충전 환불 요청 목록"
                columns={columns}
                rows={filteredRequests}
                getRowKey={(request) => request.id}
                minWidth={900}
                state={filteredRequests.length === 0 ? <AdminTableState kind="empty" message="해당 상태의 환불 요청이 없습니다." /> : undefined}
            />

            {/* 처리 다이얼로그 */}
            <Dialog open={isProcessDialogOpen} onOpenChange={setIsProcessDialogOpen}>
                <DialogContent className="max-md:max-h-[calc(100dvh-2rem)] max-md:max-w-[calc(100vw-2rem)] max-md:overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {processAction === 'complete_manual'
                                ? '수동 환불 완료'
                                : `환불 ${processAction === 'approve' ? '승인' : '거부'}`}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedRequest && (
                                <>
                                    <strong data-admin-pii="">{selectedRequest.user ? formatMemberDisplayName(selectedRequest.user.email, selectedRequest.user.display_tag) : '알 수 없음'}</strong>님의 {' '}
                                    <strong>{selectedRequest.source?.plan?.name}</strong> 요금제 ({formatCredits(selectedRequest.source?.initial_credits)}) 환불 요청
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {processAction === 'approve' && (
                            <AdminNotice kind="info">
                                승인 시 {selectedRequest ? getProviderLabel(selectedRequest) : '원 결제수단'}으로 {formatWon(getRequestAmount(selectedRequest))}을 먼저 취소한 뒤,
                                취소 성공이 확인되면 {formatCredits(selectedRequest?.source?.initial_credits || 0)}를 회수합니다.
                            </AdminNotice>
                        )}

                        {processAction === 'reject' && (
                            <AdminNotice kind="warning">
                                거부 시 환불 요청이 취소되고, 해당 크레딧은 다시 사용 가능 상태가 됩니다.
                            </AdminNotice>
                        )}

                        {processAction === 'reject' && (
                            <div>
                                <label htmlFor="refund-member-reason" className="text-sm font-medium text-[var(--studio-ink)] mb-2 block">
                                    회원에게 보낼 거절 사유 (필수 — 회원에게 그대로 안내됩니다)
                                </label>
                                {unsentReason !== null ? (
                                    <AdminNotice kind="warning" title="거절은 처리했지만 회원 알림을 보내지 못했습니다. 아래 사유를 고객지원으로 그대로 알려 주세요.">
                                        <p className="mt-1 whitespace-pre-wrap break-words">{unsentReason}</p>
                                    </AdminNotice>
                                ) : (
                                    <>
                                        <Textarea
                                            id="refund-member-reason"
                                            placeholder="예: 충전한 크레딧을 이미 사용하셔서 환불 요건에 맞지 않습니다."
                                            value={memberReason}
                                            onChange={(e) => setMemberReason(e.target.value)}
                                            rows={3}
                                            data-admin-pii=""
                                        />
                                        <p className="mt-1 text-xs text-[var(--studio-muted)]">
                                            계좌번호·카드번호 같은 숫자는 적지 마세요. 처리 메모는 회원에게 보이지 않습니다. ({memberReasonText.length}/{CHARGE_REFUND_REJECT_REASON_MAX})
                                        </p>
                                        {memberReasonPii.length > 0 && (
                                            <p role="alert" className="mt-1 text-xs text-[var(--admin-tone-danger-text)]">
                                                개인정보로 보이는 글이 있습니다({memberReasonPii.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')}). 지운 뒤 거절할 수 있습니다.
                                            </p>
                                        )}
                                        {memberReasonLongNumber && (
                                            <p role="alert" className="mt-1 text-xs text-[var(--admin-tone-danger-text)]">계좌번호·카드번호 같은 긴 숫자가 있습니다. 지운 뒤 거절할 수 있습니다.</p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {processAction === 'reject' && selectedRequest?.status === 'manual_review' && (
                            <label className="flex items-start gap-2 text-sm text-[var(--studio-text)]">
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
                                {previewLoading && (
                                    <AdminTableState kind="loading" message="회수 원자료를 불러오는 중입니다." className="py-4" />
                                )}
                                {previewError && <AdminNotice kind="error">{previewError}</AdminNotice>}
                                {manualPreview && (
                                    <div className="space-y-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm">
                                        {manualPreview.has_reissued && (
                                            <AdminNotice kind="warning">
                                                이 결제에서 비롯해 자료 환불로 다시 지급한 크레딧이 있습니다. 아래 원천별 값으로 이미 쓴 몫을 확인하고,
                                                완료 뒤 정산 경보(REISSUED_CREDIT_SETTLE_REVIEW)를 대표가 확인합니다.
                                            </AdminNotice>
                                        )}
                                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--studio-text)]">
                                            <dt>처리 모드</dt>
                                            <dd>{manualPreview.mode === 'partial' ? '부분(회수량 입력)' : '전액(쓸 수 있는 몫 모두 회수)'}</dd>
                                            <dt>결제 금액</dt>
                                            <dd>{formatWon(manualPreview.expected_amount)}</dd>
                                            <dt>부분취소 금액</dt>
                                            <dd>{formatWon(manualPreview.partial_cancel_amount)}</dd>
                                            <dt>앞서 환불 완료한 금액</dt>
                                            <dd>{formatWon(manualPreview.refunded_before)}</dd>
                                            <dt>남은 환불 가능 금액</dt>
                                            <dd>{formatWon(manualPreview.remaining_refundable_amount)}</dd>
                                            <dt>쓸 수 있는 몫 합(회수 상한)</dt>
                                            <dd>{formatCredits(manualPreview.usable_total)}</dd>
                                            {(manualPreview.withdrawal_forfeited_total ?? 0) > 0 && (
                                                <>
                                                    <dt>탈퇴로 소멸(사용 아님)</dt>
                                                    <dd>{formatCredits(manualPreview.withdrawal_forfeited_total ?? 0)}</dd>
                                                    <dt>실제 사용(지급−남음−소멸, 원래 충전과 다시 지급 합)</dt>
                                                    <dd>{formatCredits(manualPreview.family_used_excluding_forfeit ?? 0)}</dd>
                                                </>
                                            )}
                                        </dl>
                                        <div className="overflow-x-auto">
                                            <table className="w-full min-w-[48rem] text-xs">
                                                <thead className="text-left text-[var(--studio-muted)]">
                                                    <tr>
                                                        <th className="py-1 pr-2 font-medium">원천</th>
                                                        <th className="py-1 pr-2 font-medium">상태</th>
                                                        <th className="py-1 pr-2 text-right font-medium">지급</th>
                                                        <th className="py-1 pr-2 text-right font-medium">남음</th>
                                                        <th className="py-1 pr-2 text-right font-medium">쓸 수 있는 몫</th>
                                                        <th className="py-1 pr-2 text-right font-medium">소비 총량</th>
                                                        <th className="py-1 pr-2 text-right font-medium">자료 환불 복구</th>
                                                        <th className="py-1 pr-2 text-right font-medium">재지급으로 나감</th>
                                                        <th className="py-1 pr-2 text-right font-medium">지급−남음</th>
                                                        <th className="py-1 pr-2 text-right font-medium">탈퇴로 소멸(사용 아님)</th>
                                                        <th className="py-1 font-medium">만료(한국 시간)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {manualPreview.sources.map((source) => (
                                                        <tr key={source.source_id} className="border-t">
                                                            <td className="py-1 pr-2">{source.root ? '원래 충전' : '다시 지급'}</td>
                                                            <td className="py-1 pr-2">{sourceStatusLabels[source.status] ?? source.status}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.initial)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.remaining)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.usable)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.consumed_total)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.restored_by_material_refund)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.reissued_out)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.net_used)}</td>
                                                            <td className="py-1 pr-2 text-right tabular-nums">{formatCount(source.withdrawal_forfeited ?? 0)}</td>
                                                            <td className="py-1">{formatKstDateTime(source.expires_at)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {manualPreview.previous_completions.length > 0 && (
                                            <div>
                                                <p className="font-medium text-[var(--studio-ink)]">이 결제의 앞선 수동 완료</p>
                                                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--studio-text)]">
                                                    {manualPreview.previous_completions.map((completion, index) => (
                                                        <li key={`${completion.refund_request_id ?? 'none'}-${index}`}>
                                                            {formatKstDateTime(completion.created_at)} · 환불 {formatWon(completion.refund_amount)} · 회수 {formatCredits(completion.recovered ?? 0)} · 남긴 크레딧 {formatCount(completion.unrecovered ?? 0)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <AdminNotice kind="warning">
                                    <p>
                                        {selectedRequest?.provider === 'payapp'
                                            ? '페이앱 관리자에서 취소 요청(정산금 반환) 또는 고객 계좌 송금을 마친 뒤 완료 처리하세요.'
                                            : '결제사 관리자에서 취소하거나 고객 계좌 송금을 마친 뒤 완료 처리하세요.'}
                                        {' '}완료하면 크레딧을 회수하고 환불 요청을 완료로 기록합니다.
                                    </p>
                                    {selectedRequiresRecovery && (
                                        <p className="mt-2 font-medium">
                                            부분취소된 결제입니다. 고객에게 실제로 환불한 총액과 회수할 크레딧을 직접 입력하세요.
                                        </p>
                                    )}
                                </AdminNotice>
                                <div>
                                    <label htmlFor="manual-external-method" className="text-sm font-medium text-[var(--studio-ink)] mb-2 block">외부 처리 방식</label>
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
                                    <label htmlFor="manual-refund-amount" className="text-sm font-medium text-[var(--studio-ink)] mb-2 block">
                                        고객에게 실제로 환불한 총액 (원, 남은 환불 가능 금액 {formatWon(maxRefundAmount)} 이하)
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
                                        <label htmlFor="manual-recovered-credits" className="text-sm font-medium text-[var(--studio-ink)] mb-2 block">
                                            회수할 크레딧 (필수, 0 이상 {formatCount(remainingCredits)} 이하)
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
                                        <p className="mt-1 text-xs text-[var(--studio-muted)]">
                                            쓸 수 있는 몫 합 {formatCredits(remainingCredits)}(원래 충전 + 다시 지급한 크레딧, 유효기간이 먼저 끝나는 것부터 회수)
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-[var(--studio-text)]">
                                        쓸 수 있는 몫 {formatCredits(remainingCredits)}을 모두 회수합니다(원래 충전 + 다시 지급한 크레딧).
                                    </p>
                                )}
                            </div>
                        )}

                        <div>
                            <label htmlFor="refund-admin-note" className="text-sm font-medium text-[var(--studio-ink)] mb-2 block">
                                {noteRequired ? '처리 메모 (필수)' : '관리자 메모 (선택)'}
                            </label>
                            {/* 16번 16절 3: 수동 확인 거절의 처리 메모는 고칠 수 없는 처리 기록에 원문으로 남는다 */}
                            {rejectingManualReview && (
                                <p className="mb-2 text-xs text-[var(--studio-muted)]">이 메모는 고칠 수 없는 처리 기록에 남습니다. 회원 개인정보(계좌·연락처 등)는 적지 마세요.</p>
                            )}
                            <Textarea
                                id="refund-admin-note"
                                placeholder="처리 관련 메모를 입력하세요..."
                                value={adminNote}
                                onChange={(e) => setAdminNote(e.target.value)}
                                rows={3}
                                data-admin-pii=""
                            />
                        </div>
                    </div>

                    <DialogFooter className="justify-center gap-2">
                        <Button
                            variant="brandOutline"
                            onClick={() => setIsProcessDialogOpen(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button
                            onClick={handleProcess}
                            disabled={isSubmitting || !manualCompletionReady || !rejectReady || !memberReasonReady}
                            variant={processAction === 'reject' ? 'adminDanger' : 'brand'}
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
