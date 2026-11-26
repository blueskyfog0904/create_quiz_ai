'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatKstDateTime } from '@/lib/kst-date-format'
import { ownerChannelRequestReasons, type MemberWithdrawalPreview, type WithdrawalRedactionItem } from '@/lib/member-withdrawal'

// 회원 상세의 대표 전용 '회원 탈퇴' 구역(계획 6-4). 판정·처리는 모두 DB 함수가 하고, 이 화면은 값과 확인 체크를 넘긴다.
// 문구 중 정책 문구(본인 확인 메모·사유 안내, 안내 메일 틀)는 DB 값이다. 항목 이름표는 화면 라벨이다.

export interface MemberWithdrawalPanelData {
  preview: MemberWithdrawalPreview
  accountStatus: { authPending: boolean; kakaoPending: boolean } | null
  heldOrders: {
    id: string
    order_id: string
    status: string
    failure_code: string | null
    expected_amount: number
    created_at: string
    alertOpen: boolean
  }[]
  texts: {
    identityNoteGuide: string | null
    reasonGuide: string | null
    ownerMailBlocked: string | null
    ownerMailCompleted: string | null
    objectionGuide: string | null
  }
}

const REASON_LABELS: Record<string, string> = {
  ADMIN: '관리자 계정',
  WITHDRAWN: '이미 탈퇴함',
  DISABLED: '스스로 탈퇴 꺼짐(설정)',
  PAYER: '결제 회원',
  NOT_PAYER: '결제 이력 없음',
  IN_PROGRESS: '진행 중 결제·환불',
  REFUND_PERIOD_OPEN: '환불 기간 남은 충전',
  PROVIDER_UNVERIFIED: '페이앱 요청 미확인',
  REDACTION_REQUIRED: '가림 확인 필요',
  RECENT_PAYMENT_ACTIVITY: '최근 결제 시도',
  REQUEST_PENDING: '요청 접수됨',
  CASH_VALUE_UNKNOWN: '원 환산 확인 필요(이메일·전화 요청으로)',
}
const PAID_REASON_LABELS: Record<string, string> = {
  MONEY_ORDER: '돈이 오간 주문',
  PAYMENT_HISTORY: '결제 내역',
  PLAN_PURCHASE_SOURCE: '요금제 구매 크레딧',
  FEEDBACK_VERIFICATION_FAILED: '검증 실패 결제 통보',
  PAYMENT_ADMIN_ACTION: '결제 조치 기록',
}
const IN_PROGRESS_LABELS: Record<string, string> = {
  orders: '진행 중 주문',
  attempts: '결제 시도',
  cancelMarkers: '처리 안 된 취소 표식',
  webhookEvents: '처리 안 된 통보',
  pointRefunds: '충전 환불',
  marketRefunds: '자료 환불',
  pendingSources: '환불 대기 크레딧',
  alerts: '풀리지 않은 결제 경보',
  generationJobs: '생성 작업',
}
const TARGET_KIND_LABELS: Record<WithdrawalRedactionItem['kind'], string> = {
  support_ticket: '문의',
  support_ticket_revision: '문의 수정 이력',
  support_ticket_answer_revision: '답변 수정 이력',
  refund_request: '충전 환불',
  market_refund_request: '자료 환불',
}
const TARGET_FIELDS: Record<WithdrawalRedactionItem['kind'], [string, string][]> = {
  support_ticket: [['subject', '제목'], ['message', '본문'], ['admin_response', '답변']],
  support_ticket_revision: [['subject', '제목'], ['message', '본문']],
  support_ticket_answer_revision: [['previous_response', '이전 답변'], ['reason', '수정 사유']],
  refund_request: [['reason', '사유'], ['admin_note', '메모']],
  market_refund_request: [['reason', '사유'], ['admin_note', '메모']],
}
const REDACTION_REASON_LABELS: Record<string, string> = {
  REFUND_RELATED: '환불 관련',
  AFTER_ACCOUNT_REQUEST: '계좌 요청 답변 뒤',
  LONG_NUMBER: '긴 번호(계좌·전화 등)',
}
const CHANNEL_LABELS: Record<string, string> = { screen: '탈퇴 화면', email: '이메일', phone: '전화' }
const REQUESTER_LABELS: Record<string, string> = { self: '본인', legal_guardian: '법정대리인', agent: '위임 대리인' }
const CLOSE_METHOD_LABELS: Record<string, string> = {
  bank_transfer: '계좌 송금으로 돌려줌',
  payapp_cancel_request: '페이앱 취소 요청(통보 처리 뒤)',
  provider_admin_cancel: '페이앱 판매자 화면 취소(통보 처리 뒤)',
}

const fmt = (value: string | null | undefined) => (value ? formatKstDateTime(value) : '-')
const num = (value: number | null | undefined) => (value ?? 0).toLocaleString()
const toIso = (local: string) => (local ? new Date(local).toISOString() : null)

async function callApi(userId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/admin/users/${userId}/withdrawal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success !== true) throw new Error(data.error || '처리하지 못했습니다.')
  return data
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </div>
  )
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm max-md:grid-cols-[7rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="min-w-0 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function useAction(userId: string) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const run = async (body: Record<string, unknown>, success?: string) => {
    setPending(true)
    try {
      const data = await callApi(userId, body)
      if (success) toast.success(success)
      router.refresh()
      return data
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '처리하지 못했습니다.')
      return null
    } finally {
      setPending(false)
    }
  }
  return { pending, run }
}

function RedactionRow({ userId, item }: { userId: string; item: WithdrawalRedactionItem }) {
  const { pending, run } = useAction(userId)
  // 모르는 종류(DB 가 먼저 바뀐 경우)도 죽지 않게: 칸 목록이 없으면 [확인함]만 보인다(13번 5-1).
  const fields: [string, string][] = TARGET_FIELDS[item.kind] ?? []
  const [field, setField] = useState(fields[0]?.[0] ?? '')
  const [text, setText] = useState('')
  return (
    <li className="space-y-2 py-2">
      <p>
        <span className="font-medium">{TARGET_KIND_LABELS[item.kind] ?? item.kind}</span>
        {item.preview && <span className="ml-2 text-gray-600">{item.preview}</span>}
        <span className="ml-2 text-xs text-gray-500">{item.reasons.map((reason) => REDACTION_REASON_LABELS[reason] ?? reason).join(' · ')}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {fields.length > 0 && (
          <>
            <select value={field} onChange={(event) => setField(event.target.value)} className="h-9 rounded-md border px-2 text-sm" aria-label="가릴 칸">
              {fields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="가릴 문구(원문 그대로)" className="h-9 max-w-xs" />
            <Button size="sm" variant="outline" disabled={pending || !text.trim()}
              onClick={() => void run({ action: 'redact', targetKind: item.kind, targetId: item.id, field, targetText: text, operationKey: crypto.randomUUID() }, '가렸습니다.')}>
              가림
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" disabled={pending}
          onClick={() => void run({ action: 'mark_reviewed', targetKind: item.kind, targetId: item.id }, '가릴 것이 없다고 기록했습니다.')}>
          확인함
        </Button>
      </div>
    </li>
  )
}

function RequestForm({ userId, preview, texts }: { userId: string; preview: MemberWithdrawalPreview; texts: MemberWithdrawalPanelData['texts'] }) {
  const { pending, run } = useAction(userId)
  const [channel, setChannel] = useState<'email' | 'phone'>('email')
  const [requesterKind, setRequesterKind] = useState<'self' | 'legal_guardian' | 'agent'>('self')
  const [receivedAt, setReceivedAt] = useState('')
  const [identityNote, setIdentityNote] = useState('')
  const [retention, setRetention] = useState<'agree' | 'disagree' | 'none'>('none')
  const [notice, setNotice] = useState<{ text: string; sha256: string; expectedForfeitPaid: number } | null>(null)
  const [noticeSentAt, setNoticeSentAt] = useState('')
  const [replyAt, setReplyAt] = useState('')
  const retentionValue = preview.hadPayment || preview.ticketCount === 0 ? null : retention === 'none' ? null : retention === 'agree'

  const makeNotice = async () => {
    const data = await run({ action: 'notice', ticketRetentionAgreed: retentionValue })
    if (data?.notice) setNotice(data.notice)
  }

  return (
    <Block title="이메일·전화 탈퇴 요청 기록">
      <div className="grid gap-2 sm:grid-cols-2">
        <Label className="grid gap-1">접수 경로
          <select value={channel} onChange={(event) => setChannel(event.target.value as 'email' | 'phone')} className="h-9 rounded-md border px-2">
            <option value="email">이메일</option>
            <option value="phone">전화</option>
          </select>
        </Label>
        <Label className="grid gap-1">요청자
          <select value={requesterKind} onChange={(event) => setRequesterKind(event.target.value as typeof requesterKind)} className="h-9 rounded-md border px-2">
            {Object.entries(REQUESTER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Label>
        <Label className="grid gap-1">접수 시각
          <Input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
        </Label>
        {!preview.hadPayment && preview.ticketCount > 0 && (
          <Label className="grid gap-1">문의 보존 회신
            <select value={retention} onChange={(event) => { setRetention(event.target.value as typeof retention); setNotice(null) }} className="h-9 rounded-md border px-2">
              <option value="none">회신 없음(삭제)</option>
              <option value="agree">보존에 동의</option>
              <option value="disagree">동의하지 않음(삭제)</option>
            </select>
          </Label>
        )}
      </div>
      <Label className="grid gap-1">본인 확인 메모
        <Textarea value={identityNote} onChange={(event) => setIdentityNote(event.target.value)} maxLength={500} rows={2} />
      </Label>
      {texts.identityNoteGuide && <p className="text-xs text-gray-500">{texts.identityNoteGuide}</p>}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void makeNotice()}>고지 원문 만들기</Button>
      {notice && (
        <div className="space-y-2">
          <Textarea readOnly value={notice.text} rows={8} className="font-mono text-xs" />
          <p className="text-xs text-gray-500">지문 {notice.sha256.slice(0, 12)} · 이 원문을 회원(또는 대리인) 이메일로 보내고, 유료 소멸분({num(notice.expectedForfeitPaid)} 크레딧)이 있으면 회신을 받은 뒤 처리합니다.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Label className="grid gap-1">고지 보낸 시각(보냈으면)
              <Input type="datetime-local" value={noticeSentAt} onChange={(event) => setNoticeSentAt(event.target.value)} />
            </Label>
            <Label className="grid gap-1">동의 회신 받은 시각(받았으면)
              <Input type="datetime-local" value={replyAt} onChange={(event) => setReplyAt(event.target.value)} />
            </Label>
          </div>
          <Button size="sm" disabled={pending || !receivedAt}
            onClick={() => void run({
              action: 'record_request',
              channel,
              requesterKind,
              receivedAt: toIso(receivedAt),
              identityNote: identityNote.trim() || null,
              noticeSha256: notice.sha256,
              ticketRetentionAgreed: retentionValue,
              noticeSentAt: toIso(noticeSentAt),
              consentReplyReceivedAt: toIso(replyAt),
            }, '탈퇴 요청을 기록했습니다.')}>
            요청 기록
          </Button>
        </div>
      )}
    </Block>
  )
}

function OpenRequest({ userId, email, preview, texts }: {
  userId: string
  email: string | null
  preview: MemberWithdrawalPreview
  texts: MemberWithdrawalPanelData['texts']
}) {
  const request = preview.openRequest!
  const { pending, run } = useAction(userId)
  const [sentAt, setSentAt] = useState('')
  const [replyAt, setReplyAt] = useState('')
  const [replyRetention, setReplyRetention] = useState<'keep' | 'agree' | 'disagree'>('keep')
  const [open, setOpen] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [reason, setReason] = useState('')
  const [providerChecked, setProviderChecked] = useState(false)
  const [pendingChecked, setPendingChecked] = useState(false)
  const [operationKey, setOperationKey] = useState('')
  const mail = request.channel !== 'screen'
  const nonPayerWithTickets = !preview.hadPayment && preview.ticketCount > 0

  const anonymize = async () => {
    const data = await run({
      action: 'anonymize',
      requestId: request.id,
      expectedBalance: request.expectedBalance,
      confirmEmail,
      providerUnverifiedConfirmed: providerChecked,
      pendingTicketsConfirmed: pendingChecked,
      ticketRetentionAgreed: null,
      reason: reason.trim() || null,
      operationKey,
    })
    if (data) {
      setOpen(false)
      toast.success(data.cleanup?.authScrubbed ? '익명화했습니다.' : '익명화했습니다. 로그인 계정 정리는 다시 시도가 필요합니다.')
    }
  }

  return (
    <Block title="열린 탈퇴 요청">
      <Rows rows={[
        ['접수 경로', `${CHANNEL_LABELS[request.channel] ?? request.channel} · ${REQUESTER_LABELS[request.requesterKind] ?? request.requesterKind}`],
        ['접수 시각', fmt(request.receivedAt)],
        ['동의한 소멸', `${num(request.expectedBalance)} 크레딧(유료 ${num(request.expectedForfeitPaid)} · 무상 ${num(request.expectedForfeitFree)})`],
        ['고지 보냄 / 회신', `${fmt(request.noticeSentAt)} / ${fmt(request.consentReplyReceivedAt)}`],
        ['문의 보존', request.ticketRetentionAgreed == null ? '-' : request.ticketRetentionAgreed ? '동의' : '동의하지 않음'],
        ['마케팅 철회', fmt(request.marketingWithdrawnAt)],
        ['고지 지문', request.noticeSha256.slice(0, 12)],
      ]} />
      {mail && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Label className="grid gap-1">고지 보낸 시각
            <Input type="datetime-local" value={sentAt} onChange={(event) => setSentAt(event.target.value)} disabled={Boolean(request.noticeSentAt)} />
          </Label>
          <Label className="grid gap-1">동의 회신 시각
            <Input type="datetime-local" value={replyAt} onChange={(event) => setReplyAt(event.target.value)} disabled={Boolean(request.consentReplyReceivedAt)} />
          </Label>
          {nonPayerWithTickets && request.ticketRetentionAgreed == null && (
            <Label className="grid gap-1">문의 보존 회신
              <select value={replyRetention} onChange={(event) => setReplyRetention(event.target.value as typeof replyRetention)} className="h-9 rounded-md border px-2">
                <option value="keep">아직 없음</option>
                <option value="agree">보존에 동의</option>
                <option value="disagree">동의하지 않음</option>
              </select>
            </Label>
          )}
          <Button size="sm" variant="outline" disabled={pending}
            onClick={() => void run({
              action: 'record_reply',
              requestId: request.id,
              noticeSentAt: toIso(sentAt),
              consentReplyReceivedAt: toIso(replyAt),
              ticketRetentionAgreed: replyRetention === 'keep' ? null : replyRetention === 'agree',
            }, '회신을 기록했습니다.')}>
            회신 기록
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={pending}
          onClick={() => { setConfirmEmail(''); setReason(''); setProviderChecked(false); setPendingChecked(false); setOperationKey(crypto.randomUUID()); setOpen(true) }}>
          익명화
        </Button>
        <Button size="sm" variant="outline" disabled={pending}
          onClick={() => void run({ action: 'cancel_request', requestId: request.id }, '요청을 취소했습니다.')}>
          요청 취소
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이 회원을 익명화할까요?</DialogTitle>
            <DialogDescription>되돌릴 수 없습니다. 연락처는 보관함으로 옮기고 회원 정보·로그인 계정을 정리합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {preview.providerUnverified.length > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={providerChecked} onChange={(event) => setProviderChecked(event.target.checked)} className="mt-1" />
                페이앱 판매자 화면에서 요청 미확인 주문 {preview.providerUnverified.length}건에 결제가 없음을 확인했습니다.
              </label>
            )}
            {preview.pendingTicketCount > 0 && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={pendingChecked} onChange={(event) => setPendingChecked(event.target.checked)} className="mt-1" />
                답변 대기 문의 {preview.pendingTicketCount}건에 답변했거나 환불 요청이 없음을 확인했습니다(탈퇴와 함께 닫힘).
              </label>
            )}
            <Label className="grid gap-1">사유(선택)
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} />
            </Label>
            {texts.reasonGuide && <p className="text-xs text-gray-500">{texts.reasonGuide}</p>}
            <Label className="grid gap-1">확인을 위해 회원 이메일을 그대로 입력
              <Input value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} placeholder={email ?? userId} />
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>취소</Button>
            <Button variant="destructive" disabled={pending || !confirmEmail.trim()} onClick={() => void anonymize()}>익명화</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Block>
  )
}

function WithdrawnSection({ userId, data }: { userId: string; data: MemberWithdrawalPanelData }) {
  const { pending, run } = useAction(userId)
  const [viewReason, setViewReason] = useState('')
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [noteText, setNoteText] = useState('')
  const [closeState, setCloseState] = useState<Record<string, { method: string; note: string }>>({})

  const readRecord = async () => {
    const result = await run({ action: 'read_record', reason: viewReason })
    if (result?.record) setRecord(result.record)
  }

  return (
    <div className="space-y-3">
      <Rows rows={[['탈퇴일', fmt(data.preview.withdrawnAt)]]} />

      <Block title="보관함 열람(열람 기록이 남습니다)">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={viewReason} onChange={(event) => setViewReason(event.target.value)} placeholder="열람 사유" maxLength={500} className="h-9 max-w-sm" />
          <Button size="sm" variant="outline" disabled={pending || !viewReason.trim()} onClick={() => void readRecord()}>보관 연락처 보기</Button>
        </div>
        {data.texts.reasonGuide && <p className="text-xs text-gray-500">{data.texts.reasonGuide}</p>}
        {record && (
          <div className="space-y-2">
            <Rows rows={[
              ['방법', String(record.method ?? '-')],
              ['이메일', String(record.email ?? '-')],
              ['휴대폰', String(record.phone ?? '-')],
              ['카카오 이메일', String(record.kakao_email ?? '-')],
              ['소멸 크레딧', `${num(record.forfeited_credits as number)} (유료 ${num(record.forfeited_paid_credits as number)})`],
              ['마케팅 철회', fmt(record.marketing_withdrawn_at as string | null)],
              ['로그인 계정 정리', fmt(record.auth_scrubbed_at as string | null)],
            ]} />
            <ul className="divide-y text-xs">
              {(Array.isArray(record.events) ? record.events as Record<string, unknown>[] : []).map((event) => (
                <li key={String(event.id)} className="py-1">{fmt(event.createdAt as string)} · {String(event.kind)} · {JSON.stringify(event.details)}</li>
              ))}
            </ul>
          </div>
        )}
      </Block>

      {data.accountStatus && (data.accountStatus.authPending || data.accountStatus.kakaoPending) && (
        <Block title="로그인 계정 정리">
          <p>{data.accountStatus.authPending ? '소프트 삭제가 끝나지 않았습니다. ' : ''}{data.accountStatus.kakaoPending ? '카카오 연결 끊기가 남았습니다.' : ''}</p>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void run({ action: 'retry_account' }, '다시 시도했습니다.')}>로그인 계정 정리 다시 시도</Button>
        </Block>
      )}

      {data.heldOrders.length > 0 && (
        <Block title="보류 주문">
          <ul className="divide-y">
            {data.heldOrders.map((order) => {
              const state = closeState[order.id] ?? { method: 'bank_transfer', note: '' }
              const setState = (next: Partial<typeof state>) => setCloseState((prev) => ({ ...prev, [order.id]: { ...state, ...next } }))
              return (
                <li key={order.id} className="space-y-2 py-2">
                  <p className="font-mono text-xs">{order.order_id} · {order.status} · {order.failure_code ?? '-'} · {num(order.expected_amount)}원{order.alertOpen ? ' · 경보 열림' : ''}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={state.method} onChange={(event) => setState({ method: event.target.value })} className="h-9 rounded-md border px-2 text-sm" aria-label="닫는 방법">
                      {Object.entries(CLOSE_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Input value={state.note} onChange={(event) => setState({ note: event.target.value })} placeholder="메모(개인정보 금지)" maxLength={1000} className="h-9 max-w-sm" />
                    <Button size="sm" variant="outline" disabled={pending || !state.note.trim()}
                      onClick={() => void run({ action: 'close_held_order', orderId: order.id, method: state.method, note: state.note, operationKey: crypto.randomUUID() }, '보류 주문을 닫았습니다.')}>
                      보류 주문 닫기
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Block>
      )}

      <Block title="추가 기록(안내 메일 발송 등)">
        <Textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} maxLength={1000} rows={2} placeholder="예: 완료·마케팅 철회 결과를 받은 메일 스레드로 보냄(개인정보 금지)" />
        <Button size="sm" variant="outline" disabled={pending || !noteText.trim()}
          onClick={() => void run({ action: 'add_event', kind: 'note', refId: null, details: { note: noteText.trim(), recorded_at: new Date().toISOString() } }, '기록했습니다.').then((done) => { if (done) setNoteText('') })}>
          기록
        </Button>
      </Block>
    </div>
  )
}

export function MemberWithdrawalPanel({ userId, email, data }: { userId: string; email: string | null; data: MemberWithdrawalPanelData }) {
  const { preview, texts } = data
  if (preview.withdrawnAt) return <WithdrawnSection userId={userId} data={data} />
  const inProgress = Object.entries(preview.inProgress ?? {}).filter(([, count]) => count > 0)
  // 이메일·전화 요청은 화면 요청만 막는 사유(스위치 꺼짐·원 환산 확인)를 막힘으로 보지 않는다.
  const ownerReasons = ownerChannelRequestReasons(preview.requestReasons)
  const reasonList = (reasons: string[]) => reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(', ')
  const balance = preview.balance
  return (
    <div className="space-y-3">
      <Rows rows={[
        ['구분', preview.hadPayment
          ? `결제 회원 (${preview.hadPaymentReasons.map((reason) => PAID_REASON_LABELS[reason] ?? reason).join(', ')})`
          : preview.hasOrdersOrAttempts ? '결제 시도만' : '결제 이력 없음'],
        ['진행 중', inProgress.length ? inProgress.map(([key, count]) => `${IN_PROGRESS_LABELS[key] ?? key} ${count}`).join(' · ') : '없음'],
        ['환불 기간 남은 충전', preview.refundPeriodOpen.length
          ? preview.refundPeriodOpen.map((period) => `마감 ${fmt(period.deadline)} · 차단 끝 ${fmt(period.blockedUntil)}${period.inBuffer ? '(휴일 여유)' : ''}`).join(' / ')
          : '없음'],
        ['페이앱 미확인 주문', `${preview.providerUnverified.length}건`],
        ['답변 대기 문의', `${preview.pendingTicketCount}건 (전체 ${preview.ticketCount}건)`],
        ['소멸 예정', `${num(balance.forfeitTotal)} (유료 ${num(balance.forfeitPaid)} · 무상 ${num(balance.forfeitFree)}) · 만료분 ${num(balance.expired)} · 유료 원 환산 ${num(balance.paidCashValue)}원${balance.paidCashValueUnknown ? '(일부 계산 불가)' : ''}`],
        ['마케팅 동의', preview.marketingAgreed ? '동의 중' : '아님'],
        ['스스로 탈퇴', preview.selfAllowed ? '가능' : preview.selfReasons.map((reason) => REASON_LABELS[reason] ?? reason).join(', ')],
        ['화면 탈퇴 요청(결제 회원)', preview.requestAllowed ? '가능' : reasonList(preview.requestReasons)],
        ['이메일·전화 요청(결제 회원)', ownerReasons.length === 0 ? '가능' : reasonList(ownerReasons)],
      ]} />
      {balance.breakdown.length > 0 && (
        <ul className="text-xs text-gray-600">
          {balance.breakdown.map((item) => (
            <li key={item.source_id}>
              {item.paid ? '유료' : '무상'} {item.category} · 소멸 {num(item.forfeited)} · 만료 정리 {num(item.expired_cleared)} · 만료 {fmt(item.expires_at)}{item.paid ? ` · 원 환산 ${item.cash_value == null ? '계산 불가' : `${num(item.cash_value)}원`}` : ''}
            </li>
          ))}
        </ul>
      )}
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">지울 것·남길 것 건수</summary>
        <p className="mt-1 break-all">{Object.entries(preview.counts ?? {}).map(([key, count]) => `${key} ${count}`).join(' · ')}</p>
      </details>

      {preview.redactionRequired.length > 0 && (
        <Block title={`가림 확인 필요 ${preview.redactionRequired.length}건`}>
          <ul className="divide-y">
            {preview.redactionRequired.map((item) => <RedactionRow key={`${item.kind}-${item.id}`} userId={userId} item={item} />)}
          </ul>
        </Block>
      )}

      {preview.openRequest
        ? <OpenRequest userId={userId} email={email} preview={preview} texts={texts} />
        : !preview.isAdmin && <RequestForm userId={userId} preview={preview} texts={texts} />}

      {(texts.ownerMailBlocked || texts.ownerMailCompleted) && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer">안내 메일 틀(10일 안에 회원에게)</summary>
          {texts.ownerMailBlocked && <p className="mt-1 whitespace-pre-line">{texts.ownerMailBlocked}</p>}
          {texts.ownerMailCompleted && <p className="mt-1 whitespace-pre-line">{texts.ownerMailCompleted}</p>}
          {texts.objectionGuide && <p className="mt-1">{texts.objectionGuide}</p>}
        </details>
      )}
    </div>
  )
}
