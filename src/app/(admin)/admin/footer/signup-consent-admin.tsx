'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConsentChecklist } from '@/components/auth/consent-checklist'
import {
  formatConsentDate,
  SIGNUP_CONSENT_TEXT_KEYS,
  SIGNUP_CONSENT_TEXT_LABELS,
  type SignupConsentTexts,
} from '@/lib/signup-consent'
import type { AdminConsentItem, ConsentItemSaveResult, SaveConsentItemInput } from '@/lib/signup-consent-server'
import {
  reviseSignupConsentItemAction,
  saveSignupConsentItemAction,
  saveSignupConsentTextsAction,
  type ConsentPolicyOption,
  type SignupConsentAdminData,
} from './consent-actions'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { cn } from '@/lib/utils'

type Draft = SaveConsentItemInput & { lock: boolean | null }

const FIELD_NAMES: Record<string, string> = {
  label: '이름',
  content: '내용',
  required: '필수/선택',
  policy_slug: '연결 약관',
  sort_order: '순서',
  is_active: '보임',
}

function draftFromItem(item: AdminConsentItem): Draft {
  return {
    id: item.id,
    expectedVersion: item.version,
    expectedUpdatedAt: item.updated_at,
    label: item.label,
    content: item.content,
    required: item.required,
    policySlug: item.policy_slug,
    sortOrder: item.sort_order,
    isActive: item.is_active,
    note: '',
    lock: item.required_lock,
  }
}

// 저장 안 된 변경 수(저장 상태 줄 표시용): 고치기 시작한 값과 다른 칸 수. 새 항목은 늘 1 이상(지금처럼 바로 저장 가능).
function countDraftChanges(draft: Draft, origin: AdminConsentItem | null) {
  return origin ? countChangedFields(draft, draftFromItem(origin)) : 1
}

function newDraft(sortOrder: number): Draft {
  return {
    id: null,
    expectedVersion: null,
    expectedUpdatedAt: null,
    label: '',
    content: '',
    required: false,
    policySlug: null,
    sortOrder,
    isActive: false,
    note: '',
    lock: null,
  }
}

type PendingConfirm =
  | { kind: 'save'; draft: Draft; result: ConsentItemSaveResult }
  | { kind: 'revise'; item: AdminConsentItem; note: string; result: ConsentItemSaveResult }

function ReconsentDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
  policyOptions,
}: {
  pending: PendingConfirm | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
  policyOptions: ConsentPolicyOption[]
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  if (!pending) return null
  const preview = pending.kind === 'save' ? pending.draft : null
  const changed = pending.result.changed_fields.map((field) => FIELD_NAMES[field] ?? field)

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) { setAcknowledged(false); onCancel() } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>회원에게 다시 동의를 받습니다</DialogTitle>
          <DialogDescription className="space-y-2 text-left leading-6">
            <span className={cn('block font-semibold', ADMIN_TONE_TEXT_CLASSES.danger)}>
              기존 회원 {pending.result.affected_members ?? 0}명이 다음 접속 때 다시 동의합니다. 되돌릴 수 없습니다.
            </span>
            <span className="block">
              약관 변경은 15번 정식 고지 절차 순서로 합니다.
              ① 변경 예정 약관을 게시합니다(/terms/upcoming, 런북 절차 — 고지 증빙·고지 기간 잠금이 여기서 생깁니다).
              ② 회원에게 불리한 변경은 30일 전부터 공지 팝업을 켭니다(이용약관의 약관 변경 조항).
              ③ 필요하면 공지사항에도 같은 내용을 올립니다(보조).
              ④ 시행일 당일: 15번 시행 스크립트(런북)로 시행하면 본문 교체와 다시 동의가 함께 되므로 이 버튼을 누르지 않습니다.
              스크립트를 쓰지 않는 변경은 하단 정보 본문이 새 전문으로 바뀐 것을 확인한 뒤 누르세요.
            </span>
            <span className="block">오탈자 수정도 다시 동의 대상입니다 · 중요한 변경일 때만 쓰세요. 유료 크레딧이 남은 회원이 거부하면 CS 처리가 필요합니다.</span>
            {changed.length > 0 ? <span className="block">바뀐 칸: {changed.join(', ')}</span> : null}
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] p-3">
            <p className="mb-2 text-xs font-semibold text-[var(--studio-muted)]">회원 화면 미리보기</p>
            <ConsentChecklist
              items={[{
                id: 'preview',
                version: pending.result.after_version,
                label: preview.label,
                content: preview.content,
                required: preview.required,
                policyHref: preview.policySlug && policyOptions.some((option) => option.slug === preview.policySlug && option.available) ? `/terms/${preview.policySlug}` : null,
                note: preview.note,
                revisedAt: null,
              }]}
              checked={{}}
              onChange={() => {}}
              highlightMissing={false}
              privacyPolicyHref={null}
              optionalHint=""
              showRevisionNotes
            />
          </div>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} className="mt-0.5" />
          하단 정보의 약관 본문을 시행일 기준으로 바꿨습니까? (바꿨거나, 약관 본문과 관계없는 변경입니다)
        </label>
        <DialogFooter>
          <Button type="button" variant="brandOutline" disabled={busy} onClick={() => { setAcknowledged(false); onCancel() }}>취소</Button>
          <Button type="button" variant="adminDanger" disabled={busy || !acknowledged} onClick={onConfirm}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            다시 동의 받기로 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ItemEditor({
  draft,
  policyOptions,
  busy,
  dirtyCount,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft
  policyOptions: ConsentPolicyOption[]
  busy: boolean
  dirtyCount: number
  onChange: (next: Draft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const requiredLocked = draft.lock !== null
  return (
    <div className="grid gap-4 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] p-4 lg:grid-cols-2">
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="consent-label">이름</Label>
          <Input id="consent-label" value={draft.label} maxLength={100} onChange={(event) => onChange({ ...draft, label: event.target.value })} />
          <p className="text-xs text-[var(--studio-muted)]">[필수]/[선택] 표시는 화면이 붙입니다. 이름 앞에 쓰지 마세요.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="consent-content">내용(고지 본문)</Label>
          <Textarea id="consent-content" rows={8} value={draft.content} onChange={(event) => onChange({ ...draft, content: event.target.value })} />
          <p className="text-xs text-[var(--studio-muted)]">**강조할 문장**처럼 별표 두 개로 감싸면 굵게·밑줄·크게 보입니다(보유 기간·마케팅 목적 등).</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.required} disabled={requiredLocked} onCheckedChange={(value) => onChange({ ...draft, required: value })} />
            필수
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.isActive} disabled={draft.id === null || draft.lock === true} onCheckedChange={(value) => onChange({ ...draft, isActive: value })} />
            회원에게 보임
          </label>
          {requiredLocked ? <span className="text-xs text-[var(--studio-muted)]">{draft.lock ? '필수 고정 항목' : '선택 고정 항목'}</span> : null}
          {draft.id === null ? <span className="text-xs text-[var(--studio-muted)]">새 항목은 숨김으로 만들어 미리 본 뒤 켭니다.</span> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="consent-policy">연결 약관</Label>
            <select
              id="consent-policy"
              className="h-9 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-2 text-sm"
              value={draft.policySlug ?? ''}
              onChange={(event) => onChange({ ...draft, policySlug: event.target.value || null })}
            >
              <option value="">없음</option>
              {policyOptions.map((option) => (
                <option key={option.slug} value={option.slug} disabled={!option.available}>
                  {option.label}{option.available ? '' : '(꺼짐·빈 본문)'}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="consent-order">순서</Label>
            <Input id="consent-order" type="number" value={draft.sortOrder} onChange={(event) => onChange({ ...draft, sortOrder: Number(event.target.value) })} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="consent-note">회원에게 보이는 변경 안내(다시 동의를 받는 저장에 필수)</Label>
          <Input
            id="consent-note"
            value={draft.note ?? ''}
            placeholder="예: 2027년 3월 1일부터 환불 기간이 바뀝니다"
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
          />
        </div>
        {/* 저장 함수 하나 = 인라인 저장 줄 하나. 결과는 지금처럼 알림(toast)으로 보이고, 저장되면 이 편집 칸이 닫힌다. */}
        <div className="flex flex-wrap items-center gap-2">
          <AdminSaveBar
            className="min-w-0 flex-1"
            variant="inline"
            dirtyCount={dirtyCount}
            status={busy ? 'saving' : 'idle'}
            applyNote="다시 동의가 생기는 저장은 확인 창을 거칩니다."
            onSave={onSave}
            saveLabel="저장"
          />
          <Button type="button" variant="brandOutline" onClick={onCancel} disabled={busy}>취소</Button>
        </div>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-xs font-semibold text-[var(--studio-muted)]">회원 화면 미리보기</p>
        <ConsentChecklist
          items={[{
            id: 'preview',
            version: draft.expectedVersion ?? 1,
            label: draft.label || '(이름)',
            content: draft.content,
            required: draft.required,
            policyHref: draft.policySlug ? `/terms/${draft.policySlug}` : null,
            note: draft.note || null,
            revisedAt: null,
          }]}
          checked={{}}
          onChange={() => {}}
          highlightMissing={false}
          privacyPolicyHref={null}
          optionalHint=""
          showRevisionNotes
        />
      </div>
    </div>
  )
}

function TextsEditor({ initial }: { initial: SignupConsentTexts | null }) {
  const router = useRouter()
  const [texts, setTexts] = useState<SignupConsentTexts | null>(initial)
  // 저장 상태 줄(20번 3-2): 마지막으로 저장된 값·시각·실패 문구. 알림(toast)은 그대로 띄운다.
  const [savedTexts, setSavedTexts] = useState<SignupConsentTexts | null>(initial)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  if (!texts) {
    return <AdminNotice kind="error">안내 문구를 불러오지 못했습니다.</AdminNotice>
  }
  const changedCount = savedTexts ? countChangedFields(texts, savedTexts) : 1
  const saveTexts = () => startTransition(async () => {
    setSaveError(null)
    const response = await saveSignupConsentTextsAction(texts)
    if (!response.success) {
      toast.error(response.error)
      setSaveError(response.error)
      return
    }
    setTexts(response.data)
    setSavedTexts(response.data)
    setSavedAt(Date.now())
    toast.success('안내 문구를 저장했습니다.')
    router.refresh()
  })
  return (
    <div className="grid gap-3">
      {SIGNUP_CONSENT_TEXT_KEYS.map((key) => (
        <div key={key} className="grid gap-1.5">
          <Label htmlFor={`consent-text-${key}`}>{SIGNUP_CONSENT_TEXT_LABELS[key]}</Label>
          <Textarea
            id={`consent-text-${key}`}
            rows={key === 'declineConfirm' ? 4 : 2}
            maxLength={500}
            value={texts[key]}
            onChange={(event) => setTexts({ ...texts, [key]: event.target.value })}
          />
        </div>
      ))}
      <p className="text-xs text-[var(--studio-muted)]">처리 결과 안내 틀에는 {'{전송자}'}·{'{항목}'}·{'{결과}'}·{'{처리일자}'}, 접수 안내 틀에는 {'{항목}'}·{'{결과}'}를 모두 넣어야 합니다.</p>
      {/* 저장 함수 하나 = 인라인 저장 줄 하나 */}
      <AdminSaveBar
        variant="inline"
        dirtyCount={changedCount}
        status={busy ? 'saving' : saveError ? 'error' : savedAt ? 'saved' : 'idle'}
        savedAt={savedAt}
        errorMessage={saveError}
        onSave={saveTexts}
        saveLabel="안내 문구 저장"
      />
    </div>
  )
}

export function SignupConsentAdmin({ data, lockNotice = null }: { data: SignupConsentAdminData; lockNotice?: string | null }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  // 확인 창을 열 때마다 새로 그려 확인 체크가 늘 꺼진 채로 시작하게 한다.
  const [dialogKey, setDialogKey] = useState(0)
  const openConfirm = (next: PendingConfirm) => {
    setDialogKey((value) => value + 1)
    setPending(next)
  }
  const [reviseTarget, setReviseTarget] = useState<{ item: AdminConsentItem; note: string } | null>(null)
  const [busy, startTransition] = useTransition()

  if (!data.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>가입 동의 항목</CardTitle>
          <CardDescription className={ADMIN_TONE_TEXT_CLASSES.danger}>{data.error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const handleFailure = (code: string, error: string) => {
    toast.error(error)
    if (code === 'CONSENT_ITEM_VERSION_CONFLICT') {
      // 최신 행을 다시 읽는다(이미 반영됐는지, 다른 사람이 바꿨는지 화면에서 확인). 확인 창의 낡은 값으로 다시 저장하지 않게 닫는다.
      setPending(null)
      setDraft(null)
      router.refresh()
    }
  }

  const commitSave = (target: Draft) => {
    startTransition(async () => {
      const response = await saveSignupConsentItemAction(target, false)
      if (!response.success) {
        handleFailure(response.code, response.error)
        return
      }
      setPending(null)
      setDraft(null)
      toast.success(response.result.changed === false ? '바뀐 내용이 없습니다.' : '가입 동의 항목을 저장했습니다.')
      router.refresh()
    })
  }

  const startSave = (target: Draft) => {
    // 먼저 dry_run 으로 '다시 동의가 생기는지'를 본다. 확인에 실패하면 저장하지 않는다.
    startTransition(async () => {
      const preview = await saveSignupConsentItemAction(target, true)
      if (!preview.success) {
        handleFailure(preview.code, preview.error)
        return
      }
      if (preview.result.reconsent) {
        openConfirm({ kind: 'save', draft: target, result: preview.result })
        return
      }
      commitSave(target)
    })
  }

  const startRevise = (item: AdminConsentItem, note: string) => {
    startTransition(async () => {
      const preview = await reviseSignupConsentItemAction(item.id, item.version, note, true)
      if (!preview.success) {
        handleFailure(preview.code, preview.error)
        return
      }
      openConfirm({ kind: 'revise', item, note, result: preview.result })
    })
  }

  const confirmPending = () => {
    if (!pending) return
    if (pending.kind === 'save') {
      commitSave(pending.draft)
      return
    }
    startTransition(async () => {
      const response = await reviseSignupConsentItemAction(pending.item.id, pending.item.version, pending.note, false)
      if (!response.success) {
        handleFailure(response.code, response.error)
        return
      }
      setPending(null)
      setReviseTarget(null)
      toast.success('다시 동의 받기를 저장했습니다.')
      router.refresh()
    })
  }

  const policyLabel = (slug: string | null) => data.policyOptions.find((option) => option.slug === slug)?.label ?? '없음'
  const draftOrigin = draft?.id ? data.items.find((item) => item.id === draft.id) ?? null : null

  // 항목 표(열·버튼·막힘 조건은 전과 같다)
  const columns: AdminDataTableColumn<AdminConsentItem>[] = [
    { key: 'label', header: '이름', cell: (item) => <span className="font-medium">{item.label}</span> },
    { key: 'required', header: '구분', cell: (item) => (item.required ? '필수' : '선택') },
    {
      key: 'lock',
      header: '고정',
      className: 'text-xs text-[var(--studio-muted)]',
      cell: (item) => (item.required_lock === true ? '필수 고정' : item.required_lock === false ? '선택 고정' : '-'),
    },
    { key: 'policy', header: '연결 약관', cell: (item) => policyLabel(item.policy_slug) },
    { key: 'sort', header: '순서', numeric: true, cell: (item) => item.sort_order },
    { key: 'active', header: '보임', cell: (item) => (item.is_active ? '보임' : '숨김') },
    { key: 'version', header: '버전', numeric: true, cell: (item) => item.version },
    {
      key: 'revised',
      header: '마지막 개정',
      className: 'text-xs',
      cell: (item) => (item.revisedAt && item.version > 1 ? formatConsentDate(item.revisedAt) : '-'),
    },
    { key: 'agreed', header: '현재 버전 동의 회원', numeric: true, cell: (item) => item.agreedMembers ?? '-' },
    {
      key: 'actions',
      header: <span className="sr-only">작업</span>,
      align: 'right',
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="adminTable" disabled={busy} onClick={() => setDraft(draftFromItem(item))}>수정</Button>
          {item.required && item.is_active && item.policy_slug ? (
            <Button type="button" size="sm" variant="adminTable" disabled={busy} onClick={() => setReviseTarget({ item, note: '' })}>
              다시 동의 받기
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>가입 동의 항목 <span className="ml-1 text-xs font-normal text-[var(--studio-muted)]">대표 전용</span></CardTitle>
        <CardDescription className="space-y-1 leading-6">
          <span className="block">이럴 때 무엇을 누르나</span>
          <span className="block">· 이용약관 개정: 변경 예정 약관 게시(/terms/upcoming, 런북) → 불리한 변경은 30일 전부터 공지 팝업(필요하면 공지사항에도) → 시행일 당일 15번 시행 스크립트(이 화면에서 누르지 않음), 스크립트를 쓰지 않으면 하단 정보 본문이 새 전문으로 바뀐 것을 확인한 뒤 그 항목의 &lsquo;다시 동의 받기&rsquo;</span>
          <span className="block">· 수집 목적·항목·보유 기간 변경: 해당 동의 항목 내용을 고치면 자동으로 다시 동의(개인정보처리방침만 바꾸면 알리기만)</span>
          <span className="block">· 마케팅 문구 변경: 동의 기록이 있으면 새 선택 항목을 만들고 옛 항목을 숨김</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* 고지 기간(변경 예정 글 upcoming)에는 이용약관·개인정보 동의 항목 저장이 DB 트리거로 막힌다(15번 7-3). */}
        {lockNotice ? <AdminNotice kind="warning">{lockNotice}</AdminNotice> : null}
        <AdminDataTable columns={columns} rows={data.items} getRowKey={(item) => item.id} caption="가입 동의 항목" minWidth={860} />

        {reviseTarget ? (
          <div className="grid gap-2 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] p-4">
            <p className="text-sm font-semibold">&lsquo;{reviseTarget.item.label}&rsquo; 다시 동의 받기(연결 약관 본문을 바꿨을 때)</p>
            <Label htmlFor="consent-revise-note">회원에게 보이는 변경 안내</Label>
            <Input
              id="consent-revise-note"
              value={reviseTarget.note}
              placeholder="예: 2027년 3월 1일부터 환불 기간이 바뀝니다"
              onChange={(event) => setReviseTarget({ ...reviseTarget, note: event.target.value })}
            />
            <div className="flex gap-2">
              <Button type="button" variant="brand" disabled={busy || !reviseTarget.note.trim()} onClick={() => startRevise(reviseTarget.item, reviseTarget.note)}>
                확인 창 열기
              </Button>
              <Button type="button" variant="brandOutline" disabled={busy} onClick={() => setReviseTarget(null)}>취소</Button>
            </div>
          </div>
        ) : null}

        {draft ? (
          <ItemEditor
            draft={draft}
            policyOptions={data.policyOptions}
            busy={busy}
            dirtyCount={countDraftChanges(draft, draftOrigin)}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => startSave(draft)}
          />
        ) : (
          <div>
            <Button
              type="button"
              variant="brandOutline"
              disabled={busy}
              onClick={() => setDraft(newDraft(Math.max(0, ...data.items.map((item) => item.sort_order)) + 10))}
            >
              항목 추가
            </Button>
          </div>
        )}

        <div className="grid gap-3 border-t border-[var(--studio-border)] pt-4">
          <p className="text-sm font-semibold">안내 문구</p>
          <TextsEditor initial={data.texts} />
        </div>
      </CardContent>
      <ReconsentDialog
        key={dialogKey}
        pending={pending}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
        policyOptions={data.policyOptions}
      />
    </Card>
  )
}
