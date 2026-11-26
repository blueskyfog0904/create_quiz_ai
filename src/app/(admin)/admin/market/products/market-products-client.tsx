'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { MarketItem, MarketItemBundleOption, MarketItemForAdmin, MarketItemSubproduct, MarketSubproductFile } from '@/lib/market-items-server'
import type { MarketItemOption, MarketItemProductOptionKind } from '@/lib/market-item-options'
import AdminMarketSamplePreviewDialog from './admin-market-sample-preview-dialog'
import type { MarketImageFieldValue } from '@/components/admin/market-image-field'
import type { AdminCategoryTreeNode } from '@/components/admin/market-category-tree-editor'
import { findCategoryPath } from '@/lib/market-category-tree'
import { useListQuery } from '@/hooks/use-list-query'
import { getListPagination } from '@/lib/list-pagination'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { categoryNodeLabel } from './_editor/category-step'
import { AfterSaveDialog, RegisteredItemsTable } from './_editor/after-save-dialog'
import { ProductEditor } from './_editor/product-editor'
import { useProductForm, type ProductFormApi } from './_hooks/use-product-form'
import { useSampleGeneration, type SampleGenerationApi } from './_hooks/use-sample-generation'
import { useSubproductUploads, type SubproductUploadsApi } from './_hooks/use-subproduct-uploads'
import { useProductDuplicate, type ProductDuplicateApi } from './_hooks/use-product-duplicate'
import {
  buildEmptyForm,
  buildEmptyBundleForm,
  buildEmptyCategorySettingsForm,
  buildEmptyFileTypeSettingsForm,
  type MarketListStatusTab,
  type MarketListSortKey,
} from './_lib/product-form'
import type {
  SubproductEditState,
  BundleFormState,
  CategorySettingsFormState,
  FileTypeSettingsFormState,
  MarketItemFormState,
  AdminSamplePage,
  SampleGenerationStep,
} from './_lib/types'
import { useProductListActions, type ProductListActionsApi, ProductList, ProductListDialogs } from './_list/product-list'
import { CategoryManagerDialog } from './_settings/category-manager-dialog'
import { FileTypeSettingsDialog } from './_settings/file-type-settings-dialog'
import { SubproductCategorySettingsDialog } from './_settings/subproduct-category-settings-dialog'

interface MarketProductsClientProps {
  // create: '문제마켓 상품 등록'(폼만), manage: '문제마켓 상품 관리'(목록·필터, 수정할 때만 폼)
  mode: 'create' | 'manage'
  initialCategoryNodes: AdminCategoryTreeNode[]
  initialItems: MarketItemForAdmin[]
  workspaceSubject: WorkspaceSubject
  // 상품 완전 삭제(products.delete). 없으면 삭제 메뉴·버튼을 그리지 않는다(삭제 API도 같은 권한을 요구한다).
  canDeleteProducts: boolean
  // 17번: 학년·자료유형 선택 목록(과목별 DB 목록, 숨김 포함 — 상품 값이 숨긴 항목이면 '(숨김)'으로 함께 보인다)
  attributeOptions: Record<MarketItemProductOptionKind, MarketItemOption[]>
  // 18번: 등록 화면 주소의 ?categoryId=(관리 화면 저장 뒤 창 [빈 새 상품]이 카테고리를 넘김). 트리에 있는 칸만 page 가 넘긴다.
  initialCategoryItemId?: string
}

// 18번 1단계: 화면 상태(useState·useRef)와 목록 상태·처리 함수. 편집 훅·부품은 이 값을 ctx 로 받는다.
function useMarketProductsState({ mode, initialCategoryNodes, initialItems, workspaceSubject, canDeleteProducts, attributeOptions, initialCategoryItemId }: MarketProductsClientProps) {
  const router = useRouter()
  // 상품 목록 상단 필터(가장 깊이 고른 칸, '' = 전체). 서버가 하위 칸까지 포함해 거른다.
  const [filterCategoryId, setFilterCategoryId] = useState('')
  // 상품 목록 제목 검색어: 받아 온 목록에서 띄어쓰기로 나눈 단어가 모두 제목에 든 상품만 남긴다.
  const [titleQuery, setTitleQuery] = useState('')
  const [statusTab, setStatusTab] = useState<MarketListStatusTab>('all')
  const [sortKey, setSortKey] = useState<MarketListSortKey>('created')
  const [items, setItems] = useState(initialItems)
  const [form, setForm] = useState<MarketItemFormState>(buildEmptyForm())
  const [isSaving, setIsSaving] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [hidingItemId, setHidingItemId] = useState<string | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState(() => initialItems
    .filter((item) => item.status === 'hidden')
    .map((item) => item.id))
  const [requiresFinalRegistration, setRequiresFinalRegistration] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MarketItem | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [bulkDeleteTargetIds, setBulkDeleteTargetIds] = useState<string[] | null>(null)
  const [isBulkActionRunning, setIsBulkActionRunning] = useState(false)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePages, setSamplePages] = useState<AdminSamplePage[]>([])
  const [samplePageSelection, setSamplePageSelection] = useState('1,2,3')
  const [selectedSampleSourceFile, setSelectedSampleSourceFile] = useState<File | null>(null)
  const [sampleDraftToken, setSampleDraftToken] = useState<string | null>(null)
  const [isSampleSourceDragActive, setIsSampleSourceDragActive] = useState(false)
  const [samplePageDragId, setSamplePageDragId] = useState<string | null>(null)
  const [isSampleSourceUploading, setIsSampleSourceUploading] = useState(false)
  const [sampleGenerationStep, setSampleGenerationStep] = useState<SampleGenerationStep>('idle')
  const [deletingSamplePageId, setDeletingSamplePageId] = useState<string | null>(null)
  const [subproducts, setSubproducts] = useState<MarketItemSubproduct[]>([])
  const [subproductFiles, setSubproductFiles] = useState<MarketSubproductFile[]>([])
  const [bundleOption, setBundleOption] = useState<MarketItemBundleOption | null>(null)
  // 즉시 저장(서브상품·파일) 뒤 서버 값을 다시 읽을 때, 저장 전인 전체구매 입력을 지키려고 마지막 서버 값을 따로 둔다.
  const bundleOptionRef = useRef<MarketItemBundleOption | null>(null)
  // 서브상품이 하나라도 있으면 추가 폼은 [서브상품 추가]를 눌렀을 때만 연다.
  const [isSubproductFormOpen, setIsSubproductFormOpen] = useState(false)
  const [editingSubproductId, setEditingSubproductId] = useState<string | null>(null)
  const [subproductEditDraft, setSubproductEditDraft] = useState<SubproductEditState | null>(null)
  const [bundleForm, setBundleForm] = useState<BundleFormState>(buildEmptyBundleForm())
  const [isCategorySettingsOpen, setIsCategorySettingsOpen] = useState(false)
  const [categorySettingsForm, setCategorySettingsForm] = useState<CategorySettingsFormState>(buildEmptyCategorySettingsForm())
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [isCategorySettingsSaving, setIsCategorySettingsSaving] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [isFileTypeSettingsOpen, setIsFileTypeSettingsOpen] = useState(false)
  const [fileTypeSettingsForm, setFileTypeSettingsForm] = useState<FileTypeSettingsFormState>(buildEmptyFileTypeSettingsForm())
  const [editingFileTypeId, setEditingFileTypeId] = useState<string | null>(null)
  const [isFileTypeSettingsSaving, setIsFileTypeSettingsSaving] = useState(false)
  const [deletingFileTypeId, setDeletingFileTypeId] = useState<string | null>(null)
  const [isSubproductSaving, setIsSubproductSaving] = useState(false)
  const [subproductUploadingKeys, setSubproductUploadingKeys] = useState<string[]>([])
  const [subproductDragActiveKeys, setSubproductDragActiveKeys] = useState<string[]>([])
  const [categoryNodes, setCategoryNodes] = useState<AdminCategoryTreeNode[]>(initialCategoryNodes)
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false)
  const [categoryItemId, setCategoryItemId] = useState(initialCategoryItemId ?? '')
  const [savedCategoryItemId, setSavedCategoryItemId] = useState('')
  // 폼의 thumbnailImageId에 해당하는 미리보기(상세 조회·이미지 선택 시 갱신)
  const [thumbnailPreview, setThumbnailPreview] = useState<MarketImageFieldValue | null>(null)
  const [isBulkImagePickerOpen, setIsBulkImagePickerOpen] = useState(false)
  // 일괄 지정 확인 대상. image null = 상품 이미지 해제
  const [bulkImageTarget, setBulkImageTarget] = useState<{ itemIds: string[]; image: MarketImageFieldValue | null } | null>(null)
  const sampleSourceInputRef = useRef<HTMLInputElement | null>(null)
  const productListHeaderRef = useRef<HTMLDivElement | null>(null)
  // 필터를 빠르게 바꿀 때 늦게 온 이전 목록 응답을 버린다.
  const itemsRequestRef = useRef(0)
  // 목록은 서버가 상단 카테고리 필터(하위 칸 포함)로 거른 결과에 제목 검색을 더한 것이다.
  const titleTerms = useMemo(() => titleQuery.toLowerCase().split(/\s+/).filter(Boolean), [titleQuery])
  const titleMatchedItems = useMemo(
    () => (titleTerms.length === 0 ? items : items.filter((item) => {
      const title = item.title.toLowerCase()
      return titleTerms.every((term) => title.includes(term))
    })),
    [items, titleTerms]
  )
  // 상태 탭 개수는 카테고리·제목 조건까지 반영한 값이다.
  const statusCounts = useMemo(() => {
    const counts: Record<MarketListStatusTab, number> = { all: titleMatchedItems.length, published: 0, draft: 0, hidden: 0, archived: 0 }
    titleMatchedItems.forEach((item) => {
      const status = item.status as MarketItemFormState['status']
      if (status in counts) counts[status] += 1
    })
    return counts
  }, [titleMatchedItems])
  // 서버 목록은 최신 등록순이다. 다른 정렬만 여기서 다시 줄 세운다.
  const filteredItems = useMemo(() => {
    const byStatus = statusTab === 'all' ? titleMatchedItems : titleMatchedItems.filter((item) => item.status === statusTab)
    if (sortKey === 'updated') return [...byStatus].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    if (sortKey === 'title') return [...byStatus].sort((a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true }))
    return byStatus
  }, [sortKey, statusTab, titleMatchedItems])

  const selectedItems = useMemo(() => filteredItems.filter((item) => selectedItemIds.includes(item.id)), [filteredItems, selectedItemIds])
  // 목록은 이미 받은 상품을 클라이언트에서 페이지로 나눈다. 페이지·표시 개수는 URL 쿼리에만 기록하고 화면은 이동하지 않는다.
  // 범위를 벗어난 page(삭제·새로고침으로 페이지 수가 줄어든 경우)는 getListPagination이 마지막 페이지로 보정한다.
  const listQuery = useListQuery()
  const listPagination = getListPagination(filteredItems.length, listQuery.page, listQuery.pageSize)
  const pagedItems = useMemo(
    () => filteredItems.slice(listPagination.offset, listPagination.offset + listPagination.pageSize),
    [filteredItems, listPagination.offset, listPagination.pageSize]
  )
  // 머리글 체크박스는 현재 페이지 상품만 다룬다. 다른 페이지의 선택은 유지되고 일괄 작업은 selectedItems 전체에 적용된다.
  const allFilteredSelected = pagedItems.length > 0 && pagedItems.every((item) => selectedItemIds.includes(item.id))
  const someFilteredSelected = pagedItems.some((item) => selectedItemIds.includes(item.id)) && !allFilteredSelected
  const bulkDeleteTargetItems = useMemo(
    () => items.filter((item) => (bulkDeleteTargetIds ?? []).includes(item.id)),
    [bulkDeleteTargetIds, items]
  )
  const formatCategoryPath = (categoryId: string) => {
    const path = categoryId ? findCategoryPath(categoryNodes, categoryId) : null
    return path ? path.map(categoryNodeLabel).join(' > ') : '미지정'
  }

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds((current) => current.includes(itemId)
      ? current.filter((currentItemId) => currentItemId !== itemId)
      : [...current, itemId])
  }

  const toggleFilteredSelection = () => {
    const filteredIds = pagedItems.map((item) => item.id)
    if (filteredIds.length === 0) {
      return
    }

    setSelectedItemIds((current) => {
      const shouldClearFilteredItems = filteredIds.every((itemId) => current.includes(itemId))
      if (shouldClearFilteredItems) {
        return current.filter((itemId) => !filteredIds.includes(itemId))
      }

      return Array.from(new Set([...current, ...filteredIds]))
    })
  }

  // 페이지·표시 개수를 바꿀 때만 목록 머리글로 스크롤한다(첫 로드에는 스크롤하지 않는다).
  const changeListPage = (page: number) => {
    listQuery.setPage(page)
    productListHeaderRef.current?.scrollIntoView({ block: 'start' })
  }

  const changeListPageSize = (size: number) => {
    listQuery.setPageSize(size)
    productListHeaderRef.current?.scrollIntoView({ block: 'start' })
  }

  const setHiddenOverride = (itemId: string, isHidden: boolean) => {
    setHiddenItemIds((current) => {
      if (isHidden) {
        return current.includes(itemId) ? current : [...current, itemId]
      }

      return current.filter((currentItemId) => currentItemId !== itemId)
    })
  }

  const buildItemPatchBody = (item: MarketItem, nextStatus: MarketItemFormState['status']) => ({
    title: item.title,
    summary: item.summary || '',
    description: item.description || '',
    examYear: item.exam_year,
    examMonth: item.exam_month,
    gradeLevel: item.grade_level || '',
    sourceType: item.source_type || '',
    source1: item.source_1 || '',
    source2: item.source_2 || '',
    source3: item.source_3 || '',
    source4: item.source_4 || '',
    questionCount: item.question_count,
    pdfPrice: item.pdf_price,
    hwpPrice: item.hwp_price,
    zipPrice: item.zip_price,
    status: nextStatus,
    draftSource: 'manual',
    isActive: item.is_active,
  })

  // 상단 필터 기준으로 목록을 다시 읽는다(칸을 고르면 그 칸과 하위 칸 전체의 상품).
  const refreshItems = async (categoryId = filterCategoryId) => {
    const requestId = ++itemsRequestRef.current
    const url = categoryId ? `/api/admin/market/items?categoryId=${categoryId}` : '/api/admin/market/items'
    const response = await fetch(withAdminWorkspaceSubject(url, workspaceSubject), { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 목록을 불러오지 못했습니다.')
    }

    if (requestId === itemsRequestRef.current) {
      setItems(payload.data)
    }
  }

  // 상단 필터 변경: 목록만 바꾸고 편집 중인 폼(카테고리 포함)은 건드리지 않는다.
  const changeFilterCategory = (nextCategoryId: string) => {
    setFilterCategoryId(nextCategoryId)
    setSelectedItemIds([])
    listQuery.update({ page: 1 }, true)
    void refreshItems(nextCategoryId).catch((error) => toast.error(error instanceof Error ? error.message : '문제마켓 상품 목록을 불러오지 못했습니다.'))
  }

  const changeTitleQuery = (nextQuery: string) => {
    setTitleQuery(nextQuery)
    listQuery.update({ page: 1 }, true)
  }

  const changeStatusTab = (nextTab: MarketListStatusTab) => {
    setStatusTab(nextTab)
    listQuery.update({ page: 1 }, true)
  }

  const changeSortKey = (nextSortKey: MarketListSortKey) => {
    setSortKey(nextSortKey)
    listQuery.update({ page: 1 }, true)
  }

  const resetListFilters = () => {
    changeTitleQuery('')
    if (filterCategoryId) changeFilterCategory('')
  }

  return {
    mode, workspaceSubject, canDeleteProducts, attributeOptions, router, filterCategoryId, setFilterCategoryId,
    titleQuery, setTitleQuery, statusTab, setStatusTab, sortKey, setSortKey, items, setItems, form, setForm,
    isSaving, setIsSaving, isArchiving, setIsArchiving, hidingItemId, setHidingItemId, hiddenItemIds,
    setHiddenItemIds, requiresFinalRegistration, setRequiresFinalRegistration, deleteTarget, setDeleteTarget,
    selectedItemIds, setSelectedItemIds, bulkDeleteTargetIds, setBulkDeleteTargetIds, isBulkActionRunning,
    setIsBulkActionRunning, isSamplePreviewOpen, setIsSamplePreviewOpen, samplePreviewItemId, setSamplePreviewItemId,
    samplePages, setSamplePages, samplePageSelection, setSamplePageSelection, selectedSampleSourceFile,
    setSelectedSampleSourceFile, sampleDraftToken, setSampleDraftToken, isSampleSourceDragActive,
    setIsSampleSourceDragActive, samplePageDragId, setSamplePageDragId, isSampleSourceUploading,
    setIsSampleSourceUploading, sampleGenerationStep, setSampleGenerationStep, deletingSamplePageId,
    setDeletingSamplePageId, subproducts, setSubproducts, subproductFiles, setSubproductFiles, bundleOption,
    setBundleOption, bundleOptionRef, isSubproductFormOpen, setIsSubproductFormOpen, editingSubproductId,
    setEditingSubproductId, subproductEditDraft, setSubproductEditDraft, bundleForm, setBundleForm,
    isCategorySettingsOpen, setIsCategorySettingsOpen, categorySettingsForm, setCategorySettingsForm,
    editingCategoryId, setEditingCategoryId, isCategorySettingsSaving, setIsCategorySettingsSaving,
    deletingCategoryId, setDeletingCategoryId, isFileTypeSettingsOpen, setIsFileTypeSettingsOpen,
    fileTypeSettingsForm, setFileTypeSettingsForm, editingFileTypeId, setEditingFileTypeId, isFileTypeSettingsSaving,
    setIsFileTypeSettingsSaving, deletingFileTypeId, setDeletingFileTypeId, isSubproductSaving,
    setIsSubproductSaving, subproductUploadingKeys, setSubproductUploadingKeys, subproductDragActiveKeys,
    setSubproductDragActiveKeys, categoryNodes, setCategoryNodes, isCategoryManagerOpen, setIsCategoryManagerOpen,
    categoryItemId, setCategoryItemId, savedCategoryItemId, setSavedCategoryItemId, thumbnailPreview,
    setThumbnailPreview, isBulkImagePickerOpen, setIsBulkImagePickerOpen, bulkImageTarget, setBulkImageTarget,
    sampleSourceInputRef, productListHeaderRef, itemsRequestRef, titleTerms, titleMatchedItems, statusCounts,
    filteredItems, selectedItems, listQuery, listPagination, pagedItems, allFilteredSelected, someFilteredSelected,
    bulkDeleteTargetItems, formatCategoryPath, toggleItemSelection, toggleFilteredSelection, changeListPage,
    changeListPageSize, setHiddenOverride, buildItemPatchBody, refreshItems, changeFilterCategory, changeTitleQuery,
    changeStatusTab, changeSortKey, resetListFilters,
  }
}

export type MarketProductsState = ReturnType<typeof useMarketProductsState>
export type ProductAdminContext = MarketProductsState & ProductFormApi & SampleGenerationApi & SubproductUploadsApi & ProductListActionsApi
  & ProductDuplicateApi

export default function MarketProductsClient(props: MarketProductsClientProps) {
  const state = useMarketProductsState(props)
  const productForm = useProductForm(state)
  const sampleGeneration = useSampleGeneration({ ...state, ...productForm })
  const subproductUploads = useSubproductUploads({ ...state, ...productForm })
  const listActions = useProductListActions({ ...state, ...productForm })
  const productDuplicate = useProductDuplicate({ ...state, ...productForm })
  const ctx: ProductAdminContext = { ...state, ...productForm, ...sampleGeneration, ...subproductUploads, ...listActions, ...productDuplicate }
  const {
    mode, workspaceSubject, form, isSamplePreviewOpen, setIsSamplePreviewOpen, samplePreviewItemId,
    setSamplePreviewItemId, sampleDraftToken, resetForm,
  } = ctx

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {mode === 'create'
              ? <AdminMenuName href="/admin/market/products/new" fallback="문제마켓 상품 등록" />
              : <AdminMenuName href="/admin/market/products" fallback="문제마켓 상품 관리" />} · {workspaceSubject === 'english' ? '영어' : '국어'}
          </h1>
          <p className="mt-1 text-gray-500">
            {mode === 'create'
              ? '선택한 과목의 문제마켓 상품을 새로 등록하고 판매 파일을 올립니다.'
              : '선택한 과목의 문제마켓 상품을 찾아 수정하거나 삭제합니다.'}
          </p>
        </div>
        {mode === 'create' ? (
          <Button
            type="button"
            variant="adminAction"
            onClick={() => resetForm()}
          >
            <Plus className="mr-2 h-4 w-4" />
            새 상품 작성
          </Button>
        ) : (
          <Button asChild variant="adminAction">
            <Link href={withAdminWorkspaceSubject('/admin/market/products/new', workspaceSubject)}>
              <Plus className="mr-2 h-4 w-4" />
              새 상품 등록
            </Link>
          </Button>
        )}
      </div>

      {/* 관리 화면은 목록 옆에 수정 중인 상품의 폼만 연다(새 등록은 '문제마켓 상품 등록'에서). */}
      <div className={mode === 'manage' && form.id ? 'grid gap-6 xl:grid-cols-[minmax(0,460px),minmax(0,1fr)]' : 'grid gap-6'}>
        <ProductEditor ctx={ctx} />

        <ProductList ctx={ctx} />
      </div>

      <RegisteredItemsTable ctx={ctx} />

      <AfterSaveDialog ctx={ctx} />

      <AdminMarketSamplePreviewDialog
        itemId={samplePreviewItemId}
        draftToken={sampleDraftToken}
        itemTitle={form.title || '문제마켓 상품'}
        open={isSamplePreviewOpen}
        workspaceSubject={workspaceSubject}
        onOpenChange={(open) => {
          setIsSamplePreviewOpen(open)
          if (!open) {
            setSamplePreviewItemId(null)
          }
        }}
      />

      <CategoryManagerDialog ctx={ctx} />

      <SubproductCategorySettingsDialog ctx={ctx} />

      <FileTypeSettingsDialog ctx={ctx} />

      <ProductListDialogs ctx={ctx} />
    </div>
  )
}
