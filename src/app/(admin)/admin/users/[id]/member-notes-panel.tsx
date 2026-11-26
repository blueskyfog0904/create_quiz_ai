'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatKstDateTime } from '@/lib/kst-date-format'
import type { MemberNotesSectionData } from '@/lib/admin-member-suspension-server'

// 회원 상세의 '관리자 메모' 구역(계획 6-2). 회원에게는 보이지 않는다. 보기 members.view, 추가 members.memo,
// 지우기 작성자(members.memo)·대표, 가림 대표. 판정은 DB 함수가 다시 한다. 위쪽 안내(adminMemoGuide)는 정책 문구(DB)다.

export function MemberNotesPanel({ userId, data, capabilities }: {
  userId: string
  data: MemberNotesSectionData
  capabilities: { actorId: string; canMemo: boolean; isOwner: boolean }
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  if (data.withdrawn) {
    return <p className="text-sm text-gray-600">탈퇴로 지워짐 · 탈퇴 회원 기록은 회원 탈퇴 구역의 보관함 추가 기록으로 남깁니다.</p>
  }

  const call = async (key: string, url: string, payload: Record<string, unknown>, done: string) => {
    setBusy(key)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) throw new Error(result?.error ?? '처리하지 못했습니다.')
      toast.success(done)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '처리하지 못했습니다.')
      return false
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  const add = async () => {
    const text = body.trim()
    if (!text) return toast.error('메모를 적어 주세요.')
    if (text.length > 2000) return toast.error('메모는 2000자 이내로 적어 주세요.')
    if (await call('add', `/api/admin/users/${userId}/notes`, { action: 'add', body: text }, '메모를 남겼습니다.')) setBody('')
  }

  const remove = (noteId: string) => {
    if (!window.confirm('이 메모를 지울까요? 지운 메모도 탈퇴할 때까지 보관됩니다(개인정보처리방침 2·3절).')) return
    void call(noteId, `/api/admin/users/${userId}/notes`, { action: 'delete', noteId }, '메모를 지웠습니다.')
  }

  const redact = (noteId: string) => {
    if (!window.confirm('이 메모의 글을 가림 문구로 바꿀까요? 되돌릴 수 없습니다. 적지 말아야 할 개인정보(계좌·주민등록번호 등)가 적힌 경우에만 씁니다.')) return
    void call(noteId, `/api/admin/users/${userId}/notes/redact`, { noteId }, '메모를 가림 처리했습니다.')
  }

  return (
    <div className="space-y-4">
      {data.memoGuide && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{data.memoGuide}</p>}

      {capabilities.canMemo && (
        <div className="space-y-2">
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="h-20" maxLength={2000} aria-label="관리자 메모" />
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => void add()} disabled={busy !== null}>{busy === 'add' ? '저장 중…' : '메모 추가'}</Button>
          </div>
        </div>
      )}

      {data.notes.length === 0 ? <p className="text-sm text-gray-500">메모가 없습니다.</p> : (
        <ul className="divide-y">
          {data.notes.map((note) => {
            const canDelete = !note.deleted_at && (capabilities.isOwner || (capabilities.canMemo && note.created_by === capabilities.actorId))
            const canRedact = capabilities.isOwner && !note.redacted_at
            return (
              <li key={note.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    {formatKstDateTime(note.created_at)} · {data.authorLabels[note.created_by] ?? note.created_by}
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    {note.deleted_at && (
                      <Badge variant="outline" className="border-gray-300 text-gray-600">
                        지움 {formatKstDateTime(note.deleted_at)}{note.deleted_by ? ` · ${data.authorLabels[note.deleted_by] ?? note.deleted_by}` : ''}
                      </Badge>
                    )}
                    {note.redacted_at && (
                      <Badge variant="outline" className="border-amber-300 text-amber-800">
                        가림 {formatKstDateTime(note.redacted_at)}{note.redacted_by ? ` · ${data.authorLabels[note.redacted_by] ?? note.redacted_by}` : ''}
                      </Badge>
                    )}
                    {canDelete && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => remove(note.id)}>지우기</Button>}
                    {canRedact && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => redact(note.id)}>가림</Button>}
                  </div>
                </div>
                <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${note.deleted_at ? 'text-gray-400 line-through' : ''}`}>{note.body}</p>
              </li>
            )
          })}
        </ul>
      )}
      {data.truncated && <p className="text-xs text-gray-500">메모가 많아 최근 50건만 보입니다.</p>}
    </div>
  )
}
