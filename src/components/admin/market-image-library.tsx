'use client'

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { FolderPlus, ImagePlus, Loader2, Pencil, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH,
  MARKET_IMAGE_MAX_MOVE_IDS,
  MARKET_IMAGE_NAME_MAX_LENGTH,
  chunkArray,
  formatMarketImageBytes,
  type MarketImageDto,
  type MarketImageFolderDto,
  type MarketImageUsage,
} from '@/lib/market-images'
import {
  getMarketImageErrorMessage,
  jsonRequestInit,
  readLastMarketImageFolder,
  requestMarketImageJson,
  sha256HexOfBlob,
  shrinkMarketImageForUpload,
  uploadMarketImageFiles,
  writeLastMarketImageFolder,
} from '@/lib/market-images-upload'

// 'all' = 전체, 'unfiled' = 미분류, 그 외 = 폴더 id (GET /api/admin/market/images의 folderId 규칙)
type FolderFilter = string
type SortKey = 'newest' | 'oldest' | 'name'

interface LibraryImage extends MarketImageDto {
  usageCount: number
}

interface DeleteFailure {
  name: string
  message: string
  usage: MarketImageUsage | null
}

interface MarketImageLibraryProps {
  mode: 'manage' | 'select'
  selectedImageId?: string | null
  onSelect?: (image: MarketImageDto) => void
}

const REUSED_MESSAGE = '이미 등록된 이미지를 재사용했습니다'
const SORT_LABELS: Record<SortKey, string> = { newest: '최신순', oldest: '오래된순', name: '이름순' }

function getUploadFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter((file) => file.type.startsWith('image/'))
}

function usageSummary(usage: MarketImageUsage) {
  return [
    ...usage.items.map((item) => `상품 ${item.title}`),
    ...usage.categoryItems.map((item) => `카테고리 항목 ${item.title}`),
  ].join(', ')
}

export function MarketImageLibrary({ mode, selectedImageId, onSelect }: MarketImageLibraryProps) {
  const isManage = mode === 'manage'
  const [folders, setFolders] = useState<MarketImageFolderDto[]>([])
  const [unfiledCount, setUnfiledCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [folderFilter, setFolderFilter] = useState<FolderFilter | null>(null)
  const [sort, setSort] = useState<SortKey>('newest')
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [images, setImages] = useState<LibraryImage[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [totals, setTotals] = useState({ count: 0, bytes: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailOpenerRef = useRef<HTMLButtonElement | null>(null)
  const [moveTarget, setMoveTarget] = useState('unfiled')
  const [isWorking, setIsWorking] = useState(false)
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)
  const [deleteFailures, setDeleteFailures] = useState<DeleteFailure[]>([])
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [isFolderDeleteOpen, setIsFolderDeleteOpen] = useState(false)
  const [detailRevision, setDetailRevision] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)

  const currentFolder = folders.find((folder) => folder.id === folderFilter) ?? null
  // 업로드는 현재 폴더로, 전체·미분류를 보고 있으면 미분류로 올린다.
  const uploadFolderId = currentFolder?.id ?? null

  const loadFolders = useCallback(async () => {
    const { ok, result } = await requestMarketImageJson('/api/admin/market/image-folders')
    if (!ok) {
      toast.error(getMarketImageErrorMessage(result, '폴더 목록을 불러오지 못했습니다.'))
      return
    }
    const nextFolders: MarketImageFolderDto[] = result.data.folders
    setFolders(nextFolders)
    setUnfiledCount(result.data.unfiledCount)
    setTotalCount(result.data.totalCount)
    // 기억한 폴더가 삭제됐으면 전체로 돌아가고 기억도 지운다.
    const remembered = readLastMarketImageFolder()
    if (remembered && remembered !== 'all' && remembered !== 'unfiled' && !nextFolders.some((folder) => folder.id === remembered)) {
      writeLastMarketImageFolder('all')
    }
    setFolderFilter((current) => (
      current && current !== 'all' && current !== 'unfiled' && !nextFolders.some((folder) => folder.id === current)
        ? 'all'
        : current
    ))
  }, [])

  const loadImages = useCallback(async (cursor?: string) => {
    if (folderFilter === null) return
    const requestId = ++requestIdRef.current
    if (cursor) setIsLoadingMore(true)
    else setIsLoading(true)
    const params = new URLSearchParams({ sort })
    if (folderFilter !== 'all') params.set('folderId', folderFilter)
    if (query) params.set('q', query)
    if (cursor) params.set('cursor', cursor)
    try {
      const { ok, result } = await requestMarketImageJson(`/api/admin/market/images?${params}`)
      if (requestId !== requestIdRef.current) return
      if (!ok) throw new Error(getMarketImageErrorMessage(result, '이미지 목록을 불러오지 못했습니다.'))
      const items: LibraryImage[] = result.data.items
      setImages((current) => {
        if (!cursor) return items
        const loadedIds = new Set(current.map((image) => image.id))
        return [...current, ...items.filter((image) => !loadedIds.has(image.id))]
      })
      setNextCursor(result.data.nextCursor)
      setTotals(result.data.totals)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '이미지 목록을 불러오지 못했습니다.')
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    }
  }, [folderFilter, query, sort])

  const refresh = useCallback(async () => {
    setDetailRevision((current) => current + 1)
    await Promise.all([loadFolders(), loadImages()])
  }, [loadFolders, loadImages])

  useEffect(() => {
    void loadFolders()
    setFolderFilter(readLastMarketImageFolder() ?? 'all')
  }, [loadFolders])

  useEffect(() => {
    void loadImages()
  }, [loadImages])

  const chooseFolder = (folder: FolderFilter) => {
    setFolderFilter(folder)
    writeLastMarketImageFolder(folder)
    setSelectedIds(new Set())
    setRenameDraft(null)
  }

  const handleFiles = async (files: File[]) => {
    if (files.length === 0 || isUploading) return
    const targets = isManage ? files : files.slice(0, 1)
    setIsUploading(true)
    setUploadStatus(`${targets.length}개 파일을 올리는 중입니다.`)
    try {
      const outcome = await uploadMarketImageFiles(targets, uploadFolderId, { prepare: shrinkMarketImageForUpload, hash: sha256HexOfBlob })
      if (uploadFolderId) writeLastMarketImageFolder(outcome.folderFallback ? 'all' : uploadFolderId)
      const newCount = outcome.images.length - outcome.reusedCount
      if (newCount > 0) toast.success(`이미지 ${newCount}장을 등록했습니다.`)
      if (outcome.folderFallback) toast.info('폴더를 찾을 수 없어 미분류에 올렸습니다.')
      if (outcome.reusedCount > 0) toast.info(`${REUSED_MESSAGE} (${outcome.reusedCount}장)`)
      for (const failure of outcome.failures) toast.error(`${failure.name}: ${failure.error}`)
      setUploadStatus(`등록 ${newCount}장, 재사용 ${outcome.reusedCount}장, 실패 ${outcome.failures.length}장`)
      if (!isManage && outcome.images[0]) onSelect?.(outcome.images[0])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '이미지를 업로드하지 못했습니다.')
      setUploadStatus('업로드에 실패했습니다.')
    } finally {
      setIsUploading(false)
      await refresh()
    }
  }

  const handleFilesRef = useRef(handleFiles)
  useEffect(() => {
    handleFilesRef.current = handleFiles
  })

  const isFailureDialogOpenRef = useRef(false)
  useEffect(() => {
    isFailureDialogOpenRef.current = deleteFailures.length > 0
  }, [deleteFailures])

  // G5: 클립보드 이미지 붙여넣기. 입력 칸·확인 창 안이거나 표 셀(엑셀·워드)을 복사한 경우는 브라우저 기본 동작에 맡긴다.
  // Finder 이미지 복사도 text/plain(파일 이름)을 함께 담으므로 text/plain만으로는 건너뛰지 않는다.
  // 라이브러리가 화면에 있는 동안 드롭 영역 밖에 파일을 놓아도 브라우저가 파일을 열지 않게 막는다.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [role="alertdialog"]') || (target instanceof HTMLElement && target.isContentEditable)) return
      if (isFailureDialogOpenRef.current || /<table/i.test(event.clipboardData?.getData('text/html') ?? '')) return
      const files = getUploadFiles(event.clipboardData?.files)
      if (files.length === 0) return
      event.preventDefault()
      void handleFilesRef.current(files)
    }
    const blockFileDrop = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    document.addEventListener('paste', onPaste)
    document.addEventListener('dragover', blockFileDrop)
    document.addEventListener('drop', blockFileDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('dragover', blockFileDrop)
      document.removeEventListener('drop', blockFileDrop)
    }
  }, [])

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    void handleFiles(getUploadFiles(event.dataTransfer.files))
  }

  // xl 미만에서는 패널을 열 때 포커스를 옮겼으므로 닫으면 연 이미지로 돌려준다.
  const closeDetail = () => {
    setDetailId(null)
    const opener = detailOpenerRef.current
    if (opener && !window.matchMedia('(min-width: 1280px)').matches) {
      requestAnimationFrame(() => opener.focus())
    }
  }

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const moveImages = async (imageIds: string[], folderId: string | null) => {
    setIsWorking(true)
    let movedCount = 0
    for (const chunk of chunkArray(imageIds, MARKET_IMAGE_MAX_MOVE_IDS)) {
      const { ok, result } = await requestMarketImageJson('/api/admin/market/images/move', jsonRequestInit('POST', { imageIds: chunk, folderId }))
      if (!ok) {
        toast.error(getMarketImageErrorMessage(result, '이미지를 이동하지 못했습니다.'))
        break
      }
      movedCount += result.data.movedCount
    }
    if (movedCount > 0) toast.success(`이미지 ${movedCount}장을 이동했습니다.`)
    setSelectedIds(new Set())
    setIsWorking(false)
    await refresh()
  }

  const deleteImages = async (targets: LibraryImage[]) => {
    setIsWorking(true)
    const failures: DeleteFailure[] = []
    const deletedIds = new Set<string>()
    for (const image of targets) {
      const { ok, result } = await requestMarketImageJson(`/api/admin/market/images/${image.id}`, { method: 'DELETE' })
      if (ok) {
        deletedIds.add(image.id)
        continue
      }
      const error = result?.error
      failures.push({
        name: image.displayName,
        message: getMarketImageErrorMessage(result, '이미지를 삭제하지 못했습니다.'),
        usage: error?.code === 'IN_USE' ? { items: error.items ?? [], categoryItems: error.categoryItems ?? [] } : null,
      })
    }
    if (deletedIds.size > 0) toast.success(`이미지 ${deletedIds.size}장을 삭제했습니다.`)
    setDeleteFailures(failures)
    setSelectedIds(new Set())
    if (detailId && deletedIds.has(detailId)) setDetailId(null)
    setIsWorking(false)
    await refresh()
  }

  const createFolder = async () => {
    const name = (newFolderName ?? '').trim()
    if (!name) {
      toast.error('폴더 이름을 입력해주세요.')
      return
    }
    setIsWorking(true)
    const { ok, result } = await requestMarketImageJson('/api/admin/market/image-folders', jsonRequestInit('POST', { name }))
    setIsWorking(false)
    if (!ok) {
      toast.error(getMarketImageErrorMessage(result, '폴더를 만들지 못했습니다.'))
      return
    }
    setNewFolderName(null)
    await loadFolders()
    chooseFolder(result.data.id)
  }

  const renameFolder = async () => {
    if (!currentFolder || renameDraft === null) return
    setIsWorking(true)
    const { ok, result } = await requestMarketImageJson(
      `/api/admin/market/image-folders/${currentFolder.id}`,
      jsonRequestInit('PATCH', { name: renameDraft.trim() }),
    )
    setIsWorking(false)
    if (!ok) {
      toast.error(getMarketImageErrorMessage(result, '폴더 이름을 바꾸지 못했습니다.'))
      return
    }
    setRenameDraft(null)
    await loadFolders()
  }

  const deleteFolder = async () => {
    if (!currentFolder) return
    setIsWorking(true)
    const { ok, result } = await requestMarketImageJson(`/api/admin/market/image-folders/${currentFolder.id}`, { method: 'DELETE' })
    setIsWorking(false)
    if (!ok) {
      toast.error(getMarketImageErrorMessage(result, '폴더를 삭제하지 못했습니다.'))
      await loadFolders()
      return
    }
    toast.success('폴더를 삭제했습니다.')
    chooseFolder('all')
    await loadFolders()
  }

  const selectedImages = images.filter((image) => selectedIds.has(image.id))
  const folderButtons: { value: FolderFilter; label: string; count: number }[] = [
    { value: 'all', label: '전체', count: totalCount },
    { value: 'unfiled', label: '미분류', count: unfiledCount },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name, count: folder.imageCount })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        총 {totals.count}장 · {formatMarketImageBytes(totals.bytes)}
      </p>

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 lg:w-56" aria-label="이미지 폴더">
          <nav>
            <ul className="flex flex-col gap-1">
              {folderButtons.map((folder) => (
                <li key={folder.value}>
                  <button
                    type="button"
                    aria-current={folderFilter === folder.value ? 'true' : undefined}
                    onClick={() => chooseFolder(folder.value)}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${folderFilter === folder.value ? 'bg-muted font-semibold' : ''}`}
                  >
                    <span className="truncate">{folder.label}</span>
                    <span className="text-xs text-muted-foreground">{folder.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {isManage ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              {newFolderName === null ? (
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setNewFolderName('')}>
                  <FolderPlus aria-hidden="true" />
                  새 폴더
                </Button>
              ) : (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void createFolder()
                  }}
                >
                  <Label htmlFor="market-image-new-folder">새 폴더 이름</Label>
                  <Input
                    id="market-image-new-folder"
                    className="min-h-11"
                    value={newFolderName}
                    maxLength={MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH}
                    autoFocus
                    onChange={(event) => setNewFolderName(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" className="min-h-11 flex-1" disabled={isWorking}>만들기</Button>
                    <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setNewFolderName(null)}>취소</Button>
                  </div>
                </form>
              )}

              {currentFolder ? (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <p className="text-sm font-medium">&apos;{currentFolder.name}&apos; 폴더</p>
                  {renameDraft === null ? (
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => setRenameDraft(currentFolder.name)}>
                      <Pencil aria-hidden="true" />
                      이름 변경
                    </Button>
                  ) : (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void renameFolder()
                      }}
                    >
                      <Label htmlFor="market-image-rename-folder">폴더 이름</Label>
                      <Input
                        id="market-image-rename-folder"
                        className="min-h-11"
                        value={renameDraft}
                        maxLength={MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH}
                        autoFocus
                        onChange={(event) => setRenameDraft(event.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" className="min-h-11 flex-1" disabled={isWorking}>저장</Button>
                        <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setRenameDraft(null)}>취소</Button>
                      </div>
                    </form>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={isWorking || currentFolder.imageCount > 0}
                    aria-describedby={currentFolder.imageCount > 0 ? 'market-image-folder-delete-reason' : undefined}
                    onClick={() => setIsFolderDeleteOpen(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    폴더 삭제
                  </Button>
                  {currentFolder.imageCount > 0 ? (
                    <p id="market-image-folder-delete-reason" className="text-xs text-muted-foreground">
                      이미지 {currentFolder.imageCount}장이 남아 있어 삭제할 수 없습니다. 이미지를 이동하거나 삭제한 뒤 다시 시도하세요.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-4" aria-label="이미지 목록">
          <div
            role="region"
            aria-label="이미지 업로드"
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm ${isDragging ? 'border-primary bg-muted' : ''}`}
          >
            <p className="text-muted-foreground">
              {isManage ? '이미지를 끌어다 놓거나 붙여넣으세요.' : '새 이미지를 끌어다 놓거나 붙여넣으면 바로 선택됩니다.'}
              {' '}PNG·JPG·WebP, {currentFolder ? `'${currentFolder.name}'` : '미분류'} 폴더에 올립니다.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple={isManage}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                void handleFiles(getUploadFiles(event.target.files))
                event.target.value = ''
              }}
            />
            <Button type="button" className="min-h-11" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
              {isUploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
              {isManage ? '파일 선택' : '새로 업로드'}
            </Button>
            <p className="sr-only" aria-live="polite">{uploadStatus}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <form
              className="flex flex-1 gap-2"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                setQuery(queryDraft.trim())
                setSelectedIds(new Set())
              }}
            >
              <Label htmlFor={`market-image-search-${mode}`} className="sr-only">이미지 이름 검색</Label>
              <Input
                id={`market-image-search-${mode}`}
                className="min-h-11"
                placeholder="이미지 이름 검색"
                value={queryDraft}
                maxLength={MARKET_IMAGE_NAME_MAX_LENGTH}
                onChange={(event) => setQueryDraft(event.target.value)}
              />
              <Button type="submit" variant="outline" className="min-h-11" aria-label="검색">
                <Search aria-hidden="true" />
              </Button>
            </form>
            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(value as SortKey)
                setSelectedIds(new Set())
              }}
            >
              <SelectTrigger className="min-h-11 sm:w-36" aria-label="정렬">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isManage && selectedIds.size > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/50 p-3 sm:flex-row sm:flex-wrap sm:items-center">
              <p className="text-sm font-medium">{selectedIds.size}장 선택</p>
              <Select value={moveTarget} onValueChange={setMoveTarget}>
                <SelectTrigger className="min-h-11 sm:w-48" aria-label="이동할 폴더">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unfiled">미분류</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={isWorking}
                onClick={() => void moveImages([...selectedIds], moveTarget === 'unfiled' ? null : moveTarget)}
              >
                폴더로 이동
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={isWorking} onClick={() => setIsBulkDeleteOpen(true)}>
                <Trash2 aria-hidden="true" />
                삭제
              </Button>
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSelectedIds(new Set())}>
                선택 해제
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-4 xl:flex-row">
            <div className="min-w-0 flex-1">
              {isLoading ? (
                <p className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</p>
              ) : images.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {query ? '검색 결과가 없습니다.' : '이미지가 없습니다. 위에서 이미지를 올려주세요.'}
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {images.map((image) => {
                    const isActive = isManage ? image.id === detailId : image.id === selectedImageId
                    return (
                      <li key={image.id} className={`relative flex flex-col overflow-hidden rounded-lg border bg-background ${isActive ? 'ring-2 ring-primary' : ''}`}>
                        <button
                          type="button"
                          aria-pressed={isManage ? undefined : isActive}
                          aria-label={isManage ? `${image.displayName} 상세 보기` : `${image.displayName} 선택`}
                          onClick={(event) => {
                            if (!isManage) {
                              onSelect?.(image)
                              return
                            }
                            detailOpenerRef.current = event.currentTarget
                            setDetailId(image.id)
                          }}
                          className="flex flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <span className="flex aspect-square items-center justify-center bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element -- market-images 공개 버킷 URL을 그대로 보여 준다. */}
                            <img src={image.publicUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                          </span>
                          <span className="flex flex-col gap-1 p-2">
                            <span className="truncate text-sm font-medium">{image.displayName}</span>
                            <span className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
                              <span>{formatMarketImageBytes(image.bytes)}</span>
                              <Badge variant={image.usageCount > 0 ? 'secondary' : 'outline'}>사용 {image.usageCount}</Badge>
                            </span>
                          </span>
                        </button>
                        {isManage ? (
                          <label className="absolute left-1 top-1 flex size-11 cursor-pointer items-center justify-center">
                            <Checkbox
                              checked={selectedIds.has(image.id)}
                              onCheckedChange={(checked) => toggleSelected(image.id, checked === true)}
                              aria-label={`${image.displayName} 선택`}
                              className="bg-background"
                            />
                          </label>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
              {nextCursor && !isLoading ? (
                <div className="mt-4 flex justify-center">
                  <Button type="button" variant="outline" className="min-h-11" disabled={isLoadingMore} onClick={() => void loadImages(nextCursor)}>
                    {isLoadingMore ? '불러오는 중…' : '더 보기'}
                  </Button>
                </div>
              ) : null}
            </div>

            {isManage && detailId ? (
              <MarketImageDetailPanel
                key={detailId}
                imageId={detailId}
                revision={detailRevision}
                folders={folders}
                onClose={closeDetail}
                onChanged={refresh}
                onDelete={(image) => void deleteImages([image])}
                isWorking={isWorking}
              />
            ) : null}
          </div>
        </section>
      </div>

      <AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이미지 {selectedImages.length}장을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              사용 중인 이미지는 삭제되지 않고 사유를 알려 드립니다. 삭제한 이미지는 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">취소</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void deleteImages(selectedImages)}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isFolderDeleteOpen} onOpenChange={setIsFolderDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>&apos;{currentFolder?.name}&apos; 폴더를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>비어 있는 폴더만 삭제됩니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">취소</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void deleteFolder()}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={deleteFailures.length > 0} onOpenChange={(open) => (open ? null : setDeleteFailures([]))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>삭제하지 못한 이미지 {deleteFailures.length}장</DialogTitle>
            <DialogDescription>사용 중인 이미지는 상품·카테고리 항목에서 먼저 바꾼 뒤 삭제하세요.</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-3 text-sm">
            {deleteFailures.map((failure, index) => (
              <li key={`${failure.name}-${index}`} className="rounded-md border p-3">
                <p className="font-medium">{failure.name}</p>
                <p className="text-muted-foreground">{failure.message}</p>
                {failure.usage ? <p className="mt-1">사용처: {usageSummary(failure.usage)}</p> : null}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" className="min-h-11" onClick={() => setDeleteFailures([])}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface MarketImageDetailPanelProps {
  imageId: string
  // 목록을 다시 읽을 때마다 올라가 상세도 다시 읽는다(일괄 이동 등).
  revision: number
  folders: MarketImageFolderDto[]
  isWorking: boolean
  onClose: () => void
  onChanged: () => Promise<void>
  onDelete: (image: LibraryImage) => void
}

function MarketImageDetailPanel({ imageId, revision, folders, isWorking, onClose, onChanged, onDelete }: MarketImageDetailPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [image, setImage] = useState<MarketImageDto | null>(null)
  const [usage, setUsage] = useState<MarketImageUsage | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [folderDraft, setFolderDraft] = useState('unfiled')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  // 다시 읽을 때 서버 값이 바뀐 항목만 입력값을 덮어써 편집 중인 내용을 지킨다.
  const serverValuesRef = useRef<{ name: string; folder: string } | null>(null)

  useEffect(() => {
    let isCurrent = true
    void (async () => {
      const { ok, result } = await requestMarketImageJson(`/api/admin/market/images/${imageId}`)
      if (!isCurrent) return
      if (!ok) {
        toast.error(getMarketImageErrorMessage(result, '이미지 정보를 불러오지 못했습니다.'))
        return
      }
      setImage(result.data.image)
      setUsage(result.data.usage)
      const name: string = result.data.image.displayName
      const folder: string = result.data.image.folderId ?? 'unfiled'
      if (serverValuesRef.current?.name !== name) setNameDraft(name)
      if (serverValuesRef.current?.folder !== folder) setFolderDraft(folder)
      serverValuesRef.current = { name, folder }
    })()
    return () => {
      isCurrent = false
    }
  }, [imageId, revision])

  // xl 미만에서는 패널이 목록 아래에 놓이므로 열 때 패널로 이동한다.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1280px)').matches) return
    headingRef.current?.scrollIntoView({ block: 'start' })
    headingRef.current?.focus()
  }, [])

  const patch = async (body: { displayName?: string; folderId?: string | null }, successMessage: string) => {
    setIsSaving(true)
    const { ok, result } = await requestMarketImageJson(`/api/admin/market/images/${imageId}`, jsonRequestInit('PATCH', body))
    setIsSaving(false)
    if (!ok) {
      toast.error(getMarketImageErrorMessage(result, '이미지를 수정하지 못했습니다.'))
      return
    }
    setImage(result.data)
    toast.success(successMessage)
    await onChanged()
  }

  const usageCount = (usage?.items.length ?? 0) + (usage?.categoryItems.length ?? 0)

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-lg border p-4 xl:w-80" aria-label="이미지 상세">
      <div className="flex items-center justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold focus-visible:outline-none">이미지 상세</h2>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>닫기</Button>
      </div>
      {!image || !usage ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : (
        <>
          <div className="flex aspect-square items-center justify-center rounded-md bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- market-images 공개 버킷 URL을 그대로 보여 준다. */}
            <img src={image.publicUrl} alt={image.displayName} className="h-full w-full object-contain" />
          </div>
          <p className="text-xs text-muted-foreground">
            {image.width}×{image.height} · {formatMarketImageBytes(image.bytes)}
          </p>

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void patch({ displayName: nameDraft.trim() }, '이름을 바꿨습니다.')
            }}
          >
            <Label htmlFor="market-image-detail-name">이름</Label>
            <Input
              id="market-image-detail-name"
              className="min-h-11"
              value={nameDraft}
              maxLength={MARKET_IMAGE_NAME_MAX_LENGTH}
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <Button type="submit" variant="outline" className="min-h-11" disabled={isSaving || !nameDraft.trim() || nameDraft.trim() === image.displayName}>
              이름 저장
            </Button>
          </form>

          <div className="flex flex-col gap-2">
            <Label htmlFor="market-image-detail-folder">폴더</Label>
            <Select value={folderDraft} onValueChange={setFolderDraft}>
              <SelectTrigger id="market-image-detail-folder" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unfiled">미분류</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={isSaving || folderDraft === (image.folderId ?? 'unfiled')}
              onClick={() => void patch({ folderId: folderDraft === 'unfiled' ? null : folderDraft }, '폴더를 옮겼습니다.')}
            >
              폴더 이동
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">사용처 {usageCount}곳</h3>
            {usageCount === 0 ? (
              <p className="text-sm text-muted-foreground">사용하는 상품·카테고리 항목이 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {usage.items.map((item) => <li key={`item-${item.id}`}>상품 · {item.title}</li>)}
                {usage.categoryItems.map((item) => <li key={`category-${item.id}`}>카테고리 항목 · {item.title}</li>)}
              </ul>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={isWorking || usageCount > 0}
            aria-describedby={usageCount > 0 ? 'market-image-detail-delete-reason' : undefined}
            onClick={() => setIsDeleteOpen(true)}
          >
            <Trash2 aria-hidden="true" />
            이미지 삭제
          </Button>
          {usageCount > 0 ? (
            <p id="market-image-detail-delete-reason" className="text-xs text-muted-foreground">
              사용 중인 이미지는 삭제할 수 없습니다. 위 사용처에서 이미지를 먼저 바꾸세요.
            </p>
          ) : null}

          <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>&apos;{image.displayName}&apos; 이미지를 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>삭제한 이미지는 되돌릴 수 없습니다.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">취소</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" onClick={() => onDelete({ ...image, usageCount })}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </aside>
  )
}
