'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_USAGE_BASIS_EVIDENCE_MAX, MARKET_USAGE_BASIS_NOTE_MAX } from '@/lib/market-item-options'
import type { MarketItemUsageBasisAdminData } from '@/lib/market-item-usage-basis-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 17번 7-2: 상품별 원저작물 이용 근거(내부). 상품 저장과 따로 [이용 근거 저장]으로 저장한다(DB 함수, 작업 기록).
// 새 상품은 첫 저장 뒤(id 가 생긴 뒤)에 열린다. 회원에게는 어떤 화면·응답에도 보이지 않는다.
// 18번이 상품 화면 코드를 나누므로 이 카드는 지금 파일 옆에 최소로 둔다.

interface UsageBasisDraft {
  basisOptionId: string
  note: string
  evidenceRef: string
}

const emptyDraft: UsageBasisDraft = { basisOptionId: '', note: '', evidenceRef: '' }

export function MarketItemUsageBasisCard({ itemId, workspaceSubject }: { itemId: string; workspaceSubject: WorkspaceSubject }) {
  const [data, setData] = useState<MarketItemUsageBasisAdminData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<UsageBasisDraft>(emptyDraft)
  const [pending, setPending] = useState(false)
  const url = withAdminWorkspaceSubject(`/api/admin/market/items/${itemId}/usage-basis`, workspaceSubject)

  // 서버 값(DB 함수가 다듬은 메모·증빙 위치, 판)으로 화면을 채운다. 처음 열 때와 저장 뒤에 부른다.
  async function load(isCancelled: () => boolean = () => false) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const payload = await response.json() as { success?: boolean; data?: MarketItemUsageBasisAdminData; error?: { message?: string } }
      if (isCancelled()) return
      if (!payload.success || !payload.data) {
        setLoadError(payload.error?.message ?? '이용 근거를 불러오지 못했습니다.')
        return
      }
      setData(payload.data)
      setLoadError(null)
      setDraft(payload.data.basis
        ? { basisOptionId: payload.data.basis.basisOptionId, note: payload.data.basis.note ?? '', evidenceRef: payload.data.basis.evidenceRef ?? '' }
        : emptyDraft)
    } catch {
      if (!isCancelled()) setLoadError('이용 근거를 불러오지 못했습니다.')
    }
  }

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 주소(상품·과목)가 바뀔 때만 다시 읽는다
  }, [url])

  async function save() {
    if (!data || !draft.basisOptionId) {
      toast.error('이용 근거를 골라 주세요.')
      return
    }
    setPending(true)
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: data.basis?.revision ?? null, ...draft }),
      })
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { changed?: boolean; revision?: number }; error?: { message?: string } } | null
      if (!response.ok || !payload?.success) {
        toast.error(payload?.error?.message ?? '이용 근거를 저장하지 못했습니다.')
        return
      }
      // 저장된 값(DB 함수가 다듬은 값·판)으로 다시 그린다
      await load()
      toast.success(payload.data?.changed === false ? '바뀐 것이 없습니다.' : '이용 근거를 저장했습니다.')
    } catch {
      toast.error('이용 근거를 저장하지 못했습니다. 네트워크를 확인해 주세요.')
    } finally {
      setPending(false)
    }
  }

  const options = data?.options ?? []
  const current = data?.basis?.basisOptionId ?? null
  // 숨긴 항목은 지금 근거일 때만 '(숨김)'으로 함께 보인다(새로 고를 수 없음)
  const selectable = options.filter((option) => option.isActive || option.id === current)

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-gray-900">원저작물 이용 근거(내부)</p>
        <Badge variant="secondary">회원에게 보이지 않음</Badge>
      </div>
      <p className="text-sm text-gray-500">이 상품이 원저작물을 어떤 근거로 쓰는지 남깁니다. 상품 저장과 따로 저장합니다. 개인정보(이름·연락처 등)는 넣지 마세요.</p>
      {loadError ? <p className="text-sm text-red-700">{loadError}</p> : null}
      {data ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="usage-basis-option">근거</Label>
            <select
              id="usage-basis-option"
              value={draft.basisOptionId}
              disabled={pending || data.preview}
              onChange={(event) => setDraft({ ...draft, basisOptionId: event.target.value })}
              className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
            >
              <option value="">선택 안 함</option>
              {selectable.map((option) => (
                <option key={option.id} value={option.id}>{option.isActive ? option.label : `(숨김) ${option.label}`}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="usage-basis-note">메모</Label>
            <Textarea
              id="usage-basis-note"
              value={draft.note}
              maxLength={MARKET_USAGE_BASIS_NOTE_MAX}
              disabled={pending || data.preview}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              className="min-h-[80px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="usage-basis-evidence">증빙 위치</Label>
            <Input
              id="usage-basis-evidence"
              value={draft.evidenceRef}
              maxLength={MARKET_USAGE_BASIS_EVIDENCE_MAX}
              disabled={pending || data.preview}
              onChange={(event) => setDraft({ ...draft, evidenceRef: event.target.value })}
              placeholder="계약서·허락 메일 보관 위치"
            />
          </div>
          <Button type="button" variant="outline" disabled={pending || data.preview || !draft.basisOptionId} onClick={() => void save()}>
            이용 근거 저장
          </Button>
        </>
      ) : null}
    </div>
  )
}
