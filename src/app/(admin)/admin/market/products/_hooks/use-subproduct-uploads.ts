import { useRef, useState } from 'react'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  createUploadEntries,
  describeUploadEntry,
  formatUploadLimitText,
  nextUploadEntry,
  summarizeUploads,
  updateUploadEntry,
  type UploadEvent,
  type UploadQueueEntry,
  type UploadStep,
} from '@/lib/admin-upload-queue'
import { uploadFileToSignedUrl } from '@/lib/admin-signed-upload'
import { MAX_MARKET_SUBPRODUCT_FILE_SIZE } from '@/lib/market-storage'
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
    setSubproductFileDrafts, activeFileTypes, refreshEditingFiles, ensureDraftItemForUpload, ask,
  } = ctx
  // 18번 7절: 입력 행(draftId)마다 올리기 줄. 화면은 state, 차례 처리는 ref(같은 값)를 읽는다. 파일 본문은 ref 에만 둔다.
  const [uploadQueues, setUploadQueues] = useState<Record<string, UploadQueueEntry[]>>({})
  const uploadQueuesRef = useRef<Record<string, UploadQueueEntry[]>>({})
  const uploadSourcesRef = useRef(new Map<string, { file: File }>())
  const drainingDraftIdsRef = useRef(new Set<string>())
  const setUploadQueue = (draftId: string, entries: UploadQueueEntry[] | null) => {
    const next = { ...uploadQueuesRef.current }
    if (entries) next[draftId] = entries
    else delete next[draftId]
    uploadQueuesRef.current = next
    setUploadQueues(next)
  }
  const applyUploadQueueEvent = (draftId: string, entryId: string, event: UploadEvent) => {
    const current = uploadQueuesRef.current[draftId] ?? []
    const updated = updateUploadEntry(current, entryId, event)
    if (updated !== current) setUploadQueue(draftId, updated)
  }
  const uploadLimitText = formatUploadLimitText(activeFileTypes.map((fileType) => fileType.label), MAX_MARKET_SUBPRODUCT_FILE_SIZE)

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
    for (const entry of uploadQueuesRef.current[draftId] ?? []) uploadSourcesRef.current.delete(entry.id)
    setUploadQueue(draftId, null)
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

    // 20번 6단계: 브라우저 확인 창 → 공통 확인 창(유형 가), 같은 문구
    const confirmed = await ask({ title: '이 서브상품과 연결된 파일을 삭제하시겠습니까?', confirmLabel: '삭제', danger: true })
    if (!confirmed) {
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

  // 파일 여러 개를 한 번에 올린다. 파일마다 확장자로 유형을 정하고(고른 유형과 맞으면 그 유형) 차례로(한 번에 1개씩) 올린다.
  // 18번 7절: 파일마다 대기·준비·올리는 중(%)·등록·완료/실패와 [다시 시도]. 상한(50MB)·형식은 놓는 순간 미리 보고 '건너뜀'으로 둔다.
  const runUploadEntry = async (itemId: string, subproductId: string, draftId: string, entryId: string) => {
    const source = uploadSourcesRef.current.get(entryId)
    const entry = (uploadQueuesRef.current[draftId] ?? []).find((current) => current.id === entryId)
    if (!source || !entry || !entry.fileTypeId) return false
    const { file } = source
    const fileTypeId = entry.fileTypeId
    applyUploadQueueEvent(draftId, entryId, { type: 'start' })
    // 등록 실패 뒤 [다시 시도]면 같은 경로로 등록만 다시 한다(파일을 두 번 올리거나 고아 파일을 남기지 않게).
    let storagePath = entry.resumeFromComplete ? entry.storagePath : null
    let step: UploadStep = storagePath ? 'complete' : 'prepare'
    // 파일 본문은 서명 업로드 URL로 Storage에 직접 올린다(Vercel 함수 요청 4.5MB 제한을 피함).
    const filesUrl = withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/subproducts/${subproductId}/files`, workspaceSubject)
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!storagePath) {
          step = 'prepare'
          const prepareResponse = await fetch(filesUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: 'prepare',
              fileTypeId,
              fileName: file.name,
              fileSize: file.size,
              contentType: file.type || null,
            }),
          })
          const preparePayload = await prepareResponse.json()
          if (!prepareResponse.ok || !preparePayload.success) {
            throw new Error(preparePayload.error?.message || '서브상품 파일 업로드 준비에 실패했습니다.')
          }

          const target = preparePayload.data as { bucket: string; storagePath: string; token: string }
          applyUploadQueueEvent(draftId, entryId, { type: 'prepared', storagePath: target.storagePath })
          step = 'upload'
          await uploadFileToSignedUrl({ bucket: target.bucket, storagePath: target.storagePath, token: target.token }, file, (loaded, total) => {
            applyUploadQueueEvent(draftId, entryId, { type: 'progress', loaded, total })
          })
          applyUploadQueueEvent(draftId, entryId, { type: 'uploaded' })
          storagePath = target.storagePath
        }

        step = 'complete'
        const response = await fetch(filesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 'complete', fileTypeId, fileName: file.name, storagePath }),
        })
        const payload = await response.json().catch(() => null)
        const errorCode = payload?.error?.code as string | undefined

        // 앞선 등록이 서버에서 끝나고 응답만 잃은 경우: 이미 등록됨 = 완료
        if ((response.ok && payload?.success) || errorCode === 'ALREADY_REGISTERED') {
          applyUploadQueueEvent(draftId, entryId, { type: 'registered' })
          uploadSourcesRef.current.delete(entryId)
          return true
        }
        // 등록만 다시 했는데 올린 파일이 없으면(서버가 정리함) 준비부터 한 번 더
        if (errorCode === 'UPLOAD_NOT_FOUND' && attempt === 0 && entry.resumeFromComplete) {
          applyUploadQueueEvent(draftId, entryId, { type: 'restart' })
          storagePath = null
          continue
        }
        throw new Error(payload?.error?.message || '서브상품 파일 업로드에 실패했습니다.')
      }
      throw new Error('서브상품 파일 업로드에 실패했습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : '서브상품 파일 업로드 중 오류가 발생했습니다.'
      applyUploadQueueEvent(draftId, entryId, { type: 'fail', step, message })
      toast.error(`${file.name}: ${message}`)
      return false
    }
  }

  // 대기 중인 파일을 차례로 올린다. 다 끝나 실패·건너뜀이 없으면 입력 행을 닫고, 있으면 다시 시도할 수 있게 남겨 둔다.
  const drainUploadQueue = async (itemId: string, subproductId: string, draftId: string) => {
    // 이 행을 이미 처리 중이면 그 반복이 새로 대기에 든 파일까지 이어서 올린다(한 번에 1개씩).
    if (drainingDraftIdsRef.current.has(draftId)) return
    drainingDraftIdsRef.current.add(draftId)
    setSubproductUploadingKeys((current) => [...current, draftId])
    let uploadedCount = 0
    try {
      for (let next = nextUploadEntry(uploadQueuesRef.current[draftId] ?? []); next; next = nextUploadEntry(uploadQueuesRef.current[draftId] ?? [])) {
        if (await runUploadEntry(itemId, subproductId, draftId, next.id)) uploadedCount += 1
      }

      if (uploadedCount > 0) {
        await refreshEditingFiles(itemId)
        toast.success(`파일 ${uploadedCount}개를 업로드했습니다.`)
      }
      // 행은 모두 끝났고(대기·진행 없음) 실패·건너뜀이 없을 때만 닫는다(처리 끝 직전 [다시 시도]한 파일이 사라지지 않게).
      const summary = summarizeUploads(uploadQueuesRef.current[draftId] ?? [])
      if (!summary.active && summary.failed === 0 && summary.skipped === 0) {
        handleRemoveSubproductFileDraft(draftId)
      }
    } finally {
      drainingDraftIdsRef.current.delete(draftId)
      setSubproductUploadingKeys((current) => current.filter((currentKey) => currentKey !== draftId))
    }
  }

  const handleSubproductFileUpload = async (subproductId: string, fileTypeId: string, files: File[], draftId: string) => {
    if (!form.id || files.length === 0) {
      return
    }

    const preferredFileType = activeFileTypes.find((fileType) => fileType.id === fileTypeId)
    const entries = createUploadEntries(files, {
      maxBytes: MAX_MARKET_SUBPRODUCT_FILE_SIZE,
      resolveFileTypeId: (file) => (preferredFileType && isAllowedSubproductFile(file, preferredFileType)
        ? preferredFileType
        : activeFileTypes.find((fileType) => isAllowedSubproductFile(file, fileType)))?.id ?? null,
      makeId: () => buildFileDraftId(),
    })
    entries.forEach((entry, index) => uploadSourcesRef.current.set(entry.id, { file: files[index] }))
    const skipped = entries.filter((entry) => entry.phase === 'skipped')
    if (skipped.length > 0) {
      toast.error(`올리지 않고 건너뜁니다: ${skipped.map((entry) => `${entry.fileName}(${describeUploadEntry(entry, MAX_MARKET_SUBPRODUCT_FILE_SIZE)})`).join(', ')}`)
    }
    setUploadQueue(draftId, [...(uploadQueuesRef.current[draftId] ?? []), ...entries])
    if (entries.every((entry) => entry.phase === 'skipped')) {
      return
    }

    await drainUploadQueue(form.id, subproductId, draftId)
  }

  // [다시 시도]: 그 파일만 준비부터 다시(완료된 파일은 다시 보내지 않는다)
  const handleRetryUploadEntry = async (subproductId: string, draftId: string, entryId: string) => {
    if (!form.id) return
    applyUploadQueueEvent(draftId, entryId, { type: 'retry' })
    await drainUploadQueue(form.id, subproductId, draftId)
  }

  // [빼기]: 올리는 중이 아닌 줄만 목록에서 뺀다
  const handleRemoveUploadEntry = (draftId: string, entryId: string) => {
    const entries = uploadQueuesRef.current[draftId] ?? []
    const target = entries.find((entry) => entry.id === entryId)
    if (!target || ['preparing', 'uploading', 'registering'].includes(target.phase)) return
    uploadSourcesRef.current.delete(entryId)
    setUploadQueue(draftId, entries.filter((entry) => entry.id !== entryId))
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
    uploadQueues, uploadLimitText, handleRetryUploadEntry, handleRemoveUploadEntry,
  }
}

export type SubproductUploadsApi = ReturnType<typeof useSubproductUploads>
