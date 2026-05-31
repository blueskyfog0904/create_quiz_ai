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
  id: string
  pageNumber: number
  originalFileName: string | null
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

interface SampleFileGroupMeta {
  groupNumber: number
  styleIndex: number
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

function getSampleSourceDisplayFileName(originalFileName?: string | null) {
  const displayFileName = originalFileName
    ?.replace(SAMPLE_PAGE_GENERATED_FILE_NAME_SUFFIX_PATTERN, '')
    .trim()
  return displayFileName || null
}

function getSampleFileGroupStyle(styleIndex: number) {
  return SAMPLE_FILE_GROUP_STYLES[styleIndex % SAMPLE_FILE_GROUP_STYLES.length]
}

function buildSampleFileGroupMeta(pages: SamplePagePreview[]) {
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

function formatSamplePageLabel(page: Pick<SamplePagePreview, 'originalFileName' | 'pageNumber'>) {
  const displayFileName = getSampleSourceDisplayFileName(page.originalFileName)
  return displayFileName
    ? `'${displayFileName}' 샘플 페이지 ${page.pageNumber}`
    : `샘플 페이지 ${page.pageNumber}`
}

export default function AdminMarketSamplePreviewDialog({
  itemId,
  itemTitle,
  open,
  workspaceSubject,
  onOpenChange,
}: AdminMarketSamplePreviewDialogProps) {
  const [pages, setPages] = useState<SamplePagePreview[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null
  const sampleFileGroupMetaByName = buildSampleFileGroupMeta(pages)
  const selectedDisplayFileName = selectedPage ? getSampleSourceDisplayFileName(selectedPage.originalFileName) : null
  const selectedSampleFileGroupMeta = selectedDisplayFileName ? sampleFileGroupMetaByName.get(selectedDisplayFileName) : null
  const selectedSampleFileGroupStyle = getSampleFileGroupStyle(selectedSampleFileGroupMeta?.styleIndex ?? 0)

  const loadSamplePages = useCallback(async () => {
    if (!itemId) {
      setPages([])
      setSelectedPageId(null)
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
      setSelectedPageId(nextPages[0]?.id ?? null)
    } catch (error) {
      setPages([])
      setSelectedPageId(null)
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
            [{itemTitle}] 등록된 샘플 JPG를 파일명과 페이지 번호로 확인하세요.
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
              {pages.map((page) => {
                const samplePageLabel = formatSamplePageLabel(page)
                const displayFileName = getSampleSourceDisplayFileName(page.originalFileName)
                const sampleFileGroupMeta = displayFileName ? sampleFileGroupMetaByName.get(displayFileName) : null
                const sampleFileGroupStyle = getSampleFileGroupStyle(sampleFileGroupMeta?.styleIndex ?? 0)
                return (
                  <button
                    key={page.id}
                    type="button"
                    aria-pressed={selectedPageId === page.id}
                    aria-label={`${samplePageLabel} 보기`}
                    onClick={() => setSelectedPageId(page.id)}
                    className={`rounded-lg border p-2 text-left text-xs transition ${
                      selectedPageId === page.id
                        ? 'border-primary ring-2 ring-primary/40'
                        : 'hover:border-primary/50'
                    }`}
                  >
                    <img
                      src={page.signedUrl}
                      alt={samplePageLabel}
                      className="aspect-[3/4] w-28 rounded bg-gray-100 object-cover lg:w-full"
                      loading={page.pageNumber === 1 ? 'eager' : 'lazy'}
                    />
                    <span className={`mt-2 flex flex-wrap items-center gap-1 break-words rounded-md border px-2 py-1 font-semibold ${sampleFileGroupStyle.barClassName} ${sampleFileGroupStyle.labelClassName}`}>
                      {sampleFileGroupMeta ? (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${sampleFileGroupStyle.badgeClassName}`}>
                          파일 {sampleFileGroupMeta.groupNumber}
                        </span>
                      ) : null}
                      <span className="min-w-0 break-words">{samplePageLabel}</span>
                    </span>
                    <span className="block text-gray-500">{formatFileSize(page.fileSizeBytes)}</span>
                  </button>
                )
              })}
            </div>

            {selectedPage ? (
              <figure className="rounded-lg border bg-gray-50 p-3">
                <img
                  src={selectedPage.signedUrl}
                  alt={formatSamplePageLabel(selectedPage)}
                  width={selectedPage.widthPx ?? undefined}
                  height={selectedPage.heightPx ?? undefined}
                  className="mx-auto max-h-[68vh] w-auto rounded bg-white object-contain shadow-sm"
                />
                <figcaption className="mt-3 text-center text-sm text-gray-600">
                  <span className={`inline-flex max-w-full flex-wrap items-center justify-center gap-2 break-words rounded-full border px-3 py-1 font-semibold ${selectedSampleFileGroupStyle.barClassName} ${selectedSampleFileGroupStyle.labelClassName}`}>
                    {selectedSampleFileGroupMeta ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${selectedSampleFileGroupStyle.badgeClassName}`}>
                        파일 {selectedSampleFileGroupMeta.groupNumber}
                      </span>
                    ) : null}
                    <span className="min-w-0 break-words">{formatSamplePageLabel(selectedPage)}</span>
                  </span>
                  <span className="mt-2 block">{formatFileSize(selectedPage.fileSizeBytes)}</span>
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
