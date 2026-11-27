'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { formatKstDateTime } from '@/lib/kst-date-format'
import { findTemplateBlanks, sha256Hex } from '@/lib/support-reply-template'
import { ReplyTemplatePicker, TemplateBlankPreview, type SupportReplyTemplateRow } from './reply-template-tools'

export interface AnswerTicketState {
  id: string
  subject: string
  created_at: string
  category_id: string | null
  status: string | null
  admin_response: string | null
  responded_at: string | null
  response_edited_at?: string | null
  is_deleted_by_user: boolean | null
}

interface AnswerRevision {
  id: string
  previous_response: string
  previous_shown_at: string
  reason: string
  created_at: string
}

export const ANSWER_REASON_MAX = 300

// 13번 5절: 보낸 답변 고치기. 사유는 꼭 적고(1~300자), 이전 글은 서버(DB 함수)가 이력으로 남긴다. 회원은 고친 글만 본다.
// 회원이 삭제한 문의에는 버튼이 없다(탈퇴 회원 문의는 이 목록에 오지 않는다 — RLS).
export function TicketAnswerEdit({ ticket, draft, reasonGuide, blankMarker, templates, siteName, onSaved, onConflict }: {
  ticket: AnswerTicketState
  // 첫 답변 충돌 때 저장하지 못한 쓰던 글(있으면 수정 칸의 처음 값)
  draft?: string | null
  reasonGuide: string | null
  blankMarker: string | null
  templates: SupportReplyTemplateRow[] | null
  siteName: string
  onSaved: (ticket: Partial<AnswerTicketState>, notificationFailed: boolean) => void
  onConflict: (latest: Partial<AnswerTicketState> | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [operationKey, setOperationKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [revisions, setRevisions] = useState<{ rows: AnswerRevision[] | null; failed: boolean } | null>(null)
  const [revisionsOpen, setRevisionsOpen] = useState(false)

  if (!ticket.admin_response || ticket.is_deleted_by_user) return null

  const startEditing = () => {
    setText(draft ?? ticket.admin_response ?? '')
    setReason('')
    setOperationKey(crypto.randomUUID())
    setEditing(true)
  }

  const blanksLeft = blankMarker ? findTemplateBlanks(text, blankMarker).length > 0 : false
  const unchanged = text.trim() === (ticket.admin_response ?? '').trim()

  const save = async () => {
    if (!text.trim() || !reason.trim() || blanksLeft || unchanged) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminResponse: text,
          expectedSha256: await sha256Hex(ticket.admin_response ?? ''),
          reason: reason.trim(),
          operationKey,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (res.status === 409 && result.code === 'SUPPORT_ANSWER_CONFLICT') {
        // 최신 답변으로 바꿔 보이고, 쓰던 글은 그대로 둔다(확인 후 다시 저장 — 새 요청 키).
        onConflict(result.latest ?? null)
        setOperationKey(crypto.randomUUID())
        throw new Error(result.error || '다른 관리자가 먼저 답변을 고쳤습니다.')
      }
      if (!res.ok) throw new Error(result.error || '답변 수정에 실패했습니다.')
      setEditing(false)
      setRevisions(null)
      // 이전 답변 목록이 펼쳐져 있으면 바로 다시 불러온다(닫혀 있으면 다음에 펼칠 때)
      if (revisionsOpen) void loadRevisions(true)
      onSaved(result.ticket ?? {}, Boolean(result.notificationFailed))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '답변 수정에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const loadRevisions = async (force = false) => {
    if (revisions && !force) return
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticket.id}/answer-revisions`)
      const result = await res.json().catch(() => null)
      if (!res.ok || !result?.success) throw new Error(result?.error || 'failed')
      setRevisions({ rows: result.revisions as AnswerRevision[], failed: false })
    } catch {
      setRevisions({ rows: null, failed: true })
    }
  }

  return (
    <div className="space-y-3">
      {!editing && (
        <Button type="button" size="sm" variant="adminTable" onClick={startEditing}>
          <Pencil aria-hidden="true" className="mr-1 h-4 w-4" />
          답변 수정
        </Button>
      )}

      {editing && (
        <div className="space-y-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3">
          <p className="text-sm text-[var(--studio-text)]">회원은 고친 글만 봅니다. 이전 글은 기록으로 남습니다.</p>
          <div className="flex flex-wrap items-center gap-2">
            <ReplyTemplatePicker templates={templates} ticket={ticket} siteName={siteName} currentText={text} onInsert={setText} disabled={saving} />
          </div>
          <Textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} aria-label="고친 답변" data-admin-pii="" />
          <TemplateBlankPreview text={text} marker={blankMarker} />
          <div className="space-y-1">
            <Label htmlFor={`answer-edit-reason-${ticket.id}`}>수정 사유</Label>
            {reasonGuide && <p className="text-xs text-[var(--studio-muted)]">{reasonGuide}</p>}
            <Textarea id={`answer-edit-reason-${ticket.id}`} rows={2} maxLength={ANSWER_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />
            <p className="text-right text-xs text-[var(--studio-muted)]">{reason.length}/{ANSWER_REASON_MAX}</p>
          </div>
          {!blankMarker && <AdminNotice kind="error">답변 검사 설정을 읽지 못해 지금은 저장할 수 없습니다.</AdminNotice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="brandOutline" onClick={() => setEditing(false)} disabled={saving}>취소</Button>
            <Button type="button" variant="brand" onClick={() => void save()} disabled={saving || !blankMarker || !text.trim() || !reason.trim() || blanksLeft || unchanged}>
              {saving ? '저장 중...' : '수정 저장'}
            </Button>
          </div>
        </div>
      )}

      {ticket.response_edited_at && (
        <details className="rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm" onToggle={(event) => {
          const open = (event.target as HTMLDetailsElement).open
          setRevisionsOpen(open)
          if (open) void loadRevisions()
        }}>
          <summary className="cursor-pointer font-medium text-[var(--studio-ink)]">이전 답변 보기(열람 기록이 남습니다)</summary>
          {!revisions && <p className="mt-2 text-[var(--studio-muted)]">불러오는 중…</p>}
          {revisions?.failed && <AdminNotice kind="error" className="mt-2">이전 답변을 불러오지 못했습니다.</AdminNotice>}
          {revisions?.rows && revisions.rows.length === 0 && <p className="mt-2 text-[var(--studio-muted)]">이전 답변이 없습니다.</p>}
          {revisions?.rows && revisions.rows.length > 0 && (
            <ul className="mt-2 space-y-2">
              {revisions.rows.map((revision) => (
                <li key={revision.id} className="rounded border border-[var(--studio-border)] bg-[var(--studio-background)] p-2">
                  <p className="text-xs text-[var(--studio-muted)]">
                    보인 때 {formatKstDateTime(revision.previous_shown_at)} · 고친 때 {formatKstDateTime(revision.created_at)}
                  </p>
                  <p data-admin-pii="" className="mt-1 whitespace-pre-wrap text-[var(--studio-text)]">{revision.previous_response}</p>
                  <p className="mt-1 text-xs text-[var(--studio-muted)]">수정 사유: {revision.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}
