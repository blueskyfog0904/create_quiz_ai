'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface WithdrawnTicketRow {
  id: string
  user_id: string
  status: string
  created_at: string
}

interface OpenedTicket {
  subject?: string | null
  message?: string | null
  admin_response?: string | null
  created_at?: string | null
  responded_at?: string | null
  response_edited_at?: string | null
  revisions?: Array<{ id: string; subject?: string | null; message?: string | null; written_at?: string | null }>
  // 13번: 답변 수정 이력(그때 회원이 보던 답변·수정 사유)
  answerRevisions?: Array<{ id: string; previous_response?: string | null; previous_shown_at?: string | null; reason?: string | null; created_at?: string | null }>
}

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'

// 10번(계획 6-6): 탈퇴 회원 문의는 RLS 로 문의 목록에서 빠진다. 건수 줄만 보여 주고, 대표가 사유를 적으면 열람 기록(사유·IP·기기)을 남기고 연다.
export function WithdrawnTicketsPanel({ summary, isOwner, highlightTicketId, reasonGuide }: {
  summary: { count: number; rows: WithdrawnTicketRow[] } | null
  isOwner: boolean
  highlightTicketId: string | null
  reasonGuide: string | null
}) {
  const [target, setTarget] = useState<WithdrawnTicketRow | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [opened, setOpened] = useState<OpenedTicket | null>(null)

  if (!summary) {
    return <p role="alert" className="mb-6 text-sm text-red-700">탈퇴 회원 문의 건수를 불러오지 못했습니다.</p>
  }
  if (summary.count === 0) return null

  const close = () => {
    setTarget(null)
    setReason('')
    setOpened(null)
  }

  const open = async () => {
    if (!target || !reason.trim()) return
    setPending(true)
    try {
      const response = await fetch(`/api/admin/users/${target.user_id}/withdrawal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read_ticket', ticketId: target.id, reason: reason.trim() }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || '문의를 열지 못했습니다.')
      setOpened(data.ticket as OpenedTicket)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문의를 열지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
      <p className="font-medium text-gray-900">탈퇴 회원 · 법정 보존 {summary.count.toLocaleString()}건</p>
      <p className="mt-1 text-xs text-gray-500">
        탈퇴한 회원의 문의는 목록에서 빠지고 분리 보관됩니다.{isOwner ? ' 열람하려면 사유를 적어 주세요(열람 기록이 남습니다).' : ' 대표만 열람할 수 있습니다.'}
      </p>
      {isOwner && summary.rows.length > 0 && (
        <ul className="mt-2 divide-y">
          {summary.rows.map((row) => (
            <li key={row.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${row.id === highlightTicketId ? 'bg-amber-50' : ''}`}>
              <span className="text-xs text-gray-600">
                접수 {formatDateTime(row.created_at)} · <Link href={`/admin/users/${row.user_id}`} className="text-blue-700 hover:underline">회원 상세</Link>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setTarget(row)}>열람</Button>
            </li>
          ))}
        </ul>
      )}
      {isOwner && summary.rows.length < summary.count && (
        <p className="mt-1 text-xs text-gray-500">최근 {summary.rows.length}건만 보입니다.</p>
      )}

      <Dialog open={target !== null} onOpenChange={(next) => { if (!next) close() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>탈퇴 회원 문의 열람</DialogTitle>
            <DialogDescription>열람 사유와 요청 IP·기기가 작업 기록에 남습니다.{reasonGuide ? ` ${reasonGuide}` : ''}</DialogDescription>
          </DialogHeader>
          {opened ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium break-all">{opened.subject ?? '-'}</p>
              <p className="whitespace-pre-wrap break-all text-gray-700">{opened.message ?? ''}</p>
              {opened.admin_response && (
                <div className="rounded border bg-gray-50 p-2">
                  <p className="text-xs text-gray-500">답변 {formatDateTime(opened.responded_at)}{opened.response_edited_at ? ` · 수정 ${formatDateTime(opened.response_edited_at)}` : ''}</p>
                  <p className="whitespace-pre-wrap break-all">{opened.admin_response}</p>
                </div>
              )}
              {(opened.answerRevisions ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500">답변 수정 이력</p>
                  <ul className="mt-1 space-y-2">
                    {(opened.answerRevisions ?? []).map((revision) => (
                      <li key={revision.id} className="rounded border p-2 text-xs">
                        <p className="text-gray-500">보인 때 {formatDateTime(revision.previous_shown_at)} · 고친 때 {formatDateTime(revision.created_at)}</p>
                        <p className="whitespace-pre-wrap break-all">{revision.previous_response ?? ''}</p>
                        {revision.reason && <p className="mt-1 text-gray-500 break-all">수정 사유: {revision.reason}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(opened.revisions ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500">수정 이력</p>
                  <ul className="mt-1 space-y-2">
                    {(opened.revisions ?? []).map((revision) => (
                      <li key={revision.id} className="rounded border p-2 text-xs">
                        <p className="text-gray-500">{formatDateTime(revision.written_at)}</p>
                        <p className="font-medium break-all">{revision.subject ?? ''}</p>
                        <p className="whitespace-pre-wrap break-all">{revision.message ?? ''}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="열람 사유" />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>닫기</Button>
            {!opened && (
              <Button type="button" onClick={() => void open()} disabled={pending || !reason.trim()}>
                {pending ? '여는 중…' : '사유를 남기고 열람'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
