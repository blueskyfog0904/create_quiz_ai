'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { StudioAlertDialog } from '@/components/design-system/studio-dialog'
import { SiteNoticePopupDialog } from '@/components/notice/site-notice-popup'
import {
  NOTICE_POPUP_BODY_MAX,
  NOTICE_POPUP_LINK_LABEL_MAX,
  NOTICE_POPUP_LINK_MAX,
  NOTICE_POPUP_TITLE_MAX,
  POLICY_UPCOMING_PATH,
  getNoticePopupVisibility,
  getNoticeRecordProblems,
  isoToKstLocalInput,
  kstLocalInputToIso,
  normalizeNoticePopupInput,
  validateNoticePopupInput,
  type NoticePopupInput,
  type NoticeRecordProblem,
  type SiteNoticePopupValue,
} from '@/lib/site-notice-popup'
import { saveNoticePopupAction, type NoticePopupAdminData } from './notice-popup-actions'

type LoadedData = Extract<NoticePopupAdminData, { ok: true }>

interface Draft {
  enabled: boolean
  title: string
  body: string
  linkUrl: string
  linkLabel: string
  startsLocal: string
  endsLocal: string
}

// 입력 검사에서 틀린 칸별 안내(validateNoticePopupInput 이 돌려주는 칸 이름)
const INPUT_PROBLEM_LABELS: Record<string, string> = {
  title: '제목은 한 줄, 1~60자로 적어 주세요.',
  body: '본문은 1~1200자로 적어 주세요.',
  linkUrl: '링크는 / 로 시작하는 사이트 안 주소만 쓸 수 있습니다(// 로 시작하거나 공백이 있으면 안 됨, 200자 이하).',
  linkLabel: '링크가 있으면 링크 이름을 1~20자로 적어 주세요.',
  date: '노출 시작·끝 시각을 다시 확인해 주세요.',
  endsAt: '노출 끝은 시작보다 뒤여야 하고, 켤 때는 노출 끝이 지금보다 뒤여야 합니다.',
}

// 변경 예정 글 상태 값의 화면 글
const UPCOMING_STATUS_LABELS: Record<string, string> = {
  upcoming: '고지 중',
  applied: '시행됨',
  reverted: '되돌림',
}

const VISIBILITY_LABELS = {
  visible: '지금 회원에게 보임',
  off: '꺼짐',
  not_started: '시작 전',
  ended: '끝남',
} as const

// 7-2: 30일 고지를 끊는 저장(게시 행이 upcoming 일 때). 판정은 isNoticeRecordGood 과 같은 getNoticeRecordProblems 하나로 한다.
const RECORD_PROBLEM_LABELS: Record<NoticeRecordProblem, string> = {
  disabled: '팝업을 끕니다.',
  ends_before_effective: '노출 끝이 시행일 00:00(한국 시각)보다 앞입니다.',
  starts_later: '노출 시작이 지금보다 뒤입니다.',
  link_not_upcoming: `링크가 ${POLICY_UPCOMING_PATH} 가 아닙니다(뒤에 #·쿼리·/ 가 붙어도 다른 링크로 봅니다).`,
  body_missing_date: '본문에 시행일 글자가 없습니다.',
}

const CONTINUITY_REASON_LABELS: Record<string, string> = {
  NO_PUBLICATION: '변경 예정 글이 없습니다.',
  NOT_UPCOMING: '변경 예정 글이 고지 중 상태가 아닙니다.',
  PUBLISHED_AFTER_DEADLINE: '변경 예정 글 게시가 고지 마감일 뒤입니다.',
  NO_RECORDS: '게시 뒤 팝업 저장 기록이 없습니다.',
  LAST_NOT_GOOD: '마지막 팝업 저장이 고지 조건을 깹니다.',
  START_AFTER_DEADLINE: '끊김 없이 이어진 고지의 시작이 고지 마감일 뒤입니다.',
  REVISION_MISMATCH: '팝업이 기록 밖에서 바뀌었습니다.',
  ARG_MISMATCH: '판정 인자가 게시 행 값과 다릅니다.',
}

function toDraft(value: SiteNoticePopupValue): Draft {
  return {
    enabled: value.enabled,
    title: value.title,
    body: value.body,
    linkUrl: value.linkUrl ?? '',
    linkLabel: value.linkLabel ?? '',
    startsLocal: isoToKstLocalInput(value.startsAt),
    endsLocal: isoToKstLocalInput(value.endsAt),
  }
}

function toInput(draft: Draft): NoticePopupInput {
  return normalizeNoticePopupInput({
    enabled: draft.enabled,
    title: draft.title,
    body: draft.body,
    linkUrl: draft.linkUrl,
    linkLabel: draft.linkLabel,
    startsAt: kstLocalInputToIso(draft.startsLocal),
    endsAt: kstLocalInputToIso(draft.endsLocal),
  })
}

const formatKst = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms)
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
    : '-'
}

const short = (sha: string) => (sha ? sha.slice(0, 12) : '-')

interface PendingSave {
  input: NoticePopupInput
  lines: string[]
  problems: NoticeRecordProblem[]
}

// 15번 계획 7절: '사이트 기본 정보' 안 대표 전용 '공지 팝업' 카드.
export function NoticePopupAdmin({ data: initialData }: { data: NoticePopupAdminData }) {
  const router = useRouter()
  const [data, setData] = useState<NoticePopupAdminData>(initialData)
  const [draft, setDraft] = useState<Draft | null>(initialData.ok ? toDraft(initialData.popup) : null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pending, setPending] = useState<PendingSave | null>(null)
  const [saving, setSaving] = useState(false)

  if (!data.ok || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>공지 팝업</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-destructive">{data.ok ? '공지 팝업 설정을 불러오지 못했습니다.' : data.error}</p>
        </CardContent>
      </Card>
    )
  }

  const loaded: LoadedData = data
  const saved = loaded.popup
  const upcoming = loaded.upcoming
  const set = (next: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...next } : current))

  const applyLoaded = (next: NoticePopupAdminData) => {
    setData(next)
    if (next.ok) setDraft(toDraft(next.popup))
  }

  const openConfirm = () => {
    const input = toInput(draft)
    const now = Date.now()
    const invalidField = validateNoticePopupInput(input, now)
    if (invalidField) {
      toast.error(INPUT_PROBLEM_LABELS[invalidField] ?? '입력값을 확인해 주세요.')
      return
    }
    const lines: string[] = []
    const contentChanged = input.title !== saved.title || input.body !== saved.body
      || input.linkUrl !== saved.linkUrl || input.linkLabel !== saved.linkLabel
    if (contentChanged) lines.push('내용이 바뀌어 이미 닫은 회원에게도 다시 보입니다.')
    if (!saved.enabled && input.enabled) lines.push('지금부터 회원에게 보입니다.')
    const problems = upcoming?.status === 'upcoming'
      ? getNoticeRecordProblems(input, { effectiveDate: upcoming.effectiveDate, effectiveDateLabel: upcoming.effectiveDateLabel }, now)
      : []
    setPending({ input, lines, problems })
  }

  const save = async () => {
    if (!pending || saving) return
    setSaving(true)
    try {
      const result = await saveNoticePopupAction(saved.revision, pending.input)
      if (!result.success) {
        toast.error(result.error)
        if (result.data) applyLoaded(result.data)
        return
      }
      applyLoaded(result.data)
      toast.success(result.changed ? '공지 팝업을 저장했습니다.' : '바뀐 내용이 없어 저장하지 않았습니다.')
      router.refresh()
    } catch {
      toast.error('공지 팝업을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
      setPending(null)
    }
  }

  const visibility = getNoticePopupVisibility(saved, Date.now())
  const previewContent = toInput(draft)
  const bodyLength = Array.from(draft.body).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>공지 팝업 <span className="ml-1 text-xs font-normal text-gray-500">대표 전용</span></CardTitle>
        <CardDescription>회원 화면에 처음 들어올 때 뜨는 공지입니다. 관리자·충전·결제·장바구니 화면에는 뜨지 않습니다. 저장할 때마다 원문이 작업 기록에 남습니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {VISIBILITY_LABELS[visibility]} · 지문 {short(saved.contentSha256)} · 판 {saved.revision} · 마지막 저장 {formatKst(loaded.popupUpdatedAt)}
        </p>

        <div className="flex items-center gap-3">
          <Switch id="notice-popup-enabled" checked={draft.enabled} disabled={saving} onCheckedChange={(checked) => set({ enabled: checked })} />
          <Label htmlFor="notice-popup-enabled">켜기</Label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notice-popup-title">제목(한 줄)</Label>
          <Input id="notice-popup-title" value={draft.title} maxLength={NOTICE_POPUP_TITLE_MAX} disabled={saving} onChange={(event) => set({ title: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notice-popup-body">본문</Label>
          <Textarea id="notice-popup-body" rows={12} value={draft.body} disabled={saving} onChange={(event) => set({ body: event.target.value })} />
          <p className={bodyLength > NOTICE_POPUP_BODY_MAX ? 'text-xs text-destructive' : 'text-xs text-gray-500'}>{bodyLength} / {NOTICE_POPUP_BODY_MAX}자</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="notice-popup-link">링크 주소(사이트 안, / 로 시작)</Label>
            <Input id="notice-popup-link" value={draft.linkUrl} maxLength={NOTICE_POPUP_LINK_MAX} disabled={saving} onChange={(event) => set({ linkUrl: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notice-popup-link-label">링크 이름</Label>
            <Input id="notice-popup-link-label" value={draft.linkLabel} maxLength={NOTICE_POPUP_LINK_LABEL_MAX} disabled={saving} onChange={(event) => set({ linkLabel: event.target.value })} />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="notice-popup-starts">노출 시작(한국 시각, 비우면 켠 때부터)</Label>
            <Input id="notice-popup-starts" type="datetime-local" value={draft.startsLocal} disabled={saving} onChange={(event) => set({ startsLocal: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notice-popup-ends">노출 끝(한국 시각)</Label>
            <Input id="notice-popup-ends" type="datetime-local" value={draft.endsLocal} disabled={saving} onChange={(event) => set({ endsLocal: event.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)} disabled={!previewContent.title || !previewContent.body}>
            <Eye className="mr-2 h-4 w-4" />
            미리보기
          </Button>
          <Button type="button" onClick={openConfirm} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="mr-2 h-4 w-4" />}
            저장
          </Button>
        </div>

        {loaded.continuity ? (
          <p role="status" className={loaded.continuity.ok ? 'text-sm text-emerald-700' : 'text-sm text-destructive'}>
            고지 끊김 판정: {loaded.continuity.ok
              ? `이어짐(고지 시작 기록 ${formatKst(loaded.continuity.sSavedAt)})`
              : `끊김 — ${CONTINUITY_REASON_LABELS[loaded.continuity.reason ?? ''] ?? loaded.continuity.reason ?? '알 수 없음'}`}
          </p>
        ) : null}

        <section aria-labelledby="notice-popup-upcoming-title" className="rounded-lg border p-4">
          <h3 id="notice-popup-upcoming-title" className="text-sm font-semibold text-gray-900">변경 예정 글 상태(읽기만 — 글은 스크립트로만 바꿉니다)</h3>
          {upcoming ? (
            <div className="mt-2 space-y-1 text-sm text-gray-700">
              <p>상태 {UPCOMING_STATUS_LABELS[upcoming.status] ?? upcoming.status} · 시행일 {upcoming.effectiveDateLabel || upcoming.effectiveDate} · 게시 {formatKst(upcoming.publishedAt)}</p>
              <ul className="list-disc pl-5">
                {upcoming.documents.map((document) => (
                  <li key={document.key}>{document.title}: 지문 {short(document.sha256)} · 바뀌는 부분 {document.changeCount}건</li>
                ))}
                {upcoming.consentItems.map((item) => (
                  <li key={item.key}>동의 항목 {item.label}: 지문 {short(item.sha256)}</li>
                ))}
              </ul>
              <Link href={POLICY_UPCOMING_PATH} className="text-sm font-semibold underline underline-offset-4">{POLICY_UPCOMING_PATH} 열기</Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">게시된 변경 예정 글이 없습니다.</p>
          )}
        </section>
      </CardContent>

      <SiteNoticePopupDialog
        open={previewOpen}
        content={previewContent}
        onClose={() => setPreviewOpen(false)}
        onHideToday={() => setPreviewOpen(false)}
        onLinkClick={(event) => {
          event.preventDefault()
          setPreviewOpen(false)
        }}
      />

      <StudioAlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null)
        }}
        title="공지 팝업을 저장할까요?"
        description={pending ? (
          <span className="block space-y-2 text-left">
            {pending.lines.map((line) => <span key={line} className="block">{line}</span>)}
            {pending.problems.length > 0 ? (
              <span className="block font-semibold text-destructive">
                이렇게 저장하면 30일 고지가 끊긴 것으로 기록되어 시행일 스크립트가 멈춥니다.
                {pending.problems.map((problem) => <span key={problem} className="block font-normal">- {RECORD_PROBLEM_LABELS[problem]}</span>)}
              </span>
            ) : null}
            {pending.lines.length === 0 && pending.problems.length === 0 ? <span className="block">설정을 저장합니다.</span> : null}
          </span>
        ) : null}
        confirmLabel="저장"
        cancelLabel="취소"
        destructive={(pending?.problems.length ?? 0) > 0}
        pending={saving}
        onConfirm={save}
      />
    </Card>
  )
}
