import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { AlertTriangle, Copy, ExternalLink, Eye, EyeOff, Images, Loader2, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminConfirmDialog } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_EMPTY_TEXT, formatCount, formatCredits } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'
import type { MarketItem, MarketItemForAdmin } from '@/lib/market-items-server'
import { MarketImagePicker } from '@/components/admin/market-image-picker'
import { MARKET_IMAGE_MAX_BULK_ITEM_IDS, chunkArray } from '@/lib/market-images'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { CategoryStepSelect } from '../_editor/category-step'
import type { ProductFormApi } from '../_hooks/use-product-form'
import {
  getItemCategoryItemId,
  MARKET_STATUS_LABELS,
  MARKET_LIST_STATUS_TABS,
  ADMIN_LIST_DATE_FORMATTER,
  buildEditForm,
  MARKET_ITEM_HIDDEN_INSTEAD_MESSAGE,
  type MarketListSortKey,
} from '../_lib/product-form'
import type { MarketItemFormState } from '../_lib/types'
import type { MarketProductsState, ProductAdminContext } from '../market-products-client'

export function useProductListActions(ctx: MarketProductsState & ProductFormApi) {
  const {
    workspaceSubject, router, setItems, form, setForm, setIsArchiving, setHidingItemId, hiddenItemIds,
    setHiddenItemIds, setRequiresFinalRegistration, deleteTarget, setDeleteTarget, setSelectedItemIds,
    bulkDeleteTargetIds, setBulkDeleteTargetIds, setIsBulkActionRunning, categoryItemId, setThumbnailPreview,
    bulkImageTarget, setBulkImageTarget, selectedItems, bulkDeleteTargetItems, setHiddenOverride, buildItemPatchBody,
    refreshItems, resetForm,
  } = ctx

  const handleDeleteFromList = async () => {
    if (!deleteTarget) {
      return
    }

    setIsArchiving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${deleteTarget.id}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 완전 삭제에 실패했습니다.')
      }

      await refreshItems()
      if (form.id === deleteTarget.id) {
        resetForm(categoryItemId)
      }
      setSelectedItemIds((current) => current.filter((itemId) => itemId !== deleteTarget.id))
      setDeleteTarget(null)
      toast.success(payload.data?.result === 'hidden' ? MARKET_ITEM_HIDDEN_INSTEAD_MESSAGE : '문제마켓 상품을 완전 삭제했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 완전 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsArchiving(false)
    }
  }

  const handleVisibilityFromList = async (item: MarketItem) => {
    const isHidden = item.status === 'hidden' || hiddenItemIds.includes(item.id)
    const nextStatus = isHidden ? 'published' : 'hidden'

    setHidingItemId(item.id)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${item.id}`, workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildItemPatchBody(item, nextStatus)),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 상태 변경에 실패했습니다.')
      }

      setHiddenOverride(item.id, nextStatus === 'hidden')
      setItems((current) => current.map((currentItem) => (
        currentItem.id === item.id
          ? { ...currentItem, status: nextStatus, draft_source: 'manual' }
          : currentItem
      )))
      await refreshItems()
      if (form.id === item.id) {
        setForm(buildEditForm(payload.data as MarketItem))
        setRequiresFinalRegistration(false)
      }
      toast.success(isHidden ? '문제마켓 상품 숨김을 해제했습니다.' : '문제마켓 상품을 숨김 처리했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 상태 변경 중 오류가 발생했습니다.')
    } finally {
      setHidingItemId(null)
    }
  }

  const handleBulkVisibility = async () => {
    const targetItems = selectedItems
    if (targetItems.length === 0) {
      return
    }

    setIsBulkActionRunning(true)
    try {
      const results = await Promise.allSettled(targetItems.map(async (item) => {
        const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${item.id}`, workspaceSubject), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...buildItemPatchBody(item, 'hidden'), status: 'hidden' }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || `${item.title} 숨김 처리에 실패했습니다.`)
        }

        return payload.data as MarketItem
      }))

      const successIds = targetItems
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((item) => item.id)
      const failedIds = targetItems
        .filter((_, index) => results[index].status === 'rejected')
        .map((item) => item.id)

      successIds.forEach((itemId) => setHiddenOverride(itemId, true))
      setItems((current) => current.map((item) => successIds.includes(item.id)
        ? { ...item, status: 'hidden', draft_source: 'manual' }
        : item))

      const updatedItems = results
        .filter((result): result is PromiseFulfilledResult<MarketItem> => result.status === 'fulfilled')
        .map((result) => result.value)
      const updatedFormItem = updatedItems.find((item) => item.id === form.id)
      if (updatedFormItem) {
        setForm(buildEditForm(updatedFormItem))
        setRequiresFinalRegistration(false)
      }

      await refreshItems()
      setSelectedItemIds(failedIds)

      if (successIds.length > 0) {
        toast.success(`선택한 상품 ${successIds.length}개를 숨김 처리했습니다.`)
      }
      if (failedIds.length > 0) {
        toast.error(`선택한 상품 ${failedIds.length}개 숨김 처리에 실패했습니다.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '선택한 상품 숨김 처리 중 오류가 발생했습니다.')
    } finally {
      setIsBulkActionRunning(false)
    }
  }

  // 제안 F: 선택한 상품의 이미지를 한 번에 지정·해제한다(요청당 상품 수 한도로 나눠 보낸다).
  const handleBulkImageAssign = async () => {
    if (!bulkImageTarget) {
      return
    }

    const { itemIds, image } = bulkImageTarget
    setIsBulkActionRunning(true)
    let updatedCount = 0
    try {
      for (const chunk of chunkArray(itemIds, MARKET_IMAGE_MAX_BULK_ITEM_IDS)) {
        const response = await fetch(withAdminWorkspaceSubject('/api/admin/market/items/thumbnail', workspaceSubject), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: chunk, imageId: image?.id ?? null }),
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error?.message || '상품 이미지 일괄 지정에 실패했습니다.')
        }
        updatedCount += payload.data.updatedCount
      }

      if (form.id && itemIds.includes(form.id)) {
        setThumbnailPreview(image)
        setForm((current) => ({ ...current, thumbnailImageId: image?.id ?? null }))
      }
      setBulkImageTarget(null)
      setSelectedItemIds([])
      toast.success(image ? `상품 ${updatedCount}개에 이미지를 지정했습니다.` : `상품 ${updatedCount}개의 이미지를 해제했습니다.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '상품 이미지 일괄 지정 중 오류가 발생했습니다.')
      if (updatedCount > 0) toast.info(`상품 ${updatedCount}개는 이미 반영되었습니다.`)
    } finally {
      setIsBulkActionRunning(false)
      await refreshItems().catch(() => undefined)
      router.refresh()
    }
  }

  const handleBulkDelete = async () => {
    const targetItems = bulkDeleteTargetItems
    if (!bulkDeleteTargetIds || targetItems.length === 0) {
      return
    }

    setIsBulkActionRunning(true)
    try {
      const results = await Promise.allSettled(targetItems.map(async (item) => {
        const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${item.id}`, workspaceSubject), {
          method: 'DELETE',
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || `${item.title} 완전 삭제에 실패했습니다.`)
        }

        return { item, result: payload.data?.result === 'hidden' ? 'hidden' as const : 'deleted' as const }
      }))

      // 이력이 있는 상품은 서버가 지우지 않고 숨김으로 바꾼다. 지운 것만 목록에서 뺀다.
      const deletedIds: string[] = []
      const hiddenIds: string[] = []
      const failedIds: string[] = []
      results.forEach((settled, index) => {
        if (settled.status === 'rejected') {
          failedIds.push(targetItems[index].id)
        } else if (settled.value.result === 'hidden') {
          hiddenIds.push(settled.value.item.id)
        } else {
          deletedIds.push(settled.value.item.id)
        }
      })

      setItems((current) => current.filter((item) => !deletedIds.includes(item.id)))
      setHiddenItemIds((current) => current.filter((itemId) => !deletedIds.includes(itemId)))
      setSelectedItemIds(failedIds)
      setBulkDeleteTargetIds(null)

      if (form.id && deletedIds.includes(form.id)) {
        resetForm(categoryItemId)
      }

      await refreshItems()

      if (deletedIds.length > 0 || hiddenIds.length > 0) {
        toast.success(hiddenIds.length > 0
          ? `삭제 ${deletedIds.length}개 / 이력이 있어 숨김 처리 ${hiddenIds.length}개`
          : `선택한 상품 ${deletedIds.length}개를 완전 삭제했습니다.`)
      }
      if (failedIds.length > 0) {
        toast.error(`선택한 상품 ${failedIds.length}개 완전 삭제에 실패했습니다.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '선택한 상품 완전 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsBulkActionRunning(false)
    }
  }

  return {
    handleDeleteFromList, handleVisibilityFromList, handleBulkVisibility, handleBulkImageAssign, handleBulkDelete,
  }
}

export type ProductListActionsApi = ReturnType<typeof useProductListActions>

export function ProductList({ ctx }: { ctx: ProductAdminContext }) {
  const {
    mode, workspaceSubject, canDeleteProducts, filterCategoryId, titleQuery, statusTab, sortKey, form, hidingItemId,
    hiddenItemIds, setDeleteTarget, selectedItemIds, setSelectedItemIds, setBulkDeleteTargetIds, isBulkActionRunning,
    categoryNodes, setIsBulkImagePickerOpen, setBulkImageTarget, productListHeaderRef, titleTerms, statusCounts,
    filteredItems, selectedItems, listPagination, pagedItems, allFilteredSelected, someFilteredSelected,
    formatCategoryPath, toggleItemSelection, toggleFilteredSelection, changeListPage, changeListPageSize,
    changeFilterCategory, changeTitleQuery, changeStatusTab, changeSortKey, resetListFilters, loadItemDetail,
    handleVisibilityFromList, handleBulkVisibility, duplicatingItemId, setDuplicateTarget,
  } = ctx

  // 20번 6단계: 표 부품(AdminDataTable). 열·버튼·숨김 조건은 전과 같다. 수정 중인 상품은 줄 색 대신 '편집 중' 배지(표 부품에 줄 색 없음).
  const columns: AdminDataTableColumn<MarketItemForAdmin>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          aria-label="현재 페이지 상품 전체 선택"
          checked={allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false}
          disabled={filteredItems.length === 0 || isBulkActionRunning}
          onCheckedChange={() => toggleFilteredSelection()}
        />
      ),
      align: 'center',
      className: 'w-[52px]',
      headerClassName: 'w-[52px]',
      cell: (item) => (
        <Checkbox
          aria-label={`${item.title} 선택`}
          checked={selectedItemIds.includes(item.id)}
          disabled={isBulkActionRunning}
          onCheckedChange={() => toggleItemSelection(item.id)}
        />
      ),
    },
    {
      key: 'product',
      header: '상품',
      className: 'py-2',
      cell: (item) => {
        const listImageUrl = item.thumbnailImage?.publicUrl ?? item.categoryDefaultImage?.publicUrl ?? null
        const summary = item.listSummary
        const warnings = summary
          ? [
            summary.subproductCount === 0 ? '서브상품 없음' : null,
            summary.emptySubproductCount > 0 ? `파일 없는 서브상품 ${summary.emptySubproductCount}개` : null,
          ].filter((warning): warning is string => Boolean(warning))
          : []
        return (
          <div className="flex items-start gap-3">
            <div className="h-12 w-9 shrink-0 overflow-hidden rounded border bg-slate-50">
              {listImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- market-images 공개 버킷 URL을 그대로 보여 준다.
                <img src={listImageUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className="text-left font-medium text-gray-900 hover:underline" onClick={() => void loadItemDetail(item.id)}>
                  {item.title}
                </button>
                {form.id === item.id ? <AdminStatusBadge label="편집 중" tone="info" /> : null}
              </div>
              <p className="text-xs text-gray-500">{formatCategoryPath(getItemCategoryItemId(item))}</p>
              {warnings.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {warnings.map((warning) => (
                    <span key={warning} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--admin-tone-warning-text)]">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {warning}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )
      },
    },
    {
      key: 'sales',
      header: '판매 구성',
      cell: (item) => {
        const summary = item.listSummary
        return summary && summary.subproductCount > 0 ? (
          <div className="space-y-0.5 tabular-nums">
            <p className="text-gray-900">서브상품 {summary.subproductCount} · 파일 {summary.fileCount}</p>
            <p className="text-xs text-gray-500">
              {summary.minPriceCredits !== null ? `${formatCredits(summary.minPriceCredits)}~` : ''}
              {summary.bundlePriceCredits !== null ? ` · 전체 ${formatCredits(summary.bundlePriceCredits)}` : ''}
              {summary.samplePageCount > 0 ? ` · 샘플 ${summary.samplePageCount}장` : ' · 샘플 없음'}
            </p>
          </div>
        ) : (
          <span className="text-xs text-gray-400">{ADMIN_EMPTY_TEXT}</span>
        )
      },
    },
    {
      key: 'status',
      header: '상태',
      align: 'center',
      cell: (item) => {
        const status = item.status as MarketItemFormState['status']
        // 파일을 올리다 등록을 마치지 않아 자동으로 남은 임시 상품
        const isAbandonedUpload = status === 'draft' && item.draft_source === 'auto_upload'
        return (
          <>
            <AdminStatusBadge label={MARKET_STATUS_LABELS[status] ?? item.status} tone={adminStatusTone('marketItem', status)} />
            {isAbandonedUpload ? <p className="mt-1 text-[11px] text-gray-500">업로드 중단</p> : null}
          </>
        )
      },
    },
    {
      key: 'date',
      header: sortKey === 'updated' ? '수정일' : '등록일',
      align: 'center',
      className: 'whitespace-nowrap text-gray-600',
      cell: (item) => ADMIN_LIST_DATE_FORMATTER.format(new Date(sortKey === 'updated' ? item.updated_at : item.created_at)),
    },
    {
      key: 'actions',
      header: '관리',
      align: 'right',
      cell: (item) => {
        const isHidden = item.status === 'hidden' || hiddenItemIds.includes(item.id)
        const status = item.status as MarketItemFormState['status']
        return (
          <div className="flex items-center justify-end gap-1">
            <Button type="button" variant="adminTable" size="sm" onClick={() => void loadItemDetail(item.id)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              수정
            </Button>
            {/* 18번: [복제] — 임시저장 사본(판매 파일·샘플·이용 근거는 복사하지 않음)을 만들고 그 편집으로 간다 */}
            <Button type="button" variant="adminTable" size="sm" aria-label={`${item.title} 복제`} disabled={duplicatingItemId === item.id} onClick={() => setDuplicateTarget(item)}>
              {duplicatingItemId === item.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
              복제
            </Button>
            {/* 메뉴 항목이 하나도 없으면(삭제 권한 없음 + 공개·숨김이 아닌 상품) 더보기 버튼을 그리지 않는다 */}
            {status === 'published' || isHidden || canDeleteProducts ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="brandGhost" size="icon" aria-label={`${item.title} 더보기`} disabled={hidingItemId === item.id}>
                    {hidingItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {status === 'published' ? (
                    <DropdownMenuItem asChild>
                      <a href={`/items/${item.id}?subject=${workspaceSubject}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        상세 페이지 보기
                      </a>
                    </DropdownMenuItem>
                  ) : null}
                  {/* 숨김 전환은 공개·숨김 상품만(임시저장을 바로 공개하면 공개 전 점검을 건너뛴다) */}
                  {status === 'published' || isHidden ? (
                    <DropdownMenuItem
                      aria-label={isHidden ? `${item.title} 숨김 해제` : `${item.title} 숨김 처리`}
                      onSelect={() => void handleVisibilityFromList(item)}
                    >
                      {isHidden ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                      {isHidden ? '다시 공개' : '숨기기'}
                    </DropdownMenuItem>
                  ) : null}
                  {canDeleteProducts ? (
                    <>
                      {status === 'published' || isHidden ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem className="text-[var(--admin-tone-danger-text)] focus:text-[var(--admin-tone-danger-text)]" onSelect={() => setDeleteTarget(item)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        삭제
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )
      },
    },
  ]

  return (
    <>
        {mode === 'manage' ? (
        <Card>
          <CardHeader>
            <div ref={productListHeaderRef} className="space-y-3">
              <CardTitle>상품 목록</CardTitle>
              {/* 목록 검색: 카테고리(고른 칸과 하위 칸) + 제목 + 정렬. 상품에 저장되는 값이 아니다. */}
              {/* 20번 6단계: 필터 줄 부품. 이 목록의 필터는 지금처럼 화면 상태에만 두고 주소에 남기지 않는다(쪽·표시 개수만 주소). */}
              <AdminFilterBar
                className="mb-0 items-end"
                search={(
                  <div className="space-y-1">
                    <Label htmlFor="market-product-title-search" className="text-xs text-gray-500">제목 검색</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                      <Input
                        id="market-product-title-search"
                        type="search"
                        value={titleQuery}
                        onChange={(event) => changeTitleQuery(event.target.value)}
                        placeholder="제목에 든 단어 (띄어쓰기로 여러 단어)"
                        className="pl-9"
                      />
                    </div>
                  </div>
                )}
                filters={(
                  <>
                    <div className="w-full min-w-0 space-y-1 sm:w-64">
                      <Label className="text-xs text-gray-500">카테고리</Label>
                      <CategoryStepSelect
                        nodes={categoryNodes}
                        value={filterCategoryId}
                        onChange={changeFilterCategory}
                        emptyLabel="전체"
                        ariaLabel="상품 목록 카테고리"
                      />
                    </div>
                    <div className="w-[180px] space-y-1">
                      <Label htmlFor="market-product-sort" className="text-xs text-gray-500">정렬</Label>
                      <select
                        id="market-product-sort"
                        value={sortKey}
                        onChange={(event) => changeSortKey(event.target.value as MarketListSortKey)}
                        className="flex h-10 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-white px-3 text-sm"
                      >
                        <option value="created">최신 등록순</option>
                        <option value="updated">최근 수정순</option>
                        <option value="title">제목순</option>
                      </select>
                    </div>
                  </>
                )}
                resultCount={filteredItems.length}
                onReset={resetListFilters}
                resetDisabled={!filterCategoryId && !titleQuery}
              />
              <div className="flex flex-col gap-2 border-b border-[var(--studio-border)] md:flex-row md:items-end md:justify-between">
                <div role="tablist" aria-label="상품 상태" className="flex flex-wrap gap-1">
                  {MARKET_LIST_STATUS_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={statusTab === tab}
                      onClick={() => changeStatusTab(tab)}
                      className={`-mb-px min-h-11 border-b-2 px-3 py-2 text-sm transition md:min-h-0 ${
                        statusTab === tab ? 'border-[var(--studio-primary)] font-semibold text-[var(--studio-primary)]' : 'border-transparent text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {tab === 'all' ? '전체' : MARKET_STATUS_LABELS[tab]}
                      <span className="ml-1 text-xs tabular-nums text-gray-400">{formatCount(statusCounts[tab])}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* 일괄 작업은 상품을 고른 동안에만 보인다. */}
            {selectedItems.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)] px-3 py-2">
                <span className="mr-auto text-sm font-medium text-gray-900">선택 {selectedItems.length}개</span>
                <Button
                  type="button"
                  variant="brandOutline"
                  size="sm"
                  disabled={isBulkActionRunning}
                  onClick={() => void handleBulkVisibility()}
                >
                  {isBulkActionRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <EyeOff className="mr-2 h-4 w-4" />}
                  선택 숨김
                </Button>
                <Button
                  type="button"
                  variant="brandOutline"
                  size="sm"
                  disabled={isBulkActionRunning}
                  onClick={() => setIsBulkImagePickerOpen(true)}
                >
                  <Images className="mr-2 h-4 w-4" />
                  이미지 일괄 지정
                </Button>
                <Button
                  type="button"
                  variant="brandOutline"
                  size="sm"
                  disabled={isBulkActionRunning}
                  onClick={() => setBulkImageTarget({ itemIds: selectedItems.map((item) => item.id), image: null })}
                >
                  이미지 일괄 해제
                </Button>
                {canDeleteProducts ? (
                  <Button
                    type="button"
                    variant="brandOutline"
                    size="sm"
                    className="text-[var(--admin-tone-danger-text)]"
                    disabled={isBulkActionRunning}
                    onClick={() => setBulkDeleteTargetIds(selectedItems.map((item) => item.id))}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    선택 삭제
                  </Button>
                ) : null}
                <Button type="button" variant="brandGhost" size="sm" disabled={isBulkActionRunning} onClick={() => setSelectedItemIds([])}>
                  선택 해제
                </Button>
              </div>
            ) : null}
            <AdminDataTable
              caption="상품 목록"
              columns={columns}
              rows={pagedItems}
              getRowKey={(item) => item.id}
              minWidth={860}
              // 수정 폼이 옆에 열리면 목록 칸이 좁아 넓은 화면에서도 표 안에서 옆으로 민다.
              className={form.id ? 'xl:overflow-auto' : undefined}
              state={filteredItems.length === 0 ? (
                <AdminTableState
                  kind="empty"
                  message={titleTerms.length > 0 || filterCategoryId || statusTab !== 'all' ? '검색 조건에 맞는 상품이 없습니다.' : '등록된 상품이 없습니다.'}
                />
              ) : undefined}
            />
            <StudioListPagination
              page={listPagination.page}
              pageSize={listPagination.pageSize}
              totalCount={filteredItems.length}
              onPageChange={changeListPage}
              onPageSizeChange={changeListPageSize}
            />
          </CardContent>
        </Card>
        ) : null}
    </>
  )
}

export function ProductListDialogs({ ctx }: { ctx: ProductAdminContext }) {
  const {
    isArchiving, deleteTarget, setDeleteTarget, bulkDeleteTargetIds, setBulkDeleteTargetIds, isBulkActionRunning,
    isBulkImagePickerOpen, setIsBulkImagePickerOpen, bulkImageTarget, setBulkImageTarget, selectedItems,
    bulkDeleteTargetItems, handleDeleteFromList, handleBulkImageAssign, handleBulkDelete, duplicateTarget, setDuplicateTarget,
    duplicatingItemId, handleConfirmDuplicate,
  } = ctx

  return (
    <>
      {/* 18번: 목록 [복제] 확인 — 임시저장 사본을 만들고 그 편집으로 간다 */}
      {/* 20번 6단계: 네 확인 창은 공통 확인 창(유형 가). 처리 중에는 창이 닫히지 않고 버튼이 잠긴다. 문구는 전 창 그대로. */}
      <AdminConfirmDialog
        open={!!duplicateTarget}
        onOpenChange={(open) => !open && !duplicatingItemId && setDuplicateTarget(null)}
        title={`[${duplicateTarget?.title ?? ''}] 상품을 복제할까요?`}
        description="임시저장 사본을 만듭니다. 판매 파일·샘플·이용 근거는 복사하지 않습니다."
        confirmLabel="복제"
        pending={Boolean(duplicatingItemId)}
        onConfirm={() => void handleConfirmDuplicate()}
      />

      <AdminConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !isArchiving && setDeleteTarget(null)}
        title="문제마켓 상품을 완전 삭제할까요?"
        description={<>
          <span className="font-medium">[{deleteTarget?.title}]</span> 상품의 DB 데이터와 업로드된 파일이 모두 삭제되며 되돌릴 수 없습니다.
          <span className="mt-2 block">구매·환불·후기 이력이 있는 상품은 삭제되지 않고 숨김 처리됩니다(구매자 다운로드는 유지).</span>
        </>}
        confirmLabel="완전 삭제"
        danger
        pending={isArchiving}
        onConfirm={() => void handleDeleteFromList()}
      />

      <MarketImagePicker
        open={isBulkImagePickerOpen}
        onOpenChange={setIsBulkImagePickerOpen}
        title="선택한 상품에 지정할 이미지 선택"
        onSelect={(image) => setBulkImageTarget({
          itemIds: selectedItems.map((item) => item.id),
          image: { id: image.id, publicUrl: image.publicUrl },
        })}
      />

      <AdminConfirmDialog
        open={!!bulkImageTarget}
        onOpenChange={(open) => !open && !isBulkActionRunning && setBulkImageTarget(null)}
        title={bulkImageTarget?.image
          ? `선택한 상품 ${bulkImageTarget.itemIds.length}개에 이 이미지를 지정할까요?`
          : `선택한 상품 ${bulkImageTarget?.itemIds.length ?? 0}개의 상품 이미지를 해제할까요?`}
        description={<>
          {bulkImageTarget?.image
            ? '기존 상품 이미지는 이 이미지로 바뀝니다.'
            : '해제한 상품은 카테고리 항목 기본 이미지가 있으면 그 이미지로, 없으면 빈 이미지로 표시됩니다.'}
          {bulkImageTarget?.image ? (
            <span className="mt-3 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- market-images 공개 버킷 URL을 그대로 보여 준다. */}
              <img src={bulkImageTarget.image.publicUrl} alt="지정할 이미지 미리보기" className="size-32 rounded-md border object-contain" />
            </span>
          ) : null}
        </>}
        confirmLabel={bulkImageTarget?.image ? '지정' : '해제'}
        pending={isBulkActionRunning}
        onConfirm={() => void handleBulkImageAssign()}
      />

      <AdminConfirmDialog
        open={!!bulkDeleteTargetIds}
        onOpenChange={(open) => !open && !isBulkActionRunning && setBulkDeleteTargetIds(null)}
        title={`선택한 문제마켓 상품 ${bulkDeleteTargetIds?.length ?? 0}개를 완전 삭제할까요?`}
        description={<>
          DB 데이터와 업로드된 파일이 모두 삭제되며 되돌릴 수 없습니다.
          <span className="mt-2 block">구매·환불·후기 이력이 있는 상품은 삭제되지 않고 숨김 처리됩니다(구매자 다운로드는 유지).</span>
          {bulkDeleteTargetItems.length > 0 ? (
            <span className="mt-2 block text-gray-700">
              {bulkDeleteTargetItems.slice(0, 3).map((item) => item.title).join(', ')}
              {bulkDeleteTargetItems.length > 3 ? ` 외 ${bulkDeleteTargetItems.length - 3}개` : ''}
            </span>
          ) : null}
        </>}
        confirmLabel="완전 삭제"
        danger
        pending={isBulkActionRunning}
        onConfirm={() => void handleBulkDelete()}
      />
    </>
  )
}
