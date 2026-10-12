'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarketImageField, type MarketImageFieldValue } from '@/components/admin/market-image-field'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_CATEGORY_MAX_DEPTH, findCategoryPath } from '@/lib/market-category-tree'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export interface AdminCategoryTreeNode {
  id: string
  title: string
  depth: number
  sortOrder: number
  isActive: boolean
  // 상품 이미지가 없는 연결 상품에 표시되는 기본 이미지
  defaultImage: MarketImageFieldValue | null
  // 자기 칸 + 하위 칸에 연결된 상품 수(삭제된 상품 포함)
  productCount: number
  deletedProductCount: number
  children: AdminCategoryTreeNode[]
}

interface RowDraft {
  title: string
  sortOrder: string
}

function getErrorMessage(result: unknown, fallback: string) {
  const error = (result as { error?: unknown } | null)?.error
  if (typeof error === 'string') {
    return error
  }
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : fallback
}

const flatten = (nodes: AdminCategoryTreeNode[]): AdminCategoryTreeNode[] => (
  nodes.flatMap((node) => [node, ...flatten(node.children)])
)

// '카테고리 메뉴 관리' 화면과 상품 관리의 [카테고리 관리] 팝업이 함께 쓰는 칸 트리 편집기.
// 저장할 때마다 트리를 다시 읽어 onTreeChange로 알린다.
export function MarketCategoryTreeEditor({
  subject,
  onTreeChange,
}: {
  subject: WorkspaceSubject
  onTreeChange?: (tree: AdminCategoryTreeNode[]) => void
}) {
  const [nodes, setNodes] = useState<AdminCategoryTreeNode[]>([])
  const nodesRef = useRef<AdminCategoryTreeNode[]>([])
  const onTreeChangeRef = useRef(onTreeChange)
  const [isLoading, setIsLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  // 처음에는 모두 접힌 상태로 시작하고, 펼친 칸만 기억한다.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  // 하위 칸 추가 입력을 연 칸(null = 최상단 1단계 추가)
  const [addingParentId, setAddingParentId] = useState<string | null | undefined>(undefined)
  const [newTitle, setNewTitle] = useState('')
  const [newSortOrder, setNewSortOrder] = useState('')
  // 오른쪽 편집 패널에 띄운 칸
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 칸 이름 검색어: 맞는 칸과 그 상위 경로만 펼쳐 보여 준다.
  const [query, setQuery] = useState('')

  useEffect(() => {
    onTreeChangeRef.current = onTreeChange
  }, [onTreeChange])

  const loadTree = useCallback(async (resetId?: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/market-categories', subject))
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(getErrorMessage(result, '카테고리를 불러오지 못했습니다.'))
      }
      const rows: AdminCategoryTreeNode[] = result.data?.nodes ?? []
      const previousRows = flatten(nodesRef.current)
      nodesRef.current = rows
      setNodes(rows)
      // 다른 칸에서 편집 중인 초안은 지키고, 방금 저장한 칸(resetId)과 편집하지 않은 칸만 새 값으로 맞춘다.
      setDrafts((current) => Object.fromEntries(flatten(rows).map((row) => {
        const before = previousRows.find((candidate) => candidate.id === row.id)
        const draft = current[row.id]
        const isDirty = Boolean(draft && before && (draft.title !== before.title || draft.sortOrder !== String(before.sortOrder)))
        return [row.id, isDirty && row.id !== resetId ? draft : { title: row.title, sortOrder: String(row.sortOrder) }]
      })))
      onTreeChangeRef.current?.(rows)
    } catch (error) {
      alert(error instanceof Error ? error.message : '카테고리를 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [subject])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  // 실패하면 서버 안내 문구를 그대로 보여 주고 트리를 다시 읽지 않는다(변화 없음).
  const runMutation = async (savingKey: string, request: () => Promise<Response>, fallbackMessage: string) => {
    setSavingId(savingKey)
    try {
      const response = await request()
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(getErrorMessage(result, fallbackMessage))
      }
      await loadTree(savingKey)
      return true
    } catch (error) {
      alert(error instanceof Error ? error.message : fallbackMessage)
      return false
    } finally {
      setSavingId(null)
    }
  }

  const openAddForm = (parentId: string | null) => {
    setAddingParentId(parentId)
    setNewTitle('')
    setNewSortOrder('')
  }

  const createNode = async () => {
    const title = newTitle.trim()
    if (!title) {
      alert('칸 이름을 입력하세요.')
      return
    }
    const parentId = addingParentId ?? null
    const succeeded = await runMutation('new-node', () => fetch('/api/admin/market-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_subject: subject,
        parent_id: parentId,
        title,
        sort_order: Number(newSortOrder) || 0,
      }),
    }), '칸 추가에 실패했습니다.')
    if (succeeded) {
      setAddingParentId(undefined)
      if (parentId) {
        setExpandedIds((current) => new Set(current).add(parentId))
      }
    }
  }

  const patchNode = (nodeId: string, payload: { title?: string; sort_order?: number; is_active?: boolean; default_image_id?: string | null }) => (
    runMutation(nodeId, () => fetch(`/api/admin/market-categories/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), '칸 저장에 실패했습니다.')
  )

  const deleteNode = (node: AdminCategoryTreeNode) => {
    if (!window.confirm('이 칸을 삭제할까요?')) {
      return
    }
    void runMutation(node.id, () => fetch(`/api/admin/market-categories/${node.id}`, {
      method: 'DELETE',
    }), '칸 삭제에 실패했습니다.')
  }

  const saveDraft = (node: AdminCategoryTreeNode) => {
    const draft = drafts[node.id]
    if (!draft) return
    void patchNode(node.id, {
      title: draft.title.trim(),
      sort_order: Number(draft.sortOrder) || 0,
    })
  }

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  // 칸을 고르면 그 상위 경로를 펼쳐 두어, 검색어를 지워도 트리에서 위치가 보이게 한다.
  const selectNode = (nodeId: string) => {
    setSelectedId(nodeId)
    if (typeof addingParentId === 'string' && addingParentId !== nodeId) {
      setAddingParentId(undefined)
    }
    const ancestors = (findCategoryPath(nodes, nodeId) ?? []).slice(0, -1)
    if (ancestors.length > 0) {
      setExpandedIds((current) => {
        const next = new Set(current)
        ancestors.forEach((ancestor) => next.add(ancestor.id))
        return next
      })
    }
  }

  const allNodes = flatten(nodes)
  const selectedPath = selectedId ? findCategoryPath(nodes, selectedId) : null
  const selectedNode = selectedPath?.at(-1) ?? null
  const keyword = query.trim().toLowerCase()
  const isMatch = (node: AdminCategoryTreeNode) => Boolean(keyword) && node.title.toLowerCase().includes(keyword)
  // 검색 중에는 맞는 칸과 그 상위 칸만 보인다.
  const visibleIds = new Set(keyword
    ? allNodes.filter(isMatch).flatMap((node) => (findCategoryPath(nodes, node.id) ?? []).map((pathNode) => pathNode.id))
    : [])

  const renderAddForm = (depth: number) => (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{depth}단계</span>
      <Input
        value={newTitle}
        onChange={(event) => setNewTitle(event.target.value)}
        placeholder="칸 이름"
        aria-label={`${depth}단계 칸 이름`}
        className="w-56"
        autoFocus
      />
      <Input
        value={newSortOrder}
        onChange={(event) => setNewSortOrder(event.target.value)}
        placeholder="정렬 순서 (숫자)"
        aria-label="정렬 순서"
        className="w-36"
        inputMode="numeric"
      />
      <Button type="button" size="sm" disabled={savingId === 'new-node'} onClick={() => void createNode()}>
        {savingId === 'new-node' ? '추가 중…' : '추가'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAddingParentId(undefined)}>
        취소
      </Button>
    </div>
  )

  const renderNodes = (list: AdminCategoryTreeNode[]) => list.map((node) => {
    if (keyword && !visibleIds.has(node.id)) {
      return null
    }
    const collapsed = keyword ? false : !expandedIds.has(node.id)
    const selected = node.id === selectedId
    return (
      <Fragment key={node.id}>
        <li
          className={`flex items-center gap-1 border-b py-1 pr-3 last:border-b-0 ${selected ? 'bg-violet-50' : 'hover:bg-muted/50'} ${node.isActive ? '' : 'opacity-60'}`}
          style={{ paddingLeft: 8 + (node.depth - 1) * 20 }}
        >
          {node.children.length > 0 && !keyword ? (
            <button
              type="button"
              onClick={() => toggleExpanded(node.id)}
              aria-expanded={!collapsed}
              aria-label={`${node.title} ${collapsed ? '펼치기' : '접기'}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              {collapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
            </button>
          ) : (
            <span className="size-7 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => selectNode(node.id)}
            aria-current={selected ? 'true' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
          >
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{node.depth}단계</span>
            <span className={`truncate ${selected || isMatch(node) ? 'font-semibold text-violet-700' : ''}`}>{node.title}</span>
            {node.isActive ? null : <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">비활성</span>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">상품 {node.productCount.toLocaleString()}</span>
          </button>
        </li>
        {!collapsed && node.children.length > 0 ? renderNodes(node.children) : null}
      </Fragment>
    )
  })

  // 오른쪽 편집 패널: 고른 칸 하나만 편집한다.
  const renderDetail = (node: AdminCategoryTreeNode) => {
    const draft = drafts[node.id] ?? { title: node.title, sortOrder: String(node.sortOrder) }
    const isDirty = draft.title !== node.title || Number(draft.sortOrder) !== node.sortOrder
    const canAddChild = node.depth < MARKET_CATEGORY_MAX_DEPTH
    // 자기 이미지가 없으면 가장 가까운 상위 칸 이미지를 이어받는다(공개 화면과 같은 규칙).
    const inherited = (selectedPath ?? []).slice(0, -1).findLast((pathNode) => pathNode.defaultImage) ?? null
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{(selectedPath ?? []).map((pathNode) => pathNode.title).join(' > ')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{node.depth}단계</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${node.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {node.isActive ? '활성' : '비활성'}
            </span>
            <span className="text-xs text-muted-foreground">
              상품 {node.productCount.toLocaleString()}
              {node.deletedProductCount > 0 ? ` (삭제 ${node.deletedProductCount.toLocaleString()})` : ''}
            </span>
            <a
              href={`/categories/${node.id}?subject=${subject}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm text-blue-600 underline underline-offset-2"
            >
              새 탭 열기
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 space-y-1 text-xs text-muted-foreground">
            이름
            <Input
              value={draft.title}
              aria-label="칸 이름"
              onChange={(event) => setDrafts((current) => ({ ...current, [node.id]: { ...draft, title: event.target.value } }))}
            />
          </label>
          <label className="w-24 space-y-1 text-xs text-muted-foreground">
            정렬 순서
            <Input
              value={draft.sortOrder}
              aria-label="정렬 순서"
              inputMode="numeric"
              onChange={(event) => setDrafts((current) => ({ ...current, [node.id]: { ...draft, sortOrder: event.target.value } }))}
            />
          </label>
          <Button type="button" size="sm" disabled={savingId === node.id || !isDirty} onClick={() => saveDraft(node)}>
            저장
          </Button>
        </div>
        {/* 기본 이미지는 2단계부터 고른다 */}
        {node.depth > 1 ? (
          <MarketImageField
            label={`'${node.title}' 기본 이미지`}
            value={node.defaultImage}
            disabled={savingId === node.id}
            onChange={(image) => void patchNode(node.id, { default_image_id: image?.id ?? null })}
            fallback={inherited?.defaultImage
              ? { image: inherited.defaultImage, description: `'${inherited.title}' 칸의 기본 이미지를 이어받아 표시됩니다.` }
              : null}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={savingId === node.id}
            onClick={() => void patchNode(node.id, { is_active: !node.isActive })}
          >
            {node.isActive ? '비활성화' : '활성화'}
          </Button>
          {canAddChild ? (
            <Button type="button" size="sm" variant="outline" onClick={() => openAddForm(node.id)}>
              {node.depth + 1}단계 하위 추가
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" className="ml-auto text-red-600" disabled={savingId === node.id} onClick={() => deleteNode(node)}>
            삭제
          </Button>
        </div>
        {addingParentId === node.id ? renderAddForm(node.depth + 1) : null}
      </div>
    )
  }

  const hasMatches = !keyword || visibleIds.size > 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        1단계~{MARKET_CATEGORY_MAX_DEPTH}단계까지 칸을 만들 수 있습니다. 상품은 어느 칸에든 연결할 수 있고, 위 칸 페이지에는 아래 칸 상품이 모두 보입니다.
        상품이 연결된 칸(하위 칸 포함)은 삭제할 수 없으니 비활성화하거나 상품을 옮긴 뒤 삭제하세요. 기본 이미지는 2단계부터 지정할 수 있고, 지정하지 않은 아래 칸은 가장 가까운 위 칸의 이미지를 이어받습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="칸 이름 검색"
          aria-label="칸 이름 검색"
          className="w-64"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => setExpandedIds(new Set(allNodes.filter((node) => node.children.length > 0).map((node) => node.id)))}>
          모두 펼치기
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setExpandedIds(new Set())}>
          모두 접기
        </Button>
        <Button type="button" className="ml-auto" onClick={() => openAddForm(null)}>1단계 추가</Button>
      </div>

      {addingParentId === null ? renderAddForm(1) : null}

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-lg border">
          {isLoading && nodes.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : nodes.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              아직 칸이 없습니다. [1단계 추가]로 첫 칸을 만드세요.
            </p>
          ) : hasMatches ? (
            <ul className="text-sm">{renderNodes(nodes)}</ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">&apos;{query.trim()}&apos;와 맞는 칸이 없습니다.</p>
          )}
        </div>
        <div className="rounded-lg border p-4 md:sticky md:top-4">
          {selectedNode ? renderDetail(selectedNode) : (
            <p className="py-8 text-center text-sm text-muted-foreground">왼쪽에서 칸을 고르면 이름·순서·기본 이미지를 편집할 수 있습니다.</p>
          )}
        </div>
      </div>
    </div>
  )
}
