'use client'

/**
 * 크레딧 관리 페이지 클라이언트 컴포넌트
 * 잔액 표시, 구매건 목록(환불 요청 버튼), 거래 내역
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Textarea } from '@/components/ui/textarea'
import {
    Coins,
    ArrowRight,
    Clock,
    AlertCircle,
    Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { getCreditSourceCategoryLabel, type CreditSourceCategory } from '@/lib/credit-source-display'
import {
  getCreditTransactionDescription,
  getCreditTransactionTypeLabel,
} from '@/lib/credit-transaction-display'
import { HistoryFilterBar } from '@/components/features/mypage/history-filter-bar'
import {
  filterCreditSourcesByHistoryFilter,
  filterCreditTransactionsByHistoryFilter,
  type CreditSourceHistoryFilter,
  type CreditTransactionHistoryFilter,
} from '@/lib/mypage-history-filters'

interface CreditSource {
  id: string
  initial_credits: number
  remaining_credits: number
  status: 'active' | 'pending_refund' | 'refunded'
  purchased_at: string
  expires_at: string | null
  source_category: CreditSourceCategory
  canRefund: boolean
  refundBlockedReason: string | null
  refundableUntil: string | null
  plan: {
    name: string
    price: number
  } | null
}

interface CreditTransaction {
  id: string
  type: string
  amount: number
  balance_after: number
  description: string
  created_at: string
  source?: {
    source_category: CreditSourceCategory
  } | null
}

interface RefundRequest {
    id: string
    source_id: string
    status:
        | 'pending_review'
        | 'processing'
        | 'completed'
        | 'rejected'
        | 'retryable_failed'
        | 'manual_review'
    reason: string
    created_at: string
}

interface CreditsClientProps {
    balance: number
    spendableBalance: number
    expiredBalance: number
    nextExpirationAt: string | null
    databaseNow: string
    sources: CreditSource[]
    transactions: CreditTransaction[]
    refundRequests: RefundRequest[]
}

export function CreditsClient({
    balance,
    spendableBalance,
    expiredBalance,
    nextExpirationAt,
    databaseNow,
    sources,
    transactions
}: CreditsClientProps) {
    const router = useRouter()
    const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false)
    const [selectedSource, setSelectedSource] = useState<CreditSource | null>(null)
    const [refundReason, setRefundReason] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [sourceFilters, setSourceFilters] = useState<CreditSourceHistoryFilter>({
        fromDate: '',
        toDate: '',
        sourceCategory: 'all',
    })
    const [transactionFilters, setTransactionFilters] = useState<CreditTransactionHistoryFilter>({
        fromDate: '',
        toDate: '',
        transactionType: 'all',
    })

    const filteredSources = useMemo(
        () => filterCreditSourcesByHistoryFilter(sources, sourceFilters),
        [sourceFilters, sources]
    )

    const filteredTransactions = useMemo(
        () => filterCreditTransactionsByHistoryFilter(transactions, transactionFilters),
        [transactionFilters, transactions]
    )

    const isExpired = (source: CreditSource) =>
        source.expires_at !== null &&
        new Date(source.expires_at).getTime() <= new Date(databaseNow).getTime()

    // 환불 가능 여부 확인
    const canRequestRefund = (source: CreditSource) => source.canRefund

    // 환불 불가 사유
    const getRefundBlockReason = (source: CreditSource) =>
        source.refundBlockedReason

    // 환불 요청 제출
    const handleRefundRequest = async () => {
        if (!selectedSource) return

        setIsSubmitting(true)
        try {
            const response = await fetch('/api/refunds/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceId: selectedSource.id,
                    reason: refundReason || '사유 없음'
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || '환불 요청 중 오류가 발생했습니다.')
            }

            toast.success(data.message)
            setIsRefundDialogOpen(false)
            setRefundReason('')
            router.refresh()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '환불 요청 중 오류가 발생했습니다.')
        } finally {
            setIsSubmitting(false)
        }
    }

    // 상태 배지
    const getStatusBadge = (source: CreditSource) => {
        if (isExpired(source)) {
            return <Badge variant="secondary">사용기한 만료</Badge>
        }

        const status = source.status
        switch (status) {
            case 'active':
                return <Badge className="bg-green-100 text-green-700">사용 가능</Badge>
            case 'pending_refund':
                return <Badge className="bg-yellow-100 text-yellow-700">환불 대기</Badge>
            case 'refunded':
                return <Badge className="bg-gray-100 text-gray-500">환불 완료</Badge>
            default:
                return <Badge>{status}</Badge>
        }
    }

    const getSourceCategoryLabel = (source: CreditSource) => getCreditSourceCategoryLabel({
        status: source.status,
        plan: source.plan,
        sourceCategory: source.source_category,
    })

    // 거래 유형 배지
    const getTypeBadge = (transaction: CreditTransaction) => {
        const label = getCreditTransactionTypeLabel(transaction)

        if (label === '충전') {
            return <Badge className="bg-blue-100 text-blue-700">충전</Badge>
        }
        if (label === '지급') {
            return <Badge className="bg-purple-100 text-purple-700">지급</Badge>
        }
        if (label === '사용') {
            return <Badge className="bg-gray-100 text-gray-700">사용</Badge>
        }
        if (label === '환불') {
            return <Badge className="bg-yellow-100 text-yellow-700">환불</Badge>
        }

        return <Badge>{label}</Badge>
    }

    const sourceCategoryOptions = [
        { value: 'all', label: '전체' },
        { value: 'plan_purchase', label: '요금제 구매' },
        { value: 'admin_grant', label: '관리자 지급' },
        { value: 'system_refund', label: '환불' },
        { value: 'bonus', label: '보너스' },
        { value: 'legacy_unknown', label: '기타 지급' },
    ]

    const transactionTypeOptions = [
        { value: 'all', label: '전체' },
        { value: 'purchase', label: '충전/지급' },
        { value: 'consume', label: '사용' },
        { value: 'refund', label: '환불' },
        { value: 'admin_grant', label: '지급' },
    ]

    return (
        <div className="space-y-6">
            {/* 잔액 카드 */}
            <Card className="bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2">
                        <Coins className="h-5 w-5 text-amber-500" />
                        현재 보유 크레딧
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-5xl font-bold text-amber-600">
                                {balance.toLocaleString()}
                            </div>
                            <p className="text-amber-700 mt-1">사용 가능한 크레딧</p>
                            {nextExpirationAt && (
                                <p className="mt-2 text-xs text-amber-800">
                                    다음 사용기한: {new Date(nextExpirationAt).toLocaleDateString('ko-KR')}
                                </p>
                            )}
                            {expiredBalance > 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    만료 크레딧 {expiredBalance.toLocaleString()}C
                                </p>
                            )}
                            <span className="sr-only">
                                사용 가능 잔액 {spendableBalance.toLocaleString()} 크레딧
                            </span>
                        </div>
                        <Link href="/pricing">
                            <Button className="gap-2 bg-amber-500 hover:bg-amber-600">
                                <Coins className="h-4 w-4" />
                                크레딧 충전
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        </Link>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">크레딧 충전·사용 경로</CardTitle>
                    <CardDescription>
                        충전한 크레딧은 문제마켓 자료 구매에 사용됩니다.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button asChild variant="outline">
                        <Link href="/pricing">크레딧 충전</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/mypage/payments">결제 내역</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/terms/refund">취소/환불정책</Link>
                    </Button>
                </CardContent>
            </Card>

            {/* 탭 */}
            <Tabs defaultValue="sources" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="sources">구매 내역</TabsTrigger>
                    <TabsTrigger value="transactions">거래 내역</TabsTrigger>
                </TabsList>

                {/* 구매건 목록 */}
                <TabsContent value="sources">
                    <Card>
                        <CardHeader>
                            <CardTitle>구매건별 크레딧</CardTitle>
                            <CardDescription>
                                각 구매건의 잔여 크레딧과 환불 가능 여부를 확인할 수 있습니다.
                                <br />
                                크레딧은 가장 오래된 구매건부터 차감됩니다. (FIFO)
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {sources.length === 0 ? (
                                <div className="text-center py-12 text-gray-500">
                                    <Coins className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                                    <p>아직 구매 내역이 없습니다.</p>
                                    <Link href="/pricing">
                                        <Button variant="link" className="mt-2">
                                            요금제 보기 →
                                        </Button>
                                    </Link>
                                </div>
                            ) : (
                                <>
                                    <HistoryFilterBar
                                        categoryLabel="구분"
                                        categoryOptions={sourceCategoryOptions}
                                        initialValues={{
                                            fromDate: sourceFilters.fromDate,
                                            toDate: sourceFilters.toDate,
                                            categoryValue: sourceFilters.sourceCategory,
                                        }}
                                        onApply={(next) => setSourceFilters({
                                            fromDate: next.fromDate,
                                            toDate: next.toDate,
                                            sourceCategory: next.categoryValue ?? 'all',
                                        })}
                                        resultCount={filteredSources.length}
                                    />

                                    {filteredSources.length === 0 ? (
                                        <div className="rounded-lg border border-dashed bg-gray-50/60 p-10 text-center text-sm text-gray-500">
                                            선택한 조건에 해당하는 구매 내역이 없습니다.
                                        </div>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>구매일</TableHead>
                                                    <TableHead>사용기한</TableHead>
                                                    <TableHead>환불 신청 마감</TableHead>
                                                    <TableHead>구분</TableHead>
                                                    <TableHead>구매 크레딧</TableHead>
                                                    <TableHead>잔여 크레딧</TableHead>
                                                    <TableHead>상태</TableHead>
                                                    <TableHead className="text-right">환불</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredSources.map((source) => {
                                                    const canRefund = canRequestRefund(source)
                                                    const blockReason = getRefundBlockReason(source)

                                                    return (
                                                        <TableRow key={source.id}>
                                                            <TableCell className="text-sm">
                                                                {new Date(source.purchased_at).toLocaleDateString('ko-KR')}
                                                            </TableCell>
                                                            <TableCell className="text-sm">
                                                                {source.expires_at
                                                                    ? new Date(source.expires_at).toLocaleDateString('ko-KR')
                                                                    : '별도 기한 없음'}
                                                            </TableCell>
                                                            <TableCell className="text-sm">
                                                                {source.refundableUntil
                                                                    ? new Date(source.refundableUntil).toLocaleDateString('ko-KR')
                                                                    : '-'}
                                                            </TableCell>
                                                            <TableCell>
                                                                {getSourceCategoryLabel(source)}
                                                            </TableCell>
                                                            <TableCell>
                                                                {source.initial_credits.toLocaleString()}
                                                            </TableCell>
                                                            <TableCell>
                                                                <span className={source.remaining_credits === 0 ? 'text-gray-400' : 'font-medium'}>
                                                                    {source.remaining_credits.toLocaleString()}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell>
                                                                {getStatusBadge(source)}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {source.status === 'active' && (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        disabled={!canRefund}
                                                                        onClick={() => {
                                                                            setSelectedSource(source)
                                                                            setIsRefundDialogOpen(true)
                                                                        }}
                                                                        title={blockReason || undefined}
                                                                    >
                                                                        {canRefund ? '환불 요청' : blockReason}
                                                                    </Button>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* 거래 내역 */}
                <TabsContent value="transactions">
                    <Card>
                        <CardHeader>
                            <CardTitle>거래 내역</CardTitle>
                            <CardDescription>
                                크레딧 충전 및 사용 내역입니다.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {transactions.length === 0 ? (
                                <div className="text-center py-12 text-gray-500">
                                    <Clock className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                                    <p>아직 거래 내역이 없습니다.</p>
                                </div>
                            ) : (
                                <>
                                    <HistoryFilterBar
                                        categoryLabel="유형"
                                        categoryOptions={transactionTypeOptions}
                                        initialValues={{
                                            fromDate: transactionFilters.fromDate,
                                            toDate: transactionFilters.toDate,
                                            categoryValue: transactionFilters.transactionType,
                                        }}
                                        onApply={(next) => setTransactionFilters({
                                            fromDate: next.fromDate,
                                            toDate: next.toDate,
                                            transactionType: next.categoryValue ?? 'all',
                                        })}
                                        resultCount={filteredTransactions.length}
                                    />

                                    {filteredTransactions.length === 0 ? (
                                        <div className="rounded-lg border border-dashed bg-gray-50/60 p-10 text-center text-sm text-gray-500">
                                            선택한 조건에 해당하는 거래 내역이 없습니다.
                                        </div>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>일시</TableHead>
                                                    <TableHead>유형</TableHead>
                                                    <TableHead>내용</TableHead>
                                                    <TableHead className="text-right">변동</TableHead>
                                                    <TableHead className="text-right">잔액</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredTransactions.map((tx) => (
                                                    <TableRow key={tx.id}>
                                                        <TableCell className="text-sm text-gray-500">
                                                            {new Date(tx.created_at).toLocaleString('ko-KR')}
                                                        </TableCell>
                                                        <TableCell>
                                                            {getTypeBadge(tx)}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {getCreditTransactionDescription(tx)}
                                                        </TableCell>
                                                        <TableCell className={`text-right font-medium ${tx.amount > 0 ? 'text-green-600' : 'text-red-600'
                                                            }`}>
                                                            {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right text-gray-600">
                                                            {tx.balance_after.toLocaleString()}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* 환불 요청 다이얼로그 */}
            <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>환불 요청</DialogTitle>
                        <DialogDescription>
                            {selectedSource && (
                                <>
                                    <strong>{selectedSource.plan?.name}</strong> 요금제 ({selectedSource.initial_credits.toLocaleString()} 크레딧)에 대한 환불을 요청합니다.
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                            <div className="flex gap-2">
                                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                                <div className="text-sm text-yellow-700">
                                    <p className="font-medium mb-1">환불 안내</p>
                                    <ul className="list-disc list-inside space-y-1">
                                        <li>환불 요청 후 관리자 승인 절차가 필요합니다.</li>
                                        <li>환불 대기 중에는 해당 크레딧을 사용할 수 없습니다.</li>
                                        <li>승인 시 결제 금액이 환불됩니다.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">
                                환불 사유 (선택)
                            </label>
                            <Textarea
                                placeholder="환불 사유를 입력해주세요..."
                                value={refundReason}
                                onChange={(e) => setRefundReason(e.target.value)}
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter className="justify-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsRefundDialogOpen(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button
                            onClick={handleRefundRequest}
                            disabled={isSubmitting}
                            className="bg-red-500 hover:bg-red-600"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    처리 중...
                                </>
                            ) : (
                                '환불 요청'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
