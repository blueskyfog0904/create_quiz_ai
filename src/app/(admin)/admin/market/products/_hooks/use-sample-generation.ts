import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { renderSamplePdfPages } from '../_lib/sample-render'
import type { AdminSamplePage, SampleUploadTargetResponse, SampleFinalizeResponse } from '../_lib/types'
import type { MarketProductsState } from '../market-products-client'
import type { ProductFormApi } from './use-product-form'

export function useSampleGeneration(ctx: MarketProductsState & ProductFormApi) {
  const {
    workspaceSubject, form, samplePages, setSamplePages, samplePageSelection, selectedSampleSourceFile,
    setSelectedSampleSourceFile, sampleDraftToken, setSampleDraftToken, setIsSampleSourceUploading,
    setSampleGenerationStep, setDeletingSamplePageId, sampleSourceInputRef, ensureDraftItemForUpload,
  } = ctx

  const handleSelectSampleSourceFile = (file?: File | null) => {
    if (!file) {
      return
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('샘플 PDF에는 PDF 파일만 선택할 수 있습니다.')
      setSelectedSampleSourceFile(null)
      if (sampleSourceInputRef.current) {
        sampleSourceInputRef.current.value = ''
      }
      return
    }

    setSelectedSampleSourceFile(file)
  }

  const handleGenerateSampleImages = async () => {
    if (!selectedSampleSourceFile) {
      toast.error('샘플 PDF를 먼저 선택해주세요.')
      return
    }

    if (!samplePageSelection.trim()) {
      toast.error('샘플로 생성할 페이지 번호를 입력해주세요.')
      return
    }

    const targetItemId = form.id ?? await ensureDraftItemForUpload()
    if (!targetItemId) {
      return
    }

    setIsSampleSourceUploading(true)
    setSampleGenerationStep('rendering')
    let cleanupSourceBatchId: string | null = null
    const uploadedStoragePaths: string[] = []
    try {
      const renderedPages = await renderSamplePdfPages(selectedSampleSourceFile, samplePageSelection)

      setSampleGenerationStep('requesting_upload_targets')
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${targetItemId}/sample-pages/source`, workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftToken: sampleDraftToken || undefined,
          pages: renderedPages.map((page) => ({
            pageNumber: page.pageNumber,
            originalFileName: page.originalFileName,
            storageFileName: page.storageFileName,
            mimeType: page.mimeType,
            fileSizeBytes: page.fileSizeBytes,
            widthPx: page.widthPx,
            heightPx: page.heightPx,
          })),
        }),
      })
      const payload = await response.json() as SampleUploadTargetResponse

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '샘플 이미지 업로드 URL 생성에 실패했습니다.')
      }

      if (!payload.draftToken || !payload.sourceBatchId || !payload.bucket || !payload.uploadTargets) {
        throw new Error('샘플 이미지 업로드 URL 응답이 올바르지 않습니다.')
      }

      cleanupSourceBatchId = payload.sourceBatchId
      const renderedPageMap = new Map(renderedPages.map((page) => [page.pageNumber, page]))
      const supabase = createBrowserSupabaseClient()

      setSampleGenerationStep('uploading')
      for (const uploadTarget of payload.uploadTargets) {
        const renderedPage = renderedPageMap.get(uploadTarget.pageNumber)
        if (!renderedPage) {
          throw new Error('샘플 JPG와 업로드 URL을 매칭하지 못했습니다.')
        }

        const { error: uploadError } = await supabase
          .storage
          .from(payload.bucket)
          .uploadToSignedUrl(uploadTarget.storagePath, uploadTarget.token, renderedPage.blob, {
            contentType: 'image/jpeg',
          })

        if (uploadError) {
          throw new Error(uploadError.message)
        }

        uploadedStoragePaths.push(uploadTarget.storagePath)
      }

      setSampleGenerationStep('finalizing')
      const finalizeResponse = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${targetItemId}/sample-pages/source/finalize`, workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finalize_upload',
          draftToken: payload.draftToken,
          sourceBatchId: payload.sourceBatchId,
          pages: payload.uploadTargets.map((page) => ({
            pageNumber: page.pageNumber,
            originalFileName: page.originalFileName,
            storageFileName: page.storageFileName,
            storagePath: page.storagePath,
            mimeType: page.mimeType,
            fileSizeBytes: page.fileSizeBytes,
            widthPx: page.widthPx,
            heightPx: page.heightPx,
          })),
        }),
      })
      const finalizePayload = await finalizeResponse.json() as SampleFinalizeResponse

      if (!finalizeResponse.ok || !finalizePayload.success) {
        throw new Error(finalizePayload.error?.message || '샘플 이미지 저장에 실패했습니다.')
      }

      const nextDraftToken = String(finalizePayload.draftToken || payload.draftToken || sampleDraftToken || '')
      const generatedPages = (finalizePayload.pages || []).map((page) => ({
        ...page,
        draftToken: nextDraftToken,
      }))
      setSampleDraftToken(nextDraftToken || null)
      setSamplePages((current) => [...current, ...generatedPages])
      setSelectedSampleSourceFile(null)
      toast.success(`샘플 JPG ${generatedPages.length}장을 생성했습니다.`)
    } catch (error) {
      if (cleanupSourceBatchId && uploadedStoragePaths.length > 0) {
        await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${targetItemId}/sample-pages/source/finalize`, workspaceSubject), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cleanup_upload_batch',
            sourceBatchId: cleanupSourceBatchId,
            storagePaths: uploadedStoragePaths,
          }),
        }).catch(() => undefined)
      }

      toast.error(error instanceof Error ? error.message : '샘플 이미지 생성 중 오류가 발생했습니다.')
    } finally {
      setIsSampleSourceUploading(false)
      setSampleGenerationStep('idle')
      if (sampleSourceInputRef.current) {
        sampleSourceInputRef.current.value = ''
      }
    }
  }

  const handleDeleteSamplePage = async (page: AdminSamplePage) => {
    if (!form.id) {
      return
    }

    const deleteUrl = page.draftToken
      ? `/api/admin/market/items/${form.id}/sample-pages/${page.id}?draftToken=${encodeURIComponent(page.draftToken)}`
      : `/api/admin/market/items/${form.id}/sample-pages/${page.id}`

    setDeletingSamplePageId(page.id)
    try {
      const response = await fetch(withAdminWorkspaceSubject(deleteUrl, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '샘플 JPG 삭제에 실패했습니다.')
      }

      if (page.draftToken) {
        setSamplePages((current) => current.filter((currentPage) => currentPage.id !== page.id))
        if (!samplePages.some((currentPage) => currentPage.id !== page.id && currentPage.draftToken === page.draftToken)) {
          setSampleDraftToken((currentToken) => currentToken === page.draftToken ? null : currentToken)
        }
      } else {
        const activePages = (payload.pages || []) as AdminSamplePage[]
        setSamplePages((current) => [
          ...activePages,
          ...current.filter((currentPage) => currentPage.draftToken),
        ])
      }
      toast.success('샘플 JPG를 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '샘플 JPG 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingSamplePageId(null)
    }
  }

  const handleDeleteAllSamplePages = async () => {
    if (!form.id || samplePages.length === 0) {
      return
    }

    if (!window.confirm('생성된 샘플 이미지를 모두 삭제할까요?')) {
      return
    }

    setDeletingSamplePageId('__all__')
    const deletedPageIds: string[] = []
    try {
      for (const page of samplePages) {
        const deleteUrl = page.draftToken
          ? `/api/admin/market/items/${form.id}/sample-pages/${page.id}?draftToken=${encodeURIComponent(page.draftToken)}`
          : `/api/admin/market/items/${form.id}/sample-pages/${page.id}`
        const response = await fetch(withAdminWorkspaceSubject(deleteUrl, workspaceSubject), {
          method: 'DELETE',
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || '샘플 JPG 전체 삭제에 실패했습니다.')
        }
        deletedPageIds.push(page.id)
      }

      setSamplePages((current) => current.filter((page) => !deletedPageIds.includes(page.id)))
      setSampleDraftToken(null)
      toast.success('샘플 이미지를 모두 삭제했습니다.')
    } catch (error) {
      if (deletedPageIds.length > 0) {
        setSamplePages((current) => current.filter((page) => !deletedPageIds.includes(page.id)))
      }
      toast.error(error instanceof Error ? error.message : '샘플 JPG 전체 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingSamplePageId(null)
    }
  }

  const handleMoveSamplePage = (sourcePageId: string, targetPageId: string) => {
    if (sourcePageId === targetPageId) {
      return
    }

    setSamplePages((current) => {
      const sourceIndex = current.findIndex((page) => page.id === sourcePageId)
      const targetIndex = current.findIndex((page) => page.id === targetPageId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return current
      }

      const next = [...current]
      const [movedPage] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, movedPage)
      return next
    })
  }

  return {
    handleSelectSampleSourceFile, handleGenerateSampleImages, handleDeleteSamplePage, handleDeleteAllSamplePages,
    handleMoveSamplePage,
  }
}

export type SampleGenerationApi = ReturnType<typeof useSampleGeneration>
