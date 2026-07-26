'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'
import { StudioDialogContent } from '@/components/design-system'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface MarketSamplePreviewDialogProps {
  itemId: string
  workspaceSubject: WorkspaceSubject
  open: boolean
  prefetchKey: number
  onOpenChange: (open: boolean) => void
  returnFocusRef?: RefObject<HTMLButtonElement | null>
}

interface SamplePage {
  id: string
  pageNumber: number
  originalFileName: string | null
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
const SAMPLE_PAGE_GENERATED_FILE_NAME_SUFFIX_PATTERN = /-sample-page-\d+\.jpe?g$/i
const SAMPLE_FILE_GROUP_STYLES = [
  {
    barClassName: 'border-l-4 border-l-amber-400',
    labelClassName: 'border-amber-200 bg-amber-50 text-amber-900',
    badgeClassName: 'bg-amber-100 text-amber-950',
  },
  {
    barClassName: 'border-l-4 border-l-sky-400',
    labelClassName: 'border-sky-200 bg-sky-50 text-sky-900',
    badgeClassName: 'bg-sky-200 text-sky-950',
  },
  {
    barClassName: 'border-l-4 border-l-emerald-400',
    labelClassName: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    badgeClassName: 'bg-emerald-200 text-emerald-950',
  },
  {
    barClassName: 'border-l-4 border-l-violet-400',
    labelClassName: 'border-violet-200 bg-violet-50 text-violet-900',
    badgeClassName: 'bg-violet-200 text-violet-950',
  },
  {
    barClassName: 'border-l-4 border-l-rose-400',
    labelClassName: 'border-rose-200 bg-rose-50 text-rose-900',
    badgeClassName: 'bg-rose-200 text-rose-950',
  },
  {
    barClassName: 'border-l-4 border-l-cyan-400',
    labelClassName: 'border-cyan-200 bg-cyan-50 text-cyan-900',
    badgeClassName: 'bg-cyan-200 text-cyan-950',
  },
] as const
const samplePagePreviewCache = new Map<string, CachedSamplePages>()
const samplePagePreviewRequests = new Map<string, Promise<SamplePage[]>>()

interface SampleFileGroupMeta {
  groupNumber: number
  styleIndex: number
}

function buildSamplePageCacheKey(itemId: string, workspaceSubject: WorkspaceSubject) {
  return `${workspaceSubject}:${itemId}`
}

function getSampleSourceDisplayFileName(originalFileName?: string | null) {
  const displayFileName = originalFileName
    ?.replace(SAMPLE_PAGE_GENERATED_FILE_NAME_SUFFIX_PATTERN, '')
    .trim()
  return displayFileName || null
}

function getSampleFileGroupStyle(styleIndex: number) {
  return SAMPLE_FILE_GROUP_STYLES[styleIndex % SAMPLE_FILE_GROUP_STYLES.length]
}

function buildSampleFileGroupMeta(pages: SamplePage[]) {
  const sampleFileGroupMetaByName = new Map<string, SampleFileGroupMeta>()
  for (const page of pages) {
    const displayFileName = getSampleSourceDisplayFileName(page.originalFileName)
    if (!displayFileName || sampleFileGroupMetaByName.has(displayFileName)) {
      continue
    }

    const groupNumber = sampleFileGroupMetaByName.size + 1
    sampleFileGroupMetaByName.set(displayFileName, {
      groupNumber,
      styleIndex: groupNumber - 1,
    })
  }

  return sampleFileGroupMetaByName
}

function formatSamplePageLabel(page: Pick<SamplePage, 'originalFileName' | 'pageNumber'>) {
  const displayFileName = getSampleSourceDisplayFileName(page.originalFileName)
  return displayFileName
    ? `'${displayFileName}' 샘플 페이지 ${page.pageNumber}`
    : `샘플 페이지 ${page.pageNumber}`
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
  returnFocusRef,
}: MarketSamplePreviewDialogProps) {
  const [pages, setPages] = useState<SamplePage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const sampleFileGroupMetaByName = buildSampleFileGroupMeta(pages)

  const handleCloseAutoFocus = (event: Event) => {
    if (!returnFocusRef?.current) return

    event.preventDefault()
    returnFocusRef.current.focus()
  }

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
      <StudioDialogContent
        className="max-h-[88vh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <DialogHeader className="shrink-0 border-b border-[var(--studio-border)] px-6 py-4">
          <DialogTitle>샘플 미리보기</DialogTitle>
          <DialogDescription>판매자가 등록한 샘플 JPG를 확인하세요.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-slate-500">샘플 이미지를 불러오는 중입니다...</div>
          ) : errorMessage ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
          ) : pages.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-slate-500">등록된 샘플 JPG가 없습니다.</div>
          ) : (
            <div className="space-y-4">
              {pages.map((page, index) => {
                const samplePageLabel = formatSamplePageLabel(page)
                const displayFileName = getSampleSourceDisplayFileName(page.originalFileName)
                const sampleFileGroupMeta = displayFileName ? sampleFileGroupMetaByName.get(displayFileName) : null
                const sampleFileGroupStyle = getSampleFileGroupStyle(sampleFileGroupMeta?.styleIndex ?? 0)
                return (
                  <figure key={page.id} className="overflow-hidden rounded-xl border bg-white">
                    <figcaption className={`flex flex-wrap items-center gap-2 break-words border-b px-4 py-2 text-sm font-semibold ${sampleFileGroupStyle.barClassName} ${sampleFileGroupStyle.labelClassName}`}>
                      {sampleFileGroupMeta ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sampleFileGroupStyle.badgeClassName}`}>
                          파일 {sampleFileGroupMeta.groupNumber}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 break-words">{samplePageLabel}</span>
                    </figcaption>
                    {/* eslint-disable-next-line @next/next/no-img-element -- Signed Supabase preview URLs are short-lived and not suitable for Next image optimization. */}
                    <img
                      src={page.signedUrl}
                      alt={samplePageLabel}
                      width={page.widthPx ?? undefined}
                      height={page.heightPx ?? undefined}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      fetchPriority={index === 0 ? 'high' : 'low'}
                      className="h-auto w-full"
                    />
                  </figure>
                )
              })}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-[var(--studio-border)] px-6 py-4">
          <Button
            type="button"
            variant="brandOutline"
            className="min-h-11 min-w-11"
            onClick={() => onOpenChange(false)}
          >
            닫기
          </Button>
        </DialogFooter>
      </StudioDialogContent>
    </Dialog>
  )
}
