'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface ReviewTagRow {
  id: string
  label: string
  sortOrder: number
  isActive: boolean
}

export default function ReviewTagsClient({ workspaceSubject }: { workspaceSubject: WorkspaceSubject }) {
  const [tags, setTags] = useState<ReviewTagRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [newSortOrder, setNewSortOrder] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { label: string; sortOrder: string }>>({})
  // 다시 읽을 때 다른 행의 저장 안 한 입력을 지키려고 마지막 서버 값을 둔다.
  const serverTagsRef = useRef<Record<string, ReviewTagRow>>({})

  // resetIds: 방금 저장한 행들. 그 행과 고치지 않은 행만 서버 값으로 바꾸고, 다른 행의 고친 입력은 남긴다.
  const loadTags = useCallback(async (resetIds: string[] = []) => {
    setIsLoading(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/review-tags', workspaceSubject))
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '태그를 불러오지 못했습니다.')
      }
      const rows: ReviewTagRow[] = result.data
      const previousServerTags = serverTagsRef.current
      serverTagsRef.current = Object.fromEntries(rows.map((tag) => [tag.id, tag]))
      setTags(rows)
      setDrafts((current) => Object.fromEntries(rows.map((tag) => {
        const draft = current[tag.id]
        const previous = previousServerTags[tag.id]
        const isEdited = draft && previous && (draft.label !== previous.label || draft.sortOrder !== String(previous.sortOrder))
        return [tag.id, !resetIds.includes(tag.id) && isEdited ? draft : { label: tag.label, sortOrder: String(tag.sortOrder) }]
      })))
    } catch (error) {
      alert(error instanceof Error ? error.message : '태그를 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSubject])

  useEffect(() => {
    void loadTags()
  }, [loadTags])

  const createTag = async () => {
    const label = newLabel.trim()
    if (!label) {
      alert('태그 문구를 입력하세요.')
      return
    }
    setSavingId('new')
    try {
      const response = await fetch('/api/admin/review-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_subject: workspaceSubject,
          label,
          sort_order: Number(newSortOrder) || 0,
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '태그 추가에 실패했습니다.')
      }
      setNewLabel('')
      setNewSortOrder('')
      await loadTags()
    } catch (error) {
      alert(error instanceof Error ? error.message : '태그 추가에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const patchTag = async (tagId: string, payload: { label?: string; sort_order?: number; is_active?: boolean }) => {
    setSavingId(tagId)
    try {
      const response = await fetch(`/api/admin/review-tags/${tagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '저장에 실패했습니다.')
      }
      // 사용 여부만 바꾼 경우(문구·순서를 보내지 않음)는 그 행의 고친 입력도 남긴다.
      await loadTags(payload.label !== undefined || payload.sort_order !== undefined ? [tagId] : [])
    } catch (error) {
      alert(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const isTagDirty = (tag: ReviewTagRow) => {
    const draft = drafts[tag.id]
    return Boolean(draft) && (draft.label !== tag.label || Number(draft.sortOrder) !== tag.sortOrder)
  }
  const dirtyTags = tags.filter(isTagDirty)

  // 저장하지 않고 다른 화면으로 가면 고친 입력이 사라지므로 떠날 때 확인한다.
  useUnsavedChangesGuard(dirtyTags.length > 0)

  // 고친 행을 차례로 저장한다. 하나가 실패하면 멈추고, 저장된 행만 서버 값으로 맞춘다(나머지 고친 입력은 남김).
  const saveAllDrafts = async () => {
    if (dirtyTags.length === 0) return
    setSavingId('all')
    const savedIds: string[] = []
    try {
      for (const tag of dirtyTags) {
        const draft = drafts[tag.id]
        const response = await fetch(`/api/admin/review-tags/${tag.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: draft.label.trim(), sort_order: Number(draft.sortOrder) || 0 }),
        })
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) {
          throw new Error(`'${draft.label.trim() || tag.label}' 저장에 실패했습니다. ${result?.error ?? ''}`.trim())
        }
        savedIds.push(tag.id)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
      await loadTags(savedIds)
      setSavingId(null)
    }
  }

  const saveDraft = (tag: ReviewTagRow) => {
    const draft = drafts[tag.id]
    if (!draft) return
    void patchTag(tag.id, {
      label: draft.label.trim(),
      sort_order: Number(draft.sortOrder) || 0,
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">새 태그 추가</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="예: 🧠 개념 정리에 좋아요."
            className="w-80"
          />
          <Input
            value={newSortOrder}
            onChange={(event) => setNewSortOrder(event.target.value)}
            placeholder="정렬 순서 (숫자)"
            className="w-40"
            inputMode="numeric"
          />
          <Button type="button" disabled={savingId !== null} onClick={() => void createTag()}>
            {savingId === 'new' ? '추가 중…' : '태그 추가'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {dirtyTags.length > 0 ? <span className="font-medium text-amber-700">저장 안 한 변경 {dirtyTags.length}건</span> : '고친 문구·순서는 줄마다 저장하거나 모두 저장으로 한 번에 저장합니다.'}
          </p>
          <Button type="button" size="sm" disabled={savingId !== null || dirtyTags.length === 0} onClick={() => void saveAllDrafts()}>
            {savingId === 'all' ? '저장 중…' : '모두 저장'}
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-3 font-medium">태그 문구</th>
              <th className="w-32 px-4 py-3 font-medium">정렬 순서</th>
              <th className="w-24 px-4 py-3 font-medium">상태</th>
              <th className="w-56 px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">불러오는 중…</td>
              </tr>
            ) : tags.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">등록된 태그가 없습니다.</td>
              </tr>
            ) : (
              tags.map((tag) => {
                const draft = drafts[tag.id] ?? { label: tag.label, sortOrder: String(tag.sortOrder) }
                const isDirty = draft.label !== tag.label || Number(draft.sortOrder) !== tag.sortOrder
                return (
                  <tr key={tag.id} className={`border-b last:border-b-0 ${tag.isActive ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2">
                      <Input
                        disabled={savingId === 'all'}
                        value={draft.label}
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [tag.id]: { ...draft, label: event.target.value },
                        }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        disabled={savingId === 'all'}
                        value={draft.sortOrder}
                        inputMode="numeric"
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [tag.id]: { ...draft, sortOrder: event.target.value },
                        }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-medium ${tag.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {tag.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="adminAction"
                          disabled={savingId === tag.id || savingId === 'all' || !isDirty}
                          onClick={() => saveDraft(tag)}
                        >
                          저장
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === tag.id || savingId === 'all'}
                          onClick={() => void patchTag(tag.id, { is_active: !tag.isActive })}
                        >
                          {tag.isActive ? '비활성화' : '활성화'}
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
  )
}
