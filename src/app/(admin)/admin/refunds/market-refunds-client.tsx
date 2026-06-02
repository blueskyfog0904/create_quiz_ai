'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface MarketRefundRequestRow {
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
}

interface MarketRefundsClientProps {
  requests: MarketRefundRequestRow[]
}

export function MarketRefundsClient({ requests }: MarketRefundsClientProps) {
  const router = useRouter()
  const [processingId, setProcessingId] = useState<string | null>(null)

  const processRefund = async (requestId: string, action: 'approve' | 'reject') => {
    setProcessingId(requestId)
    try {
      const response = await fetch(`/api/admin/market/refunds/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '문제마켓 환불 처리에 실패했습니다.')
      }

      router.refresh()
    } finally {
      setProcessingId(null)
    }
  }

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
              <TableHead>환불 크레딧</TableHead>
              <TableHead>대상</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">처리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-gray-500">
                  문제마켓 환불 요청이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{new Date(request.created_at).toLocaleDateString('ko-KR')}</TableCell>
                  <TableCell className="text-xs text-gray-500">{request.user_id}</TableCell>
                  <TableCell>{request.requested_refund_credits.toLocaleString()} C</TableCell>
                  <TableCell>{request.target_kind === 'v2_order' ? '신규 구매' : '기존 구매'}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={request.reason ?? ''}>
                    {request.reason ?? '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={request.status === 'pending' ? 'outline' : 'secondary'}>{request.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {request.status === 'pending' ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={processingId === request.id}
                          onClick={() => processRefund(request.id, 'approve')}
                        >
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={processingId === request.id}
                          onClick={() => processRefund(request.id, 'reject')}
                        >
                          거부
                        </Button>
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
    </Card>
  )
}
