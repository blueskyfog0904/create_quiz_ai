import { useState } from 'react'
import { toast } from 'sonner'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { MarketProductsState } from '../market-products-client'
import type { ProductFormApi } from './use-product-form'

// 19번 6-2: 서브상품 표의 [위로]·[아래로] → [순서 저장]. 상품 저장과 따로 저장한다(DB 함수 reorder_market_item_subproducts, 10·20·30…).
// 저장 안 된 순서는 상품마다 따로 두고, 다른 상품을 열면 버려진다(18번 범위의 확인 창 없음 — 표의 '순서 바뀜' 표시를 눈에 띄게 둔다).
export function useSubproductOrder(ctx: MarketProductsState & ProductFormApi) {
  const { workspaceSubject, form, items, subproducts, refreshEditingFiles } = ctx
  const [orderDraft, setOrderDraft] = useState<{ itemId: string; ids: string[] } | null>(null)
  const [isOrderSaving, setIsOrderSaving] = useState(false)

  const savedOrderIds = subproducts.map((subproduct) => subproduct.id)
  // 다른 상품의 초안이나 목록이 바뀐(추가·삭제) 뒤의 초안은 쓰지 않는다
  const draftIds = orderDraft && orderDraft.itemId === form.id
    && orderDraft.ids.length === savedOrderIds.length && savedOrderIds.every((id) => orderDraft.ids.includes(id))
    ? orderDraft.ids
    : null
  const subproductOrderIds = draftIds ?? savedOrderIds
  const isSubproductOrderChanged = draftIds !== null && draftIds.join(',') !== savedOrderIds.join(',')
  const isEditingPublishedItem = Boolean(form.id) && items.find((item) => item.id === form.id)?.status === 'published'

  const moveSubproduct = (subproductId: string, delta: -1 | 1) => {
    if (!form.id) return
    const current = [...subproductOrderIds]
    const index = current.indexOf(subproductId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= current.length) return
    ;[current[index], current[target]] = [current[target], current[index]]
    setOrderDraft({ itemId: form.id, ids: current })
  }

  const saveSubproductOrder = async () => {
    if (!form.id || !isSubproductOrderChanged) return
    const itemId = form.id
    setIsOrderSaving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/subproducts/order`, workspaceSubject), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: subproductOrderIds }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 순서 저장에 실패했습니다.')
      }

      await refreshEditingFiles(itemId)
      setOrderDraft(null)
      toast.success('서브상품 순서를 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 순서 저장 중 오류가 발생했습니다.')
    } finally {
      setIsOrderSaving(false)
    }
  }

  return {
    subproductOrderIds, isSubproductOrderChanged, isOrderSaving, isEditingPublishedItem, moveSubproduct, saveSubproductOrder,
  }
}

export type SubproductOrderApi = ReturnType<typeof useSubproductOrder>
