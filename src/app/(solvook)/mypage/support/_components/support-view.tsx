'use client'

import { useState, type ElementType } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  MessageCircle,
  Trash2,
  Pencil,
  Info,
  FileText,
  CalendarDays,
  Download,
  MessageSquare,
  CreditCard,
  UserCircle,
  Lightbulb,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { Database } from '@/types/supabase'

type SupportCategory = Database['public']['Tables']['support_ticket_categories']['Row']
type SupportTicketBase = Database['public']['Tables']['support_tickets']['Row']
type SupportTicket = SupportTicketBase & {
  support_ticket_categories?: Pick<SupportCategory, 'id' | 'slug' | 'name' | 'is_active' | 'deleted_at'> | null
}

interface SupportViewProps {
  tickets: SupportTicket[]
  categories: SupportCategory[]
  userId: string
}

const controlClassName =
  'min-h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-6'

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

function getTicketCategoryName(ticket: SupportTicket) {
  const category_snapshot = ticket.category_snapshot

  if (category_snapshot && typeof category_snapshot === 'object' && 'name' in category_snapshot) {
    const name = (category_snapshot as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) return name
  }

  return ticket.support_ticket_categories?.name || '미분류'
}

type GuideCardMeta = {
  icon: ElementType
  title: string
  description: string
}

function getGuideCardMeta(item: string, index: number): GuideCardMeta {
  const exactGuideCards: Record<string, GuideCardMeta> = {
    '구매한 자료명': { icon: FileText, title: item, description: '어떤 자료인지 정확한 확인이 필요합니다.' },
    '환불 요청 사유': { icon: MessageSquare, title: item, description: '환불을 요청하시는 사유를 자세히 알려주세요.' },
  }
  const exactGuideCard = exactGuideCards[item]

  if (exactGuideCard) return exactGuideCard

  const normalized = item.replaceAll(' ', '')

  if (normalized.includes('자료명') || normalized.includes('상품명')) {
    return { icon: FileText, title: item, description: '어떤 자료인지 정확한 확인이 필요합니다.' }
  }

  if (normalized.includes('구매일') || normalized.includes('결제일') || normalized.includes('시간')) {
    return { icon: CalendarDays, title: item, description: '정확한 날짜를 알려주시면 확인이 빠릅니다.' }
  }

  if (normalized.includes('다운로드')) {
    return { icon: Download, title: item, description: '자료를 다운로드하셨는지 알려주세요.' }
  }

  if (normalized.includes('환불') || normalized.includes('사유')) {
    return { icon: MessageSquare, title: item, description: '요청하시는 사유를 자세히 알려주세요.' }
  }

  if (normalized.includes('결제') || normalized.includes('크레딧')) {
    return { icon: CreditCard, title: item, description: '결제 또는 크레딧 내역 확인에 필요합니다.' }
  }

  if (normalized.includes('계정') || normalized.includes('이메일')) {
    return { icon: UserCircle, title: item, description: '계정 확인을 위해 정확히 입력해주세요.' }
  }

  const fallbackIcons = [FileText, CalendarDays, Download, MessageSquare, Lightbulb]
  return {
    icon: fallbackIcons[index % fallbackIcons.length],
    title: item,
    description: '문의 확인에 필요한 정보를 입력해주세요.',
  }
}

export function SupportView({ tickets, categories, userId }: SupportViewProps) {
  const router = useRouter()
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id || '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
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
      toast.error('문의 카테고리를 선택해주세요.')
      return
    }

    if (!subject.trim() || !message.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
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
        throw new Error(data.error || '문의 등록에 실패했습니다.')
      }

      toast.success('문의가 등록되었습니다. 빠른 시일 내에 답변드리겠습니다.')
      setSelectedCategoryId(categories[0]?.id || '')
      setSubject('')
      setMessage('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문의 등록에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (ticketId: string) => {
    if (!confirm('정말 이 문의 내역을 삭제하시겠습니까?\n삭제된 내역은 복구할 수 없습니다.')) {
      return
    }

    try {
      const response = await fetch(`/api/support?id=${ticketId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '삭제에 실패했습니다.')
      }

      toast.success('문의 내역이 삭제되었습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '삭제에 실패했습니다.')
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
      toast.error('문의 카테고리를 선택해주세요.')
      return
    }

    if (!editSubject.trim() || !editMessage.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
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
        throw new Error(data.error || '수정에 실패했습니다.')
      }

      toast.success('문의 내용이 수정되었습니다.')
      cancelEditing()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '수정에 실패했습니다.')
    }
  }

  return (
    <StudioContainer className="py-8 sm:py-10" data-user-id={userId}>
      <Link
        href="/mypage"
        className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] text-sm font-medium text-[var(--studio-muted)] outline-none transition-colors hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        ← 마이페이지
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">고객지원</h1>
      <p className="mt-2 text-sm text-[var(--studio-muted)] break-keep">
        문의 카테고리를 먼저 선택하면 필요한 정보와 작성 가이드를 확인할 수 있습니다.
      </p>

      <section className={`mt-6 ${cardClassName}`}>
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <MessageCircle aria-hidden="true" className="size-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--studio-ink)]">1:1 문의하기</h2>
            <p className="text-sm text-[var(--studio-muted)] break-keep">
              궁금한 점을 남겨주시면 빠른 시일 내에 답변드립니다.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="support-category" className="text-sm font-semibold text-[var(--studio-ink)]">
              문의 카테고리
            </label>
            <select
              id="support-category"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              aria-describedby={selectedCategoryHelpId}
              className={controlClassName}
              required
            >
              <option value="" disabled>문의 유형을 선택해주세요</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>

          {selectedCategory && (
            <div
              id="support-category-help"
              className="rounded-[var(--studio-radius-card)] bg-[var(--studio-background)] p-5"
            >
              <div className="flex gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                  <Info aria-hidden="true" className="size-4" />
                </div>
                <p className="pt-1 text-sm font-semibold leading-6 text-[var(--studio-ink)] break-keep">
                  {selectedCategory.help_text || selectedCategory.description || '선택한 문의 유형에 맞춰 내용을 작성해주세요.'}
                </p>
              </div>

              {selectedGuideItems.length > 0 && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selectedGuideItems.map((item, index) => {
                    const guide = getGuideCardMeta(item, index)
                    const GuideIcon = guide.icon

                    return (
                      <div
                        key={item}
                        className="flex items-start gap-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                          <GuideIcon aria-hidden="true" className="size-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-[var(--studio-ink)] break-keep">{guide.title}</p>
                          <p className="text-xs leading-5 text-[var(--studio-muted)] break-keep">{guide.description}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="support-subject" className="text-sm font-semibold text-[var(--studio-ink)]">
              제목
            </label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-describedby={selectedCategoryHelpId}
              placeholder={selectedCategory?.subject_placeholder || '문의 제목을 입력해주세요'}
              className={controlClassName}
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="support-message" className="text-sm font-semibold text-[var(--studio-ink)]">
              내용
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby={selectedCategoryHelpId}
              placeholder={(selectedCategory?.message_placeholder || '문의 내용을 자세히 작성해주세요').replace(/\\n/g, '\n')}
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
            {isSubmitting ? '접수 중…' : '문의 등록하기'}
          </Button>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold text-[var(--studio-ink)]">문의 내역</h2>
        <p className="mt-1 text-sm text-[var(--studio-muted)] break-keep">
          남겨주신 문의와 답변을 확인하실 수 있습니다.
        </p>

        {tickets.length === 0 ? (
          <div className="mt-4">
            <StudioEmptyState
              icon={<MessageCircle aria-hidden="true" className="size-6" />}
              title="아직 문의하신 내역이 없습니다"
              description="궁금한 점이 있으시면 언제든지 문의해주세요."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--studio-border)] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
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
                          문의 카테고리 수정
                        </label>
                        <select
                          id={`edit-category-${ticket.id}`}
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className={controlClassName}
                        >
                          <option value="" disabled>문의 유형을 선택해주세요</option>
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
                          제목 수정
                        </label>
                        <input
                          id={`edit-subject-${ticket.id}`}
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          placeholder="제목을 입력하세요"
                          className={controlClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor={`edit-message-${ticket.id}`}
                          className="text-sm font-semibold text-[var(--studio-ink)]"
                        >
                          내용 수정
                        </label>
                        <textarea
                          id={`edit-message-${ticket.id}`}
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                          placeholder="내용을 입력하세요"
                          className={`${controlClassName} min-h-[100px] py-3`}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" className="min-h-9" onClick={cancelEditing}>
                          취소
                        </Button>
                        <Button variant="brand" className="min-h-9" onClick={() => handleUpdate(ticket.id)}>
                          수정 완료
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-[var(--studio-primary-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--studio-primary)]">
                              {getTicketCategoryName(ticket)}
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
                              title="문의 수정"
                            >
                              <Pencil aria-hidden="true" className="size-4" />
                              <span className="sr-only">수정</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${iconButtonClassName} hover:bg-red-50 hover:text-red-500`}
                            onClick={() => handleDelete(ticket.id)}
                            title="문의 내역 삭제"
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                            <span className="sr-only">삭제</span>
                          </button>
                        </div>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--studio-text)]">
                        {ticket.message}
                      </p>

                      {ticket.admin_response && (
                        <div className="mt-4 rounded-[var(--studio-radius-control)] border-l-4 border-[var(--studio-primary)] bg-[var(--studio-background)] p-4 sm:p-5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-[var(--studio-primary)]">관리자 답변</span>
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
    </StudioContainer>
  )
}
