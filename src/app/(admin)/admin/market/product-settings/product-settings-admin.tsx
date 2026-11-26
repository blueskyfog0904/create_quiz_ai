'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  MARKET_ITEM_EMPTY_HINT_MAX,
  MARKET_ITEM_EMPTY_HINT_PLACEHOLDER,
  MARKET_ITEM_FACET_KEYS,
  MARKET_ITEM_FACET_LABEL_MAX,
  MARKET_ITEM_OPTION_KIND_LABELS,
  MARKET_ITEM_OPTION_KINDS,
  MARKET_ITEM_OPTION_LABEL_MAX,
  fillLibraryEmptyFilterHint,
  findMarketItemDisplayProblem,
  isValidMarketItemOptionLabel,
  marketItemOptionErrorMessage,
  normalizeMarketItemOptionLabel,
  type MarketItemDisplay,
  type MarketItemFacetKey,
  type MarketItemOptionKind,
} from '@/lib/market-item-options'
import type { MarketItemOptionWithCount } from '@/lib/market-item-options-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { DetailTextTab, InfoItemsTab, type DisplaySaver } from './detail-display-tabs'
import { TaxonomyTab } from './taxonomy-tab'

// 17번 7-1: 상품 표시 설정. 탭 [학년] [자료유형] [이용 근거(내부)] [검색 필터 이름].
// 19번 6-1: [상세 안내 문구] [자료 정보 항목] [구성·파일 유형]을 더한다. 표시 설정 탭들은 판(revision)을 함께 쓰고, 저장할 때 자기 키만 보낸다.
// 목록 탭: 이름·사용 여부·[위로]/[아래로]·[순서 저장]. 지우기는 없다(숨김만). 이름을 바꾸면 그 값을 쓰는 상품도 함께 바뀐다(DB 함수).

interface ProductSettingsAdminProps {
  workspaceSubject: WorkspaceSubject
  initialLists: Record<MarketItemOptionKind, MarketItemOptionWithCount[]>
  initialDisplay: MarketItemDisplay | null
  preview: boolean
  // 19번: 상품 편집의 '구성·파일 유형 관리(새 탭)' 링크가 ?tab=taxonomy 로 연다
  initialTab: string
}

const SETTINGS_TABS = [...MARKET_ITEM_OPTION_KINDS, 'display', 'detail-text', 'info-items', 'taxonomy'] as const

// 관리자 화면의 필터 key 설명(관리자 조작 문구 — 회원에게 보이는 이름은 DB 값)
const FACET_KEY_HELP: Record<MarketItemFacetKey, string> = {
  category: '카테고리(주소 ?category=)',
  type: '서브상품 구성(주소 ?type=)',
  year: '연도(주소 ?year=)',
  grade: '학년(주소 ?grade=)',
}

type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string }

async function callApi(url: string, method: 'POST' | 'PUT', body: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: Record<string, unknown>; error?: { message?: string } } | null
    if (!response.ok || !payload?.success) return { ok: false, message: payload?.error?.message ?? '저장하지 못했습니다.' }
    return { ok: true, data: payload.data ?? {} }
  } catch {
    return { ok: false, message: '저장하지 못했습니다. 네트워크를 확인해 주세요.' }
  }
}

export function ProductSettingsAdmin({ workspaceSubject, initialLists, initialDisplay, preview, initialTab }: ProductSettingsAdminProps) {
  const subjectLabel = workspaceSubject === 'english' ? '영어' : '국어'
  // 표시 설정(두 과목 공통 1행): 탭들이 같은 판을 쓴다. 한 탭이 저장하면 판과 그 탭의 키만 바꾼다(다른 탭 초안은 그대로).
  const [display, setDisplay] = useState(initialDisplay)
  const saveDisplay: DisplaySaver = async (patch) => {
    if (!display) return { ok: false, message: '상품 표시 설정을 읽지 못했습니다. 화면을 새로고침해 주세요.' }
    const result = await callApi('/api/admin/market/item-display', 'PUT', { expectedRevision: display.revision, ...patch })
    if (!result.ok) return result
    const revision = typeof result.data.revision === 'number' ? result.data.revision : display.revision
    setDisplay((current) => current ? { ...current, ...patch, revision } : current)
    return { ok: true, changed: result.data.changed !== false }
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          <AdminMenuName href="/admin/market/product-settings" fallback="상품 표시 설정" /> · {subjectLabel}
        </h1>
        <p className="mt-1 text-sm text-gray-500">상품 편집에서 고르는 학년·자료유형·구성·파일 유형 목록과 회원 검색·자료 보관함의 필터 이름, 상품 상세 안내 문구를 정합니다.</p>
        {preview ? <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">미리보기입니다. 저장은 하지 않습니다.</p> : null}
      </div>
      <Tabs defaultValue={(SETTINGS_TABS as readonly string[]).includes(initialTab) ? initialTab : 'grade'}>
        <TabsList className="flex h-auto flex-wrap">
          {MARKET_ITEM_OPTION_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind}>{MARKET_ITEM_OPTION_KIND_LABELS[kind]}</TabsTrigger>
          ))}
          <TabsTrigger value="display">검색 필터 이름</TabsTrigger>
          <TabsTrigger value="detail-text">상세 안내 문구</TabsTrigger>
          <TabsTrigger value="info-items">자료 정보 항목</TabsTrigger>
          <TabsTrigger value="taxonomy">구성·파일 유형</TabsTrigger>
        </TabsList>
        {MARKET_ITEM_OPTION_KINDS.map((kind) => (
          <TabsContent key={kind} value={kind} className="mt-4">
            <OptionListTab kind={kind} workspaceSubject={workspaceSubject} initialOptions={initialLists[kind]} subjectLabel={subjectLabel} />
          </TabsContent>
        ))}
        <TabsContent value="display" className="mt-4">
          <DisplayTab display={display} onSave={saveDisplay} />
        </TabsContent>
        <TabsContent value="detail-text" className="mt-4">
          <DetailTextTab display={display} onSave={saveDisplay} />
        </TabsContent>
        <TabsContent value="info-items" className="mt-4">
          <InfoItemsTab display={display} onSave={saveDisplay} />
        </TabsContent>
        <TabsContent value="taxonomy" className="mt-4">
          <TaxonomyTab workspaceSubject={workspaceSubject} preview={preview} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface PendingRename {
  option: MarketItemOptionWithCount
  label: string
  isActive: boolean
  itemCount: number
}

function OptionListTab({ kind, workspaceSubject, initialOptions, subjectLabel }: {
  kind: MarketItemOptionKind
  workspaceSubject: WorkspaceSubject
  initialOptions: MarketItemOptionWithCount[]
  subjectLabel: string
}) {
  const [options, setOptions] = useState(initialOptions)
  const [drafts, setDrafts] = useState<Record<string, { label: string; isActive: boolean }>>({})
  const [order, setOrder] = useState(() => initialOptions.map((option) => option.id))
  const [newLabel, setNewLabel] = useState('')
  const [pending, setPending] = useState(false)
  const [rename, setRename] = useState<PendingRename | null>(null)
  const apiUrl = withAdminWorkspaceSubject('/api/admin/market/item-options', workspaceSubject)
  const kindLabel = MARKET_ITEM_OPTION_KIND_LABELS[kind]
  const byId = new Map(options.map((option) => [option.id, option]))
  const orderChanged = order.join(',') !== options.map((option) => option.id).join(',')

  // 서버 목록(서버가 센 상품 수·판 포함, 캐시 없음). 화면 상태는 건드리지 않는다.
  async function fetchOptions() {
    const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/item-options?kind=${kind}`, workspaceSubject), { cache: 'no-store' }).catch(() => null)
    const payload = await response?.json().catch(() => null) as { success?: boolean; data?: MarketItemOptionWithCount[] } | null
    if (!payload?.success || !Array.isArray(payload.data)) {
      toast.error('목록을 다시 읽지 못했습니다. 화면을 새로고침해 주세요.')
      return null
    }
    return payload.data
  }

  // 저장 뒤에는 서버 값으로 목록·순서를 다시 그린다(고치던 다른 줄은 저장 뒤 서버 값으로 돌아감)
  async function reload() {
    const data = await fetchOptions()
    if (!data) return null
    setOptions(data)
    setOrder(data.map((option) => option.id))
    setDrafts({})
    return data
  }

  async function save(option: MarketItemOptionWithCount | null, label: string, isActive: boolean) {
    setPending(true)
    const result = await callApi(apiUrl, 'POST', {
      id: option?.id ?? null,
      expectedRevision: option?.revision ?? null,
      kind,
      label,
      isActive,
    })
    if (!result.ok) {
      setPending(false)
      toast.error(result.message)
      return
    }
    const renamed = typeof result.data.renamedItemCount === 'number' ? result.data.renamedItemCount : 0
    toast.success(renamed > 0 ? `저장했습니다. 상품 ${renamed}개의 값도 함께 바꿨습니다.` : '저장했습니다.')
    if (!option) setNewLabel('')
    await reload()
    setPending(false)
  }

  async function requestSave(option: MarketItemOptionWithCount) {
    const draft = drafts[option.id] ?? { label: option.label, isActive: option.isActive }
    const label = normalizeMarketItemOptionLabel(draft.label)
    if (!isValidMarketItemOptionLabel(label)) {
      toast.error(`이름은 1~${MARKET_ITEM_OPTION_LABEL_MAX}자 한 줄로 입력해 주세요.`)
      return
    }
    // 상품 칸에 쓰는 이름을 바꾸면 확인 창에 서버가 센 상품 수를 보인다(저장 직전에 다시 읽음).
    // 다른 줄의 고치던 값·저장하지 않은 순서는 그대로 둔다(수만 꺼내 씀). 판은 화면 값으로 보내 충돌이면 거절된다.
    if (label !== option.label && kind !== 'usage_basis') {
      const fresh = (await fetchOptions())?.find((candidate) => candidate.id === option.id)
      if (!fresh) return
      setRename({ option, label, isActive: draft.isActive, itemCount: fresh.itemCount })
      return
    }
    await save(option, label, draft.isActive)
  }

  async function addOption() {
    const label = normalizeMarketItemOptionLabel(newLabel)
    if (!isValidMarketItemOptionLabel(label)) {
      toast.error(`이름은 1~${MARKET_ITEM_OPTION_LABEL_MAX}자 한 줄로 입력해 주세요.`)
      return
    }
    await save(null, label, true)
  }

  function move(id: string, delta: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function saveOrder() {
    setPending(true)
    const result = await callApi(apiUrl, 'PUT', { kind, ids: order })
    if (!result.ok) toast.error(result.message)
    else toast.success('순서를 저장했습니다.')
    await reload()
    setPending(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{kindLabel} 목록 · {subjectLabel}</CardTitle>
        <CardDescription>
          {kind === 'usage_basis'
            ? '회원에게 보이지 않는 내부 기록입니다. 상품 편집의 \'원저작물 이용 근거(내부)\' 카드에서 고릅니다.'
            : `상품 편집의 ${kindLabel} 선택칸에 이 순서로 나옵니다. 숨긴 항목은 새로 고를 수 없고, 이미 그 값인 상품은 그대로 보입니다.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {order.map((id, index) => {
            const option = byId.get(id)
            if (!option) return null
            const draft = drafts[id] ?? { label: option.label, isActive: option.isActive }
            const dirty = draft.label !== option.label || draft.isActive !== option.isActive
            return (
              <li key={id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="outline" size="icon" aria-label="위로" disabled={pending || index === 0} onClick={() => move(id, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" aria-label="아래로" disabled={pending || index === order.length - 1} onClick={() => move(id, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  aria-label={`${kindLabel} 이름`}
                  value={draft.label}
                  maxLength={MARKET_ITEM_OPTION_LABEL_MAX}
                  disabled={pending}
                  onChange={(event) => setDrafts((current) => ({ ...current, [id]: { ...draft, label: event.target.value } }))}
                  className="min-w-0 flex-1"
                />
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <Switch
                      checked={draft.isActive}
                      disabled={pending}
                      onCheckedChange={(checked) => setDrafts((current) => ({ ...current, [id]: { ...draft, isActive: checked } }))}
                    />
                    사용
                  </label>
                  {!option.isActive ? <Badge variant="secondary">숨김</Badge> : null}
                  {kind !== 'usage_basis' ? <span className="text-xs text-gray-500">상품 {option.itemCount}개</span> : null}
                  <Button type="button" size="sm" disabled={pending || !dirty} onClick={() => void requestSave(option)}>저장</Button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" disabled={pending || !orderChanged} onClick={() => void saveOrder()}>순서 저장</Button>
          {orderChanged ? <span className="text-sm text-amber-700">순서를 바꿨습니다. [순서 저장]을 눌러야 반영됩니다.</span> : null}
        </div>
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor={`new-option-${kind}`}>새 항목</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`new-option-${kind}`}
              value={newLabel}
              maxLength={MARKET_ITEM_OPTION_LABEL_MAX}
              disabled={pending}
              onChange={(event) => setNewLabel(event.target.value)}
              className="min-w-0 flex-1"
            />
            <Button type="button" disabled={pending || !newLabel.trim()} onClick={() => void addOption()}>
              <Plus className="h-4 w-4" /> 추가
            </Button>
          </div>
          <p className="text-xs text-gray-500">맨 뒤에 붙습니다. 숨긴 항목과 같은 이름은 쓸 수 없습니다(숨김을 풀어 주세요).</p>
        </div>
      </CardContent>
      <AlertDialog open={rename !== null} onOpenChange={(open) => { if (!open) setRename(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이름을 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{rename?.option.label}&apos; → &apos;{rename?.label}&apos;. 이 이름을 쓰는 상품 {rename?.itemCount ?? 0}개도 함께 바뀝니다.
              {kind === 'grade' ? ` 옛 이름으로 저장된 검색 링크(?grade=${rename?.option.label ?? ''})는 결과가 비게 됩니다.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            <Button
              type="button"
              disabled={pending || rename === null}
              onClick={() => {
                const target = rename
                setRename(null)
                if (target) void save(target.option, target.label, target.isActive)
              }}
            >
              바꾸기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function DisplayTab({ display, onSave }: { display: MarketItemDisplay | null; onSave: DisplaySaver }) {
  const [draft, setDraft] = useState(() => display
    ? { facetLabels: { ...display.facetLabels }, libraryEmptyFilterHint: display.libraryEmptyFilterHint }
    : null)
  const [pending, setPending] = useState(false)

  if (!display || !draft) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-700">상품 표시 설정(market_item_display)을 읽지 못했습니다. 17·19번 DB 적용 여부를 확인해 주세요.</CardContent>
      </Card>
    )
  }

  async function saveDisplay() {
    if (!draft) return
    const problem = findMarketItemDisplayProblem(draft)
    if (problem) {
      toast.error(marketItemOptionErrorMessage({ code: 'MARKET_ITEM_DISPLAY_INPUT_INVALID', detail: problem }))
      return
    }
    setPending(true)
    // 19번 4-3: 이 탭은 17번 키(facetLabels·libraryEmptyFilterHint)만 보낸다(detail 은 DB 가 그대로 둔다)
    const result = await onSave({
      facetLabels: Object.fromEntries(MARKET_ITEM_FACET_KEYS.map((key) => [key, draft.facetLabels[key].trim()])) as Record<MarketItemFacetKey, string>,
      libraryEmptyFilterHint: draft.libraryEmptyFilterHint.trim(),
    })
    setPending(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(result.changed === false ? '바뀐 것이 없습니다.' : '저장했습니다. 회원 화면에는 1분 안에 반영됩니다.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>검색 필터 이름</CardTitle>
        <CardDescription>국어·영어 공통 설정입니다. 어느 과목 메뉴에서 열어도 같은 값을 읽고 씁니다. 필터 동작과 주소 키는 바뀌지 않습니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {MARKET_ITEM_FACET_KEYS.map((key) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`facet-${key}`}>{FACET_KEY_HELP[key]}</Label>
              <Input
                id={`facet-${key}`}
                value={draft.facetLabels[key]}
                maxLength={MARKET_ITEM_FACET_LABEL_MAX}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, facetLabels: { ...draft.facetLabels, [key]: event.target.value } })}
              />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="library-empty-hint">자료 보관함 빈 화면 안내</Label>
          <Input
            id="library-empty-hint"
            value={draft.libraryEmptyFilterHint}
            maxLength={MARKET_ITEM_EMPTY_HINT_MAX}
            disabled={pending}
            onChange={(event) => setDraft({ ...draft, libraryEmptyFilterHint: event.target.value })}
          />
          <p className="text-xs text-gray-500">
            {MARKET_ITEM_EMPTY_HINT_PLACEHOLDER} 자리에 구성 필터 이름이 들어갑니다. 보이는 글: {fillLibraryEmptyFilterHint(draft)}
          </p>
        </div>
        <Button type="button" disabled={pending} onClick={() => void saveDisplay()}>저장</Button>
      </CardContent>
    </Card>
  )
}
