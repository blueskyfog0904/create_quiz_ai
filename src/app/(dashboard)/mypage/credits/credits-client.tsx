'use client'

/**
 * 크레딧 관리 페이지 클라이언트 컴포넌트
 * 잔액 표시, 구매건 목록(환불 요청 버튼), 거래 내역
 */

import { useState } from 'react'
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
    TrendingUp,
    TrendingDown,
    ArrowRight,
    RefreshCcw,
    Clock,
    CheckCircle,
    XCircle,
    AlertCircle,
    Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { CreditService } from '@/lib/credits'

interface CreditSource {
    id: string
    initial_credits: number
    remaining_credits: number
    status: 'active' | 'pending_refund' | 'refunded'
    purchased_at: string
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
}

interface RefundRequest {
    id: string
    source_id: string
    status: 'pending' | 'approved' | 'rejected'
    reason: string
    created_at: string
}

interface CreditsClientProps {
    balance: number
    sources: CreditSource[]
    transactions: CreditTransaction[]
    refundRequests: RefundRequest[]
}

export function CreditsClient({
    balance,
    sources,
    transactions,
    refundRequests
}: CreditsClientProps) {
    const router = useRouter()
    const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false)
    const [selectedSource, setSelectedSource] = useState<CreditSource | null>(null)
    const [refundReason, setRefundReason] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // 환불 가능 여부 확인
    const canRequestRefund = (source: CreditSource) => {
        // 이미 환불 요청 중이거나 환불됨
        if (source.status !== 'active') return false

        // 사용한 크레딧이 있으면 불가
        if (source.remaining_credits < source.initial_credits) return false

        // 구매 후 7일 초과 시 불가
        const purchasedAt = new Date(source.purchased_at)
        const now = new Date()
        const daysDiff = Math.floor((now.getTime() - purchasedAt.getTime()) / (1000 * 60 * 60 * 24))
        if (daysDiff > 7) return false

        return true
    }

    // 환불 불가 사유
    const getRefundBlockReason = (source: CreditSource) => {
        if (source.status === 'pending_refund') return '환불 요청 중'
        if (source.status === 'refunded') return '환불 완료'
        if (source.remaining_credits < source.initial_credits) return '이미 사용한 크레딧 있음'

        const purchasedAt = new Date(source.purchased_at)
        const now = new Date()
        const daysDiff = Math.floor((now.getTime() - purchasedAt.getTime()) / (1000 * 60 * 60 * 24))
        if (daysDiff > 7) return '구매 후 7일 초과'

        return null
    }

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
    const getStatusBadge = (status: string) => {
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

    // 거래 유형 배지
    const getTypeBadge = (type: string, amount: number) => {
        if (type === 'purchase') {
            return <Badge className="bg-blue-100 text-blue-700">구매</Badge>
        }
        if (type === 'consume') {
            return <Badge className="bg-gray-100 text-gray-700">사용</Badge>
        }
        if (type === 'refund') {
            return <Badge className="bg-yellow-100 text-yellow-700">환불</Badge>
        }
        if (type === 'admin_grant') {
            return <Badge className="bg-purple-100 text-purple-700">관리자 지급</Badge>
        }
        return <Badge>{type}</Badge>
    }

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
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>구매일</TableHead>
                                            <TableHead>요금제</TableHead>
                                            <TableHead>구매 크레딧</TableHead>
                                            <TableHead>잔여 크레딧</TableHead>
                                            <TableHead>상태</TableHead>
                                            <TableHead className="text-right">환불</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {sources.map((source) => {
                                            const canRefund = canRequestRefund(source)
                                            const blockReason = getRefundBlockReason(source)

                                            return (
                                                <TableRow key={source.id}>
                                                    <TableCell className="text-sm">
                                                        {new Date(source.purchased_at).toLocaleDateString('ko-KR')}
                                                    </TableCell>
                                                    <TableCell>
                                                        {source.plan?.name || '알 수 없음'}
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
                                                        {getStatusBadge(source.status)}
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
                                        {transactions.map((tx) => (
                                            <TableRow key={tx.id}>
                                                <TableCell className="text-sm text-gray-500">
                                                    {new Date(tx.created_at).toLocaleString('ko-KR')}
                                                </TableCell>
                                                <TableCell>
                                                    {getTypeBadge(tx.type, tx.amount)}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {tx.description}
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

                    <DialogFooter>
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
