import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { AdminCategoryTreeNode } from '@/components/admin/market-category-tree-editor'
import { findCategoryPath } from '@/lib/market-category-tree'
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

export function CategoryField({ ctx }: { ctx: ProductAdminContext }) {
  const {
    categoryNodes, setIsCategoryManagerOpen, categoryItemId, setCategoryItemId, selectedCategoryPath,
    selectedCategory,
  } = ctx

  return (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>카테고리 <span className="text-red-500">*</span></Label>
                  <Button type="button" variant="adminAction" size="sm" onClick={() => setIsCategoryManagerOpen(true)}>
                    카테고리 관리
                  </Button>
                </div>
                {selectedCategoryPath.length > 0 ? (
                  <p className="text-sm text-gray-700">{selectedCategoryPath.map(categoryNodeLabel).join(' > ')}</p>
                ) : null}
                <CategoryStepSelect
                  nodes={categoryNodes}
                  value={categoryItemId}
                  onChange={setCategoryItemId}
                  emptyLabel="카테고리 선택"
                  ariaLabel="상품 카테고리"
                />
                {selectedCategory && selectedCategory.children.length > 0 ? (
                  <p className="text-xs text-amber-700">하위 칸이 있습니다. 하위 칸 선택을 권장합니다.</p>
                ) : null}
              </div>
  )
}

export { categoryNodeLabel, CategoryStepSelect }
