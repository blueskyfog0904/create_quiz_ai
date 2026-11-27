'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAdminAlerts } from '@/components/admin/admin-alert-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Send, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'
import { Database } from '@/types/supabase'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { DEFAULT_LIST_PAGE_SIZE, updateListQuery } from '@/lib/list-pagination'
import type { AdminMemberSummary } from '@/lib/admin-member-detail-server'
import type { SupportPageContent } from '@/lib/support-page-content'
import { findTemplateBlanks, sha256Hex } from '@/lib/support-reply-template'
import { ReplyTemplatePicker, TemplateBlankPreview, type SupportReplyTemplateRow } from './reply-template-tools'
import { TicketAnswerEdit, type AnswerTicketState } from './ticket-answer-edit'
import { ReplyTemplatesPanel } from './reply-templates-panel'
import { SupportPageContentPanel } from './support-page-content-panel'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminMetricCard, AdminMetricGrid } from '@/components/admin/kit/admin-metric-card'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_UNAVAILABLE, formatCount as formatAdminCount } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'

type SupportCategory = Database['public']['Tables']['support_ticket_categories']['Row']
type TicketBase = Database['public']['Tables']['support_tickets']['Row']
// 13번: profiles 는 서버가 열람 기록을 남기며 붙인 이메일(목록에는 전화 없음 — phone 은 늘 null). response_edited_at 은 13번 새 칸.
export type Ticket = TicketBase & {
  response_edited_at?: string | null
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
  // 13번 7절: slug 를 바꿀 수 없는 카테고리(문의가 달림·탈퇴 가림 정책 slug)
  lockedCategoryIds: string[]
  // 13번 6절: 답변 템플릿(읽지 못하면 null)
  initialTemplates: SupportReplyTemplateRow[] | null
  // 13번 9절: 고객지원 문구(빈칸 표시·수정 사유 안내·'안내 문구' 탭). 읽지 못하면 null
  pageContent: SupportPageContent | null
  pageContentStatus: 'ok' | 'missing' | 'invalid' | 'error'
  siteName: string
  isOwner: boolean
}

type MemberContact = { email: string | null; phone: string | null }

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

// 문의 상태 이름(색은 admin-status-tone 의 supportTicket 줄, 5-1 표)
const statusConfig: Record<string, { label: string }> = {
  pending: { label: '대기 중' },
  in_progress: { label: '처리 중' },
  resolved: { label: '해결됨' },
  closed: { label: '종료' },
  deleted: { label: '고객삭제' },
}

const FILTER_SELECT_CLASS =
  'h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-text)] max-sm:w-full'

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

// 세지 못한 건수(null)는 '확인 불가'(0과 구분)
const formatCount = (count: number | null) => formatAdminCount(count === null ? ADMIN_UNAVAILABLE : count)

export function SupportClient({
  tickets, ticketCounts, pagination, searchTruncated, linkedTicket, initialCategories, initialFilters,
  lockedCategoryIds, initialTemplates, pageContent, pageContentStatus, siteName, isOwner,
}: SupportClientProps) {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<'tickets' | 'categories' | 'templates' | 'content'>('tickets')
  const [templates, setTemplates] = useState<SupportReplyTemplateRow[] | null>(initialTemplates)
  // 첫 답변 저장 요청 키(창을 열 때 만든다 — 같은 요청을 다시 보내도 한 번만 저장된다)
  const [answerOperationKey, setAnswerOperationKey] = useState(() => crypto.randomUUID())
  const blankMarker = pageContent?.admin.templateBlankMarker ?? null
  const [categories, setCategories] = useState<SupportCategory[]>(initialCategories)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(linkedTicket)
  const [response, setResponse] = useState(linkedTicket?.admin_response || '')
  // 첫 답변이 충돌(다른 관리자가 먼저 답함)하면 쓰던 글을 버리지 않고 보여 주고, [답변 수정]의 처음 값으로 넘긴다.
  const [conflictDraft, setConflictDraft] = useState<string | null>(null)
  // 상세 창을 연 문의의 회원 요약. 마지막으로 응답을 받은 문의 id와 함께 둔다(다르면 아직 불러오는 중).
  const [memberSummary, setMemberSummary] = useState<{
    ticketId: string; data: AdminMemberSummary | null; failed: boolean; contact: MemberContact | null; contactMasked: boolean
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState(initialFilters.status)
  const [categoryFilter, setCategoryFilter] = useState(initialFilters.categoryId)
  const [queryText, setQueryText] = useState(initialFilters.q)
  const [includeDeleted, setIncludeDeleted] = useState(initialFilters.includeDeleted)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SupportCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm)
  const [categorySubmitting, setCategorySubmitting] = useState(false)
  const { ask, dialog: confirmDialog } = useAdminConfirm()

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
        if (res.status === 403) return { data: null, failed: false, contact: null, contactMasked: false }
        if (!res.ok || !result?.success) throw new Error('member summary failed')
        // 13번: 전화번호는 목록에 없고 여기서만 받는다(서버가 열람 기록을 남긴 뒤, 기록 실패면 가림)
        return { data: result.data as AdminMemberSummary, failed: false, contact: (result.contact ?? null) as MemberContact | null, contactMasked: Boolean(result.contactMasked) }
      })
      .catch(() => ({ data: null, failed: true, contact: null, contactMasked: false }))
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
    setConflictDraft(null)
    setAnswerOperationKey(crypto.randomUUID())
  }

  // 13번 5절: 답변 수정·충돌 뒤 상세 창의 문의를 최신 값으로 바꾼다.
  const mergeSelectedTicket = (patch: Partial<AnswerTicketState> | null) => {
    if (!patch) return
    setSelectedTicket((current) => (current && (!patch.id || patch.id === current.id) ? { ...current, ...patch } as Ticket : current))
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
          // 13번: 지금 보이는 답변(첫 답변이면 빈 글)의 sha256 — 그사이 다른 사람이 답했으면 서버가 충돌로 막는다.
          expectedSha256: await sha256Hex(selectedTicket.admin_response ?? ''),
          operationKey: answerOperationKey,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 409 && data.code === 'SUPPORT_ANSWER_CONFLICT') {
          setConflictDraft(response)
          mergeSelectedTicket(data.latest ?? null)
          setAnswerOperationKey(crypto.randomUUID())
        }
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

  // (가) 먼저 묻기: 확인 전에는 요청을 보내지 않는다(문구는 전의 브라우저 확인 창 그대로).
  const hideCategory = async (category: SupportCategory) => {
    const confirmed = await ask({
      title: `'${category.name}' 카테고리를 숨김 처리하시겠습니까?`,
      description: '기존 문의의 카테고리 스냅샷은 유지됩니다.',
      confirmLabel: '숨김 처리',
      danger: true,
    })
    if (!confirmed) {
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

  // 13번 7절: 숨긴 카테고리 되살리기(순서는 그대로).
  const restoreCategory = async (category: SupportCategory) => {
    const confirmed = await ask({
      title: `'${category.name}' 카테고리를 다시 사용할까요?`,
      description: '회원 문의 화면에 다시 보입니다.',
      confirmLabel: '다시 사용',
    })
    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/admin/support/categories/${category.id}/restore`, {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '카테고리를 다시 사용하지 못했습니다.')
      }

      const data = await res.json()
      setCategories(categories.map((item) => item.id === data.category.id ? data.category : item))
      toast.success('카테고리를 다시 사용합니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리를 다시 사용하지 못했습니다.')
    }
  }

  const activeCategories = categories.filter((category) => !category.deleted_at)
  const hiddenCategories = categories.filter((category) => category.deleted_at)
  const editingLocked = editingCategory ? lockedCategoryIds.includes(editingCategory.id) : false
  const editingHidden = Boolean(editingCategory?.deleted_at)
  const responseBlanksLeft = blankMarker ? findTemplateBlanks(response, blankMarker).length > 0 : false

  // 날짜 표기는 지금 모양(toLocaleDateString ko-KR) 그대로(20번: 대표가 바꾸기로 정하기 전까지).
  const ticketColumns: AdminDataTableColumn<Ticket>[] = [
    {
      key: 'subject',
      header: '문의',
      // 문의 제목·본문은 화면 비교 때 가린다.
      pii: true,
      className: 'min-w-[16rem]',
      cell: (ticket) => {
        const isDeleted = ticket.is_deleted_by_user
        return (
          <div className="min-w-0 break-words">
            {/* 행 누르기는 첫 열의 단추로(키보드 초점 가능). 회원이 삭제한 문의도 연다(내용만 보기). */}
            <button
              type="button"
              className={`text-left font-medium hover:underline ${isDeleted ? 'text-[var(--studio-muted)] line-through' : 'text-[var(--studio-ink)]'}`}
              onClick={() => openTicket(ticket)}
            >
              {ticket.subject}
            </button>
            <p className="mt-1 line-clamp-1 text-xs text-[var(--studio-muted)]">{ticket.message}</p>
          </div>
        )
      },
    },
    { key: 'category', header: '카테고리', className: 'text-sm', cell: (ticket) => getTicketCategoryName(ticket) },
    {
      key: 'status',
      header: '상태',
      cell: (ticket) => {
        const statusKey = ticket.is_deleted_by_user ? 'deleted' : (ticket.status || 'pending')
        return <AdminStatusBadge label={statusConfig[statusKey]?.label ?? statusKey} tone={adminStatusTone('supportTicket', statusKey)} />
      },
    },
    { key: 'member', header: '회원', pii: true, className: 'break-all text-xs text-[var(--studio-muted)]', cell: (ticket) => ticket.profiles?.email || '알 수 없음' },
    { key: 'createdAt', header: '접수일', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (ticket) => new Date(ticket.created_at).toLocaleDateString('ko-KR') },
    {
      key: 'respondedAt',
      header: '답변',
      className: 'whitespace-nowrap text-xs',
      cell: (ticket) => (ticket.responded_at && !ticket.is_deleted_by_user
        ? <span className="text-[var(--admin-tone-success-text)]">답변완료: {new Date(ticket.responded_at).toLocaleDateString('ko-KR')}</span>
        : '-'),
    },
  ]

  return (
    <div className="space-y-6">
      <AdminMetricGrid>
        <AdminMetricCard title="대기 중" value={formatCount(ticketCounts.pending)} />
        <AdminMetricCard title="해결됨" value={formatCount(ticketCounts.resolved)} />
        <AdminMetricCard title="고객 삭제" value={formatCount(ticketCounts.deleted)} />
        <AdminMetricCard title="사용 카테고리" value={activeCategoryCount} />
      </AdminMetricGrid>

      <nav aria-label="고객지원 관리 구역" className="flex flex-wrap items-center gap-2">
        <Button
          variant={activeSection === 'tickets' ? 'brand' : 'brandOutline'}
          aria-pressed={activeSection === 'tickets'}
          onClick={() => setActiveSection('tickets')}
        >
          문의 목록
        </Button>
        <Button
          variant={activeSection === 'categories' ? 'brand' : 'brandOutline'}
          aria-pressed={activeSection === 'categories'}
          onClick={() => setActiveSection('categories')}
        >
          카테고리 관리
        </Button>
        <Button
          variant={activeSection === 'templates' ? 'brand' : 'brandOutline'}
          aria-pressed={activeSection === 'templates'}
          onClick={() => setActiveSection('templates')}
        >
          답변 템플릿
        </Button>
        {isOwner && (
          <Button
            variant={activeSection === 'content' ? 'brand' : 'brandOutline'}
            aria-pressed={activeSection === 'content'}
            onClick={() => setActiveSection('content')}
          >
            안내 문구
          </Button>
        )}
      </nav>

      {activeSection === 'tickets' && (
        <div className="space-y-4">
          {/* 필터는 고른 뒤 [적용]으로 주소에 남긴다(지금 방식 그대로). */}
          <AdminFilterBar
            className="mb-0"
            search={
              <Input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="제목/내용/회원 이메일 검색"
                aria-label="문의 검색"
                className="w-64 max-sm:w-full"
                data-admin-pii=""
              />
            }
            filters={
              <>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="상태"
                  className={FILTER_SELECT_CLASS}
                >
                  <option value="all">전체</option>
                  <option value="pending">대기 중</option>
                  <option value="in_progress">처리 중</option>
                  <option value="resolved">해결됨</option>
                  <option value="closed">종료</option>
                  <option value="deleted">고객삭제</option>
                </select>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  aria-label="카테고리"
                  className={FILTER_SELECT_CLASS}
                >
                  <option value="all">전체 카테고리</option>
                  <option value="uncategorized">미분류</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <label className="flex h-10 items-center gap-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] px-3 text-sm text-[var(--studio-text)]">
                  <input
                    type="checkbox"
                    checked={includeDeleted}
                    onChange={(e) => setIncludeDeleted(e.target.checked)}
                  />
                  삭제 포함
                </label>
                <Button variant="brand" onClick={applyFilters}>적용</Button>
              </>
            }
            resultCount={pagination.totalCount}
            onReset={resetFilters}
          />

          {searchTruncated && (
            <AdminNotice kind="warning">
              검색어에 맞는 회원이 많아 일부 회원의 문의만 보입니다. 이메일을 더 길게 입력해 주세요.
            </AdminNotice>
          )}

          <AdminDataTable
            caption="문의 목록"
            columns={ticketColumns}
            rows={tickets}
            getRowKey={(ticket) => ticket.id}
            minWidth={860}
            state={tickets.length === 0 ? <AdminTableState kind="empty" message="등록된 문의가 없습니다." /> : undefined}
          />

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
        <Card className="rounded-[var(--studio-radius-card)] border-[var(--studio-border)] shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">카테고리 관리</CardTitle>
                <p className="mt-1 text-sm text-[var(--studio-muted)]">사용자 문의 카테고리와 작성 안내 문구를 추가, 수정, 숨김 처리합니다.</p>
              </div>
              <Button variant="brand" onClick={openCreateCategory}>
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
                카테고리 추가
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {categories.length === 0 ? (
              <AdminTableState kind="empty" message="등록된 카테고리가 없습니다." className="m-4" />
            ) : (
              <div className="divide-y divide-[var(--studio-border)]">
                <p className="bg-[var(--studio-background)] px-4 py-2 text-xs font-medium text-[var(--studio-muted)]">사용 중 {activeCategories.length}개</p>
                {activeCategories.map((category) => (
                  <div key={category.id} className="flex items-start justify-between gap-4 p-4 max-md:flex-col max-md:gap-3">
                    <div className="min-w-0 space-y-2 break-words">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--studio-ink)]">{category.name}</span>
                        <AdminStatusBadge label={category.slug} tone="neutral" className="font-mono" />
                        <AdminStatusBadge
                          label={category.is_active && !category.deleted_at ? '사용' : '숨김'}
                          tone={adminStatusTone('supportOption', category.is_active && !category.deleted_at ? 'active' : 'hidden')}
                        />
                      </div>
                      <p className="text-sm text-[var(--studio-muted)]">{category.description || '설명 없음'}</p>
                      {category.help_text && <p className="text-xs text-[var(--studio-muted)]">안내: {category.help_text}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="adminTable" size="sm" onClick={() => openEditCategory(category)}>
                        <Pencil aria-hidden="true" className="mr-1 h-4 w-4" />
                        수정
                      </Button>
                      {!category.deleted_at && (
                        <Button variant="adminTable" size="sm" className="text-[var(--admin-tone-danger-text)]" onClick={() => void hideCategory(category)}>
                          <Trash2 aria-hidden="true" className="mr-1 h-4 w-4" />
                          숨김 처리
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {hiddenCategories.length > 0 && (
                  <>
                    <p className="bg-[var(--studio-background)] px-4 py-2 text-xs font-medium text-[var(--studio-muted)]">숨김 {hiddenCategories.length}개 · 회원 화면에 보이지 않습니다</p>
                    {hiddenCategories.map((category) => (
                      <div key={category.id} className="flex items-start justify-between gap-4 p-4 opacity-80 max-md:flex-col max-md:gap-3">
                        <div className="min-w-0 space-y-2 break-words">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[var(--studio-text)]">{category.name}</span>
                            <AdminStatusBadge label={category.slug} tone="neutral" className="font-mono" />
                            <AdminStatusBadge label="숨김" tone={adminStatusTone('supportOption', 'hidden')} />
                          </div>
                          <p className="text-sm text-[var(--studio-muted)]">{category.description || '설명 없음'}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="adminTable" size="sm" onClick={() => openEditCategory(category)}>
                            <Pencil aria-hidden="true" className="mr-1 h-4 w-4" />
                            수정
                          </Button>
                          <Button variant="adminTable" size="sm" onClick={() => void restoreCategory(category)}>
                            <RotateCcw aria-hidden="true" className="mr-1 h-4 w-4" />
                            다시 사용
                          </Button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeSection === 'templates' && (
        <ReplyTemplatesPanel
          templates={templates}
          onTemplatesChange={setTemplates}
          categories={categories}
          blankMarker={blankMarker}
        />
      )}

      {activeSection === 'content' && isOwner && (
        <SupportPageContentPanel initialContent={pageContent} initialStatus={pageContentStatus} />
      )}

      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl max-md:max-h-[calc(100dvh-2rem)] max-md:max-w-[calc(100vw-2rem)] max-md:overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-admin-pii="">{selectedTicket?.subject}</DialogTitle>
            <DialogDescription>
              <span data-admin-pii="">{selectedContactText(selectedTicket, memberSummary)}</span> •{' '}
              {selectedTicket && <Link href={`/admin/users/${selectedTicket.user_id}`} className="text-[var(--studio-primary)] hover:underline">회원 상세</Link>} •{' '}
              {selectedTicket && new Date(selectedTicket.created_at).toLocaleString('ko-KR')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusBadge label={selectedTicket ? getTicketCategoryName(selectedTicket) : '미분류'} tone="neutral" />
              {selectedTicket && getStatusBadge(selectedTicket.is_deleted_by_user ? 'deleted' : selectedTicket.status)}
            </div>
            {selectedTicket?.is_deleted_by_user && (
              <AdminNotice kind="warning">
                회원이 삭제한 문의입니다. 내용만 볼 수 있고 답변은 등록할 수 없습니다.
              </AdminNotice>
            )}
            {selectedTicket && <MemberSummary ticket={selectedTicket} summary={memberSummary?.ticketId === selectedTicket.id ? memberSummary : null} />}
            <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] p-4">
              <p className="mb-2 text-sm font-medium text-[var(--studio-ink)]">문의 내용</p>
              <p data-admin-pii="" className="whitespace-pre-wrap text-[var(--studio-text)]">{selectedTicket?.message}</p>
            </div>

            {selectedTicket?.admin_response && (
              <div className="rounded-[var(--studio-radius-control)] border border-[var(--admin-tone-success-border)] bg-[var(--admin-tone-success-soft)] p-4">
                <p className="mb-2 text-sm font-medium text-[var(--admin-tone-success-text)]">
                  관리자 답변
                  {selectedTicket.response_edited_at && (
                    <span className="ml-2 text-xs font-normal text-[var(--studio-muted)]">수정됨 · {new Date(selectedTicket.response_edited_at).toLocaleString('ko-KR')}</span>
                  )}
                </p>
                <p data-admin-pii="" className="whitespace-pre-wrap text-[var(--studio-text)]">{selectedTicket.admin_response}</p>
              </div>
            )}

            {conflictDraft && selectedTicket?.admin_response && (
              <AdminNotice kind="warning" title="저장되지 않은 쓰던 글(다른 관리자가 먼저 답했습니다) — [답변 수정]을 누르면 이 글로 시작합니다.">
                <p data-admin-pii="" className="whitespace-pre-wrap text-[var(--studio-text)]">{conflictDraft}</p>
              </AdminNotice>
            )}

            {selectedTicket && (
              <TicketAnswerEdit
                key={selectedTicket.id}
                ticket={selectedTicket}
                draft={conflictDraft}
                reasonGuide={pageContent?.admin.answerEditReasonGuide || null}
                blankMarker={blankMarker}
                templates={templates}
                siteName={siteName}
                onConflict={mergeSelectedTicket}
                onSaved={(saved, notificationFailed) => {
                  setConflictDraft(null)
                  mergeSelectedTicket(saved)
                  if (notificationFailed) {
                    toast.warning('답변은 고쳤지만 회원 알림을 만들지 못했습니다.')
                  } else {
                    toast.success('답변을 고쳤습니다.')
                  }
                  router.refresh()
                }}
              />
            )}

            {selectedTicket?.status === 'pending' && !selectedTicket.is_deleted_by_user && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--studio-ink)]">답변 작성</p>
                  <ReplyTemplatePicker templates={templates} ticket={selectedTicket} siteName={siteName} currentText={response} onInsert={setResponse} disabled={submitting} />
                </div>
                <Textarea
                  placeholder="답변을 입력하세요..."
                  rows={4}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  aria-label="답변"
                  data-admin-pii=""
                />
                <TemplateBlankPreview text={response} marker={blankMarker} />
                {!blankMarker && <AdminNotice kind="error">답변 검사 설정을 읽지 못해 지금은 답변을 저장할 수 없습니다.</AdminNotice>}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="brandOutline" onClick={() => setSelectedTicket(null)}>
              닫기
            </Button>
            {selectedTicket?.status === 'pending' && !selectedTicket.is_deleted_by_user && (
              <Button variant="brand" onClick={handleRespond} disabled={submitting || !response.trim() || !blankMarker || responseBlanksLeft}>
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
                disabled={editingLocked}
              />
              {editingLocked && (
                <p className="text-xs text-[var(--studio-muted)]">문의가 달렸거나 탈퇴 회원 기록 가림에 쓰이는 카테고리라 코드를 바꿀 수 없습니다.</p>
              )}
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
                disabled={editingHidden && !editingCategory?.is_active}
              />
              사용자 화면에 노출
              {editingHidden && <span className="text-xs text-[var(--studio-muted)]">(숨긴 카테고리는 목록의 [다시 사용]으로 되살려 주세요)</span>}
            </label>
          </div>

          <DialogFooter>
            <Button variant="brandOutline" onClick={() => setCategoryDialogOpen(false)}>취소</Button>
            <Button variant="brand" onClick={saveCategory} disabled={categorySubmitting}>
              {categorySubmitting ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  )
}

// 13번 8-2: 상세 창의 연락처. 이메일은 목록에서 붙여 온 값, 전화번호는 회원 요약(열람 기록을 남긴 뒤)에서 받은 값이다.
function selectedContactText(
  ticket: Ticket | null,
  summary: { ticketId: string; contact: MemberContact | null; contactMasked: boolean } | null
) {
  if (!ticket) return ''
  const loaded = summary?.ticketId === ticket.id ? summary : null
  if (loaded?.contactMasked) return '연락처 가림(열람 기록 실패)'
  const phone = loaded ? loaded.contact?.phone || '전화번호 없음' : '전화번호 불러오는 중'
  const email = loaded?.contact?.email || ticket.profiles?.email || '이메일 없음'
  return `${phone} • ${email}`
}

// 상세 창의 회원 요약. 권한이 없어 서버가 세지 않은 항목(null)은 그리지 않는다.
function MemberSummary({ ticket, summary }: {
  ticket: Ticket
  summary: { data: AdminMemberSummary | null; failed: boolean } | null
}) {
  if (!summary) return <p className="text-sm text-[var(--studio-muted)]">회원 요약을 불러오는 중…</p>
  if (summary.failed) return <AdminNotice kind="error">회원 요약을 불러오지 못했습니다.</AdminNotice>
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
    <div className="rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm">
      <p className="mb-1 flex flex-wrap items-center gap-2 font-medium text-[var(--studio-ink)]">
        회원 요약
        {suspension && !suspension.failed && suspension.data > 0 && <AdminStatusBadge label="정지 중" tone={adminStatusTone('member', 'restricted')} />}
        {suspension?.failed && <span className="text-xs font-normal text-[var(--admin-tone-danger-text)]">정지 여부 확인 불가</span>}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map(({ label, section, href }) => (
          <li key={label}>
            <span className="text-[var(--studio-muted)]">{label} </span>
            {!section || section.failed ? (
              <span className="text-[var(--admin-tone-danger-text)]">확인 불가</span>
            ) : href ? (
              <Link href={href} className="text-[var(--studio-primary)] hover:underline">{formatAdminCount(section.data, '건')}</Link>
            ) : (
              <span>{formatAdminCount(section.data, '건')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function getStatusBadge(status: string | null) {
  const key = statusConfig[status || 'pending'] ? status || 'pending' : 'pending'
  return <AdminStatusBadge label={statusConfig[key].label} tone={adminStatusTone('supportTicket', key)} />
}
