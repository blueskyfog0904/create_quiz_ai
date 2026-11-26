'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatKstDateTime } from '@/lib/kst-date-format'
import {
  MEMBER_DEADLINE_TEXT_KEYS,
  earliestMemberDeadline,
  formatMemberLastDay,
  suspensionExceedsDeadline,
  type MemberDeadlineKind,
  type MemberSuspensionPolicy,
  type MemberSuspensionScope,
} from '@/lib/member-suspension'
import {
  MEMBER_DEADLINE_KIND_LABELS,
  SUSPENSION_NOTICE_VIA_LABELS,
  SUSPENSION_SCOPE_LABELS,
  fillOwnerMailDeadlines,
  kstEndOfDayIso,
  kstToday,
  latestRestrictedEndDate,
} from '@/lib/admin-member-suspension'
import type { MemberSuspensionRow, MemberSuspensionSectionData } from '@/lib/admin-member-suspension-server'

// 회원 상세의 '이용 정지' 구역(계획 6-2). 판정·처리는 DB 함수가 하고(권한·대상·기간·작업 기록), 이 화면은 값을 넘긴다.
// 회원에게 보이는 문구(막히는 것·계속 되는 것·안내)는 정책 texts(DB)다. 버튼은 화면·route·DB 세 곳이 같은 권한일 때만 보인다:
//   이용 제한·해제·알림 기록 members.suspend, 로그인 차단과 그 해제·알림 기록 대표, 기한 날짜·경고 members.suspend.

interface Capabilities {
  canSuspend: boolean
  isOwner: boolean
}

const VIA_OPTIONS = Object.entries(SUSPENSION_NOTICE_VIA_LABELS) as [keyof typeof SUSPENSION_NOTICE_VIA_LABELS, string][]

function postSuspension(userId: string, body: Record<string, unknown>) {
  return fetch(`/api/admin/users/${userId}/suspension`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) throw new Error(result?.error ?? '처리하지 못했습니다.')
    return result
  })
}

function Warning({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{children}</div>
}

// 3절 돈 원칙: 기한을 넘는 정지면 (가)(나)(다) 가운데 하나를 고르고 메모에 적는다(런북 RB-12).
function DeadlineChoices({ text }: { text: string | null }) {
  return (
    <>
      {text && <p className="font-medium">{text}</p>}
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
        <li>(가) 기한 전에 해제하거나, 로그인 차단을 기한 전에 이용 제한으로 바꿔 회원이 화면으로 환불을 신청할 수 있게 한다.</li>
        <li>(나) 계약 해지와 남은 유료 크레딧 환불 — 회사가 먼저 시작하는 경로는 없으므로 회원에게 탈퇴·환불 신청을 안내하고, 요청이 오면 10번 절차로 처리한다.</li>
        <li>(다) 만료를 정지 기간만큼 늘린다 — 기능이 없으므로 런북 0-3 SQL 절차를 따른다.</li>
      </ul>
    </>
  )
}

function SuspensionFacts({ row, actorLabels }: { row: MemberSuspensionRow; actorLabels: Record<string, string> }) {
  const items: [string, ReactNode][] = [
    ['범위', `${SUSPENSION_SCOPE_LABELS[row.scope]}${row.blocks_download ? ' · 다운로드도 막음' : ''}`],
    ['사유 분류', `${row.reason_label} (${row.reason_code})`],
    ['회원에게 알린 사유', row.member_reason],
    ['내부 메모', row.internal_note || '-'],
    ['기간', `${formatKstDateTime(row.starts_at)} ~ ${row.ends_at ? formatKstDateTime(row.ends_at) : '끝나는 날 없음(해제할 때까지)'}`],
    ['처리한 관리자', actorLabels[row.created_by] ?? row.created_by],
    ['알림', row.notified_at
      ? `${SUSPENSION_NOTICE_VIA_LABELS[row.notified_via ?? 'screen']} · ${formatKstDateTime(row.notified_at)}${row.notice_summary ? ` · ${row.notice_summary}` : ''}`
      : '기록 없음'],
  ]
  if (row.scope === 'restricted') items.push(['안내 화면 처음 연 시각', row.first_seen_at ? formatKstDateTime(row.first_seen_at) : '아직 열지 않음'])
  if (row.lifted_at) {
    items.push(['해제', `${formatKstDateTime(row.lifted_at)}${row.lifted_by ? ` · ${actorLabels[row.lifted_by] ?? row.lifted_by}` : ''} · ${row.lift_reason === 'expired' ? '기간 끝남' : row.lift_reason ?? ''}`])
  }
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm max-sm:grid-cols-1">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MemberSuspensionPanel({ userId, data, capabilities }: {
  userId: string
  data: MemberSuspensionSectionData
  capabilities: Capabilities
}) {
  const nowMs = useMemo(() => new Date(data.databaseNow).getTime(), [data.databaseNow])
  const deadlineData = data.deadlines && !data.deadlines.failed ? data.deadlines.data : null
  const earliest = useMemo(
    () => earliestMemberDeadline(deadlineData ? { paidBalance: 0, ...deadlineData } : null, nowMs),
    [deadlineData, nowMs]
  )

  if (data.withdrawn) {
    return <p className="text-sm text-gray-600">탈퇴로 지워짐 · 범위·분류·기간은 작업 기록에서 봅니다.</p>
  }

  const { active, policy } = data
  const canHandleActive = active !== null && capabilities.canSuspend && (active.scope === 'restricted' || capabilities.isOwner)
  const activeExceeds = active !== null && capabilities.canSuspend && suspensionExceedsDeadline({ scope: active.scope, endsAt: active.ends_at }, earliest)
  const past = data.history.filter((row) => row.id !== active?.id)

  return (
    <div className="space-y-4">
      {/* 활성 정지의 계속 경고: 남은 기한을 넘기면(끝나는 날 없는 로그인 차단 포함) 늘 띄운다. */}
      {active && activeExceeds && (
        <Warning>
          <p>가장 빠른 기한: {earliest ? `${MEMBER_DEADLINE_KIND_LABELS[earliest.kind]} ${formatKstDateTime(earliest.at)}` : '확인된 기한 없음(끝나는 날 없는 로그인 차단)'}</p>
          <DeadlineChoices text={policy?.texts.adminDeadlineWarning ?? null} />
        </Warning>
      )}
      {active && active.scope === 'login_blocked' && !active.notified_at && (
        <Warning>로그인 차단 알림을 아직 기록하지 않았습니다. 대표가 이메일로 사유·기한을 알린 뒤 [알림 기록]으로 수단·시각·요약을 남겨 주세요.</Warning>
      )}

      {capabilities.canSuspend && (
        <DeadlineSummary deadlines={data.deadlines} earliest={earliest} paidBalance={data.paidBalance} />
      )}

      {active ? (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge className="bg-red-100 text-red-800">정지 중 · {SUSPENSION_SCOPE_LABELS[active.scope]}</Badge>
            {canHandleActive && (
              <div className="flex flex-wrap gap-2">
                {!active.notified_at && <NoticeRecordButton userId={userId} suspension={active} />}
                <LiftButton userId={userId} suspension={active} />
              </div>
            )}
          </div>
          <SuspensionFacts row={active} actorLabels={data.actorLabels} />
          {!canHandleActive && capabilities.canSuspend && active.scope === 'login_blocked' && (
            <p className="text-xs text-gray-500">로그인 차단의 해제·알림 기록은 대표만 할 수 있습니다.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">지금 정지 중이 아닙니다.</p>
          {capabilities.canSuspend && (
            policy
              ? <SuspendButton userId={userId} policy={policy} isOwner={capabilities.isOwner} earliest={earliest} data={data} nowMs={nowMs} />
              : <p role="alert" className="text-sm text-red-700">이용 정지 설정을 읽지 못해 정지할 수 없습니다.</p>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-medium text-gray-700">정지 이력</p>
        {past.length === 0 ? <p className="text-sm text-gray-500">지난 정지가 없습니다.</p> : (
          <ul className="divide-y">
            {past.map((row) => (
              <li key={row.id} className="py-3"><SuspensionFacts row={row} actorLabels={data.actorLabels} /></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DeadlineSummary({ deadlines, earliest, paidBalance }: {
  deadlines: MemberSuspensionSectionData['deadlines']
  earliest: { kind: MemberDeadlineKind; at: string } | null
  paidBalance: number | null
}) {
  if (!deadlines) return null
  if (deadlines.failed) return <p role="alert" className="text-sm text-red-700">환불·소멸 기한을 불러오지 못했습니다. 정지 전에 결제·크레딧 내역을 직접 확인해 주세요.</p>
  const rows: [MemberDeadlineKind, string | null][] = [
    ['chargeRefund', deadlines.data.chargeRefundUntil],
    ['materialRefund', deadlines.data.materialRefundUntil],
    ['creditExpiry', deadlines.data.earliestCreditExpiry],
  ]
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-sm">
      <p className="mb-1 font-medium text-gray-700">환불·소멸 기한</p>
      <ul className="space-y-0.5">
        {rows.map(([kind, at]) => (
          <li key={kind}>
            <span className="text-gray-500">{MEMBER_DEADLINE_KIND_LABELS[kind]} </span>
            {at ? formatKstDateTime(at) : '없음'}
            {earliest?.kind === kind && <Badge variant="outline" className="ml-2 border-amber-400 text-amber-800">가장 빠름</Badge>}
          </li>
        ))}
        {paidBalance !== null && <li><span className="text-gray-500">남은 유료 크레딧 </span>{paidBalance.toLocaleString()} C</li>}
      </ul>
    </div>
  )
}

function SuspendButton({ userId, policy, isOwner, earliest, data, nowMs }: {
  userId: string
  policy: MemberSuspensionPolicy
  isOwner: boolean
  earliest: { kind: MemberDeadlineKind; at: string } | null
  data: MemberSuspensionSectionData
  nowMs: number
}) {
  const router = useRouter()
  const categories = policy.reasonCategories.filter((category) => !category.hidden)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scope, setScope] = useState<MemberSuspensionScope>('restricted')
  const [reasonCode, setReasonCode] = useState('')
  const [blocksDownload, setBlocksDownload] = useState(false)
  const [memberReason, setMemberReason] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [endDate, setEndDate] = useState('')
  // 응답 유실 뒤 다시 눌러도 한 번만 정지되도록 창을 열 때 만든 키를 창이 닫힐 때까지 쓴다(DB operation_key).
  const [operationKey, setOperationKey] = useState('')

  const category = categories.find((item) => item.code === reasonCode) ?? null
  const maxDate = latestRestrictedEndDate(nowMs, policy.maxRestrictedDays)
  const endsAt = endDate ? kstEndOfDayIso(endDate) : null
  const effectiveBlocksDownload = scope === 'login_blocked' ? true : blocksDownload
  const exceeds = suspensionExceedsDeadline({ scope, endsAt }, earliest)

  const openDialog = () => {
    setScope('restricted')
    setReasonCode('')
    setBlocksDownload(false)
    setMemberReason('')
    setInternalNote('')
    setEndDate('')
    setConfirming(false)
    setOperationKey(crypto.randomUUID())
    setOpen(true)
  }

  const chooseCategory = (code: string) => {
    setReasonCode(code)
    // 다운로드도 막기의 미리 체크는 분류마다 DB 값(blocksDownloadDefault)이다. 바꿀 수 있다.
    setBlocksDownload(categories.find((item) => item.code === code)?.blocksDownloadDefault ?? false)
  }

  const toConfirm = () => {
    if (!category) return toast.error('사유 분류를 골라 주세요.')
    if (!memberReason.trim()) return toast.error('회원에게 알릴 사유를 적어 주세요.')
    if (memberReason.trim().length > 500) return toast.error('회원에게 알릴 사유는 500자 이내로 적어 주세요.')
    if (internalNote.trim().length > 2000) return toast.error('내부 메모는 2000자 이내로 적어 주세요.')
    if (scope === 'restricted' && !endDate) return toast.error('이용 제한은 끝나는 날을 반드시 정합니다.')
    if (endDate && (!endsAt || new Date(endsAt).getTime() <= nowMs)) return toast.error('끝나는 날은 오늘 이후여야 합니다.')
    if (scope === 'restricted' && endDate > maxDate) return toast.error(`이용 제한은 최대 ${policy.maxRestrictedDays}일(${maxDate}까지)입니다. 늘리려면 해제한 뒤 다시 정지합니다.`)
    setConfirming(true)
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const result = await postSuspension(userId, {
        action: 'suspend',
        scope,
        blocksDownload: scope === 'login_blocked' ? true : blocksDownload,
        reasonCode,
        memberReason: memberReason.trim(),
        internalNote: internalNote.trim(),
        endsAt,
        operationKey,
      })
      toast.success(result.result?.replay ? '이미 처리된 정지입니다. 화면을 새로 읽었습니다.' : `${SUSPENSION_SCOPE_LABELS[scope]}을 걸었습니다. 알림을 기록해 주세요.`)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '정지하지 못했습니다.')
    } finally {
      setSubmitting(false)
      router.refresh()
    }
  }

  const texts = policy.texts
  // 대표 이메일 기한 안내 초안: 날짜는 회원 안내 화면과 같은 공용 셈법(마감 1ms 앞의 한국 날짜). 확인된 기한이 없으면 틀을 보이지 않는다.
  const mailDraft = scope === 'login_blocked' && earliest
    ? fillOwnerMailDeadlines(texts.ownerMailDeadlines, { kindLabel: texts[MEMBER_DEADLINE_TEXT_KEYS[earliest.kind]], dateLabel: formatMemberLastDay(earliest.at) })
    : null

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={openDialog}>정지</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px] max-md:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>회원 이용 정지</DialogTitle>
            <DialogDescription>정지는 크레딧을 없애는 조치가 아니라 사용 보류입니다. 범위·기간을 바꾸려면 해제한 뒤 다시 정지합니다.</DialogDescription>
          </DialogHeader>

          {confirming ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="font-semibold text-gray-900">{SUSPENSION_SCOPE_LABELS[scope]} · {category?.label}</p>
                <p className="mt-1">기간: 지금 ~ {endsAt ? formatKstDateTime(endsAt) : '끝나는 날 없음(해제할 때까지)'}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="mb-1 font-medium text-red-800">막히는 것</p>
                  {scope === 'login_blocked' ? (
                    <p>로그인 자체(이메일·카카오). 기존 세션도 모두 끊깁니다.</p>
                  ) : (
                    <p>{texts.noticeBlockedList}{effectiveBlocksDownload ? `, ${texts.noticeBlockedDownload}` : ''}</p>
                  )}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-1 font-medium text-green-800">계속 되는 것</p>
                  {scope === 'login_blocked' ? (
                    <p>이메일·전화로 이의, 충전·자료 환불, 탈퇴 신청(접수 시각을 신청 시각으로 봄). 진행 중 결제 통보·환불 처리.</p>
                  ) : (
                    <p>{texts.noticeAvailableList}{effectiveBlocksDownload ? '' : `, ${texts.noticeBlockedDownload}`}</p>
                  )}
                </div>
              </div>
              <p className="text-gray-700">{texts.adminSuspendConfirm}</p>
              {data.pending === null ? (
                <p className="text-xs text-gray-500">결제 정보는 주문 조회 권한이 있어야 보입니다.</p>
              ) : data.pending.failed ? (
                <p role="alert" className="text-xs text-red-700">진행 중 결제·환불 건수를 불러오지 못했습니다.</p>
              ) : (
                <p className="text-xs text-gray-600">
                  진행 중 충전 결제 {data.pending.data.paymentOrders}건 · 심사 중 충전 환불 {data.pending.data.pointRefunds}건 · 심사 중 자료 환불 {data.pending.data.marketRefunds}건
                </p>
              )}
              {exceeds && (
                <Warning>
                  <p>가장 빠른 기한: {earliest ? `${MEMBER_DEADLINE_KIND_LABELS[earliest.kind]} ${formatKstDateTime(earliest.at)}` : '확인된 기한 없음(끝나는 날 없는 로그인 차단)'}</p>
                  <DeadlineChoices text={texts.adminDeadlineWarning} />
                </Warning>
              )}
              {data.deadlines?.failed && (
                <Warning>환불·소멸 기한을 확인하지 못했습니다. 결제·크레딧 내역을 직접 확인한 뒤 확정하세요(기한 경고가 빠졌을 수 있습니다).</Warning>
              )}
              {category?.underageGuide && <Warning>{texts.adminUnderageGuide}</Warning>}
              {scope === 'login_blocked' && !mailDraft && !data.deadlines?.failed && (
                <p className="text-xs text-gray-600">확인된 환불·소멸 기한이 없어 이메일 기한 안내 초안을 만들지 않았습니다. 기한 문장은 빼고 보내세요.</p>
              )}
              {scope === 'login_blocked' && data.deadlines?.failed && (
                <p role="alert" className="text-xs text-red-700">기한을 확인하지 못했습니다. 결제·크레딧 내역에서 가장 빠른 기한을 직접 찾아 이메일에 넣으세요.</p>
              )}
              {mailDraft && (
                <div className="space-y-1">
                  <Label htmlFor={`suspend-mail-${userId}`}>대표 이메일에 넣을 기한 안내(초안)</Label>
                  <Textarea id={`suspend-mail-${userId}`} readOnly value={mailDraft} className="h-24 text-xs" />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">범위</legend>
                {(['restricted', 'login_blocked'] as const).filter((value) => value === 'restricted' || isOwner).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={`suspend-scope-${userId}`} value={value} checked={scope === value} onChange={() => setScope(value)} />
                    {SUSPENSION_SCOPE_LABELS[value]}
                    {value === 'login_blocked' && <span className="text-xs text-gray-500">(계정 도용·자동 수집처럼 로그인을 열어 두면 안 될 때만, 대표 전용)</span>}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1">
                <Label htmlFor={`suspend-category-${userId}`}>사유 분류 <span className="text-red-500">*</span></Label>
                <select
                  id={`suspend-category-${userId}`}
                  value={reasonCode}
                  onChange={(event) => chooseCategory(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">고르세요</option>
                  {categories.map((item) => (
                    <option key={item.code} value={item.code}>{item.label}{item.clause ? ` (${item.clause})` : ''}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={effectiveBlocksDownload}
                  disabled={scope === 'login_blocked'}
                  onChange={(event) => setBlocksDownload(event.target.checked)}
                />
                다운로드도 막기 {scope === 'login_blocked' && <span className="text-xs text-gray-500">(로그인 차단은 늘 막힘)</span>}
              </label>
              <div className="space-y-1">
                <Label htmlFor={`suspend-member-reason-${userId}`}>회원에게 알릴 사유 <span className="text-red-500">*</span></Label>
                <Textarea id={`suspend-member-reason-${userId}`} value={memberReason} onChange={(event) => setMemberReason(event.target.value)} className="h-20" maxLength={500} />
                <p className="text-xs text-gray-500">회원 안내 화면에 그대로 보입니다. 작업 기록에는 글자 수만 남습니다.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`suspend-internal-${userId}`}>내부 메모</Label>
                <Textarea id={`suspend-internal-${userId}`} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} className="h-16" maxLength={2000} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`suspend-end-${userId}`}>끝나는 날(한국 날짜, 그날 끝까지){scope === 'restricted' && <span className="text-red-500"> *</span>}</Label>
                <Input
                  id={`suspend-end-${userId}`}
                  type="date"
                  value={endDate}
                  min={kstToday(nowMs)}
                  max={scope === 'restricted' ? maxDate : undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-48"
                />
                <p className="text-xs text-gray-500">
                  {scope === 'restricted'
                    ? `이용 제한은 반드시 정하고 최대 ${policy.maxRestrictedDays}일입니다.`
                    : '비워 두면 본인 확인 때까지 막습니다. 비워 두면 늘 기한을 넘는 정지로 보고 경고합니다.'}
                </p>
              </div>
              {category?.underageGuide && <Warning>{texts.adminUnderageGuide}</Warning>}
            </div>
          )}

          <DialogFooter className="gap-2">
            {confirming ? (
              <>
                <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={submitting}>이전</Button>
                <Button type="button" variant="destructive" onClick={() => void submit()} disabled={submitting}>{submitting ? '처리 중…' : '정지 확정'}</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                <Button type="button" onClick={toConfirm}>다음</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LiftButton({ userId, suspension }: { userId: string; suspension: MemberSuspensionRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!reason.trim()) return toast.error('해제 사유를 적어 주세요.')
    setSubmitting(true)
    try {
      await postSuspension(userId, { action: 'lift', suspensionId: suspension.id, liftReason: reason.trim() })
      toast.success('정지를 해제했습니다.')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '해제하지 못했습니다.')
    } finally {
      setSubmitting(false)
      router.refresh()
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setReason(''); setOpen(true) }}>해제</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next) }}>
        <DialogContent className="sm:max-w-[460px] max-md:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>{SUSPENSION_SCOPE_LABELS[suspension.scope]} 해제</DialogTitle>
            <DialogDescription>
              {suspension.scope === 'login_blocked' ? '로그인 차단을 풀면 회원이 다시 로그인할 수 있습니다(탈퇴 회원의 차단은 풀리지 않습니다). ' : ''}
              이의 검토 결과는 회원에게 답해 주세요(이용약관 제9조②).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`lift-reason-${suspension.id}`}>해제 사유 <span className="text-red-500">*</span></Label>
            <Textarea id={`lift-reason-${suspension.id}`} value={reason} onChange={(event) => setReason(event.target.value)} className="h-20" maxLength={500} />
            <p className="text-xs text-gray-500">작업 기록에는 글자 수만 남습니다.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>취소</Button>
            <Button type="button" onClick={() => void submit()} disabled={submitting}>{submitting ? '처리 중…' : '해제'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function NoticeRecordButton({ userId, suspension }: { userId: string; suspension: MemberSuspensionRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [via, setVia] = useState<keyof typeof SUSPENSION_NOTICE_VIA_LABELS>(suspension.scope === 'login_blocked' ? 'email' : 'screen')
  const [sentAt, setSentAt] = useState('')
  const [summary, setSummary] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const sent = sentAt ? new Date(sentAt) : null
    if (!sent || Number.isNaN(sent.getTime())) return toast.error('보낸 시각을 입력해 주세요.')
    setSubmitting(true)
    try {
      await postSuspension(userId, { action: 'notice', suspensionId: suspension.id, via, sentAt: sent.toISOString(), summary: summary.trim() })
      toast.success('알림을 기록했습니다.')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '알림을 기록하지 못했습니다.')
    } finally {
      setSubmitting(false)
      router.refresh()
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setSentAt(''); setSummary(''); setOpen(true) }}>알림 기록</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next) }}>
        <DialogContent className="sm:max-w-[460px] max-md:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>정지 알림 기록</DialogTitle>
            <DialogDescription>회원에게 사유를 알린 수단·시각·요약을 한 번 남깁니다(이용약관 제9조② 증빙).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`notice-via-${suspension.id}`}>수단</Label>
              <select
                id={`notice-via-${suspension.id}`}
                value={via}
                onChange={(event) => setVia(event.target.value as keyof typeof SUSPENSION_NOTICE_VIA_LABELS)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {VIA_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`notice-sent-${suspension.id}`}>보낸 시각(이 기기 시간대)</Label>
              <Input id={`notice-sent-${suspension.id}`} type="datetime-local" value={sentAt} onChange={(event) => setSentAt(event.target.value)} className="w-60" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`notice-summary-${suspension.id}`}>요약</Label>
              <Textarea id={`notice-summary-${suspension.id}`} value={summary} onChange={(event) => setSummary(event.target.value)} className="h-20" maxLength={500} />
              <p className="text-xs text-gray-500">작업 기록에는 글자 수만 남습니다.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>취소</Button>
            <Button type="button" onClick={() => void submit()} disabled={submitting}>{submitting ? '처리 중…' : '기록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
