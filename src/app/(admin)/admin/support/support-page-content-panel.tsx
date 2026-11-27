'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import {
  SUPPORT_PAGE_MEMBER_KEY_GROUPS,
  SUPPORT_PAGE_MEMBER_KEY_LABELS,
  SUPPORT_PAGE_REQUIRED_KEYS,
  SUPPORT_PAGE_TEXT_MAX,
  type SupportPageContent,
  type SupportPageMemberKey,
} from '@/lib/support-page-content'
import { SupportView } from '@/app/(solvook)/mypage/support/_components/support-view'
import { getSupportPageContentAdminData, saveSupportPageContentAction } from './actions'

// 길게 쓰는 칸(여러 줄 입력)
const MULTILINE_KEYS: readonly SupportPageMemberKey[] = [
  'formNotice', 'responseTimeNote', 'defaultCategoryHelp', 'defaultMessagePlaceholder', 'submittedDescription',
  'deleteConfirmDescription',
]

// 13번 9절 '안내 문구' 탭(대표만 — Q9 가): 회원 고객지원 화면 문구를 항목별로 고친다. 필수 칸은 비울 수 없다.
// 빈칸 표시·열람 기록 보관 기간은 여기서 고치지 않는다(보이기만 한다).
export function SupportPageContentPanel({ initialContent, initialStatus }: {
  initialContent: SupportPageContent | null
  initialStatus: 'ok' | 'missing' | 'invalid' | 'error'
}) {
  const [content, setContent] = useState<SupportPageContent | null>(initialContent)
  const [draft, setDraft] = useState<SupportPageContent | null>(initialContent)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // 20번: 저장 줄의 실패·저장 시각 표시(알림 toast 는 그대로)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  if (!content || !draft) {
    const message = initialStatus === 'missing'
      ? '고객지원 문구 설정 행이 없습니다(13번 DB 적용 필요).'
      : initialStatus === 'invalid'
        ? '고객지원 문구 설정의 형식이 맞지 않습니다(필수 문구가 비었거나 값이 어긋남). 개발 담당에게 알려 주세요.'
        : '고객지원 문구를 읽지 못했습니다. 새로고침해 주세요.'
    return (
      <Card className="rounded-[var(--studio-radius-card)] border-[var(--studio-border)] shadow-none">
        <CardContent className="p-6"><AdminNotice kind="error">{message}</AdminNotice></CardContent>
      </Card>
    )
  }

  const setMember = (key: SupportPageMemberKey, value: string) => setDraft({ ...draft, member: { ...draft.member, [key]: value } })
  const emptyRequired = SUPPORT_PAGE_REQUIRED_KEYS.filter((key) => !draft.member[key].trim())
  const tooLong = (Object.keys(draft.member) as SupportPageMemberKey[]).filter((key) => draft.member[key].length > SUPPORT_PAGE_TEXT_MAX)

  const reload = async () => {
    const result = await getSupportPageContentAdminData()
    if (result.ok) {
      setContent(result.data)
      setDraft(result.data)
    }
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await saveSupportPageContentAction({
        revision: content.revision,
        member: draft.member,
        admin: { answerEditReasonGuide: draft.admin.answerEditReasonGuide },
      })
      if (!result.ok) {
        // 충돌이면 최신 값을 다시 읽는다(쓰던 값은 사라지므로 안내).
        if (result.conflict) await reload()
        throw new Error(result.error)
      }
      setContent(result.data)
      setDraft(result.data)
      setSavedAt(Date.now())
      toast.success('고객지원 문구를 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '고객지원 문구를 저장하지 못했습니다.')
      setSaveError(error instanceof Error ? error.message : '고객지원 문구를 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  // 저장 안 된 변경 수: 회원 문구 칸 + 관리자 설정(답변 수정 사유 안내)
  const dirtyCount = countChangedFields(draft.member, content.member)
    + (draft.admin.answerEditReasonGuide !== content.admin.answerEditReasonGuide ? 1 : 0)

  return (
    <Card className="rounded-[var(--studio-radius-card)] border-[var(--studio-border)] shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">안내 문구(회원 고객지원 화면)</CardTitle>
            <p className="mt-1 text-sm text-[var(--studio-muted)]">
              응답 시간 같은 약속이 들어 있어 대표만 고칩니다. * 표시는 비울 수 없는 칸이고, 나머지는 비우면 회원 화면에서 그 줄이 숨겨집니다.
            </p>
            {/* 16번 7-2: 답변 알림 문구·켜기는 '알림' 화면으로 옮겼다 */}
            <p className="mt-1 text-sm text-[var(--studio-muted)]">
              답변 알림 문구는 <Link href="/admin/notifications" className="font-medium text-[var(--studio-primary)] underline">&apos;알림&apos; 화면</Link>에서 고칩니다.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="brandOutline" onClick={() => setShowPreview((value) => !value)}>{showPreview ? '미리보기 닫기' : '미리보기'}</Button>
          </div>
        </div>
        {/* 저장 함수 하나(save) — 저장 줄 하나. 전의 [저장] 막힘 조건 그대로. */}
        <AdminSaveBar
          variant="inline"
          dirtyCount={dirtyCount}
          status={saving ? 'saving' : saveError ? 'error' : savedAt ? 'saved' : 'idle'}
          savedAt={savedAt}
          errorMessage={saveError}
          applyNote="저장하면 회원 고객지원 화면에 바로 반영됩니다."
          onSave={() => void save()}
          saveLabel="저장"
          saveDisabled={saving || emptyRequired.length > 0 || tooLong.length > 0}
        />
        {emptyRequired.length > 0 && (
          <AdminNotice kind="error">비울 수 없는 칸: {emptyRequired.map((key) => SUPPORT_PAGE_MEMBER_KEY_LABELS[key]).join(', ')}</AdminNotice>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {showPreview && (
          <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
            <p className="mb-3 text-xs text-[var(--studio-muted)]">미리보기(저장 전 값, 버튼은 눌리지 않습니다)</p>
            <fieldset disabled className="pointer-events-none">
              <SupportView tickets={[]} categories={[]} userId="preview" texts={draft.member} />
            </fieldset>
          </div>
        )}

        {SUPPORT_PAGE_MEMBER_KEY_GROUPS.map((group) => (
          <section key={group.label} className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--studio-ink)]">{group.label}</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {group.keys.map((key) => {
                const required = SUPPORT_PAGE_REQUIRED_KEYS.includes(key)
                const value = draft.member[key]
                const id = `support-content-${key}`
                return (
                  <div key={key} className={`space-y-1 ${MULTILINE_KEYS.includes(key) ? 'md:col-span-2' : ''}`}>
                    <Label htmlFor={id}>{SUPPORT_PAGE_MEMBER_KEY_LABELS[key]}{required ? ' *' : ''}</Label>
                    {MULTILINE_KEYS.includes(key) ? (
                      <Textarea id={id} rows={3} value={value} onChange={(event) => setMember(key, event.target.value)} />
                    ) : (
                      <Input id={id} value={value} onChange={(event) => setMember(key, event.target.value)} />
                    )}
                    <p className={`text-right text-xs ${value.length > SUPPORT_PAGE_TEXT_MAX ? 'text-[var(--admin-tone-danger-text)]' : 'text-[var(--studio-muted)]'}`}>{value.length}/{SUPPORT_PAGE_TEXT_MAX}</p>
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold text-[var(--studio-ink)]">관리자 설정</h3>
          <div className="space-y-1">
            <Label htmlFor="support-content-reason-guide">답변 수정 사유 안내(관리자 답변 창)</Label>
            <Textarea
              id="support-content-reason-guide"
              rows={2}
              value={draft.admin.answerEditReasonGuide}
              onChange={(event) => setDraft({ ...draft, admin: { ...draft.admin, answerEditReasonGuide: event.target.value } })}
            />
          </div>
          <p className="text-xs text-[var(--studio-muted)]">
            템플릿 빈칸 표시 <strong>{draft.admin.templateBlankMarker}</strong>, 열람 기록 보관 {draft.admin.accessLogRetentionYears}년 —
            이 두 값은 여기서 고치지 않습니다(템플릿·처리방침과 함께 바꿔야 해서 개발 담당이 스크립트로 바꿉니다).
          </p>
        </section>
      </CardContent>
    </Card>
  )
}
