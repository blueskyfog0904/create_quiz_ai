'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  MAX_GENERATED_SAMPLE_PAGE_BYTES,
  MAX_GENERATED_SAMPLE_TOTAL_BYTES,
  MAX_SAMPLE_PAGE_DIMENSION_PX,
  MAX_SAMPLE_PAGE_PIXELS,
  SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS,
  SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS,
  buildMarketSamplePageFileName,
  parseMarketSamplePageSelection,
} from '@/lib/market-pdf-sample-generator'
import type {
  MarketFileType,
  MarketItem,
  MarketItemBundleOption,
  MarketItemFile,
  MarketItemSubproduct,
  MarketSubproductCategory,
  MarketSubproductFile,
} from '@/lib/market-items-server'
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
  zipPrice: string
  status: 'draft' | 'published' | 'hidden' | 'archived'
  draftSource: 'manual' | 'auto_upload'
  isActive: boolean
}

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
    zipPrice: '0',
    status: 'published',
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
    zipPrice: formatCreditInputValue(item.zip_price),
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

interface AdminSamplePage {
  id: string
  pageNumber: number
  signedUrl: string
  fileSizeBytes: number | null
  widthPx: number | null
  heightPx: number | null
  draftToken?: string | null
}

type SampleGenerationStep = 'idle' | 'rendering' | 'requesting_upload_targets' | 'uploading' | 'finalizing'

interface RenderedSamplePage {
  pageNumber: number
  originalFileName: string
  mimeType: 'image/jpeg'
  blob: Blob
  fileSizeBytes: number
  widthPx: number
  heightPx: number
}

interface SampleUploadTarget {
  pageNumber: number
  storagePath: string
  token: string
  originalFileName: string
  mimeType: 'image/jpeg'
  fileSizeBytes: number
  widthPx: number
  heightPx: number
}

interface SampleUploadTargetResponse {
  success?: boolean
  draftToken?: string
  sourceBatchId?: string
  bucket?: string
  uploadTargets?: SampleUploadTarget[]
  error?: { message?: string }
}

interface SampleFinalizeResponse {
  success?: boolean
  draftToken?: string
  pages?: AdminSamplePage[]
  error?: { message?: string }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('샘플 JPG 데이터를 생성하지 못했습니다.'))
        return
      }

      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

async function renderSamplePdfPages(file: File, samplePageSelection: string): Promise<RenderedSamplePage[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await withTimeout(
    pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise,
    SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS,
    '샘플 PDF 문서 로드 시간이 초과되었습니다.'
  )
  const renderedPages: RenderedSamplePage[] = []
  let totalGeneratedBytes = 0

  try {
    const pageNumbers = parseMarketSamplePageSelection(samplePageSelection, pdf.numPages)
    for (const pageNumber of pageNumbers) {
      const pdfPage = await pdf.getPage(pageNumber)
      const baseViewport = pdfPage.getViewport({ scale: 1.5 })
      const dimensionScale = Math.min(1, MAX_SAMPLE_PAGE_DIMENSION_PX / Math.max(baseViewport.width, baseViewport.height))
      const pixelScale = Math.min(1, Math.sqrt(MAX_SAMPLE_PAGE_PIXELS / Math.max(baseViewport.width * baseViewport.height, 1)))
      const safeScale = Math.max(0.1, Math.min(dimensionScale, pixelScale))
      const viewport = safeScale < 1 ? pdfPage.getViewport({ scale: 1.5 * safeScale }) : baseViewport

      if (viewport.width * viewport.height > MAX_SAMPLE_PAGE_PIXELS || Math.max(viewport.width, viewport.height) > MAX_SAMPLE_PAGE_DIMENSION_PX) {
        throw new Error('샘플 PDF 페이지 크기가 허용 범위를 초과했습니다.')
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        throw new Error('샘플 JPG canvas를 생성하지 못했습니다.')
      }

      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await withTimeout(
        pdfPage.render({ canvas, canvasContext: context, viewport }).promise,
        SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS,
        '샘플 PDF 페이지 렌더링 시간이 초과되었습니다.'
      )

      const blob = await canvasToJpegBlob(canvas, 0.9)
      totalGeneratedBytes += blob.size
      if (blob.size > MAX_GENERATED_SAMPLE_PAGE_BYTES) {
        throw new Error('샘플 JPG 페이지 용량이 허용 범위를 초과했습니다.')
      }
      if (totalGeneratedBytes > MAX_GENERATED_SAMPLE_TOTAL_BYTES) {
        throw new Error('샘플 JPG 전체 용량이 허용 범위를 초과했습니다.')
      }

      renderedPages.push({
        pageNumber,
        originalFileName: buildMarketSamplePageFileName(file.name, pageNumber),
        mimeType: 'image/jpeg',
        blob,
        fileSizeBytes: blob.size,
        widthPx: canvas.width,
        heightPx: canvas.height,
      })
    }

    return renderedPages
  } finally {
    await pdf.destroy()
  }
}

interface PersistFormOptions {
  preserveSelections?: boolean
  skipSuccessToast?: boolean
  targetId?: string
  draftSource?: 'manual' | 'auto_upload'
}

interface MarketItemDetailPayload {
  item: MarketItem
  files: MarketItemFile[]
  subproducts: MarketItemSubproduct[]
  subproductFiles: MarketSubproductFile[]
  bundleOption: MarketItemBundleOption | null
}

interface SubproductDraftState {
  categoryId: string
  description: string
  priceCredits: string
}

interface SubproductFileDraftState {
  id: string
  subproductId: string
  fileTypeId: string
  fileName?: string
}

interface BundleFormState {
  enabled: boolean
  label: string
  description: string
  priceCredits: string
}

interface CategorySettingsFormState {
  name: string
  slug: string
  description: string
  sortOrder: string
  isActive: boolean
}

interface FileTypeSettingsFormState {
  code: string
  label: string
  extension: string
  mimeAllowlist: string
  sortOrder: string
  isActive: boolean
}

const MANAGE_SUBPRODUCT_CATEGORIES_VALUE = '__manage_subproduct_categories__'
const MANAGE_FILE_TYPES_VALUE = '__manage_file_types__'

function buildEmptySubproductDraft(categoryId = ''): SubproductDraftState {
  return {
    categoryId,
    description: '',
    priceCredits: '0',
  }
}

function buildEmptyBundleForm(): BundleFormState {
  return {
    enabled: true,
    label: '전체 한번에 구매하기',
    description: '',
    priceCredits: '0',
  }
}

function buildEmptyCategorySettingsForm(): CategorySettingsFormState {
  return {
    name: '',
    slug: '',
    description: '',
    sortOrder: '0',
    isActive: true,
  }
}

function buildCategorySettingsForm(category: MarketSubproductCategory): CategorySettingsFormState {
  return {
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    sortOrder: String(category.sort_order ?? 0),
    isActive: category.is_active,
  }
}

function buildEmptyFileTypeSettingsForm(): FileTypeSettingsFormState {
  return {
    code: '',
    label: '',
    extension: '',
    mimeAllowlist: '',
    sortOrder: '0',
    isActive: true,
  }
}

function buildFileTypeSettingsForm(fileType: MarketFileType): FileTypeSettingsFormState {
  return {
    code: fileType.code,
    label: fileType.label,
    extension: fileType.extension,
    mimeAllowlist: (fileType.mime_allowlist || []).join('\n'),
    sortOrder: String(fileType.sort_order ?? 0),
    isActive: fileType.is_active,
  }
}

export default function MarketProductsClient({ menuEntries, initialItems, workspaceSubject }: MarketProductsClientProps) {
  const router = useRouter()
  const [selectedMenuEntryId, setSelectedMenuEntryId] = useState(menuEntries[0]?.id || '')
  const [items, setItems] = useState(initialItems)
  const [form, setForm] = useState<MarketItemFormState>(buildEmptyForm(menuEntries[0]?.id || ''))
  const [isSaving, setIsSaving] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [hidingItemId, setHidingItemId] = useState<string | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState(() => initialItems
    .filter((item) => item.status === 'hidden')
    .map((item) => item.id))
  const [requiresFinalRegistration, setRequiresFinalRegistration] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MarketItem | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [bulkDeleteTargetIds, setBulkDeleteTargetIds] = useState<string[] | null>(null)
  const [isBulkActionRunning, setIsBulkActionRunning] = useState(false)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePages, setSamplePages] = useState<AdminSamplePage[]>([])
  const [samplePageSelection, setSamplePageSelection] = useState('1,2,3')
  const [selectedSampleSourceFile, setSelectedSampleSourceFile] = useState<File | null>(null)
  const [sampleDraftToken, setSampleDraftToken] = useState<string | null>(null)
  const [isSampleSourceDragActive, setIsSampleSourceDragActive] = useState(false)
  const [samplePageDragId, setSamplePageDragId] = useState<string | null>(null)
  const [isSampleSourceUploading, setIsSampleSourceUploading] = useState(false)
  const [sampleGenerationStep, setSampleGenerationStep] = useState<SampleGenerationStep>('idle')
  const [deletingSamplePageId, setDeletingSamplePageId] = useState<string | null>(null)
  const [subproductCategories, setSubproductCategories] = useState<MarketSubproductCategory[]>([])
  const [fileTypes, setFileTypes] = useState<MarketFileType[]>([])
  const [subproducts, setSubproducts] = useState<MarketItemSubproduct[]>([])
  const [subproductFiles, setSubproductFiles] = useState<MarketSubproductFile[]>([])
  const [bundleOption, setBundleOption] = useState<MarketItemBundleOption | null>(null)
  const [subproductDraft, setSubproductDraft] = useState<SubproductDraftState>(buildEmptySubproductDraft())
  const [subproductFileDrafts, setSubproductFileDrafts] = useState<SubproductFileDraftState[]>([])
  const [bundleForm, setBundleForm] = useState<BundleFormState>(buildEmptyBundleForm())
  const [isCategorySettingsOpen, setIsCategorySettingsOpen] = useState(false)
  const [categorySettingsForm, setCategorySettingsForm] = useState<CategorySettingsFormState>(buildEmptyCategorySettingsForm())
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [isCategorySettingsSaving, setIsCategorySettingsSaving] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [isFileTypeSettingsOpen, setIsFileTypeSettingsOpen] = useState(false)
  const [fileTypeSettingsForm, setFileTypeSettingsForm] = useState<FileTypeSettingsFormState>(buildEmptyFileTypeSettingsForm())
  const [editingFileTypeId, setEditingFileTypeId] = useState<string | null>(null)
  const [isFileTypeSettingsSaving, setIsFileTypeSettingsSaving] = useState(false)
  const [deletingFileTypeId, setDeletingFileTypeId] = useState<string | null>(null)
  const [isSubproductSaving, setIsSubproductSaving] = useState(false)
  const [subproductUploadingKeys, setSubproductUploadingKeys] = useState<string[]>([])
  const [subproductDragActiveKeys, setSubproductDragActiveKeys] = useState<string[]>([])
  const sampleSourceInputRef = useRef<HTMLInputElement | null>(null)

  const filteredItems = useMemo(() => (
    selectedMenuEntryId
      ? items.filter((item) => item.menu_entry_id === selectedMenuEntryId)
      : items
  ), [items, selectedMenuEntryId])

  const selectedItems = useMemo(() => filteredItems.filter((item) => selectedItemIds.includes(item.id)), [filteredItems, selectedItemIds])
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedItemIds.includes(item.id))
  const someFilteredSelected = selectedItems.length > 0 && !allFilteredSelected
  const bulkDeleteTargetItems = useMemo(
    () => items.filter((item) => (bulkDeleteTargetIds ?? []).includes(item.id)),
    [bulkDeleteTargetIds, items]
  )
  const menuTitleMap = useMemo(() => new Map(menuEntries.map((entry) => [entry.id, entry.title])), [menuEntries])
  const examYearOptions = useMemo(() => buildExamYearOptions(), [])
  const activeSubproductCategories = useMemo(
    () => subproductCategories.filter((category) => category.is_active),
    [subproductCategories]
  )
  const activeFileTypes = useMemo(
    () => fileTypes.filter((fileType) => fileType.is_active),
    [fileTypes]
  )
  const subproductFilesBySubproductId = useMemo(() => {
    const fileMap = new Map<string, MarketSubproductFile[]>()
    subproductFiles
      .filter((file) => file.is_active)
      .forEach((file) => {
        const current = fileMap.get(file.subproduct_id) || []
        fileMap.set(file.subproduct_id, [...current, file])
      })

    return fileMap
  }, [subproductFiles])

  const focusCurrentExamYear = () => {
    setForm((current) => current.examYear ? current : { ...current, examYear: getDefaultExamYear() })
  }

  const reloadUploadTaxonomy = useCallback(async () => {
    const [categoryResponse, fileTypeResponse] = await Promise.all([
      fetch(withAdminWorkspaceSubject('/api/admin/market/subproduct-categories', workspaceSubject), { cache: 'no-store' }),
      fetch(withAdminWorkspaceSubject('/api/admin/market/file-types', workspaceSubject), { cache: 'no-store' }),
    ])
    const [categoryPayload, fileTypePayload] = await Promise.all([
      categoryResponse.json(),
      fileTypeResponse.json(),
    ])

    if (!categoryResponse.ok || !categoryPayload.success) {
      throw new Error(categoryPayload.error?.message || '서브상품 카테고리 목록을 불러오지 못했습니다.')
    }
    if (!fileTypeResponse.ok || !fileTypePayload.success) {
      throw new Error(fileTypePayload.error?.message || '파일 유형 목록을 불러오지 못했습니다.')
    }

    const nextCategories = (categoryPayload.data || []) as MarketSubproductCategory[]
    const nextFileTypes = (fileTypePayload.data || []) as MarketFileType[]
    const nextActiveCategories = nextCategories.filter((category) => category.is_active)
    const nextActiveFileTypes = nextFileTypes.filter((fileType) => fileType.is_active)

    setSubproductCategories(nextCategories)
    setFileTypes(nextFileTypes)
    setSubproductDraft((current) => nextActiveCategories.some((category) => category.id === current.categoryId)
      ? current
      : { ...current, categoryId: nextActiveCategories[0]?.id || '' })
    setSubproductFileDrafts((current) => {
      let changed = false
      const nextDrafts = current.map((draft) => {
        if (!draft.fileTypeId || nextActiveFileTypes.some((fileType) => fileType.id === draft.fileTypeId)) {
          return draft
        }

        changed = true
        return { ...draft, fileTypeId: nextActiveFileTypes[0]?.id || '' }
      })

      return changed ? nextDrafts : current
    })

    return { categories: nextCategories, fileTypes: nextFileTypes }
  }, [workspaceSubject])

  useEffect(() => {
    let isMounted = true

    const loadUploadTaxonomy = async () => {
      try {
        const { categories } = await reloadUploadTaxonomy()
        if (!isMounted) {
          return
        }

        setSubproductDraft((current) => current.categoryId
          ? current
          : buildEmptySubproductDraft(categories.find((category) => category.is_active)?.id || categories[0]?.id || ''))
      } catch (error) {
        if (isMounted) {
          toast.error(error instanceof Error ? error.message : '서브상품 설정을 불러오지 못했습니다.')
        }
      }
    }

    void loadUploadTaxonomy()

    return () => {
      isMounted = false
    }
  }, [reloadUploadTaxonomy])

  const resetForm = (menuEntryId = selectedMenuEntryId) => {
    setForm(buildEmptyForm(menuEntryId))
    setSubproducts([])
    setSubproductFiles([])
    setBundleOption(null)
    setBundleForm(buildEmptyBundleForm())
    setSubproductDraft(buildEmptySubproductDraft(activeSubproductCategories[0]?.id || subproductCategories[0]?.id || ''))
    setSubproductFileDrafts([])
    setSubproductUploadingKeys([])
    setSubproductDragActiveKeys([])
    setRequiresFinalRegistration(false)
    setSamplePages([])
    setSamplePageSelection('1,2,3')
    setSelectedSampleSourceFile(null)
    setSampleDraftToken(null)
    setIsSampleSourceDragActive(false)
    setSamplePageDragId(null)
    setSampleGenerationStep('idle')
    if (sampleSourceInputRef.current) {
      sampleSourceInputRef.current.value = ''
    }
    setIsSamplePreviewOpen(false)
    setSamplePreviewItemId(null)
  }

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds((current) => current.includes(itemId)
      ? current.filter((currentItemId) => currentItemId !== itemId)
      : [...current, itemId])
  }

  const toggleFilteredSelection = () => {
    const filteredIds = filteredItems.map((item) => item.id)
    if (filteredIds.length === 0) {
      return
    }

    setSelectedItemIds((current) => {
      const shouldClearFilteredItems = filteredIds.every((itemId) => current.includes(itemId))
      if (shouldClearFilteredItems) {
        return current.filter((itemId) => !filteredIds.includes(itemId))
      }

      return Array.from(new Set([...current, ...filteredIds]))
    })
  }

  const setHiddenOverride = (itemId: string, isHidden: boolean) => {
    setHiddenItemIds((current) => {
      if (isHidden) {
        return current.includes(itemId) ? current : [...current, itemId]
      }

      return current.filter((currentItemId) => currentItemId !== itemId)
    })
  }

  const buildItemPatchBody = (item: MarketItem, nextStatus: MarketItemFormState['status']) => ({
    menuEntryId: item.menu_entry_id,
    title: item.title,
    summary: item.summary || '',
    description: item.description || '',
    thumbnailUrl: item.thumbnail_url || '',
    examYear: item.exam_year,
    examMonth: item.exam_month,
    gradeLevel: item.grade_level || '',
    sourceType: item.source_type || '',
    source1: item.source_1 || '',
    source2: item.source_2 || '',
    source3: item.source_3 || '',
    source4: item.source_4 || '',
    questionCount: item.question_count,
    pdfPrice: item.pdf_price,
    hwpPrice: item.hwp_price,
    zipPrice: item.zip_price,
    status: nextStatus,
    draftSource: 'manual',
    isActive: item.is_active,
  })

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

    return payload.data as MarketItemDetailPayload
  }

  const applyItemDetail = (detail: MarketItemDetailPayload) => {
    setSubproducts(detail.subproducts || [])
    setSubproductFiles(detail.subproductFiles || [])
    setBundleOption(detail.bundleOption || null)
    setBundleForm(detail.bundleOption
      ? {
        enabled: detail.bundleOption.is_active,
        label: detail.bundleOption.label || '전체 한번에 구매하기',
        description: detail.bundleOption.description || '',
        priceCredits: formatCreditInputValue(detail.bundleOption.price_credits),
      }
      : buildEmptyBundleForm())
  }

  const fetchItemSamplePages = async (id: string) => {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${id}/sample-pages`, workspaceSubject), { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '샘플 JPG 목록을 불러오지 못했습니다.')
    }

    return (payload.pages || []) as AdminSamplePage[]
  }

  const persistSamplePageOrder = async (itemId: string) => {
    if (samplePages.length === 0) {
      return
    }

    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/sample-pages`, workspaceSubject), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds: samplePages.map((page) => page.id) }),
    })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '샘플 이미지 순서 저장에 실패했습니다.')
    }
  }

  const persistBundleOption = async (itemId: string) => {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/bundle-option`, workspaceSubject), {
      method: bundleForm.enabled ? 'PATCH' : 'DELETE',
      headers: bundleForm.enabled ? { 'Content-Type': 'application/json' } : undefined,
      body: bundleForm.enabled
        ? JSON.stringify({
          label: bundleForm.label || '전체 한번에 구매하기',
          description: bundleForm.description,
          priceCredits: parseCreditInputValue(bundleForm.priceCredits),
          isActive: true,
        })
        : undefined,
    })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '전체구매 옵션 저장에 실패했습니다.')
    }
  }

  const loadItemDetail = async (id: string) => {
    const detail = await fetchItemDetail(id)

    setSelectedMenuEntryId(detail.item.menu_entry_id)
    setForm(buildEditForm(detail.item))
    applyItemDetail(detail)
    setSamplePages(await fetchItemSamplePages(id))
    setSelectedSampleSourceFile(null)
    setSampleDraftToken(null)
    setIsSampleSourceDragActive(false)
    setSamplePageDragId(null)
    if (sampleSourceInputRef.current) {
      sampleSourceInputRef.current.value = ''
    }
    setSubproductFileDrafts([])
    setSubproductUploadingKeys([])
    setSubproductDragActiveKeys([])
    setRequiresFinalRegistration(detail.item.status === 'draft' && detail.item.draft_source === 'auto_upload')
  }

  const refreshEditingFiles = async (id: string) => {
    const detail = await fetchItemDetail(id)
    applyItemDetail(detail)
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
    zipPrice: parseCreditInputValue(form.zipPrice),
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

    const nextStatus = statusOverride ?? form.status
    if (nextStatus === 'published' && options.draftSource !== 'auto_upload' && bundleForm.enabled && parseCreditInputValue(bundleForm.priceCredits) <= 0) {
      toast.error('전체구매 가격을 설정해주세요')
      return null
    }

    setIsSaving(true)
    try {
      const targetId = options.targetId ?? form.id
      const previousMenuEntryId = targetId
        ? items.find((item) => item.id === targetId)?.menu_entry_id
        : null
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
      if (options.draftSource !== 'auto_upload') {
        await persistSamplePageOrder(payload.data.id)
        await persistBundleOption(payload.data.id)
      }
      const detail = await fetchItemDetail(payload.data.id)
      setSelectedMenuEntryId(detail.item.menu_entry_id)
      setForm(buildEditForm(detail.item))
      setHiddenOverride(detail.item.id, detail.item.status === 'hidden')
      applyItemDetail(detail)
      if (sampleDraftToken && options.draftSource !== 'auto_upload') {
        const commitResponse = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${detail.item.id}/samples/commit`, workspaceSubject), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftToken: sampleDraftToken }),
        })
        const commitPayload = await commitResponse.json()

        if (!commitResponse.ok || !commitPayload.success) {
          throw new Error(commitPayload.error?.message || '샘플 JPG 확정에 실패했습니다.')
        }

        setSampleDraftToken(null)
        setSamplePages(await fetchItemSamplePages(detail.item.id))
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

    const createdItem = await persistForm(undefined, { draftSource: 'manual' })
    if (createdItem) {
      resetForm(createdItem.menu_entry_id)
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
      setSelectedItemIds((current) => current.filter((itemId) => itemId !== deleteTarget.id))
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
        body: JSON.stringify(buildItemPatchBody(item, nextStatus)),
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

  const handleBulkVisibility = async () => {
    const targetItems = selectedItems
    if (targetItems.length === 0) {
      return
    }

    setIsBulkActionRunning(true)
    try {
      const results = await Promise.allSettled(targetItems.map(async (item) => {
        const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${item.id}`, workspaceSubject), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...buildItemPatchBody(item, 'hidden'), status: 'hidden' }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || `${item.title} 숨김 처리에 실패했습니다.`)
        }

        return payload.data as MarketItem
      }))

      const successIds = targetItems
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((item) => item.id)
      const failedIds = targetItems
        .filter((_, index) => results[index].status === 'rejected')
        .map((item) => item.id)
      const successMenuEntryIds = Array.from(new Set(targetItems
        .filter((item) => successIds.includes(item.id))
        .map((item) => item.menu_entry_id)))

      successIds.forEach((itemId) => setHiddenOverride(itemId, true))
      setItems((current) => current.map((item) => successIds.includes(item.id)
        ? { ...item, status: 'hidden', draft_source: 'manual' }
        : item))

      const updatedItems = results
        .filter((result): result is PromiseFulfilledResult<MarketItem> => result.status === 'fulfilled')
        .map((result) => result.value)
      const updatedFormItem = updatedItems.find((item) => item.id === form.id)
      if (updatedFormItem) {
        setForm(buildEditForm(updatedFormItem))
        setRequiresFinalRegistration(false)
      }

      await Promise.all(successMenuEntryIds.map((menuEntryId) => refreshItems(menuEntryId)))
      setSelectedItemIds(failedIds)

      if (successIds.length > 0) {
        toast.success(`선택한 상품 ${successIds.length}개를 숨김 처리했습니다.`)
      }
      if (failedIds.length > 0) {
        toast.error(`선택한 상품 ${failedIds.length}개 숨김 처리에 실패했습니다.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '선택한 상품 숨김 처리 중 오류가 발생했습니다.')
    } finally {
      setIsBulkActionRunning(false)
    }
  }

  const handleBulkDelete = async () => {
    const targetItems = bulkDeleteTargetItems
    if (!bulkDeleteTargetIds || targetItems.length === 0) {
      return
    }

    setIsBulkActionRunning(true)
    try {
      const results = await Promise.allSettled(targetItems.map(async (item) => {
        const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${item.id}`, workspaceSubject), {
          method: 'DELETE',
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || `${item.title} 완전 삭제에 실패했습니다.`)
        }

        return item
      }))

      const successIds = targetItems
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((item) => item.id)
      const failedIds = targetItems
        .filter((_, index) => results[index].status === 'rejected')
        .map((item) => item.id)
      const successMenuEntryIds = Array.from(new Set(targetItems
        .filter((item) => successIds.includes(item.id))
        .map((item) => item.menu_entry_id)))

      setItems((current) => current.filter((item) => !successIds.includes(item.id)))
      setHiddenItemIds((current) => current.filter((itemId) => !successIds.includes(itemId)))
      setSelectedItemIds(failedIds)
      setBulkDeleteTargetIds(null)

      if (form.id && successIds.includes(form.id)) {
        resetForm(form.menuEntryId)
      }

      await Promise.all(successMenuEntryIds.map((menuEntryId) => refreshItems(menuEntryId)))

      if (successIds.length > 0) {
        toast.success(`선택한 상품 ${successIds.length}개를 완전 삭제했습니다.`)
      }
      if (failedIds.length > 0) {
        toast.error(`선택한 상품 ${failedIds.length}개 완전 삭제에 실패했습니다.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '선택한 상품 완전 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsBulkActionRunning(false)
    }
  }

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
            mimeType: page.mimeType,
            fileSizeBytes: page.fileSizeBytes,
            widthPx: page.widthPx,
            heightPx: page.heightPx,
            storagePath: page.storagePath,
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

  const resetCategorySettingsForm = () => {
    setEditingCategoryId(null)
    setCategorySettingsForm(buildEmptyCategorySettingsForm())
  }

  const resetFileTypeSettingsForm = () => {
    setEditingFileTypeId(null)
    setFileTypeSettingsForm(buildEmptyFileTypeSettingsForm())
  }

  const handleEditCategorySettings = (category: MarketSubproductCategory) => {
    setEditingCategoryId(category.id)
    setCategorySettingsForm(buildCategorySettingsForm(category))
  }

  const handleEditFileTypeSettings = (fileType: MarketFileType) => {
    setEditingFileTypeId(fileType.id)
    setFileTypeSettingsForm(buildFileTypeSettingsForm(fileType))
  }

  const handleSaveCategorySettings = async () => {
    if (!categorySettingsForm.name.trim() || !categorySettingsForm.slug.trim()) {
      toast.error('카테고리 이름과 slug를 입력해주세요.')
      return
    }

    setIsCategorySettingsSaving(true)
    try {
      const isEditing = Boolean(editingCategoryId)
      const response = await fetch(withAdminWorkspaceSubject(
        editingCategoryId
          ? `/api/admin/market/subproduct-categories/${editingCategoryId}`
          : '/api/admin/market/subproduct-categories',
        workspaceSubject
      ), {
        method: editingCategoryId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categorySettingsForm.name,
          slug: categorySettingsForm.slug,
          description: categorySettingsForm.description,
          sortOrder: Number(categorySettingsForm.sortOrder || 0),
          isActive: categorySettingsForm.isActive,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 카테고리 저장에 실패했습니다.')
      }

      await reloadUploadTaxonomy()
      resetCategorySettingsForm()
      toast.success(isEditing ? '서브상품 카테고리를 수정했습니다.' : '서브상품 카테고리를 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 카테고리 저장 중 오류가 발생했습니다.')
    } finally {
      setIsCategorySettingsSaving(false)
    }
  }

  const handleDeleteCategorySettings = async (categoryId: string) => {
    if (!window.confirm('이 서브상품 카테고리를 삭제할까요? 사용 중인 카테고리는 삭제할 수 없습니다.')) {
      return
    }

    setDeletingCategoryId(categoryId)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/subproduct-categories/${categoryId}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 카테고리 삭제에 실패했습니다.')
      }

      await reloadUploadTaxonomy()
      if (editingCategoryId === categoryId) {
        resetCategorySettingsForm()
      }
      toast.success('서브상품 카테고리를 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 카테고리 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingCategoryId(null)
    }
  }

  const handleSaveFileTypeSettings = async () => {
    if (!fileTypeSettingsForm.code.trim() || !fileTypeSettingsForm.label.trim() || !fileTypeSettingsForm.extension.trim()) {
      toast.error('파일 유형 코드, 표시명, 확장자를 입력해주세요.')
      return
    }

    setIsFileTypeSettingsSaving(true)
    try {
      const isEditing = Boolean(editingFileTypeId)
      const response = await fetch(withAdminWorkspaceSubject(
        editingFileTypeId
          ? `/api/admin/market/file-types/${editingFileTypeId}`
          : '/api/admin/market/file-types',
        workspaceSubject
      ), {
        method: editingFileTypeId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fileTypeSettingsForm.code,
          label: fileTypeSettingsForm.label,
          extension: fileTypeSettingsForm.extension.replace(/^\./, ''),
          mimeAllowlist: fileTypeSettingsForm.mimeAllowlist
            .split(/\n|,/)
            .map((mime) => mime.trim())
            .filter(Boolean),
          sortOrder: Number(fileTypeSettingsForm.sortOrder || 0),
          isActive: fileTypeSettingsForm.isActive,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '파일 유형 저장에 실패했습니다.')
      }

      await reloadUploadTaxonomy()
      resetFileTypeSettingsForm()
      toast.success(isEditing ? '파일 유형을 수정했습니다.' : '파일 유형을 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 유형 저장 중 오류가 발생했습니다.')
    } finally {
      setIsFileTypeSettingsSaving(false)
    }
  }

  const handleDeleteFileTypeSettings = async (fileTypeId: string) => {
    if (!window.confirm('이 파일 유형을 삭제할까요? 사용 중인 파일 유형은 삭제할 수 없습니다.')) {
      return
    }

    setDeletingFileTypeId(fileTypeId)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/file-types/${fileTypeId}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '파일 유형 삭제에 실패했습니다.')
      }

      await reloadUploadTaxonomy()
      if (editingFileTypeId === fileTypeId) {
        resetFileTypeSettingsForm()
      }
      toast.success('파일 유형을 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 유형 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingFileTypeId(null)
    }
  }

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

  const getUsedFileTypeIdsForSubproduct = (subproductId: string, draftIdToExclude?: string) => new Set([
    ...(subproductFilesBySubproductId.get(subproductId) || []).map((file) => file.file_type_id),
    ...subproductFileDrafts
      .filter((draft) => draft.subproductId === subproductId && draft.id !== draftIdToExclude && draft.fileTypeId)
      .map((draft) => draft.fileTypeId),
  ])

  const getAvailableFileTypesForSubproduct = (subproductId: string, draftIdToExclude?: string) => {
    const usedFileTypeIds = getUsedFileTypeIdsForSubproduct(subproductId, draftIdToExclude)
    return activeFileTypes.filter((fileType) => !usedFileTypeIds.has(fileType.id))
  }

  const handleAddSubproductFileDraft = (subproductId: string) => {
    const defaultFileTypeId = getAvailableFileTypesForSubproduct(subproductId)[0]?.id || ''
    if (!defaultFileTypeId) {
      toast.error('추가할 수 있는 파일 유형이 없습니다. 기존 파일을 제거하거나 파일 유형을 추가해주세요.')
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
      toast.success('서브상품을 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 추가 중 오류가 발생했습니다.')
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
      toast.success('서브상품을 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsSubproductSaving(false)
    }
  }

  const handleSubproductFileUpload = async (subproductId: string, fileTypeId: string, file?: File | null, draftId?: string) => {
    if (!form.id || !file) {
      return
    }

    if (!fileTypeId) {
      toast.error('파일 유형을 선택해주세요.')
      return
    }

    const fileType = fileTypes.find((currentFileType) => currentFileType.id === fileTypeId)
    if (!fileType) {
      toast.error('파일 유형을 찾을 수 없습니다.')
      return
    }
    if (!isAllowedSubproductFile(file, fileType)) {
      toast.error(`${fileType.label} 파일에는 ${getFileTypeAcceptValue(fileType)} 파일만 업로드할 수 있습니다.`)
      return
    }

    const uploadKey = draftId || `${subproductId}:${fileTypeId}`
    setSubproductUploadingKeys((current) => [...current, uploadKey])
    try {
      const formData = new FormData()
      formData.append('fileTypeId', fileTypeId)
      formData.append('file', file)

      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/items/${form.id}/subproducts/${subproductId}/files`, workspaceSubject), {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 파일 업로드에 실패했습니다.')
      }

      await refreshEditingFiles(form.id)
      if (draftId) {
        handleRemoveSubproductFileDraft(draftId)
      }
      toast.success(`${fileType.label} 파일을 업로드했습니다.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 파일 업로드 중 오류가 발생했습니다.')
    } finally {
      setSubproductUploadingKeys((current) => current.filter((currentKey) => currentKey !== uploadKey))
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

  const canOpenSamplePreview = Boolean(form.id && samplePages.length > 0 && !isSampleSourceUploading)
  const sampleGenerationStatusLabel = sampleGenerationStep === 'rendering'
    ? 'PDF 렌더링 중'
    : sampleGenerationStep === 'requesting_upload_targets'
      ? '업로드 준비 중'
      : sampleGenerationStep === 'uploading'
        ? '업로드 중'
        : sampleGenerationStep === 'finalizing'
          ? '저장 중'
          : '샘플 생성 중'
  const samplePreviewStatusLabel = isSampleSourceUploading ? sampleGenerationStatusLabel : samplePages.length > 0 ? '확인 가능' : '샘플 없음'
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
              setSelectedItemIds([])
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

            <div className="rounded-lg border bg-slate-50/60 p-4 text-sm text-gray-600">
              <p className="font-medium text-gray-900">판매 구성 안내</p>
              <p className="mt-1">PDF/HWP/ZIP 개별 가격은 더 이상 여기에서 직접 판매하지 않습니다. 아래 서브상품에 파일을 여러 개 연결하고, 서브상품별 가격 또는 전체 한번에 구매하기 가격을 설정하세요.</p>
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
                  <p className="font-medium text-gray-900">샘플 생성</p>
                  <p className="text-sm text-gray-500">브라우저에서 샘플 JPG를 생성한 뒤 업로드합니다. 샘플로 사용할 페이지 번호만 JPG로 생성합니다.</p>
                </div>
                <Badge variant={samplePages.length > 0 ? 'outline' : 'secondary'}>{samplePreviewStatusLabel}</Badge>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>샘플 페이지</Label>
                  <Input
                    value={samplePageSelection}
                    onChange={(event) => setSamplePageSelection(event.target.value)}
                    placeholder="예: 1,5,7"
                  />
                  <p className="text-xs text-gray-500">쉼표로 페이지 번호를 입력합니다. 예: 1,5,7</p>
                </div>
                <input
                  ref={sampleSourceInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,application/pdf"
                  disabled={isSampleSourceUploading}
                  onChange={(event) => handleSelectSampleSourceFile(event.target.files?.[0])}
                />
                <label
                  onDragEnter={(event) => {
                    if (isSampleSourceUploading) return
                    event.preventDefault()
                    setIsSampleSourceDragActive(true)
                  }}
                  onDragOver={(event) => {
                    if (isSampleSourceUploading) return
                    event.preventDefault()
                    setIsSampleSourceDragActive(true)
                  }}
                  onDragLeave={(event) => {
                    if (isSampleSourceUploading) return
                    event.preventDefault()
                    setIsSampleSourceDragActive(false)
                  }}
                  onDrop={(event) => {
                    if (isSampleSourceUploading) return
                    event.preventDefault()
                    setIsSampleSourceDragActive(false)
                    handleSelectSampleSourceFile(event.dataTransfer.files?.[0])
                  }}
                  className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 py-4 text-center transition ${
                    isSampleSourceDragActive
                      ? 'border-primary bg-primary/5'
                      : selectedSampleSourceFile
                        ? 'border-emerald-300 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                  onClick={() => sampleSourceInputRef.current?.click()}
                >
                  <Upload className={`mb-2 h-5 w-5 ${selectedSampleSourceFile ? 'text-emerald-700' : 'text-slate-500'}`} />
                  <p className={`text-sm font-medium ${selectedSampleSourceFile ? 'text-emerald-900' : 'text-gray-900'}`}>샘플 PDF를 드래그앤드롭하거나 클릭해서 선택하세요.</p>
                  <p className={`mt-1 text-xs ${selectedSampleSourceFile ? 'text-emerald-700' : 'text-gray-500'}`}>
                    {selectedSampleSourceFile ? `선택 파일: ${selectedSampleSourceFile.name}` : 'PDF를 선택한 뒤 샘플 이미지 생성 버튼을 클릭해야 JPG가 생성됩니다.'}
                  </p>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={samplePages.length === 0 || deletingSamplePageId === '__all__'}
                    onClick={() => void handleDeleteAllSamplePages()}
                  >
                    {deletingSamplePageId === '__all__' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    샘플 이미지 전체 삭제
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSampleSourceUploading || !selectedSampleSourceFile}
                    onClick={() => void handleGenerateSampleImages()}
                  >
                    {isSampleSourceUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    샘플 이미지 생성
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
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
              </div>

              {samplePages.length > 0 ? (
                <div className="flex flex-wrap gap-3 pt-2">
                  {samplePages.map((page) => (
                    <div
                      key={page.id}
                      draggable
                      onDragStart={(event) => {
                        setSamplePageDragId(page.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (samplePageDragId) {
                          handleMoveSamplePage(samplePageDragId, page.id)
                        }
                        setSamplePageDragId(null)
                      }}
                      onDragEnd={() => setSamplePageDragId(null)}
                      className={`relative h-24 w-20 cursor-move overflow-hidden rounded border bg-slate-50 shadow-sm transition ${
                        samplePageDragId === page.id ? 'scale-95 opacity-60' : ''
                      }`}
                      title="드래그해서 샘플 이미지 순서를 변경할 수 있습니다."
                    >
                      <div
                        aria-label={`샘플 ${page.pageNumber}페이지`}
                        role="img"
                        className="h-full w-full bg-cover bg-center"
                        style={{ backgroundImage: `url(${page.signedUrl})` }}
                      />
                      <Badge className="absolute bottom-1 left-1 bg-black/60 text-white hover:bg-black/60">p.{page.pageNumber}</Badge>
                      <button
                        type="button"
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                        disabled={deletingSamplePageId === page.id || deletingSamplePageId === '__all__'}
                        aria-label={`${page.pageNumber}페이지 샘플 삭제`}
                        onClick={() => void handleDeleteSamplePage(page)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                  아직 생성된 샘플 JPG가 없습니다.
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <p className="font-medium text-gray-900">서브상품 구성</p>
                <p className="text-sm text-gray-500">서브상품추가+로 판매 단위를 만들고, 각 서브상품 안에서 파일추가+로 PDF/HWP/ZIP 등 파일을 여러 개 업로드합니다.</p>
              </div>

              <div className="rounded-md border bg-slate-50/60 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="font-medium text-gray-900">서브상품 추가+</p>
                  <Badge variant="outline">{subproducts.length}개</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>서브상품 카테고리</Label>
                    <select
                      value={subproductDraft.categoryId}
                      onChange={(event) => {
                        if (event.target.value === MANAGE_SUBPRODUCT_CATEGORIES_VALUE) {
                          setIsCategorySettingsOpen(true)
                          return
                        }

                        setSubproductDraft((current) => ({ ...current, categoryId: event.target.value }))
                      }}
                      className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                    >
                      <option value="">카테고리 선택</option>
                      {activeSubproductCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                      <option value={MANAGE_SUBPRODUCT_CATEGORIES_VALUE}>설정하기</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>서브상품 가격</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={subproductDraft.priceCredits}
                      placeholder="예: 1,000"
                      onChange={(event) => setSubproductDraft((current) => ({ ...current, priceCredits: formatCreditInputValue(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>서브상품 설명</Label>
                    <Textarea value={subproductDraft.description} onChange={(event) => setSubproductDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button type="button" disabled={isSubproductSaving || activeSubproductCategories.length === 0} onClick={() => void handleCreateSubproduct()}>
                    {isSubproductSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    서브상품 추가
                  </Button>
                </div>
              </div>

              {subproducts.length === 0 ? (
                <div className="rounded-md border border-dashed bg-white px-4 py-8 text-center text-sm text-gray-500">
                  아직 등록된 서브상품이 없습니다. 먼저 서브상품을 추가한 뒤 파일을 업로드하세요.
                </div>
              ) : (
                <div className="space-y-3">
                  {subproducts.map((subproduct) => {
                    const filesForSubproduct = subproductFilesBySubproductId.get(subproduct.id) || []

                    return (
                      <div key={subproduct.id} className="space-y-3 rounded-md border bg-white p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-gray-900">{getSubproductCategoryName(subproduct.category_id)}</p>
                              <Badge variant={subproduct.is_active ? 'outline' : 'secondary'}>{subproduct.is_active ? '활성' : '비활성'}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-gray-500">{subproduct.description || '설명이 없습니다.'}</p>
                            <p className="mt-1 text-sm font-medium text-gray-900">{formatCreditInputValue(subproduct.price_credits)} 크레딧 · 파일 {filesForSubproduct.length}개</p>
                          </div>
                          <Button type="button" variant="outline" size="sm" disabled={isSubproductSaving} onClick={() => void handleDeleteSubproduct(subproduct.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
                          </Button>
                        </div>

                        <div className="space-y-3">
                          {filesForSubproduct.length > 0 ? (
                            <div className="space-y-2 rounded-md border bg-slate-50/70 p-3">
                              <p className="text-sm font-medium text-gray-900">업로드된 파일</p>
                              <div className="space-y-2">
                                {filesForSubproduct.map((file) => (
                                  <div key={file.id} className="flex flex-col gap-2 rounded-md border bg-white px-3 py-2 text-sm md:flex-row md:items-center md:justify-between">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">{getFileTypeLabel(file.file_type_id)}</Badge>
                                        <span className="truncate font-medium text-gray-900">{file.original_file_name}</span>
                                        <Badge variant="secondary">v{file.version}</Badge>
                                      </div>
                                      <p className="mt-1 text-xs text-gray-500">{formatFileSize(file.file_size_bytes)} · {formatDateTime(file.created_at)}</p>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => void handleDeleteSubproductFile(subproduct.id, file.id)}>
                                      제거
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                              아직 업로드된 파일이 없습니다. 파일 추가+ 버튼으로 필요한 파일을 하나씩 업로드하세요.
                            </div>
                          )}

                          <div className="flex justify-end">
                            <Button type="button" variant="outline" size="sm" disabled={activeFileTypes.length === 0} onClick={() => handleAddSubproductFileDraft(subproduct.id)}>
                              <Plus className="mr-2 h-4 w-4" />
                              파일 추가+
                            </Button>
                          </div>

                          {activeFileTypes.length === 0 ? (
                            <div className="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                              등록된 파일 유형이 없습니다. 파일 유형 설정에서 PDF/HWP/ZIP 등의 유형을 먼저 등록하세요.
                            </div>
                          ) : null}

                          {subproductFileDrafts.filter((draft) => draft.subproductId === subproduct.id).map((draft) => {
                            const selectedFileType = activeFileTypes.find((fileType) => fileType.id === draft.fileTypeId)
                            const availableFileTypes = getAvailableFileTypesForSubproduct(subproduct.id, draft.id)
                            const isUploading = subproductUploadingKeys.includes(draft.id)
                            const isDragActive = subproductDragActiveKeys.includes(draft.id)
                            const inputId = `subproduct-file-draft-${draft.id}`

                            return (
                              <div key={draft.id} className="space-y-3 rounded-md border p-3">
                                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                  <div className="flex-1 space-y-2">
                                    <Label>파일 유형</Label>
                                    <select
                                      value={draft.fileTypeId}
                                      disabled={isUploading}
                                      onChange={(event) => {
                                        if (event.target.value === MANAGE_FILE_TYPES_VALUE) {
                                          setIsFileTypeSettingsOpen(true)
                                          return
                                        }

                                        handleUpdateSubproductFileDraft(draft.id, { fileTypeId: event.target.value })
                                      }}
                                      className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                                    >
                                      <option value="">파일 유형 선택</option>
                                      {availableFileTypes.map((fileType) => (
                                        <option key={fileType.id} value={fileType.id}>{fileType.label}</option>
                                      ))}
                                      <option value={MANAGE_FILE_TYPES_VALUE}>설정하기</option>
                                    </select>
                                  </div>
                                  <Button type="button" variant="ghost" size="sm" disabled={isUploading} onClick={() => handleRemoveSubproductFileDraft(draft.id)}>
                                    row 삭제
                                  </Button>
                                </div>
                                <input
                                  id={inputId}
                                  type="file"
                                  className="hidden"
                                  accept={selectedFileType ? getFileTypeAcceptValue(selectedFileType) : undefined}
                                  disabled={isUploading || !selectedFileType}
                                  onChange={(event) => void handleSubproductFileUpload(subproduct.id, draft.fileTypeId, event.target.files?.[0], draft.id)}
                                />
                                <label
                                  htmlFor={selectedFileType && !isUploading ? inputId : undefined}
                                  onDragEnter={(event) => {
                                    if (isUploading || !selectedFileType) return
                                    event.preventDefault()
                                    setSubproductDragActive(draft.id, true)
                                  }}
                                  onDragOver={(event) => {
                                    if (isUploading || !selectedFileType) return
                                    event.preventDefault()
                                    setSubproductDragActive(draft.id, true)
                                  }}
                                  onDragLeave={(event) => {
                                    if (isUploading || !selectedFileType) return
                                    event.preventDefault()
                                    setSubproductDragActive(draft.id, false)
                                  }}
                                  onDrop={(event) => {
                                    if (isUploading || !selectedFileType) return
                                    event.preventDefault()
                                    setSubproductDragActive(draft.id, false)
                                    const droppedFiles = Array.from(event.dataTransfer.files || [])
                                    if (droppedFiles.length === 0) return
                                    if (droppedFiles.length > 1) {
                                      toast.message('여러 파일이 드롭되었지만 첫 번째 파일만 업로드합니다.')
                                    }
                                    void handleSubproductFileUpload(subproduct.id, draft.fileTypeId, droppedFiles[0], draft.id)
                                  }}
                                  className={`flex min-h-32 flex-col justify-center rounded-md border border-dashed px-4 py-4 text-left transition ${
                                    isUploading
                                      ? 'cursor-not-allowed border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : !selectedFileType
                                        ? 'cursor-not-allowed border-red-200 bg-red-50/40 text-red-700'
                                        : isDragActive
                                          ? 'cursor-pointer border-primary bg-primary/5'
                                          : 'cursor-pointer border-red-200 bg-red-50/40 hover:border-red-300 hover:bg-red-50'
                                  }`}
                                >
                                  <p className={`text-sm font-medium ${isUploading ? 'text-emerald-900' : 'text-red-900'}`}>드래그앤드랍 또는 클릭하여 업로드</p>
                                  <p className={`mt-1 text-xs ${isUploading ? 'text-emerald-700' : 'text-red-700'}`}>{selectedFileType ? `허용 형식: ${getFileTypeAcceptValue(selectedFileType)}` : '파일 유형을 먼저 선택해주세요.'}</p>
                                  {isUploading ? <p className="mt-2 text-xs text-emerald-700">업로드 중입니다...</p> : null}
                                </label>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">전체 한번에 구매하기</p>
                  <p className="text-sm text-gray-500">옵션을 켜고 금액을 입력하면 등록된 서브상품의 모든 파일을 한 번에 구매할 수 있습니다.</p>
                </div>
                {bundleOption ? <Badge variant="outline">저장됨</Badge> : <Badge variant="secondary">미설정</Badge>}
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">전체구매 옵션 사용</p>
                  <p className="text-xs text-gray-500">기본값은 사용이며, 꺼두면 사용자 상세페이지에 전체구매 카드가 노출되지 않습니다.</p>
                </div>
                <Switch checked={bundleForm.enabled} onCheckedChange={(checked) => setBundleForm((current) => ({ ...current, enabled: checked }))} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>표시명</Label>
                  <Input disabled={!bundleForm.enabled} value={bundleForm.label} onChange={(event) => setBundleForm((current) => ({ ...current, label: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>전체구매 가격</Label>
                  <Input
                    disabled={!bundleForm.enabled}
                    type="text"
                    inputMode="numeric"
                    value={bundleForm.priceCredits}
                    placeholder="예: 10,000"
                    onChange={(event) => setBundleForm((current) => ({ ...current, priceCredits: formatCreditInputValue(event.target.value) }))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>전체구매 설명</Label>
                  <Textarea disabled={!bundleForm.enabled} value={bundleForm.description} onChange={(event) => setBundleForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
                </div>
              </div>
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
                disabled={isSaving}
                className="h-11 flex-1 text-base font-semibold shadow-sm"
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {form.id
                  ? requiresFinalRegistration
                    ? '상품 등록'
                    : '상품 저장'
                  : '상품 등록'}
              </Button>
              <Button type="button" variant="secondary" disabled={isSaving} onClick={() => void handleStatusAction('draft')}>
                임시저장
              </Button>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => void handleStatusAction('hidden')}>
                숨김
              </Button>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => void handleStatusAction('published')}>
                공개
              </Button>
              {form.id ? (
                <Button type="button" variant="destructive" disabled={isArchiving} onClick={handleArchive}>
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
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>상품 목록</CardTitle>
                <p className="mt-1 text-sm text-gray-500">선택 {selectedItems.length}개</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={selectedItems.length === 0 || isBulkActionRunning}
                  onClick={() => void handleBulkVisibility()}
                >
                  {isBulkActionRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <EyeOff className="mr-2 h-4 w-4" />}
                  선택 숨김
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={selectedItems.length === 0 || isBulkActionRunning}
                  onClick={() => setBulkDeleteTargetIds(selectedItems.map((item) => item.id))}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  선택 삭제
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[52px] text-center">
                      <Checkbox
                        aria-label="상품 전체 선택"
                        checked={allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false}
                        disabled={filteredItems.length === 0 || isBulkActionRunning}
                        onCheckedChange={() => toggleFilteredSelection()}
                      />
                    </TableHead>
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
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-gray-500">
                        등록된 상품이 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => {
                      const isHidden = item.status === 'hidden' || hiddenItemIds.includes(item.id)

                      return (
                        <TableRow key={item.id}>
                          <TableCell className="text-center">
                            <Checkbox
                              aria-label={`${item.title} 선택`}
                              checked={selectedItemIds.includes(item.id)}
                              disabled={isBulkActionRunning}
                              onCheckedChange={() => toggleItemSelection(item.id)}
                            />
                          </TableCell>
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
                            <div>PDF {item.pdf_price.toLocaleString()}C</div>
                            <div>HWP {item.hwp_price.toLocaleString()}C</div>
                            <div>ZIP {item.zip_price.toLocaleString()}C</div>
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


      <Dialog open={isCategorySettingsOpen} onOpenChange={(open) => {
        setIsCategorySettingsOpen(open)
        if (!open) {
          resetCategorySettingsForm()
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>서브상품 카테고리 설정</DialogTitle>
            <DialogDescription>서브상품 카테고리를 추가, 수정, 삭제할 수 있습니다. 사용 중인 카테고리는 삭제가 제한될 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">카테고리 목록</p>
              <div className="space-y-2">
                {subproductCategories.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-gray-500">등록된 카테고리가 없습니다.</div>
                ) : subproductCategories.map((category) => (
                  <div key={category.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{category.name}</span>
                        <Badge variant={category.is_active ? 'outline' : 'secondary'}>{category.is_active ? '활성' : '비활성'}</Badge>
                      </div>
                      <p className="truncate text-xs text-gray-500">{category.slug} · 정렬 {category.sort_order}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleEditCategorySettings(category)}>수정</Button>
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={deletingCategoryId === category.id} onClick={() => void handleDeleteCategorySettings(category.id)}>
                        {deletingCategoryId === category.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '삭제'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-md border bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">{editingCategoryId ? '카테고리 수정' : '카테고리 추가'}</p>
                {editingCategoryId ? <Button type="button" variant="ghost" size="sm" onClick={resetCategorySettingsForm}>새로 추가</Button> : null}
              </div>
              <div className="space-y-2">
                <Label>이름</Label>
                <Input value={categorySettingsForm.name} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: 워크북" />
              </div>
              <div className="space-y-2">
                <Label>slug</Label>
                <Input value={categorySettingsForm.slug} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, slug: event.target.value }))} placeholder="예: workbook" />
              </div>
              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea value={categorySettingsForm.description} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
              </div>
              <div className="space-y-2">
                <Label>정렬 순서</Label>
                <Input type="number" min={0} value={categorySettingsForm.sortOrder} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                <Label>활성화</Label>
                <Switch checked={categorySettingsForm.isActive} onCheckedChange={(checked) => setCategorySettingsForm((current) => ({ ...current, isActive: checked }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCategorySettingsOpen(false)}>닫기</Button>
            <Button type="button" disabled={isCategorySettingsSaving} onClick={() => void handleSaveCategorySettings()}>
              {isCategorySettingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isFileTypeSettingsOpen} onOpenChange={(open) => {
        setIsFileTypeSettingsOpen(open)
        if (!open) {
          resetFileTypeSettingsForm()
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>파일 유형 설정</DialogTitle>
            <DialogDescription>서브상품에 업로드할 파일 유형을 추가, 수정, 삭제할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">파일 유형 목록</p>
              <div className="space-y-2">
                {fileTypes.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-gray-500">등록된 파일 유형이 없습니다.</div>
                ) : fileTypes.map((fileType) => (
                  <div key={fileType.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{fileType.label}</span>
                        <Badge variant={fileType.is_active ? 'outline' : 'secondary'}>{fileType.is_active ? '활성' : '비활성'}</Badge>
                      </div>
                      <p className="truncate text-xs text-gray-500">{fileType.code} · .{fileType.extension} · 정렬 {fileType.sort_order}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleEditFileTypeSettings(fileType)}>수정</Button>
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={deletingFileTypeId === fileType.id} onClick={() => void handleDeleteFileTypeSettings(fileType.id)}>
                        {deletingFileTypeId === fileType.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '삭제'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-md border bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">{editingFileTypeId ? '파일 유형 수정' : '파일 유형 추가'}</p>
                {editingFileTypeId ? <Button type="button" variant="ghost" size="sm" onClick={resetFileTypeSettingsForm}>새로 추가</Button> : null}
              </div>
              <div className="space-y-2">
                <Label>코드</Label>
                <Input value={fileTypeSettingsForm.code} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, code: event.target.value }))} placeholder="예: pdf" />
              </div>
              <div className="space-y-2">
                <Label>표시명</Label>
                <Input value={fileTypeSettingsForm.label} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, label: event.target.value }))} placeholder="예: PDF" />
              </div>
              <div className="space-y-2">
                <Label>확장자</Label>
                <Input value={fileTypeSettingsForm.extension} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, extension: event.target.value }))} placeholder="예: pdf" />
              </div>
              <div className="space-y-2">
                <Label>MIME 허용 목록</Label>
                <Textarea value={fileTypeSettingsForm.mimeAllowlist} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, mimeAllowlist: event.target.value }))} className="min-h-[72px]" placeholder="한 줄 또는 쉼표로 구분" />
              </div>
              <div className="space-y-2">
                <Label>정렬 순서</Label>
                <Input type="number" min={0} value={fileTypeSettingsForm.sortOrder} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                <Label>활성화</Label>
                <Switch checked={fileTypeSettingsForm.isActive} onCheckedChange={(checked) => setFileTypeSettingsForm((current) => ({ ...current, isActive: checked }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsFileTypeSettingsOpen(false)}>닫기</Button>
            <Button type="button" disabled={isFileTypeSettingsSaving} onClick={() => void handleSaveFileTypeSettings()}>
              {isFileTypeSettingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <AlertDialog open={!!bulkDeleteTargetIds} onOpenChange={(open) => !open && !isBulkActionRunning && setBulkDeleteTargetIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>선택한 문제마켓 상품 {bulkDeleteTargetIds?.length ?? 0}개를 완전 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              DB 데이터와 업로드된 파일이 모두 삭제되며 되돌릴 수 없습니다.
              {bulkDeleteTargetItems.length > 0 ? (
                <span className="mt-2 block text-gray-700">
                  {bulkDeleteTargetItems.slice(0, 3).map((item) => item.title).join(', ')}
                  {bulkDeleteTargetItems.length > 3 ? ` 외 ${bulkDeleteTargetItems.length - 3}개` : ''}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkActionRunning}>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={isBulkActionRunning}
              onClick={(event) => {
                event.preventDefault()
                void handleBulkDelete()
              }}
            >
              {isBulkActionRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              완전 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
