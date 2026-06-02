'use client'

import { useState, type ElementType } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MessageCircle, Clock, CheckCircle, AlertCircle, Trash2, Pencil, Info, FileText, CalendarDays, Download, MessageSquare, CreditCard, UserCircle, Lightbulb } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Database } from '@/types/supabase'

type SupportCategory = Database['public']['Tables']['support_ticket_categories']['Row']
type SupportTicketBase = Database['public']['Tables']['support_tickets']['Row']
type SupportTicket = SupportTicketBase & {
  support_ticket_categories?: Pick<SupportCategory, 'id' | 'slug' | 'name' | 'is_active' | 'deleted_at'> | null
}

interface SupportClientProps {
  tickets: SupportTicket[]
  categories: SupportCategory[]
  userId: string
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

export function SupportClient({ tickets, categories, userId }: SupportClientProps) {
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

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />대기중</Badge>
      case 'in_progress':
        return <Badge variant="default"><AlertCircle className="h-3 w-3 mr-1" />처리중</Badge>
      case 'resolved':
        return <Badge variant="outline" className="text-green-600"><CheckCircle className="h-3 w-3 mr-1" />답변완료</Badge>
      case 'closed':
        return <Badge variant="outline">종료</Badge>
      default:
        return <Badge variant="secondary">대기중</Badge>
    }
  }

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
    <div className="space-y-6" data-user-id={userId}>
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-white p-0">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
              <MessageCircle className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl font-bold text-slate-950">1:1 문의하기</CardTitle>
              <CardDescription className="text-sm text-slate-500">
                문의 카테고리를 먼저 선택하면 필요한 정보와 작성 가이드를 확인할 수 있습니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="support-category" className="font-semibold text-slate-900">문의 카테고리</Label>
                <select
                  id="support-category"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  aria-describedby={selectedCategoryHelpId}
                  className="flex h-12 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
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
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-700"
                >
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white">
                      <Info className="h-4 w-4" />
                    </div>
                    <p className="pt-1 text-sm font-semibold leading-6 text-slate-900">
                      {selectedCategory.help_text || selectedCategory.description || '선택한 문의 유형에 맞춰 내용을 작성해주세요.'}
                    </p>
                  </div>

                  {selectedGuideItems.length > 0 && (
                    <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {selectedGuideItems.map((item, index) => {
                        const guide = getGuideCardMeta(item, index)
                        const GuideIcon = guide.icon

                        return (
                          <div key={item} className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white">
                              <GuideIcon className="h-5 w-5" />
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-bold text-slate-950">{guide.title}</p>
                              <p className="text-xs leading-5 text-slate-500">{guide.description}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="subject" className="font-semibold text-slate-900">제목</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  aria-describedby={selectedCategoryHelpId}
                  placeholder={selectedCategory?.subject_placeholder || '문의 제목을 입력해주세요'}
                  className="h-12 rounded-lg border-slate-200"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message" className="font-semibold text-slate-900">내용</Label>
                <Textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  aria-describedby={selectedCategoryHelpId}
                  placeholder={selectedCategory?.message_placeholder || '문의 내용을 자세히 작성해주세요'}
                  className="min-h-[190px] rounded-lg border-slate-200"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || categories.length === 0}
                className="w-full bg-slate-950 px-7 text-white hover:bg-slate-800 sm:w-auto"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                문의 등록하기
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="px-6 pt-6 pb-4 border-b">
          <CardTitle className="text-lg font-semibold text-gray-900">문의 내역</CardTitle>
          <CardDescription className="text-gray-500">
            고객님께서 남겨주신 문의와 답변을 확인하실 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500 bg-gray-50/50">
              <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                <MessageCircle className="h-8 w-8 text-gray-400" />
              </div>
              <p className="font-medium text-gray-900 mb-1">아직 문의하신 내역이 없습니다</p>
              <p className="text-sm">궁금한 점이 있으시면 언제든지 문의해주세요.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="p-6 hover:bg-gray-50/50 transition-colors group">
                  {editingId === ticket.id ? (
                    <div className="space-y-4 bg-white p-2 rounded-lg border border-orange-100 shadow-sm">
                      <div className="space-y-2">
                        <Label>문의 카테고리 수정</Label>
                        <select
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="" disabled>문의 유형을 선택해주세요</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                        {editGuideItems.length > 0 && (
                          <ul className="rounded-lg bg-gray-50 p-3 pl-6 text-xs text-gray-500 list-disc">
                            {editGuideItems.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>제목 수정</Label>
                        <Input
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          placeholder="제목을 입력하세요"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>내용 수정</Label>
                        <Textarea
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                          placeholder="내용을 입력하세요"
                          className="min-h-[100px]"
                        />
                      </div>
                      <div className="flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={cancelEditing}>취소</Button>
                        <Button size="sm" onClick={() => handleUpdate(ticket.id)}>수정 완료</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-3 mb-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded text-[11px]">Q</span>
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100">
                                {getTicketCategoryName(ticket)}
                              </Badge>
                              <h4 className="font-semibold text-gray-900 text-base">{ticket.subject}</h4>
                            </div>
                            <p className="text-xs text-gray-400 pl-7">
                              {new Date(ticket.created_at).toLocaleDateString('ko-KR', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {getStatusBadge(ticket.status)}
                            {ticket.status === 'pending' && (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                                  onClick={() => startEditing(ticket)}
                                  title="문의 수정"
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span className="sr-only">수정</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                  onClick={() => handleDelete(ticket.id)}
                                  title="문의 삭제"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">삭제</span>
                                </Button>
                              </div>
                            )}
                            {ticket.status !== 'pending' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                onClick={() => handleDelete(ticket.id)}
                                title="문의 내역 삭제"
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">삭제</span>
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="pl-7 pr-2">
                          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                            {ticket.message}
                          </p>
                        </div>
                      </div>

                      {ticket.admin_response && (
                        <div className="pl-7 mt-5">
                          <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 relative group/response">
                            <div className="absolute left-0 top-6 w-1 h-8 bg-gray-800 rounded-r-full group-hover/response:bg-orange-500 transition-colors" />

                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-sm font-bold text-white bg-gray-900 px-2 py-0.5 rounded text-[11px] group-hover/response:bg-orange-600 transition-colors">A</span>
                              <span className="text-sm font-semibold text-gray-900">관리자 답변</span>
                              <span className="text-xs text-gray-400 ml-auto">
                                {ticket.responded_at && new Date(ticket.responded_at).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>

                            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap pl-7">
                              {ticket.admin_response}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
