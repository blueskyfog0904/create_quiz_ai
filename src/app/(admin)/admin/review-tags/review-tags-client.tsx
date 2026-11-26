'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar } from '@/components/admin/kit/admin-save-bar'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { adminStatusTone } from '@/lib/admin-status-tone'
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
  // 브라우저 알림 창 대신 화면 안에 보이는 오류(20번 Q3): 목록 읽기 실패, 추가·줄 저장 실패, 모두 저장 실패(저장 바).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saveAllError, setSaveAllError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // 다시 읽을 때 다른 행의 저장 안 한 입력을 지키려고 마지막 서버 값을 둔다.
  const serverTagsRef = useRef<Record<string, ReviewTagRow>>({})
  // 오류 띠는 표 위에 있어 아래 행에서 작업하면 안 보일 수 있다(전에는 알림 창). 오류가 생기면 띠로 옮겨 보인다.
  const actionErrorRef = useRef<HTMLDivElement>(null)

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
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '태그를 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSubject])

  useEffect(() => {
    void loadTags()
  }, [loadTags])

  useEffect(() => {
    if (actionError) actionErrorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [actionError])

  const createTag = async () => {
    const label = newLabel.trim()
    setActionError(null)
    if (!label) {
      setActionError('태그 문구를 입력하세요.')
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
      setSavedAt(Date.now())
      await loadTags()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '태그 추가에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const patchTag = async (tagId: string, payload: { label?: string; sort_order?: number; is_active?: boolean }) => {
    setSavingId(tagId)
    setActionError(null)
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
      setSavedAt(Date.now())
      // 사용 여부만 바꾼 경우(문구·순서를 보내지 않음)는 그 행의 고친 입력도 남긴다.
      await loadTags(payload.label !== undefined || payload.sort_order !== undefined ? [tagId] : [])
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '저장에 실패했습니다.')
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
    setActionError(null)
    setSaveAllError(null)
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
      setSavedAt(Date.now())
    } catch (error) {
      setSaveAllError(error instanceof Error ? error.message : '저장에 실패했습니다.')
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

  const draftOf = (tag: ReviewTagRow) => drafts[tag.id] ?? { label: tag.label, sortOrder: String(tag.sortOrder) }
  const updateDraft = (tag: ReviewTagRow, patch: Partial<{ label: string; sortOrder: string }>) => setDrafts((current) => ({
    ...current,
    [tag.id]: { ...draftOf(tag), ...patch },
  }))

  // 저장 바의 단추는 '모두 저장'(저장 함수 하나)뿐이다. '저장됨' 시각은 마지막 저장(추가·줄 저장·모두 저장) 때.
  // 모두 저장이 실패한 뒤 고친 행이 다 저장되면 실패 표시는 거둔다.
  const saveBarStatus = savingId === 'all' ? 'saving' : saveAllError && dirtyTags.length > 0 ? 'error' : savedAt ? 'saved' : 'idle'

  const columns: AdminDataTableColumn<ReviewTagRow>[] = [
    {
      key: 'label',
      header: '태그 문구',
      cell: (tag) => (
        <Input
          disabled={savingId === 'all'}
          value={draftOf(tag).label}
          onChange={(event) => updateDraft(tag, { label: event.target.value })}
        />
      ),
    },
    {
      key: 'sortOrder',
      header: '정렬 순서',
      headerClassName: 'w-32',
      cell: (tag) => (
        <Input
          disabled={savingId === 'all'}
          value={draftOf(tag).sortOrder}
          inputMode="numeric"
          onChange={(event) => updateDraft(tag, { sortOrder: event.target.value })}
        />
      ),
    },
    {
      key: 'status',
      header: '상태',
      headerClassName: 'w-24',
      cell: (tag) => (
        <AdminStatusBadge label={tag.isActive ? '활성' : '비활성'} tone={adminStatusTone('reviewTag', tag.isActive ? 'active' : 'inactive')} />
      ),
    },
    {
      key: 'actions',
      header: '작업',
      headerClassName: 'w-56',
      cell: (tag) => {
        const draft = draftOf(tag)
        const isDirty = draft.label !== tag.label || Number(draft.sortOrder) !== tag.sortOrder
        return (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="adminTable"
              disabled={savingId === tag.id || savingId === 'all' || !isDirty}
              onClick={() => saveDraft(tag)}
            >
              저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="adminTable"
              disabled={savingId === tag.id || savingId === 'all'}
              onClick={() => void patchTag(tag.id, { is_active: !tag.isActive })}
            >
              {tag.isActive ? '비활성화' : '활성화'}
            </Button>
          </div>
        )
      },
    },
  ]

  const tableState = isLoading ? (
    <AdminTableState kind="loading" message="불러오는 중…" />
  ) : loadError && tags.length === 0 ? (
    <AdminTableState kind="error" message={loadError} onRetry={() => void loadTags()} />
  ) : tags.length === 0 ? (
    <AdminTableState kind="empty" message="등록된 태그가 없습니다." />
  ) : undefined

  return (
    <div className="space-y-6">
      {actionError ? <div ref={actionErrorRef}><AdminNotice kind="error">{actionError}</AdminNotice></div> : null}
      <section className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--studio-ink)]">새 태그 추가</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="예: 🧠 개념 정리에 좋아요."
            className="w-80 max-w-full"
          />
          <Input
            value={newSortOrder}
            onChange={(event) => setNewSortOrder(event.target.value)}
            placeholder="정렬 순서 (숫자)"
            className="w-40"
            inputMode="numeric"
          />
          <Button type="button" variant="brand" disabled={savingId !== null} onClick={() => void createTag()}>
            {savingId === 'new' ? '추가 중…' : '태그 추가'}
          </Button>
        </div>
      </section>

      {loadError && tags.length > 0 ? (
        <AdminNotice kind="error" onRetry={() => void loadTags()}>{loadError}</AdminNotice>
      ) : null}
      <AdminDataTable
        caption="후기 태그 목록"
        columns={columns}
        rows={tags}
        getRowKey={(tag) => tag.id}
        minWidth={640}
        state={tableState}
      />

      <AdminSaveBar
        variant="fixed"
        dirtyCount={dirtyTags.length}
        status={saveBarStatus}
        savedAt={savedAt}
        errorMessage={saveAllError}
        applyNote="고친 문구·순서는 줄마다 저장하거나 모두 저장으로 한 번에 저장합니다."
        onSave={() => void saveAllDrafts()}
        saveLabel="모두 저장"
        saveDisabled={savingId !== null}
      />
    </div>
  )
}
