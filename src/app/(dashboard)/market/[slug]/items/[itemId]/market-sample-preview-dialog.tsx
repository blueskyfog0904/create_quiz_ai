'use client'

import { useCallback, useEffect, useState } from 'react'
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
  prefetchKey: number
  onOpenChange: (open: boolean) => void
}

interface SamplePage {
  id: string
  pageNumber: number
  signedUrl: string
  fileSizeBytes: number | null
  widthPx: number | null
  heightPx: number | null
}

interface SamplePagesPayload {
  success?: boolean
  pages?: SamplePage[]
  expiresAt?: string
  error?: { message?: string }
}

interface CachedSamplePages {
  pages: SamplePage[]
  expiresAt: number
}

const SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS = 30 * 1000
const samplePagePreviewCache = new Map<string, CachedSamplePages>()
const samplePagePreviewRequests = new Map<string, Promise<SamplePage[]>>()

function buildSamplePageCacheKey(itemId: string, workspaceSubject: WorkspaceSubject) {
  return `${workspaceSubject}:${itemId}`
}

function getCachedSamplePages(cacheKey: string) {
  const cached = samplePagePreviewCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt - Date.now() <= SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS) {
    samplePagePreviewCache.delete(cacheKey)
    return null
  }
  return cached.pages
}

async function fetchSamplePages(itemId: string, workspaceSubject: WorkspaceSubject, cacheKey: string) {
  const existingRequest = samplePagePreviewRequests.get(cacheKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const response = await fetch(`/api/market/items/${itemId}/sample-pages?subject=${workspaceSubject}`, {
      cache: 'no-store',
    })
    const payload: SamplePagesPayload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '샘플 미리보기를 불러오지 못했습니다.')
    }

    const nextPages = payload.pages ?? []
    if (payload.expiresAt) {
      samplePagePreviewCache.set(cacheKey, {
        pages: nextPages,
        expiresAt: new Date(payload.expiresAt).getTime(),
      })
    }
    return nextPages
  })().finally(() => {
    samplePagePreviewRequests.delete(cacheKey)
  })

  samplePagePreviewRequests.set(cacheKey, request)
  return request
}

export default function MarketSamplePreviewDialog({
  itemId,
  workspaceSubject,
  open,
  prefetchKey,
  onOpenChange,
}: MarketSamplePreviewDialogProps) {
  const [pages, setPages] = useState<SamplePage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadSamplePages = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const cacheKey = buildSamplePageCacheKey(itemId, workspaceSubject)
    const cachedPages = getCachedSamplePages(cacheKey)
    if (cachedPages) {
      setPages(cachedPages)
      setErrorMessage(null)
      return
    }

    if (!silent) {
      setIsLoading(true)
    }
    setErrorMessage(null)

    try {
      const nextPages = await fetchSamplePages(itemId, workspaceSubject, cacheKey)
      setPages(nextPages)
    } catch (error) {
      if (!silent) {
        setPages([])
        setErrorMessage(error instanceof Error ? error.message : '샘플 미리보기를 불러오지 못했습니다.')
      }
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }, [itemId, workspaceSubject])

  useEffect(() => {
    if (!open) {
      return
    }

    void loadSamplePages()
  }, [loadSamplePages, open])

  useEffect(() => {
    if (prefetchKey <= 0 || open) {
      return
    }

    void loadSamplePages({ silent: true })
  }, [loadSamplePages, open, prefetchKey])

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
            {pages.map((page, index) => (
              <figure key={page.id} className="overflow-hidden rounded-xl border bg-white">
                <figcaption className="border-b bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                  샘플 페이지 {page.pageNumber}
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element -- Signed Supabase preview URLs are short-lived and not suitable for Next image optimization. */}
                <img
                  src={page.signedUrl}
                  alt={`샘플 페이지 ${page.pageNumber}`}
                  width={page.widthPx ?? undefined}
                  height={page.heightPx ?? undefined}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={index === 0 ? 'high' : 'low'}
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
