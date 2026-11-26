import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MarketCategoryTreeEditor } from '@/components/admin/market-category-tree-editor'
import type { ProductAdminContext } from '../market-products-client'

export function CategoryManagerDialog({ ctx }: { ctx: ProductAdminContext }) {
  const {
    workspaceSubject, isCategoryManagerOpen, setIsCategoryManagerOpen, applyCategoryTree, reloadCategoryTree,
  } = ctx

  return (
      <Dialog open={isCategoryManagerOpen} onOpenChange={(open) => {
        setIsCategoryManagerOpen(open)
        if (!open) {
          void reloadCategoryTree()
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>카테고리 관리</DialogTitle>
            <DialogDescription>&apos;카테고리 메뉴 관리&apos;와 같은 칸 트리입니다. 바꾼 내용은 상품의 카테고리 선택칸에 바로 반영됩니다.</DialogDescription>
          </DialogHeader>
          <MarketCategoryTreeEditor subject={workspaceSubject} onTreeChange={applyCategoryTree} />
        </DialogContent>
      </Dialog>
  )
}
