'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  LayoutPanelTop,
  Loader2,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
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
import { AdminConfirmDialog } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminSaveBar } from '@/components/admin/kit/admin-save-bar'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import {
  flattenHeaderNavigationItems,
  getActiveHeaderNavigationItems,
  isSystemOwnedHeaderParentHref,
  isSafeHeaderHref,
  MAX_LOGO_TEXT_LENGTH,
  MAX_MENU_TITLE_LENGTH,
  resolveHeaderMenuHref,
  type HeaderMenuChildItem,
  type HeaderMenuItem,
  type HeaderNavigationConfig,
} from '@/lib/header-navigation'
import {
  moveAdminSidebarHref,
  moveAdminSidebarNavigationNode,
  resolveAdminSidebarNavigationNodes,
  type AdminSidebarMenuGroupNode,
  type AdminSidebarMenuItem,
  type AdminSidebarMenuItemNode,
  type AdminSidebarNavigationConfig,
  type AdminSidebarNavigationNode,
} from '@/lib/admin-sidebar'
import {
  buildGenerateMenuHref,
  getGenerateMenuEntryShowDividerBefore,
  mergeGenerateEntriesIntoHeaderConfig,
  type GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'
import { mergeMarketEntriesIntoHeaderConfig } from '@/lib/market-menu'
import {
  archiveGenerateMenuEntryAction,
  backfillGenerateMenuEntriesAction,
  backfillMarketMenuEntriesAction,
  createGenerateMenuEntryAction,
  reorderGenerateMenuEntriesAction,
  saveAdminSidebarNavigationConfigAction,
  saveMenuManagementConfig,
  updateGenerateMenuEntryAction,
  type MenuManagementPageData,
} from './actions'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminWorkspaceSwitcher } from '@/components/layout/admin-workspace-switcher'

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
  showDividerBefore: boolean
}

interface GenerateEntryFormState {
  id?: string
  title: string
  slug: string
  description: string
  sortOrder: number
  isVisible: boolean
  isActive: boolean
  showDividerBefore: boolean
  entryType: 'personal_generate' | 'listboard'
  postCount: number
}

// 저장 바(20번)의 마지막 저장 결과. 저장 중 여부는 isSaving·isSavingAdminSidebar 가 정한다.
type SaveResult = { status: 'saved'; at: number } | { status: 'error'; message: string } | null

// 관리자 패널 순서 표의 줄: 단독 메뉴 / 대메뉴 / 대메뉴 안 하위 메뉴
type AdminSidebarRow =
  | { kind: 'item'; node: AdminSidebarMenuItemNode; nodeIndex: number }
  | { kind: 'group'; node: AdminSidebarMenuGroupNode; nodeIndex: number }
  | { kind: 'child'; node: AdminSidebarMenuGroupNode; item: AdminSidebarMenuItem; index: number }

// 일반 헤더 메뉴 표의 줄: 상위 메뉴 / 그 아래 하위 메뉴
type HeaderMenuRow =
  | { kind: 'parent'; item: HeaderMenuItem; parentIndex: number }
  | { kind: 'child'; item: HeaderMenuItem; child: HeaderMenuChildItem; childIndex: number }

// 저장 바에 보일 '저장 안 된 변경 n건' 수(표시용). 더해지거나 빠지거나 내용·위치가 바뀐 메뉴 수 + 로고 문구.
function countHeaderConfigChanges(current: HeaderNavigationConfig, saved: HeaderNavigationConfig) {
  const describe = (config: HeaderNavigationConfig) => {
    const entries = new Map<string, string>()
    config.items.forEach((item, index) => {
      const { children, ...parent } = item
      entries.set(item.id, JSON.stringify([index, parent]))
      children.forEach((child, childIndex) => entries.set(child.id, JSON.stringify([item.id, childIndex, child])))
    })
    return entries
  }
  const now = describe(current)
  const before = describe(saved)
  let count = current.logoText === saved.logoText ? 0 : 1
  for (const id of new Set([...now.keys(), ...before.keys()])) {
    if (now.get(id) !== before.get(id)) count += 1
  }
  return count
}

// 관리자 패널 순서: 위치가 바뀐 메뉴 수 + 이름이 바뀐 메뉴 수(표시용)
function countAdminSidebarConfigChanges(current: AdminSidebarNavigationConfig, saved: AdminSidebarNavigationConfig) {
  let count = 0
  for (const href of new Set([...current.items, ...saved.items])) {
    if (current.items.indexOf(href) !== saved.items.indexOf(href)) count += 1
  }
  const labels = current.labels ?? {}
  const savedLabels = saved.labels ?? {}
  for (const key of new Set([...Object.keys(labels), ...Object.keys(savedLabels)])) {
    if (labels[key] !== savedLabels[key]) count += 1
  }
  return count
}

// 표 안 삭제 버튼(위험 동작 글자색). 확정은 확인 창의 adminDanger 버튼.
const TABLE_DANGER_BUTTON_CLASS = 'border-[var(--admin-tone-danger-border)] text-[var(--admin-tone-danger-text)] hover:bg-[var(--admin-tone-danger-soft)]'
const SECTION_CARD_CLASS = 'rounded-[var(--studio-radius-card)] border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-none'
const SWITCH_LABEL_CLASS = 'text-xs text-[var(--studio-muted)]'

const DEDICATED_CHILD_SECTION_PARENT_HREFS = ['/generate', '/market', '/library'] as const

function isDedicatedChildSectionParent(href?: string) {
  return href ? DEDICATED_CHILD_SECTION_PARENT_HREFS.includes(href as typeof DEDICATED_CHILD_SECTION_PARENT_HREFS[number]) : false
}

function getDedicatedChildSectionLabel(href?: string) {
  if (href === '/generate') return '문제생성'
  if (href === '/market') return '문제마켓'
  if (href === '/library') return '라이브러리'
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
    showDividerBefore: false,
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
    showDividerBefore: false,
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
    showDividerBefore: getGenerateMenuEntryShowDividerBefore(entry),
    entryType: entry.entry_type as 'personal_generate' | 'listboard',
    postCount: entry.postCount,
  }
}

function getMenuParentByHref(items: HeaderMenuItem[], href: string) {
  return items.find((item) => item.href === href) ?? null
}

export default function MenuManagementClient({
  initialConfig,
  adminSidebarConfig: initialAdminSidebarConfig,
  generateMenuEntries: initialGenerateMenuEntries,
  marketMenuEntries,
  generateChildrenSourceMode,
  marketChildrenSourceMode,
  backfillStatus,
  marketBackfillStatus,
  workspaceSubject = 'english',
}: MenuManagementClientProps) {
  const router = useRouter()
  const [config, setConfig] = useState<HeaderNavigationConfig>(() => cloneConfig(initialConfig))
  const [savedConfig, setSavedConfig] = useState<HeaderNavigationConfig>(() => cloneConfig(initialConfig))
  const [adminSidebarConfig, setAdminSidebarConfig] = useState<AdminSidebarNavigationConfig>(initialAdminSidebarConfig)
  const [savedAdminSidebarConfig, setSavedAdminSidebarConfig] = useState<AdminSidebarNavigationConfig>(initialAdminSidebarConfig)
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
  const [isBackfillingMarket, setIsBackfillingMarket] = useState(false)
  const [isSavingAdminSidebar, setIsSavingAdminSidebar] = useState(false)
  const [saveAllResult, setSaveAllResult] = useState<SaveResult>(null)
  const [adminSidebarSaveResult, setAdminSidebarSaveResult] = useState<SaveResult>(null)

  const editableConfig = useMemo(() => ({
    ...config,
    items: config.items.map((item) => isDedicatedChildSectionParent(item.href) ? { ...item, children: [] } : item),
  }), [config])

  const flatRows = useMemo(() => flattenHeaderNavigationItems(editableConfig.items), [editableConfig.items])
  const previewConfig = useMemo(() => mergeMarketEntriesIntoHeaderConfig(
    mergeGenerateEntriesIntoHeaderConfig(config, generateMenuEntries, generateChildrenSourceMode),
    marketMenuEntries,
    marketChildrenSourceMode
  ), [config, generateMenuEntries, generateChildrenSourceMode, marketMenuEntries, marketChildrenSourceMode])
  const activePreviewItems = useMemo(() => getActiveHeaderNavigationItems(previewConfig.items), [previewConfig.items])
  const selectedParent = useMemo(
    () => config.items.find((item) => item.id === formState.parentId || item.id === dialogState?.parentId),
    [config.items, dialogState?.parentId, formState.parentId]
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
  const libraryParent = useMemo(() => getMenuParentByHref(config.items, '/library'), [config.items])
  const libraryMenuChildren = libraryParent?.children ?? []
  const hasUnsavedChanges = JSON.stringify({ ...config, logoText }) !== JSON.stringify(savedConfig)
  const adminSidebarNavigationNodes = useMemo(
    () => resolveAdminSidebarNavigationNodes(workspaceSubject, adminSidebarConfig),
    [adminSidebarConfig, workspaceSubject]
  )
  const hasUnsavedAdminSidebarChanges = JSON.stringify(adminSidebarConfig) !== JSON.stringify(savedAdminSidebarConfig)

  // 한쪽을 저장하거나 즉시 반영한 뒤 router.refresh() 로 props 가 새로 와도, 다른 영역의 저장 안 한 변경은 남긴다.
  // (과목이 바뀌면 page.tsx 의 key 로 화면이 새로 그려지므로 여기서는 같은 과목 안의 새로고침만 다룬다.)
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges)
  const hasUnsavedAdminSidebarChangesRef = useRef(hasUnsavedAdminSidebarChanges)
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
    hasUnsavedAdminSidebarChangesRef.current = hasUnsavedAdminSidebarChanges
  }, [hasUnsavedChanges, hasUnsavedAdminSidebarChanges])

  useEffect(() => {
    setSavedConfig(cloneConfig(initialConfig))
    if (!hasUnsavedChangesRef.current) {
      setConfig(cloneConfig(initialConfig))
      setLogoText(initialConfig.logoText)
    }
  }, [initialConfig])

  useEffect(() => {
    setSavedAdminSidebarConfig(initialAdminSidebarConfig)
    if (!hasUnsavedAdminSidebarChangesRef.current) {
      setAdminSidebarConfig(initialAdminSidebarConfig)
    }
  }, [initialAdminSidebarConfig])

  useEffect(() => {
    setGenerateMenuEntries(initialGenerateMenuEntries)
  }, [initialGenerateMenuEntries])

  useUnsavedChangesGuard(hasUnsavedChanges || hasUnsavedAdminSidebarChanges)

  const closeDialog = () => {
    setIsDialogOpen(false)
    setDialogState(null)
    setFormState(buildEmptyMenuForm())
  }

  const closeGenerateEntryDialog = () => {
    setGenerateEntryForm(buildEmptyGenerateEntryForm())
    setIsGenerateEntryDialogOpen(false)
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
    setDialogState({ mode: 'edit-parent', targetId: item.id })
    setFormState({ title: item.title, href: item.href || '', parentId: '', showDividerBefore: false })
    setIsDialogOpen(true)
  }

  const openChildCreateDialog = (parentId: string) => {
    const parent = config.items.find((item) => item.id === parentId)
    if (isDedicatedChildSectionParent(parent?.href)) {
      toast.info(`${getDedicatedChildSectionLabel(parent?.href)} 하위 메뉴는 아래 별도 섹션에서 관리됩니다.`)
      return
    }

    setDialogState({ mode: 'create-child', parentId })
    setFormState(buildEmptyMenuForm(parentId))
    setIsDialogOpen(true)
  }

  const openChildEditDialog = (parentId: string, child: HeaderMenuChildItem) => {
    const parent = config.items.find((item) => item.id === parentId)
    if (isDedicatedChildSectionParent(parent?.href)) {
      toast.info(`${getDedicatedChildSectionLabel(parent?.href)} 하위 메뉴는 아래 별도 섹션에서 관리됩니다.`)
      return
    }

    setDialogState({ mode: 'edit-child', targetId: child.id, parentId })
    setFormState({ title: child.title, href: child.href, parentId, showDividerBefore: Boolean(child.showDividerBefore) })
    setIsDialogOpen(true)
  }

  const openDedicatedChildCreateDialog = (parentId: string) => {
    setDialogState({ mode: 'create-child', parentId })
    setFormState(buildEmptyMenuForm(parentId))
    setIsDialogOpen(true)
  }

  const openDedicatedChildEditDialog = (parentId: string, child: HeaderMenuChildItem) => {
    setDialogState({ mode: 'edit-child', targetId: child.id, parentId })
    setFormState({ title: child.title, href: child.href, parentId, showDividerBefore: Boolean(child.showDividerBefore) })
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

  const getAdminSidebarNodeKey = (node: AdminSidebarNavigationNode) => (
    node.type === 'group' ? node.id : node.item.href
  )

  const handleMoveAdminSidebarNode = (node: AdminSidebarMenuGroupNode | AdminSidebarMenuItemNode, direction: 'up' | 'down') => {
    setAdminSidebarConfig((current) => ({
      ...current,
      items: moveAdminSidebarNavigationNode(
        current.items,
        adminSidebarNavigationNodes,
        getAdminSidebarNodeKey(node),
        direction
      ),
    }))
  }

  const handleMoveAdminSidebarChild = (groupNode: AdminSidebarMenuGroupNode, item: AdminSidebarMenuItem, direction: 'up' | 'down') => {
    setAdminSidebarConfig((current) => ({
      ...current,
      items: moveAdminSidebarHref(
        current.items,
        item.href,
        groupNode.items.map((groupItem) => groupItem.href),
        direction
      ),
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

    if (!deleteTarget.parentId) {
      const targetItem = editableConfig.items.find((item) => item.id === deleteTarget.id)
      if (isSystemOwnedHeaderParentHref(targetItem?.href, workspaceSubject)) {
        updateConfigItems((items) => items.map((item) => item.id === deleteTarget.id ? {
          ...item,
          isActive: false,
        } : item))
        toast.success('목록에서 숨김으로 바꿨습니다. 위의 저장을 눌러야 적용됩니다.')
        setDeleteTarget(null)
        return
      }
    }

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
    toast.success('목록에서 뺐습니다. 위의 저장을 눌러야 적용됩니다.')
  }

  const handleSubmitMenu = () => {
    if (!dialogState) return

    const title = formState.title.trim()
    const href = formState.href.trim()
    const selectedParentId = formState.parentId || dialogState.parentId
    const parentItem = selectedParentId ? config.items.find((item) => item.id === selectedParentId) : null
    const editingParent = dialogState.targetId ? config.items.find((item) => item.id === dialogState.targetId) : null

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
      const editingParent = dialogState.targetId ? config.items.find((item) => item.id === dialogState.targetId) : null
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
        href: isSystemOwnedHeaderParentHref(editingParent?.href, workspaceSubject)
          ? editingParent?.href
          : (href || undefined),
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
        children: [...item.children, { id: crypto.randomUUID(), title, href, isActive: true, showDividerBefore: formState.showDividerBefore }],
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

      const currentChild = config.items.flatMap((item) => item.children).find((child) => child.id === targetId)
      const movedChild: HeaderMenuChildItem = {
        id: targetId,
        title,
        href,
        isActive: currentChild?.isActive ?? true,
        showDividerBefore: formState.showDividerBefore,
      }

      updateConfigItems((items) => items.map((item) => {
        const remainingChildren = item.children.filter((child) => child.id !== targetId)
        return item.id === parentId ? { ...item, children: [...remainingChildren, movedChild] } : { ...item, children: remainingChildren }
      }))
    }

    closeDialog()
    toast.success(dialogState.mode.startsWith('create') ? '목록에 추가했습니다. 위의 저장을 눌러야 적용됩니다.' : '목록에 반영했습니다. 위의 저장을 눌러야 적용됩니다.')
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
      const response = await saveMenuManagementConfig({ ...config, logoText: nextLogoText }, workspaceSubject)
      if (!response.success) {
        throw new Error('저장에 실패했습니다.')
      }

      setConfig(response.data)
      setSavedConfig(response.data)
      setLogoText(response.data.logoText)
      setSaveAllResult({ status: 'saved', at: Date.now() })
      toast.success('일반 헤더 메뉴 설정을 저장했습니다.')
      refreshRoute()
    } catch (error) {
      setSaveAllResult({ status: 'error', message: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.' })
      toast.error(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveAdminSidebar = async () => {
    setIsSavingAdminSidebar(true)
    try {
      const response = await saveAdminSidebarNavigationConfigAction(adminSidebarConfig)
      if (!response.success) {
        throw new Error('저장에 실패했습니다.')
      }

      setAdminSidebarConfig(response.data)
      setSavedAdminSidebarConfig(response.data)
      setAdminSidebarSaveResult({ status: 'saved', at: Date.now() })
      toast.success('관리자 패널 메뉴 순서를 저장했습니다.')
      refreshRoute()
    } catch (error) {
      setAdminSidebarSaveResult({ status: 'error', message: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.' })
      toast.error(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setIsSavingAdminSidebar(false)
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
        ? { filters: ['year', 'month', 'grade', 'title'], entryHref: buildGenerateMenuHref({ entry_type: generateEntryForm.entryType, slug }), showDividerBefore: generateEntryForm.showDividerBefore }
        : { entryHref: '/generate/personal', showDividerBefore: generateEntryForm.showDividerBefore }

      if (generateEntryForm.id) {
        const response = await updateGenerateMenuEntryAction(generateEntryForm.id, {
          title,
          slug,
          description: generateEntryForm.description,
          sort_order: generateEntryForm.sortOrder,
          is_visible: generateEntryForm.isVisible,
          is_active: generateEntryForm.isActive,
          search_config: searchConfig,
        }, workspaceSubject)
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
        }, workspaceSubject)
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
      await archiveGenerateMenuEntryAction(archiveTarget.id, workspaceSubject)
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
      await reorderGenerateMenuEntriesAction(nextEntries.map((entry) => entry.id), workspaceSubject)
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
      await backfillGenerateMenuEntriesAction(workspaceSubject)
      toast.success('기존 문제생성 메뉴를 DB 메뉴로 가져왔습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기존 메뉴 가져오기에 실패했습니다.')
    } finally {
      setIsBackfilling(false)
    }
  }

  const handleBackfillMarketChildren = async () => {
    setIsBackfillingMarket(true)
    try {
      await backfillMarketMenuEntriesAction(workspaceSubject)
      toast.success('기존 문제마켓 메뉴를 DB 메뉴로 가져왔습니다.')
      refreshRoute()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기존 문제마켓 메뉴 가져오기에 실패했습니다.')
    } finally {
      setIsBackfillingMarket(false)
    }
  }

  const headerDirtyCount = hasUnsavedChanges ? Math.max(1, countHeaderConfigChanges({ ...config, logoText }, savedConfig)) : 0
  const adminSidebarDirtyCount = hasUnsavedAdminSidebarChanges ? Math.max(1, countAdminSidebarConfigChanges(adminSidebarConfig, savedAdminSidebarConfig)) : 0

  const adminSidebarRows: AdminSidebarRow[] = adminSidebarNavigationNodes.flatMap((node, nodeIndex): AdminSidebarRow[] => (
    node.type === 'item'
      ? [{ kind: 'item', node, nodeIndex }]
      : [{ kind: 'group', node, nodeIndex }, ...node.items.map((item, index): AdminSidebarRow => ({ kind: 'child', node, item, index }))]
  ))

  const adminSidebarColumns: AdminDataTableColumn<AdminSidebarRow>[] = [
    {
      key: 'name',
      header: '메뉴명',
      cell: (row) => row.kind === 'item'
        ? <span className="font-medium">{row.node.item.name}</span>
        : row.kind === 'group'
          ? <span className="font-semibold text-[var(--studio-ink)]">{row.node.name}</span>
          : <span className="pl-4 font-medium">{row.item.name}</span>,
    },
    {
      key: 'href',
      header: '기준 경로',
      cell: (row) => row.kind === 'item'
        ? <span className="text-[var(--studio-muted)]">{row.node.item.href}</span>
        : row.kind === 'group'
          ? <span className="text-[var(--studio-muted)]">{row.node.perSubject ? '대메뉴(국어·영어 각각 표시)' : '대메뉴'}</span>
          : <span className="text-[var(--studio-muted)]">{row.item.href}</span>,
    },
    {
      key: 'group',
      header: '표시 그룹',
      cell: (row) => row.kind === 'item'
        ? <span className="text-[var(--studio-muted)]">기본</span>
        : row.kind === 'group'
          ? <AdminStatusBadge label={`소메뉴 ${row.node.items.length}개`} tone="neutral" />
          : <span className="text-[var(--studio-muted)]">{row.node.name}</span>,
    },
    {
      key: 'order',
      header: '순서 조정',
      align: 'right',
      headerClassName: 'w-[180px]',
      cell: (row) => {
        if (row.kind === 'item') {
          const { node, nodeIndex } = row
          return (
            <div className="flex items-center justify-end gap-1">
              <Button variant="adminTable" size="icon-sm" aria-label={`${node.item.name} 위로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'up')} disabled={nodeIndex === 0}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="adminTable" size="icon-sm" aria-label={`${node.item.name} 아래로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'down')} disabled={nodeIndex === adminSidebarNavigationNodes.length - 1}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          )
        }
        if (row.kind === 'group') {
          const { node, nodeIndex } = row
          return (
            <div className="flex items-center justify-end gap-1">
              <Button variant="adminTable" size="icon-sm" aria-label={`${node.name} 대메뉴 위로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'up')} disabled={nodeIndex === 0}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="adminTable" size="icon-sm" aria-label={`${node.name} 대메뉴 아래로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'down')} disabled={nodeIndex === adminSidebarNavigationNodes.length - 1}>
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          )
        }
        const { node, item, index } = row
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="adminTable" size="icon-sm" aria-label={`${node.name} ${item.name} 위로 이동`} onClick={() => handleMoveAdminSidebarChild(node, item, 'up')} disabled={index === 0}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="adminTable" size="icon-sm" aria-label={`${node.name} ${item.name} 아래로 이동`} onClick={() => handleMoveAdminSidebarChild(node, item, 'down')} disabled={index === node.items.length - 1}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  const headerMenuRows: HeaderMenuRow[] = editableConfig.items.flatMap((item, parentIndex): HeaderMenuRow[] => [
    { kind: 'parent', item, parentIndex },
    ...(!isDedicatedChildSectionParent(item.href)
      ? item.children.map((child, childIndex): HeaderMenuRow => ({ kind: 'child', item, child, childIndex }))
      : []),
  ])

  const headerMenuColumns: AdminDataTableColumn<HeaderMenuRow>[] = [
    {
      key: 'depth',
      header: 'Depth',
      headerClassName: 'w-[90px]',
      cell: (row) => <AdminStatusBadge label={row.kind === 'parent' ? '1단계' : '2단계'} tone={row.kind === 'parent' ? 'info' : 'neutral'} />,
    },
    {
      key: 'title',
      header: '메뉴명',
      cell: (row) => {
        if (row.kind === 'child') {
          return (
            <div className="flex items-center gap-2 pl-4">
              <CornerDownRight className="h-4 w-4 text-[var(--studio-muted)]" />
              <span>{row.child.title}</span>
            </div>
          )
        }
        const { item } = row
        return (
          <div className="flex flex-wrap items-center gap-2 font-medium">
            <span>{item.title}</span>
            {isDedicatedChildSectionParent(item.href) ? <AdminStatusBadge label={`${getDedicatedChildSectionLabel(item.href)} 하위 메뉴 별도 관리`} tone="neutral" /> : null}
            {isSystemOwnedHeaderParentHref(item.href, workspaceSubject) ? <AdminStatusBadge label="시스템 메뉴" tone="neutral" /> : null}
            {workspaceSubject === 'english' && item.href === '/generate' ? <AdminStatusBadge label="영어 전용" tone="neutral" /> : null}
          </div>
        )
      },
    },
    {
      key: 'href',
      header: '링크',
      cell: (row) => <span className="text-[var(--studio-muted)]">{row.kind === 'parent' ? row.item.href || '-' : resolveHeaderMenuHref(row.item.href, row.child.href)}</span>,
    },
    {
      key: 'children',
      header: '하위 메뉴',
      align: 'center',
      headerClassName: 'w-[120px]',
      cell: (row) => {
        if (row.kind === 'child') return <span className="text-[var(--studio-muted)]">-</span>
        const { item } = row
        return item.href === '/generate'
          ? generateMenuEntries.length
          : item.href === '/market'
            ? marketMenuEntries.length
            : item.href === '/library'
              ? libraryMenuChildren.length
            : item.children.length
      },
    },
    {
      key: 'active',
      header: '노출',
      align: 'center',
      headerClassName: 'w-[110px]',
      cell: (row) => row.kind === 'parent' ? (
        <div className="flex items-center justify-center gap-2">
          <Switch checked={row.item.isActive} aria-label={`${row.item.title} 노출`} onCheckedChange={(checked) => handleToggleParent(row.item.id, checked)} />
          <span className={SWITCH_LABEL_CLASS}>{row.item.isActive ? '활성' : '비활성'}</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2">
          <Switch checked={row.child.isActive} aria-label={`${row.child.title} 노출`} onCheckedChange={(checked) => handleToggleChild(row.item.id, row.child.id, checked)} />
          <span className={SWITCH_LABEL_CLASS}>{row.child.isActive ? '활성' : '비활성'}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '관리',
      align: 'right',
      headerClassName: 'w-[240px]',
      cell: (row) => {
        if (row.kind === 'parent') {
          const { item, parentIndex } = row
          return (
            <div className="flex items-center justify-end gap-1">
              <Button variant="adminTable" size="icon-sm" aria-label={`${item.title} 위로 이동`} onClick={() => handleMoveParent(parentIndex, 'up')} disabled={parentIndex === 0}><ArrowUp className="h-4 w-4" /></Button>
              <Button variant="adminTable" size="icon-sm" aria-label={`${item.title} 아래로 이동`} onClick={() => handleMoveParent(parentIndex, 'down')} disabled={parentIndex === editableConfig.items.length - 1}><ArrowDown className="h-4 w-4" /></Button>
              <Button variant="adminTable" size="icon-sm" aria-label={`${item.title} 하위 메뉴 추가`} onClick={() => openChildCreateDialog(item.id)} disabled={isDedicatedChildSectionParent(item.href)}><Plus className="h-4 w-4" /></Button>
              <Button variant="adminTable" size="icon-sm" aria-label={`${item.title} 수정`} onClick={() => openParentEditDialog(item)}><Pencil className="h-4 w-4" /></Button>
              <Button variant="adminTable" size="icon-sm" aria-label={`${item.title} 삭제`} className={TABLE_DANGER_BUTTON_CLASS} onClick={() => setDeleteTarget({ id: item.id, title: item.title, hasChildren: item.children.length > 0 })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          )
        }
        const { item, child, childIndex } = row
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 위로 이동`} onClick={() => handleMoveChild(item.id, childIndex, 'up')} disabled={childIndex === 0}><ArrowUp className="h-4 w-4" /></Button>
            <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 아래로 이동`} onClick={() => handleMoveChild(item.id, childIndex, 'down')} disabled={childIndex === item.children.length - 1}><ArrowDown className="h-4 w-4" /></Button>
            <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 수정`} onClick={() => openChildEditDialog(item.id, child)}><Pencil className="h-4 w-4" /></Button>
            <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 삭제`} className={TABLE_DANGER_BUTTON_CLASS} onClick={() => setDeleteTarget({ id: child.id, title: child.title, parentId: item.id })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        )
      },
    },
  ]

  const generateEntryColumns: AdminDataTableColumn<GenerateMenuEntryAdminRow>[] = [
    { key: 'title', header: '메뉴명', cell: (entry) => <span className="font-medium">{entry.title}</span> },
    {
      key: 'type',
      header: '유형',
      cell: (entry) => <AdminStatusBadge label={entry.entry_type === 'personal_generate' ? '개인지문' : '리스트보드'} tone={entry.entry_type === 'personal_generate' ? 'info' : 'neutral'} />,
    },
    {
      key: 'slug',
      header: 'slug',
      cell: (entry) => {
        const slugLocked = entry.entry_type === 'personal_generate' || entry.postCount > 0
        return (
          <div className="flex flex-col">
            <span>{entry.slug}</span>
            {slugLocked ? <span className="text-xs text-[var(--studio-muted)]">게시글 연결 또는 시스템 메뉴로 인해 변경 제한</span> : null}
          </div>
        )
      },
    },
    { key: 'preview', header: '경로 미리보기', cell: (entry) => <span className="text-[var(--studio-muted)]">{buildGenerateMenuHref(entry)}</span> },
    { key: 'posts', header: '게시글 수', align: 'center', cell: (entry) => <span className="tabular-nums">{entry.postCount}</span> },
    { key: 'visible', header: '노출', align: 'center', cell: (entry) => (entry.is_visible ? '표시' : '숨김') },
    { key: 'active', header: '활성', align: 'center', cell: (entry) => (entry.is_active ? '활성' : '비활성') },
    { key: 'divider', header: '구분선', align: 'center', cell: (entry) => (getGenerateMenuEntryShowDividerBefore(entry) ? '표시' : '-') },
    {
      key: 'actions',
      header: '관리',
      align: 'right',
      cell: (entry, index) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="adminTable" size="icon-sm" aria-label={`${entry.title} 위로 이동`} onClick={() => handleMoveGenerateEntry(index, 'up')} disabled={index === 0 || isMutatingGenerateEntries}><ArrowUp className="h-4 w-4" /></Button>
          <Button variant="adminTable" size="icon-sm" aria-label={`${entry.title} 아래로 이동`} onClick={() => handleMoveGenerateEntry(index, 'down')} disabled={index === generateMenuEntries.length - 1 || isMutatingGenerateEntries}><ArrowDown className="h-4 w-4" /></Button>
          <Button variant="adminTable" size="icon-sm" aria-label={`${entry.title} 수정`} onClick={() => openEditGenerateEntryDialog(entry)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="adminTable" size="icon-sm" aria-label={`${entry.title} 보관`} className={TABLE_DANGER_BUTTON_CLASS} disabled={entry.entry_type === 'personal_generate'} onClick={() => setArchiveTarget(entry)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ]

  const libraryColumns: AdminDataTableColumn<HeaderMenuChildItem>[] = [
    { key: 'title', header: '메뉴명', cell: (child) => <span className="font-medium">{child.title}</span> },
    { key: 'href', header: '경로', cell: (child) => child.href },
    { key: 'resolved', header: '실제 주소 미리보기', cell: (child) => <span className="text-[var(--studio-muted)]">{resolveHeaderMenuHref(libraryParent?.href, child.href)}</span> },
    {
      key: 'active',
      header: '노출',
      align: 'center',
      cell: (child) => (
        <div className="flex items-center justify-center gap-2">
          <Switch checked={child.isActive} aria-label={`${child.title} 노출`} onCheckedChange={(checked) => libraryParent && handleToggleChild(libraryParent.id, child.id, checked)} />
          <span className={SWITCH_LABEL_CLASS}>{child.isActive ? '표시' : '숨김'}</span>
        </div>
      ),
    },
    { key: 'divider', header: '구분선', align: 'center', cell: (child) => (child.showDividerBefore ? '표시' : '-') },
    {
      key: 'actions',
      header: '관리',
      align: 'right',
      cell: (child, childIndex) => libraryParent ? (
        <div className="flex items-center justify-end gap-1">
          <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 위로 이동`} onClick={() => handleMoveChild(libraryParent.id, childIndex, 'up')} disabled={childIndex === 0}><ArrowUp className="h-4 w-4" /></Button>
          <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 아래로 이동`} onClick={() => handleMoveChild(libraryParent.id, childIndex, 'down')} disabled={childIndex === libraryMenuChildren.length - 1}><ArrowDown className="h-4 w-4" /></Button>
          <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 수정`} onClick={() => openDedicatedChildEditDialog(libraryParent.id, child)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="adminTable" size="icon-sm" aria-label={`${child.title} 삭제`} className={TABLE_DANGER_BUTTON_CLASS} onClick={() => setDeleteTarget({ id: child.id, title: child.title, parentId: libraryParent.id })}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : null,
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        className="mb-0"
        title={<><AdminMenuName href="/admin/menu-management" fallback="메뉴관리" /> · {workspaceSubject === 'english' ? '영어' : '국어'}</>}
        description="일반 헤더 메뉴와 DB 연동 대상 2단계 메뉴를 분리해서 관리합니다."
        // 회원 사이트 상단 메뉴는 과목마다 따로라, 사이드바 대신 화면 안에서 과목을 바꾼다
        tools={<AdminWorkspaceSwitcher />}
      />

      {/* 일반 메뉴(로고 문구·일반 헤더 메뉴·라이브러리 2단계 메뉴) 저장. 아래 카드들의 '위의 저장'이 이 줄이다. */}
      <AdminSaveBar
        variant="inline"
        dirtyCount={headerDirtyCount}
        status={isSaving ? 'saving' : saveAllResult?.status ?? 'idle'}
        savedAt={saveAllResult?.status === 'saved' ? saveAllResult.at : null}
        errorMessage={saveAllResult?.status === 'error' ? saveAllResult.message : null}
        applyNote="로고 문구·일반 헤더 메뉴·라이브러리 2단계 메뉴를 함께 저장합니다."
        onSave={handleSaveAll}
        saveLabel="일반 메뉴 저장"
        saveDisabled={!hasUnsavedChanges}
      />

      {/* 회원 사이트(문제마켓) 헤더는 이 화면의 헤더 설정을 읽지 않는다. 운영자가 헷갈리지 않게 알린다. */}
      <AdminNotice kind="warning">
        회원 사이트(문제마켓) 헤더 오른쪽 링크는 <Link href="/admin/storefront-menu" className="font-semibold underline">상단 메뉴</Link> 화면에서 관리합니다.
        이 화면의 헤더 메뉴 설정은 옛 화면에만 쓰이며 지금 회원 화면에는 보이지 않습니다.
      </AdminNotice>

      <AdminNotice kind="info" title="현재 작업 공간 헤더 규칙">
        <ul className="list-disc space-y-1 pl-5">
          <li>`/generate`, `/market` 상위 메뉴는 시스템 링크를 유지하고 제목/순서/노출 여부만 수정합니다.</li>
          <li>영어 작업공간은 문제생성 상위 메뉴를 가질 수 있고, 국어 작업공간은 문제생성 상위 메뉴를 노출하지 않습니다.</li>
          <li>라이브러리 상위 메뉴는 일반 헤더 설정에서 관리하고, 기본 하위 링크는 시스템 fallback 구성을 사용합니다.</li>
        </ul>
      </AdminNotice>

      {workspaceSubject === 'english' && !hasGenerateParent && (
        <AdminNotice kind="warning" title="AI문제생성 상위 메뉴가 저장된 헤더 설정에 없습니다.">
          런타임에서는 임시 self-heal이 가능하지만, 관리자에서 일반 헤더 메뉴를 다시 확인하는 것이 좋습니다.
        </AdminNotice>
      )}

      {!hasMarketParent && (
        <AdminNotice kind="warning" title="문제마켓 상위 메뉴가 저장된 헤더 설정에 없습니다.">
          런타임에서는 임시 self-heal이 가능하지만, 관리자에서 일반 헤더 메뉴를 다시 확인하는 것이 좋습니다.
        </AdminNotice>
      )}

      <AdminNotice kind="info" title={`문제생성 메뉴 source mode: ${generateChildrenSourceMode}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p>현재 등록된 DB 메뉴 수: {backfillStatus.entryCount}개</p>
            <p>남은 legacy 메뉴 수: {backfillStatus.missingLegacyChildren.length}개</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminStatusBadge label="/generate children은 아래 별도 섹션에서만 관리됩니다" tone="neutral" />
            {backfillStatus.missingLegacyChildren.length > 0 ? (
              <Button variant="brandOutline" onClick={handleBackfillGenerateChildren} disabled={isBackfilling}>
                {isBackfilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                기존 문제생성 메뉴 가져오기
              </Button>
            ) : null}
          </div>
        </div>
      </AdminNotice>

      <AdminNotice kind="info" title={`문제마켓 메뉴 source mode: ${marketChildrenSourceMode}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p>현재 등록된 DB 메뉴 수: {marketBackfillStatus.entryCount}개</p>
            <p>남은 legacy 메뉴 수: {marketBackfillStatus.missingLegacyChildren.length}개</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminStatusBadge label="/market children은 아래 별도 섹션에서만 관리됩니다" tone="neutral" />
            {marketBackfillStatus.missingLegacyChildren.length > 0 ? (
              <Button variant="brandOutline" onClick={handleBackfillMarketChildren} disabled={isBackfillingMarket}>
                {isBackfillingMarket ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                기존 문제마켓 메뉴 가져오기
              </Button>
            ) : null}
          </div>
        </div>
      </AdminNotice>

      <Card className={SECTION_CARD_CLASS}>
        <CardHeader>
          <CardTitle>관리자 패널 메뉴 순서</CardTitle>
          <CardDescription>관리자 사이드바 메뉴 위치를 위/아래 버튼으로 조정합니다. 국어·영어와 상관없이 하나의 순서를 씁니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AdminSaveBar
            variant="inline"
            dirtyCount={adminSidebarDirtyCount}
            status={isSavingAdminSidebar ? 'saving' : adminSidebarSaveResult?.status ?? 'idle'}
            savedAt={adminSidebarSaveResult?.status === 'saved' ? adminSidebarSaveResult.at : null}
            errorMessage={adminSidebarSaveResult?.status === 'error' ? adminSidebarSaveResult.message : null}
            applyNote="저장하면 관리자 사이드바 순서에 반영됩니다(국어·영어 공통)."
            onSave={handleSaveAdminSidebar}
            saveLabel="관리자 패널 순서 저장"
            saveDisabled={!hasUnsavedAdminSidebarChanges}
          />
          <AdminDataTable
            caption="관리자 패널 메뉴 순서"
            columns={adminSidebarColumns}
            rows={adminSidebarRows}
            getRowKey={(row) => (row.kind === 'item' ? row.node.item.href : row.kind === 'group' ? row.node.id : row.item.href)}
            minWidth={640}
          />
          <p className="text-sm text-[var(--studio-muted)]">순서는 국어·영어가 함께 씁니다. 대메뉴는 묶음째 이동하고, 하위 메뉴는 묶음 안에서만 순서를 조정합니다. 과목별 대메뉴는 사이드바에서 국어·영어 묶음으로 나뉘어 같은 순서로 보입니다.</p>
        </CardContent>
      </Card>

      <Card className={SECTION_CARD_CLASS}>
        <CardHeader>
          <CardTitle>헤더 기본 설정</CardTitle>
          <CardDescription>헤더 좌측 로고 위치에 표시되는 문구를 설정합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="logo-text">로고 문구</Label>
            <Input id="logo-text" value={logoText} maxLength={MAX_LOGO_TEXT_LENGTH} onChange={(event) => setLogoText(event.target.value)} placeholder="예: AI영어문제팩토리" />
          </div>
          <p className="text-sm text-[var(--studio-muted)]">최대 {MAX_LOGO_TEXT_LENGTH}자까지 입력할 수 있습니다.</p>
        </CardContent>
      </Card>

      <Card className={SECTION_CARD_CLASS}>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>일반 헤더 메뉴 관리</CardTitle>
            <CardDescription>문제생성·문제마켓·라이브러리 상위 메뉴는 유지하되, 각 2단계 메뉴는 아래 별도 섹션에서 관리합니다.</CardDescription>
          </div>
          <Button variant="brand" onClick={openParentCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />상위 메뉴 추가
          </Button>
        </CardHeader>
        <CardContent>
          <AdminDataTable
            caption="일반 헤더 메뉴"
            columns={headerMenuColumns}
            rows={headerMenuRows}
            getRowKey={(row) => (row.kind === 'parent' ? row.item.id : row.child.id)}
            minWidth={760}
            state={flatRows.length === 0 ? <AdminTableState kind="empty" message="등록된 메뉴가 없습니다. 상위 메뉴를 먼저 추가해주세요." /> : undefined}
          />
        </CardContent>
      </Card>

      <Card className={SECTION_CARD_CLASS}>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>문제생성 2단계 메뉴 관리</CardTitle>
            <CardDescription>DB 기반 source of truth입니다. href는 slug와 유형으로 자동 계산됩니다.</CardDescription>
          </div>
          <Button variant="brand" onClick={openCreateGenerateEntryDialog}>
            <Plus className="mr-2 h-4 w-4" />문제생성 메뉴 추가
          </Button>
        </CardHeader>
        <CardContent>
          <AdminDataTable
            caption="문제생성 2단계 메뉴"
            columns={generateEntryColumns}
            rows={generateMenuEntries}
            getRowKey={(entry) => entry.id}
            minWidth={900}
          />
        </CardContent>
      </Card>

      <Card className={SECTION_CARD_CLASS}>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>라이브러리 2단계 메뉴 관리</CardTitle>
            <CardDescription>헤더 설정(JSON) 기반 source of truth입니다. 저장 시 헤더 dropdown과 라이브러리 좌측 메뉴에 함께 반영됩니다.</CardDescription>
          </div>
          <Button variant="brand" onClick={() => libraryParent ? openDedicatedChildCreateDialog(libraryParent.id) : toast.error('라이브러리 상위 메뉴를 먼저 확인해주세요.')}>
            <Plus className="mr-2 h-4 w-4" />라이브러리 메뉴 추가
          </Button>
        </CardHeader>
        <CardContent>
          <AdminDataTable
            caption="라이브러리 2단계 메뉴"
            columns={libraryColumns}
            rows={libraryParent ? libraryMenuChildren : []}
            getRowKey={(child) => child.id}
            minWidth={720}
            state={!libraryParent ? (
              <AdminTableState kind="empty" message="라이브러리 상위 메뉴를 찾을 수 없습니다." />
            ) : libraryMenuChildren.length === 0 ? (
              <AdminTableState kind="empty" message="등록된 라이브러리 2단계 메뉴가 없습니다." />
            ) : undefined}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={SECTION_CARD_CLASS}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><LayoutPanelTop className="h-5 w-5 text-[var(--studio-muted)]" />데스크톱 미리보기</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="max-w-[180px] truncate font-bold text-primary">{logoText || '로고 문구'}</div>
                <div className="flex flex-1 items-center gap-2 overflow-x-auto">
                  {activePreviewItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-[var(--studio-border)] px-3 py-1.5 text-sm whitespace-nowrap">
                      {item.title}
                      {item.children.length > 0 && <span className="ml-2 text-xs text-[var(--studio-muted)]">▼ {item.children.length}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={SECTION_CARD_CLASS}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Smartphone className="h-5 w-5 text-[var(--studio-muted)]" />모바일 미리보기</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-[320px] rounded-[24px] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-[var(--studio-border)] pb-3">
                <span className="max-w-[180px] truncate font-bold text-primary">{logoText || '로고 문구'}</span>
                <span className="text-sm text-[var(--studio-muted)]">☰</span>
              </div>
              <div className="space-y-3 text-sm">
                {activePreviewItems.map((item) => (
                  <div key={item.id} className="space-y-2 rounded-lg border border-[var(--studio-border)] p-3">
                    <div className="font-medium">{item.title}</div>
                    {item.children.length > 0 && (
                      <div className="space-y-1 pl-3 text-[var(--studio-muted)]">
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
            <DialogDescription>일반 헤더 메뉴만 수정할 수 있습니다. 문제생성/문제마켓/라이브러리 하위 메뉴는 아래 별도 섹션에서 관리합니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {(dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child') && (
              <div className="space-y-2">
                <Label>상위 메뉴</Label>
                <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-background)] px-3 py-2 text-sm text-[var(--studio-text)]">{selectedParent?.title || '상위 메뉴 없음'}</div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="menu-title">메뉴명</Label>
              <Input id="menu-title" value={formState.title} maxLength={MAX_MENU_TITLE_LENGTH} onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))} placeholder="예: 문제은행" />
              {dialogState?.mode === 'edit-parent' && editableConfig.items.find((item) => item.id === dialogState?.targetId)?.href === '/library' ? (
                <p className="text-xs text-[var(--studio-muted)]">라이브러리 하위 메뉴는 아래 전용 섹션에서 관리됩니다.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="menu-href">{dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? '하위 경로' : '링크'}</Label>
              <Input id="menu-href" value={formState.href} onChange={(event) => setFormState((current) => ({ ...current, href: event.target.value }))} placeholder={dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? '예: /textbook' : '예: /generate'} disabled={dialogState?.mode === 'edit-parent' && isSystemOwnedHeaderParentHref(editableConfig.items.find((item) => item.id === dialogState?.targetId)?.href, workspaceSubject)} />
              {dialogState?.mode === 'edit-parent' && isSystemOwnedHeaderParentHref(editableConfig.items.find((item) => item.id === dialogState?.targetId)?.href, workspaceSubject) ? (
                <p className="text-xs text-[var(--admin-tone-warning-text)]">시스템 메뉴는 링크를 고정하고 제목/순서/노출 여부만 수정할 수 있습니다.</p>
              ) : null}
              {dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? (
                <div className="space-y-1 text-sm text-[var(--studio-muted)]">
                  <p>하위 메뉴 링크는 상위 메뉴 링크를 기준으로 결합됩니다.</p>
                  {selectedParent?.href ? <p className="font-medium text-[var(--studio-text)]">실제 주소: {childResolvedHrefPreview || resolveHeaderMenuHref(selectedParent.href, '/sample')}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--studio-muted)]">상위 메뉴 링크는 2단계 메뉴의 기준 경로가 됩니다.</p>
              )}
            </div>

            {dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? (
              <div className="space-y-2">
                <Label>구분선</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border border-[var(--studio-border)] px-3">
                  <Switch checked={formState.showDividerBefore} onCheckedChange={(checked) => setFormState((current) => ({ ...current, showDividerBefore: checked }))} />
                  <span className="text-sm text-[var(--studio-text)]">{formState.showDividerBefore ? '이 메뉴 앞에 구분선 표시' : '구분선 없음'}</span>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="brandOutline" onClick={closeDialog}>취소</Button>
            <Button variant="brand" onClick={handleSubmitMenu}>적용</Button>
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
              <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-background)] px-3 py-2 text-sm text-[var(--studio-text)]">{generateEntryForm.entryType === 'personal_generate' ? '개인지문' : '리스트보드'}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-title">메뉴명</Label>
              <Input id="generate-title" value={generateEntryForm.title} onChange={(event) => setGenerateEntryForm((current) => ({ ...current, title: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-slug">slug</Label>
              <Input id="generate-slug" value={generateEntryForm.entryType === 'personal_generate' ? 'personal' : generateEntryForm.slug} disabled={generateEntryForm.entryType === 'personal_generate' || generateEntryForm.postCount > 0} onChange={(event) => setGenerateEntryForm((current) => ({ ...current, slug: event.target.value }))} />
              <p className="text-sm text-[var(--studio-muted)]">경로 미리보기: {buildGenerateMenuHref({ entry_type: generateEntryForm.entryType, slug: generateEntryForm.entryType === 'personal_generate' ? 'personal' : generateEntryForm.slug || 'slug' })}</p>
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
                <div className="flex h-10 items-center gap-3 rounded-md border border-[var(--studio-border)] px-3">
                  <Switch checked={generateEntryForm.isVisible} onCheckedChange={(checked) => setGenerateEntryForm((current) => ({ ...current, isVisible: checked }))} />
                  <span className="text-sm text-[var(--studio-text)]">{generateEntryForm.isVisible ? '표시' : '숨김'}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>활성</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border border-[var(--studio-border)] px-3">
                  <Switch checked={generateEntryForm.isActive} onCheckedChange={(checked) => setGenerateEntryForm((current) => ({ ...current, isActive: checked }))} />
                  <span className="text-sm text-[var(--studio-text)]">{generateEntryForm.isActive ? '활성' : '비활성'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>구분선</Label>
              <div className="flex h-10 items-center gap-3 rounded-md border border-[var(--studio-border)] px-3">
                <Switch checked={generateEntryForm.showDividerBefore} onCheckedChange={(checked) => setGenerateEntryForm((current) => ({ ...current, showDividerBefore: checked }))} />
                <span className="text-sm text-[var(--studio-text)]">{generateEntryForm.showDividerBefore ? '이 메뉴 앞에 구분선 표시' : '구분선 없음'}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="brandOutline" onClick={closeGenerateEntryDialog}>취소</Button>
            <Button variant="brand" onClick={handleSubmitGenerateEntry} disabled={isMutatingGenerateEntries}>
              {isMutatingGenerateEntries ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="메뉴를 삭제할까요?"
        description={
          <>
            <span className="font-medium">[{deleteTarget?.title}]</span> 메뉴를 삭제합니다.
            {deleteTarget?.hasChildren ? ' 하위 메뉴도 함께 삭제됩니다.' : ''}
          </>
        }
        confirmLabel="삭제"
        danger
        onConfirm={handleConfirmDelete}
      />

      <AdminConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="문제생성 메뉴를 보관할까요?"
        description={
          <>
            <span className="font-medium">[{archiveTarget?.title}]</span> 메뉴는 비노출/비활성 처리되며, 게시글이 있어도 hard delete 되지 않습니다.
          </>
        }
        confirmLabel="보관"
        danger
        // 전과 같이 확정을 누르면 창은 바로 닫히고 보관을 보낸다(보관 함수는 닫기 전 대상을 그대로 쓴다).
        onConfirm={() => {
          setArchiveTarget(null)
          void handleArchiveGenerateEntry()
        }}
      />

    </div>
  )
}
