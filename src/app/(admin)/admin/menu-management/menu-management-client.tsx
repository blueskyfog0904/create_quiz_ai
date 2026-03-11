'use client'

import { Fragment, useMemo, useState } from 'react'
import {
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { saveMenuManagementConfig } from './actions'

interface MenuManagementClientProps {
  initialConfig: HeaderNavigationConfig
}

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

function buildEmptyForm(parentId?: string): MenuFormState {
  return {
    title: '',
    href: '',
    parentId: parentId || '',
  }
}

export default function MenuManagementClient({ initialConfig }: MenuManagementClientProps) {
  const [config, setConfig] = useState<HeaderNavigationConfig>(() => cloneConfig(initialConfig))
  const [savedConfig, setSavedConfig] = useState<HeaderNavigationConfig>(() => cloneConfig(initialConfig))
  const [logoText, setLogoText] = useState(initialConfig.logoText)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [dialogState, setDialogState] = useState<MenuDialogState | null>(null)
  const [formState, setFormState] = useState<MenuFormState>(buildEmptyForm())
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    title: string
    parentId?: string
    hasChildren?: boolean
  } | null>(null)

  const flatRows = useMemo(() => flattenHeaderNavigationItems(config.items), [config.items])
  const activePreviewItems = useMemo(() => getActiveHeaderNavigationItems(config.items), [config.items])
  const selectedParent = useMemo(
    () => config.items.find((item) => item.id === formState.parentId || item.id === dialogState?.parentId),
    [config.items, dialogState?.parentId, formState.parentId]
  )
  const childResolvedHrefPreview = useMemo(() => {
    if (
      dialogState?.mode !== 'create-child'
      && dialogState?.mode !== 'edit-child'
    ) {
      return ''
    }

    const href = formState.href.trim()
    if (!href) return ''

    return resolveHeaderMenuHref(selectedParent?.href, href)
  }, [dialogState?.mode, formState.href, selectedParent?.href])
  const hasUnsavedChanges = JSON.stringify({ ...config, logoText }) !== JSON.stringify(savedConfig)

  const closeDialog = () => {
    setIsDialogOpen(false)
    setDialogState(null)
    setFormState(buildEmptyForm())
  }

  const updateConfigItems = (updater: (items: HeaderMenuItem[]) => HeaderMenuItem[]) => {
    setConfig((current) => ({
      ...current,
      items: updater(current.items),
    }))
  }

  const openParentCreateDialog = () => {
    setDialogState({ mode: 'create-parent' })
    setFormState(buildEmptyForm())
    setIsDialogOpen(true)
  }

  const openParentEditDialog = (item: HeaderMenuItem) => {
    setDialogState({ mode: 'edit-parent', targetId: item.id })
    setFormState({
      title: item.title,
      href: item.href || '',
      parentId: '',
    })
    setIsDialogOpen(true)
  }

  const openChildCreateDialog = (parentId: string) => {
    setDialogState({ mode: 'create-child', parentId })
    setFormState(buildEmptyForm(parentId))
    setIsDialogOpen(true)
  }

  const openChildEditDialog = (parentId: string, child: HeaderMenuChildItem) => {
    setDialogState({ mode: 'edit-child', targetId: child.id, parentId })
    setFormState({
      title: child.title,
      href: child.href,
      parentId,
    })
    setIsDialogOpen(true)
  }

  const handleMoveParent = (index: number, direction: 'up' | 'down') => {
    updateConfigItems((items) => moveArrayItem(items, index, direction))
  }

  const handleMoveChild = (parentId: string, childIndex: number, direction: 'up' | 'down') => {
    updateConfigItems((items) => items.map((item) => {
      if (item.id !== parentId) return item
      return {
        ...item,
        children: moveArrayItem(item.children, childIndex, direction),
      }
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
          return {
            ...item,
            children: item.children.filter((child) => child.id !== deleteTarget.id),
          }
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
    const parentItem = selectedParentId
      ? config.items.find((item) => item.id === selectedParentId)
      : null

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
      updateConfigItems((items) => ([
        ...items,
        {
          id: crypto.randomUUID(),
          title,
          href,
          isActive: true,
          children: [],
        },
      ]))
    }

    if (dialogState.mode === 'edit-parent') {
      updateConfigItems((items) => items.map((item) => {
        if (item.id !== dialogState.targetId) return item
        return {
          ...item,
          title,
          href: href || undefined,
        }
      }))
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

      updateConfigItems((items) => items.map((item) => {
        if (item.id !== parentId) return item
        return {
          ...item,
          children: [
            ...item.children,
            {
              id: crypto.randomUUID(),
              title,
              href,
              isActive: true,
            },
          ],
        }
      }))
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
      }

      updateConfigItems((items) => items.map((item) => {
        const remainingChildren = item.children.filter((child) => child.id !== targetId)

        if (item.id === parentId) {
          return {
            ...item,
            children: [...remainingChildren, movedChild],
          }
        }

        return {
          ...item,
          children: remainingChildren,
        }
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
      const response = await saveMenuManagementConfig({
        ...config,
        logoText: nextLogoText,
      })

      if (!response.success) {
        throw new Error('저장에 실패했습니다.')
      }

      setConfig(response.data)
      setSavedConfig(response.data)
      setLogoText(response.data.logoText)
      toast.success('헤더 메뉴 설정을 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">메뉴관리</h1>
          <p className="mt-1 text-gray-500">헤더 로고 문구와 메뉴를 추가, 수정, 삭제하고 2단계 메뉴까지 관리할 수 있습니다.</p>
        </div>
        <Button onClick={handleSaveAll} disabled={isSaving || !hasUnsavedChanges}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          변경사항 저장
        </Button>
      </div>

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
            <CardTitle>헤더 메뉴 목록</CardTitle>
            <CardDescription>상위 메뉴와 하위 메뉴(2단계)를 구성합니다. 하위 메뉴 경로는 상위 경로 뒤에 자동으로 이어집니다.</CardDescription>
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
                  <TableHead className="w-[100px] text-center">하위 메뉴</TableHead>
                  <TableHead className="w-[110px] text-center">노출</TableHead>
                  <TableHead className="w-[220px] text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flatRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-gray-500">등록된 메뉴가 없습니다. 상위 메뉴를 먼저 추가해주세요.</TableCell>
                  </TableRow>
                ) : (
                  config.items.map((item, parentIndex) => (
                    <Fragment key={item.id}>
                      <TableRow>
                        <TableCell><Badge variant="secondary">1단계</Badge></TableCell>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell className="text-gray-600">{item.href || '-'}</TableCell>
                        <TableCell className="text-center">{item.children.length}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <Switch checked={item.isActive} onCheckedChange={(checked) => handleToggleParent(item.id, checked)} />
                            <span className="text-xs text-gray-500">{item.isActive ? '활성' : '비활성'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleMoveParent(parentIndex, 'up')} disabled={parentIndex === 0}><ArrowUp className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleMoveParent(parentIndex, 'down')} disabled={parentIndex === config.items.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openChildCreateDialog(item.id)}><Plus className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openParentEditDialog(item)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setDeleteTarget({ id: item.id, title: item.title, hasChildren: item.children.length > 0 })}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {item.children.map((child, childIndex) => (
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
            <DialogDescription>헤더 메뉴는 최대 2단계까지 설정할 수 있습니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {(dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child') && (
              <div className="space-y-2">
                <Label>상위 메뉴</Label>
                <Select value={formState.parentId} onValueChange={(value) => setFormState((current) => ({ ...current, parentId: value }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="상위 메뉴를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {config.items.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="menu-title">메뉴명</Label>
              <Input id="menu-title" value={formState.title} maxLength={MAX_MENU_TITLE_LENGTH} onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))} placeholder="예: 문제은행" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="menu-href">{dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? '하위 경로' : '링크'}</Label>
              <Input
                id="menu-href"
                value={formState.href}
                onChange={(event) => setFormState((current) => ({ ...current, href: event.target.value }))}
                placeholder={dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? '예: /textbook' : '예: /generate'}
              />
              {dialogState?.mode === 'create-child' || dialogState?.mode === 'edit-child' ? (
                <div className="space-y-1 text-sm text-gray-500">
                  <p>하위 메뉴 링크는 상위 메뉴 링크를 기준으로 결합됩니다.</p>
                  {selectedParent?.href ? (
                    <p>예: {selectedParent.href} + /textbook → {resolveHeaderMenuHref(selectedParent.href, '/textbook')}</p>
                  ) : (
                    <p>상위 메뉴 링크가 있어야 실제 2단계 주소를 미리볼 수 있습니다.</p>
                  )}
                  {childResolvedHrefPreview ? (
                    <p className="font-medium text-gray-700">실제 주소: {childResolvedHrefPreview}</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-gray-500">상위 메뉴 링크는 2단계 메뉴의 기준 경로가 됩니다. 예: /generate</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>취소</Button>
            <Button onClick={handleSubmitMenu}>적용</Button>
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
    </div>
  )
}
