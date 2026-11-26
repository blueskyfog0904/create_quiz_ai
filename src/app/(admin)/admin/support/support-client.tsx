'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAdminAlerts } from '@/components/admin/admin-alert-context'
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
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { DEFAULT_LIST_PAGE_SIZE, updateListQuery } from '@/lib/list-pagination'
import type { AdminMemberSummary } from '@/lib/admin-member-detail-server'

type SupportCategory = Database['public']['Tables']['support_ticket_categories']['Row']
type TicketBase = Database['public']['Tables']['support_tickets']['Row']
type Ticket = TicketBase & {
  profiles: {
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
  // 서버가 주소의 필터·page·pageSize로 걸러 준 한 쪽
  tickets: Ticket[]
  // 필터와 무관한 전체 건수. 세지 못한 값은 null
  ticketCounts: { pending: number | null; resolved: number | null; deleted: number | null }
  pagination: { page: number; pageSize: number; totalCount: number }
  searchTruncated: boolean
  // 주소의 ?ticket= 으로 바로 여는 문의(없으면 null)
  linkedTicket: Ticket | null
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

const formatCount = (count: number | null) => (count === null ? '-' : count.toLocaleString())

export function SupportClient({ tickets, ticketCounts, pagination, searchTruncated, linkedTicket, initialCategories, initialFilters }: SupportClientProps) {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<'tickets' | 'categories'>('tickets')
  const [categories, setCategories] = useState<SupportCategory[]>(initialCategories)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(linkedTicket)
  const [response, setResponse] = useState(linkedTicket?.admin_response || '')
  // 상세 창을 연 문의의 회원 요약. 마지막으로 응답을 받은 문의 id와 함께 둔다(다르면 아직 불러오는 중).
  const [memberSummary, setMemberSummary] = useState<{ ticketId: string; data: AdminMemberSummary | null; failed: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState(initialFilters.status)
  const [categoryFilter, setCategoryFilter] = useState(initialFilters.categoryId)
  const [queryText, setQueryText] = useState(initialFilters.q)
  const [includeDeleted, setIncludeDeleted] = useState(initialFilters.includeDeleted)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SupportCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm)
  const [categorySubmitting, setCategorySubmitting] = useState(false)

  const activeCategoryCount = useMemo(
    () => categories.filter((category) => category.is_active && !category.deleted_at).length,
    [categories]
  )

  const selectedTicketId = selectedTicket?.id ?? null
  useEffect(() => {
    if (!selectedTicketId) return
    let ignore = false
    fetch(`/api/admin/support/tickets/${selectedTicketId}/member-summary`)
      .then(async (res) => {
        const result = await res.json().catch(() => null)
        // 문의 권한이 없는 계정에는 요약을 보여 주지 않는다(오류가 아니다).
        if (res.status === 403) return { data: null, failed: false }
        if (!res.ok || !result?.success) throw new Error('member summary failed')
        return { data: result.data as AdminMemberSummary, failed: false }
      })
      .catch(() => ({ data: null, failed: true }))
      .then((loaded) => {
        if (!ignore) setMemberSummary({ ticketId: selectedTicketId, ...loaded })
      })
    return () => {
      ignore = true
    }
  }, [selectedTicketId])

  // 서버가 목록을 다시 읽도록 주소를 바꾼다. 바로 여는 문의(ticket)는 쪽을 옮길 때 뗀다.
  const changeListQuery = (changes: Record<string, string | number | null>) => {
    const query = updateListQuery(window.location.search, { ...changes, ticket: null })
    router.push(`/admin/support${query ? `?${query}` : ''}`)
  }

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
    if (pagination.pageSize !== DEFAULT_LIST_PAGE_SIZE) params.set('pageSize', String(pagination.pageSize))

    router.push(`/admin/support${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const resetFilters = () => {
    setStatusFilter('all')
    setCategoryFilter('all')
    setQueryText('')
    setIncludeDeleted(false)
    router.push('/admin/support')
  }

  const alerts = useAdminAlerts()

  const handleRespond = async () => {
    if (!selectedTicket || selectedTicket.is_deleted_by_user || !response.trim()) return

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

      const result = await res.json().catch(() => ({}))

      setSelectedTicket(null)
      setResponse('')
      if (result.notificationFailed) {
        toast.warning('답변은 저장했지만 회원 알림을 만들지 못했습니다.')
      } else {
        toast.success('답변이 등록되었습니다.')
      }
      // 답변 대기 건수가 줄었으니 종·메뉴 배지를 바로 맞춘다.
      alerts?.refresh()
      // 목록과 건수 카드는 서버가 센 값이라 다시 읽는다.
      router.refresh()
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
                <p className="text-2xl font-bold text-yellow-600">{formatCount(ticketCounts.pending)}</p>
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
                <p className="text-2xl font-bold text-green-600">{formatCount(ticketCounts.resolved)}</p>
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
                <p className="text-2xl font-bold text-red-600">{formatCount(ticketCounts.deleted)}</p>
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
                    placeholder="제목/내용/회원 이메일 검색"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-2">
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

          {searchTruncated && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              검색어에 맞는 회원이 많아 일부 회원의 문의만 보입니다. 이메일을 더 길게 입력해 주세요.
            </div>
          )}

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
                            ? 'opacity-60 bg-gray-50 cursor-pointer'
                            : 'hover:bg-gray-50 cursor-pointer'
                        }`}
                        onClick={() => openTicket(ticket)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 break-words">
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
                              <span>{ticket.profiles?.email || '알 수 없음'}</span>
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

          <StudioListPagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalCount={pagination.totalCount}
            onPageChange={(page) => changeListQuery({ page })}
            onPageSizeChange={(pageSize) => changeListQuery({ pageSize, page: 1 })}
          />
        </div>
      )}

      {activeSection === 'categories' && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                  <div key={category.id} className="flex items-start justify-between gap-4 p-4 max-md:flex-col max-md:gap-3">
                    <div className="min-w-0 space-y-2 break-words">
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
                      <Button variant="adminAction" size="sm" onClick={() => openEditCategory(category)}>
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
        <DialogContent className="max-w-2xl max-md:max-h-[calc(100dvh-2rem)] max-md:max-w-[calc(100vw-2rem)] max-md:overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTicket?.subject}</DialogTitle>
            <DialogDescription>
              {selectedTicket?.profiles?.phone || '전화번호 없음'} •{' '}
              {selectedTicket?.profiles?.email || '이메일 없음'} •{' '}
              {selectedTicket && <Link href={`/admin/users/${selectedTicket.user_id}`} className="text-blue-700 hover:underline">회원 상세</Link>} •{' '}
              {selectedTicket && new Date(selectedTicket.created_at).toLocaleString('ko-KR')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100">
                {selectedTicket ? getTicketCategoryName(selectedTicket) : '미분류'}
              </Badge>
              {selectedTicket && getStatusBadge(selectedTicket.is_deleted_by_user ? 'deleted' : selectedTicket.status)}
            </div>
            {selectedTicket?.is_deleted_by_user && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                회원이 삭제한 문의입니다. 내용만 볼 수 있고 답변은 등록할 수 없습니다.
              </p>
            )}
            {selectedTicket && <MemberSummary ticket={selectedTicket} summary={memberSummary?.ticketId === selectedTicket.id ? memberSummary : null} />}
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

            {selectedTicket?.status === 'pending' && !selectedTicket.is_deleted_by_user && (
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
            {selectedTicket?.status === 'pending' && !selectedTicket.is_deleted_by_user && (
              <Button onClick={handleRespond} disabled={submitting || !response.trim()}>
                <Send className="h-4 w-4 mr-2" />
                {submitting ? '전송 중...' : '답변 등록'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto max-md:max-w-[calc(100vw-2rem)]">
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

// 상세 창의 회원 요약. 권한이 없어 서버가 세지 않은 항목(null)은 그리지 않는다.
function MemberSummary({ ticket, summary }: {
  ticket: Ticket
  summary: { data: AdminMemberSummary | null; failed: boolean } | null
}) {
  if (!summary) return <p className="text-sm text-gray-500">회원 요약을 불러오는 중…</p>
  if (summary.failed) return <p role="alert" className="text-sm text-red-700">회원 요약을 불러오지 못했습니다.</p>
  if (!summary.data) return null

  // 각 화면을 이 회원의 이메일로 검색한 상태로 연다(부분 일치라 비슷한 이메일의 다른 회원이 섞일 수 있다. 이메일이 없으면 링크를 두지 않는다).
  const emailQuery = ticket.profiles?.email ? encodeURIComponent(ticket.profiles.email) : null
  const items = [
    { label: '충전 결제', section: summary.data.paymentOrders, href: emailQuery && `/admin/orders?tab=payments&q=${emailQuery}` },
    { label: '마켓 구매', section: summary.data.marketOrders, href: emailQuery && `/admin/orders?tab=market&q=${emailQuery}` },
    { label: '다른 문의', section: summary.data.otherTickets, href: emailQuery && `/admin/support?q=${emailQuery}&includeDeleted=true` },
  ].filter((item) => item.section)
  // 12번: 정지 중 배지(members.view 가 있을 때만 서버가 센다)
  const suspension = summary.data.activeSuspensions
  if (items.length === 0 && !suspension) return null

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="mb-1 flex flex-wrap items-center gap-2 font-medium text-gray-700">
        회원 요약
        {suspension && !suspension.failed && suspension.data > 0 && <Badge className="bg-red-100 text-red-800">정지 중</Badge>}
        {suspension?.failed && <span className="text-xs font-normal text-red-700">정지 여부 확인 불가</span>}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map(({ label, section, href }) => (
          <li key={label}>
            <span className="text-gray-500">{label} </span>
            {!section || section.failed ? (
              <span className="text-red-700">확인 불가</span>
            ) : href ? (
              <Link href={href} className="text-blue-700 hover:underline">{section.data.toLocaleString()}건</Link>
            ) : (
              <span>{section.data.toLocaleString()}건</span>
            )}
          </li>
        ))}
      </ul>
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
