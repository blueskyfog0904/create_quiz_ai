import { useState } from 'react'
import { toast } from 'sonner'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { PUBLISH_CHECK_TARGET_IDS } from '@/lib/admin-market-publish-checks'
import type { MarketItem } from '@/lib/market-items-server'
import type { MarketItemDuplicateMode, MarketItemDuplicateResult } from '@/lib/market-item-duplicate'
import { focusProductFieldAfterRender } from '../_lib/focus-field'
import type { ProductFormApi } from './use-product-form'
import type { MarketProductsState } from '../market-products-client'

// 18번 7·8절: [같은 구성으로 다음 상품](저장 뒤 창)·[복제](목록 행). 서버 DB 함수가 한 거래로 임시저장 사본을 만든다.
// 만든 상품 id 는 화면 메모리(sessionCopyItemIds)에 두어, 그 상품의 첫 저장 뒤에도 저장 뒤 창을 띄운다.
export function useProductDuplicate(ctx: MarketProductsState & ProductFormApi) {
  const {
    mode, router, workspaceSubject, form, setForm, categoryItemId, refreshItems, loadItemDetail, resetForm, setAfterSaveItem, setSessionCopyItemIds,
  } = ctx
  const [duplicatingItemId, setDuplicatingItemId] = useState<string | null>(null)
  // 목록 [복제] 확인 창 대상
  const [duplicateTarget, setDuplicateTarget] = useState<MarketItem | null>(null)

  const requestDuplicate = async (sourceItemId: string, mode: MarketItemDuplicateMode) => {
    setDuplicatingItemId(sourceItemId)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${sourceItemId}/duplicate`, workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || '상품을 복제하지 못했습니다.')
      }
      const result = payload.data as MarketItemDuplicateResult
      setSessionCopyItemIds((current) => [...current, result.itemId])
      await refreshItems().catch(() => undefined)
      await loadItemDetail(result.itemId)
      if (result.skippedSubproductCount > 0) {
        toast.info(`지운 구성의 서브상품 ${result.skippedSubproductCount}개는 복사하지 않았습니다.`)
      }
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '상품을 복제하지 못했습니다.')
      return null
    } finally {
      setDuplicatingItemId(null)
    }
  }

  // 저장 뒤 창 [같은 구성으로 다음 상품]: 새 임시 상품 편집으로 가서 제목 칸을 비우고 초점을 둔다(DB 제목은 '새 상품').
  const handleStartNextFromItem = async (sourceItemId: string) => {
    const result = await requestDuplicate(sourceItemId, 'next')
    if (!result) return
    setAfterSaveItem(null)
    setForm((current) => ({ ...current, title: '' }))
    focusProductFieldAfterRender(PUBLISH_CHECK_TARGET_IDS.title)
    toast.success('같은 구성으로 새 상품을 임시저장했습니다. 제목을 입력하고 파일을 올려 주세요.')
  }

  // 목록 [복제] 확인 → 임시저장 사본 편집으로 이동
  const handleConfirmDuplicate = async () => {
    if (!duplicateTarget) return
    const result = await requestDuplicate(duplicateTarget.id, 'copy')
    setDuplicateTarget(null)
    if (result) toast.success('임시저장 사본을 만들었습니다. 판매 파일·샘플·이용 근거는 복사하지 않았습니다.')
  }

  // 저장 뒤 창 [빈 새 상품]: 카테고리만 남은 빈 새 상품 폼.
  // 관리 화면은 편집 폼을 상품을 고를 때만 그리므로 등록 화면(과목 유지, 카테고리를 주소로 넘김)으로 간다.
  // 등록 화면은 새 상품·최종 등록 뒤에 이미 빈 폼이고, 복제한 상품에 머문 경우는 그 카테고리로 빈 폼.
  const handleStartBlankAfterSave = () => {
    setAfterSaveItem(null)
    if (mode === 'manage') {
      const query = categoryItemId ? `?categoryId=${encodeURIComponent(categoryItemId)}` : ''
      router.push(withAdminWorkspaceSubject(`/admin/market/products/new${query}`, workspaceSubject))
      return
    }
    if (form.id) resetForm(categoryItemId)
  }

  return {
    duplicatingItemId, duplicateTarget, setDuplicateTarget, requestDuplicate, handleStartNextFromItem, handleConfirmDuplicate,
    handleStartBlankAfterSave,
  }
}

export type ProductDuplicateApi = ReturnType<typeof useProductDuplicate>
