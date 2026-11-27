'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE } from '@/lib/member-notifications'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_TONE_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { formatCount, formatCredits } from '@/lib/admin-format'
import type { MarketOrderRefundContext } from '@/lib/market-refunds'

interface MarketExceptionRefundDialogProps {
  orderId: string | null
  onClose: () => void
  onDone: () => void
}

type ClaimType = 'defect' | 'withdrawal'
type ClaimChannel = 'ticket' | 'email' | 'phone'

const SELECT_CLASS = 'w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 py-2'

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

// 관리자 예외 환불(8번). 판정·금액·한도·대표 전용 경로는 DB 함수가 잠금 아래에서 다시 한다 — 화면은 보여 주고 미리보기만.
export function MarketExceptionRefundDialog({ orderId, onClose, onDone }: MarketExceptionRefundDialogProps) {
  const [context, setContext] = useState<(MarketOrderRefundContext & { isOwner: boolean; reasonGuide?: string | null }) | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [claimType, setClaimType] = useState<ClaimType>('defect')
  const [claimChannel, setClaimChannel] = useState<ClaimChannel>('ticket')
  const [ticketId, setTicketId] = useState('')
  // 기준 판: '' = 아직 안 고름, 'current' = 지금 판, 그 밖 = 고치기 전 판 id
  const [revisionId, setRevisionId] = useState('')
  // 고른 판 본문에 이 주문의 환불 의사가 담겨 있음을 관리자가 확인
  const [intentConfirmed, setIntentConfirmed] = useState(false)
  const [subproductIds, setSubproductIds] = useState<string[]>([])
  const [claimReceivedAt, setClaimReceivedAt] = useState(toLocalInputValue(new Date()))
  const [reason, setReason] = useState('')
  // 이메일·전화 접수 증빙
  const [evidence, setEvidence] = useState('')
  const [preview, setPreview] = useState<{ amount: number; committed: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 부족분 확인(20번 5-3 유형 나): 첫 요청이 409 로 돌아온 뒤 묻는다.
  const { ask, dialog: confirmDialog } = useAdminConfirm()

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    setContext(null)
    setLoadError(null)
    setPreview(null)
    setReason('')
    setEvidence('')
    setSubproductIds([])
    setTicketId('')
    setRevisionId('')
    setIntentConfirmed(false)
    fetch(`/api/admin/market/orders/${orderId}/exception-refund`)
      .then((response) => response.json().then((result) => ({ response, result })))
      .then(({ response, result }) => {
        if (cancelled) return
        if (!response.ok || !result?.success) {
          setLoadError(result?.error ?? '주문 정보를 불러오지 못했습니다.')
          return
        }
        setContext(result.data)
      })
      .catch(() => !cancelled && setLoadError('주문 정보를 불러오지 못했습니다.'))
    return () => { cancelled = true }
  }, [orderId])

  const isBundle = context?.order.purchaseType === 'bundle'
  const selectedTicket = context?.tickets.find((ticket) => ticket.id === ticketId) ?? null
  const needsClaimTime = claimType === 'defect' || claimChannel !== 'ticket'
  const isTicketWithdrawal = claimType === 'withdrawal' && claimChannel === 'ticket'
  const needsEvidence = claimType === 'withdrawal' && (claimChannel === 'email' || claimChannel === 'phone')
  const selectedRevision = selectedTicket && revisionId && revisionId !== 'current'
    ? selectedTicket.revisions.find((revision) => revision.id === revisionId) ?? null
    : null
  const selectedBody = !selectedTicket || !revisionId ? null
    : revisionId === 'current'
      ? { subject: selectedTicket.subject, message: selectedTicket.message, writtenAt: selectedTicket.memberUpdatedAt ?? selectedTicket.createdAt }
      : selectedRevision ? { subject: selectedRevision.subject ?? '-', message: selectedRevision.message ?? '', writtenAt: selectedRevision.writtenAt } : null
  // 1:1 문의 접수는 판을 직접 고르고 본문의 환불 의사를 확인해야 처리할 수 있다.
  const ticketReady = !isTicketWithdrawal || (Boolean(ticketId) && Boolean(selectedBody) && intentConfirmed)

  const buildBody = (expectedCredits: number, extra: Record<string, unknown> = {}) => ({
    claimType,
    claimChannel: claimType === 'withdrawal' ? claimChannel : null,
    subproductIds: isBundle && claimType === 'defect' ? subproductIds : null,
    expectedCredits,
    expectedCommitted: context?.order.committedCredits ?? 0,
    reason: reason.trim() || '미리보기',
    supportTicketId: (claimType === 'withdrawal' && claimChannel === 'ticket') || ticketId ? ticketId || null : null,
    ticketRevisionId: isTicketWithdrawal && revisionId && revisionId !== 'current' ? revisionId : null,
    claimReceivedAt: needsClaimTime ? new Date(claimReceivedAt).toISOString() : null,
    ...(needsEvidence ? { evidence: evidence.trim() } : {}),
    ...extra,
  })

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/admin/market/orders/${orderId}/exception-refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { response, result: await response.json().catch(() => null) }
  }

  const loadPreview = async () => {
    if (!context) return
    setSubmitting(true)
    try {
      const { response, result } = await post(buildBody(-1, { preview: true }))
      if (!response.ok || !result?.success) throw new Error(result?.error ?? '금액을 계산하지 못했습니다.')
      setPreview({ amount: Number(result.preview?.amount ?? 0), committed: Number(result.preview?.committed ?? context.order.committedCredits) })
    } catch (error) {
      setPreview(null)
      toast.error(error instanceof Error ? error.message : '금액을 계산하지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async () => {
    if (!context || !preview) return
    setSubmitting(true)
    try {
      let attempt = await post(buildBody(preview.amount))
      // 일부를 돌려줄 수 없으면 숫자를 보여 주고 확인받은 뒤 다시 보낸다.
      if (attempt.response.status === 409 && attempt.result?.code === 'MARKET_REFUND_SHORTFALL') {
        // 잠금(submitting)을 쥔 채 같은 try 안에서 기다린다 — 창이 열린 동안 실행 버튼은 잠겨 있다.
        const confirmed = await ask({
          title: '일부만 돌려줄 수 있습니다',
          description: attempt.result.error,
          impacts: [
            { label: '요청', value: formatCredits(Number(attempt.result.requested)), emphasis: true },
            { label: '돌려줄 수 있음', value: formatCredits(Number(attempt.result.restorable)), emphasis: true },
          ],
          confirmLabel: '돌려줄 수 있는 만큼 환불',
        })
        if (!confirmed) return
        attempt = await post(buildBody(preview.amount, { confirmedRefundCredits: attempt.result.restorable }))
      }
      const { response, result } = attempt
      if (!response.ok || !result?.success) {
        if (result?.code === 'AMOUNT_CHANGED') setPreview(null)
        throw new Error(result?.error ?? '예외 환불 처리에 실패했습니다.')
      }
      toast.success(result.message)
      // 16번 6절: 처리는 끝났고 회원 알림만 실패 — 고객지원으로 직접 알리도록 안내
      if (result.notificationFailed) toast.warning(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE)
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '예외 환불 처리에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={orderId !== null} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>예외 환불</DialogTitle>
          <DialogDescription>
            하자·소개와 다른 자료, 또는 고객센터(1:1 문의·이메일·전화)로 접수된 받지 않은 자료 환불을 처리합니다. 처리하면 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        {loadError ? <AdminNotice kind="error">{loadError}</AdminNotice> : null}
        {!context && !loadError ? <AdminTableState kind="loading" message="불러오는 중…" /> : null}
        {context?.memberWithdrawn && orderId ? (
          <WithdrawnCashRefundForm context={context} orderId={orderId} onClose={onClose} onDone={onDone} />
        ) : null}
        {context && !context.memberWithdrawn ? (
          <div className="space-y-4 text-sm">
            <p>
              <strong>{context.order.itemTitle}</strong> · 낸 크레딧 {formatCount(context.order.chargedCredits)} · 환불된 누계 {formatCount(context.order.committedCredits)}
              {context.hasPendingRequest ? ' · 처리 대기 중인 환불 요청이 있습니다(먼저 처리)' : ''}
            </p>

            <fieldset className="space-y-1">
              <legend className="font-medium text-[var(--studio-ink)]">사유 종류</legend>
              <label className="mr-4"><input type="radio" checked={claimType === 'defect'} onChange={() => { setClaimType('defect'); setPreview(null) }} /> 하자·소개와 다름</label>
              <label><input type="radio" checked={claimType === 'withdrawal'} onChange={() => { setClaimType('withdrawal'); setPreview(null) }} /> 받지 않은 자료 환불(고객센터 접수)</label>
            </fieldset>

            {claimType === 'withdrawal' ? (
              <fieldset className="space-y-1">
                <legend className="font-medium text-[var(--studio-ink)]">접수 경로</legend>
                <label className="mr-4"><input type="radio" checked={claimChannel === 'ticket'} onChange={() => { setClaimChannel('ticket'); setPreview(null) }} /> 1:1 문의</label>
                <label className="mr-4"><input type="radio" disabled={!context.isOwner} checked={claimChannel === 'email'} onChange={() => { setClaimChannel('email'); setPreview(null) }} /> 이메일(대표만)</label>
                <label><input type="radio" disabled={!context.isOwner} checked={claimChannel === 'phone'} onChange={() => { setClaimChannel('phone'); setPreview(null) }} /> 전화(대표만)</label>
              </fieldset>
            ) : null}

            {(claimType === 'withdrawal' && claimChannel === 'ticket') || claimType === 'defect' ? (
              <div className="space-y-2">
                <label className="block font-medium text-[var(--studio-ink)]" htmlFor="exception-ticket">
                  1:1 문의 {claimType === 'withdrawal' ? '(필수 — 기간은 이 문의를 쓴 시각으로 판단)' : '(선택)'}
                </label>
                <select id="exception-ticket" className={SELECT_CLASS} value={ticketId}
                  onChange={(event) => { setTicketId(event.target.value); setRevisionId(''); setIntentConfirmed(false); setPreview(null) }}>
                  <option value="">{claimType === 'withdrawal' ? '문의를 고르세요' : '연결 안 함'}</option>
                  {context.tickets.map((ticket) => (
                    <option key={ticket.id} value={ticket.id}>{ticket.subject} · {new Date(ticket.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</option>
                  ))}
                </select>
                {isTicketWithdrawal && selectedTicket ? (
                  <select aria-label="기준 판" className={SELECT_CLASS} value={revisionId}
                    onChange={(event) => { setRevisionId(event.target.value); setIntentConfirmed(false); setPreview(null) }}>
                    <option value="">환불 의사가 처음 담긴 판을 고르세요</option>
                    {selectedTicket.revisions.map((revision) => (
                      <option key={revision.id} value={revision.id}>고치기 전 판: {revision.subject ?? '-'} · {new Date(revision.writtenAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</option>
                    ))}
                    <option value="current">지금 판: {selectedTicket.subject} · {new Date(selectedTicket.memberUpdatedAt ?? selectedTicket.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</option>
                  </select>
                ) : null}
                {isTicketWithdrawal && selectedBody ? (
                  <div data-admin-pii="" className="space-y-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-background)] p-3">
                    <p className="text-xs text-[var(--studio-muted)]">고른 판 · {new Date(selectedBody.writtenAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (이 시각으로 기간을 판단)</p>
                    <p className="font-medium">{selectedBody.subject}</p>
                    <p className="max-h-40 overflow-y-auto whitespace-pre-line break-all">{selectedBody.message || '(본문 없음)'}</p>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={intentConfirmed}
                        onChange={(event) => { setIntentConfirmed(event.target.checked); setPreview(null) }} />
                      <span>이 판에 이 주문의 환불 의사가 담겨 있음을 확인했습니다. 이보다 앞선 판에는 환불 의사가 없었습니다.</span>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}

            {needsClaimTime ? (
              <label className="block">
                <span className="font-medium text-[var(--studio-ink)]">{claimType === 'defect' ? '하자 주장 접수 시각' : '접수 시각(이메일 수신·통화 시각)'}</span>
                <Input type="datetime-local" value={claimReceivedAt} onChange={(event) => { setClaimReceivedAt(event.target.value); setPreview(null) }} />
              </label>
            ) : null}

            {isBundle && claimType === 'defect' ? (
              <fieldset className="space-y-1">
                <legend className="font-medium text-[var(--studio-ink)]">환불할 자료</legend>
                {context.composition.map((component) => (
                  <label key={component.subproductId} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={component.refunded}
                      checked={subproductIds.includes(component.subproductId)}
                      onChange={(event) => {
                        setPreview(null)
                        setSubproductIds((current) => event.target.checked
                          ? [...current, component.subproductId]
                          : current.filter((id) => id !== component.subproductId))
                      }}
                    />
                    {component.title} · 정가 {formatCount(component.listPriceCredits)}
                    {component.downloaded ? ' · 받음' : ''}{component.refunded ? ' · 이미 환불됨' : ''}
                  </label>
                ))}
                <p className="text-xs text-[var(--studio-muted)]">
                  &apos;받음&apos;은 파일 분류 기준 표시입니다. 문제(HWP)를 받으면 문제(PDF)도 받은 것으로 보는 규칙은 &apos;금액 확인&apos;에서 DB 가 판정합니다.
                </p>
              </fieldset>
            ) : null}

            {needsEvidence ? (
              <label className="block">
                <span className="font-medium text-[var(--studio-ink)]">접수 증빙(필수 — 발신 주소·수신 시각, 또는 통화 번호·시각)</span>
                <Input data-admin-pii="" value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={500} />
              </label>
            ) : null}

            <label className="block">
              <span className="font-medium text-[var(--studio-ink)]">사유(필수 — 작업 기록에 남음)</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} />
            </label>

            {preview ? (
              <p className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-3 py-2">환불 금액 <strong className="tabular-nums">{formatCredits(preview.amount)}</strong></p>
            ) : null}
          </div>
        ) : null}

        {context?.memberWithdrawn ? null : (
        <DialogFooter className="justify-center gap-2">
          <Button variant="brandOutline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button variant="brandOutline" onClick={() => void loadPreview()} disabled={submitting || !context || !ticketReady}>금액 확인</Button>
          <Button variant="brand" onClick={() => void submit()} disabled={submitting || !context || !preview || !reason.trim() || !ticketReady
            || (needsEvidence && evidence.trim().length < 5)}>
            {submitting ? '처리 중...' : '예외 환불 처리'}
          </Button>
        </DialogFooter>
        )}
        {confirmDialog}
      </DialogContent>
    </Dialog>
  )
}

type CashRefundMethod = 'original_method' | 'bank_transfer'

// 10번(계획 6-4): 탈퇴(익명화)한 회원에게는 크레딧으로 환불할 수 없다(DB 가 MEMBER_WITHDRAWN 으로 거절).
// 법정 환불(하자 등)은 대표가 원래 결제수단이나 계좌로 정산하고, 보관함 추가 기록(market_cash_refund)으로 남긴다. 주문 상태는 바꾸지 않는다.
function WithdrawnCashRefundForm({ context, orderId, onClose, onDone }: {
  context: MarketOrderRefundContext & { isOwner: boolean; reasonGuide?: string | null }
  orderId: string
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<CashRefundMethod>('original_method')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 정산 식별값: 이 창에서 남기는 정산 한 건. 같은 정산을 두 번 눌러도 한 건만 남고, 같은 주문의 다른 정산은 새 창에서 새 값으로 남는다.
  const [settlementKey] = useState(() => crypto.randomUUID())
  const amountValue = Number(amount)
  const ready = Number.isInteger(amountValue) && amountValue > 0 && note.trim().length > 0

  const submit = async () => {
    if (!ready) return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/admin/users/${context.order.userId}/withdrawal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_event',
          kind: 'market_cash_refund',
          refId: orderId,
          details: { settlementKey, amount_won: amountValue, method, note: note.trim(), item_title: context.order.itemTitle },
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) throw new Error(result?.error ?? '현금 정산 기록에 실패했습니다.')
      toast.success(result.recorded ? '현금 정산을 기록했습니다.' : '이 정산은 이미 기록되어 있습니다.')
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '현금 정산 기록에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-4 text-sm">
        <p>
          <strong>{context.order.itemTitle}</strong> · 낸 크레딧 {formatCount(context.order.chargedCredits)} · 환불된 누계 {formatCount(context.order.committedCredits)}
        </p>
        <p role="note" className={`rounded-[var(--studio-radius-control)] border px-3 py-2 ${ADMIN_TONE_CLASSES.warning}`}>
          탈퇴 회원 주문입니다. 크레딧으로 환불할 수 없습니다. 하자 등 법에 따른 환불은 대표가 원래 결제수단이나 계좌로 정산한 뒤 여기에 기록합니다(주문 상태는 바뀌지 않습니다).
        </p>
        {context.isOwner ? (
          <>
            <label className="block">
              <span className="font-medium text-[var(--studio-ink)]">정산 금액(원)</span>
              <Input type="number" min={1} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <fieldset className="space-y-1">
              <legend className="font-medium text-[var(--studio-ink)]">정산 방법</legend>
              <label className="mr-4"><input type="radio" checked={method === 'original_method'} onChange={() => setMethod('original_method')} /> 원래 결제수단 취소</label>
              <label><input type="radio" checked={method === 'bank_transfer'} onChange={() => setMethod('bank_transfer')} /> 계좌 송금</label>
            </fieldset>
            <label className="block">
              <span className="font-medium text-[var(--studio-ink)]">메모(필수 — 보관함 추가 기록에 남음)</span>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} />
              {context.reasonGuide ? <span className="mt-1 block text-xs text-[var(--studio-muted)]">{context.reasonGuide}</span> : null}
            </label>
          </>
        ) : (
          <p className="text-[var(--studio-text)]">현금 정산 기록은 대표 계정만 남길 수 있습니다.</p>
        )}
      </div>
      <DialogFooter className="justify-center gap-2">
        <Button variant="brandOutline" onClick={onClose} disabled={submitting}>닫기</Button>
        {context.isOwner ? (
          <Button variant="brand" onClick={() => void submit()} disabled={submitting || !ready}>
            {submitting ? '기록 중...' : '탈퇴 회원 — 현금 정산 기록'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}
