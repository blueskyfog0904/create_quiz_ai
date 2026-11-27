import { useCallback, useEffect, useMemo, useState } from 'react'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { toast } from 'sonner'
import type { MarketFileType, MarketItem, MarketSubproductCategory, MarketSubproductFile } from '@/lib/market-items-server'
import type { MarketItemProductOptionKind } from '@/lib/market-item-options'
import type { AdminCategoryTreeNode } from '@/components/admin/market-category-tree-editor'
import { collectSubtreeIds, findCategoryPath } from '@/lib/market-category-tree'
import {
  getItemCategoryItemId,
  MARKET_STATUS_LABELS,
  buildExamYearOptions,
  getDefaultExamYear,
  parseCreditInputValue,
  buildEmptyForm,
  buildEditForm,
  MARKET_ITEM_HIDDEN_INSTEAD_MESSAGE,
  buildEmptySubproductDraft,
  buildEmptyBundleForm,
  buildBundleFormFromOption,
  isSameBundleForm,
} from '../_lib/product-form'
import type {
  RegisteredItem,
  PersistFormOptions,
  MarketItemDetailPayload,
  SubproductDraftState,
  SubproductFileDraftState,
  MarketItemFormState,
  AdminSamplePage,
} from '../_lib/types'
import type { MarketProductsState } from '../market-products-client'

export function useProductForm(ctx: MarketProductsState) {
  const {
    workspaceSubject, attributeOptions, router, filterCategoryId, setFilterCategoryId, items, form, setForm,
    setIsSaving, setIsArchiving, requiresFinalRegistration, setRequiresFinalRegistration, setIsSamplePreviewOpen,
    setSamplePreviewItemId, samplePages, setSamplePages, setSamplePageSelection, setSelectedSampleSourceFile,
    sampleDraftToken, setSampleDraftToken, setIsSampleSourceDragActive, setSamplePageDragId, setSampleGenerationStep,
    subproducts, setSubproducts, subproductFiles, setSubproductFiles, setBundleOption, bundleOptionRef, setIsSubproductFormOpen,
    setEditingSubproductId, setSubproductEditDraft, bundleForm, setBundleForm, setSubproductUploadingKeys,
    setSubproductDragActiveKeys, categoryNodes, setCategoryNodes, categoryItemId, setCategoryItemId,
    savedCategoryItemId, setSavedCategoryItemId, thumbnailPreview, setThumbnailPreview, sampleSourceInputRef,
    listQuery, setHiddenOverride, refreshItems, changeFilterCategory, ask,
  } = ctx

  const [subproductCategories, setSubproductCategories] = useState<MarketSubproductCategory[]>([])
  const [fileTypes, setFileTypes] = useState<MarketFileType[]>([])
  const [subproductDraft, setSubproductDraft] = useState<SubproductDraftState>(buildEmptySubproductDraft())
  const [subproductFileDrafts, setSubproductFileDrafts] = useState<SubproductFileDraftState[]>([])
  // 18번 8절: 이 창에서 등록한 상품 표·저장 뒤 창, [같은 구성으로 다음 상품]·[복제]로 만든 상품 id(첫 저장 뒤 창을 띄움)
  const [registeredItems, setRegisteredItems] = useState<RegisteredItem[]>([])
  const [afterSaveItem, setAfterSaveItem] = useState<RegisteredItem | null>(null)
  const [sessionCopyItemIds, setSessionCopyItemIds] = useState<string[]>([])
  // 18번 7절: 17번 이용 근거 카드가 알려 준 '근거가 있는 상품' id 집합(공개 전 점검의 경고 칩)
  const [usageBasisItemIds, setUsageBasisItemIds] = useState<string[]>([])

  // 폼의 thumbnailImageId에 맞는 미리보기: 방금 고른 이미지 → 목록에 실린 상품 이미지 순으로 찾는다.
  // 숨김 토글처럼 buildEditForm만 다시 부르는 경로에서도 id와 미리보기가 어긋나지 않는다.
  const thumbnailFieldValue = useMemo(() => {
    if (!form.thumbnailImageId) return null
    if (thumbnailPreview?.id === form.thumbnailImageId) return thumbnailPreview
    const listed = items.find((item) => item.id === form.id)?.thumbnailImage ?? null
    return listed?.id === form.thumbnailImageId ? listed : null
  }, [form.id, form.thumbnailImageId, items, thumbnailPreview])

  const selectedCategoryPath = useMemo(
    () => (categoryItemId ? findCategoryPath(categoryNodes, categoryItemId) : null) ?? [],
    [categoryNodes, categoryItemId]
  )
  const selectedCategory = selectedCategoryPath.at(-1) ?? null
  // 고른 칸부터 상위 칸 순으로 가장 가까운 기본 이미지(공개 화면과 같은 상속 규칙)
  const selectedCategoryDefaultImage = selectedCategoryPath.findLast((node) => node.defaultImage)?.defaultImage ?? null
  // 새 상품은 카테고리를 고르기 전에는 업로드(= 임시 상품 생성)를 막는다.
  const isUploadBlockedByCategory = !form.id && !categoryItemId

  const examYearOptions = useMemo(() => buildExamYearOptions(), [])
  const activeSubproductCategories = useMemo(
    () => subproductCategories.filter((category) => category.is_active),
    [subproductCategories]
  )
  const activeFileTypes = useMemo(
    () => fileTypes.filter((fileType) => fileType.is_active),
    [fileTypes]
  )
  const subproductFilesBySubproductId = useMemo(() => {
    const fileMap = new Map<string, MarketSubproductFile[]>()
    subproductFiles
      .filter((file) => file.is_active)
      .forEach((file) => {
        const current = fileMap.get(file.subproduct_id) || []
        fileMap.set(file.subproduct_id, [...current, file])
      })

    return fileMap
  }, [subproductFiles])

  // 연도는 '선택'(빈 값)으로 시작한다. 목록을 펼치면 고른 연도(없으면 올해)를 가운데에 보여 주기만 하고, 클릭해야 값이 정해진다.
  const [isExamYearOpen, setIsExamYearOpen] = useState(false)
  const currentExamYear = getDefaultExamYear()
  // 17번 7-2: 학년·자료유형 선택 목록. 맨 위 '선택 안 함'(빈 값), 사용 중 항목 순서대로, 그리고 상품 값이 숨긴 항목이거나
  // 목록에 없는 옛 값이면 '(숨김) 이름'으로 함께 보여 그대로 저장되게 한다(저장 route 는 지금 값과 같으면 통과).
  const productOptionChoices = (kind: MarketItemProductOptionKind, value: string) => {
    const options = attributeOptions[kind]
    const choices = [
      { value: '', label: '선택 안 함' },
      ...options.filter((option) => option.isActive).map((option) => ({ value: option.label, label: option.label })),
    ]
    if (value && !options.some((option) => option.isActive && option.label === value)) choices.push({ value, label: `(숨김) ${value}` })
    return choices
  }
  const scrollExamYearListToAnchor = (list: HTMLDivElement | null) => {
    const anchor = list?.querySelector<HTMLElement>(`[data-year="${form.examYear || currentExamYear}"]`)
    if (list && anchor) {
      list.scrollTop = anchor.offsetTop - (list.clientHeight - anchor.offsetHeight) / 2
    }
  }
  const pickExamYear = (year: string) => {
    setForm((current) => ({ ...current, examYear: year }))
    setIsExamYearOpen(false)
  }

  const reloadUploadTaxonomy = useCallback(async () => {
    const [categoryResponse, fileTypeResponse] = await Promise.all([
      fetch(withAdminWorkspaceSubject('/api/admin/market/subproduct-categories', workspaceSubject), { cache: 'no-store' }),
      fetch(withAdminWorkspaceSubject('/api/admin/market/file-types', workspaceSubject), { cache: 'no-store' }),
    ])
    const [categoryPayload, fileTypePayload] = await Promise.all([
      categoryResponse.json(),
      fileTypeResponse.json(),
    ])

    if (!categoryResponse.ok || !categoryPayload.success) {
      throw new Error(categoryPayload.error?.message || '서브상품 카테고리 목록을 불러오지 못했습니다.')
    }
    if (!fileTypeResponse.ok || !fileTypePayload.success) {
      throw new Error(fileTypePayload.error?.message || '파일 유형 목록을 불러오지 못했습니다.')
    }

    const nextCategories = (categoryPayload.data || []) as MarketSubproductCategory[]
    const nextFileTypes = (fileTypePayload.data || []) as MarketFileType[]
    const nextActiveCategories = nextCategories.filter((category) => category.is_active)
    const nextActiveFileTypes = nextFileTypes.filter((fileType) => fileType.is_active)

    setSubproductCategories(nextCategories)
    setFileTypes(nextFileTypes)
    // 19번 6-2: 고르던 값이 다시 읽은 목록에 없으면(숨김·삭제) 첫 항목으로 바꿔 끼우지 않고 비운다 — '다시 골라 주세요'(잘못된 유형으로 저장되지 않게)
    setSubproductDraft((current) => !current.categoryId || nextActiveCategories.some((category) => category.id === current.categoryId)
      ? current
      : { ...current, categoryId: '', needsReselect: true })
    setSubproductFileDrafts((current) => {
      let changed = false
      const nextDrafts = current.map((draft) => {
        if (!draft.fileTypeId || nextActiveFileTypes.some((fileType) => fileType.id === draft.fileTypeId)) {
          return draft
        }

        changed = true
        return { ...draft, fileTypeId: '', needsReselect: true }
      })

      return changed ? nextDrafts : current
    })

    return { categories: nextCategories, fileTypes: nextFileTypes }
  }, [workspaceSubject])

  useEffect(() => {
    let isMounted = true

    const loadUploadTaxonomy = async () => {
      try {
        const { categories } = await reloadUploadTaxonomy()
        if (!isMounted) {
          return
        }

        setSubproductDraft((current) => current.categoryId
          ? current
          : buildEmptySubproductDraft(categories.find((category) => category.is_active)?.id || categories[0]?.id || ''))
      } catch (error) {
        if (isMounted) {
          toast.error(error instanceof Error ? error.message : '서브상품 설정을 불러오지 못했습니다.')
        }
      }
    }

    void loadUploadTaxonomy()

    return () => {
      isMounted = false
    }
  }, [reloadUploadTaxonomy])

  // 19번 6-2: 구성·파일 유형 관리는 '상품 표시 설정'(새 탭)으로 옮겼다. 창이 다시 보이면(visibilitychange·focus) 목록을 다시 읽는다.
  // 고르던 값·올리던 파일 초안은 그대로 둔다(위 reloadUploadTaxonomy 가 없어진 값만 비움).
  useEffect(() => {
    const reloadQuietly = () => {
      if (document.visibilityState !== 'visible') return
      reloadUploadTaxonomy().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', reloadQuietly)
    window.addEventListener('focus', reloadQuietly)
    return () => {
      document.removeEventListener('visibilitychange', reloadQuietly)
      window.removeEventListener('focus', reloadQuietly)
    }
  }, [reloadUploadTaxonomy])

  // [목록 새로고침] 버튼
  const refreshUploadTaxonomy = async () => {
    try {
      await reloadUploadTaxonomy()
      toast.success('구성·파일 유형 목록을 다시 읽었습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 설정을 불러오지 못했습니다.')
    }
  }

  // [카테고리 관리] 팝업에서 칸을 바꾸면 선택칸에 바로 반영한다. 고른 칸이 삭제됐으면 선택을 비운다.
  const applyCategoryTree = (tree: AdminCategoryTreeNode[]) => {
    setCategoryNodes(tree)
    if (categoryItemId && !findCategoryPath(tree, categoryItemId)) {
      setCategoryItemId('')
    }
    if (filterCategoryId && !findCategoryPath(tree, filterCategoryId)) {
      changeFilterCategory('')
    }
  }

  const reloadCategoryTree = async () => {
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/market-categories', workspaceSubject), { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '카테고리 메뉴 목록을 불러오지 못했습니다.')
      }

      applyCategoryTree((payload.data?.nodes || []) as AdminCategoryTreeNode[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리 메뉴 목록을 불러오지 못했습니다.')
    }
  }

  // nextCategoryItemId: 이어서 만들 새 상품에 미리 골라 둘 카테고리
  const resetForm = (nextCategoryItemId = '') => {
    setForm(buildEmptyForm())
    setThumbnailPreview(null)
    setCategoryItemId(nextCategoryItemId)
    setSavedCategoryItemId('')
    setSubproducts([])
    setSubproductFiles([])
    setBundleOption(null)
    bundleOptionRef.current = null
    setBundleForm(buildEmptyBundleForm())
    setSubproductDraft(buildEmptySubproductDraft(activeSubproductCategories[0]?.id || subproductCategories[0]?.id || ''))
    setIsSubproductFormOpen(false)
    setEditingSubproductId(null)
    setSubproductEditDraft(null)
    setSubproductFileDrafts([])
    setSubproductUploadingKeys([])
    setSubproductDragActiveKeys([])
    setRequiresFinalRegistration(false)
    setSamplePages([])
    setSamplePageSelection('1,2,3')
    setSelectedSampleSourceFile(null)
    setSampleDraftToken(null)
    setIsSampleSourceDragActive(false)
    setSamplePageDragId(null)
    setSampleGenerationStep('idle')
    if (sampleSourceInputRef.current) {
      sampleSourceInputRef.current.value = ''
    }
    setIsSamplePreviewOpen(false)
    setSamplePreviewItemId(null)
  }

  const fetchItemDetail = async (id: string) => {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${id}`, workspaceSubject), { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 상세를 불러오지 못했습니다.')
    }

    return payload.data as MarketItemDetailPayload
  }

  // keepBundleDraft: 전체구매는 아래 저장 바로만 저장되므로, 다른 즉시 저장 뒤 다시 읽을 때 고친 입력은 남긴다.
  const applyItemDetail = (detail: MarketItemDetailPayload, options: { keepBundleDraft?: boolean } = {}) => {
    const previousServerForm = buildBundleFormFromOption(bundleOptionRef.current)
    const nextOption = detail.bundleOption || null
    const nextServerForm = buildBundleFormFromOption(nextOption)
    bundleOptionRef.current = nextOption
    setSubproducts(detail.subproducts || [])
    setSubproductFiles(detail.subproductFiles || [])
    setBundleOption(nextOption)
    setBundleForm((current) => (
      options.keepBundleDraft && !isSameBundleForm(current, previousServerForm) ? current : nextServerForm
    ))
  }

  const fetchItemSamplePages = async (id: string) => {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${id}/sample-pages`, workspaceSubject), { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '샘플 JPG 목록을 불러오지 못했습니다.')
    }

    return (payload.pages || []) as AdminSamplePage[]
  }

  const persistSamplePageOrder = async (itemId: string) => {
    if (samplePages.length === 0) {
      return
    }

    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/sample-pages`, workspaceSubject), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds: samplePages.map((page) => page.id) }),
    })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '샘플 이미지 순서 저장에 실패했습니다.')
    }
  }

  const persistBundleOption = async (itemId: string) => {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/bundle-option`, workspaceSubject), {
      method: bundleForm.enabled ? 'PATCH' : 'DELETE',
      headers: bundleForm.enabled ? { 'Content-Type': 'application/json' } : undefined,
      body: bundleForm.enabled
        ? JSON.stringify({
          label: bundleForm.label,
          description: bundleForm.description,
          priceCredits: parseCreditInputValue(bundleForm.priceCredits),
          isActive: true,
        })
        : undefined,
    })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '전체구매 옵션 저장에 실패했습니다.')
    }
  }

  const loadItemDetail = async (id: string) => {
    const detail = await fetchItemDetail(id)

    setForm(buildEditForm(detail.item))
    setThumbnailPreview(detail.item.thumbnailImage)
    setCategoryItemId(getItemCategoryItemId(detail.item))
    setSavedCategoryItemId(getItemCategoryItemId(detail.item))
    applyItemDetail(detail)
    setSamplePages(await fetchItemSamplePages(id))
    setSelectedSampleSourceFile(null)
    setSampleDraftToken(null)
    setIsSampleSourceDragActive(false)
    setSamplePageDragId(null)
    if (sampleSourceInputRef.current) {
      sampleSourceInputRef.current.value = ''
    }
    setSubproductFileDrafts([])
    setEditingSubproductId(null)
    setSubproductEditDraft(null)
    setSubproductUploadingKeys([])
    setSubproductDragActiveKeys([])
    setRequiresFinalRegistration(detail.item.status === 'draft' && detail.item.draft_source === 'auto_upload')
  }

  const refreshEditingFiles = async (id: string) => {
    const detail = await fetchItemDetail(id)
    applyItemDetail(detail, { keepBundleDraft: true })
  }

  const buildRequestBody = (
    statusOverride?: MarketItemFormState['status'],
    draftSource: 'manual' | 'auto_upload' = form.draftSource
  ) => ({
    title: form.title,
    summary: form.summary,
    description: form.description,
    thumbnailImageId: form.thumbnailImageId,
    examYear: form.examYear ? Number(form.examYear) : null,
    examMonth: form.examMonth ? Number(form.examMonth) : null,
    gradeLevel: form.gradeLevel,
    sourceType: form.sourceType,
    source1: form.source1,
    source2: form.source2,
    source3: form.source3,
    source4: form.source4,
    questionCount: form.questionCount ? Number(form.questionCount) : null,
    pdfPrice: parseCreditInputValue(form.pdfPrice),
    hwpPrice: parseCreditInputValue(form.hwpPrice),
    zipPrice: parseCreditInputValue(form.zipPrice),
    status: statusOverride ?? form.status,
    draftSource,
    isActive: form.isActive,
    ...(categoryItemId !== savedCategoryItemId ? { categoryItemId } : {}),
  })

  const persistForm = async (
    statusOverride?: MarketItemFormState['status'],
    options: PersistFormOptions = {}
  ): Promise<MarketItem | null> => {
    // 카테고리는 필수다(예전 미지정 상품도 수정 저장할 때 고른다).
    if (!categoryItemId) {
      toast.error('카테고리를 선택해주세요.')
      return null
    }

    if (!form.title.trim()) {
      toast.error('상품 제목을 입력해주세요.')
      return null
    }

    const nextStatus = statusOverride ?? form.status
    if (nextStatus === 'published' && options.draftSource !== 'auto_upload' && bundleForm.enabled && parseCreditInputValue(bundleForm.priceCredits) <= 0) {
      toast.error('전체구매 가격을 설정해주세요')
      return null
    }

    setIsSaving(true)
    try {
      const targetId = options.targetId ?? form.id
      const response = await fetch(withAdminWorkspaceSubject(targetId ? `/api/admin/market/items/${targetId}` : '/api/admin/market/items', workspaceSubject), {
        method: targetId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(statusOverride, options.draftSource)),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 저장에 실패했습니다.')
      }

      // 저장한 상품이 상단 필터 밖이면 필터를 그 상품의 칸으로 옮겨 1페이지부터 보여 준다(필터 안이면 현재 페이지 유지).
      // 코드가 돌리는 이동이라 방문 기록은 남기지 않는다(replaceState).
      const filterNode = filterCategoryId ? findCategoryPath(categoryNodes, filterCategoryId)?.at(-1) : null
      const nextFilterCategoryId = filterNode && !collectSubtreeIds(filterNode).includes(categoryItemId) ? categoryItemId : filterCategoryId
      if (nextFilterCategoryId !== filterCategoryId) {
        listQuery.update({ page: 1 }, true)
      }
      setFilterCategoryId(nextFilterCategoryId)
      await refreshItems(nextFilterCategoryId)
      if (options.draftSource !== 'auto_upload') {
        await persistSamplePageOrder(payload.data.id)
        await persistBundleOption(payload.data.id)
      }
      const detail = await fetchItemDetail(payload.data.id)
      setForm(buildEditForm(detail.item))
      setThumbnailPreview(detail.item.thumbnailImage)
      setCategoryItemId(getItemCategoryItemId(detail.item))
      setSavedCategoryItemId(getItemCategoryItemId(detail.item))
      setHiddenOverride(detail.item.id, detail.item.status === 'hidden')
      applyItemDetail(detail, { keepBundleDraft: options.draftSource === 'auto_upload' })
      if (sampleDraftToken && options.draftSource !== 'auto_upload') {
        const commitResponse = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${detail.item.id}/samples/commit`, workspaceSubject), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftToken: sampleDraftToken }),
        })
        const commitPayload = await commitResponse.json()

        if (!commitResponse.ok || !commitPayload.success) {
          throw new Error(commitPayload.error?.message || '샘플 JPG 확정에 실패했습니다.')
        }

        setSampleDraftToken(null)
        setSamplePages(await fetchItemSamplePages(detail.item.id))
      }
      if (!options.skipSuccessToast) {
        toast.success(targetId
          ? `문제마켓 상품을 ${MARKET_STATUS_LABELS[nextStatus]} 상태로 저장했습니다.`
          : '문제마켓 상품을 생성했습니다.')
      }
      router.refresh()
      return detail.item
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 저장 중 오류가 발생했습니다.')
      return null
    } finally {
      setIsSaving(false)
    }
  }

  // 하단 버튼(공개하기·임시저장·숨김·보관)은 모두 이 저장 하나로 상태를 정해 저장한다.
  // 18번 8절: '이번에 등록한 상품' 표에 넣고 저장 뒤 창을 연다(창은 아래 handleSave 의 resetForm 블록 밖에서 연다).
  const recordRegisteredItem = (item: MarketItem) => {
    const entry: RegisteredItem = { id: item.id, title: item.title, status: item.status as MarketItemFormState['status'], subproductCount: subproducts.length }
    setRegisteredItems((current) => [entry, ...current.filter((registered) => registered.id !== item.id)])
    setSessionCopyItemIds((current) => current.filter((itemId) => itemId !== item.id))
    setAfterSaveItem(entry)
  }

  const handleSave = async (status: MarketItemFormState['status']) => {
    if (form.id) {
      // (b) 임시 상품 최종 등록, (c) 이 창에서 복제로 만든 상품의 첫 저장만 창을 띄운다(기존 상품 수정 저장은 띄우지 않음).
      const isSessionCopy = sessionCopyItemIds.includes(form.id)
      const result = await persistForm(status, { draftSource: 'manual' })
      if (result) {
        if (requiresFinalRegistration || isSessionCopy) {
          recordRegisteredItem(result)
        }
        if (requiresFinalRegistration) {
          resetForm(getItemCategoryItemId(result))
          return
        }
        setRequiresFinalRegistration(false)
      }
      return
    }

    const createdItem = await persistForm(status, { draftSource: 'manual' })
    if (createdItem) {
      recordRegisteredItem(createdItem)
      resetForm(getItemCategoryItemId(createdItem))
    }
  }

  const ensureDraftItemForUpload = async () => {
    if (form.id) {
      return form.id
    }

    // 임시 상품도 카테고리가 필수라, 고르기 전에는 POST하지 않고 업로드를 멈춘다.
    if (!categoryItemId) {
      toast.error('카테고리를 먼저 선택해주세요.')
      return null
    }

    const desiredStatus = form.status
    const createdItem = await persistForm('draft', {
      preserveSelections: true,
      skipSuccessToast: true,
      draftSource: 'auto_upload',
    })

    if (!createdItem) {
      return null
    }

    setRequiresFinalRegistration(true)
    setForm((current) => ({ ...current, status: desiredStatus, draftSource: 'auto_upload' }))
    toast.success('파일 업로드를 위해 상품을 임시 저장했습니다. 업로드 후 상품 등록을 완료해주세요.')
    return createdItem.id
  }

  const handleArchive = async () => {
    if (!form.id) {
      return
    }

    const isCancellingAutoUploadDraft = form.draftSource === 'auto_upload'
    // 20번 6단계: 브라우저 확인 창 → 공통 확인 창(유형 가). 문구는 전 확인 창 그대로(제목 + 설명으로 나눔).
    const confirmed = await ask(isCancellingAutoUploadDraft
      ? {
        title: '상품 등록을 완료하지 않고 업로드 파일을 삭제할까요?',
        description: '임시 상품과 생성된 샘플 JPG가 모두 삭제되며 되돌릴 수 없습니다.',
        confirmLabel: '등록 취소 및 파일 삭제',
        danger: true,
      }
      : {
        title: '이 상품을 완전 삭제하시겠습니까?',
        description: 'DB 데이터와 업로드된 파일이 모두 삭제되며 되돌릴 수 없습니다. 구매·환불·후기 이력이 있는 상품은 삭제되지 않고 숨김 처리됩니다(구매자 다운로드는 유지).',
        confirmLabel: '완전 삭제',
        danger: true,
      })

    if (!confirmed) {
      return
    }

    setIsArchiving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${form.id}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 완전 삭제에 실패했습니다.')
      }

      await refreshItems()
      resetForm(categoryItemId)
      if (payload.data?.result === 'hidden') {
        toast.success(MARKET_ITEM_HIDDEN_INSTEAD_MESSAGE)
      } else {
        toast.success(isCancellingAutoUploadDraft ? '임시 업로드 파일을 삭제했습니다.' : '문제마켓 상품을 완전 삭제했습니다.')
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 완전 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsArchiving(false)
    }
  }

  return {
    registeredItems, setRegisteredItems, afterSaveItem, setAfterSaveItem, sessionCopyItemIds, setSessionCopyItemIds,
    usageBasisItemIds, setUsageBasisItemIds, recordRegisteredItem,
    subproductCategories, setSubproductCategories, fileTypes, setFileTypes, subproductDraft, setSubproductDraft,
    subproductFileDrafts, setSubproductFileDrafts, thumbnailFieldValue, selectedCategoryPath, selectedCategory,
    selectedCategoryDefaultImage, isUploadBlockedByCategory, examYearOptions, activeSubproductCategories,
    activeFileTypes, subproductFilesBySubproductId, isExamYearOpen, setIsExamYearOpen, currentExamYear,
    productOptionChoices, scrollExamYearListToAnchor, pickExamYear, reloadUploadTaxonomy, refreshUploadTaxonomy, applyCategoryTree,
    reloadCategoryTree, resetForm, fetchItemDetail, applyItemDetail, fetchItemSamplePages, persistSamplePageOrder,
    persistBundleOption, loadItemDetail, refreshEditingFiles, buildRequestBody, persistForm, handleSave,
    ensureDraftItemForUpload, handleArchive,
  }
}

export type ProductFormApi = ReturnType<typeof useProductForm>
