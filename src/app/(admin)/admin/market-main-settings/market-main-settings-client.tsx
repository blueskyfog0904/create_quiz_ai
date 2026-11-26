'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, Pencil, Plus, Search, X } from 'lucide-react'
import { MarketHomeSections } from '@/app/preview/solvook-concept/_components/home/market-home-sections'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminSaveBar, type AdminSaveStatus } from '@/components/admin/kit/admin-save-bar'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminWorkspaceSwitcher } from '@/components/layout/admin-workspace-switcher'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { MARKET_ITEM_STATUS_LABELS } from '@/lib/admin-orders'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  MARKET_HOME_FEATURED_EXCLUSION_LABELS,
  MARKET_HOME_LIMITS,
  MARKET_HOME_SECTION_KINDS,
  MARKET_HOME_SECTION_KIND_LABELS,
  addFeaturedItem,
  addMarketHomeSection,
  canAddMarketHomeSection,
  diffMarketHomeSections,
  moveMarketHomeSection,
  removeFeaturedItem,
  validateMarketHomeDraft,
  type MarketHomeConfig,
  type MarketHomeData,
  type MarketHomeFeaturedExclusionReason,
  type MarketHomeItem,
  type MarketHomeRenderedSection,
  type MarketHomeSection,
  type MarketHomeSectionKind,
} from '@/lib/market-home'
import type { MarketHomeAdminData, MarketHomeFeaturedPreview, MarketHomeItemSearchResult } from '@/lib/market-home-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketMainSettingsClientProps extends MarketHomeAdminData {
  workspaceSubject: WorkspaceSubject
  // 지금 회원 홈에 보이는 배너 수(미리보기의 빈 홈 링크 판정용)
  visibleBannerCount: number
}

// 편집 중 값: 빈 홈 링크는 입력 칸 글(빈 글 = 없음). 저장 때 다듬는다.
interface EditDraft {
  sections: MarketHomeSection[]
  emptyHomeLink: string
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: { code?: string; message?: string }
}

type ExcludedInfo = { reason: MarketHomeFeaturedExclusionReason; title: string | null }

const APPLY_NOTE = '저장하면 바로 회원 홈에 반영됩니다(상품 정보는 최대 1분).'

function toEditDraft(value: { sections: MarketHomeSection[]; emptyHomeLink: string | null }): EditDraft {
  return { sections: value.sections.map((section) => ({ ...section })), emptyHomeLink: value.emptyHomeLink ?? '' }
}

// 저장할 값: 앞뒤 공백을 떼고, 빈 문구는 null(섹션째 숨김)
function toPayload(draft: EditDraft) {
  return {
    sections: draft.sections.map((section) => ({
      ...section,
      title: section.title.trim(),
      emptyText: section.emptyText?.trim() ? section.emptyText.trim() : null,
    })),
    emptyHomeLink: draft.emptyHomeLink.trim() || null,
  }
}

function countChanges(saved: EditDraft, draft: EditDraft) {
  const before = toPayload(saved)
  const after = toPayload(draft)
  return diffMarketHomeSections(before.sections, after.sections).length + (before.emptyHomeLink !== after.emptyHomeLink ? 1 : 0)
}

function mergePreview(
  previews: MarketHomeFeaturedPreview[],
  cards: Record<string, MarketHomeItem>,
  excluded: Record<string, ExcludedInfo>
) {
  const nextCards = { ...cards }
  const nextExcluded = { ...excluded }
  for (const preview of previews) {
    for (const item of preview.items) {
      nextCards[item.id] = item
      delete nextExcluded[item.id]
    }
    for (const entry of preview.excluded) {
      nextExcluded[entry.id] = { reason: entry.reason, title: entry.title }
      delete nextCards[entry.id]
    }
  }
  return { cards: nextCards, excluded: nextExcluded }
}

export default function MarketMainSettingsClient({
  workspaceSubject,
  state: initialState,
  revision: initialRevision,
  draft: initialDraft,
  pool,
  featured,
  visibleBannerCount,
}: MarketMainSettingsClientProps) {
  const subjectLabel = workspaceSubject === 'english' ? '영어' : '국어'
  const [configState, setConfigState] = useState(initialState)
  const [revision, setRevision] = useState(initialRevision)
  const [draft, setDraft] = useState(() => toEditDraft(initialDraft))
  const [saved, setSaved] = useState(() => toEditDraft(initialDraft))
  const [status, setStatus] = useState<AdminSaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [itemState, setItemState] = useState(() => mergePreview(Object.values(featured), {}, {}))
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<MarketHomeItemSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([])
  const { ask, dialog } = useAdminConfirm()
  const router = useRouter()

  const dirtyCount = countChanges(saved, draft)
  const editing = draft.sections.find((section) => section.id === editingId) ?? null

  const updateSection = (id: string, patch: Partial<MarketHomeSection>) => {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === id ? { ...section, ...patch } as MarketHomeSection : section)),
    }))
  }

  const addSection = (kind: MarketHomeSectionKind) => {
    const id = crypto.randomUUID()
    setDraft((current) => ({ ...current, sections: addMarketHomeSection(current.sections, kind, id) }))
    setSearchResults(null)
    setSearchText('')
    setEditingId(id)
  }

  const removeSection = async (section: MarketHomeSection) => {
    const itemNote = section.kind === 'featured' ? ` 고른 상품 ${section.itemIds.length}개 목록도 함께 사라집니다.` : ''
    const ok = await ask({
      title: '섹션을 지울까요?',
      description: `‘${section.title || '제목 없음'}’ 섹션을 지웁니다.${itemNote} 저장해야 회원 홈에 반영됩니다.`,
      confirmLabel: '지우기',
      danger: true,
    })
    if (!ok) return
    setDraft((current) => ({ ...current, sections: current.sections.filter((entry) => entry.id !== section.id) }))
  }

  const toggleSection = async (section: MarketHomeSection, isActive: boolean) => {
    if (!isActive && section.kind === 'featured' && section.isActive) {
      const ok = await ask({
        title: '추천 섹션을 끌까요?',
        description: `‘${section.title || '제목 없음'}’ 섹션이 회원 홈에서 사라집니다. 고른 상품 ${section.itemIds.length}개 목록은 남습니다.`,
        confirmLabel: '끄기',
      })
      if (!ok) return
    }
    updateSection(section.id, { isActive })
  }

  const runSearch = async () => {
    setSearching(true)
    setSearchError(null)
    try {
      const url = `/api/admin/market-main-settings/item-search?subject=${workspaceSubject}&q=${encodeURIComponent(searchText)}`
      const response = await fetch(url)
      const body = await response.json() as ApiResponse<{ items: MarketHomeItemSearchResult[] }>
      if (!response.ok || !body.success || !body.data) throw new Error(body.error?.message || '상품을 찾지 못했습니다.')
      setSearchResults(body.data.items)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '상품을 찾지 못했습니다.')
    } finally {
      setSearching(false)
    }
  }

  // 고른 상품의 카드·안 보이는 이유를 읽는다(회원 홈과 같은 거르기, 3-2)
  const loadItemPreview = async (itemIds: string[]) => {
    if (itemIds.length === 0) return
    setPendingItemIds((current) => [...current, ...itemIds])
    try {
      const response = await fetch('/api/admin/market-main-settings/preview-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: workspaceSubject, itemIds }),
      })
      const body = await response.json() as ApiResponse<MarketHomeFeaturedPreview>
      if (!response.ok || !body.success || !body.data) throw new Error(body.error?.message || '미리보기를 읽지 못했습니다.')
      const preview = body.data
      setItemState((current) => mergePreview([preview], current.cards, current.excluded))
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '미리보기를 읽지 못했습니다.')
    } finally {
      setPendingItemIds((current) => current.filter((id) => !itemIds.includes(id)))
    }
  }

  const addItem = (section: MarketHomeSection, itemId: string) => {
    if (section.kind !== 'featured') return
    const itemIds = addFeaturedItem(section.itemIds, itemId)
    if (itemIds === section.itemIds) return
    updateSection(section.id, { itemIds })
    if (!itemState.cards[itemId] && !itemState.excluded[itemId]) void loadItemPreview([itemId])
  }

  const handleSave = async () => {
    const payload = toPayload(draft)
    try {
      validateMarketHomeDraft(payload)
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '입력값을 확인해 주세요.')
      return
    }
    setStatus('saving')
    setErrorMessage(null)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/market-main-settings', workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revision, config: payload }),
      })
      const body = await response.json() as ApiResponse<{ config: MarketHomeConfig }>
      if (response.status === 409) {
        setConflict(true)
        throw new Error(body.error?.message || '다른 관리자가 먼저 저장했습니다. 다시 불러오세요.')
      }
      if (!response.ok || !body.success || !body.data) throw new Error(body.error?.message || '홈 진열 설정을 저장하지 못했습니다.')
      const next = toEditDraft(body.data.config)
      setRevision(body.data.config.revision)
      setDraft(next)
      setSaved(next)
      setConfigState('ok')
      setStatus('saved')
      setSavedAt(new Date())
      // 미리보기 재료(인기 집계 기간·상품)와 배너 수를 저장된 값 기준으로 다시 받는다(편집 값은 그대로 둔다)
      router.refresh()
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '홈 진열 설정을 저장하지 못했습니다.')
    }
  }

  // 회원 홈 미리보기(저장 전 값, 실제 카드 부품): 인기·최근은 미리 읽은 24개를 개수만큼 자르고, 추천은 고른 순서대로.
  const previewSections: MarketHomeRenderedSection[] = toPayload(draft).sections.filter((section) => section.isActive).map((section) => {
    const base = { id: section.id, title: section.title || '(제목 없음)', emptyText: section.emptyText }
    if (section.kind === 'popular') return { ...base, kind: 'popular', items: pool.popular.slice(0, section.limit) }
    if (section.kind === 'recent') return { ...base, kind: 'recent', items: pool.recent.slice(0, section.limit) }
    return { ...base, kind: 'featured', items: section.itemIds.flatMap((id) => (itemState.cards[id] ? [itemState.cards[id]] : [])) }
  })
  const previewData: MarketHomeData = {
    subject: workspaceSubject,
    state: 'ok',
    sections: previewSections,
    emptyHomeLink: draft.emptyHomeLink.trim() || null,
  }
  // Q3: 안 보이는 추천 상품은 저장을 막지 않고 경고만 한다
  const hiddenFeaturedCount = draft.sections.reduce((count, section) => (
    section.kind === 'featured' ? count + section.itemIds.filter((id) => itemState.excluded[id]).length : count
  ), 0)
  const popularDraft = draft.sections.find((section) => section.kind === 'popular')
  const windowChanged = popularDraft?.kind === 'popular' && popularDraft.isActive && popularDraft.rankingWindowDays !== pool.rankingWindowDays

  const columns: AdminDataTableColumn<MarketHomeSection>[] = [
    {
      key: 'order',
      header: '순서',
      cell: (section, index) => (
        <div className="flex items-center gap-1">
          <span className="w-5 text-center tabular-nums text-[var(--studio-muted)]">{index + 1}</span>
          <Button type="button" variant="adminTable" size="icon" aria-label={`${index + 1}번 섹션 위로`} disabled={index === 0}
            onClick={() => setDraft((current) => ({ ...current, sections: moveMarketHomeSection(current.sections, index, 'up') }))}>
            <ArrowUp aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" variant="adminTable" size="icon" aria-label={`${index + 1}번 섹션 아래로`} disabled={index === draft.sections.length - 1}
            onClick={() => setDraft((current) => ({ ...current, sections: moveMarketHomeSection(current.sections, index, 'down') }))}>
            <ArrowDown aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ),
    },
    { key: 'kind', header: '종류', cell: (section) => MARKET_HOME_SECTION_KIND_LABELS[section.kind] },
    {
      key: 'title',
      header: '제목',
      cell: (section) => (
        <div className="min-w-0 space-y-0.5">
          <p className="break-keep font-medium">{section.title.trim() || <span className="text-[var(--studio-muted)]">제목 없음</span>}</p>
          <p className="break-keep text-xs text-[var(--studio-muted)]">
            {section.emptyText?.trim() ? `비었을 때: ${section.emptyText.trim()}` : '비었을 때 섹션 숨김'}
          </p>
        </div>
      ),
    },
    {
      key: 'active',
      header: '켜기',
      cell: (section) => (
        <Switch
          aria-label={`${section.title.trim() || MARKET_HOME_SECTION_KIND_LABELS[section.kind]} 섹션 켜기`}
          checked={section.isActive}
          onCheckedChange={(checked) => void toggleSection(section, checked)}
        />
      ),
    },
    {
      key: 'count',
      header: '상품',
      cell: (section) => {
        if (section.kind === 'popular') return `최대 ${section.limit}개 · 최근 ${section.rankingWindowDays}일`
        if (section.kind === 'recent') return `최대 ${section.limit}개`
        const hidden = section.itemIds.filter((id) => itemState.excluded[id]).length
        return (
          <span className="space-x-1">
            <span>{section.itemIds.length}개 고름</span>
            {hidden > 0 ? <AdminStatusBadge label={`안 보임 ${hidden}`} tone="warning" /> : null}
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">동작</span>,
      align: 'right',
      cell: (section) => (
        <div className="flex items-center justify-end gap-1">
          <Button type="button" variant="adminTable" size="sm" onClick={() => { setSearchResults(null); setSearchText(''); setEditingId(section.id) }}>
            <Pencil aria-hidden="true" className="size-4" />
            편집
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="adminTable" size="icon" aria-label={`${section.title.trim() || '제목 없음'} 섹션 더 보기`}>
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void removeSection(section)}>지우기</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]

  const links = [
    ['/admin/market/products', '상품 관리'],
    ['/admin/market-categories', '카테고리 관리'],
    ['/admin/main-ad-settings', '메인 광고 설정'],
  ] as const

  return (
    <main className="flex w-full flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        className="mb-0"
        title={<AdminMenuName href="/admin/market-main-settings" fallback="(임시) 문제마켓 메인 관리" />}
        description={`${subjectLabel} 문제마켓 홈의 섹션 순서·제목·추천 자료를 정합니다. 과목마다 따로 저장합니다.`}
        tools={<AdminWorkspaceSwitcher />}
        meta={(
          <span className="flex flex-wrap gap-x-3">
            {links.map(([href, label]) => (
              <Link key={href} className="underline-offset-2 hover:underline" href={withAdminWorkspaceSubject(href, workspaceSubject)}>
                <AdminMenuName href={href} fallback={label} />
              </Link>
            ))}
          </span>
        )}
      />

      {configState !== 'ok' ? (
        <AdminNotice kind="error" title="회원 홈 설정이 없거나 형식이 다릅니다">
          지금 {subjectLabel} 회원 홈에는 섹션이 보이지 않습니다. 섹션을 정해 저장하면 바로 고쳐집니다.
          {configState === 'invalid' ? ' 읽을 수 있는 섹션만 아래에 채웠습니다.' : ''}
        </AdminNotice>
      ) : null}
      {conflict ? (
        <AdminNotice kind="error" title="다른 관리자가 먼저 저장했습니다" onRetry={() => window.location.reload()} retryLabel="다시 불러오기">
          다시 불러오면 지금 고친 내용은 사라집니다. 필요한 내용은 적어 두세요.
        </AdminNotice>
      ) : null}

      <section className="space-y-3" aria-labelledby="market-home-sections-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="market-home-sections-heading" className="text-lg font-semibold">섹션</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="brandOutline" disabled={draft.sections.length >= MARKET_HOME_LIMITS.sections.max}>
                <Plus aria-hidden="true" className="size-4" />
                섹션 추가
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {MARKET_HOME_SECTION_KINDS.map((kind) => (
                <DropdownMenuItem key={kind} disabled={!canAddMarketHomeSection(draft.sections, kind)} onSelect={() => addSection(kind)}>
                  {MARKET_HOME_SECTION_KIND_LABELS[kind]}
                  {!canAddMarketHomeSection(draft.sections, kind) && kind !== 'featured' ? ' (이미 있음)' : ''}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <AdminDataTable
          caption={`${subjectLabel} 홈 섹션`}
          columns={columns}
          rows={draft.sections}
          getRowKey={(section) => section.id}
          minWidth={760}
          state={draft.sections.length === 0
            ? <AdminTableState kind="empty" message="섹션이 없습니다. [섹션 추가]로 하나 이상 만들어 저장하세요." />
            : undefined}
        />
        <p className="text-xs text-[var(--studio-muted)]">
          섹션은 {MARKET_HOME_LIMITS.sections.max}개까지, 인기·최근은 하나씩, 추천은 여러 개 둘 수 있습니다. 상품이 0개인 섹션은 빈 화면 문구가 있을 때만 보입니다.
        </p>
        <div className="max-w-xl space-y-1">
          <Label htmlFor="market-home-empty-link">빈 홈 링크 문구</Label>
          <Input
            id="market-home-empty-link"
            value={draft.emptyHomeLink}
            maxLength={MARKET_HOME_LIMITS.emptyHomeLink.max}
            onChange={(event) => setDraft((current) => ({ ...current, emptyHomeLink: event.target.value }))}
          />
          <p className="text-xs text-[var(--studio-muted)]">보일 섹션과 배너가 모두 없을 때 {subjectLabel} 문제마켓으로 가는 한 줄입니다. 비우면 보이지 않습니다.</p>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="market-home-preview-heading">
        <h2 id="market-home-preview-heading" className="text-lg font-semibold">회원 홈 미리보기</h2>
        {pool.error ? <AdminNotice kind="warning">인기·최근 상품을 읽지 못해 미리보기가 비어 보일 수 있습니다.</AdminNotice> : null}
        {windowChanged ? (
          <AdminNotice kind="info">인기 집계 기간을 바꿨습니다. 미리보기는 저장된 기간({pool.rankingWindowDays}일) 기준이고, 새 기간은 저장 뒤 반영됩니다.</AdminNotice>
        ) : null}
        <p className="text-xs text-[var(--studio-muted)]">저장 전 값입니다. 지금 보이는 배너 {visibleBannerCount}개는 &apos;홈 배너&apos; 화면에서 정합니다.</p>
        <div className="studio-theme overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-background)] p-4 sm:p-6">
          <div className="space-y-10">
            <MarketHomeSections subject={workspaceSubject} homeData={previewData} visibleBannerCount={visibleBannerCount} />
          </div>
        </div>
      </section>

      {hiddenFeaturedCount > 0 ? (
        <AdminNotice kind="warning">
          추천 섹션에 고른 상품 중 {hiddenFeaturedCount}개는 지금 회원 홈에 보이지 않습니다(편집 창에 회색으로 표시). 그대로 저장해도 되고, 빼도 됩니다.
        </AdminNotice>
      ) : null}

      <AdminSaveBar
        variant="fixed"
        dirtyCount={dirtyCount}
        status={status}
        savedAt={savedAt}
        errorMessage={errorMessage}
        applyNote={APPLY_NOTE}
        onSave={() => void handleSave()}
        saveDisabled={conflict}
      />

      <Sheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditingId(null) }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {editing ? (
            <>
              <SheetHeader>
                <SheetTitle>{MARKET_HOME_SECTION_KIND_LABELS[editing.kind]} 섹션 편집</SheetTitle>
                <SheetDescription>고친 내용은 아래 저장 바에서 저장해야 회원 홈에 반영됩니다.</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="space-y-1">
                  <Label htmlFor="market-home-section-title">제목</Label>
                  <Input
                    id="market-home-section-title"
                    value={editing.title}
                    maxLength={MARKET_HOME_LIMITS.title.max}
                    onChange={(event) => updateSection(editing.id, { title: event.target.value })}
                  />
                  <p className="text-xs text-[var(--studio-muted)]">{editing.title.trim().length}/{MARKET_HOME_LIMITS.title.max}자 · 회원 홈 섹션 제목</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="market-home-section-empty">빈 화면 문구</Label>
                  <Input
                    id="market-home-section-empty"
                    value={editing.emptyText ?? ''}
                    maxLength={MARKET_HOME_LIMITS.emptyText.max}
                    onChange={(event) => updateSection(editing.id, { emptyText: event.target.value === '' ? null : event.target.value })}
                  />
                  <p className="text-xs text-[var(--studio-muted)]">상품이 0개일 때 보일 글입니다. 비우면 섹션째 숨깁니다.</p>
                </div>
                {editing.kind === 'popular' || editing.kind === 'recent' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="market-home-section-limit">개수</Label>
                      <Input
                        id="market-home-section-limit"
                        type="number"
                        min={1}
                        max={MARKET_HOME_LIMITS[editing.kind].max}
                        value={editing.limit}
                        onChange={(event) => updateSection(editing.id, { limit: Number(event.target.value) })}
                      />
                    </div>
                    {editing.kind === 'popular' ? (
                      <div className="space-y-1">
                        <Label htmlFor="market-home-section-window">집계 기간(일)</Label>
                        <Input
                          id="market-home-section-window"
                          type="number"
                          min={MARKET_HOME_LIMITS.rankingWindowDays.min}
                          max={MARKET_HOME_LIMITS.rankingWindowDays.max}
                          value={editing.rankingWindowDays}
                          onChange={(event) => updateSection(editing.id, { rankingWindowDays: Number(event.target.value) })}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {editing.kind === 'featured' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="market-home-item-search">상품 찾기</Label>
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void runSearch()
                        }}
                      >
                        <Input id="market-home-item-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="제목 또는 상품 id" />
                        <Button type="submit" variant="adminTable" disabled={searching}>
                          {searching ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Search aria-hidden="true" className="size-4" />}
                          찾기
                        </Button>
                      </form>
                      {searchError ? <AdminNotice kind="error">{searchError}</AdminNotice> : null}
                      {searchResults ? (
                        searchResults.length === 0 ? (
                          <AdminTableState kind="empty" message="찾은 상품이 없습니다." />
                        ) : (
                          <ul className="divide-y rounded-[var(--studio-radius-card)] border">
                            {searchResults.map((result) => {
                              const chosen = editing.itemIds.includes(result.id)
                              return (
                                <li key={result.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                                  <span className="min-w-0 flex-1 break-keep">{result.title}</span>
                                  <AdminStatusBadge
                                    label={MARKET_ITEM_STATUS_LABELS[result.status as keyof typeof MARKET_ITEM_STATUS_LABELS] ?? result.status}
                                    tone={adminStatusTone('marketItem', result.status)}
                                  />
                                  {!result.isActive ? <AdminStatusBadge label="판매 꺼짐" tone="warning" /> : null}
                                  <Button
                                    type="button"
                                    variant="adminTable"
                                    size="sm"
                                    disabled={chosen || editing.itemIds.length >= MARKET_HOME_LIMITS.featuredItems.max}
                                    onClick={() => addItem(editing, result.id)}
                                  >
                                    {chosen ? '담음' : '더하기'}
                                  </Button>
                                </li>
                              )
                            })}
                          </ul>
                        )
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">고른 상품 {editing.itemIds.length}/{MARKET_HOME_LIMITS.featuredItems.max}</p>
                      {editing.itemIds.length === 0 ? (
                        <AdminTableState kind="empty" message="고른 상품이 없습니다. 위에서 찾아 더하세요." />
                      ) : (
                        <ol className="divide-y rounded-[var(--studio-radius-card)] border">
                          {editing.itemIds.map((itemId, index) => {
                            const card = itemState.cards[itemId]
                            const excluded = itemState.excluded[itemId]
                            const pending = pendingItemIds.includes(itemId)
                            return (
                              <li key={itemId} className={`flex items-center gap-2 px-3 py-2 text-sm ${excluded ? 'text-[var(--studio-muted)]' : ''}`}>
                                <span className="w-5 text-center tabular-nums">{index + 1}</span>
                                <span className="min-w-0 flex-1 break-keep">
                                  {card?.title ?? excluded?.title ?? searchResults?.find((result) => result.id === itemId)?.title ?? itemId}
                                </span>
                                {pending ? <Loader2 aria-label="확인 중" className="size-4 animate-spin" /> : null}
                                {excluded ? <AdminStatusBadge label={`지금 안 보임(${MARKET_HOME_FEATURED_EXCLUSION_LABELS[excluded.reason]})`} tone="neutral" /> : null}
                                <Button type="button" variant="adminTable" size="icon" aria-label={`${index + 1}번 상품 위로`} disabled={index === 0}
                                  onClick={() => updateSection(editing.id, { itemIds: moveMarketHomeSection(editing.itemIds, index, 'up') })}>
                                  <ArrowUp aria-hidden="true" className="size-4" />
                                </Button>
                                <Button type="button" variant="adminTable" size="icon" aria-label={`${index + 1}번 상품 아래로`} disabled={index === editing.itemIds.length - 1}
                                  onClick={() => updateSection(editing.id, { itemIds: moveMarketHomeSection(editing.itemIds, index, 'down') })}>
                                  <ArrowDown aria-hidden="true" className="size-4" />
                                </Button>
                                <Button type="button" variant="adminTable" size="icon" aria-label={`${index + 1}번 상품 빼기`}
                                  onClick={() => updateSection(editing.id, { itemIds: removeFeaturedItem(editing.itemIds, itemId) })}>
                                  <X aria-hidden="true" className="size-4" />
                                </Button>
                              </li>
                            )
                          })}
                        </ol>
                      )}
                      <p className="text-xs text-[var(--studio-muted)]">숨김·삭제·다른 과목이 된 상품은 회원 홈에서 저절로 빠집니다(회색 표시).</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      {dialog}
    </main>
  )
}
