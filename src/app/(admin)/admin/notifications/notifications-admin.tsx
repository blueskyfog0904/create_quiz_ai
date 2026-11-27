'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ANNOUNCEMENT_NOTIFICATION_TYPE, NotificationBellItemBody, NotificationListItemBody } from '@/components/notifications/notification-item'
import { formatCount } from '@/lib/admin-format'
import { formatKstDateTime } from '@/lib/kst-date-format'
import { MEMBER_FACING_PII_LABELS, memberFacingTextPiiHits, type MemberFacingPiiKind } from '@/lib/member-facing-text-pii'
import {
  BROADCAST_FIXED_LINKS,
  BROADCAST_MESSAGE_MAX,
  BROADCAST_RETRACT_REASON_CODES,
  BROADCAST_RETRACT_REASON_LABELS,
  BROADCAST_TARGET_LABELS,
  BROADCAST_TITLE_MAX,
  CREDIT_GRANT_CATEGORY_KEYS,
  MARKET_REFUND_MESSAGE_KEYS,
  MEMBER_NOTIFICATION_KINDS,
  MEMBER_NOTIFICATION_KIND_KEYS,
  MEMBER_NOTIFICATION_MESSAGE_MAX,
  MEMBER_NOTIFICATION_TITLE_MAX,
  broadcastDraftKey,
  memberNotificationFieldLabel,
  normalizeMemberNotificationTexts,
  renderMemberNotification,
  validateMemberNotificationTextsInput,
  type BroadcastRetractReasonCode,
  type BroadcastTarget,
  type CreditGrantCategoryKey,
  type MarketRefundMessageKey,
  type MemberNotificationKind,
  type MemberNotificationPlaceholder,
  type MemberNotificationTexts,
} from '@/lib/member-notifications'
import type { BroadcastNoticeOption, BroadcastTermsOption, MemberBroadcastHistoryItem, MemberBroadcastPreview } from '@/lib/member-broadcast-server'
import type { readMemberNotificationTextsForAdmin } from '@/lib/member-notifications-server'
import {
  previewMemberBroadcastAction,
  retractMemberBroadcastAction,
  saveMemberNotificationTextsAction,
  sendMemberBroadcastAction,
} from './actions'

// 16번 7절: 관리자 '알림' 화면(대표만). 관리자 안내 글은 코드 글자, 회원에게 가는 글은 모두 DB(member_notification_texts)·입력값이다.
// localhost 도 운영 DB 를 쓴다 — 로컬 확인 때는 [저장]·[보내기]·[회수]를 누르지 않는다(미리보기는 읽기만 한다).

export type NotificationsAdminTab = 'texts' | 'broadcast' | 'history'

type AdminTextsRead = Awaited<ReturnType<typeof readMemberNotificationTextsForAdmin>>

interface NotificationsAdminProps {
  texts: AdminTextsRead
  history: { status: 'ok'; items: MemberBroadcastHistoryItem[] } | { status: 'unavailable' }
  notices: BroadcastNoticeOption[]
  terms: BroadcastTermsOption[]
  piiAllowed: { customerCenter: string; orderEmail: string }
  initialTab: NotificationsAdminTab
  initialPostId: string | null
}

const TEXTS_ERROR: Record<string, string> = {
  missing: '알림 문구 설정이 아직 없습니다(16번 DB 적용 전). 적용 뒤 다시 여세요.',
  invalid: '알림 문구 설정의 모양이 맞지 않습니다. 개발 담당에게 알려 주세요.',
  error: '알림 문구 설정을 읽지 못했습니다. 새로고침해 주세요.',
}

// 예시 값(관리자 미리보기 전용)
const SAMPLE_VALUES: Record<MemberNotificationPlaceholder, string | number> = {
  '{금액}': 9900,
  '{문의제목}': '결제 문의',
  '{분류}': '',
  '{수량}': 1000,
  '{내용}': '이벤트 참여 보상',
  '{사유}': '환불 기간이 지난 요청입니다',
}
const SAMPLE_MARKET_REFUND = { requested_refund_credits: 4500, approved_refund_credits: 4000, allocated_items: [{ reissued: 1500 }] }

const CATEGORY_LABELS: Record<CreditGrantCategoryKey, string> = { compensation: '보상', event: '이벤트', refund: '환불', other: '기타' }
const MARKET_SENTENCE_LABELS: Record<MarketRefundMessageKey, string> = {
  base: '돌려준 크레딧({수량})',
  reissued: '그중 다시 지급한 몫({수량}, 있을 때만)',
  missing: '돌려주지 못한 몫({수량}, 있을 때만)',
  unknown: '복구량을 모를 때(자리표시 없음)',
}
const FIXED_LINK_LABELS: Record<(typeof BROADCAST_FIXED_LINKS)[number], string> = {
  '/notices': '공지사항 목록',
  '/faq': '자주 묻는 질문',
  '/terms': '약관 및 정책 목록',
  '/terms/upcoming': '바뀌는 약관 보기',
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const charLength = (text: string) => [...text].length

function piiOf(texts: readonly string[], allowed: NotificationsAdminProps['piiAllowed']): MemberFacingPiiKind[] {
  return [...new Set(texts.flatMap((text) => memberFacingTextPiiHits(text, allowed)))]
}

export function NotificationsAdmin({ texts, history, notices, terms, piiAllowed, initialTab, initialPostId }: NotificationsAdminProps) {
  const [tab, setTab] = useState<NotificationsAdminTab>(initialTab)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">알림</h1>
        <p className="text-gray-500">회원에게 가는 알림 문구를 고치고, 서비스 공지 알림을 보내고 회수합니다(대표만).</p>
        <p className="mt-1 text-xs text-amber-800">localhost 도 운영 DB 를 씁니다. 로컬에서는 저장·보내기·회수를 누르지 마세요.</p>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationsAdminTab)}>
        <TabsList>
          <TabsTrigger value="texts">알림 문구</TabsTrigger>
          <TabsTrigger value="broadcast">공지 알림 보내기</TabsTrigger>
          <TabsTrigger value="history">보낸 기록</TabsTrigger>
        </TabsList>
        <TabsContent value="texts" className="mt-4">
          {texts.status === 'ok'
            ? <TextsEditor key={texts.texts.revision} texts={texts.texts} piiAllowed={piiAllowed} />
            : <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{TEXTS_ERROR[texts.status]}</p>}
        </TabsContent>
        <TabsContent value="broadcast" className="mt-4">
          {texts.status === 'ok'
            ? <BroadcastComposer texts={texts.texts} notices={notices} terms={terms} piiAllowed={piiAllowed} initialPostId={initialPostId} onSent={() => setTab('history')} />
            : <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{TEXTS_ERROR[texts.status]} 설정이 없으면 보낼 수 없습니다.</p>}
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <BroadcastHistory history={history} canRedact={texts.status === 'ok'} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── 알림 문구 탭(7-2) ───────────────────────────────────────────────────────────────────────────────
function TextsEditor({ texts, piiAllowed }: { texts: MemberNotificationTexts; piiAllowed: NotificationsAdminProps['piiAllowed'] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<MemberNotificationTexts>(() => clone(texts))
  const [confirmOpen, setConfirmOpen] = useState(false)

  const problem = useMemo(() => {
    try {
      return validateMemberNotificationTextsInput(normalizeMemberNotificationTexts(draft))
    } catch {
      return 'value'
    }
  }, [draft])
  const allTexts = useMemo(() => {
    const out: string[] = []
    for (const kind of MEMBER_NOTIFICATION_KIND_KEYS) {
      const item = draft.kinds[kind]
      out.push(item.title, item.message ?? '', ...Object.values(item.categoryLabels ?? {}))
    }
    out.push(...Object.values(draft.marketRefundMessage), draft.broadcast.memberLabel, draft.broadcast.notAdvertisingStatement, draft.broadcast.redactedText)
    return out
  }, [draft])
  const piiHits = useMemo(() => piiOf(allTexts, piiAllowed), [allTexts, piiAllowed])
  const changedKinds = MEMBER_NOTIFICATION_KIND_KEYS.filter((kind) => JSON.stringify(draft.kinds[kind]) !== JSON.stringify(texts.kinds[kind]))
  const disabledKinds = MEMBER_NOTIFICATION_KIND_KEYS.filter((kind) => !draft.kinds[kind].enabled)
  const marketChanged = JSON.stringify(draft.marketRefundMessage) !== JSON.stringify(texts.marketRefundMessage)
  const broadcastChanged = JSON.stringify(draft.broadcast) !== JSON.stringify(texts.broadcast)
  const statementChanged = draft.broadcast.notAdvertisingStatement.trim() !== texts.broadcast.notAdvertisingStatement.trim()
  const dirty = changedKinds.length > 0 || marketChanged || broadcastChanged

  const setKind = (kind: MemberNotificationKind, patch: Partial<MemberNotificationTexts['kinds'][MemberNotificationKind]>) =>
    setDraft((current) => ({ ...current, kinds: { ...current.kinds, [kind]: { ...current.kinds[kind], ...patch } } }))

  const save = () => {
    startTransition(async () => {
      const result = await saveMemberNotificationTextsAction(texts.revision, draft)
      setConfirmOpen(false)
      if (result.ok) {
        toast.success(result.changed ? '알림 문구를 저장했습니다.' : '바뀐 것이 없습니다.')
        router.refresh()
        return
      }
      toast.error(result.error)
      // 판 충돌이면 최신 값을 다시 읽는다(쓰던 값은 버려진다).
      if (result.conflict) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          종류를 더하거나 지울 수 없습니다. 회원에게 불리한 결과를 알리는 세 종류(크레딧 회수·마켓 환불 거절·충전 환불 거절)는 끌 수 없고 내용에 {'{사유}'} 가 꼭 있어야 합니다.
        </p>
        <Button onClick={() => setConfirmOpen(true)} disabled={pending || !dirty || problem !== null || piiHits.length > 0}>저장</Button>
      </div>
      {problem ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">고칠 칸: {memberNotificationFieldLabel(problem)} — 비었거나 너무 길거나, 쓸 수 없는 자리표시가 있습니다.</p> : null}
      {piiHits.length > 0 ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          개인정보로 보이는 글이 있습니다({piiHits.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')}). 고객센터 연락처 말고는 적지 마세요.
        </p>
      ) : null}

      {MEMBER_NOTIFICATION_KIND_KEYS.map((kind) => {
        const spec = MEMBER_NOTIFICATION_KINDS[kind]
        const item = draft.kinds[kind]
        const rendered = renderMemberNotification(kind, draft, { values: SAMPLE_VALUES, categoryKey: 'event', marketRefund: SAMPLE_MARKET_REFUND })
        const id = `member-notification-${kind}`
        return (
          <Card key={kind} className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{spec.label}</CardTitle>
                  <CardDescription>{spec.when} · 받는 화면: {spec.screen}</CardDescription>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={spec.canDisable ? item.enabled : true}
                    disabled={!spec.canDisable}
                    onCheckedChange={(checked) => setKind(kind, { enabled: checked })}
                  />
                  켜기
                </label>
              </div>
              {!spec.canDisable ? <p className="text-xs text-gray-500">회원에게 불리한 결과를 알리는 알림이라 끌 수 없습니다(환불정책: 거절할 때는 언제나 사유를 알립니다).</p> : null}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-title`}>제목</Label>
                  <Input id={`${id}-title`} value={item.title} onChange={(event) => setKind(kind, { title: event.target.value })} />
                  <p className={`text-right text-xs ${charLength(item.title) > MEMBER_NOTIFICATION_TITLE_MAX ? 'text-red-700' : 'text-gray-400'}`}>{charLength(item.title)}/{MEMBER_NOTIFICATION_TITLE_MAX}</p>
                </div>
                {spec.titleOnly ? (
                  <p className="text-xs text-gray-500">내용은 아래 &apos;마켓 환불 문장&apos; 4개로 만듭니다.</p>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-message`}>내용{spec.required.length > 0 ? ` (${spec.required.join(', ')} 필수)` : ''}</Label>
                    <Textarea id={`${id}-message`} rows={3} value={item.message ?? ''} onChange={(event) => setKind(kind, { message: event.target.value })} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {spec.placeholders.filter((token) => token !== '{분류}' || kind === 'creditGranted').map((token) => (
                          <Button key={token} type="button" size="sm" variant="outline" onClick={() => setKind(kind, { message: `${item.message ?? ''}${token}` })}>
                            {token}
                          </Button>
                        ))}
                      </div>
                      <p className={`text-xs ${charLength(item.message ?? '') > MEMBER_NOTIFICATION_MESSAGE_MAX ? 'text-red-700' : 'text-gray-400'}`}>{charLength(item.message ?? '')}/{MEMBER_NOTIFICATION_MESSAGE_MAX}</p>
                    </div>
                  </div>
                )}
                {kind === 'creditGranted' ? (
                  <div className="grid grid-cols-2 gap-2">
                    {CREDIT_GRANT_CATEGORY_KEYS.map((key) => (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={`${id}-category-${key}`}>분류 이름: {CATEGORY_LABELS[key]}</Label>
                        <Input
                          id={`${id}-category-${key}`}
                          value={item.categoryLabels?.[key] ?? ''}
                          onChange={(event) => setKind(kind, { categoryLabels: { ...(item.categoryLabels as Record<CreditGrantCategoryKey, string>), [key]: event.target.value } })}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500">예시(벨에서 보이는 모양, 예시 값)</p>
                <div className="rounded-md border bg-white p-3">
                  {rendered
                    ? <NotificationBellItemBody notification={{ title: rendered.title, message: rendered.message, type: rendered.type, is_read: false }} />
                    : <p className="text-sm text-red-700">예시를 그릴 수 없습니다(쓸 수 없는 자리표시, 빈 칸, 필수 자리표시 빠짐). 이대로면 이 알림은 가지 않습니다.</p>}
                </div>
                {spec.canDisable && !item.enabled ? <p className="text-xs text-amber-800">꺼져 있습니다 — 회원에게 이 알림을 보내지 않습니다.</p> : null}
              </div>
            </CardContent>
          </Card>
        )
      })}

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">마켓 환불 문장</CardTitle>
          <CardDescription>마켓 환불 승인·예외 환불 알림의 내용입니다. 해당하는 문장만 이어 붙입니다. {'{수량}'} 만 쓸 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {MARKET_REFUND_MESSAGE_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`market-sentence-${key}`}>{MARKET_SENTENCE_LABELS[key]}</Label>
              <Input
                id={`market-sentence-${key}`}
                value={draft.marketRefundMessage[key]}
                onChange={(event) => setDraft((current) => ({ ...current, marketRefundMessage: { ...current.marketRefundMessage, [key]: event.target.value } }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">공지 알림 설정</CardTitle>
          <CardDescription>머리표·보내기 상한(24시간)·광고가 아님 확인 문장·가림 문구입니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="broadcast-member-label">공지 머리표(벨·알림 목록)</Label>
            <Input id="broadcast-member-label" value={draft.broadcast.memberLabel} onChange={(event) => setDraft((current) => ({ ...current, broadcast: { ...current.broadcast, memberLabel: event.target.value } }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="broadcast-redacted-text">가림 문구(회수하며 가릴 때 기록 표의 제목·내용)</Label>
            <Input id="broadcast-redacted-text" value={draft.broadcast.redactedText} onChange={(event) => setDraft((current) => ({ ...current, broadcast: { ...current.broadcast, redactedText: event.target.value } }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="broadcast-all-limit">전체 보내기 상한(24시간, 1~5)</Label>
            <Input id="broadcast-all-limit" type="number" min={1} max={5} value={Number.isFinite(draft.broadcast.allMembersDailyLimit) ? draft.broadcast.allMembersDailyLimit : ''}
              onChange={(event) => setDraft((current) => ({ ...current, broadcast: { ...current.broadcast, allMembersDailyLimit: Number(event.target.value) } }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="broadcast-self-limit">나에게만 시험 상한(24시간, 1~50)</Label>
            <Input id="broadcast-self-limit" type="number" min={1} max={50} value={Number.isFinite(draft.broadcast.selfTestDailyLimit) ? draft.broadcast.selfTestDailyLimit : ''}
              onChange={(event) => setDraft((current) => ({ ...current, broadcast: { ...current.broadcast, selfTestDailyLimit: Number(event.target.value) } }))} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="broadcast-statement">광고가 아님 확인 문장(지금 판 {texts.broadcast.notAdvertisingStatementVersion})</Label>
            <Textarea id="broadcast-statement" rows={3} value={draft.broadcast.notAdvertisingStatement}
              onChange={(event) => setDraft((current) => ({ ...current, broadcast: { ...current.broadcast, notAdvertisingStatement: event.target.value } }))} />
            <p className="text-xs text-gray-500">바꾸면 판이 오릅니다. 보낼 때 확인한 판과 문장이 보낸 기록에 남습니다.</p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!pending) setConfirmOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>알림 문구를 저장할까요?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left leading-6">
              <span className="block">바뀐 종류: {changedKinds.length > 0 ? changedKinds.map((kind) => MEMBER_NOTIFICATION_KINDS[kind].label).join(', ') : '없음'}</span>
              {marketChanged ? <span className="block">마켓 환불 문장이 바뀝니다.</span> : null}
              {broadcastChanged ? <span className="block">공지 알림 설정이 바뀝니다.{statementChanged ? ' 광고가 아님 확인 문장이 바뀌어 판이 오릅니다.' : ''}</span> : null}
              <span className="block font-semibold text-amber-800">꺼진 종류: {disabledKinds.length > 0 ? disabledKinds.map((kind) => MEMBER_NOTIFICATION_KINDS[kind].label).join(', ') : '없음'}</span>
              <span className="block">저장하면 1분 안에 회원에게 가는 알림에 반영됩니다.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            <Button disabled={pending} onClick={save}>저장</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── 공지 알림 보내기 탭(7-3) ──────────────────────────────────────────────────────────────────────────
interface PreviewState {
  key: string
  operationKey: string
  preview: MemberBroadcastPreview
}

function BroadcastComposer({
  texts,
  notices,
  terms,
  piiAllowed,
  initialPostId,
  onSent,
}: {
  texts: MemberNotificationTexts
  notices: BroadcastNoticeOption[]
  terms: BroadcastTermsOption[]
  piiAllowed: NotificationsAdminProps['piiAllowed']
  initialPostId: string | null
  onSent: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const initialNotice = initialPostId ? notices.find((notice) => notice.id === initialPostId) ?? null : null
  const [title, setTitle] = useState(initialNotice ? initialNotice.title.slice(0, BROADCAST_TITLE_MAX) : '')
  const [message, setMessage] = useState('')
  // 연결: '' 없음 / 'notice:{id}' / 고정 경로 / 'terms:{slug}' — 자유 입력 주소는 없다
  const [linkChoice, setLinkChoice] = useState<string>(initialNotice ? `notice:${initialNotice.id}` : '')
  const [target, setTarget] = useState<BroadcastTarget>('self')
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const [agreedKey, setAgreedKey] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const postId = linkChoice.startsWith('notice:') ? linkChoice.slice('notice:'.length) : null
  const linkUrl = postId ? `/notices/${postId}` : linkChoice.startsWith('terms:') ? `/terms/${linkChoice.slice('terms:'.length)}` : linkChoice || null
  const draftKey = broadcastDraftKey({ target, title, message, linkUrl, postId })
  const preview = previewState && previewState.key === draftKey ? previewState : null
  const agreed = agreedKey === draftKey
  const piiHits = piiOf([title, message], piiAllowed)
  const statement = texts.broadcast.notAdvertisingStatement
  const statementVersion = texts.broadcast.notAdvertisingStatementVersion
  const versionMismatch = preview !== null && preview.preview.notAdvertisingStatementVersion !== statementVersion
  const inputOk = title.trim() !== '' && charLength(title.trim()) <= BROADCAST_TITLE_MAX && !/[\r\n]/.test(title)
    && message.trim() !== '' && charLength(message.trim()) <= BROADCAST_MESSAGE_MAX && piiHits.length === 0
  const canSend = preview !== null && inputOk && agreed && !versionMismatch && preview.preview.remaining > 0 && preview.preview.recipientCount > 0

  const runPreview = () => {
    startTransition(async () => {
      const result = await previewMemberBroadcastAction(target)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setPreviewState({ key: draftKey, operationKey: crypto.randomUUID(), preview: result.preview })
    })
  }

  const runSend = () => {
    if (!preview) return
    startTransition(async () => {
      const result = await sendMemberBroadcastAction({
        operationKey: preview.operationKey,
        target,
        title,
        message,
        linkUrl,
        postId,
        expectedCount: preview.preview.recipientCount,
        notAdvertisingVersion: statementVersion,
      })
      setConfirmOpen(false)
      if (!result.ok) {
        toast.error(result.code === 'BROADCAST_COUNT_CHANGED' ? `${result.error} 미리보기를 다시 해 주세요.` : result.error)
        if (result.code === 'BROADCAST_COUNT_CHANGED' || result.code === 'BROADCAST_RATE_LIMITED' || result.code === 'BROADCAST_IDEMPOTENCY_CONFLICT') setPreviewState(null)
        if (result.code === 'BROADCAST_CONFIRM_REQUIRED') router.refresh()
        return
      }
      toast.success(result.replayed ? '이미 보낸 요청입니다(다시 보내지 않았습니다).' : `${formatCount(result.recipientCount ?? 0)}명에게 보냈습니다.`)
      setPreviewState(null)
      setAgreedKey(null)
      setTitle('')
      setMessage('')
      setLinkChoice('')
      router.refresh()
      onSent()
    })
  }

  const sample = { title: title.trim() || '(제목)', message: message.trim() || '(내용)', type: ANNOUNCEMENT_NOTIFICATION_TYPE, link: linkUrl, is_read: false }

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">보낼 수 있는 알림인지 먼저 확인하세요(광고가 아님, 판 {statementVersion})</CardTitle>
          <CardDescription className="whitespace-pre-wrap text-gray-800">{statement}</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-gray-500">
          새 자료 출시·이벤트·할인·쿠폰·가격 안내는 광고성 정보라 이 화면으로 보내지 않습니다. 정보성 안내에 광고 내용이 섞여도 광고로 봅니다. 개인정보는 적지 마세요.
          약관 변경 고지는 공지 팝업·변경 예정 약관 게시가 맡고, 이 알림은 보조 안내일 뿐입니다.
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="broadcast-title">제목</Label>
            <Input id="broadcast-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            <p className={`text-right text-xs ${charLength(title.trim()) > BROADCAST_TITLE_MAX ? 'text-red-700' : 'text-gray-400'}`}>{charLength(title.trim())}/{BROADCAST_TITLE_MAX}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="broadcast-message">내용</Label>
            <Textarea id="broadcast-message" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} />
            <p className={`text-right text-xs ${charLength(message.trim()) > BROADCAST_MESSAGE_MAX ? 'text-red-700' : 'text-gray-400'}`}>{charLength(message.trim())}/{BROADCAST_MESSAGE_MAX}</p>
          </div>
          <div className="space-y-1">
            <Label>연결(누르면 가는 곳)</Label>
            <Select value={linkChoice || 'none'} onValueChange={(value) => setLinkChoice(value === 'none' ? '' : value)}>
              <SelectTrigger className="w-full md:w-[480px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">연결 없음</SelectItem>
                {notices.map((notice) => <SelectItem key={notice.id} value={`notice:${notice.id}`}>공지: {notice.title}</SelectItem>)}
                {BROADCAST_FIXED_LINKS.map((path) => <SelectItem key={path} value={path}>{FIXED_LINK_LABELS[path]} ({path})</SelectItem>)}
                {terms.map((item) => <SelectItem key={item.slug} value={`terms:${item.slug}`}>약관: {item.label} (/terms/{item.slug})</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">게시 중인 공지·정해진 경로만 고를 수 있습니다(판매·충전 화면은 연결하지 않습니다).</p>
          </div>
          <div className="space-y-1">
            <Label>대상</Label>
            <RadioGroup value={target} onValueChange={(value) => setTarget(value as BroadcastTarget)} className="flex flex-wrap gap-4">
              {(['self', 'all_members'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={value} /> {BROADCAST_TARGET_LABELS[value]}
                  <span className="text-xs text-gray-500">(24시간에 {value === 'self' ? texts.broadcast.selfTestDailyLimit : texts.broadcast.allMembersDailyLimit}회)</span>
                </label>
              ))}
            </RadioGroup>
          </div>
          {piiHits.length > 0 ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              개인정보로 보이는 글이 있습니다({piiHits.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')}). 보낼 수 없습니다.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="brandOutline" onClick={runPreview} disabled={pending || !inputOk}>미리보기</Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={pending || !canSend}>보내기</Button>
          </div>
          {previewState && !preview ? <p className="text-xs text-amber-800">입력이 바뀌어 미리보기가 풀렸습니다. 다시 미리보기를 해 주세요.</p> : null}
        </CardContent>
      </Card>

      {preview ? (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">미리보기</CardTitle>
            <CardDescription>
              받는 사람 {formatCount(preview.preview.recipientCount)}명 · 24시간 상한 {preview.preview.dailyLimit}회 중 {preview.preview.usedInWindow}회 사용(남은 {preview.preview.remaining}회)
              {preview.preview.nextAvailableAt ? ` · 다음 가능 시각 ${formatKstDateTime(preview.preview.nextAvailableAt)}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {versionMismatch ? <p role="alert" className="text-sm text-red-700">광고가 아님 확인 문장이 그사이 바뀌었습니다. 새로고침한 뒤 다시 확인하세요.</p> : null}
            {preview.preview.remaining === 0 ? <p role="alert" className="text-sm text-red-700">보내기 상한에 걸려 지금은 보낼 수 없습니다.</p> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-500">벨</p>
                <div className="w-80 rounded-md border bg-white p-4"><NotificationBellItemBody notification={sample} memberLabel={texts.broadcast.memberLabel} /></div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-500">알림 목록</p>
                <div className="rounded-md border bg-white px-4 py-4">
                  <NotificationListItemBody notification={sample} memberLabel={texts.broadcast.memberLabel} createdAtLabel={null} linkClassName="font-semibold text-blue-700" />
                </div>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={agreed} onCheckedChange={(checked) => setAgreedKey(checked === true ? draftKey : null)} className="mt-0.5" />
              위 확인 문장(판 {statementVersion})을 읽었고, 이 알림은 광고가 아닌 서비스 이용 안내입니다.
            </label>
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!pending) setConfirmOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공지 알림을 보낼까요?</AlertDialogTitle>
            <AlertDialogDescription className="text-left leading-6">
              {formatCount(preview?.preview.recipientCount ?? 0)}명에게 보냅니다. 보낸 뒤에는 고칠 수 없고 회수만 할 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            <Button variant="destructive" disabled={pending || !canSend} onClick={runSend}>보내기</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── 보낸 기록 탭(7-4) ───────────────────────────────────────────────────────────────────────────────
function BroadcastHistory({ history, canRedact }: { history: NotificationsAdminProps['history']; canRedact: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<MemberBroadcastHistoryItem | null>(null)
  const [reasonCode, setReasonCode] = useState<BroadcastRetractReasonCode>('mistake')
  const [redact, setRedact] = useState(false)

  if (history.status !== 'ok') {
    return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">보낸 기록을 읽지 못했습니다(16번 DB 적용 전이거나 읽기 실패). 새로고침해 주세요.</p>
  }
  if (history.items.length === 0) return <p className="text-sm text-gray-500">아직 보낸 공지 알림이 없습니다.</p>

  const open = (item: MemberBroadcastHistoryItem) => {
    // 이미 회수한 기록은 가림만(개인정보) 할 수 있다.
    setReasonCode(item.retractedAt ? 'pii' : 'mistake')
    setRedact(Boolean(item.retractedAt))
    setTarget(item)
  }
  const forcedRedact = reasonCode === 'pii'
  const run = () => {
    if (!target) return
    startTransition(async () => {
      const result = await retractMemberBroadcastAction(target.id, reasonCode, forcedRedact || redact)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.changed ? '회수했습니다. 회원의 알림 목록에서 지웠습니다.' : '이미 처리된 기록입니다.')
      setTarget(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">시각</th>
              <th className="px-3 py-2">보낸 사람</th>
              <th className="px-3 py-2">대상</th>
              <th className="px-3 py-2">인원</th>
              <th className="px-3 py-2">제목</th>
              <th className="px-3 py-2">연결</th>
              <th className="px-3 py-2">읽은 수</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {history.items.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">{formatKstDateTime(item.createdAt)}</td>
                <td className="px-3 py-2">{item.actorLabel}</td>
                <td className="px-3 py-2">{BROADCAST_TARGET_LABELS[item.target]}</td>
                <td className="px-3 py-2">{formatCount(item.recipientCount)}</td>
                <td className="px-3 py-2">{item.title}</td>
                <td className="px-3 py-2 text-xs">{item.linkUrl ?? '-'}</td>
                <td className="px-3 py-2">{item.readCount === null ? '확인 못 함' : formatCount(item.readCount)}</td>
                <td className="px-3 py-2">
                  {item.retractedAt ? (
                    <div className="space-y-1">
                      <Badge variant="secondary">회수 {formatKstDateTime(item.retractedAt)}</Badge>
                      <p className="text-xs text-gray-500">
                        {item.retractReasonCode ? BROADCAST_RETRACT_REASON_LABELS[item.retractReasonCode] : ''} · 지운 {item.retractedDeletedCount ?? 0}건
                      </p>
                      {item.redactedAt ? <Badge variant="outline">가림</Badge> : null}
                    </div>
                  ) : <Badge>보냄</Badge>}
                </td>
                <td className="px-3 py-2">
                  {!item.retractedAt ? (
                    <Button size="sm" variant="outline" onClick={() => open(item)} disabled={pending}>회수</Button>
                  ) : !item.redactedAt && canRedact ? (
                    <Button size="sm" variant="outline" onClick={() => open(item)} disabled={pending}>가림</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={target !== null} onOpenChange={(value) => { if (!value && !pending) setTarget(null) }}>
        <AlertDialogContent>
          {target ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{target.retractedAt ? '이 기록을 가릴까요?' : '이 공지 알림을 회수할까요?'}</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2 text-left leading-6">
                  {target.retractedAt
                    ? <span className="block">보낸 기록의 제목·내용이 가림 문구로 바뀌고 되돌릴 수 없습니다.</span>
                    : <span className="block">모든 회원의 알림 목록에서 지웁니다(읽은 수는 기록에 남습니다). 고친 글을 다시 보내면 두 번 가므로 고치기는 없습니다.</span>}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {!target.retractedAt ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>회수 사유</Label>
                    <Select value={reasonCode} onValueChange={(value) => setReasonCode(value as BroadcastRetractReasonCode)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BROADCAST_RETRACT_REASON_CODES.map((code) => <SelectItem key={code} value={code}>{BROADCAST_RETRACT_REASON_LABELS[code]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={forcedRedact || redact} disabled={forcedRedact || !canRedact} onCheckedChange={(checked) => setRedact(checked === true)} />
                    보낸 기록의 제목·내용도 가림(개인정보가 들어갔을 때)
                  </label>
                </div>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
                <Button variant="destructive" disabled={pending} onClick={run}>{target.retractedAt ? '가림' : '회수'}</Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
