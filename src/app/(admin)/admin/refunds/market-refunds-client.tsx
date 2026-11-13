'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatMemberDisplayName } from '@/lib/member-display-name'

export interface MarketRefundRequestRow {
  id: string
  user_id: string
  item_id: string
  target_kind: string
  requested_refund_credits: number
  status: string
  reason: string | null
  admin_note: string | null
  eligibility_snapshot: unknown
  created_at: string
  user: { email: string | null; display_tag: string | null } | null
  item: { title: string | null } | null
}

interface MarketRefundsClientProps {
  requests: MarketRefundRequestRow[]
}

type RefundAction = 'approve' | 'reject'

const STATUS_LABELS: Record<string, string> = {
  pending: '대기중',
  approved: '승인',
  rejected: '거부',
  canceled: '요청 취소',
  failed: '처리 실패',
}

const ACTION_LABELS: Record<RefundAction, string> = { approve: '승인', reject: '거부' }

export function MarketRefundsClient({ requests }: MarketRefundsClientProps) {
  const router = useRouter()
  const [processingId, setProcessingId] = useState<string | null>(null)
  // 승인·거부는 되돌릴 수 없으므로 누른 즉시 처리하지 않고 확인 창에서 한 번 더 묻는다.
  const [pending, setPending] = useState<{ request: MarketRefundRequestRow; action: RefundAction } | null>(null)
  const [adminNote, setAdminNote] = useState('')

  const processRefund = async (requestId: string, action: RefundAction) => {
    setProcessingId(requestId)
    try {
      const send = async (confirmedRefundCredits?: number) => {
        const response = await fetch(`/api/admin/market/refunds/${requestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, confirmedRefundCredits, adminNote: adminNote.trim() || undefined }),
        })
        return { response, result: await response.json().catch(() => null) }
      }

      let attempt = await send()
      // 되돌릴 수 없는 크레딧이 있으면 두 숫자를 보여 주고, 확인하면 복구 가능한 양으로 다시 보낸다.
      if (attempt.response.status === 409 && attempt.result?.code === 'MARKET_REFUND_SHORTFALL') {
        const shortfall = attempt.result
        const confirmed = window.confirm(
          `${shortfall.error}\n\n요청 ${Number(shortfall.requested).toLocaleString()}C / 복구 가능 ${Number(shortfall.restorable).toLocaleString()}C`
        )
        if (!confirmed) return
        attempt = await send(shortfall.restorable)
      }

      const { response, result } = attempt
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '문제마켓 환불 처리에 실패했습니다.')
      }

      toast.success(result.message)
      setPending(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 환불 처리에 실패했습니다.')
    } finally {
      setProcessingId(null)
    }
  }

  const memberName = (request: MarketRefundRequestRow) =>
    request.user ? formatMemberDisplayName(request.user.email, request.user.display_tag) : '알 수 없음'

  return (
    <Card>
      <CardHeader>
        <CardTitle>문제마켓 환불</CardTitle>
        <CardDescription>문제마켓 상품 환불 요청을 다운로드 이력 기준으로 검토합니다.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>요청일</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>상품</TableHead>
              <TableHead>환불 크레딧</TableHead>
              <TableHead>대상</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>처리 메모</TableHead>
              <TableHead className="text-right">처리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-gray-500">
                  문제마켓 환불 요청이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{new Date(request.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{memberName(request)}</span>
                      <span className="text-xs text-gray-400">{request.user?.email ?? '-'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate" title={request.item?.title ?? ''}>
                    {request.item?.title ?? '-'}
                  </TableCell>
                  <TableCell>{request.requested_refund_credits.toLocaleString()} C</TableCell>
                  <TableCell>{request.target_kind === 'v2_order' ? '신규 구매' : '기존 구매'}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={request.reason ?? ''}>
                    {request.reason ?? '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={request.status === 'pending' ? 'outline' : 'secondary'}>
                      {STATUS_LABELS[request.status] ?? request.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-gray-500" title={request.admin_note ?? ''}>
                    {request.admin_note ?? '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {request.status === 'pending' ? (
                      <div className="flex justify-end gap-2">
                        {(['approve', 'reject'] as const).map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant="outline"
                            disabled={processingId === request.id}
                            onClick={() => {
                              setAdminNote('')
                              setPending({ request, action })
                            }}
                          >
                            {ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">처리됨</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && processingId === null && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제마켓 환불 {pending ? ACTION_LABELS[pending.action] : ''}</DialogTitle>
            <DialogDescription>
              {pending && (
                <>
                  <strong>{memberName(pending.request)}</strong>님의{' '}
                  <strong>{pending.request.item?.title ?? '상품'}</strong> 환불 요청
                  ({pending.request.requested_refund_credits.toLocaleString()} C)
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {pending?.action === 'approve'
                ? '승인하면 크레딧을 회원에게 되돌려 주고, 이 상품을 더 이상 내려받을 수 없게 합니다. 되돌릴 수 없습니다.'
                : '거부하면 이 환불 요청이 닫히고 구매는 그대로 유지됩니다. 되돌릴 수 없습니다(환불 가능 기간 안이면 회원이 다시 요청할 수는 있습니다).'}
            </p>
            <div>
              <label htmlFor="market-refund-admin-note" className="mb-2 block text-sm font-medium text-gray-700">
                처리 메모 (선택)
              </label>
              <Textarea
                id="market-refund-admin-note"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="처리 관련 메모를 입력하세요..."
              />
            </div>
          </div>

          <DialogFooter className="justify-center gap-2">
            <Button variant="outline" onClick={() => setPending(null)} disabled={processingId !== null}>
              취소
            </Button>
            <Button
              disabled={processingId !== null}
              onClick={() => pending && processRefund(pending.request.id, pending.action)}
            >
              {processingId !== null ? '처리 중...' : pending ? ACTION_LABELS[pending.action] : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
