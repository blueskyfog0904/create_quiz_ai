'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { MarketOrderRefundContext } from '@/lib/market-refunds'

interface MarketExceptionRefundDialogProps {
  orderId: string | null
  onClose: () => void
  onDone: () => void
}

type ClaimType = 'defect' | 'withdrawal'
type ClaimChannel = 'ticket' | 'email' | 'phone'

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

// 관리자 예외 환불(8번). 판정·금액·한도·대표 전용 경로는 DB 함수가 잠금 아래에서 다시 한다 — 화면은 보여 주고 미리보기만.
export function MarketExceptionRefundDialog({ orderId, onClose, onDone }: MarketExceptionRefundDialogProps) {
  const [context, setContext] = useState<(MarketOrderRefundContext & { isOwner: boolean }) | null>(null)
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
        const confirmed = window.confirm(`${attempt.result.error}\n\n요청 ${Number(attempt.result.requested).toLocaleString()}C / 돌려줄 수 있음 ${Number(attempt.result.restorable).toLocaleString()}C`)
        if (!confirmed) return
        attempt = await post(buildBody(preview.amount, { confirmedRefundCredits: attempt.result.restorable }))
      }
      const { response, result } = attempt
      if (!response.ok || !result?.success) {
        if (result?.code === 'AMOUNT_CHANGED') setPreview(null)
        throw new Error(result?.error ?? '예외 환불 처리에 실패했습니다.')
      }
      toast.success(result.message)
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

        {loadError ? <p role="alert" className="text-sm text-red-700">{loadError}</p> : null}
        {!context && !loadError ? <p className="text-sm text-gray-500">불러오는 중…</p> : null}
        {context ? (
          <div className="space-y-4 text-sm">
            <p>
              <strong>{context.order.itemTitle}</strong> · 낸 크레딧 {context.order.chargedCredits.toLocaleString()} · 환불된 누계 {context.order.committedCredits.toLocaleString()}
              {context.hasPendingRequest ? ' · 처리 대기 중인 환불 요청이 있습니다(먼저 처리)' : ''}
            </p>

            <fieldset className="space-y-1">
              <legend className="font-medium">사유 종류</legend>
              <label className="mr-4"><input type="radio" checked={claimType === 'defect'} onChange={() => { setClaimType('defect'); setPreview(null) }} /> 하자·소개와 다름</label>
              <label><input type="radio" checked={claimType === 'withdrawal'} onChange={() => { setClaimType('withdrawal'); setPreview(null) }} /> 받지 않은 자료 환불(고객센터 접수)</label>
            </fieldset>

            {claimType === 'withdrawal' ? (
              <fieldset className="space-y-1">
                <legend className="font-medium">접수 경로</legend>
                <label className="mr-4"><input type="radio" checked={claimChannel === 'ticket'} onChange={() => { setClaimChannel('ticket'); setPreview(null) }} /> 1:1 문의</label>
                <label className="mr-4"><input type="radio" disabled={!context.isOwner} checked={claimChannel === 'email'} onChange={() => { setClaimChannel('email'); setPreview(null) }} /> 이메일(대표만)</label>
                <label><input type="radio" disabled={!context.isOwner} checked={claimChannel === 'phone'} onChange={() => { setClaimChannel('phone'); setPreview(null) }} /> 전화(대표만)</label>
              </fieldset>
            ) : null}

            {(claimType === 'withdrawal' && claimChannel === 'ticket') || claimType === 'defect' ? (
              <div className="space-y-2">
                <label className="block font-medium" htmlFor="exception-ticket">
                  1:1 문의 {claimType === 'withdrawal' ? '(필수 — 기간은 이 문의를 쓴 시각으로 판단)' : '(선택)'}
                </label>
                <select id="exception-ticket" className="w-full rounded-md border px-3 py-2" value={ticketId}
                  onChange={(event) => { setTicketId(event.target.value); setRevisionId(''); setIntentConfirmed(false); setPreview(null) }}>
                  <option value="">{claimType === 'withdrawal' ? '문의를 고르세요' : '연결 안 함'}</option>
                  {context.tickets.map((ticket) => (
                    <option key={ticket.id} value={ticket.id}>{ticket.subject} · {new Date(ticket.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</option>
                  ))}
                </select>
                {isTicketWithdrawal && selectedTicket ? (
                  <select aria-label="기준 판" className="w-full rounded-md border px-3 py-2" value={revisionId}
                    onChange={(event) => { setRevisionId(event.target.value); setIntentConfirmed(false); setPreview(null) }}>
                    <option value="">환불 의사가 처음 담긴 판을 고르세요</option>
                    {selectedTicket.revisions.map((revision) => (
                      <option key={revision.id} value={revision.id}>고치기 전 판: {revision.subject ?? '-'} · {new Date(revision.writtenAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</option>
                    ))}
                    <option value="current">지금 판: {selectedTicket.subject} · {new Date(selectedTicket.memberUpdatedAt ?? selectedTicket.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</option>
                  </select>
                ) : null}
                {isTicketWithdrawal && selectedBody ? (
                  <div className="space-y-2 rounded-md border bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">고른 판 · {new Date(selectedBody.writtenAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (이 시각으로 기간을 판단)</p>
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
                <span className="font-medium">{claimType === 'defect' ? '하자 주장 접수 시각' : '접수 시각(이메일 수신·통화 시각)'}</span>
                <Input type="datetime-local" value={claimReceivedAt} onChange={(event) => { setClaimReceivedAt(event.target.value); setPreview(null) }} />
              </label>
            ) : null}

            {isBundle && claimType === 'defect' ? (
              <fieldset className="space-y-1">
                <legend className="font-medium">환불할 자료</legend>
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
                    {component.title} · 정가 {component.listPriceCredits.toLocaleString()}
                    {component.downloaded ? ' · 받음' : ''}{component.refunded ? ' · 이미 환불됨' : ''}
                  </label>
                ))}
                <p className="text-xs text-gray-500">
                  &apos;받음&apos;은 파일 분류 기준 표시입니다. 문제(HWP)를 받으면 문제(PDF)도 받은 것으로 보는 규칙은 &apos;금액 확인&apos;에서 DB 가 판정합니다.
                </p>
              </fieldset>
            ) : null}

            {needsEvidence ? (
              <label className="block">
                <span className="font-medium">접수 증빙(필수 — 발신 주소·수신 시각, 또는 통화 번호·시각)</span>
                <Input value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={500} />
              </label>
            ) : null}

            <label className="block">
              <span className="font-medium">사유(필수 — 작업 기록에 남음)</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} />
            </label>

            {preview ? (
              <p className="rounded-md bg-gray-50 px-3 py-2">환불 금액 <strong>{preview.amount.toLocaleString()} 크레딧</strong></p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="justify-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button variant="outline" onClick={() => void loadPreview()} disabled={submitting || !context || !ticketReady}>금액 확인</Button>
          <Button onClick={() => void submit()} disabled={submitting || !context || !preview || !reason.trim() || !ticketReady
            || (needsEvidence && evidence.trim().length < 5)}>
            {submitting ? '처리 중...' : '예외 환불 처리'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
