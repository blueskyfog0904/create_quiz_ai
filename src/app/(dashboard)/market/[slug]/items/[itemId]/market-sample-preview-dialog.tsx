'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface MarketSamplePreviewDialogProps {
  itemId: string
  workspaceSubject: WorkspaceSubject
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SamplePage {
  pageNumber: number
  signedUrl: string
  widthPx: number | null
  heightPx: number | null
}

export default function MarketSamplePreviewDialog({
  itemId,
  workspaceSubject,
  open,
  onOpenChange,
}: MarketSamplePreviewDialogProps) {
  const [pages, setPages] = useState<SamplePage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    let isMounted = true

    const loadSamplePages = async () => {
      setIsLoading(true)
      setErrorMessage(null)
      try {
        const response = await fetch(`/api/market/items/${itemId}/sample-pages?subject=${workspaceSubject}`, {
          cache: 'no-store',
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || '샘플 미리보기를 불러오지 못했습니다.')
        }

        if (isMounted) {
          setPages(payload.pages ?? [])
        }
      } catch (error) {
        if (isMounted) {
          setPages([])
          setErrorMessage(error instanceof Error ? error.message : '샘플 미리보기를 불러오지 못했습니다.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSamplePages()

    return () => {
      isMounted = false
    }
  }, [itemId, open, workspaceSubject])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>샘플 미리보기</DialogTitle>
          <DialogDescription>판매용 PDF의 첫 1~3페이지 JPG 샘플을 확인하세요.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="rounded-xl border border-dashed py-10 text-center text-sm text-slate-500">샘플 이미지를 불러오는 중입니다...</div>
        ) : errorMessage ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
        ) : pages.length === 0 ? (
          <div className="rounded-xl border border-dashed py-10 text-center text-sm text-slate-500">등록된 샘플 JPG가 없습니다.</div>
        ) : (
          <div className="space-y-4">
            {pages.map((page) => (
              <figure key={page.pageNumber} className="overflow-hidden rounded-xl border bg-white">
                <figcaption className="border-b bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                  샘플 페이지 {page.pageNumber}
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element -- Signed Supabase preview URLs are short-lived and not suitable for Next image optimization. */}
                <img
                  src={page.signedUrl}
                  alt={`샘플 페이지 ${page.pageNumber}`}
                  width={page.widthPx ?? undefined}
                  height={page.heightPx ?? undefined}
                  className="h-auto w-full"
                />
              </figure>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
