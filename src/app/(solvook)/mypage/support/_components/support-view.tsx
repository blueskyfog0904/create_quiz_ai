'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StudioAlertDialog } from '@/components/design-system/studio-dialog'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { Database } from '@/types/supabase'
import type { SupportPageMemberTexts } from '@/lib/support-page-content'

type SupportCategory = Database['public']['Tables']['support_ticket_categories']['Row']
type SupportTicketBase = Database['public']['Tables']['support_tickets']['Row']
type SupportTicket = SupportTicketBase & {
  // 13번: 답변을 고친 시각(있으면 '수정됨 · 날짜')
  response_edited_at?: string | null
  support_ticket_categories?: Pick<SupportCategory, 'id' | 'slug' | 'name' | 'is_active' | 'deleted_at'> | null
}

interface SupportViewProps {
  tickets: SupportTicket[]
  categories: SupportCategory[]
  userId: string
  // 13번 9절: 화면 문구는 DB(support_page_content.member) 값이다. 선택 키가 비면 그 칸을 숨긴다.
  texts: SupportPageMemberTexts
}

const controlClassName =
  'min-h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-6'

const iconButtonClassName =
  'inline-flex min-h-9 min-w-9 items-center justify-center rounded-[var(--studio-radius-control)] text-[var(--studio-muted)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: {
    label: '대기중',
    className: 'bg-[var(--studio-background)] text-[var(--studio-muted)]',
  },
  in_progress: {
    label: '처리중',
    className: 'bg-[var(--studio-highlight)] text-[var(--studio-ink)]',
  },
  resolved: {
    label: '답변완료',
    className: 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]',
  },
  closed: {
    label: '종료',
    className: 'bg-[var(--studio-background)] text-[var(--studio-muted)]',
  },
}

function formatKoreanDate(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function formatKoreanDateTime(value: string) {
  const date = new Date(value)
  return `${formatKoreanDate(value)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getGuideItems(category: SupportCategory | undefined) {
  if (!category || !Array.isArray(category.guide_items)) return []

  return category.guide_items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function getTicketCategoryName(ticket: SupportTicket, uncategorizedLabel: string) {
  const category_snapshot = ticket.category_snapshot

  if (category_snapshot && typeof category_snapshot === 'object' && 'name' in category_snapshot) {
    const name = (category_snapshot as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) return name
  }

  return ticket.support_ticket_categories?.name || uncategorizedLabel
}

// 줄바꿈은 JSON 문자열의 \n 으로 저장된다(실제 줄바꿈과 글자 '\n' 모두 줄로 바꾼다).
const lines = (text: string) => text.replace(/\\n/g, '\n')

export function SupportView({ tickets, categories, userId, texts }: SupportViewProps) {
  const router = useRouter()
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id || '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // 등록 완료는 잠깐 뜨는 알림 대신 확인을 눌러야 닫히는 창으로 보여 준다(놓치지 않게).
  const [showSubmittedDialog, setShowSubmittedDialog] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [editMessage, setEditMessage] = useState('')

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId)
  const editCategory = categories.find((category) => category.id === editCategoryId)
  const selectedGuideItems = getGuideItems(selectedCategory)
  const editGuideItems = getGuideItems(editCategory)
  const selectedCategoryHelpId = selectedCategory ? 'support-category-help' : undefined

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedCategoryId) {
      toast.error(texts.needCategoryToast)
      return
    }

    if (!subject.trim() || !message.trim()) {
      toast.error(texts.needContentToast)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: selectedCategoryId, subject, message }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || texts.submitFailedToast)
      }

      setShowSubmittedDialog(true)
      setSelectedCategoryId(categories[0]?.id || '')
      setSubject('')
      setMessage('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : texts.submitFailedToast)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (ticketId: string) => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/support?id=${ticketId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || texts.deleteFailedToast)
      }

      toast.success(texts.deletedToast)
      setDeleteTargetId(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : texts.deleteFailedToast)
    } finally {
      setIsDeleting(false)
    }
  }

  const startEditing = (ticket: SupportTicket) => {
    setEditingId(ticket.id)
    setEditCategoryId(ticket.category_id || categories[0]?.id || '')
    setEditSubject(ticket.subject)
    setEditMessage(ticket.message)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditCategoryId('')
    setEditSubject('')
    setEditMessage('')
  }

  const handleUpdate = async (ticketId: string) => {
    if (!editCategoryId) {
      toast.error(texts.needCategoryToast)
      return
    }

    if (!editSubject.trim() || !editMessage.trim()) {
      toast.error(texts.needContentToast)
      return
    }

    try {
      const response = await fetch('/api/support', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          categoryId: editCategoryId,
          subject: editSubject,
          message: editMessage,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || texts.updateFailedToast)
      }

      toast.success(texts.updatedToast)
      cancelEditing()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : texts.updateFailedToast)
    }
  }

  return (
    <div data-user-id={userId}>
      <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">{texts.pageTitle}</h1>

      <section className={`mt-6 ${cardClassName}`}>
        <h2 className="text-lg font-bold text-[var(--studio-ink)]">{texts.formTitle}</h2>
        {texts.formNotice && (
          <p className="mt-1 whitespace-pre-line text-sm text-[var(--studio-muted)] break-keep">
            {lines(texts.formNotice)}
          </p>
        )}
        {texts.responseTimeNote && (
          <p className="mt-1 whitespace-pre-line text-sm text-[var(--studio-muted)] break-keep">
            {lines(texts.responseTimeNote)}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="support-category" className="text-sm font-semibold text-[var(--studio-ink)]">
              {texts.categoryLabel}
            </label>
            <select
              id="support-category"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              aria-describedby={selectedCategoryHelpId}
              className={controlClassName}
              required
            >
              <option value="" disabled>{texts.categoryPlaceholder}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>

          {selectedCategory && (selectedCategory.help_text || selectedCategory.description || texts.defaultCategoryHelp || selectedGuideItems.length > 0) && (
            <div
              id="support-category-help"
              className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3"
            >
              {/* 카테고리 안내: 아이콘 칸 없이 문장과 "·" 목록 */}
              {(selectedCategory.help_text || selectedCategory.description || texts.defaultCategoryHelp) && (
                <p className="text-sm font-semibold leading-6 text-[var(--studio-ink)] break-keep">
                  {selectedCategory.help_text || selectedCategory.description || texts.defaultCategoryHelp}
                </p>
              )}
              {selectedGuideItems.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-[13px] leading-5 text-[var(--studio-muted)] break-keep">
                  {selectedGuideItems.map((item) => (
                    <li key={item} className="flex gap-1.5">
                      <span aria-hidden="true">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="support-subject" className="text-sm font-semibold text-[var(--studio-ink)]">
              {texts.subjectLabel}
            </label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-describedby={selectedCategoryHelpId}
              placeholder={selectedCategory?.subject_placeholder || texts.defaultSubjectPlaceholder || undefined}
              className={controlClassName}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="support-message" className="text-sm font-semibold text-[var(--studio-ink)]">
              {texts.messageLabel}
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby={selectedCategoryHelpId}
              placeholder={lines(selectedCategory?.message_placeholder || texts.defaultMessagePlaceholder) || undefined}
              className={`${controlClassName} min-h-[190px] py-3`}
              required
            />
          </div>

          <Button
            type="submit"
            variant="brand"
            disabled={isSubmitting || categories.length === 0}
            className="min-h-11 w-full px-7 sm:w-auto"
          >
            {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {isSubmitting ? texts.submittingLabel : texts.submitLabel}
          </Button>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold text-[var(--studio-ink)]">{texts.historyTitle}</h2>
        {texts.historyIntro && (
          <p className="mt-1 text-sm text-[var(--studio-muted)] break-keep">
            {texts.historyIntro}
          </p>
        )}

        {tickets.length === 0 ? (
          <div className="mt-4">
            <StudioEmptyState
              title={texts.emptyTitle}
              description={texts.emptyDescription}
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--studio-border)] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
            {tickets.map((ticket) => {
              const badge = STATUS_BADGES[ticket.status ?? 'pending'] ?? STATUS_BADGES.pending

              return (
                <li key={ticket.id} className="p-5 sm:p-6">
                  {editingId === ticket.id ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label
                          htmlFor={`edit-category-${ticket.id}`}
                          className="text-sm font-semibold text-[var(--studio-ink)]"
                        >
                          {texts.editCategoryLabel}
                        </label>
                        <select
                          id={`edit-category-${ticket.id}`}
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className={controlClassName}
                        >
                          <option value="" disabled>{texts.categoryPlaceholder}</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                        {editGuideItems.length > 0 && (
                          <ul className="list-disc rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] p-3 pl-7 text-xs text-[var(--studio-muted)]">
                            {editGuideItems.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor={`edit-subject-${ticket.id}`}
                          className="text-sm font-semibold text-[var(--studio-ink)]"
                        >
                          {texts.editSubjectLabel}
                        </label>
                        <input
                          id={`edit-subject-${ticket.id}`}
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          placeholder={texts.editSubjectPlaceholder}
                          className={controlClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor={`edit-message-${ticket.id}`}
                          className="text-sm font-semibold text-[var(--studio-ink)]"
                        >
                          {texts.editMessageLabel}
                        </label>
                        <textarea
                          id={`edit-message-${ticket.id}`}
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                          placeholder={texts.editMessagePlaceholder}
                          className={`${controlClassName} min-h-[100px] py-3`}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" className="min-h-9" onClick={cancelEditing}>
                          {texts.cancelLabel}
                        </Button>
                        <Button variant="brand" className="min-h-9" onClick={() => handleUpdate(ticket.id)}>
                          {texts.saveEditLabel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-[var(--studio-primary-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--studio-primary)]">
                              {getTicketCategoryName(ticket, texts.uncategorizedLabel)}
                            </span>
                            <h3 className="text-base font-semibold text-[var(--studio-ink)] break-keep">
                              {ticket.subject}
                            </h3>
                          </div>
                          <p className="text-xs text-[var(--studio-muted)]">
                            {formatKoreanDateTime(ticket.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                          {ticket.status === 'pending' && (
                            <button
                              type="button"
                              className={`${iconButtonClassName} hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)]`}
                              onClick={() => startEditing(ticket)}
                              title={texts.editIconTitle}
                            >
                              <Pencil aria-hidden="true" className="size-4" />
                              <span className="sr-only">{texts.editIconTitle}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${iconButtonClassName} hover:bg-red-50 hover:text-red-500`}
                            onClick={() => setDeleteTargetId(ticket.id)}
                            title={texts.deleteIconTitle}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                            <span className="sr-only">{texts.deleteIconTitle}</span>
                          </button>
                        </div>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--studio-text)]">
                        {ticket.message}
                      </p>

                      {ticket.admin_response && (
                        <div className="mt-4 rounded-[var(--studio-radius-control)] border-l-4 border-[var(--studio-primary)] bg-[var(--studio-background)] p-4 sm:p-5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-[var(--studio-primary)]">{texts.answerLabel}</span>
                            {ticket.response_edited_at && texts.answerEditedLabel && (
                              <span className="text-xs text-[var(--studio-muted)]">
                                {texts.answerEditedLabel} · {formatKoreanDate(ticket.response_edited_at)}
                              </span>
                            )}
                            {ticket.responded_at && (
                              <span className="ml-auto text-xs text-[var(--studio-muted)]">
                                {formatKoreanDate(ticket.responded_at)}
                              </span>
                            )}
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--studio-text)]">
                            {ticket.admin_response}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <StudioAlertDialog
        open={showSubmittedDialog}
        onOpenChange={setShowSubmittedDialog}
        title={texts.submittedTitle}
        description={lines(texts.submittedDescription)}
        onConfirm={() => setShowSubmittedDialog(false)}
      />

      <StudioAlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
        title={texts.deleteConfirmTitle}
        description={lines(texts.deleteConfirmDescription)}
        cancelLabel={texts.cancelLabel}
        confirmLabel={texts.deleteConfirmLabel}
        destructive
        pending={isDeleting}
        onConfirm={() => deleteTargetId && void handleDelete(deleteTargetId)}
      />
    </div>
  )
}
