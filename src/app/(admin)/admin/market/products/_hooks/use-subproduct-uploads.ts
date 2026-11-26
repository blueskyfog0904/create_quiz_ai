import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { MarketFileType, MarketItemSubproduct } from '@/lib/market-items-server'
import { parseCreditInputValue, buildEmptySubproductDraft, buildSubproductEditState } from '../_lib/product-form'
import type { SubproductFileDraftState } from '../_lib/types'
import type { MarketProductsState } from '../market-products-client'
import type { ProductFormApi } from './use-product-form'

export function useSubproductUploads(ctx: MarketProductsState & ProductFormApi) {
  const {
    workspaceSubject, form, setIsSubproductFormOpen, editingSubproductId, setEditingSubproductId,
    subproductEditDraft, setSubproductEditDraft, setIsSubproductSaving, setSubproductUploadingKeys,
    setSubproductDragActiveKeys, subproductCategories, fileTypes, subproductDraft, setSubproductDraft,
    setSubproductFileDrafts, activeFileTypes, refreshEditingFiles, ensureDraftItemForUpload,
  } = ctx

  const getSubproductCategoryName = (categoryId: string) => (
    subproductCategories.find((category) => category.id === categoryId)?.name || '서브상품'
  )

  const getFileTypeLabel = (fileTypeId: string) => (
    fileTypes.find((fileType) => fileType.id === fileTypeId)?.label || '파일'
  )

  const getFileTypeAcceptValue = (fileType: MarketFileType) => (
    fileType.extension.startsWith('.') ? fileType.extension : `.${fileType.extension}`
  )

  const isAllowedSubproductFile = (file: File, fileType: MarketFileType) => (
    file.name.toLowerCase().endsWith(getFileTypeAcceptValue(fileType).toLowerCase())
  )

  const buildFileDraftId = () => (
    globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )

  // 같은 유형 파일도 여러 개 올릴 수 있다(예: 기본·심화 PDF). 모든 활성 파일 유형을 고를 수 있다.
  const handleAddSubproductFileDraft = (subproductId: string) => {
    const defaultFileTypeId = activeFileTypes[0]?.id || ''
    if (!defaultFileTypeId) {
      toast.error('추가할 수 있는 파일 유형이 없습니다. 파일 유형을 추가해주세요.')
      return
    }

    setSubproductFileDrafts((current) => [
      ...current,
      {
        id: buildFileDraftId(),
        subproductId,
        fileTypeId: defaultFileTypeId,
      },
    ])
  }

  const handleUpdateSubproductFileDraft = (draftId: string, patch: Partial<SubproductFileDraftState>) => {
    setSubproductFileDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, ...patch } : draft))
  }

  const handleRemoveSubproductFileDraft = (draftId: string) => {
    setSubproductFileDrafts((current) => current.filter((draft) => draft.id !== draftId))
    setSubproductUploadingKeys((current) => current.filter((key) => key !== draftId))
    setSubproductDragActiveKeys((current) => current.filter((key) => key !== draftId))
  }

  const setSubproductDragActive = (key: string, active: boolean) => {
    setSubproductDragActiveKeys((current) => active
      ? current.includes(key) ? current : [...current, key]
      : current.filter((currentKey) => currentKey !== key))
  }

  const handleCreateSubproduct = async () => {
    if (!subproductDraft.categoryId) {
      toast.error('서브상품 카테고리를 선택해주세요.')
      return
    }

    const targetItemId = form.id ?? await ensureDraftItemForUpload()
    if (!targetItemId) {
      return
    }

    setIsSubproductSaving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${targetItemId}/subproducts`, workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: subproductDraft.categoryId,
          description: subproductDraft.description,
          purchaseNoticeLabel: subproductDraft.purchaseNoticeLabel,
          purchaseNoticeText: subproductDraft.purchaseNoticeText,
          priceCredits: parseCreditInputValue(subproductDraft.priceCredits),
          isActive: true,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 추가에 실패했습니다.')
      }

      await refreshEditingFiles(targetItemId)
      setSubproductDraft(buildEmptySubproductDraft(subproductDraft.categoryId))
      setIsSubproductFormOpen(false)
      // 새 서브상품에는 바로 파일을 끌어놓을 수 있게 업로드 칸을 열어 둔다.
      if (payload.data?.id) {
        handleAddSubproductFileDraft(payload.data.id)
      }
      toast.success('서브상품을 추가했습니다. 이제 파일을 올려주세요.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 추가 중 오류가 발생했습니다.')
    } finally {
      setIsSubproductSaving(false)
    }
  }

  const handleEditSubproduct = (subproduct: MarketItemSubproduct) => {
    setEditingSubproductId(subproduct.id)
    setSubproductEditDraft(buildSubproductEditState(subproduct))
  }

  const handleCancelEditSubproduct = () => {
    setEditingSubproductId(null)
    setSubproductEditDraft(null)
  }

  const handleSaveSubproduct = async (subproductId: string) => {
    if (!form.id || !subproductEditDraft) {
      return
    }

    if (!subproductEditDraft.categoryId) {
      toast.error('서브상품 카테고리를 선택해주세요.')
      return
    }

    setIsSubproductSaving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${form.id}/subproducts/${subproductId}`, workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: subproductEditDraft.categoryId,
          description: subproductEditDraft.description,
          purchaseNoticeLabel: subproductEditDraft.purchaseNoticeLabel,
          purchaseNoticeText: subproductEditDraft.purchaseNoticeText,
          priceCredits: parseCreditInputValue(subproductEditDraft.priceCredits),
          isActive: subproductEditDraft.isActive,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 수정에 실패했습니다.')
      }

      await refreshEditingFiles(form.id)
      handleCancelEditSubproduct()
      toast.success('서브상품을 수정했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 수정 중 오류가 발생했습니다.')
    } finally {
      setIsSubproductSaving(false)
    }
  }

  const handleDeleteSubproduct = async (subproductId: string) => {
    if (!form.id) {
      return
    }

    if (!window.confirm('이 서브상품과 연결된 파일을 삭제하시겠습니까?')) {
      return
    }

    setIsSubproductSaving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${form.id}/subproducts/${subproductId}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 삭제에 실패했습니다.')
      }

      await refreshEditingFiles(form.id)
      setSubproductFileDrafts((current) => current.filter((draft) => draft.subproductId !== subproductId))
      if (editingSubproductId === subproductId) {
        handleCancelEditSubproduct()
      }
      toast.success('서브상품을 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsSubproductSaving(false)
    }
  }

  // 파일 여러 개를 한 번에 올린다. 파일마다 확장자로 유형을 정하고(고른 유형과 맞으면 그 유형) 차례로 올린다.
  const handleSubproductFileUpload = async (subproductId: string, fileTypeId: string, files: File[], draftId: string) => {
    if (!form.id || files.length === 0) {
      return
    }

    const preferredFileType = activeFileTypes.find((fileType) => fileType.id === fileTypeId)
    const uploads = files.map((file) => ({
      file,
      fileType: preferredFileType && isAllowedSubproductFile(file, preferredFileType)
        ? preferredFileType
        : activeFileTypes.find((fileType) => isAllowedSubproductFile(file, fileType)),
    }))
    const unsupported = uploads.filter((upload) => !upload.fileType).map((upload) => upload.file.name)
    if (unsupported.length > 0) {
      toast.error(`등록된 파일 유형과 맞지 않아 건너뜁니다: ${unsupported.join(', ')}`)
    }
    const accepted = uploads.filter((upload): upload is { file: File; fileType: MarketFileType } => Boolean(upload.fileType))
    if (accepted.length === 0) {
      return
    }

    const itemId = form.id
    setSubproductUploadingKeys((current) => [...current, draftId])
    let uploadedCount = 0
    try {
      for (const { file, fileType } of accepted) {
        try {
          // 파일 본문은 서명 업로드 URL로 Storage에 직접 올린다(Vercel 함수 요청 4.5MB 제한을 피함).
          const filesUrl = withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/subproducts/${subproductId}/files`, workspaceSubject)
          const prepareResponse = await fetch(filesUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: 'prepare',
              fileTypeId: fileType.id,
              fileName: file.name,
              fileSize: file.size,
              contentType: file.type || null,
            }),
          })
          const preparePayload = await prepareResponse.json()
          if (!prepareResponse.ok || !preparePayload.success) {
            throw new Error(preparePayload.error?.message || '서브상품 파일 업로드 준비에 실패했습니다.')
          }

          const { bucket, storagePath, token } = preparePayload.data as { bucket: string; storagePath: string; token: string }
          const { error: uploadError } = await createBrowserSupabaseClient()
            .storage
            .from(bucket)
            .uploadToSignedUrl(storagePath, token, file)
          if (uploadError) {
            throw new Error(uploadError.message)
          }

          const response = await fetch(filesUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'complete', fileTypeId: fileType.id, fileName: file.name, storagePath }),
          })
          const payload = await response.json()

          if (!response.ok || !payload.success) {
            throw new Error(payload.error?.message || '서브상품 파일 업로드에 실패했습니다.')
          }
          uploadedCount += 1
        } catch (error) {
          toast.error(`${file.name}: ${error instanceof Error ? error.message : '서브상품 파일 업로드 중 오류가 발생했습니다.'}`)
        }
      }

      if (uploadedCount > 0) {
        await refreshEditingFiles(itemId)
        toast.success(`파일 ${uploadedCount}개를 업로드했습니다.`)
      }
      // 모두 올렸으면 입력 행을 닫고, 실패한 파일이 있으면 다시 올릴 수 있게 남겨 둔다.
      if (uploadedCount === accepted.length && unsupported.length === 0) {
        handleRemoveSubproductFileDraft(draftId)
      }
    } finally {
      setSubproductUploadingKeys((current) => current.filter((currentKey) => currentKey !== draftId))
    }
  }

  const handleDeleteSubproductFile = async (subproductId: string, fileId: string) => {
    if (!form.id) {
      return
    }

    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${form.id}/subproducts/${subproductId}/files/${fileId}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 파일 삭제에 실패했습니다.')
      }

      await refreshEditingFiles(form.id)
      toast.success('서브상품 파일을 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 파일 삭제 중 오류가 발생했습니다.')
    }
  }

  return {
    getSubproductCategoryName, getFileTypeLabel, getFileTypeAcceptValue, isAllowedSubproductFile, buildFileDraftId,
    handleAddSubproductFileDraft, handleUpdateSubproductFileDraft, handleRemoveSubproductFileDraft,
    setSubproductDragActive, handleCreateSubproduct, handleEditSubproduct, handleCancelEditSubproduct,
    handleSaveSubproduct, handleDeleteSubproduct, handleSubproductFileUpload, handleDeleteSubproductFile,
  }
}

export type SubproductUploadsApi = ReturnType<typeof useSubproductUploads>
