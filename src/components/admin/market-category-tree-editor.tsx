'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarketImageField, type MarketImageFieldValue } from '@/components/admin/market-image-field'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_CATEGORY_MAX_DEPTH } from '@/lib/market-category-tree'
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

  const renderAddForm = (depth: number) => (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3" style={{ marginLeft: (depth - 1) * 24 }}>
      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{depth}단계</span>
      <Input
        value={newTitle}
        onChange={(event) => setNewTitle(event.target.value)}
        placeholder="칸 이름"
        aria-label={`${depth}단계 칸 이름`}
        className="w-72"
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
    const draft = drafts[node.id] ?? { title: node.title, sortOrder: String(node.sortOrder) }
    const isDirty = draft.title !== node.title || Number(draft.sortOrder) !== node.sortOrder
    const collapsed = !expandedIds.has(node.id)
    const canAddChild = node.depth < MARKET_CATEGORY_MAX_DEPTH
    return (
      <Fragment key={node.id}>
        <li
          className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0 ${node.isActive ? '' : 'opacity-60'}`}
          style={{ paddingLeft: 12 + (node.depth - 1) * 24 }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleExpanded(node.id)}
              aria-expanded={!collapsed}
              aria-label={`${node.title} ${collapsed ? '펼치기' : '접기'}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              {collapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
            </button>
          ) : (
            <span className="size-8" aria-hidden />
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{node.depth}단계</span>
          <Input
            value={draft.title}
            aria-label="칸 이름"
            className="w-64"
            onChange={(event) => setDrafts((current) => ({ ...current, [node.id]: { ...draft, title: event.target.value } }))}
          />
          <Input
            value={draft.sortOrder}
            aria-label="정렬 순서"
            inputMode="numeric"
            className="w-20"
            onChange={(event) => setDrafts((current) => ({ ...current, [node.id]: { ...draft, sortOrder: event.target.value } }))}
          />
          <span className={`rounded px-2 py-1 text-xs font-medium ${node.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {node.isActive ? '활성' : '비활성'}
          </span>
          <span className="text-xs text-muted-foreground">
            상품 {node.productCount.toLocaleString()}
            {node.deletedProductCount > 0 ? ` (삭제 ${node.deletedProductCount.toLocaleString()})` : ''}
          </span>
          {/* 기본 이미지는 2단계부터 고른다 */}
          {node.depth > 1 ? (
            <MarketImageField
              label={`'${node.title}' 기본 이미지`}
              value={node.defaultImage}
              disabled={savingId === node.id}
              onChange={(image) => void patchNode(node.id, { default_image_id: image?.id ?? null })}
            />
          ) : null}
          <a
            href={`/categories/${node.id}?subject=${subject}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue-600 underline underline-offset-2"
          >
            새 탭 열기
          </a>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={savingId === node.id || !isDirty} onClick={() => saveDraft(node)}>
              저장
            </Button>
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
                하위 추가
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" disabled={savingId === node.id} onClick={() => deleteNode(node)}>
              삭제
            </Button>
          </div>
        </li>
        {addingParentId === node.id ? <li className="border-b px-3 py-2">{renderAddForm(node.depth + 1)}</li> : null}
        {!collapsed && node.children.length > 0 ? renderNodes(node.children) : null}
      </Fragment>
    )
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          1단계~{MARKET_CATEGORY_MAX_DEPTH}단계까지 칸을 만들 수 있습니다. 상품은 어느 칸에든 연결할 수 있고, 위 칸 페이지에는 아래 칸 상품이 모두 보입니다.
          상품이 연결된 칸(하위 칸 포함)은 삭제할 수 없으니 비활성화하거나 상품을 옮긴 뒤 삭제하세요. 기본 이미지는 2단계부터 지정할 수 있습니다.
        </p>
        <Button type="button" onClick={() => openAddForm(null)}>1단계 추가</Button>
      </div>

      {addingParentId === null ? renderAddForm(1) : null}

      <div className="rounded-lg border">
        {isLoading && nodes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : nodes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            아직 칸이 없습니다. [1단계 추가]로 첫 칸을 만드세요.
          </p>
        ) : (
          <ul className="text-sm">{renderNodes(nodes)}</ul>
        )}
      </div>
    </div>
  )
}
