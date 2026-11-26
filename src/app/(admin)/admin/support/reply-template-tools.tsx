'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatKstDate } from '@/lib/kst-date-format'
import { fillSupportReplyTemplate, findTemplateBlanks, splitTemplateBlanks } from '@/lib/support-reply-template'

export interface SupportReplyTemplateRow {
  id: string
  title: string
  body: string
  category_id: string | null
  sort_order: number
  is_active: boolean
  deleted_at: string | null
  revision: number
  created_at: string
  updated_at: string
}

// 13번 6절 [템플릿 넣기]: 그 문의 카테고리의 템플릿을 먼저 보이고, 자리표시 세 가지를 채워 넣는다. 쓰던 글이 있으면 바꾸기 전에 묻는다.
export function ReplyTemplatePicker({ templates, ticket, siteName, currentText, onInsert, disabled }: {
  templates: SupportReplyTemplateRow[] | null
  ticket: { subject: string; created_at: string; category_id: string | null }
  siteName: string
  currentText: string
  onInsert: (text: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const usable = (templates ?? []).filter((template) => template.is_active && !template.deleted_at)
  const matching = usable.filter((template) => ticket.category_id && template.category_id === ticket.category_id)
  const others = usable.filter((template) => !matching.includes(template))

  const choose = (template: SupportReplyTemplateRow) => {
    if (currentText.trim() && !confirm('쓰던 답변을 이 템플릿으로 바꿀까요? 지금 쓴 글은 사라집니다.')) return
    onInsert(fillSupportReplyTemplate(template.body, {
      siteName,
      ticketSubject: ticket.subject,
      receivedDate: formatKstDate(ticket.created_at),
    }))
    setOpen(false)
  }

  const renderList = (title: string, list: SupportReplyTemplateRow[]) => list.length > 0 && (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-500">{title}</p>
      <ul className="divide-y rounded-md border">
        {list.map((template) => (
          <li key={template.id}>
            <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => choose(template)}>
              <span className="font-medium text-gray-900">{template.title}</span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-gray-500">{template.body}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={disabled || templates === null}>
        <FileText className="mr-1 h-4 w-4" />
        템플릿 넣기
      </Button>
      {templates === null && <span className="ml-2 text-xs text-red-700">템플릿을 불러오지 못했습니다.</span>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto max-md:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>답변 템플릿</DialogTitle>
            <DialogDescription>고르면 사이트 이름·문의 제목·접수일이 채워집니다. 빈칸은 직접 채워야 저장됩니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {usable.length === 0 && <p className="text-sm text-gray-500">사용 중인 템플릿이 없습니다. &apos;답변 템플릿&apos; 탭에서 추가해 주세요.</p>}
            {renderList('이 문의 카테고리', matching)}
            {renderList(matching.length > 0 ? '다른 템플릿' : '템플릿', others)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// 빈칸(DB 값 표시)이 남았으면 개수와 위치를 색으로 보인다.
// 템플릿 편집 화면은 빈칸이 있는 것이 정상이므로 안내 글(message)을 바꿔 쓴다.
export function TemplateBlankPreview({ text, marker, message }: { text: string; marker: string | null; message?: (count: number) => string }) {
  if (!marker) return null
  const count = findTemplateBlanks(text, marker).length
  if (count === 0) return null
  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">{message ? message(count) : `채우지 않은 빈칸 ${count}곳이 있습니다. 채워야 저장됩니다.`}</p>
      <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-gray-700">
        {splitTemplateBlanks(text, marker).map((part, index) => (
          part.blank
            ? <mark key={index} className="rounded bg-amber-300 px-0.5 text-amber-950">{part.text}</mark>
            : <span key={index}>{part.text}</span>
        ))}
      </p>
    </div>
  )
}
