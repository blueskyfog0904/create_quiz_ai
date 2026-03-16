'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  LayoutPanelTop,
  Loader2,
  Pencil,
  Plus,
  Save,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  flattenHeaderNavigationItems,
  getActiveHeaderNavigationItems,
  isSafeHeaderHref,
  MAX_LOGO_TEXT_LENGTH,
  MAX_MENU_TITLE_LENGTH,
  resolveHeaderMenuHref,
  type HeaderMenuChildItem,
  type HeaderMenuItem,
  type HeaderNavigationConfig,
} from '@/lib/header-navigation'
import {
  buildGenerateMenuHref,
  LISTBOARD_GRADE_OPTIONS,
  mergeGenerateEntriesIntoHeaderConfig,
  normalizeListboardGradeLevel,
  type GenerateListboardPost,
  type GenerateListboardPostItem,
  type GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'
import {
  archiveGenerateListboardPostItemAction,
  archiveGenerateListboardPostAction,
  archiveGenerateMenuEntryAction,
  backfillGenerateMenuEntriesAction,
  createGenerateListboardPostItemAction,
  createGenerateListboardPostWithItemsAction,
  createGenerateMenuEntryAction,
  getGenerateListboardPostItemsAction,
  getGenerateListboardPostsAction,
  reorderGenerateMenuEntriesAction,
  saveMenuManagementConfig,
  updateGenerateListboardPostItemAction,
  updateGenerateListboardPostAction,
  updateGenerateMenuEntryAction,
  type MenuManagementPageData,
} from './actions'

type MenuManagementClientProps = MenuManagementPageData

type DialogMode = 'create-parent' | 'edit-parent' | 'create-child' | 'edit-child'

interface MenuDialogState {
  mode: DialogMode
  targetId?: string
  parentId?: string
}

interface MenuFormState {
  title: string
  href: string
  parentId: string
}

interface GenerateEntryFormState {
  id?: string
  title: string
  slug: string
  description: string
  sortOrder: number
  isVisible: boolean
  isActive: boolean
  entryType: 'personal_generate' | 'listboard'
  postCount: number
}

interface GeneratePostFormState {
  id?: string
  menuEntryId: string
  title: string
  passageText: string
  csvFileName: string
  csvItems: GeneratePostCsvItem[]
  examYear: string
  examMonth: string
  gradeLevel: string
  status: 'draft' | 'published' | 'archived'
  isActive: boolean
}

interface GeneratePostCsvItem {
  questionNumber: string
  passageText: string
  sortOrder: number
  isActive: boolean
}

interface GeneratePostItemFormState {
  clientId: string
  id?: string
  questionNumber: string
  passageText: string
  sortOrder: number
  isActive: boolean
}

const MIN_EXAM_YEAR = 2000
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

async function parseGeneratePostCsvFile(file: File): Promise<{ fileName: string, items: GeneratePostCsvItem[] }> {
  const fileName = file.name.toLowerCase()
  if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
    throw new Error('.csv 또는 .xlsx 파일만 업로드할 수 있습니다.')
  }

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    throw new Error('업로드한 파일에 시트가 없습니다.')
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  })

  if (rows.length < 2) {
    throw new Error('헤더와 데이터가 포함된 파일을 업로드해주세요.')
  }

  const [header, ...bodyRows] = rows
  const normalizedHeader = header.map((cell) => String(cell ?? '').trim().toLowerCase())

  if (normalizedHeader[0] !== 'question_number' || normalizedHeader[1] !== 'passage_text') {
    throw new Error('첫 번째 열은 question_number, 두 번째 열은 passage_text 여야 합니다.')
  }

  const items = bodyRows
    .map((row, index) => ({
      questionNumber: String(row[0] ?? '').trim(),
      passageText: String(row[1] ?? '').trim(),
      sortOrder: (index + 1) * 10,
      isActive: true,
    }))
    .filter((row) => row.questionNumber || row.passageText)

  if (items.length === 0) {
    throw new Error('저장할 문항이 없습니다.')
  }

  const invalidRow = items.find((item) => !item.questionNumber || !item.passageText)
  if (invalidRow) {
    throw new Error('문항 번호와 지문 내용이 모두 채워진 행만 업로드할 수 있습니다.')
  }

  const duplicate = items.find((item, index) => items.findIndex((candidate) => candidate.questionNumber === item.questionNumber) !== index)
  if (duplicate) {
    throw new Error(`문항 번호 "${duplicate.questionNumber}"가 중복되었습니다.`)
  }

  return {
    fileName: file.name,
    items,
  }
}

function getDefaultExamDate() {
  const today = new Date()
  return {
    examYear: String(today.getFullYear()),
    examMonth: String(today.getMonth() + 1),
  }
}

function buildExamYearOptions(baseYear = new Date().getFullYear()) {
  return Array.from({ length: Math.max(baseYear - MIN_EXAM_YEAR + 1, 1) }, (_, index) => String(baseYear - index))
}

function cloneConfig(config: HeaderNavigationConfig): HeaderNavigationConfig {
  return {
    logoText: config.logoText,
    items: config.items.map((item) => ({
      ...item,
      children: item.children.map((child) => ({ ...child })),
    })),
  }
}

function moveArrayItem<T>(items: T[], index: number, direction: 'up' | 'down') {
  const nextIndex = direction === 'up' ? index - 1 : index + 1
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items
  }

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(index, 1)
  nextItems.splice(nextIndex, 0, movedItem)
  return nextItems
}

function buildEmptyMenuForm(parentId?: string): MenuFormState {
  return {
    title: '',
    href: '',
    parentId: parentId || '',
  }
}

function buildEmptyGenerateEntryForm(): GenerateEntryFormState {
  return {
    title: '',
    slug: '',
    description: '',
    sortOrder: 10,
    isVisible: true,
    isActive: true,
    entryType: 'listboard',
    postCount: 0,
  }
}

function buildGenerateEntryForm(entry: GenerateMenuEntryAdminRow): GenerateEntryFormState {
  return {
    id: entry.id,
    title: entry.title,
    slug: entry.slug,
    description: entry.description || '',
    sortOrder: entry.sort_order,
    isVisible: entry.is_visible,
    isActive: entry.is_active,
    entryType: entry.entry_type as 'personal_generate' | 'listboard',
    postCount: entry.postCount,
  }
}

function buildEmptyGeneratePostForm(menuEntryId: string): GeneratePostFormState {
  const { examYear, examMonth } = getDefaultExamDate()

  return {
    menuEntryId,
    title: '',
    passageText: '',
    csvFileName: '',
    csvItems: [],
    examYear,
    examMonth,
    gradeLevel: '',
    status: 'published',
    isActive: true,
  }
}

function buildGeneratePostForm(post: GenerateListboardPost): GeneratePostFormState {
  const { examYear, examMonth } = getDefaultExamDate()

  return {
    id: post.id,
    menuEntryId: post.menu_entry_id,
    title: post.title,
    passageText: post.passage_text,
    csvFileName: '',
    csvItems: [],
    examYear: post.exam_year ? String(post.exam_year) : examYear,
    examMonth: post.exam_month ? String(post.exam_month) : examMonth,
    gradeLevel: normalizeListboardGradeLevel(post.grade_level) || '',
    status: post.status as 'draft' | 'published' | 'archived',
    isActive: post.is_active,
  }
}

function buildGeneratePostItemForm(item?: GenerateListboardPostItem, index = 0): GeneratePostItemFormState {
  return {
    clientId: item?.id ?? crypto.randomUUID(),
    id: item?.id,
    questionNumber: item?.question_number ?? '',
    passageText: item?.passage_text ?? '',
    sortOrder: item?.sort_order ?? (index + 1) * 10,
    isActive: item?.is_active ?? true,
  }
}

function getRepresentativePassageText(items: GeneratePostItemFormState[]) {
  const representativeItem = items.find((item) => item.isActive) ?? items[0]
  return representativeItem?.passageText ?? ''
}

export default function MenuManagementClient({
  initialConfig,
  generateMenuEntries: initialGenerateMenuEntries,
  initialGeneratePosts,
  initialSelectedBoardId,
  generateChildrenSourceMode,
  hasGenerateParent,
  backfillStatus,
}: MenuManagementClientProps) {
  const router = useRouter()
  const [config, setConfig] = useState<HeaderNavigationConfig>(() => cloneConfig(initialConfig))
  const [savedConfig, setSavedConfig] = useState<HeaderNavigationConfig>(() => cloneConfig(initialConfig))
  const [logoText, setLogoText] = useState(initialConfig.logoText)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [dialogState, setDialogState] = useState<MenuDialogState | null>(null)
  const [formState, setFormState] = useState<MenuFormState>(buildEmptyMenuForm())
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; parentId?: string; hasChildren?: boolean } | null>(null)

  const [generateMenuEntries, setGenerateMenuEntries] = useState(initialGenerateMenuEntries)
  const [isGenerateEntryDialogOpen, setIsGenerateEntryDialogOpen] = useState(false)
  const [generateEntryForm, setGenerateEntryForm] = useState<GenerateEntryFormState>(buildEmptyGenerateEntryForm())
  const [isMutatingGenerateEntries, setIsMutatingGenerateEntries] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<GenerateMenuEntryAdminRow | null>(null)
  const [isBackfilling, setIsBackfilling] = useState(false)

  const [selectedBoardId, setSelectedBoardId] = useState(initialSelectedBoardId || '')
  const [generatePosts, setGeneratePosts] = useState(initialGeneratePosts)
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false)
  const [postForm, setPostForm] = useState<GeneratePostFormState>(buildEmptyGeneratePostForm(initialSelectedBoardId || ''))
  const [isSavingPost, setIsSavingPost] = useState(false)
  const [archivePostTarget, setArchivePostTarget] = useState<GenerateListboardPost | null>(null)
  const [postItems, setPostItems] = useState<GeneratePostItemFormState[]>([])
  const [isLoadingPostItems, setIsLoadingPostItems] = useState(false)
  const [savingPostItemClientIds, setSavingPostItemClientIds] = useState<string[]>([])
  const [archivePostItemTarget, setArchivePostItemTarget] = useState<GeneratePostItemFormState | null>(null)
  const activePostItemsRequestRef = useRef<string | null>(null)

  const editableConfig = useMemo(() => ({
    ...config,
    items: config.items.map((item) => item.href === '/generate' ? { ...item, children: [] } : item),
  }), [config])

  const flatRows = useMemo(() => flattenHeaderNavigationItems(editableConfig.items), [editableConfig.items])
  const previewConfig = useMemo(() => mergeGenerateEntriesIntoHeaderConfig(config, generateMenuEntries, generateChildrenSourceMode), [config, generateMenuEntries, generateChildrenSourceMode])
  const activePreviewItems = useMemo(() => getActiveHeaderNavigationItems(previewConfig.items), [previewConfig.items])
  const selectedParent = useMemo(
    () => editableConfig.items.find((item) => item.id === formState.parentId || item.id === dialogState?.parentId),
    [editableConfig.items, dialogState?.parentId, formState.parentId]
  )
  const childResolvedHrefPreview = useMemo(() => {
    if (dialogState?.mode !== 'create-child' && dialogState?.mode !== 'edit-child') {
      return ''
    }

    const href = formState.href.trim()
    if (!href) return ''

    return resolveHeaderMenuHref(selectedParent?.href, href)
  }, [dialogState?.mode, formState.href, selectedParent?.href])

  const listboardEntries = useMemo(
    () => generateMenuEntries.filter((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null),
    [generateMenuEntries]
  )
  const examYearOptions = useMemo(() => {
    const candidateYears = [
      ...generatePosts.map((post) => post.exam_year).filter((value): value is number => value !== null).map(String),
      postForm.examYear,
    ]
    const baseYear = Math.max(
      ...candidateYears.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      Number(getDefaultExamDate().examYear)
    )

    return buildExamYearOptions(baseYear)
  }, [generatePosts, postForm.examYear])
  const selectedBoard = listboardEntries.find((entry) => entry.id === selectedBoardId) || listboardEntries[0] || null
  const hasUnsavedChanges = JSON.stringify({ ...config, logoText }) !== JSON.stringify(savedConfig)

  const closeDialog = () => {
    setIsDialogOpen(false)
    setDialogState(null)
    setFormState(buildEmptyMenuForm())
  }

  const closeGenerateEntryDialog = () => {
    setGenerateEntryForm(buildEmptyGenerateEntryForm())
    setIsGenerateEntryDialogOpen(false)
  }

  const closePostDialog = () => {
    activePostItemsRequestRef.current = null
    setIsLoadingPostItems(false)
    setPostForm(buildEmptyGeneratePostForm(selectedBoard?.id || ''))
    setPostItems([])
    setIsPostDialogOpen(false)
  }

  const updateConfigItems = (updater: (items: HeaderMenuItem[]) => HeaderMenuItem[]) => {
    setConfig((current) => ({
      ...current,
      items: updater(current.items),
    }))
  }

  const refreshRoute = () => router.refresh()

  const loadBoardPosts = async (boardId: string) => {
    setSelectedBoardId(boardId)
    setIsLoadingPosts(true)
    try {
      const response = await getGenerateListboardPostsAction(boardId)
      setGeneratePosts(response.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoadingPosts(false)
    }
  }

  const openParentCreateDialog = () => {
    setDialogState({ mode: 'create-parent' })
    setFormState(buildEmptyMenuForm())
    setIsDialogOpen(true)
  }

  const openParentEditDialog = (item: HeaderMenuItem) => {
    if (item.href === '/generate') {
      toast.info('AI문제생성 하위 메뉴는 아래 별도 섹션에서 관리됩니다.')
      return
    }

    setDialogState({ mode: 'edit-parent', targetId: item.id })
    setFormState({ title: item.title, href: item.href || '', parentId: '' })
    setIsDialogOpen(true)
  }

  const openChildCreateDialog = (parentId: string) => {
    const parent = editableConfig.items.find((item) => item.id === parentId)
    if (parent?.href === '/generate') {
      toast.info('문제생성 하위 메뉴는 아래 별도 섹션에서 관리됩니다.')
      return
    }

    setDialogState({ mode: 'create-child', parentId })
    setFormState(buildEmptyMenuForm(parentId))
    setIsDialogOpen(true)
  }

  const openChildEditDialog = (parentId: string, child: HeaderMenuChildItem) => {
    const parent = editableConfig.items.find((item) => item.id === parentId)
    if (parent?.href === '/generate') {
      toast.info('문제생성 하위 메뉴는 아래 별도 섹션에서 관리됩니다.')
      return
    }

    setDialogState({ mode: 'edit-child', targetId: child.id, parentId })
    setFormState({ title: child.title, href: child.href, parentId })
    setIsDialogOpen(true)
  }

  const handleMoveParent = (index: number, direction: 'up' | 'down') => {
    updateConfigItems((items) => moveArrayItem(items, index, direction))
  }

  const handleMoveChild = (parentId: string, childIndex: number, direction: 'up' | 'down') => {
    updateConfigItems((items) => items.map((item) => {
      if (item.id !== parentId) return item
      return { ...item, children: moveArrayItem(item.children, childIndex, direction) }
    }))
  }

  const handleToggleParent = (id: string, checked: boolean) => {
    updateConfigItems((items) => items.map((item) => item.id === id ? { ...item, isActive: checked } : item))
  }

  const handleToggleChild = (parentId: string, childId: string, checked: boolean) => {
    updateConfigItems((items) => items.map((item) => {
      if (item.id !== parentId) return item
      return {
        ...item,
        children: item.children.map((child) => child.id === childId ? { ...child, isActive: checked } : child),
      }
    }))
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return

    updateConfigItems((items) => {
      if (deleteTarget.parentId) {
        return items.map((item) => {
          if (item.id !== deleteTarget.parentId) return item
          return { ...item, children: item.children.filter((child) => child.id !== deleteTarget.id) }
        })
      }

      return items.filter((item) => item.id !== deleteTarget.id)
    })

    setDeleteTarget(null)
    toast.success('메뉴를 삭제했습니다.')
  }

  const handleSubmitMenu = () => {
    if (!dialogState) return

    const title = formState.title.trim()
    const href = formState.href.trim()
    const selectedParentId = formState.parentId || dialogState.parentId
    const parentItem = selectedParentId ? editableConfig.items.find((item) => item.id === selectedParentId) : null

    if (!title) {
      toast.error('메뉴명을 입력해주세요.')
      return
    }

    if (title.length > MAX_MENU_TITLE_LENGTH) {
      toast.error(`메뉴명은 ${MAX_MENU_TITLE_LENGTH}자 이하로 입력해주세요.`)
      return
    }

    if (href && !isSafeHeaderHref(href)) {
      toast.error('링크는 / 또는 http/https 형식으로 입력해주세요.')
      return
    }

    if ((dialogState.mode === 'create-parent' || dialogState.mode === 'edit-parent') && !href) {
      const editingParent = dialogState.targetId ? editableConfig.items.find((item) => item.id === dialogState.targetId) : null
      if (!editingParent?.children.length) {
        toast.error('상위 메뉴 링크를 입력해주세요.')
        return
      }
    }

    if (dialogState.mode === 'create-parent') {
      updateConfigItems((items) => ([...items, {
        id: crypto.randomUUID(),
        title,
        href,
        isActive: true,
        children: [],
      }]))
    }

    if (dialogState.mode === 'edit-parent') {
      updateConfigItems((items) => items.map((item) => item.id === dialogState.targetId ? {
        ...item,
        title,
        href: href || undefined,
      } : item))
    }

    if (dialogState.mode === 'create-child') {
      const parentId = selectedParentId
      if (!parentId || !href) {
        toast.error('상위 메뉴와 링크를 확인해주세요.')
        return
      }

      if (href.startsWith('/') && !parentItem?.href?.startsWith('/')) {
        toast.error('하위 경로를 만들려면 상위 메뉴 링크를 먼저 입력해주세요.')
        return
      }

      updateConfigItems((items) => items.map((item) => item.id === parentId ? {
        ...item,
        children: [...item.children, { id: crypto.randomUUID(), title, href, isActive: true }],
      } : item))
    }

    if (dialogState.mode === 'edit-child') {
      const parentId = selectedParentId
      const targetId = dialogState.targetId
      if (!parentId || !targetId || !href) {
        toast.error('수정할 하위 메뉴 정보를 확인해주세요.')
        return
      }

      if (href.startsWith('/') && !parentItem?.href?.startsWith('/')) {
        toast.error('하위 경로를 만들려면 상위 메뉴 링크를 먼저 입력해주세요.')
        return
      }

      const currentChild = editableConfig.items.flatMap((item) => item.children).find((child) => child.id === targetId)
      const movedChild: HeaderMenuChildItem = {
        id: targetId,
        title,
        href,
        isActive: currentChild?.isActive ?? true,
      }

      updateConfigItems((items) => items.map((item) => {
        const remainingChildren = item.children.filter((child) => child.id !== targetId)
        return item.id === parentId ? { ...item, children: [...remainingChildren, movedChild] } : { ...item, children: remainingChildren }
      }))
    }

    closeDialog()
    toast.success(dialogState.mode.startsWith('create') ? '메뉴를 추가했습니다.' : '메뉴를 수정했습니다.')
  }

  const handleSaveAll = async () => {
    const nextLogoText = logoText.trim()

    if (!nextLogoText) {
      toast.error('로고 문구를 입력해주세요.')
      return
    }

    if (nextLogoText.length > MAX_LOGO_TEXT_LENGTH) {
      toast.error(`로고 문구는 ${MAX_LOGO_TEXT_LENGTH}자 이하로 입력해주세요.`)
      return
    }

    setIsSaving(true)
    try {
      const response = await saveMenuManagementConfig({ ...config, logoText: nextLogoText })
      if (!response.success) {
        throw new Error('저장에 실패했습니다.')
      }

      setConfig(response.data)
      setSavedConfig(response.data)
      setLogoText(response.data.logoText)
      toast.success('일반 헤더 메뉴 설정을 저장했습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const openCreateGenerateEntryDialog = () => {
    const nextSortOrder = generateMenuEntries.length === 0 ? 10 : Math.max(...generateMenuEntries.map((entry) => entry.sort_order)) + 10
    setGenerateEntryForm({ ...buildEmptyGenerateEntryForm(), sortOrder: nextSortOrder })
    setIsGenerateEntryDialogOpen(true)
  }

  const openEditGenerateEntryDialog = (entry: GenerateMenuEntryAdminRow) => {
    setGenerateEntryForm(buildGenerateEntryForm(entry))
    setIsGenerateEntryDialogOpen(true)
  }

  const persistGenerateEntryState = (nextEntries: GenerateMenuEntryAdminRow[]) => {
    setGenerateMenuEntries(nextEntries.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko')))
  }

  const handleSubmitGenerateEntry = async () => {
    const title = generateEntryForm.title.trim()
    const slug = generateEntryForm.entryType === 'personal_generate' ? 'personal' : generateEntryForm.slug.trim()

    if (!title || !slug) {
      toast.error('메뉴명과 slug를 입력해주세요.')
      return
    }

    setIsMutatingGenerateEntries(true)
    try {
      const searchConfig = generateEntryForm.entryType === 'listboard'
        ? { filters: ['year', 'month', 'grade', 'title'], entryHref: buildGenerateMenuHref({ entry_type: generateEntryForm.entryType, slug }) }
        : { entryHref: '/generate' }

      if (generateEntryForm.id) {
        const response = await updateGenerateMenuEntryAction(generateEntryForm.id, {
          title,
          slug,
          description: generateEntryForm.description,
          sort_order: generateEntryForm.sortOrder,
          is_visible: generateEntryForm.isVisible,
          is_active: generateEntryForm.isActive,
          search_config: searchConfig,
        })
        const existing = generateMenuEntries.find((entry) => entry.id === generateEntryForm.id)
        persistGenerateEntryState(generateMenuEntries.map((entry) => entry.id === generateEntryForm.id ? {
          ...response.data,
          postCount: existing?.postCount ?? 0,
        } : entry))
        toast.success('문제생성 메뉴를 수정했습니다.')
      } else {
        const response = await createGenerateMenuEntryAction({
          title,
          slug,
          entry_type: generateEntryForm.entryType,
          description: generateEntryForm.description,
          sort_order: generateEntryForm.sortOrder,
          is_visible: generateEntryForm.isVisible,
          is_active: generateEntryForm.isActive,
          search_config: searchConfig,
        })
        persistGenerateEntryState([...generateMenuEntries, { ...response.data, postCount: 0 }])
        toast.success('문제생성 메뉴를 추가했습니다.')
      }

      closeGenerateEntryDialog()
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제생성 메뉴 저장에 실패했습니다.')
    } finally {
      setIsMutatingGenerateEntries(false)
    }
  }

  const handleArchiveGenerateEntry = async () => {
    if (!archiveTarget) return

    setIsMutatingGenerateEntries(true)
    try {
      await archiveGenerateMenuEntryAction(archiveTarget.id)
      const nextEntries = generateMenuEntries.filter((entry) => entry.id !== archiveTarget.id)
      persistGenerateEntryState(nextEntries)
      const nextSelectedBoard = nextEntries.find((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null)
      if (!nextSelectedBoard) {
        setSelectedBoardId('')
        setGeneratePosts([])
      } else if (selectedBoardId === archiveTarget.id) {
        await loadBoardPosts(nextSelectedBoard.id)
      }
      setArchiveTarget(null)
      toast.success('문제생성 메뉴를 보관 처리했습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제생성 메뉴 보관에 실패했습니다.')
    } finally {
      setIsMutatingGenerateEntries(false)
    }
  }

  const handleMoveGenerateEntry = async (index: number, direction: 'up' | 'down') => {
    const nextEntries = moveArrayItem(generateMenuEntries, index, direction).map((entry, nextIndex) => ({
      ...entry,
      sort_order: (nextIndex + 1) * 10,
    }))

    setGenerateMenuEntries(nextEntries)
    try {
      await reorderGenerateMenuEntriesAction(nextEntries.map((entry) => entry.id))
      toast.success('정렬 순서를 저장했습니다.')
      refreshRoute()
    } catch (error) {
      setGenerateMenuEntries(generateMenuEntries)
      toast.error(error instanceof Error ? error.message : '정렬 순서 저장에 실패했습니다.')
    }
  }

  const handleBackfillGenerateChildren = async () => {
    setIsBackfilling(true)
    try {
      await backfillGenerateMenuEntriesAction()
      toast.success('기존 문제생성 메뉴를 DB 메뉴로 가져왔습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기존 메뉴 가져오기에 실패했습니다.')
    } finally {
      setIsBackfilling(false)
    }
  }

  const openCreatePostDialog = () => {
    if (!selectedBoard) {
      toast.error('게시글을 등록할 리스트보드를 먼저 선택해주세요.')
      return
    }

    activePostItemsRequestRef.current = null
    setIsLoadingPostItems(false)
    setPostForm(buildEmptyGeneratePostForm(selectedBoard.id))
    setPostItems([])
    setIsPostDialogOpen(true)
  }

  const openEditPostDialog = async (post: GenerateListboardPost) => {
    activePostItemsRequestRef.current = post.id
    setPostForm(buildGeneratePostForm(post))
    setIsPostDialogOpen(true)

    setIsLoadingPostItems(true)
    try {
      const response = await getGenerateListboardPostItemsAction(post.id)
      if (activePostItemsRequestRef.current !== post.id) {
        return
      }
      setPostItems(response.data.map((item, index) => buildGeneratePostItemForm(item, index)))
    } catch (error) {
      if (activePostItemsRequestRef.current !== post.id) {
        return
      }
      setPostItems([])
      toast.error(error instanceof Error ? error.message : '문항 목록을 불러오지 못했습니다.')
    } finally {
      if (activePostItemsRequestRef.current === post.id) {
        setIsLoadingPostItems(false)
      }
    }
  }

  const handlePostCsvFileChange = async (file?: File) => {
    if (!file) {
      setPostForm((current) => ({ ...current, csvFileName: '', csvItems: [] }))
      return
    }

    try {
      const parsed = await parseGeneratePostCsvFile(file)
      setPostForm((current) => ({
        ...current,
        csvFileName: parsed.fileName,
        csvItems: parsed.items,
      }))
      toast.success(`CSV에서 ${parsed.items.length}개 문항을 불러왔습니다.`)
    } catch (error) {
      setPostForm((current) => ({ ...current, csvFileName: '', csvItems: [] }))
      toast.error(error instanceof Error ? error.message : 'CSV 파일을 읽지 못했습니다.')
    }
  }

  const handleAddPostItemRow = () => {
    setPostItems((current) => [...current, buildGeneratePostItemForm(undefined, current.length)])
  }

  const handleRemoveUnsavedPostItemRow = (clientId: string) => {
    setPostItems((current) => current.filter((item) => item.clientId !== clientId))
  }

  const handleChangePostItem = (
    clientId: string,
    field: 'questionNumber' | 'passageText' | 'sortOrder' | 'isActive',
    value: string | number | boolean
  ) => {
    setPostItems((current) => current.map((item) => item.clientId === clientId ? {
      ...item,
      [field]: value,
    } : item))
  }

  const handleSavePostItem = async (item: GeneratePostItemFormState) => {
    if (!postForm.id) {
      toast.error('문항을 저장할 게시글 정보가 없습니다.')
      return
    }

    setSavingPostItemClientIds((current) => [...current, item.clientId])
    try {
      if (item.id) {
        const response = await updateGenerateListboardPostItemAction(item.id, {
          question_number: item.questionNumber,
          passage_text: item.passageText,
          sort_order: item.sortOrder,
          is_active: item.isActive,
        })

        setPostItems((current) => {
          const nextItems = current.map((candidate, index) => candidate.clientId === item.clientId
            ? buildGeneratePostItemForm(response.data, index)
            : candidate)
          const nextPassageText = getRepresentativePassageText(nextItems)
          setPostForm((prev) => ({ ...prev, passageText: nextPassageText }))
          if (postForm.id) {
            setGeneratePosts((posts) => posts.map((post) => post.id === postForm.id ? { ...post, passage_text: nextPassageText } : post))
          }
          return nextItems
        })
        toast.success(`문항 ${response.data.question_number}번을 수정했습니다.`)
      } else {
        const response = await createGenerateListboardPostItemAction({
          post_id: postForm.id,
          question_number: item.questionNumber,
          passage_text: item.passageText,
          sort_order: item.sortOrder,
          is_active: item.isActive,
        })

        setPostItems((current) => {
          const nextItems = current.map((candidate, index) => candidate.clientId === item.clientId
            ? buildGeneratePostItemForm(response.data, index)
            : candidate)
          const nextPassageText = getRepresentativePassageText(nextItems)
          setPostForm((prev) => ({ ...prev, passageText: nextPassageText }))
          if (postForm.id) {
            setGeneratePosts((posts) => posts.map((post) => post.id === postForm.id ? { ...post, passage_text: nextPassageText } : post))
          }
          return nextItems
        })
        toast.success(`문항 ${response.data.question_number}번을 추가했습니다.`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문항 저장에 실패했습니다.')
    } finally {
      setSavingPostItemClientIds((current) => current.filter((clientId) => clientId !== item.clientId))
    }
  }

  const handleArchivePostItem = async () => {
    if (!archivePostItemTarget?.id) return

    setSavingPostItemClientIds((current) => [...current, archivePostItemTarget.clientId])
    try {
      await archiveGenerateListboardPostItemAction(archivePostItemTarget.id)
      setPostItems((current) => {
        const nextItems = current.filter((item) => item.clientId !== archivePostItemTarget.clientId)
        const nextPassageText = getRepresentativePassageText(nextItems)
        setPostForm((prev) => ({ ...prev, passageText: nextPassageText }))
        if (postForm.id) {
          setGeneratePosts((posts) => posts.map((post) => post.id === postForm.id ? { ...post, passage_text: nextPassageText || post.passage_text } : post))
        }
        return nextItems
      })
      toast.success(`문항 ${archivePostItemTarget.questionNumber || ''}번을 보관했습니다.`)
      setArchivePostItemTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문항 보관에 실패했습니다.')
    } finally {
      setSavingPostItemClientIds((current) => current.filter((clientId) => clientId !== archivePostItemTarget.clientId))
    }
  }

  const handleSubmitPost = async () => {
    if (!postForm.menuEntryId) {
      toast.error('리스트보드를 선택해주세요.')
      return
    }

    setIsSavingPost(true)
    try {
      const payload = {
        menu_entry_id: postForm.menuEntryId,
        title: postForm.title,
        passage_text: postForm.passageText,
        exam_year: postForm.examYear ? Number(postForm.examYear) : null,
        exam_month: postForm.examMonth ? Number(postForm.examMonth) : null,
        grade_level: postForm.gradeLevel || null,
        status: postForm.status,
        is_active: postForm.isActive,
      } as const

      if (postForm.id) {
        const response = await updateGenerateListboardPostAction(postForm.id, payload)
        setGeneratePosts((current) => current.map((post) => post.id === postForm.id ? response.data : post))
        toast.success('게시글을 수정했습니다.')
      } else {
        if (postForm.csvItems.length === 0) {
          throw new Error('게시글 생성 시 CSV 파일 업로드가 필요합니다.')
        }

        const response = await createGenerateListboardPostWithItemsAction({
          menu_entry_id: payload.menu_entry_id,
          title: payload.title,
          exam_year: payload.exam_year,
          exam_month: payload.exam_month,
          grade_level: payload.grade_level,
          status: payload.status,
          is_active: payload.is_active,
        }, postForm.csvItems.map((item) => ({
          question_number: item.questionNumber,
          passage_text: item.passageText,
          sort_order: item.sortOrder,
          is_active: item.isActive,
        })))

        setGeneratePosts((current) => [response.data.post, ...current])
        persistGenerateEntryState(generateMenuEntries.map((entry) => entry.id === postForm.menuEntryId ? { ...entry, postCount: entry.postCount + 1 } : entry))
        toast.success(`게시글과 ${response.data.items.length}개 문항을 등록했습니다.`)
      }

      closePostDialog()
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 저장에 실패했습니다.')
    } finally {
      setIsSavingPost(false)
    }
  }

  const handleArchivePost = async () => {
    if (!archivePostTarget) return

    setIsSavingPost(true)
    try {
      await archiveGenerateListboardPostAction(archivePostTarget.id)
      setGeneratePosts((current) => current.filter((post) => post.id !== archivePostTarget.id))
      persistGenerateEntryState(generateMenuEntries.map((entry) => entry.id === archivePostTarget.menu_entry_id ? { ...entry, postCount: Math.max(0, entry.postCount - 1) } : entry))
      setArchivePostTarget(null)
      toast.success('게시글을 보관 처리했습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 보관에 실패했습니다.')
    } finally {
      setIsSavingPost(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">메뉴관리</h1>
          <p className="mt-1 text-gray-500">일반 헤더 메뉴와 문제생성 2단계 메뉴를 분리해서 관리합니다.</p>
        </div>
        <Button onClick={handleSaveAll} disabled={isSaving || !hasUnsavedChanges}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          일반 메뉴 저장
        </Button>
      </div>

      {!hasGenerateParent && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5" />
            <div>
              <p className="font-semibold">AI문제생성 상위 메뉴가 저장된 헤더 설정에 없습니다.</p>
              <p className="text-sm text-amber-800">런타임에서는 임시 self-heal이 가능하지만, 관리자에서 일반 헤더 메뉴를 다시 확인하는 것이 좋습니다.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-blue-200 bg-blue-50/60">
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-blue-900 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">문제생성 메뉴 source mode: {generateChildrenSourceMode}</p>
            <p>현재 등록된 DB 메뉴 수: {backfillStatus.entryCount}개</p>
            <p>남은 legacy 메뉴 수: {backfillStatus.missingLegacyChildren.length}개</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">/generate children은 아래 별도 섹션에서만 관리됩니다</Badge>
            {backfillStatus.missingLegacyChildren.length > 0 ? (
              <Button variant="outline" onClick={handleBackfillGenerateChildren} disabled={isBackfilling}>
                {isBackfilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                기존 문제생성 메뉴 가져오기
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>헤더 기본 설정</CardTitle>
          <CardDescription>헤더 좌측 로고 위치에 표시되는 문구를 설정합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="logo-text">로고 문구</Label>
            <Input id="logo-text" value={logoText} maxLength={MAX_LOGO_TEXT_LENGTH} onChange={(event) => setLogoText(event.target.value)} placeholder="예: AI영어문제팩토리" />
          </div>
          <p className="text-sm text-gray-500">최대 {MAX_LOGO_TEXT_LENGTH}자까지 입력할 수 있습니다.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>일반 헤더 메뉴 관리</CardTitle>
            <CardDescription>AI문제생성 상위 메뉴는 유지하되, 그 하위 메뉴는 아래 문제생성 메뉴 섹션에서 관리합니다.</CardDescription>
          </div>
          <Button onClick={openParentCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />상위 메뉴 추가
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Depth</TableHead>
                  <TableHead>메뉴명</TableHead>
                  <TableHead>링크</TableHead>
                  <TableHead className="w-[120px] text-center">하위 메뉴</TableHead>
                  <TableHead className="w-[110px] text-center">노출</TableHead>
                  <TableHead className="w-[240px] text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flatRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-gray-500">등록된 메뉴가 없습니다. 상위 메뉴를 먼저 추가해주세요.</TableCell>
                  </TableRow>
                ) : (
                  editableConfig.items.map((item, parentIndex) => (
                    <Fragment key={item.id}>
                      <TableRow>
                        <TableCell><Badge variant="secondary">1단계</Badge></TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{item.title}</span>
                            {item.href === '/generate' ? <Badge variant="outline">하위 메뉴 별도 관리</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-600">{item.href || '-'}</TableCell>
                        <TableCell className="text-center">{item.href === '/generate' ? generateMenuEntries.length : item.children.length}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <Switch checked={item.isActive} onCheckedChange={(checked) => handleToggleParent(item.id, checked)} />
                            <span className="text-xs text-gray-500">{item.isActive ? '활성' : '비활성'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleMoveParent(parentIndex, 'up')} disabled={parentIndex === 0}><ArrowUp className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleMoveParent(parentIndex, 'down')} disabled={parentIndex === editableConfig.items.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openChildCreateDialog(item.id)} disabled={item.href === '/generate'}><Plus className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openParentEditDialog(item)} disabled={item.href === '/generate'}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setDeleteTarget({ id: item.id, title: item.title, hasChildren: item.children.length > 0 })} disabled={item.href === '/generate'}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {item.href !== '/generate' && item.children.map((child, childIndex) => (
                        <TableRow key={child.id}>
                          <TableCell><Badge variant="outline">2단계</Badge></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 pl-4 text-gray-700">
                              <CornerDownRight className="h-4 w-4 text-gray-400" />
                              <span>{child.title}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-gray-600">{resolveHeaderMenuHref(item.href, child.href)}</TableCell>
                          <TableCell className="text-center text-gray-400">-</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-2">
                              <Switch checked={child.isActive} onCheckedChange={(checked) => handleToggleChild(item.id, child.id, checked)} />
                              <span className="text-xs text-gray-500">{child.isActive ? '활성' : '비활성'}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleMoveChild(item.id, childIndex, 'up')} disabled={childIndex === 0}><ArrowUp className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleMoveChild(item.id, childIndex, 'down')} disabled={childIndex === item.children.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => openChildEditDialog(item.id, child)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setDeleteTarget({ id: child.id, title: child.title, parentId: item.id })}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>문제생성 2단계 메뉴 관리</CardTitle>
            <CardDescription>DB 기반 source of truth입니다. href는 slug와 유형으로 자동 계산됩니다.</CardDescription>
          </div>
          <Button onClick={openCreateGenerateEntryDialog}>
            <Plus className="mr-2 h-4 w-4" />문제생성 메뉴 추가
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>메뉴명</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>slug</TableHead>
                  <TableHead>경로 미리보기</TableHead>
                  <TableHead className="text-center">게시글 수</TableHead>
                  <TableHead className="text-center">노출</TableHead>
                  <TableHead className="text-center">활성</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generateMenuEntries.map((entry, index) => {
                  const previewPath = buildGenerateMenuHref(entry)
                  const slugLocked = entry.entry_type === 'personal_generate' || entry.postCount > 0

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.title}</TableCell>
                      <TableCell>
                        <Badge variant={entry.entry_type === 'personal_generate' ? 'secondary' : 'outline'}>
                          {entry.entry_type === 'personal_generate' ? '개인지문' : '리스트보드'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{entry.slug}</span>
                          {slugLocked ? <span className="text-xs text-gray-400">게시글 연결 또는 시스템 메뉴로 인해 변경 제한</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600">{previewPath}</TableCell>
                      <TableCell className="text-center">{entry.postCount}</TableCell>
                      <TableCell className="text-center">{entry.is_visible ? '표시' : '숨김'}</TableCell>
                      <TableCell className="text-center">{entry.is_active ? '활성' : '비활성'}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleMoveGenerateEntry(index, 'up')} disabled={index === 0 || isMutatingGenerateEntries}><ArrowUp className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleMoveGenerateEntry(index, 'down')} disabled={index === generateMenuEntries.length - 1 || isMutatingGenerateEntries}><ArrowDown className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openEditGenerateEntryDialog(entry)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" disabled={entry.entry_type === 'personal_generate'} onClick={() => setArchiveTarget(entry)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>리스트보드 게시글 관리</CardTitle>
            <CardDescription>선택한 문제생성 리스트보드에 등록된 지문/글을 관리합니다.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedBoard?.id || ''}
              onChange={(event) => void loadBoardPosts(event.target.value)}
              className="flex h-10 min-w-[200px] rounded-md border bg-white px-3 text-sm"
            >
              {listboardEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title}</option>
              ))}
            </select>
            <Button onClick={openCreatePostDialog} disabled={!selectedBoard}>
              <Plus className="mr-2 h-4 w-4" />게시글 추가
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedBoard ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-gray-500">리스트보드 메뉴를 먼저 생성하거나 backfill 해주세요.</div>
          ) : isLoadingPosts ? (
            <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />게시글 로딩 중...</div>
          ) : generatePosts.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-gray-500">등록된 게시글이 없습니다.</div>
          ) : (
            <div className="rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>제목</TableHead>
                    <TableHead>년도</TableHead>
                    <TableHead>월</TableHead>
                    <TableHead>학년</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generatePosts.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{post.title}</div>
                          <p className="line-clamp-1 text-xs text-gray-500">{post.passage_text}</p>
                        </div>
                      </TableCell>
                      <TableCell>{post.exam_year ?? '-'}</TableCell>
                      <TableCell>{post.exam_month ?? '-'}</TableCell>
                      <TableCell>{post.grade_level ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={post.status === 'published' ? 'secondary' : 'outline'}>{post.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => void openEditPostDialog(post)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setArchivePostTarget(post)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><LayoutPanelTop className="h-5 w-5 text-gray-500" />데스크톱 미리보기</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="max-w-[180px] truncate font-bold text-primary">{logoText || '로고 문구'}</div>
                <div className="flex flex-1 items-center gap-2 overflow-x-auto">
                  {activePreviewItems.map((item) => (
                    <div key={item.id} className="rounded-md border px-3 py-1.5 text-sm whitespace-nowrap">
                      {item.title}
                      {item.children.length > 0 && <span className="ml-2 text-xs text-gray-400">▼ {item.children.length}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Smartphone className="h-5 w-5 text-gray-500" />모바일 미리보기</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-[320px] rounded-[24px] border bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b pb-3">
                <span className="max-w-[180px] truncate font-bold text-primary">{logoText || '로고 문구'}</span>
                <span className="text-sm text-gray-400">☰</span>
              </div>
              <div className="space-y-3 text-sm">
                {activePreviewItems.map((item) => (
                  <div key={item.id} className="space-y-2 rounded-lg border p-3">
                    <div className="font-medium">{item.title}</div>
                    {item.children.length > 0 && (
                      <div className="space-y-1 pl-3 text-gray-600">
                        {item.children.map((child) => (
                          <div key={child.id}>• {child.title}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState?.mode === 'create-parent' && '상위 메뉴 추가'}
              {dialogState?.mode === 'edit-parent' && '상위 메뉴 수정'}
              {dialogState?.mode === 'create-child' && '하위 메뉴 추가'}
              {dialogState?.mode === 'edit-child' && '하위 메뉴 수정'}
            </DialogTitle>
            <DialogDescription>일반 헤더 메뉴만 수정할 수 있습니다. 문제생성 하위 메뉴는 아래 별도 섹션에서 관리합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {(dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child') && (
              <div className="space-y-2">
                <Label>상위 메뉴</Label>
                <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">{selectedParent?.title || '상위 메뉴 없음'}</div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="menu-title">메뉴명</Label>
              <Input id="menu-title" value={formState.title} maxLength={MAX_MENU_TITLE_LENGTH} onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))} placeholder="예: 문제은행" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="menu-href">{dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? '하위 경로' : '링크'}</Label>
              <Input id="menu-href" value={formState.href} onChange={(event) => setFormState((current) => ({ ...current, href: event.target.value }))} placeholder={dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? '예: /textbook' : '예: /generate'} />
              {dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? (
                <div className="space-y-1 text-sm text-gray-500">
                  <p>하위 메뉴 링크는 상위 메뉴 링크를 기준으로 결합됩니다.</p>
                  {selectedParent?.href ? <p className="font-medium text-gray-700">실제 주소: {childResolvedHrefPreview || resolveHeaderMenuHref(selectedParent.href, '/sample')}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-gray-500">상위 메뉴 링크는 2단계 메뉴의 기준 경로가 됩니다.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>취소</Button>
            <Button onClick={handleSubmitMenu}>적용</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isGenerateEntryDialogOpen} onOpenChange={(open) => !open && closeGenerateEntryDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{generateEntryForm.id ? '문제생성 메뉴 수정' : '문제생성 메뉴 추가'}</DialogTitle>
            <DialogDescription>문제생성 2단계 메뉴의 source of truth를 관리합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>유형</Label>
              <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">{generateEntryForm.entryType === 'personal_generate' ? '개인지문' : '리스트보드'}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-title">메뉴명</Label>
              <Input id="generate-title" value={generateEntryForm.title} onChange={(event) => setGenerateEntryForm((current) => ({ ...current, title: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-slug">slug</Label>
              <Input id="generate-slug" value={generateEntryForm.entryType === 'personal_generate' ? 'personal' : generateEntryForm.slug} disabled={generateEntryForm.entryType === 'personal_generate' || generateEntryForm.postCount > 0} onChange={(event) => setGenerateEntryForm((current) => ({ ...current, slug: event.target.value }))} />
              <p className="text-sm text-gray-500">경로 미리보기: {buildGenerateMenuHref({ entry_type: generateEntryForm.entryType, slug: generateEntryForm.entryType === 'personal_generate' ? 'personal' : generateEntryForm.slug || 'slug' })}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-description">설명</Label>
              <Input id="generate-description" value={generateEntryForm.description} onChange={(event) => setGenerateEntryForm((current) => ({ ...current, description: event.target.value }))} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sort-order">정렬 순서</Label>
                <Input id="sort-order" type="number" value={generateEntryForm.sortOrder} onChange={(event) => setGenerateEntryForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label>노출</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                  <Switch checked={generateEntryForm.isVisible} onCheckedChange={(checked) => setGenerateEntryForm((current) => ({ ...current, isVisible: checked }))} />
                  <span className="text-sm text-gray-700">{generateEntryForm.isVisible ? '표시' : '숨김'}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>활성</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                  <Switch checked={generateEntryForm.isActive} onCheckedChange={(checked) => setGenerateEntryForm((current) => ({ ...current, isActive: checked }))} />
                  <span className="text-sm text-gray-700">{generateEntryForm.isActive ? '활성' : '비활성'}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeGenerateEntryDialog}>취소</Button>
            <Button onClick={handleSubmitGenerateEntry} disabled={isMutatingGenerateEntries}>
              {isMutatingGenerateEntries ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPostDialogOpen} onOpenChange={(open) => !open && closePostDialog()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{postForm.id ? '리스트보드 게시글 수정' : '리스트보드 게시글 추가'}</DialogTitle>
            <DialogDescription>교재형 문제생성에 사용할 지문/메타데이터를 관리합니다.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>대상 리스트보드</Label>
                <select value={postForm.menuEntryId} onChange={(event) => setPostForm((current) => ({ ...current, menuEntryId: event.target.value }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                  {listboardEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="post-title">제목</Label>
                <Input id="post-title" value={postForm.title} onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="exam-year">년도</Label>
                <Select value={postForm.examYear} onValueChange={(value) => setPostForm((current) => ({ ...current, examYear: value }))}>
                  <SelectTrigger id="exam-year" className="w-full">
                    <SelectValue placeholder="년도 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {examYearOptions.map((year) => (
                      <SelectItem key={year} value={year}>{year}년</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exam-month">월</Label>
                <Select value={postForm.examMonth} onValueChange={(value) => setPostForm((current) => ({ ...current, examMonth: value }))}>
                  <SelectTrigger id="exam-month" className="w-full">
                    <SelectValue placeholder="월 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_OPTIONS.map((month) => (
                      <SelectItem key={month} value={month}>{month}월</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="grade-level">학년</Label>
                <select
                  id="grade-level"
                  value={postForm.gradeLevel}
                  onChange={(event) => setPostForm((current) => ({ ...current, gradeLevel: event.target.value }))}
                  className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">선택 안 함</option>
                  {LISTBOARD_GRADE_OPTIONS.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>상태</Label>
                <select value={postForm.status} onChange={(event) => setPostForm((current) => ({ ...current, status: event.target.value as GeneratePostFormState['status'] }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="archived">archived</option>
                </select>
              </div>
            </div>

            {postForm.id ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="passage-text">대표 지문 내용</Label>
                  <Textarea id="passage-text" value={postForm.passageText} onChange={(event) => setPostForm((current) => ({ ...current, passageText: event.target.value }))} className="min-h-[160px]" />
                  <p className="text-sm text-gray-500">기존 게시글 호환용 대표 지문입니다. 아래에서 문항 행 단위 수정도 가능합니다.</p>
                </div>

                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-gray-900">문항 행 관리</h3>
                      <p className="text-sm text-gray-500">question_number / passage_text 기준으로 문항을 수정하거나 추가할 수 있습니다.</p>
                    </div>
                    <Button type="button" variant="outline" onClick={handleAddPostItemRow}>
                      <Plus className="mr-2 h-4 w-4" />문항 추가
                    </Button>
                  </div>

                  {isLoadingPostItems ? (
                    <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />문항 불러오는 중...
                    </div>
                  ) : postItems.length === 0 ? (
                    <div className="rounded-md border border-dashed py-8 text-center text-sm text-gray-500">
                      등록된 문항이 없습니다. 새 문항을 추가해주세요.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {postItems.map((item) => {
                        const isSavingItem = savingPostItemClientIds.includes(item.clientId)

                        return (
                          <div key={item.clientId} className="space-y-3 rounded-md border p-3">
                            <div className="grid gap-3 md:grid-cols-[140px,1fr,120px]">
                              <div className="space-y-2">
                                <Label>문항 번호</Label>
                                <Input
                                  value={item.questionNumber}
                                  onChange={(event) => handleChangePostItem(item.clientId, 'questionNumber', event.target.value)}
                                  placeholder="예: 18"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>지문 내용</Label>
                                <Textarea
                                  value={item.passageText}
                                  onChange={(event) => handleChangePostItem(item.clientId, 'passageText', event.target.value)}
                                  className="min-h-[140px]"
                                />
                              </div>
                              <div className="space-y-3">
                                <div className="space-y-2">
                                  <Label>정렬 순서</Label>
                                  <Input
                                    type="number"
                                    value={item.sortOrder}
                                    onChange={(event) => handleChangePostItem(item.clientId, 'sortOrder', Number(event.target.value) || 0)}
                                  />
                                </div>
                                <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                                  <Switch
                                    checked={item.isActive}
                                    onCheckedChange={(checked) => handleChangePostItem(item.clientId, 'isActive', checked)}
                                  />
                                  <span className="text-sm text-gray-700">{item.isActive ? '활성' : '비활성'}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              {item.id ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                  onClick={() => setArchivePostItemTarget(item)}
                                  disabled={isSavingItem}
                                >
                                  보관
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="text-gray-600 hover:bg-gray-100"
                                  onClick={() => handleRemoveUnsavedPostItemRow(item.clientId)}
                                  disabled={isSavingItem}
                                >
                                  행 제거
                                </Button>
                              )}
                              <Button type="button" onClick={() => void handleSavePostItem(item)} disabled={isSavingItem}>
                                {isSavingItem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {item.id ? '문항 저장' : '문항 추가'}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="post-csv-file">CSV / 엑셀 업로드</Label>
                  <Input
                    id="post-csv-file"
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(event) => void handlePostCsvFileChange(event.target.files?.[0])}
                  />
                  <p className="text-sm text-gray-500">첫 번째 열은 question_number, 두 번째 열은 passage_text 형식이어야 합니다.</p>
                </div>

                <div className="rounded-md border bg-gray-50 px-3 py-3 text-sm text-gray-700">
                  {postForm.csvItems.length > 0 ? (
                    <div className="space-y-1">
                      <p><span className="font-medium">업로드 파일:</span> {postForm.csvFileName}</p>
                      <p><span className="font-medium">문항 수:</span> {postForm.csvItems.length}개</p>
                      <p className="text-xs text-gray-500">미리보기: {postForm.csvItems.slice(0, 5).map((item) => item.questionNumber).join(', ')}{postForm.csvItems.length > 5 ? ' ...' : ''}</p>
                    </div>
                  ) : (
                    <p>아직 업로드된 파일이 없습니다.</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Switch checked={postForm.isActive} onCheckedChange={(checked) => setPostForm((current) => ({ ...current, isActive: checked }))} />
              <span className="text-sm text-gray-700">활성 상태 유지</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePostDialog}>취소</Button>
            <Button onClick={handleSubmitPost} disabled={isSavingPost}>
              {isSavingPost ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>메뉴를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{deleteTarget?.title}]</span> 메뉴를 삭제합니다.
              {deleteTarget?.hasChildren ? ' 하위 메뉴도 함께 삭제됩니다.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleConfirmDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문제생성 메뉴를 보관할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{archiveTarget?.title}]</span> 메뉴는 비노출/비활성 처리되며, 게시글이 있어도 hard delete 되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleArchiveGenerateEntry}>보관</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!archivePostTarget} onOpenChange={(open) => !open && setArchivePostTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>게시글을 보관할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{archivePostTarget?.title}]</span> 게시글은 사용자 화면에서 숨겨집니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleArchivePost}>보관</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!archivePostItemTarget} onOpenChange={(open) => !open && setArchivePostItemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문항을 보관할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{archivePostItemTarget?.questionNumber || '-'}번]</span> 문항은 게시글 상세와 생성 대상에서 숨겨집니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleArchivePostItem}>보관</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
