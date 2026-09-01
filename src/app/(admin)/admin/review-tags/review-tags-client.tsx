'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
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

  const loadTags = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/review-tags', workspaceSubject))
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '태그를 불러오지 못했습니다.')
      }
      const rows: ReviewTagRow[] = result.data
      setTags(rows)
      setDrafts(Object.fromEntries(rows.map((tag) => [tag.id, { label: tag.label, sortOrder: String(tag.sortOrder) }])))
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
      await loadTags()
    } catch (error) {
      alert(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
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
          <Button type="button" disabled={savingId === 'new'} onClick={() => void createTag()}>
            {savingId === 'new' ? '추가 중…' : '태그 추가'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
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
                        value={draft.label}
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [tag.id]: { ...draft, label: event.target.value },
                        }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
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
                          variant="outline"
                          disabled={savingId === tag.id || !isDirty}
                          onClick={() => saveDraft(tag)}
                        >
                          저장
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === tag.id}
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
