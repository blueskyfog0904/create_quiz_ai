'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import type { MarketMenuEntryAdminRow } from '@/lib/market-menu'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  archiveMarketMenuGroupAction,
  assignMarketMenuEntriesToGroupAction,
  createMarketMenuGroupAction,
  reorderMarketMenuGroupsAction,
  updateMarketMenuGroupAction,
  type MenuManagementPageData,
} from './actions'

type MarketMenuGroup = MenuManagementPageData['marketMenuGroups'][number]
type MarketMenuGroupAssignment = MenuManagementPageData['marketMenuEntryGroupAssignments'][number]

interface MarketMenuGroupsManagerProps {
  workspaceSubject: WorkspaceSubject
  groups: MarketMenuGroup[]
  entries: MarketMenuEntryAdminRow[]
  assignments: MarketMenuGroupAssignment[]
}

interface GroupFormState {
  id?: string
  title: string
  groupKey: string
  isVisible: boolean
  isActive: boolean
}

const interactiveClassName =
  'min-h-11 min-w-11 focus-visible:ring-2 focus-visible:ring-ring'

function sortGroups(groups: MarketMenuGroup[]) {
  return [...groups]
    .filter((group) => group.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko'))
}

function buildAssignmentMap(
  entries: MarketMenuEntryAdminRow[],
  assignments: MarketMenuGroupAssignment[],
  groups: MarketMenuGroup[]
) {
  const validGroupIds = new Set(sortGroups(groups).map((group) => group.id))
  const assignmentsByEntry = new Map(
    assignments.map((assignment) => [assignment.entryId, assignment.groupId])
  )

  return Object.fromEntries(entries.map((entry) => {
    const groupId = assignmentsByEntry.get(entry.id) ?? null
    return [entry.id, groupId && validGroupIds.has(groupId) ? groupId : null]
  })) as Record<string, string | null>
}

function moveGroup(
  groups: MarketMenuGroup[],
  index: number,
  direction: 'up' | 'down'
) {
  const nextIndex = direction === 'up' ? index - 1 : index + 1
  if (nextIndex < 0 || nextIndex >= groups.length) {
    return groups
  }

  const nextGroups = [...groups]
  const [movedGroup] = nextGroups.splice(index, 1)
  nextGroups.splice(nextIndex, 0, movedGroup)

  return nextGroups.map((group, groupIndex) => ({
    ...group,
    sort_order: (groupIndex + 1) * 10,
  }))
}

function emptyGroupForm(): GroupFormState {
  return {
    title: '',
    groupKey: '',
    isVisible: true,
    isActive: true,
  }
}

export function MarketMenuGroupsManager({
  workspaceSubject,
  groups: initialGroups,
  entries,
  assignments: initialAssignments,
}: MarketMenuGroupsManagerProps) {
  const router = useRouter()
  const [groups, setGroups] = useState(() => sortGroups(initialGroups))
  const [assignmentByEntry, setAssignmentByEntry] = useState(() => (
    buildAssignmentMap(entries, initialAssignments, initialGroups)
  ))
  const [savedAssignmentByEntry, setSavedAssignmentByEntry] = useState(() => (
    buildAssignmentMap(entries, initialAssignments, initialGroups)
  ))
  const [groupForm, setGroupForm] = useState<GroupFormState>(emptyGroupForm)
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<MarketMenuGroup | null>(null)
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null)
  const [isSavingAssignments, setIsSavingAssignments] = useState(false)

  useEffect(() => {
    const nextGroups = sortGroups(initialGroups)
    const nextAssignments = buildAssignmentMap(entries, initialAssignments, nextGroups)
    setGroups(nextGroups)
    setAssignmentByEntry(nextAssignments)
    setSavedAssignmentByEntry(nextAssignments)
    setGroupForm(emptyGroupForm())
    setIsGroupDialogOpen(false)
    setArchiveTarget(null)
  }, [entries, initialAssignments, initialGroups, workspaceSubject])

  const orderedEntries = useMemo(
    () => [...entries].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko')),
    [entries]
  )
  const hasUnsavedAssignments = useMemo(
    () => orderedEntries.some((entry) => (
      (assignmentByEntry[entry.id] ?? null) !== (savedAssignmentByEntry[entry.id] ?? null)
    )),
    [assignmentByEntry, orderedEntries, savedAssignmentByEntry]
  )
  const isMutating = pendingGroupId !== null || isSavingAssignments

  const closeGroupDialog = () => {
    setIsGroupDialogOpen(false)
    setGroupForm(emptyGroupForm())
  }

  const openCreateDialog = () => {
    setGroupForm(emptyGroupForm())
    setIsGroupDialogOpen(true)
  }

  const openEditDialog = (group: MarketMenuGroup) => {
    setGroupForm({
      id: group.id,
      title: group.title,
      groupKey: group.group_key,
      isVisible: group.is_visible,
      isActive: group.is_active,
    })
    setIsGroupDialogOpen(true)
  }

  const handleSubmitGroup = async () => {
    const title = groupForm.title.trim()
    const groupKey = groupForm.groupKey.trim()
    if (!title || !groupKey) {
      toast.error('그룹명과 그룹 key를 입력해주세요.')
      return
    }

    const pendingId = groupForm.id ?? 'create'
    setPendingGroupId(pendingId)
    try {
      const input = {
        title,
        groupKey,
        isVisible: groupForm.isVisible,
        isActive: groupForm.isActive,
        sortOrder: groupForm.id
          ? groups.find((group) => group.id === groupForm.id)?.sort_order
          : (groups.length + 1) * 10,
      }
      const response = groupForm.id
        ? await updateMarketMenuGroupAction(groupForm.id, input, workspaceSubject)
        : await createMarketMenuGroupAction(input, workspaceSubject)

      setGroups((current) => sortGroups(
        groupForm.id
          ? current.map((group) => group.id === groupForm.id ? response.data : group)
          : [...current, response.data]
      ))
      toast.success(groupForm.id ? '카테고리 그룹을 수정했습니다.' : '카테고리 그룹을 추가했습니다.')
      closeGroupDialog()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리 그룹 저장에 실패했습니다.')
    } finally {
      setPendingGroupId(null)
    }
  }

  const handleToggleGroup = async (
    group: MarketMenuGroup,
    field: 'isVisible' | 'isActive',
    checked: boolean
  ) => {
    setPendingGroupId(group.id)
    try {
      const response = await updateMarketMenuGroupAction(group.id, {
        [field]: checked,
      }, workspaceSubject)
      setGroups((current) => current.map((item) => (
        item.id === group.id ? response.data : item
      )))
      toast.success(field === 'isVisible' ? '그룹 노출 상태를 저장했습니다.' : '그룹 활성 상태를 저장했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리 그룹 상태 저장에 실패했습니다.')
    } finally {
      setPendingGroupId(null)
    }
  }

  const handleMoveGroup = async (index: number, direction: 'up' | 'down') => {
    const previousGroups = groups
    const nextGroups = moveGroup(groups, index, direction)
    if (nextGroups === groups) {
      return
    }

    setGroups(nextGroups)
    setPendingGroupId(nextGroups[index]?.id ?? 'reorder')
    try {
      await reorderMarketMenuGroupsAction(nextGroups.map((group) => group.id), workspaceSubject)
      toast.success('카테고리 그룹 순서를 저장했습니다.')
      router.refresh()
    } catch (error) {
      setGroups(previousGroups)
      toast.error(error instanceof Error ? error.message : '카테고리 그룹 순서 저장에 실패했습니다.')
    } finally {
      setPendingGroupId(null)
    }
  }

  const handleArchiveGroup = async () => {
    if (!archiveTarget) {
      return
    }

    setPendingGroupId(archiveTarget.id)
    try {
      await archiveMarketMenuGroupAction(archiveTarget.id, workspaceSubject)
      setGroups((current) => current.filter((group) => group.id !== archiveTarget.id))
      setAssignmentByEntry((current) => Object.fromEntries(
        Object.entries(current).map(([entryId, groupId]) => (
          [entryId, groupId === archiveTarget.id ? null : groupId]
        ))
      ))
      setSavedAssignmentByEntry((current) => Object.fromEntries(
        Object.entries(current).map(([entryId, groupId]) => (
          [entryId, groupId === archiveTarget.id ? null : groupId]
        ))
      ))
      setArchiveTarget(null)
      toast.success('카테고리 그룹을 삭제했습니다. 연결된 메뉴는 기타로 표시됩니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카테고리 그룹 삭제에 실패했습니다.')
    } finally {
      setPendingGroupId(null)
    }
  }

  const handleSaveAssignments = async () => {
    const changedEntries = orderedEntries.filter((entry) => (
      (assignmentByEntry[entry.id] ?? null) !== (savedAssignmentByEntry[entry.id] ?? null)
    ))
    if (changedEntries.length === 0) {
      return
    }

    const entriesByTargetGroup = new Map<string | null, string[]>()
    for (const entry of changedEntries) {
      const groupId = assignmentByEntry[entry.id] ?? null
      entriesByTargetGroup.set(groupId, [
        ...(entriesByTargetGroup.get(groupId) ?? []),
        entry.id,
      ])
    }

    setIsSavingAssignments(true)
    try {
      await Promise.all(Array.from(entriesByTargetGroup.entries()).map(([groupId, ids]) => (
        assignMarketMenuEntriesToGroupAction(ids, groupId, workspaceSubject)
      )))
      setSavedAssignmentByEntry({ ...assignmentByEntry })
      toast.success('문제마켓 메뉴의 그룹 편성을 저장했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 메뉴 그룹 편성 저장에 실패했습니다.')
    } finally {
      setIsSavingAssignments(false)
    }
  }

  const renderEntryCheckboxes = (groupId: string | null) => (
    <div className="space-y-1">
      {orderedEntries.length === 0 ? (
        <p className="py-4 text-sm text-gray-500">배치할 문제마켓 메뉴가 없습니다.</p>
      ) : orderedEntries.map((entry) => {
        const checked = (assignmentByEntry[entry.id] ?? null) === groupId
        const checkboxId = `market-menu-group-${groupId ?? 'ungrouped'}-${entry.id}`

        return (
          <Label
            key={entry.id}
            htmlFor={checkboxId}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-ring"
          >
            <Checkbox
              id={checkboxId}
              checked={checked}
              disabled={isMutating}
              onCheckedChange={(nextChecked) => {
                if (nextChecked === true || (checked && groupId !== null)) {
                  setAssignmentByEntry((current) => ({
                    ...current,
                    [entry.id]: nextChecked === true ? groupId : null,
                  }))
                }
              }}
            />
            <span className="min-w-0 flex-1 truncate">{entry.title}</span>
            <span className="shrink-0 text-xs text-gray-500">/{entry.slug}</span>
          </Label>
        )
      })}
    </div>
  )

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>문제마켓 카테고리 그룹</CardTitle>
            <CardDescription>
              {workspaceSubject === 'english' ? '영어' : '국어'} 문제마켓의 1단계 그룹과 2단계 메뉴 배치를 관리합니다.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className={interactiveClassName}
              onClick={openCreateDialog}
              disabled={isMutating}
            >
              <Plus className="mr-2 h-4 w-4" />
              그룹 추가
            </Button>
            <Button
              type="button"
              className={interactiveClassName}
              onClick={handleSaveAssignments}
              disabled={isMutating || !hasUnsavedAssignments}
            >
              {isSavingAssignments ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              그룹 편성 저장
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="font-medium text-gray-900">등록된 카테고리 그룹이 없습니다.</p>
              <p className="mt-1 text-sm text-gray-500">그룹을 추가한 뒤 문제마켓 메뉴를 배치해주세요.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {groups.map((group, index) => (
                <section key={group.id} className="rounded-lg border bg-white p-4" aria-labelledby={`market-group-title-${group.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 id={`market-group-title-${group.id}`} className="font-semibold text-gray-900">{group.title}</h3>
                      <p className="mt-1 text-xs text-gray-500">{group.group_key}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={interactiveClassName}
                        aria-label={`${group.title} 위로 이동`}
                        onClick={() => handleMoveGroup(index, 'up')}
                        disabled={isMutating || index === 0}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={interactiveClassName}
                        aria-label={`${group.title} 아래로 이동`}
                        onClick={() => handleMoveGroup(index, 'down')}
                        disabled={isMutating || index === groups.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={interactiveClassName}
                        aria-label={`${group.title} 수정`}
                        onClick={() => openEditDialog(group)}
                        disabled={isMutating}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={`${interactiveClassName} text-red-500 hover:bg-red-50 hover:text-red-600`}
                        aria-label={`${group.title} 삭제`}
                        onClick={() => setArchiveTarget(group)}
                        disabled={isMutating}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-y py-2">
                    <Label htmlFor={`market-group-visible-${group.id}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                      <Switch
                        id={`market-group-visible-${group.id}`}
                        checked={group.is_visible}
                        disabled={isMutating}
                        onCheckedChange={(checked) => handleToggleGroup(group, 'isVisible', checked)}
                      />
                      노출
                    </Label>
                    <Label htmlFor={`market-group-active-${group.id}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                      <Switch
                        id={`market-group-active-${group.id}`}
                        checked={group.is_active}
                        disabled={isMutating}
                        onCheckedChange={(checked) => handleToggleGroup(group, 'isActive', checked)}
                      />
                      활성
                    </Label>
                    <Badge variant="secondary">
                      메뉴 {orderedEntries.filter((entry) => assignmentByEntry[entry.id] === group.id).length}개
                    </Badge>
                  </div>

                  <div className="mt-3">{renderEntryCheckboxes(group.id)}</div>
                </section>
              ))}
            </div>
          )}

          <section className="rounded-lg border border-dashed bg-slate-50 p-4" aria-labelledby="ungrouped-market-menu-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="ungrouped-market-menu-title" className="font-semibold text-gray-900">기타 (미배치)</h3>
                <p className="mt-1 text-sm text-gray-500">그룹이 없거나 삭제된 그룹에 연결된 메뉴는 공개 게시판에서 기타로 표시됩니다.</p>
              </div>
              <Badge variant="outline">
                메뉴 {orderedEntries.filter((entry) => (assignmentByEntry[entry.id] ?? null) === null).length}개
              </Badge>
            </div>
            <div className="mt-3">{renderEntryCheckboxes(null)}</div>
          </section>
        </CardContent>
      </Card>

      <Dialog open={isGroupDialogOpen} onOpenChange={(open) => !open && closeGroupDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupForm.id ? '카테고리 그룹 수정' : '카테고리 그룹 추가'}</DialogTitle>
            <DialogDescription>
              현재 과목 안에서 문제마켓 메뉴를 묶을 1단계 그룹을 설정합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="market-group-title">그룹명</Label>
              <Input
                id="market-group-title"
                className="min-h-11 focus-visible:ring-2 focus-visible:ring-ring"
                value={groupForm.title}
                maxLength={30}
                placeholder="예: EBS"
                onChange={(event) => setGroupForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="market-group-key">그룹 key</Label>
              <Input
                id="market-group-key"
                className="min-h-11 focus-visible:ring-2 focus-visible:ring-ring"
                value={groupForm.groupKey}
                maxLength={50}
                placeholder="예: ebs"
                onChange={(event) => setGroupForm((current) => ({ ...current, groupKey: event.target.value }))}
              />
              <p className="text-sm text-gray-500">영문 소문자, 숫자, 하이픈으로 저장됩니다.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Label htmlFor="market-group-form-visible" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
                <Switch
                  id="market-group-form-visible"
                  checked={groupForm.isVisible}
                  onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, isVisible: checked }))}
                />
                공개 게시판에 노출
              </Label>
              <Label htmlFor="market-group-form-active" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
                <Switch
                  id="market-group-form-active"
                  checked={groupForm.isActive}
                  onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, isActive: checked }))}
                />
                그룹 활성
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className={interactiveClassName} onClick={closeGroupDialog}>
              취소
            </Button>
            <Button type="button" className={interactiveClassName} onClick={handleSubmitGroup} disabled={pendingGroupId !== null}>
              {pendingGroupId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>카테고리 그룹을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              [{archiveTarget?.title}] 그룹을 삭제합니다. 연결된 문제마켓 메뉴는 삭제되지 않고 기타로 표시됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={interactiveClassName}>취소</AlertDialogCancel>
            <AlertDialogAction
              className={`${interactiveClassName} bg-red-600 hover:bg-red-700`}
              onClick={handleArchiveGroup}
              disabled={pendingGroupId !== null}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
