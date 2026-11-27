import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminCategoryTreeNode } from '@/components/admin/market-category-tree-editor'
import { findCategoryPath } from '@/lib/market-category-tree'
import {
  flattenCategoryPaths,
  parseRecentCategories,
  pushRecentCategory,
  searchCategoryPaths,
} from '@/lib/admin-category-search'
import { PUBLISH_CHECK_TARGET_IDS } from '@/lib/admin-market-publish-checks'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import type { ProductAdminContext } from '../market-products-client'

function categoryNodeLabel(node: AdminCategoryTreeNode) {
  return node.isActive ? node.title : `${node.title} (비활성)`
}

// 카테고리 단계별 선택: 고른 칸에 하위 칸이 있으면 다음 depth select가 나타난다(depth5까지).
// value는 가장 깊이 고른 칸 id('' = 선택 없음). 아래 단계의 '(여기까지 선택)'은 위 칸을 고른 상태다.
function CategoryStepSelect({
  nodes,
  value,
  onChange,
  emptyLabel,
  ariaLabel,
}: {
  nodes: AdminCategoryTreeNode[]
  value: string
  onChange: (categoryId: string) => void
  emptyLabel: string
  ariaLabel: string
}) {
  const path = (value ? findCategoryPath(nodes, value) : null) ?? []
  const levels = [
    { parentId: '', options: nodes },
    ...path.filter((node) => node.children.length > 0).map((node) => ({ parentId: node.id, options: node.children })),
  ]

  return (
    <div className="space-y-2">
      {levels.map((level, index) => (
        <select
          key={level.parentId || 'root'}
          aria-label={`${ariaLabel} depth${index + 1}`}
          value={path[index]?.id ?? ''}
          onChange={(event) => onChange(event.target.value || level.parentId)}
          className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
        >
          <option value="">{index === 0 ? emptyLabel : '(여기까지 선택)'}</option>
          {level.options.map((node) => (
            <option key={node.id} value={node.id}>{categoryNodeLabel(node)}</option>
          ))}
        </select>
      ))}
    </div>
  )
}

// 18번 7절(B-08): 최근 고른 카테고리(브라우저 저장, 과목별 3개 — 이 브라우저를 쓰는 관리자 것). 저장을 못 쓰면 칩 없이 동작한다.
const recentCategoryStorageKey = (subject: WorkspaceSubject) => `admin-product-recent-categories:${subject}`

function readRecentCategoryIds(subject: WorkspaceSubject) {
  try {
    return parseRecentCategories(window.localStorage.getItem(recentCategoryStorageKey(subject)))
  } catch {
    return []
  }
}

function writeRecentCategoryIds(subject: WorkspaceSubject, ids: string[]) {
  try {
    window.localStorage.setItem(recentCategoryStorageKey(subject), JSON.stringify(ids))
  } catch {
    // 저장을 못 하면 칩만 없다
  }
}

// 한 줄 검색칸: 전체 경로 후보 목록(키보드 위·아래·Enter·Esc). 비활성 후보는 흐리게 + '비활성'.
function CategorySearchBox({ nodes, onPick }: { nodes: AdminCategoryTreeNode[]; onPick: (categoryId: string) => void }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const paths = useMemo(() => flattenCategoryPaths(nodes), [nodes])
  const results = useMemo(() => searchCategoryPaths(paths, query), [paths, query])
  const listId = 'product-category-search-results'

  const pick = (categoryId: string) => {
    onPick(categoryId)
    setQuery('')
    setActiveIndex(0)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 한글 입력기 조합 중(Enter·위·아래로 조합을 끝내는 키)은 고르기로 보지 않는다
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      pick(results[activeIndex].id)
    } else if (event.key === 'Escape') {
      setQuery('')
      setActiveIndex(0)
    }
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      <Input
        id={PUBLISH_CHECK_TARGET_IDS.category}
        type="search"
        role="combobox"
        aria-label="카테고리 검색"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results[activeIndex] ? `${listId}-${results[activeIndex].id}` : undefined}
        aria-autocomplete="list"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
        placeholder="카테고리 검색 (예: 고1 모의고사)"
        className="pl-9"
      />
      {query.trim() ? (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-white p-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">맞는 카테고리가 없습니다.</li>
          ) : results.map((entry, index) => (
            <li
              key={entry.id}
              id={`${listId}-${entry.id}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault()
                pick(entry.id)
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-1.5 text-sm ${
                index === activeIndex ? 'bg-gray-100' : ''
              } ${entry.inactive ? 'text-gray-400' : 'text-gray-900'}`}
            >
              <span className="min-w-0 truncate">{entry.label}</span>
              {entry.inactive ? <span className="shrink-0 text-xs text-gray-400">비활성</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function CategoryField({ ctx }: { ctx: ProductAdminContext }) {
  const {
    categoryNodes, setIsCategoryManagerOpen, categoryItemId, setCategoryItemId, selectedCategoryPath,
    selectedCategory, workspaceSubject,
  } = ctx
  const [recentCategoryIds, setRecentCategoryIds] = useState<string[]>([])

  // 브라우저 저장소는 그린 뒤에만 읽는다(서버 그림과 맞춤).
  useEffect(() => {
    setRecentCategoryIds(readRecentCategoryIds(workspaceSubject))
  }, [workspaceSubject])

  const pickCategory = (categoryId: string) => {
    setCategoryItemId(categoryId)
    if (!categoryId) return
    const next = pushRecentCategory(recentCategoryIds, categoryId)
    setRecentCategoryIds(next)
    writeRecentCategoryIds(workspaceSubject, next)
  }
  // 최근 칩은 지금 트리에 있는 칸만(지운 칸은 뺌)
  const recentPaths = recentCategoryIds
    .map((id) => ({ id, path: findCategoryPath(categoryNodes, id) }))
    .filter((recent): recent is { id: string; path: AdminCategoryTreeNode[] } => Boolean(recent.path))
  const isSelectedInactive = selectedCategoryPath.some((node) => !node.isActive)

  return (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>카테고리 <span className="text-red-500">*</span></Label>
                  <Button type="button" variant="brandOutline" size="sm" onClick={() => setIsCategoryManagerOpen(true)}>
                    카테고리 관리
                  </Button>
                </div>
                {selectedCategoryPath.length > 0 ? (
                  <p className="text-sm text-gray-700">{selectedCategoryPath.map(categoryNodeLabel).join(' > ')}</p>
                ) : null}
                {isSelectedInactive ? (
                  <p className="text-xs text-red-700">비활성 칸입니다. 이 칸의 상품은 회원 메뉴에서 보이지 않습니다(공개 전 상품은 공개할 수 없음).</p>
                ) : null}
                {recentPaths.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-500">최근</span>
                    {recentPaths.map((recent) => (
                      <button
                        key={recent.id}
                        type="button"
                        onClick={() => pickCategory(recent.id)}
                        className={`max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs transition hover:bg-gray-50 ${
                          recent.id === categoryItemId ? 'border-gray-900 text-gray-900' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        {recent.path.map(categoryNodeLabel).join(' > ')}
                      </button>
                    ))}
                  </div>
                ) : null}
                <CategorySearchBox nodes={categoryNodes} onPick={pickCategory} />
                <details className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-900">목록에서 고르기</summary>
                  <div className="mt-2">
                <CategoryStepSelect
                  nodes={categoryNodes}
                  value={categoryItemId}
                  onChange={pickCategory}
                  emptyLabel="카테고리 선택"
                  ariaLabel="상품 카테고리"
                />
                  </div>
                </details>
                {selectedCategory && selectedCategory.children.length > 0 ? (
                  <p className="text-xs text-amber-700">하위 칸이 있습니다. 하위 칸 선택을 권장합니다.</p>
                ) : null}
              </div>
  )
}

export { categoryNodeLabel, CategoryStepSelect }
