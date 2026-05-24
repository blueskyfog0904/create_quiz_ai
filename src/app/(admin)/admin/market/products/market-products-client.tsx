'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { MarketItem, MarketItemFile } from '@/lib/market-items-server'
import { LISTBOARD_GRADE_OPTIONS } from '@/lib/generate-menu'
import type { MarketMenuEntryAdminRow } from '@/lib/market-menu'
import AdminMarketSamplePreviewDialog from './admin-market-sample-preview-dialog'

interface MarketProductsClientProps {
  menuEntries: MarketMenuEntryAdminRow[]
  initialItems: MarketItem[]
  workspaceSubject: WorkspaceSubject
}

interface MarketItemFormState {
  id?: string
  menuEntryId: string
  title: string
  summary: string
  description: string
  thumbnailUrl: string
  examYear: string
  examMonth: string
  gradeLevel: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  questionCount: string
  pdfPrice: string
  hwpPrice: string
  status: 'draft' | 'published' | 'hidden' | 'archived'
  draftSource: 'manual' | 'auto_upload'
  isActive: boolean
}

const MARKET_ASSET_KINDS = ['pdf', 'hwp'] as const
type MarketUploadAssetKind = typeof MARKET_ASSET_KINDS[number]

const MARKET_STATUS_LABELS: Record<MarketItemFormState['status'], string> = {
  draft: '임시저장',
  published: '공개',
  hidden: '숨김',
  archived: '보관',
}

const MIN_EXAM_YEAR = 2000
const MAX_EXAM_YEAR = 2050
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

function buildExamYearOptions(baseYear = MAX_EXAM_YEAR) {
  return Array.from({ length: Math.max(baseYear - MIN_EXAM_YEAR + 1, 1) }, (_, index) => String(baseYear - index))
}

function getDefaultExamYear() {
  return String(new Date().getFullYear())
}

function formatCreditInputValue(value: string | number | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function parseCreditInputValue(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function buildEmptyForm(menuEntryId = ''): MarketItemFormState {
  return {
    menuEntryId,
    title: '',
    summary: '',
    description: '',
    thumbnailUrl: '',
    examYear: getDefaultExamYear(),
    examMonth: '',
    gradeLevel: '',
    sourceType: '',
    source1: '',
    source2: '',
    source3: '',
    source4: '',
    questionCount: '',
    pdfPrice: '0',
    hwpPrice: '0',
    status: 'draft',
    draftSource: 'manual',
    isActive: true,
  }
}

function buildEditForm(item: MarketItem): MarketItemFormState {
  return {
    id: item.id,
    menuEntryId: item.menu_entry_id,
    title: item.title,
    summary: item.summary || '',
    description: item.description || '',
    thumbnailUrl: item.thumbnail_url || '',
    examYear: item.exam_year ? String(item.exam_year) : '',
    examMonth: item.exam_month ? String(item.exam_month) : '',
    gradeLevel: item.grade_level || '',
    sourceType: item.source_type || '',
    source1: item.source_1 || '',
    source2: item.source_2 || '',
    source3: item.source_3 || '',
    source4: item.source_4 || '',
    questionCount: item.question_count !== null && item.question_count !== undefined ? String(item.question_count) : '',
    pdfPrice: formatCreditInputValue(item.pdf_price),
    hwpPrice: formatCreditInputValue(item.hwp_price),
    status: item.status as MarketItemFormState['status'],
    draftSource: item.draft_source === 'auto_upload' ? 'auto_upload' : 'manual',
    isActive: item.is_active,
  }
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

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ko-KR')
}

function getAssetAcceptValue(assetKind: MarketUploadAssetKind) {
  return assetKind === 'hwp' ? '.hwp' : '.pdf'
}

function isAllowedAssetFile(file: File, assetKind: MarketUploadAssetKind) {
  const fileName = file.name.toLowerCase()
  return assetKind === 'hwp'
    ? fileName.endsWith('.hwp')
    : fileName.endsWith('.pdf')
}

interface PersistFormOptions {
  preserveSelections?: boolean
  skipSuccessToast?: boolean
  targetId?: string
  draftSource?: 'manual' | 'auto_upload'
}

export default function MarketProductsClient({ menuEntries, initialItems, workspaceSubject }: MarketProductsClientProps) {
  const router = useRouter()
  const [selectedMenuEntryId, setSelectedMenuEntryId] = useState(menuEntries[0]?.id || '')
  const [items, setItems] = useState(initialItems)
  const [form, setForm] = useState<MarketItemFormState>(buildEmptyForm(menuEntries[0]?.id || ''))
  const [editingFiles, setEditingFiles] = useState<MarketItemFile[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [hidingItemId, setHidingItemId] = useState<string | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState(() => initialItems
    .filter((item) => item.status === 'hidden')
    .map((item) => item.id))
  const [requiresFinalRegistration, setRequiresFinalRegistration] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MarketItem | null>(null)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [uploadingKinds, setUploadingKinds] = useState<string[]>([])
  const [isBulkUploading, setIsBulkUploading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<MarketUploadAssetKind, File>>>({})
  const [dragActiveKinds, setDragActiveKinds] = useState<MarketUploadAssetKind[]>([])
  const fileInputRefs = useRef<Record<MarketUploadAssetKind, HTMLInputElement | null>>({
    pdf: null,
    hwp: null,
  })

  const filteredItems = useMemo(() => (
    selectedMenuEntryId
      ? items.filter((item) => item.menu_entry_id === selectedMenuEntryId)
      : items
  ), [items, selectedMenuEntryId])

  const menuTitleMap = useMemo(() => new Map(menuEntries.map((entry) => [entry.id, entry.title])), [menuEntries])
  const examYearOptions = useMemo(() => buildExamYearOptions(), [])
  const selectedAssetKinds = useMemo(
    () => MARKET_ASSET_KINDS.filter((assetKind) => Boolean(selectedFiles[assetKind])),
    [selectedFiles]
  )

  const focusCurrentExamYear = () => {
    setForm((current) => current.examYear ? current : { ...current, examYear: getDefaultExamYear() })
  }

  const resetForm = (menuEntryId = selectedMenuEntryId) => {
    setForm(buildEmptyForm(menuEntryId))
    setEditingFiles([])
    setSelectedFiles({})
    setDragActiveKinds([])
    setRequiresFinalRegistration(false)
    setIsSamplePreviewOpen(false)
    setSamplePreviewItemId(null)
  }

  const setHiddenOverride = (itemId: string, isHidden: boolean) => {
    setHiddenItemIds((current) => {
      if (isHidden) {
        return current.includes(itemId) ? current : [...current, itemId]
      }

      return current.filter((currentItemId) => currentItemId !== itemId)
    })
  }

  const refreshItems = async (menuEntryId?: string) => {
    const targetMenuEntryId = menuEntryId ?? selectedMenuEntryId
    const url = targetMenuEntryId ? `/api/admin/market/items?menuEntryId=${targetMenuEntryId}` : '/api/admin/market/items'
    const response = await fetch(withAdminWorkspaceSubject(url, workspaceSubject), { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 목록을 불러오지 못했습니다.')
    }

    if (!targetMenuEntryId) {
      setItems(payload.data)
      return
    }

    setItems((current) => {
      const otherItems = current.filter((item) => item.menu_entry_id !== targetMenuEntryId)
      return [...otherItems, ...payload.data]
    })
  }

  const fetchItemDetail = async (id: string) => {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${id}`, workspaceSubject), { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 상세를 불러오지 못했습니다.')
    }

    return payload.data as { item: MarketItem; files: MarketItemFile[] }
  }

  const loadItemDetail = async (id: string) => {
    const detail = await fetchItemDetail(id)

    setSelectedMenuEntryId(detail.item.menu_entry_id)
    setForm(buildEditForm(detail.item))
    setEditingFiles(detail.files || [])
    setSelectedFiles({})
    setDragActiveKinds([])
    setRequiresFinalRegistration(detail.item.status === 'draft' && detail.item.draft_source === 'auto_upload')
  }

  const refreshEditingFiles = async (id: string) => {
    const detail = await fetchItemDetail(id)
    setEditingFiles(detail.files || [])
  }

  const buildRequestBody = (
    statusOverride?: MarketItemFormState['status'],
    draftSource: 'manual' | 'auto_upload' = form.draftSource
  ) => ({
    menuEntryId: form.menuEntryId,
    title: form.title,
    summary: form.summary,
    description: form.description,
    thumbnailUrl: form.thumbnailUrl,
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
    status: statusOverride ?? form.status,
    draftSource,
    isActive: form.isActive,
  })

  const persistForm = async (
    statusOverride?: MarketItemFormState['status'],
    options: PersistFormOptions = {}
  ): Promise<MarketItem | null> => {
    if (!form.menuEntryId) {
      toast.error('카테고리를 선택해주세요.')
      return null
    }

    if (!form.title.trim()) {
      toast.error('상품 제목을 입력해주세요.')
      return null
    }

    setIsSaving(true)
    try {
      const targetId = options.targetId ?? form.id
      const previousMenuEntryId = targetId
        ? items.find((item) => item.id === targetId)?.menu_entry_id
        : null
      const nextStatus = statusOverride ?? form.status

      const response = await fetch(withAdminWorkspaceSubject(targetId ? `/api/admin/market/items/${targetId}` : '/api/admin/market/items', workspaceSubject), {
        method: targetId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(statusOverride, options.draftSource)),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 저장에 실패했습니다.')
      }

      setSelectedMenuEntryId(form.menuEntryId)
      await refreshItems(form.menuEntryId)
      if (previousMenuEntryId && previousMenuEntryId !== form.menuEntryId) {
        await refreshItems(previousMenuEntryId)
      }
      const detail = await fetchItemDetail(payload.data.id)
      setSelectedMenuEntryId(detail.item.menu_entry_id)
      setForm(buildEditForm(detail.item))
      setHiddenOverride(detail.item.id, detail.item.status === 'hidden')
      setEditingFiles(detail.files || [])
      if (!options.preserveSelections) {
        setSelectedFiles({})
        setDragActiveKinds([])
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

  const handleSubmit = async () => {
    if (form.id) {
      const result = await persistForm(undefined, { draftSource: 'manual' })
      if (result) {
        if (requiresFinalRegistration) {
          resetForm(result.menu_entry_id)
          return
        }
        setRequiresFinalRegistration(false)
      }
      return
    }

    const uploadTargets = MARKET_ASSET_KINDS
      .map((assetKind) => ({ assetKind, file: selectedFiles[assetKind] }))
      .filter((target): target is { assetKind: MarketUploadAssetKind; file: File } => Boolean(target.file))

    const desiredStatus = form.status
    const shouldDelayPublish = desiredStatus === 'published' && uploadTargets.length > 0
    const initialStatus = shouldDelayPublish ? 'draft' : desiredStatus

    setIsBulkUploading(true)
    try {
      const createdItem = await persistForm(initialStatus, {
        preserveSelections: true,
        skipSuccessToast: true,
        draftSource: 'manual',
      })

      if (!createdItem) {
        return
      }

      setRequiresFinalRegistration(true)

      if (uploadTargets.length === 0) {
        toast.success('문제마켓 상품을 생성했습니다.')
        setRequiresFinalRegistration(false)
        resetForm(createdItem.menu_entry_id)
        return
      }

      let successCount = 0
      let failedCount = 0

      for (const target of uploadTargets) {
        const result = await uploadAssetFile(target.assetKind, target.file, createdItem.id)
        if (result.success) {
          successCount += 1
        } else {
          failedCount += 1
          toast.error(`${target.assetKind.toUpperCase()}: ${result.message}`)
        }
      }

      await refreshItems(createdItem.menu_entry_id)
      await refreshEditingFiles(createdItem.id)

      if (shouldDelayPublish && failedCount === 0) {
        const publishedItem = await persistForm('published', {
          preserveSelections: true,
          skipSuccessToast: true,
          targetId: createdItem.id,
          draftSource: 'manual',
        })
        if (publishedItem) {
          setRequiresFinalRegistration(false)
        } else {
          return
        }
      }

      if (failedCount === 0) {
        toast.success(`상품 등록과 파일 ${successCount}개 업로드를 완료했습니다.`)
        setRequiresFinalRegistration(false)
        resetForm(createdItem.menu_entry_id)
        return
      }

      if (shouldDelayPublish) {
        toast.message(`상품은 생성되었지만 일부 파일 업로드에 실패해 ${MARKET_STATUS_LABELS.draft} 상태로 유지됩니다.`)
        return
      }

      toast.message(`상품은 생성되었지만 파일 ${failedCount}개 업로드에 실패했습니다.`)
    } finally {
      setIsBulkUploading(false)
    }
  }

  const ensureDraftItemForUpload = async () => {
    if (form.id) {
      return form.id
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

  const handleStatusAction = async (status: MarketItemFormState['status']) => {
    if (!form.id) {
      setForm((current) => ({ ...current, status, draftSource: 'manual' }))
      toast.message(`상태를 ${status}(으)로 설정했습니다. 저장하면 반영됩니다.`)
      return
    }

    await persistForm(status, { draftSource: 'manual' })
  }

  const handleArchive = async () => {
    if (!form.id) {
      return
    }

    const isCancellingAutoUploadDraft = form.draftSource === 'auto_upload'
    const confirmMessage = isCancellingAutoUploadDraft
      ? '상품 등록을 완료하지 않고 업로드 파일을 삭제할까요? 임시 상품과 생성된 샘플 JPG가 모두 삭제되며 되돌릴 수 없습니다.'
      : '이 상품을 완전 삭제하시겠습니까? DB 데이터와 업로드된 파일이 모두 삭제되며 되돌릴 수 없습니다.'

    if (!window.confirm(confirmMessage)) {
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

      await refreshItems(form.menuEntryId)
      resetForm(form.menuEntryId)
      toast.success(isCancellingAutoUploadDraft ? '임시 업로드 파일을 삭제했습니다.' : '문제마켓 상품을 완전 삭제했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 완전 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsArchiving(false)
    }
  }

  const handleDeleteFromList = async () => {
    if (!deleteTarget) {
      return
    }

    setIsArchiving(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${deleteTarget.id}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 완전 삭제에 실패했습니다.')
      }

      await refreshItems(deleteTarget.menu_entry_id)
      if (form.id === deleteTarget.id) {
        resetForm(deleteTarget.menu_entry_id)
      }
      setDeleteTarget(null)
      toast.success('문제마켓 상품을 완전 삭제했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 완전 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsArchiving(false)
    }
  }

  const handleVisibilityFromList = async (item: MarketItem) => {
    const isHidden = item.status === 'hidden' || hiddenItemIds.includes(item.id)
    const nextStatus = isHidden ? 'published' : 'hidden'

    setHidingItemId(item.id)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${item.id}`, workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuEntryId: item.menu_entry_id,
          title: item.title,
          summary: item.summary || '',
          description: item.description || '',
          thumbnailUrl: item.thumbnail_url || '',
          examYear: item.exam_year,
          examMonth: item.exam_month,
          gradeLevel: item.grade_level || '',
          pdfPrice: item.pdf_price,
          hwpPrice: item.hwp_price,
          status: nextStatus,
          draftSource: 'manual',
          isActive: item.is_active,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 상태 변경에 실패했습니다.')
      }

      setHiddenOverride(item.id, nextStatus === 'hidden')
      setItems((current) => current.map((currentItem) => (
        currentItem.id === item.id
          ? { ...currentItem, status: nextStatus, draft_source: 'manual' }
          : currentItem
      )))
      await refreshItems(item.menu_entry_id)
      if (form.id === item.id) {
        setForm(buildEditForm(payload.data as MarketItem))
        setRequiresFinalRegistration(false)
      }
      toast.success(isHidden ? '문제마켓 상품 숨김을 해제했습니다.' : '문제마켓 상품을 숨김 처리했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 상태 변경 중 오류가 발생했습니다.')
    } finally {
      setHidingItemId(null)
    }
  }

  const setDragActive = (assetKind: MarketUploadAssetKind, active: boolean) => {
    setDragActiveKinds((current) => active
      ? current.includes(assetKind) ? current : [...current, assetKind]
      : current.filter((kind) => kind !== assetKind))
  }

  const clearSelectedFile = (assetKind: MarketUploadAssetKind) => {
    setSelectedFiles((current) => {
      const next = { ...current }
      delete next[assetKind]
      return next
    })

    const input = fileInputRefs.current[assetKind]
    if (input) {
      input.value = ''
    }
  }

  const handleSelectedFile = (assetKind: MarketUploadAssetKind, file?: File | null) => {
    if (!file) {
      return
    }

    if (!isAllowedAssetFile(file, assetKind)) {
      toast.error(`${assetKind.toUpperCase()} 자산에는 ${getAssetAcceptValue(assetKind)} 파일만 선택할 수 있습니다.`)
      return
    }

    setSelectedFiles((current) => ({
      ...current,
      [assetKind]: file,
    }))
  }

  const uploadAssetFile = async (assetKind: MarketUploadAssetKind, file: File, itemIdOverride?: string) => {
    const targetItemId = itemIdOverride ?? form.id ?? await ensureDraftItemForUpload()
    if (!targetItemId) {
      return { success: false as const, message: '파일 업로드 전에 상품을 먼저 저장해주세요.' }
    }

    setUploadingKinds((current) => [...current, assetKind])
    try {
      const formData = new FormData()
      formData.append('assetKind', assetKind)
      formData.append('file', file)

      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${targetItemId}/files`, workspaceSubject), {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 파일 업로드에 실패했습니다.')
      }

      clearSelectedFile(assetKind)
      const samplePageCount = Number(payload.data?.samplePageCount ?? 0)
      const message = assetKind === 'pdf'
        ? `PDF 파일을 업로드하고 샘플 JPG ${samplePageCount}장을 생성했습니다.`
        : `${assetKind.toUpperCase()} 파일을 업로드했습니다.`
      return { success: true as const, message, itemId: targetItemId }
    } catch (error) {
      return {
        success: false as const,
        message: error instanceof Error ? error.message : '문제마켓 파일 업로드 중 오류가 발생했습니다.',
        itemId: targetItemId,
      }
    } finally {
      setUploadingKinds((current) => current.filter((kind) => kind !== assetKind))
    }
  }

  const handleUpload = async (assetKind: MarketUploadAssetKind) => {
    const file = selectedFiles[assetKind]
    if (!file) {
      toast.error('업로드할 파일을 선택해주세요.')
      return
    }

    const result = await uploadAssetFile(assetKind, file)
    if (result.success) {
      await refreshItems(form.menuEntryId)
      if (result.itemId) {
        await refreshEditingFiles(result.itemId)
      }
      toast.success(result.message)
      return
    }

    toast.error(result.message)
  }

  const handleUploadAll = async () => {
    const uploadTargets = MARKET_ASSET_KINDS
      .map((assetKind) => ({ assetKind, file: selectedFiles[assetKind] }))
      .filter((target): target is { assetKind: MarketUploadAssetKind; file: File } => Boolean(target.file))

    if (uploadTargets.length === 0) {
      toast.error('업로드할 파일을 먼저 선택해주세요.')
      return
    }

    setIsBulkUploading(true)
    let successCount = 0
    let failedCount = 0
    let latestItemId: string | null = form.id ?? null

    try {
      for (const target of uploadTargets) {
        const result = await uploadAssetFile(target.assetKind, target.file, latestItemId ?? undefined)
        if (result.itemId) {
          latestItemId = result.itemId
        }
        if (result.success) {
          successCount += 1
        } else {
          failedCount += 1
          toast.error(`${target.assetKind.toUpperCase()}: ${result.message}`)
        }
      }

      await refreshItems(form.menuEntryId)
      if (latestItemId) {
        await refreshEditingFiles(latestItemId)
      }

      if (failedCount === 0) {
        toast.success(`선택한 ${successCount}개 파일 업로드를 완료했습니다.`)
        return
      }

      if (successCount === 0) {
        toast.error('선택한 파일 업로드에 실패했습니다.')
        return
      }

      toast.message(`${successCount}개 업로드 성공, ${failedCount}개 실패했습니다.`)
    } finally {
      setIsBulkUploading(false)
    }
  }

  const activeFileMap = useMemo(() => {
    return new Map(editingFiles.filter((file) => file.is_active).map((file) => [file.asset_kind, file]))
  }, [editingFiles])
  const activePdfFile = activeFileMap.get('pdf')
  const isPdfUploading = uploadingKinds.includes('pdf')
  const canOpenSamplePreview = Boolean(form.id && activePdfFile && !isPdfUploading && !isBulkUploading)
  const samplePreviewStatusLabel = isPdfUploading ? '샘플 생성 중' : activePdfFile ? '확인 가능' : 'PDF 없음'
  const isAutoUploadDraft = Boolean(form.id && form.draftSource === 'auto_upload')

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">문제마켓 상품 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
          <p className="mt-1 text-gray-500">선택한 과목의 문제마켓 상품과 판매 파일을 등록/수정합니다.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => resetForm(selectedMenuEntryId)}
        >
          <Plus className="mr-2 h-4 w-4" />
          새 상품 작성
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>카테고리 선택</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedMenuEntryId}
            onChange={(event) => {
              const nextMenuEntryId = event.target.value
              setSelectedMenuEntryId(nextMenuEntryId)
              setForm((current) => current.id
                ? { ...current, menuEntryId: nextMenuEntryId }
                : buildEmptyForm(nextMenuEntryId))
            }}
            className="flex h-10 w-full max-w-sm rounded-md border bg-white px-3 text-sm"
          >
            {menuEntries.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.title}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,460px),minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{form.id ? '상품 수정' : '상품 추가'}</CardTitle>
              {form.id ? <Badge variant="outline">편집 중</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>카테고리</Label>
              <select
                value={form.menuEntryId}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  menuEntryId: event.target.value,
                }))}
                className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
              >
                {menuEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.title}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>제목</Label>
              <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>요약</Label>
              <Input value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>썸네일 URL</Label>
              <Input value={form.thumbnailUrl} onChange={(event) => setForm((current) => ({ ...current, thumbnailUrl: event.target.value }))} placeholder="https://..." />
            </div>

            <div className="space-y-2">
              <Label>상세 설명</Label>
              <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[140px]" />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <p className="font-medium text-gray-900">자료 정보</p>
                <p className="text-sm text-gray-500">상세 페이지 자료 정보 카드에 노출되는 값을 입력합니다. 과목과 등록일자는 자동으로 표시됩니다.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>과목</Label>
                  <Input value={workspaceSubject === 'korean' ? '국어' : '영어'} disabled />
                </div>
                <div className="space-y-2">
                  <Label>학년</Label>
                  <select
                    value={form.gradeLevel}
                    onChange={(event) => setForm((current) => ({ ...current, gradeLevel: event.target.value }))}
                    className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    <option value="">전체</option>
                    {LISTBOARD_GRADE_OPTIONS.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>자료유형</Label>
                  <Input value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))} placeholder="예: 모의고사" />
                </div>
                <div className="space-y-2">
                  <Label>문항 수</Label>
                  <Input type="number" min={0} value={form.questionCount} onChange={(event) => setForm((current) => ({ ...current, questionCount: event.target.value }))} placeholder="예: 24" />
                </div>
                <div className="space-y-2">
                  <Label>출처 1</Label>
                  <Input value={form.source1} onChange={(event) => setForm((current) => ({ ...current, source1: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>출처 2</Label>
                  <Input value={form.source2} onChange={(event) => setForm((current) => ({ ...current, source2: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>출처 3</Label>
                  <Input value={form.source3} onChange={(event) => setForm((current) => ({ ...current, source3: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>출처 4</Label>
                  <Input value={form.source4} onChange={(event) => setForm((current) => ({ ...current, source4: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>등록일자</Label>
                  <Input value={form.id ? '기존 등록일자 유지' : '저장 시 자동 기록'} disabled />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>PDF 가격</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={form.pdfPrice}
                  placeholder="예: 1,000"
                  onChange={(event) => setForm((current) => ({ ...current, pdfPrice: formatCreditInputValue(event.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>HWP 가격</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={form.hwpPrice}
                  placeholder="예: 1,000"
                  onChange={(event) => setForm((current) => ({ ...current, hwpPrice: formatCreditInputValue(event.target.value) }))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>연도</Label>
                <select
                  value={form.examYear}
                  onMouseDown={focusCurrentExamYear}
                  onFocus={focusCurrentExamYear}
                  onChange={(event) => setForm((current) => ({ ...current, examYear: event.target.value }))}
                  className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">선택</option>
                  {examYearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>월</Label>
                <select
                  value={form.examMonth}
                  onChange={(event) => setForm((current) => ({ ...current, examMonth: event.target.value }))}
                  className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">선택</option>
                  {MONTH_OPTIONS.map((month) => (
                    <option key={month} value={month}>{month}월</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>상태</Label>
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as MarketItemFormState['status'] }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                  <option value="draft">{MARKET_STATUS_LABELS.draft}</option>
                  <option value="published">{MARKET_STATUS_LABELS.published}</option>
                  <option value="hidden">{MARKET_STATUS_LABELS.hidden}</option>
                  <option value="archived">{MARKET_STATUS_LABELS.archived}</option>
                </select>
              </div>
              <div className="flex items-end">
                <div className="flex h-10 w-full items-center justify-between rounded-md border px-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">활성화</p>
                    <p className="text-xs text-gray-500">비활성화하면 노출되지 않습니다.</p>
                  </div>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">파일 업로드</p>
                    <p className="text-sm text-gray-500">
                      {form.id
                        ? 'PDF 업로드 시 첫 1~3페이지가 JPG 샘플로 자동 생성됩니다. HWP는 별도로 교체할 수 있습니다.'
                        : '파일을 먼저 업로드할 수 있으며, 첫 PDF 업로드 시 상품이 임시 저장되고 JPG 샘플이 자동 생성됩니다.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    disabled={isBulkUploading || selectedAssetKinds.length === 0 || uploadingKinds.length > 0}
                    onClick={() => void handleUploadAll()}
                  >
                    {isBulkUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    모두 업로드
                  </Button>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>자산</TableHead>
                        <TableHead>현재 파일</TableHead>
                        <TableHead className="text-center">버전</TableHead>
                        <TableHead className="text-center">상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow key="file-row-sample-pages">
                        <TableCell>샘플 JPG</TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            <div>
                              <p>PDF 업로드 시 첫 1~3페이지 자동 생성</p>
                              <p className="text-xs text-gray-500">PDF 파일 교체 시 샘플도 함께 갱신됩니다.</p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!canOpenSamplePreview}
                              aria-label={`${form.title || '문제마켓 상품'} 샘플 JPG 확인`}
                              onClick={() => {
                                if (!form.id) {
                                  return
                                }
                                setSamplePreviewItemId(form.id)
                                setIsSamplePreviewOpen(true)
                              }}
                            >
                              샘플 확인
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">-</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={activePdfFile ? 'outline' : 'secondary'}>{samplePreviewStatusLabel}</Badge>
                        </TableCell>
                      </TableRow>
                      {MARKET_ASSET_KINDS.map((assetKind) => {
                        const currentFile = activeFileMap.get(assetKind)

                        return (
                          <TableRow key={`file-row-${assetKind}`}>
                            <TableCell className="uppercase">{assetKind}</TableCell>
                            <TableCell>{currentFile?.original_file_name || '미업로드'}</TableCell>
                            <TableCell className="text-center">{currentFile ? `v${currentFile.version}` : '-'}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={currentFile ? 'outline' : 'secondary'}>
                                {currentFile ? '활성 파일' : '없음'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {MARKET_ASSET_KINDS.map((assetKind) => {
                  const currentFile = activeFileMap.get(assetKind)
                  const isUploading = uploadingKinds.includes(assetKind)
                  const selectedFile = selectedFiles[assetKind]
                  const isDragActive = dragActiveKinds.includes(assetKind)
                  const isUploadDisabled = isUploading || isBulkUploading
                  const allowDescription = assetKind === 'hwp' ? '.hwp 파일만 업로드할 수 있습니다.' : '.pdf 파일만 업로드할 수 있습니다.'

                  return (
                    <div key={assetKind} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium uppercase">{assetKind}</p>
                          <p className="text-xs text-gray-500">현재 파일: {currentFile?.original_file_name || '없음'}</p>
                        </div>
                        {currentFile ? <Badge variant="outline">v{currentFile.version}</Badge> : <Badge variant="secondary">미업로드</Badge>}
                      </div>
                      <div className="grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                        <p>용량: {formatFileSize(currentFile?.file_size_bytes)}</p>
                        <p>등록일: {formatDateTime(currentFile?.created_at)}</p>
                        <p className="truncate">경로: {currentFile?.storage_path || '-'}</p>
                      </div>
                      <input
                        ref={(node) => {
                          fileInputRefs.current[assetKind] = node
                        }}
                        type="file"
                        className="hidden"
                        accept={getAssetAcceptValue(assetKind)}
                        disabled={isUploadDisabled}
                        onChange={(event) => handleSelectedFile(assetKind, event.target.files?.[0])}
                      />
                      <div
                        role="button"
                        tabIndex={isUploadDisabled ? -1 : 0}
                        onClick={() => {
                          if (isUploadDisabled) return
                          const input = fileInputRefs.current[assetKind]
                          if (!input) return
                          input.value = ''
                          input.click()
                        }}
                        onKeyDown={(event) => {
                          if (isUploadDisabled) return
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          const input = fileInputRefs.current[assetKind]
                          if (!input) return
                          input.value = ''
                          input.click()
                        }}
                        onDragEnter={(event) => {
                          if (isUploadDisabled) return
                          event.preventDefault()
                          setDragActive(assetKind, true)
                        }}
                        onDragOver={(event) => {
                          if (isUploadDisabled) return
                          event.preventDefault()
                          setDragActive(assetKind, true)
                        }}
                        onDragLeave={(event) => {
                          if (isUploadDisabled) return
                          event.preventDefault()
                          setDragActive(assetKind, false)
                        }}
                        onDrop={(event) => {
                          if (isUploadDisabled) return
                          event.preventDefault()
                          setDragActive(assetKind, false)
                          const droppedFiles = Array.from(event.dataTransfer.files || [])
                          if (droppedFiles.length === 0) return
                          if (droppedFiles.length > 1) {
                            toast.message('여러 파일이 드롭되었지만 첫 번째 파일만 선택합니다.')
                          }
                          handleSelectedFile(assetKind, droppedFiles[0])
                        }}
                        className={`flex min-h-32 flex-col justify-center rounded-md border border-dashed px-4 py-4 text-left transition ${
                          isUploadDisabled
                            ? 'cursor-not-allowed bg-gray-50 text-gray-400'
                            : isDragActive
                              ? 'border-primary bg-primary/5'
                              : selectedFile || currentFile
                                ? 'border-emerald-300 bg-emerald-50/60'
                                : 'cursor-pointer border-red-200 bg-red-50/40 hover:border-red-300 hover:bg-red-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900">
                          {!form.id
                            ? '상품 등록 전에 파일을 먼저 업로드할 수 있습니다.'
                            : isDragActive
                              ? '여기에 파일을 놓으세요.'
                              : '파일을 드래그하여 놓거나, 파일선택 버튼으로 업로드할 파일을 고르세요.'}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {selectedFile
                            ? `선택 파일: ${selectedFile.name} (${formatFileSize(selectedFile.size)})`
                            : `허용 형식: ${allowDescription}`}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row md:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isUploadDisabled}
                          onClick={() => {
                            const input = fileInputRefs.current[assetKind]
                            if (!input) return
                            input.value = ''
                            input.click()
                          }}
                        >
                          파일선택
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!selectedFile || isUploadDisabled}
                          onClick={() => {
                            void handleUpload(assetKind)
                          }}
                        >
                          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                          업로드
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {isAutoUploadDraft ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">임시 업로드 상태</p>
                  <p className="mt-1">상품 등록을 완료하지 않고 업로드 파일을 삭제하려면 등록 취소 및 파일 삭제를 눌러주세요.</p>
                </div>
              ) : null}

            <div className="sticky bottom-4 z-10 -mx-2 rounded-xl border bg-white/95 px-2 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/85">
              <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleSubmit}
                disabled={isSaving || isBulkUploading}
                className="h-11 flex-1 text-base font-semibold shadow-sm"
              >
                {isSaving || isBulkUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {form.id
                  ? requiresFinalRegistration
                    ? '상품 등록'
                    : '상품 저장'
                  : selectedAssetKinds.length > 0
                    ? (isBulkUploading ? '상품 등록 및 파일 업로드 중...' : '상품 등록 및 파일 업로드')
                    : '상품 등록'}
              </Button>
              <Button type="button" variant="secondary" disabled={isSaving || isBulkUploading} onClick={() => void handleStatusAction('draft')}>
                임시저장
              </Button>
              <Button type="button" variant="outline" disabled={isSaving || isBulkUploading} onClick={() => void handleStatusAction('hidden')}>
                숨김
              </Button>
              <Button type="button" variant="outline" disabled={isSaving || isBulkUploading} onClick={() => void handleStatusAction('published')}>
                공개
              </Button>
              {form.id ? (
                <Button type="button" variant="destructive" disabled={isArchiving || isBulkUploading} onClick={handleArchive}>
                  {isArchiving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  {isAutoUploadDraft ? '등록 취소 및 파일 삭제' : '완전 삭제'}
                </Button>
              ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>상품 목록</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>제목</TableHead>
                    <TableHead>카테고리</TableHead>
                    <TableHead className="text-center">가격</TableHead>
                    <TableHead className="text-center">상태</TableHead>
                    <TableHead className="text-center">등록일</TableHead>
                    <TableHead className="text-right">관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-gray-500">
                        등록된 상품이 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => {
                      const isHidden = item.status === 'hidden' || hiddenItemIds.includes(item.id)

                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium text-gray-900">{item.title}</p>
                              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                                {item.summary ? <span>{item.summary}</span> : null}
                                {item.grade_level ? <Badge variant="secondary">{item.grade_level}</Badge> : null}
                                {!item.is_active ? <Badge variant="destructive">비활성</Badge> : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{menuTitleMap.get(item.menu_entry_id) || '-'}</TableCell>
                          <TableCell className="text-center text-sm">
                            <div>PDF {item.pdf_price}C</div>
                            <div>HWP {item.hwp_price}C</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">{MARKET_STATUS_LABELS[item.status as MarketItemFormState['status']] ?? item.status}</Badge>
                          </TableCell>
                          <TableCell className="text-center text-sm text-gray-600">{formatDateTime(item.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button type="button" variant="ghost" size="icon" onClick={() => void loadItemDetail(item.id)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={isHidden ? `${item.title} 숨김 해제` : `${item.title} 숨김 처리`}
                                title={isHidden ? '숨김 해제' : '숨김'}
                                className="text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                                disabled={hidingItemId === item.id}
                                onClick={() => void handleVisibilityFromList(item)}
                              >
                                {hidingItemId === item.id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() => setDeleteTarget(item)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <AdminMarketSamplePreviewDialog
        itemId={samplePreviewItemId}
        itemTitle={form.title || '문제마켓 상품'}
        open={isSamplePreviewOpen}
        workspaceSubject={workspaceSubject}
        onOpenChange={(open) => {
          setIsSamplePreviewOpen(open)
          if (!open) {
            setSamplePreviewItemId(null)
          }
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isArchiving && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문제마켓 상품을 완전 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{deleteTarget?.title}]</span> 상품의 DB 데이터와 업로드된 파일이 모두 삭제되며 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={isArchiving}
              onClick={handleDeleteFromList}
            >
              {isArchiving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              완전 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
