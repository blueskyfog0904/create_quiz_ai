'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAdminAlerts } from '@/components/admin/admin-alert-context'
import { toast } from 'sonner'
import { MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE } from '@/lib/member-notifications'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { formatCredits } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'

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
  // 8번
  refund_kind?: string | null
  refund_subproduct_ids?: string[] | null
  claim_type?: string | null
  claim_received_at?: string | null
  reject_code?: string | null
  approved_refund_credits?: number | null
  user: { email: string | null; display_tag: string | null } | null
  item: { title: string | null } | null
  // 10번: 탈퇴 회원 행(서버가 사유·메모를 가려 보냄)
  memberWithdrawn?: boolean
}

interface MarketRefundsClientProps {
  requests: MarketRefundRequestRow[]
  isOwner: boolean
}

type RefundAction = 'approve' | 'reject'

const KIND_LABELS: Record<string, string> = { full: '전체', partial: '받지 않은 자료', exception: '예외(고객센터)' }
const REJECT_CODE_OPTIONS = [
  { value: 'TARGET_CHANGED', label: '판정 근거가 바뀜(신청 뒤 받은 자료 등)' },
  { value: 'PROVIDED_CONFIRMED', label: '그 자료를 실제로 받은 사실 확인' },
  { value: 'OTHER', label: '그 밖(요건을 갖추지 못한 신청만)' },
] as const

interface OwnerSource {
  sourceId: string
  category: string
  status: string
  expiresAt: string | null
  remainingConsumed: number
  cashRefunded: boolean
  refundOpen: boolean
  cancelInProgress: boolean
  needsOwner: boolean
}

// 접수 뒤 지난 일수(관리자 처리 기한 3영업일 안내용)
function elapsedDays(createdAt: string) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000))
}

const STATUS_LABELS: Record<string, string> = {
  pending: '대기중',
  approved: '승인',
  rejected: '거부',
  canceled: '요청 취소',
  failed: '처리 실패',
}

const ACTION_LABELS: Record<RefundAction, string> = { approve: '승인', reject: '거부' }

export function MarketRefundsClient({ requests, isOwner }: MarketRefundsClientProps) {
  const router = useRouter()
  const alerts = useAdminAlerts()
  const [processingId, setProcessingId] = useState<string | null>(null)
  // 승인·거부는 되돌릴 수 없으므로 누른 즉시 처리하지 않고 확인 창에서 한 번 더 묻는다.
  const [pending, setPending] = useState<{ request: MarketRefundRequestRow; action: RefundAction } | null>(null)
  const [adminNote, setAdminNote] = useState('')
  const [rejectCode, setRejectCode] = useState<string>('')
  const [rejectEvidence, setRejectEvidence] = useState('')
  // 대표 정산(현금 환불 이력 등 문제 원천이 걸린 주문)
  const [ownerTarget, setOwnerTarget] = useState<MarketRefundRequestRow | null>(null)
  const [ownerSources, setOwnerSources] = useState<OwnerSource[]>([])
  const [ownerInputs, setOwnerInputs] = useState<Record<string, { restored: string; reissued: string; unrecovered: string; reason: string }>>({})
  const [ownerNote, setOwnerNote] = useState('')
  // 부족분 확인(유형 나): 일반 승인 창·대표 정산 창 안에 각각 그린다.
  const { ask, dialog: confirmDialog } = useAdminConfirm()
  const { ask: askOwnerShortfall, dialog: ownerConfirmDialog } = useAdminConfirm()

  const openOwnerSettle = async (request: MarketRefundRequestRow) => {
    setProcessingId(request.id)
    try {
      const response = await fetch(`/api/admin/market/refunds/${request.id}`)
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) throw new Error(result?.error ?? '원천 정보를 불러오지 못했습니다.')
      const sources = (result.data.sources as OwnerSource[]).filter((source) => source.needsOwner)
      setOwnerSources(sources)
      // 기본값은 비워 둔다 — 대표가 원천마다 직접 정한다(회원에게 불리한 값을 기본으로 두지 않음).
      setOwnerInputs(Object.fromEntries(sources.map((source) => [source.sourceId, { restored: '', reissued: '', unrecovered: '', reason: '' }])))
      setOwnerNote('')
      setOwnerTarget(request)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '원천 정보를 불러오지 못했습니다.')
    } finally {
      setProcessingId(null)
    }
  }

  const submitOwnerSettle = async (confirmedRefundCredits?: number) => {
    if (!ownerTarget) return
    setProcessingId(ownerTarget.id)
    try {
      const response = await fetch(`/api/admin/market/refunds/${ownerTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'owner_settle',
          confirmedRefundCredits,
          adminNote: ownerNote.trim(),
          ownerItems: ownerSources.map((source) => ({
            sourceId: source.sourceId,
            restored: Number(ownerInputs[source.sourceId]?.restored || 0),
            reissued: Number(ownerInputs[source.sourceId]?.reissued || 0),
            unrecovered: Number(ownerInputs[source.sourceId]?.unrecovered || 0),
            reason: ownerInputs[source.sourceId]?.reason.trim() ?? '',
          })),
        }),
      })
      const result = await response.json().catch(() => null)
      // 규칙대로 정산할 때 돌려줄 수 없는 몫이 있으면 숫자를 보여 주고 확인받은 뒤 다시 보낸다.
      // (나) 응답 뒤 묻기: 같은 try 안에서 잠금(processingId)을 쥔 채 기다린다(finally 가 먼저 풀지 않음).
      if (response.status === 409 && result?.code === 'MARKET_REFUND_SHORTFALL' && confirmedRefundCredits === undefined) {
        const confirmed = await askOwnerShortfall({
          title: '일부만 돌려줄 수 있습니다',
          description: result.error,
          impacts: [
            { label: '요청', value: formatCredits(Number(result.requested)), emphasis: true },
            { label: '돌려줄 수 있음', value: formatCredits(Number(result.restorable)), emphasis: true },
          ],
          confirmLabel: '돌려줄 수 있는 만큼 정산',
        })
        if (confirmed) {
          setProcessingId(null)
          await submitOwnerSettle(Number(result.restorable))
        }
        return
      }
      if (!response.ok || !result?.success) {
      // 16번 6절: 판정이 바뀌어 요청이 자동 거절됐고 그 회원 알림이 실패했으면 함께 안내한다
      if (result?.notificationFailed) toast.warning(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE)
        throw new Error(result?.error ?? '대표 정산에 실패했습니다.')
      }
      toast.success(result.message)
      // 16번 6절: 처리는 끝났고 회원 알림만 실패 — 고객지원으로 직접 알리도록 안내
      if (result.notificationFailed) toast.warning(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE)
      setOwnerTarget(null)
      router.refresh()
      alerts?.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '대표 정산에 실패했습니다.')
    } finally {
      setProcessingId(null)
    }
  }

  const processRefund = async (requestId: string, action: RefundAction) => {
    setProcessingId(requestId)
    try {
      const send = async (confirmedRefundCredits?: number) => {
        const response = await fetch(`/api/admin/market/refunds/${requestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            confirmedRefundCredits,
            adminNote: adminNote.trim() || undefined,
            ...(action === 'reject' ? { rejectCode, evidence: rejectCode === 'PROVIDED_CONFIRMED' ? rejectEvidence.trim() : undefined } : {}),
          }),
        })
        return { response, result: await response.json().catch(() => null) }
      }

      let attempt = await send()
      // 되돌릴 수 없는 크레딧이 있으면 두 숫자를 보여 주고, 확인하면 복구 가능한 양으로 다시 보낸다.
      // (나) 응답 뒤 묻기: 같은 try 안에서 잠금(processingId)을 쥔 채 기다린다(finally 가 먼저 풀지 않음).
      if (attempt.response.status === 409 && attempt.result?.code === 'MARKET_REFUND_SHORTFALL') {
        const shortfall = attempt.result
        const confirmed = await ask({
          title: '일부만 돌려줄 수 있습니다',
          description: shortfall.error,
          impacts: [
            { label: '요청', value: formatCredits(Number(shortfall.requested)), emphasis: true },
            { label: '복구 가능', value: formatCredits(Number(shortfall.restorable)), emphasis: true },
          ],
          confirmLabel: '복구 가능한 만큼 환불',
        })
        if (!confirmed) return
        attempt = await send(shortfall.restorable)
      }

      const { response, result } = attempt
      if (response.status === 409 && result?.code === 'NEEDS_OWNER') {
        setPending(null)
        toast.warning(result.error)
        return
      }
      if (!response.ok || !result?.success) {
      // 16번 6절: 판정이 바뀌어 요청이 자동 거절됐고 그 회원 알림이 실패했으면 함께 안내한다
      if (result?.notificationFailed) toast.warning(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE)
        throw new Error(result?.error ?? '문제마켓 환불 처리에 실패했습니다.')
      }

      toast.success(result.message)
      if (result.auditWarning) toast.warning(result.auditWarning)
      // 16번 6절: 처리는 끝났고 회원 알림만 실패 — 고객지원으로 직접 알리도록 안내
      if (result.notificationFailed) toast.warning(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE)
      setPending(null)
      router.refresh()
      alerts?.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 환불 처리에 실패했습니다.')
    } finally {
      setProcessingId(null)
    }
  }

  const memberName = (request: MarketRefundRequestRow) =>
    request.user ? formatMemberDisplayName(request.user.email, request.user.display_tag) : '알 수 없음'

  // 날짜 표기는 지금 모양(toLocaleDateString ko-KR) 그대로(20번: 대표가 바꾸기로 정하기 전까지).
  const columns: AdminDataTableColumn<MarketRefundRequestRow>[] = [
    {
      key: 'createdAt',
      header: '요청일',
      className: 'whitespace-nowrap text-sm',
      cell: (request) => new Date(request.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }),
    },
    {
      key: 'member',
      header: '사용자',
      pii: true,
      cell: (request) => (
        <div className="flex flex-col">
          <Link href={`/admin/users/${request.user_id}`} className="text-sm font-medium hover:underline">{request.memberWithdrawn ? '탈퇴 회원' : memberName(request)}</Link>
          <span className="text-xs text-[var(--studio-muted)]">{request.memberWithdrawn ? '법정 보존' : request.user?.email ?? '-'}</span>
        </div>
      ),
    },
    {
      key: 'item',
      header: '상품',
      className: 'max-w-[220px] truncate',
      cell: (request) => <span title={request.item?.title ?? ''}>{request.item?.title ?? '-'}</span>,
    },
    { key: 'credits', header: '환불 크레딧', numeric: true, className: 'whitespace-nowrap', cell: (request) => formatCredits(request.requested_refund_credits) },
    {
      key: 'kind',
      header: '대상',
      cell: (request) => (
        <div className="flex flex-col text-xs">
          <span>{KIND_LABELS[request.refund_kind ?? 'full'] ?? request.refund_kind}</span>
          {request.refund_subproduct_ids?.length ? <span className="text-[var(--studio-muted)]">자료 {request.refund_subproduct_ids.length}개</span> : null}
          {request.status === 'pending' ? <span className="text-[var(--studio-muted)]">접수 {elapsedDays(request.created_at)}일째</span> : null}
        </div>
      ),
    },
    {
      key: 'reason',
      header: '사유',
      pii: true,
      className: 'max-w-[220px] truncate',
      cell: (request) => <span title={request.reason ?? ''}>{request.memberWithdrawn ? '가림' : request.reason ?? '-'}</span>,
    },
    {
      key: 'status',
      header: '상태',
      cell: (request) => <AdminStatusBadge label={STATUS_LABELS[request.status] ?? request.status} tone={adminStatusTone('marketRefundRequest', request.status)} />,
    },
    {
      key: 'adminNote',
      header: '처리 메모',
      pii: true,
      className: 'max-w-[200px] truncate text-xs text-[var(--studio-muted)]',
      cell: (request) => <span title={request.admin_note ?? ''}>{request.memberWithdrawn ? '가림' : request.admin_note ?? '-'}</span>,
    },
    {
      key: 'actions',
      header: '처리',
      align: 'right',
      cell: (request) => (request.status === 'pending' ? (
        <div className="flex justify-end gap-2">
          {isOwner ? (
            <Button size="sm" variant="adminTable" disabled={processingId === request.id} onClick={() => void openOwnerSettle(request)}>
              대표 정산
            </Button>
          ) : null}
          {(['approve', 'reject'] as const).map((action) => (
            <Button
              key={action}
              size="sm"
              variant="adminTable"
              className={action === 'reject' ? 'text-[var(--admin-tone-danger-text)]' : undefined}
              disabled={processingId === request.id}
              onClick={() => {
                setAdminNote('')
                setRejectCode('')
                setRejectEvidence('')
                setPending({ request, action })
              }}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      ) : (
        <span className="text-sm text-[var(--studio-muted)]">처리됨</span>
      )),
    },
  ]

  return (
    <Card className="rounded-[var(--studio-radius-card)] border-[var(--studio-border)] shadow-none">
      <CardHeader>
        <CardTitle>문제마켓 환불</CardTitle>
        <CardDescription>문제마켓 상품 환불 요청을 다운로드 이력 기준으로 검토합니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          caption="문제마켓 환불 요청 목록"
          columns={columns}
          rows={requests}
          getRowKey={(request) => request.id}
          minWidth={900}
          state={requests.length === 0 ? <AdminTableState kind="empty" message="문제마켓 환불 요청이 없습니다." /> : undefined}
        />
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && processingId === null && setPending(null)}>
        <DialogContent className="max-md:max-h-[calc(100dvh-2rem)] max-md:max-w-[calc(100vw-2rem)] max-md:overflow-y-auto">
          <DialogHeader>
            <DialogTitle>문제마켓 환불 {pending ? ACTION_LABELS[pending.action] : ''}</DialogTitle>
            <DialogDescription>
              {pending && (
                <>
                  <strong data-admin-pii="">{memberName(pending.request)}</strong>님의{' '}
                  <strong>{pending.request.item?.title ?? '상품'}</strong> 환불 요청
                  ({formatCredits(pending.request.requested_refund_credits)})
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-[var(--studio-text)]">
              {pending?.action === 'approve'
                ? '승인하면 크레딧을 회원에게 되돌려 주고, 이 상품을 더 이상 내려받을 수 없게 합니다. 되돌릴 수 없습니다.'
                : '거부하면 이 환불 요청이 닫히고 구매는 그대로 유지됩니다. 되돌릴 수 없습니다. 거부 사유는 회원에게 그대로 안내됩니다.'}
            </p>
            {pending?.action === 'reject' ? (
              <div>
                <label htmlFor="market-refund-reject-code" className="mb-2 block text-sm font-medium text-[var(--studio-ink)]">거부 사유 종류 (필수)</label>
                <select
                  id="market-refund-reject-code"
                  value={rejectCode}
                  onChange={(event) => setRejectCode(event.target.value)}
                  className="h-10 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm"
                >
                  <option value="">고르세요</option>
                  {REJECT_CODE_OPTIONS
                    // 받지 않은 자료 환불(부분·고객센터 접수)은 요건을 갖춘 신청이라 '그 밖'으로 거부할 수 없다.
                    .filter((option) => option.value !== 'OTHER' || !(pending.request.refund_kind === 'partial'
                      || (pending.request.refund_kind === 'exception' && pending.request.claim_type === 'withdrawal')))
                    .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {rejectCode === 'PROVIDED_CONFIRMED' ? (
                  <Input
                    className="mt-2"
                    value={rejectEvidence}
                    onChange={(event) => setRejectEvidence(event.target.value)}
                    maxLength={500}
                    placeholder="받은 사실의 근거(연결 문의, 또는 제공 경로·시각) — 필수"
                    data-admin-pii=""
                  />
                ) : null}
              </div>
            ) : null}
            <div>
              <label htmlFor="market-refund-admin-note" className="mb-2 block text-sm font-medium text-[var(--studio-ink)]">
                {pending?.action === 'reject' ? '거부 사유 (필수 — 회원에게 안내됩니다)' : '처리 메모 (선택)'}
              </label>
              <Textarea
                id="market-refund-admin-note"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="처리 관련 메모를 입력하세요..."
                data-admin-pii=""
              />
            </div>
          </div>

          <DialogFooter className="justify-center gap-2">
            <Button variant="brandOutline" onClick={() => setPending(null)} disabled={processingId !== null}>
              취소
            </Button>
            <Button
              variant={pending?.action === 'reject' ? 'adminDanger' : 'brand'}
              disabled={processingId !== null || (pending?.action === 'reject' && (!rejectCode || !adminNote.trim()
                || (rejectCode === 'PROVIDED_CONFIRMED' && rejectEvidence.trim().length < 5)))}
              onClick={() => pending && processRefund(pending.request.id, pending.action)}
            >
              {processingId !== null ? '처리 중...' : pending ? ACTION_LABELS[pending.action] : ''}
            </Button>
          </DialogFooter>
          {confirmDialog}
        </DialogContent>
      </Dialog>

      <Dialog open={ownerTarget !== null} onOpenChange={(open) => !open && processingId === null && setOwnerTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>대표 정산</DialogTitle>
            <DialogDescription>
              충전 환불 이력이 있거나 결제 취소가 진행 중인 크레딧 원천의 몫만 정합니다. 나머지 원천은 자동 규칙대로 돌려줍니다.
              다시 지급한 크레딧은 회수할 수 없습니다. 결제 취소가 진행 중이면 먼저 그 처리를 끝내 주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {ownerSources.length === 0 ? (
              <p className="text-sm text-[var(--studio-muted)]">
                {ownerTarget?.refund_kind === 'exception'
                  ? '대표가 정할 원천이 없습니다(대기 원인이 풀림). 정산하면 일반 규칙(복구·다시 지급)대로 돌려줍니다.'
                  : '대표가 정할 원천이 없습니다. 일반 승인으로 처리해 주세요.'}
              </p>
            ) : ownerSources.map((source) => (
              <div key={source.sourceId} className="space-y-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm">
                <p className="font-medium">원천 {source.sourceId.slice(0, 8)} · {source.category} · {source.status}
                  {source.cashRefunded ? ' · 현금 환불 이력 있음' : ''}{source.refundOpen ? ' · 충전 환불 진행 중' : ''}{source.cancelInProgress ? ' · 결제 취소 처리 중(먼저 끝내야 함)' : ''}</p>
                <p className="text-xs text-[var(--studio-muted)]">이 주문에서 남은 소비 {formatCredits(source.remainingConsumed)} — 아래 세 칸의 합이 이 값 이하</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['restored', 'reissued', 'unrecovered'] as const).map((key) => (
                    <label key={key} className="text-xs text-[var(--studio-text)]">
                      {key === 'restored' ? '원천에 되돌림' : key === 'reissued' ? '새로 지급' : '지급 안 함'}
                      <Input
                        type="number"
                        min={0}
                        value={ownerInputs[source.sourceId]?.[key] ?? ''}
                        onChange={(event) => setOwnerInputs((current) => ({ ...current, [source.sourceId]: { ...current[source.sourceId], [key]: event.target.value } }))}
                      />
                    </label>
                  ))}
                </div>
                <Input
                  placeholder="이 원천의 판단 근거(필수)"
                  data-admin-pii=""
                  value={ownerInputs[source.sourceId]?.reason ?? ''}
                  onChange={(event) => setOwnerInputs((current) => ({ ...current, [source.sourceId]: { ...current[source.sourceId], reason: event.target.value } }))}
                />
              </div>
            ))}
            <Textarea value={ownerNote} onChange={(event) => setOwnerNote(event.target.value)} rows={2} maxLength={1000} placeholder="정산 메모(필수)" aria-label="정산 메모" data-admin-pii="" />
          </div>
          <DialogFooter className="justify-center gap-2">
            <Button variant="brandOutline" onClick={() => setOwnerTarget(null)} disabled={processingId !== null}>취소</Button>
            <Button
              variant="brand"
              disabled={processingId !== null || !ownerNote.trim()
                || (ownerSources.length === 0 && ownerTarget?.refund_kind !== 'exception')
                || ownerSources.some((source) => {
                  const input = ownerInputs[source.sourceId]
                  return !input?.reason.trim() || input.restored === '' || input.reissued === '' || input.unrecovered === ''
                })}
              onClick={() => void submitOwnerSettle(undefined)}
            >
              {processingId !== null ? '처리 중...' : '정산하고 환불 승인'}
            </Button>
          </DialogFooter>
          {ownerConfirmDialog}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
