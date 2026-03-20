'use client'

import { Fragment, useMemo, useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
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
  mergeGenerateEntriesIntoHeaderConfig,
  type GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'
import {
  buildMarketMenuHref,
  mergeMarketEntriesIntoHeaderConfig,
  type MarketMenuEntryAdminRow,
} from '@/lib/market-menu'
import {
  archiveGenerateMenuEntryAction,
  archiveMarketMenuEntryAction,
  backfillGenerateMenuEntriesAction,
  backfillMarketMenuEntriesAction,
  createGenerateMenuEntryAction,
  createMarketMenuEntryAction,
  reorderGenerateMenuEntriesAction,
  reorderMarketMenuEntriesAction,
  saveMenuManagementConfig,
  updateGenerateMenuEntryAction,
  updateMarketMenuEntryAction,
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

interface MarketEntryFormState {
  id?: string
  title: string
  slug: string
  description: string
  sortOrder: number
  isVisible: boolean
  isActive: boolean
}

const MANAGED_CHILD_PARENT_HREFS = ['/generate', '/market'] as const

function isManagedChildParent(href?: string) {
  return href ? MANAGED_CHILD_PARENT_HREFS.includes(href as typeof MANAGED_CHILD_PARENT_HREFS[number]) : false
}

function getManagedChildParentLabel(href?: string) {
  if (href === '/generate') return '문제생성'
  if (href === '/market') return '문제마켓'
  return '별도 관리'
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

function buildEmptyMarketEntryForm(): MarketEntryFormState {
  return {
    title: '',
    slug: '',
    description: '',
    sortOrder: 10,
    isVisible: true,
    isActive: true,
  }
}

function buildMarketEntryForm(entry: MarketMenuEntryAdminRow): MarketEntryFormState {
  return {
    id: entry.id,
    title: entry.title,
    slug: entry.slug,
    description: entry.description || '',
    sortOrder: entry.sort_order,
    isVisible: entry.is_visible,
    isActive: entry.is_active,
  }
}

export default function MenuManagementClient({
  initialConfig,
  generateMenuEntries: initialGenerateMenuEntries,
  marketMenuEntries: initialMarketMenuEntries,
  generateChildrenSourceMode,
  marketChildrenSourceMode,
  backfillStatus,
  marketBackfillStatus,
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
  const [marketMenuEntries, setMarketMenuEntries] = useState(initialMarketMenuEntries)
  const [isGenerateEntryDialogOpen, setIsGenerateEntryDialogOpen] = useState(false)
  const [isMarketEntryDialogOpen, setIsMarketEntryDialogOpen] = useState(false)
  const [generateEntryForm, setGenerateEntryForm] = useState<GenerateEntryFormState>(buildEmptyGenerateEntryForm())
  const [marketEntryForm, setMarketEntryForm] = useState<MarketEntryFormState>(buildEmptyMarketEntryForm())
  const [isMutatingGenerateEntries, setIsMutatingGenerateEntries] = useState(false)
  const [isMutatingMarketEntries, setIsMutatingMarketEntries] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<GenerateMenuEntryAdminRow | null>(null)
  const [archiveMarketTarget, setArchiveMarketTarget] = useState<MarketMenuEntryAdminRow | null>(null)
  const [isBackfilling, setIsBackfilling] = useState(false)
  const [isBackfillingMarket, setIsBackfillingMarket] = useState(false)

  const editableConfig = useMemo(() => ({
    ...config,
    items: config.items.map((item) => isManagedChildParent(item.href) ? { ...item, children: [] } : item),
  }), [config])

  const flatRows = useMemo(() => flattenHeaderNavigationItems(editableConfig.items), [editableConfig.items])
  const previewConfig = useMemo(() => mergeMarketEntriesIntoHeaderConfig(
    mergeGenerateEntriesIntoHeaderConfig(config, generateMenuEntries, generateChildrenSourceMode),
    marketMenuEntries,
    marketChildrenSourceMode
  ), [config, generateMenuEntries, generateChildrenSourceMode, marketMenuEntries, marketChildrenSourceMode])
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

  const hasGenerateParent = config.items.some((item) => item.href === '/generate')
  const hasMarketParent = config.items.some((item) => item.href === '/market')
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

  const closeMarketEntryDialog = () => {
    setMarketEntryForm(buildEmptyMarketEntryForm())
    setIsMarketEntryDialogOpen(false)
  }

  const updateConfigItems = (updater: (items: HeaderMenuItem[]) => HeaderMenuItem[]) => {
    setConfig((current) => ({
      ...current,
      items: updater(current.items),
    }))
  }

  const refreshRoute = () => router.refresh()

  const openParentCreateDialog = () => {
    setDialogState({ mode: 'create-parent' })
    setFormState(buildEmptyMenuForm())
    setIsDialogOpen(true)
  }

  const openParentEditDialog = (item: HeaderMenuItem) => {
    if (item.href === '/generate') {
      toast.info('AI문제생성 상위 메뉴는 보호되며, 하위 메뉴는 아래 별도 섹션에서 관리됩니다.')
      return
    }

    if (item.href === '/market') {
      toast.info('문제마켓 상위 메뉴는 보호되며, 하위 메뉴는 아래 별도 섹션에서 관리됩니다.')
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
        : { entryHref: '/generate/personal' }

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

  const openCreateMarketEntryDialog = () => {
    const nextSortOrder = marketMenuEntries.length === 0 ? 10 : Math.max(...marketMenuEntries.map((entry) => entry.sort_order)) + 10
    setMarketEntryForm({ ...buildEmptyMarketEntryForm(), sortOrder: nextSortOrder })
    setIsMarketEntryDialogOpen(true)
  }

  const openEditMarketEntryDialog = (entry: MarketMenuEntryAdminRow) => {
    setMarketEntryForm(buildMarketEntryForm(entry))
    setIsMarketEntryDialogOpen(true)
  }

  const persistMarketEntryState = (nextEntries: MarketMenuEntryAdminRow[]) => {
    setMarketMenuEntries(nextEntries.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko')))
  }

  const handleSubmitMarketEntry = async () => {
    const title = marketEntryForm.title.trim()
    const slug = marketEntryForm.slug.trim()

    if (!title || !slug) {
      toast.error('메뉴명과 slug를 입력해주세요.')
      return
    }

    setIsMutatingMarketEntries(true)
    try {
      const searchConfig = {
        marketSlug: slug,
        entryHref: buildMarketMenuHref({ slug }),
      }

      if (marketEntryForm.id) {
        const response = await updateMarketMenuEntryAction(marketEntryForm.id, {
          title,
          slug,
          description: marketEntryForm.description,
          sort_order: marketEntryForm.sortOrder,
          is_visible: marketEntryForm.isVisible,
          is_active: marketEntryForm.isActive,
          search_config: searchConfig,
        })
        persistMarketEntryState(marketMenuEntries.map((entry) => entry.id === marketEntryForm.id ? response.data : entry))
        toast.success('문제마켓 메뉴를 수정했습니다.')
      } else {
        const response = await createMarketMenuEntryAction({
          title,
          slug,
          description: marketEntryForm.description,
          sort_order: marketEntryForm.sortOrder,
          is_visible: marketEntryForm.isVisible,
          is_active: marketEntryForm.isActive,
          search_config: searchConfig,
        })
        persistMarketEntryState([...marketMenuEntries, response.data])
        toast.success('문제마켓 메뉴를 추가했습니다.')
      }

      closeMarketEntryDialog()
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 메뉴 저장에 실패했습니다.')
    } finally {
      setIsMutatingMarketEntries(false)
    }
  }

  const handleArchiveMarketEntry = async () => {
    if (!archiveMarketTarget) return

    setIsMutatingMarketEntries(true)
    try {
      await archiveMarketMenuEntryAction(archiveMarketTarget.id)
      persistMarketEntryState(marketMenuEntries.filter((entry) => entry.id !== archiveMarketTarget.id))
      setArchiveMarketTarget(null)
      toast.success('문제마켓 메뉴를 보관 처리했습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 메뉴 보관에 실패했습니다.')
    } finally {
      setIsMutatingMarketEntries(false)
    }
  }

  const handleMoveMarketEntry = async (index: number, direction: 'up' | 'down') => {
    const nextEntries = moveArrayItem(marketMenuEntries, index, direction).map((entry, nextIndex) => ({
      ...entry,
      sort_order: (nextIndex + 1) * 10,
    }))

    setMarketMenuEntries(nextEntries)
    try {
      await reorderMarketMenuEntriesAction(nextEntries.map((entry) => entry.id))
      toast.success('문제마켓 메뉴 정렬 순서를 저장했습니다.')
      refreshRoute()
    } catch (error) {
      setMarketMenuEntries(marketMenuEntries)
      toast.error(error instanceof Error ? error.message : '문제마켓 메뉴 정렬 저장에 실패했습니다.')
    }
  }

  const handleBackfillMarketChildren = async () => {
    setIsBackfillingMarket(true)
    try {
      await backfillMarketMenuEntriesAction()
      toast.success('기존 문제마켓 메뉴를 DB 메뉴로 가져왔습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기존 문제마켓 메뉴 가져오기에 실패했습니다.')
    } finally {
      setIsBackfillingMarket(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">메뉴관리</h1>
          <p className="mt-1 text-gray-500">일반 헤더 메뉴와 DB 연동 대상 2단계 메뉴를 분리해서 관리합니다.</p>
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

      {!hasMarketParent && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5" />
            <div>
              <p className="font-semibold">문제마켓 상위 메뉴가 저장된 헤더 설정에 없습니다.</p>
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

      <Card className="border-blue-200 bg-blue-50/60">
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-blue-900 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">문제마켓 메뉴 source mode: {marketChildrenSourceMode}</p>
            <p>현재 등록된 DB 메뉴 수: {marketBackfillStatus.entryCount}개</p>
            <p>남은 legacy 메뉴 수: {marketBackfillStatus.missingLegacyChildren.length}개</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">/market children은 아래 별도 섹션에서만 관리됩니다</Badge>
            {marketBackfillStatus.missingLegacyChildren.length > 0 ? (
              <Button variant="outline" onClick={handleBackfillMarketChildren} disabled={isBackfillingMarket}>
                {isBackfillingMarket ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                기존 문제마켓 메뉴 가져오기
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
            <CardDescription>AI문제생성·문제마켓 상위 메뉴는 유지하되, 각 하위 메뉴는 아래 별도 섹션에서 관리합니다.</CardDescription>
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
                            {isManagedChildParent(item.href) ? <Badge variant="outline">{getManagedChildParentLabel(item.href)} 하위 메뉴 별도 관리</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-600">{item.href || '-'}</TableCell>
                        <TableCell className="text-center">
                          {item.href === '/generate'
                            ? generateMenuEntries.length
                            : item.href === '/market'
                              ? marketMenuEntries.length
                              : item.children.length}
                        </TableCell>
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
                            <Button variant="ghost" size="icon" onClick={() => openChildCreateDialog(item.id)} disabled={isManagedChildParent(item.href)}><Plus className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openParentEditDialog(item)} disabled={isManagedChildParent(item.href)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setDeleteTarget({ id: item.id, title: item.title, hasChildren: item.children.length > 0 })} disabled={isManagedChildParent(item.href)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {!isManagedChildParent(item.href) && item.children.map((child, childIndex) => (
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
            <CardTitle>문제마켓 2단계 메뉴 관리</CardTitle>
            <CardDescription>DB 기반 source of truth입니다. href는 slug로 자동 계산됩니다.</CardDescription>
          </div>
          <Button onClick={openCreateMarketEntryDialog}>
            <Plus className="mr-2 h-4 w-4" />문제마켓 메뉴 추가
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
                  <TableHead className="text-center">노출</TableHead>
                  <TableHead className="text-center">활성</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marketMenuEntries.map((entry, index) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">문제마켓</Badge>
                    </TableCell>
                    <TableCell>{entry.slug}</TableCell>
                    <TableCell className="text-gray-600">{buildMarketMenuHref(entry)}</TableCell>
                    <TableCell className="text-center">{entry.is_visible ? '표시' : '숨김'}</TableCell>
                    <TableCell className="text-center">{entry.is_active ? '활성' : '비활성'}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleMoveMarketEntry(index, 'up')} disabled={index === 0 || isMutatingMarketEntries}><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleMoveMarketEntry(index, 'down')} disabled={index === marketMenuEntries.length - 1 || isMutatingMarketEntries}><ArrowDown className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEditMarketEntryDialog(entry)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setArchiveMarketTarget(entry)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
            <DialogDescription>일반 헤더 메뉴만 수정할 수 있습니다. 문제생성/문제마켓 하위 메뉴는 아래 별도 섹션에서 관리합니다.</DialogDescription>
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

      <Dialog open={isMarketEntryDialogOpen} onOpenChange={(open) => !open && closeMarketEntryDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{marketEntryForm.id ? '문제마켓 메뉴 수정' : '문제마켓 메뉴 추가'}</DialogTitle>
            <DialogDescription>문제마켓 2단계 메뉴의 source of truth를 관리합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>유형</Label>
              <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">문제마켓</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="market-title">메뉴명</Label>
              <Input
                id="market-title"
                value={marketEntryForm.title}
                onChange={(event) => setMarketEntryForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="market-slug">slug</Label>
              <Input
                id="market-slug"
                value={marketEntryForm.slug}
                onChange={(event) => setMarketEntryForm((current) => ({ ...current, slug: event.target.value }))}
              />
              <p className="text-sm text-gray-500">경로 미리보기: {buildMarketMenuHref({ slug: marketEntryForm.slug || 'slug' })}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="market-description">설명</Label>
              <Input
                id="market-description"
                value={marketEntryForm.description}
                onChange={(event) => setMarketEntryForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="market-sort-order">정렬 순서</Label>
                <Input
                  id="market-sort-order"
                  type="number"
                  value={marketEntryForm.sortOrder}
                  onChange={(event) => setMarketEntryForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2">
                <Label>노출</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                  <Switch checked={marketEntryForm.isVisible} onCheckedChange={(checked) => setMarketEntryForm((current) => ({ ...current, isVisible: checked }))} />
                  <span className="text-sm text-gray-700">{marketEntryForm.isVisible ? '표시' : '숨김'}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>활성</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                  <Switch checked={marketEntryForm.isActive} onCheckedChange={(checked) => setMarketEntryForm((current) => ({ ...current, isActive: checked }))} />
                  <span className="text-sm text-gray-700">{marketEntryForm.isActive ? '활성' : '비활성'}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeMarketEntryDialog}>취소</Button>
            <Button onClick={handleSubmitMarketEntry} disabled={isMutatingMarketEntries}>
              {isMutatingMarketEntries ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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

      <AlertDialog open={!!archiveMarketTarget} onOpenChange={(open) => !open && setArchiveMarketTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문제마켓 메뉴를 보관할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{archiveMarketTarget?.title}]</span> 메뉴는 비노출/비활성 처리되며, hard delete 되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleArchiveMarketEntry}>보관</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
