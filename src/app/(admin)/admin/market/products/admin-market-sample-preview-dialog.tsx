'use client'

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface SamplePagePreview {
  pageNumber: number
  signedUrl: string
  fileSizeBytes: number | null
  widthPx: number | null
  heightPx: number | null
}

interface AdminMarketSamplePreviewDialogProps {
  itemId: string | null
  itemTitle: string
  open: boolean
  workspaceSubject: WorkspaceSubject
  onOpenChange: (open: boolean) => void
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) {
    return '-'
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function AdminMarketSamplePreviewDialog({
  itemId,
  itemTitle,
  open,
  workspaceSubject,
  onOpenChange,
}: AdminMarketSamplePreviewDialogProps) {
  const [pages, setPages] = useState<SamplePagePreview[]>([])
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selectedPage = pages.find((page) => page.pageNumber === selectedPageNumber) ?? pages[0] ?? null

  const loadSamplePages = useCallback(async () => {
    if (!itemId) {
      setPages([])
      setSelectedPageNumber(null)
      return
    }

    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch(
        withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/sample-pages`, workspaceSubject),
        { cache: 'no-store' }
      )
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '샘플 JPG를 불러오지 못했습니다.')
      }

      const nextPages = (payload.pages ?? []) as SamplePagePreview[]
      setPages(nextPages)
      setSelectedPageNumber(nextPages[0]?.pageNumber ?? null)
    } catch (error) {
      setPages([])
      setSelectedPageNumber(null)
      setErrorMessage(error instanceof Error ? error.message : '샘플 JPG를 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [itemId, workspaceSubject])

  useEffect(() => {
    if (!open) {
      return
    }

    void loadSamplePages()
  }, [open, loadSamplePages])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>샘플 JPG 확인</DialogTitle>
          <DialogDescription>
            [{itemTitle}] 판매용 PDF에서 자동 생성된 첫 1~3페이지 JPG 샘플입니다.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div role="status" aria-live="polite" className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-sm text-gray-500">
            <Loader2 className="mb-3 h-6 w-6 animate-spin" />
            샘플 이미지를 불러오는 중입니다.
          </div>
        ) : errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium">샘플 JPG를 불러오지 못했습니다.</p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        ) : pages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
            생성된 샘플 JPG가 없습니다. PDF를 다시 업로드해 샘플을 재생성하세요.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[160px,minmax(0,1fr)]">
            <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {pages.map((page) => (
                <button
                  key={page.pageNumber}
                  type="button"
                  aria-pressed={selectedPageNumber === page.pageNumber}
                  aria-label={`샘플 페이지 ${page.pageNumber} 보기`}
                  onClick={() => setSelectedPageNumber(page.pageNumber)}
                  className={`rounded-lg border p-2 text-left text-xs transition ${
                    selectedPageNumber === page.pageNumber
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'hover:border-primary/50'
                  }`}
                >
                  <img
                    src={page.signedUrl}
                    alt={`샘플 페이지 ${page.pageNumber}`}
                    className="aspect-[3/4] w-28 rounded bg-gray-100 object-cover lg:w-full"
                    loading={page.pageNumber === 1 ? 'eager' : 'lazy'}
                  />
                  <span className="mt-2 block font-medium">{page.pageNumber}p</span>
                  <span className="block text-gray-500">{formatFileSize(page.fileSizeBytes)}</span>
                </button>
              ))}
            </div>

            {selectedPage ? (
              <figure className="rounded-lg border bg-gray-50 p-3">
                <img
                  src={selectedPage.signedUrl}
                  alt={`샘플 페이지 ${selectedPage.pageNumber}`}
                  width={selectedPage.widthPx ?? undefined}
                  height={selectedPage.heightPx ?? undefined}
                  className="mx-auto max-h-[68vh] w-auto rounded bg-white object-contain shadow-sm"
                />
                <figcaption className="mt-3 text-center text-sm text-gray-600">
                  샘플 페이지 {selectedPage.pageNumber} · {formatFileSize(selectedPage.fileSizeBytes)}
                </figcaption>
              </figure>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void loadSamplePages()} disabled={isLoading || !itemId}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            다시 불러오기
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
