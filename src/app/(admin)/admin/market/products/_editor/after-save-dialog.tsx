import { ExternalLink, Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AdminDataTable } from '@/components/admin/kit/admin-data-table'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { MARKET_STATUS_LABELS } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'

// 18번 8절: 공개·임시저장이 끝나면 다음 할 일을 고른다. 새 상품 저장·임시 상품 최종 등록·이 창에서 복제로 만든 상품의 첫 저장 뒤에만 뜬다.
// 관리자 조작 문구는 코드에 둔다(docs/admin-content-management-plan.md 기준).
export function AfterSaveDialog({ ctx }: { ctx: ProductAdminContext }) {
  const { afterSaveItem, setAfterSaveItem, workspaceSubject, duplicatingItemId, handleStartNextFromItem, handleStartBlankAfterSave } = ctx
  const isPublished = afterSaveItem?.status === 'published'

  return (
    <Dialog open={Boolean(afterSaveItem)} onOpenChange={(open) => {
      if (!open && !duplicatingItemId) setAfterSaveItem(null)
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isPublished ? '상품을 공개했습니다' : '상품을 저장했습니다'}</DialogTitle>
          <DialogDescription>
            {afterSaveItem ? `[${afterSaveItem.title}] ${MARKET_STATUS_LABELS[afterSaveItem.status]} 상태입니다. 다음에 할 일을 고르세요.` : ''}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          같은 구성으로 다음 상품을 만들면 카테고리·자료 정보·출처·서브상품·전체구매를 복사한 임시저장 상품이 생깁니다.
          제목·요약·설명·문항 수·이미지·판매 파일·샘플·이용 근거는 새로 입력합니다.
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          {afterSaveItem && isPublished ? (
            <Button asChild type="button" variant="brandOutline">
              <a href={`/items/${afterSaveItem.id}?subject=${workspaceSubject}`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                상세 페이지 보기
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="brandOutline" disabled={Boolean(duplicatingItemId)} onClick={handleStartBlankAfterSave}>
            빈 새 상품
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={!afterSaveItem || Boolean(duplicatingItemId)}
            onClick={() => afterSaveItem && void handleStartNextFromItem(afterSaveItem.id)}
          >
            {duplicatingItemId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            같은 구성으로 다음 상품
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 이번에 등록한 상품(화면 메모리에만 — 이 창을 닫으면 사라짐). [다시 수정]은 그 상품 편집으로 간다.
export function RegisteredItemsTable({ ctx }: { ctx: ProductAdminContext }) {
  const { registeredItems, loadItemDetail } = ctx
  if (registeredItems.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">이번에 등록한 상품</CardTitle>
        <p className="text-xs text-gray-500">이 창을 닫으면 사라지는 목록입니다. 전체 목록은 &apos;상품 관리&apos;에서 봅니다.</p>
      </CardHeader>
      <CardContent>
        {/* 20번 6단계: 표 부품. 열·버튼은 전과 같다. */}
        <AdminDataTable
          caption="이번에 등록한 상품"
          rows={registeredItems}
          getRowKey={(registered) => registered.id}
          minWidth={560}
          columns={[
            { key: 'title', header: '제목', className: 'font-medium text-gray-900', cell: (registered) => registered.title },
            {
              key: 'status',
              header: '상태',
              align: 'center',
              cell: (registered) => <AdminStatusBadge label={MARKET_STATUS_LABELS[registered.status]} tone={adminStatusTone('marketItem', registered.status)} />,
            },
            { key: 'subproducts', header: '서브상품', align: 'center', className: 'text-gray-600', cell: (registered) => `${registered.subproductCount}개` },
            {
              key: 'actions',
              header: '관리',
              align: 'right',
              cell: (registered) => (
                <Button type="button" variant="adminTable" size="sm" onClick={() => void loadItemDetail(registered.id)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  다시 수정
                </Button>
              ),
            },
          ]}
        />
      </CardContent>
    </Card>
  )
}
