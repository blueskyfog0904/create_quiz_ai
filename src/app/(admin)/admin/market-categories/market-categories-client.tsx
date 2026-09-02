'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface CategoryItemRow {
  id: string
  title: string
  sortOrder: number
  isActive: boolean
}

interface CategoryGroupRow {
  id: string
  title: string
  sortOrder: number
  isActive: boolean
  items: CategoryItemRow[]
}

interface RowDraft {
  title: string
  sortOrder: string
}

function getErrorMessage(result: unknown, fallback: string) {
  const error = (result as { error?: unknown } | null)?.error
  if (typeof error === 'string') {
    return error
  }
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : fallback
}

export default function MarketCategoriesClient({ workspaceSubject }: { workspaceSubject: WorkspaceSubject }) {
  const [groups, setGroups] = useState<CategoryGroupRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [groupDrafts, setGroupDrafts] = useState<Record<string, RowDraft>>({})
  const [itemDrafts, setItemDrafts] = useState<Record<string, RowDraft>>({})
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [newGroupSortOrder, setNewGroupSortOrder] = useState('')
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemSortOrder, setNewItemSortOrder] = useState('')

  const loadGroups = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/market-categories', workspaceSubject))
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(getErrorMessage(result, '카테고리 메뉴를 불러오지 못했습니다.'))
      }
      const rows: CategoryGroupRow[] = result.data?.groups ?? []
      setGroups(rows)
      setGroupDrafts(Object.fromEntries(rows.map((group) => [group.id, { title: group.title, sortOrder: String(group.sortOrder) }])))
      setItemDrafts(Object.fromEntries(rows.flatMap((group) => (
        group.items.map((item) => [item.id, { title: item.title, sortOrder: String(item.sortOrder) }])
      ))))
      setSelectedGroupId((current) => (current && rows.some((group) => group.id === current) ? current : rows[0]?.id ?? null))
    } catch (error) {
      alert(error instanceof Error ? error.message : '카테고리 메뉴를 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSubject])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  )

  const runMutation = async (savingKey: string, request: () => Promise<Response>, fallbackMessage: string) => {
    setSavingId(savingKey)
    try {
      const response = await request()
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(getErrorMessage(result, fallbackMessage))
      }
      await loadGroups()
      return true
    } catch (error) {
      alert(error instanceof Error ? error.message : fallbackMessage)
      return false
    } finally {
      setSavingId(null)
    }
  }

  const createGroup = async () => {
    const title = newGroupTitle.trim()
    if (!title) {
      alert('그룹 제목을 입력하세요.')
      return
    }
    const succeeded = await runMutation('new-group', () => fetch('/api/admin/market-categories/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_subject: workspaceSubject,
        title,
        sort_order: Number(newGroupSortOrder) || 0,
      }),
    }), '그룹 추가에 실패했습니다.')
    if (succeeded) {
      setNewGroupTitle('')
      setNewGroupSortOrder('')
    }
  }

  const patchGroup = (groupId: string, payload: { title?: string; sort_order?: number; is_active?: boolean }) => (
    runMutation(groupId, () => fetch(`/api/admin/market-categories/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), '그룹 저장에 실패했습니다.')
  )

  const deleteGroup = (group: CategoryGroupRow) => {
    if (!window.confirm(`'${group.title}' 그룹을 삭제할까요? 하위 항목도 함께 삭제되고 연결된 상품은 카테고리 미지정으로 풀립니다.`)) {
      return
    }
    void runMutation(group.id, () => fetch(`/api/admin/market-categories/groups/${group.id}`, {
      method: 'DELETE',
    }), '그룹 삭제에 실패했습니다.')
  }

  const saveGroupDraft = (group: CategoryGroupRow) => {
    const draft = groupDrafts[group.id]
    if (!draft) return
    void patchGroup(group.id, {
      title: draft.title.trim(),
      sort_order: Number(draft.sortOrder) || 0,
    })
  }

  const createItem = async () => {
    if (!selectedGroupId) {
      alert('먼저 그룹을 선택하세요.')
      return
    }
    const title = newItemTitle.trim()
    if (!title) {
      alert('항목 제목을 입력하세요.')
      return
    }
    const succeeded = await runMutation('new-item', () => fetch('/api/admin/market-categories/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: selectedGroupId,
        title,
        sort_order: Number(newItemSortOrder) || 0,
      }),
    }), '항목 추가에 실패했습니다.')
    if (succeeded) {
      setNewItemTitle('')
      setNewItemSortOrder('')
    }
  }

  const patchItem = (itemId: string, payload: { title?: string; sort_order?: number; is_active?: boolean }) => (
    runMutation(itemId, () => fetch(`/api/admin/market-categories/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), '항목 저장에 실패했습니다.')
  )

  const deleteItem = (item: CategoryItemRow) => {
    if (!window.confirm(`'${item.title}' 항목을 삭제할까요? 연결된 상품은 카테고리 미지정으로 풀립니다.`)) {
      return
    }
    void runMutation(item.id, () => fetch(`/api/admin/market-categories/items/${item.id}`, {
      method: 'DELETE',
    }), '항목 삭제에 실패했습니다.')
  }

  const saveItemDraft = (item: CategoryItemRow) => {
    const draft = itemDrafts[item.id]
    if (!draft) return
    void patchItem(item.id, {
      title: draft.title.trim(),
      sort_order: Number(draft.sortOrder) || 0,
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">새 그룹 추가 (2단계)</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={newGroupTitle}
            onChange={(event) => setNewGroupTitle(event.target.value)}
            placeholder="예: 교과서"
            className="w-80"
          />
          <Input
            value={newGroupSortOrder}
            onChange={(event) => setNewGroupSortOrder(event.target.value)}
            placeholder="정렬 순서 (숫자)"
            className="w-40"
            inputMode="numeric"
          />
          <Button type="button" disabled={savingId === 'new-group'} onClick={() => void createGroup()}>
            {savingId === 'new-group' ? '추가 중…' : '그룹 추가'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-3 font-medium">그룹 제목</th>
              <th className="w-32 px-4 py-3 font-medium">정렬 순서</th>
              <th className="w-24 px-4 py-3 font-medium">상태</th>
              <th className="w-20 px-4 py-3 font-medium">항목 수</th>
              <th className="w-72 px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">불러오는 중…</td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">등록된 그룹이 없습니다.</td>
              </tr>
            ) : (
              groups.map((group) => {
                const draft = groupDrafts[group.id] ?? { title: group.title, sortOrder: String(group.sortOrder) }
                const isDirty = draft.title !== group.title || Number(draft.sortOrder) !== group.sortOrder
                const isSelected = group.id === selectedGroupId
                return (
                  <tr
                    key={group.id}
                    onClick={() => setSelectedGroupId(group.id)}
                    className={`cursor-pointer border-b last:border-b-0 ${isSelected ? 'bg-muted/40' : ''} ${group.isActive ? '' : 'opacity-60'}`}
                  >
                    <td className="px-4 py-2">
                      <Input
                        value={draft.title}
                        onChange={(event) => setGroupDrafts((current) => ({
                          ...current,
                          [group.id]: { ...draft, title: event.target.value },
                        }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        value={draft.sortOrder}
                        inputMode="numeric"
                        onChange={(event) => setGroupDrafts((current) => ({
                          ...current,
                          [group.id]: { ...draft, sortOrder: event.target.value },
                        }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-medium ${group.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {group.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{group.items.length}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === group.id || !isDirty}
                          onClick={() => saveGroupDraft(group)}
                        >
                          저장
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === group.id}
                          onClick={() => void patchGroup(group.id, { is_active: !group.isActive })}
                        >
                          {group.isActive ? '비활성화' : '활성화'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === group.id}
                          onClick={() => deleteGroup(group)}
                        >
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedGroup ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">&apos;{selectedGroup.title}&apos; 항목 관리 (3단계)</h3>
          <div className="rounded-lg border p-4">
            <h4 className="text-sm font-semibold">새 항목 추가</h4>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={newItemTitle}
                onChange={(event) => setNewItemTitle(event.target.value)}
                placeholder="예: 공통국어1 동아(최)"
                className="w-80"
              />
              <Input
                value={newItemSortOrder}
                onChange={(event) => setNewItemSortOrder(event.target.value)}
                placeholder="정렬 순서 (숫자)"
                className="w-40"
                inputMode="numeric"
              />
              <Button type="button" disabled={savingId === 'new-item'} onClick={() => void createItem()}>
                {savingId === 'new-item' ? '추가 중…' : '항목 추가'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 font-medium">항목 제목</th>
                  <th className="w-32 px-4 py-3 font-medium">정렬 순서</th>
                  <th className="w-24 px-4 py-3 font-medium">상태</th>
                  <th className="w-28 px-4 py-3 font-medium">페이지</th>
                  <th className="w-72 px-4 py-3 font-medium">작업</th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">등록된 항목이 없습니다.</td>
                  </tr>
                ) : (
                  selectedGroup.items.map((item) => {
                    const draft = itemDrafts[item.id] ?? { title: item.title, sortOrder: String(item.sortOrder) }
                    const isDirty = draft.title !== item.title || Number(draft.sortOrder) !== item.sortOrder
                    return (
                      <tr key={item.id} className={`border-b last:border-b-0 ${item.isActive ? '' : 'opacity-60'}`}>
                        <td className="px-4 py-2">
                          <Input
                            value={draft.title}
                            onChange={(event) => setItemDrafts((current) => ({
                              ...current,
                              [item.id]: { ...draft, title: event.target.value },
                            }))}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Input
                            value={draft.sortOrder}
                            inputMode="numeric"
                            onChange={(event) => setItemDrafts((current) => ({
                              ...current,
                              [item.id]: { ...draft, sortOrder: event.target.value },
                            }))}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <span className={`rounded px-2 py-1 text-xs font-medium ${item.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {item.isActive ? '활성' : '비활성'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <a
                            href={`/categories/${item.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-blue-600 underline underline-offset-2"
                          >
                            새 탭 열기
                          </a>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={savingId === item.id || !isDirty}
                              onClick={() => saveItemDraft(item)}
                            >
                              저장
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={savingId === item.id}
                              onClick={() => void patchItem(item.id, { is_active: !item.isActive })}
                            >
                              {item.isActive ? '비활성화' : '활성화'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={savingId === item.id}
                              onClick={() => deleteItem(item)}
                            >
                              삭제
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
