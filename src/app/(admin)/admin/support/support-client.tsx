'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MessageSquare,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
  Plus,
  Pencil,
  Trash2,
  FolderCog,
} from 'lucide-react'
import { Database } from '@/types/supabase'

type SupportCategory = Database['public']['Tables']['support_ticket_categories']['Row']
type TicketBase = Database['public']['Tables']['support_tickets']['Row']
type Ticket = TicketBase & {
  profiles: {
    name: string | null
    email: string | null
    phone: string | null
  } | null
  support_ticket_categories?: Pick<SupportCategory, 'id' | 'slug' | 'name' | 'is_active' | 'deleted_at'> | null
}

type FilterState = {
  status: string
  categoryId: string
  q: string
  includeDeleted: boolean
}

type CategoryForm = {
  slug: string
  name: string
  description: string
  helpText: string
  guideItemsText: string
  subjectPlaceholder: string
  messagePlaceholder: string
  sortOrder: string
  isActive: boolean
}

interface SupportClientProps {
  initialTickets: Ticket[]
  initialCategories: SupportCategory[]
  initialFilters: FilterState
}

const emptyCategoryForm: CategoryForm = {
  slug: '',
  name: '',
  description: '',
  helpText: '',
  guideItemsText: '',
  subjectPlaceholder: '',
  messagePlaceholder: '',
  sortOrder: '0',
  isActive: true,
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: '대기 중', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  in_progress: { label: '처리 중', color: 'bg-blue-100 text-blue-700', icon: MessageSquare },
  resolved: { label: '해결됨', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  closed: { label: '종료', color: 'bg-gray-100 text-gray-700', icon: AlertCircle },
  deleted: { label: '고객삭제', color: 'bg-red-100 text-red-600 font-bold', icon: AlertCircle },
}

function getTicketCategoryName(ticket: Ticket) {
  const snapshot = ticket.category_snapshot

  if (snapshot && typeof snapshot === 'object' && 'name' in snapshot) {
    const name = (snapshot as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) return name
  }

  return ticket.support_ticket_categories?.name || '미분류'
}

function getGuideItemsText(category: SupportCategory) {
  if (!Array.isArray(category.guide_items)) return ''

  return category.guide_items
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .join('\n')
}

function toCategoryForm(category: SupportCategory): CategoryForm {
  return {
    slug: category.slug,
    name: category.name,
    description: category.description || '',
    helpText: category.help_text || '',
    guideItemsText: getGuideItemsText(category),
    subjectPlaceholder: category.subject_placeholder || '',
    messagePlaceholder: category.message_placeholder || '',
    sortOrder: String(category.sort_order || 0),
    isActive: Boolean(category.is_active),
  }
}

function buildCategoryPayload(form: CategoryForm) {
  return {
    slug: form.slug.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    helpText: form.helpText.trim() || null,
    guideItems: form.guideItemsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    subjectPlaceholder: form.subjectPlaceholder.trim() || null,
    messagePlaceholder: form.messagePlaceholder.trim() || null,
    sortOrder: Number.parseInt(form.sortOrder || '0', 10),
    isActive: form.isActive,
  }
}

export function SupportClient({ initialTickets, initialCategories, initialFilters }: SupportClientProps) {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<'tickets' | 'categories'>('tickets')
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [categories, setCategories] = useState<SupportCategory[]>(initialCategories)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState(initialFilters.status)
  const [categoryFilter, setCategoryFilter] = useState(initialFilters.categoryId)
  const [queryText, setQueryText] = useState(initialFilters.q)
  const [includeDeleted, setIncludeDeleted] = useState(initialFilters.includeDeleted)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SupportCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm)
  const [categorySubmitting, setCategorySubmitting] = useState(false)

  const pendingCount = tickets.filter((ticket) => ticket.status === 'pending' && !ticket.is_deleted_by_user).length
  const resolvedCount = tickets.filter((ticket) => ticket.status === 'resolved' && !ticket.is_deleted_by_user).length
  const deletedCount = tickets.filter((ticket) => ticket.is_deleted_by_user).length
  const activeCategoryCount = useMemo(
    () => categories.filter((category) => category.is_active && !category.deleted_at).length,
    [categories]
  )

  const openTicket = (ticket: Ticket) => {
    setSelectedTicket(ticket)
    setResponse(ticket.admin_response || '')
  }

  const applyFilters = () => {
    const params = new URLSearchParams()

    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (categoryFilter !== 'all') params.set('categoryId', categoryFilter)
    if (queryText.trim()) params.set('q', queryText.trim())
    if (includeDeleted) params.set('includeDeleted', 'true')

    router.push(`/admin/support${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const resetFilters = () => {
    setStatusFilter('all')
    setCategoryFilter('all')
    setQueryText('')
    setIncludeDeleted(false)
    router.push('/admin/support')
  }

  const handleRespond = async () => {
    if (!selectedTicket || !response.trim()) return

    try {
      setSubmitting(true)

      const res = await fetch(`/api/admin/support/tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminResponse: response,
          status: 'resolved',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '답변 등록에 실패했습니다.')
      }

      setTickets(tickets.map((ticket) =>
        ticket.id === selectedTicket.id
          ? { ...ticket, admin_response: response, status: 'resolved', responded_at: new Date().toISOString() }
          : ticket
      ))
      setSelectedTicket(null)
      setResponse('')
      toast.success('답변이 등록되었습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '답변 등록에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const openCreateCategory = () => {
    setEditingCategory(null)
    setCategoryForm(emptyCategoryForm)
    setCategoryDialogOpen(true)
  }

  const openEditCategory = (category: SupportCategory) => {
    setEditingCategory(category)
    setCategoryForm(toCategoryForm(category))
    setCategoryDialogOpen(true)
  }

  const saveCategory = async () => {
    if (!categoryForm.slug.trim() || !categoryForm.name.trim()) {
      toast.error('카테고리 코드와 이름을 입력해주세요.')
      return
    }

    try {
      setCategorySubmitting(true)
      const payload = buildCategoryPayload(categoryForm)
      const res = await fetch(
        editingCategory ? `/api/admin/support/categories/${editingCategory.id}` : '/api/admin/support/categories',
        {
          method: editingCategory ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '카테고리 저장에 실패했습니다.')
      }

      const data = await res.json()
      if (editingCategory) {
        setCategories(categories.map((category) => category.id === data.category.id ? data.category : category))
      } else {
        setCategories([...categories, data.category])
      }

      setCategoryDialogOpen(false)
      toast.success('카테고리가 저장되었습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리 저장에 실패했습니다.')
    } finally {
      setCategorySubmitting(false)
    }
  }

  const hideCategory = async (category: SupportCategory) => {
    if (!confirm(`'${category.name}' 카테고리를 숨김 처리하시겠습니까? 기존 문의의 카테고리 스냅샷은 유지됩니다.`)) {
      return
    }

    try {
      const res = await fetch(`/api/admin/support/categories/${category.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '카테고리 숨김 처리에 실패했습니다.')
      }

      const data = await res.json()
      setCategories(categories.map((item) => item.id === data.category.id ? data.category : item))
      toast.success('카테고리를 숨김 처리했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리 숨김 처리에 실패했습니다.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">대기 중</p>
                <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">해결됨</p>
                <p className="text-2xl font-bold text-green-600">{resolvedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">고객 삭제</p>
                <p className="text-2xl font-bold text-red-600">{deletedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FolderCog className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">사용 카테고리</p>
                <p className="text-2xl font-bold text-blue-600">{activeCategoryCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={activeSection === 'tickets' ? 'default' : 'outline'}
              onClick={() => setActiveSection('tickets')}
            >
              문의 목록
            </Button>
            <Button
              variant={activeSection === 'categories' ? 'default' : 'outline'}
              onClick={() => setActiveSection('categories')}
            >
              카테고리 관리
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeSection === 'tickets' && (
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">문의 목록 필터</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label>상태</Label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="all">전체</option>
                    <option value="pending">대기 중</option>
                    <option value="in_progress">처리 중</option>
                    <option value="resolved">해결됨</option>
                    <option value="closed">종료</option>
                    <option value="deleted">고객삭제</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>카테고리</Label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="all">전체 카테고리</option>
                    <option value="uncategorized">미분류</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>검색</Label>
                  <Input
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    placeholder="제목/내용 검색"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={includeDeleted}
                      onChange={(e) => setIncludeDeleted(e.target.checked)}
                    />
                    삭제 포함
                  </label>
                  <Button onClick={applyFilters}>적용</Button>
                  <Button variant="outline" onClick={resetFilters}>초기화</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">문의 목록</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {tickets.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  등록된 문의가 없습니다.
                </div>
              ) : (
                <div className="divide-y">
                  {tickets.map((ticket) => {
                    const isDeleted = ticket.is_deleted_by_user
                    const statusKey = isDeleted ? 'deleted' : (ticket.status || 'pending')
                    const status = statusConfig[statusKey]
                    const StatusIcon = status.icon

                    return (
                      <div
                        key={ticket.id}
                        className={`p-4 transition-colors ${
                          isDeleted
                            ? 'opacity-60 bg-gray-50 cursor-not-allowed'
                            : 'hover:bg-gray-50 cursor-pointer'
                        }`}
                        onClick={() => !isDeleted && openTicket(ticket)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`font-medium ${isDeleted ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                {ticket.subject}
                              </span>
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100">
                                {getTicketCategoryName(ticket)}
                              </Badge>
                              <Badge className={status.color} variant={isDeleted ? 'outline' : 'default'}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {status.label}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-500 mt-1 line-clamp-1">
                              {ticket.message}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-400">
                              <span>{ticket.profiles?.name || ticket.profiles?.email || '알 수 없음'}</span>
                              <span>•</span>
                              <span>{new Date(ticket.created_at).toLocaleDateString('ko-KR')}</span>
                              {ticket.responded_at && !isDeleted && (
                                <>
                                  <span>•</span>
                                  <span className="text-green-600">
                                    답변완료: {new Date(ticket.responded_at).toLocaleDateString('ko-KR')}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeSection === 'categories' && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">카테고리 관리</CardTitle>
                <p className="mt-1 text-sm text-gray-500">사용자 문의 카테고리와 작성 안내 문구를 추가, 수정, 숨김 처리합니다.</p>
              </div>
              <Button onClick={openCreateCategory}>
                <Plus className="mr-2 h-4 w-4" />
                카테고리 추가
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {categories.length === 0 ? (
              <div className="p-8 text-center text-gray-500">등록된 카테고리가 없습니다.</div>
            ) : (
              <div className="divide-y">
                {categories.map((category) => (
                  <div key={category.id} className="flex items-start justify-between gap-4 p-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">{category.name}</span>
                        <Badge variant="outline">{category.slug}</Badge>
                        <Badge variant={category.is_active && !category.deleted_at ? 'default' : 'secondary'}>
                          {category.is_active && !category.deleted_at ? '사용' : '숨김'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{category.description || '설명 없음'}</p>
                      {category.help_text && <p className="text-xs text-gray-400">안내: {category.help_text}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditCategory(category)}>
                        <Pencil className="mr-1 h-4 w-4" />
                        수정
                      </Button>
                      {!category.deleted_at && (
                        <Button variant="outline" size="sm" onClick={() => hideCategory(category)}>
                          <Trash2 className="mr-1 h-4 w-4" />
                          숨김 처리
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTicket?.subject}</DialogTitle>
            <DialogDescription>
              {selectedTicket?.profiles?.name || '이름 없음'} •{' '}
              {selectedTicket?.profiles?.phone || '전화번호 없음'} •{' '}
              {selectedTicket?.profiles?.email || '이메일 없음'} •{' '}
              {selectedTicket && new Date(selectedTicket.created_at).toLocaleString('ko-KR')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100">
                {selectedTicket ? getTicketCategoryName(selectedTicket) : '미분류'}
              </Badge>
              {selectedTicket && getStatusBadge(selectedTicket.status)}
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-700 mb-2">문의 내용</p>
              <p className="text-gray-600 whitespace-pre-wrap">{selectedTicket?.message}</p>
            </div>

            {selectedTicket?.admin_response && (
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm font-medium text-green-700 mb-2">관리자 답변</p>
                <p className="text-gray-600 whitespace-pre-wrap">{selectedTicket.admin_response}</p>
              </div>
            )}

            {selectedTicket?.status === 'pending' && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">답변 작성</p>
                <Textarea
                  placeholder="답변을 입력하세요..."
                  rows={4}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTicket(null)}>
              닫기
            </Button>
            {selectedTicket?.status === 'pending' && (
              <Button onClick={handleRespond} disabled={submitting || !response.trim()}>
                <Send className="h-4 w-4 mr-2" />
                {submitting ? '전송 중...' : '답변 등록'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCategory ? '카테고리 수정' : '카테고리 추가'}</DialogTitle>
            <DialogDescription>
              고객이 1:1 문의를 남길 때 선택할 문의 유형과 작성 가이드를 관리합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>카테고리 코드</Label>
              <Input
                value={categoryForm.slug}
                onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })}
                placeholder="market_refund"
              />
            </div>
            <div className="space-y-2">
              <Label>카테고리명</Label>
              <Input
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                placeholder="문제마켓 환불 요청"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>설명</Label>
              <Input
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                placeholder="관리자와 사용자가 볼 간단한 설명"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>작성 안내</Label>
              <Textarea
                value={categoryForm.helpText}
                onChange={(e) => setCategoryForm({ ...categoryForm, helpText: e.target.value })}
                placeholder="문의 전에 확인해야 할 안내 문구"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>필수 확인 항목</Label>
              <Textarea
                value={categoryForm.guideItemsText}
                onChange={(e) => setCategoryForm({ ...categoryForm, guideItemsText: e.target.value })}
                placeholder="한 줄에 하나씩 입력"
              />
            </div>
            <div className="space-y-2">
              <Label>제목 placeholder</Label>
              <Input
                value={categoryForm.subjectPlaceholder}
                onChange={(e) => setCategoryForm({ ...categoryForm, subjectPlaceholder: e.target.value })}
                placeholder="예: 문제마켓 환불 요청"
              />
            </div>
            <div className="space-y-2">
              <Label>정렬 순서</Label>
              <Input
                type="number"
                value={categoryForm.sortOrder}
                onChange={(e) => setCategoryForm({ ...categoryForm, sortOrder: e.target.value })}
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>내용 placeholder</Label>
              <Textarea
                value={categoryForm.messagePlaceholder}
                onChange={(e) => setCategoryForm({ ...categoryForm, messagePlaceholder: e.target.value })}
                placeholder="사용자가 문의 내용 입력창에서 볼 예시 문구"
              />
            </div>
            <label className="md:col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={categoryForm.isActive}
                onChange={(e) => setCategoryForm({ ...categoryForm, isActive: e.target.checked })}
              />
              사용자 화면에 노출
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>취소</Button>
            <Button onClick={saveCategory} disabled={categorySubmitting}>
              {categorySubmitting ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function getStatusBadge(status: string | null) {
  const config = statusConfig[status || 'pending'] || statusConfig.pending
  const StatusIcon = config.icon

  return (
    <Badge className={config.color}>
      <StatusIcon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  )
}
