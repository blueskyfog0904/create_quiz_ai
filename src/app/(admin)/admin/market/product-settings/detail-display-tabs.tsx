'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { MarketSampleRow } from '@/components/market/market-sample-row'
import {
  MARKET_ITEM_DETAIL_COUNT_KEYS,
  MARKET_ITEM_DETAIL_FIELD_LABELS,
  MARKET_ITEM_DETAIL_LONG_KEYS,
  MARKET_ITEM_DETAIL_LONG_MAX,
  MARKET_ITEM_DETAIL_SHORT_MAX,
  MARKET_ITEM_SAMPLE_COUNT_PLACEHOLDER,
  MARKET_ITEM_SUMMARY_LABEL_KEYS,
  fillSampleCount,
  findMarketItemDetailDisplayProblem,
  marketItemOptionErrorMessage,
  resolveBundleTitle,
  type MarketItemDetailDisplay,
  type MarketItemDetailTextKey,
  type MarketItemDisplay,
  type MarketItemInfoKey,
} from '@/lib/market-item-options'

// 19번 6-1: '상품 표시 설정'의 [상세 안내 문구]·[자료 정보 항목] 탭. 두 탭 모두 설정 행의 detail 키만 보낸다(4-3 합치기 규칙).
// 국어·영어 공통 1행이다(17번 7-1). 저장은 17번 방식(판 충돌이면 새로고침 안내).

export type DisplaySaver = (patch: Partial<Omit<MarketItemDisplay, 'revision'>>) => Promise<{ ok: true; changed: boolean } | { ok: false; message: string }>

const COMMON_NOTICE = '국어·영어 공통 설정입니다. 어느 과목 메뉴에서 열어도 같은 값을 읽고 씁니다.'

// 칸 묶음(관리자 조작 문구). 글 자체는 DB 값이다.
const DETAIL_TEXT_GROUPS: { title: string; keys: MarketItemDetailTextKey[] }[] = [
  {
    title: '샘플',
    keys: ['sampleTitle', 'sampleTitleEmpty', 'sampleDescription', 'sampleDescriptionLegacy', 'sampleDescriptionEmpty', 'sampleRowButton',
      'sampleButton', 'sampleButtonEmpty'],
  },
  { title: 'HWP+PDF 기본 안내', keys: ['hwpPdfNoticeLabel', 'hwpPdfNoticeText'] },
  { title: '전체구매', keys: ['bundleDefaultTitle'] },
]

// 자료 정보 항목 key 설명(관리자 조작 문구 — 회원에게 보이는 이름은 DB infoItems.label)
const INFO_KEY_HELP: Record<MarketItemInfoKey, string> = {
  subject: '상품 과목(국어·영어)',
  grade: '상품의 학년 칸(위 배지 포함)',
  sources: '상품의 출처 1~4(· 로 이음)',
  materialType: '상품의 자료유형 칸(위 배지 포함)',
  questionCount: '상품의 문항 수 칸',
  registeredAt: '상품 등록일(위 등록일 줄 포함)',
}

const isLongKey = (key: MarketItemDetailTextKey) => (MARKET_ITEM_DETAIL_LONG_KEYS as readonly string[]).includes(key)
const isCountKey = (key: MarketItemDetailTextKey) => (MARKET_ITEM_DETAIL_COUNT_KEYS as readonly string[]).includes(key)

function trimDetail(detail: MarketItemDetailDisplay): MarketItemDetailDisplay {
  const texts = Object.fromEntries(
    (Object.keys(detail) as (keyof MarketItemDetailDisplay)[])
      .filter((key) => typeof detail[key] === 'string')
      .map((key) => [key, (detail[key] as string).trim()])
  ) as Record<MarketItemDetailTextKey, string>
  return {
    ...texts,
    summaryLabels: Object.fromEntries(MARKET_ITEM_SUMMARY_LABEL_KEYS.map((key) => [key, detail.summaryLabels[key].trim()])) as MarketItemDetailDisplay['summaryLabels'],
    infoItems: detail.infoItems.map((info) => ({ key: info.key, label: info.label.trim(), visible: info.visible })),
  }
}

function DisplayMissing() {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-red-700">상품 표시 설정의 상세 안내 문구(detail)를 읽지 못했습니다. 19번 DB 적용 여부를 확인해 주세요.</CardContent>
    </Card>
  )
}

async function saveDetail(onSave: DisplaySaver, detail: MarketItemDetailDisplay, setPending: (pending: boolean) => void) {
  const trimmed = trimDetail(detail)
  const problem = findMarketItemDetailDisplayProblem(trimmed)
  if (problem) {
    toast.error(marketItemOptionErrorMessage({ code: 'MARKET_ITEM_DISPLAY_INPUT_INVALID', detail: problem }))
    return
  }
  setPending(true)
  const result = await onSave({ detail: trimmed })
  setPending(false)
  if (!result.ok) {
    toast.error(result.message)
    return
  }
  toast.success(result.changed === false ? '바뀐 것이 없습니다.' : '저장했습니다. 회원 화면에는 1분 안에 반영됩니다.')
}

type SampleCase = 'none' | 'three' | 'legacy'
const SAMPLE_CASES: { value: SampleCase; label: string }[] = [
  { value: 'none', label: '샘플 0장' },
  { value: 'three', label: '샘플 3장' },
  { value: 'legacy', label: '옛 샘플 PDF' },
]

export function DetailTextTab({ display, onSave }: { display: MarketItemDisplay | null; onSave: DisplaySaver }) {
  const [draft, setDraft] = useState<MarketItemDetailDisplay | null>(() => display ? structuredClone(display.detail) : null)
  const [pending, setPending] = useState(false)
  const [sampleCase, setSampleCase] = useState<SampleCase>('three')

  if (!display || !draft) return <DisplayMissing />

  const sampleCount = sampleCase === 'three' ? 3 : 0
  const textInput = (key: MarketItemDetailTextKey) => {
    const max = isLongKey(key) ? MARKET_ITEM_DETAIL_LONG_MAX : MARKET_ITEM_DETAIL_SHORT_MAX
    const value = draft[key]
    return (
      <div key={key} className="space-y-1">
        <Label htmlFor={`detail-${key}`}>{MARKET_ITEM_DETAIL_FIELD_LABELS[`detail.${key}`] ?? key}</Label>
        <Input
          id={`detail-${key}`}
          value={value}
          maxLength={max}
          disabled={pending}
          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        />
        <p className="text-xs text-gray-500">
          {value.trim().length}/{max}자 · 한 줄
          {isCountKey(key) ? ` · ${MARKET_ITEM_SAMPLE_COUNT_PLACEHOLDER} 는 샘플 장수로 바뀝니다` : ''}
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>상세 안내 문구</CardTitle>
        <CardDescription>{COMMON_NOTICE} 상품 상세의 샘플 줄·HWP+PDF 기본 안내·전체구매 기본 제목·요약 이름입니다.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="space-y-6">
          {DETAIL_TEXT_GROUPS.map((group) => (
            <fieldset key={group.title} className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold text-gray-900">{group.title}</legend>
              {group.keys.map(textInput)}
            </fieldset>
          ))}
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold text-gray-900">요약</legend>
            {MARKET_ITEM_SUMMARY_LABEL_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`detail-summary-${key}`}>{MARKET_ITEM_DETAIL_FIELD_LABELS[`detail.summaryLabels.${key}`] ?? key}</Label>
                <Input
                  id={`detail-summary-${key}`}
                  value={draft.summaryLabels[key]}
                  maxLength={MARKET_ITEM_DETAIL_SHORT_MAX}
                  disabled={pending}
                  onChange={(event) => setDraft({ ...draft, summaryLabels: { ...draft.summaryLabels, [key]: event.target.value } })}
                />
                <p className="text-xs text-gray-500">{draft.summaryLabels[key].trim().length}/{MARKET_ITEM_DETAIL_SHORT_MAX}자 · 한 줄</p>
              </div>
            ))}
          </fieldset>
          {/* 이 탭은 문구만 바꾼다. 자료 정보 항목은 저장된 값 그대로 보낸다(다른 탭의 저장 안 된 초안은 섞지 않음). */}
          <Button type="button" disabled={pending} onClick={() => void saveDetail(onSave, { ...draft, infoItems: display.detail.infoItems }, setPending)}>저장</Button>
        </div>

        {/* 미리보기: 회원 부품을 메모리 값으로 그린다(저장·요청 없음) */}
        <aside aria-label="미리보기" className="space-y-4 self-start rounded-md border bg-white p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="샘플 경우">
            {SAMPLE_CASES.map((option) => (
              <Button key={option.value} type="button" size="sm" variant={sampleCase === option.value ? 'default' : 'outline'}
                aria-pressed={sampleCase === option.value} onClick={() => setSampleCase(option.value)}>
                {option.label}
              </Button>
            ))}
          </div>
          <MarketSampleRow
            titleId="detail-preview-sample-title"
            display={draft}
            samplePageCount={sampleCount}
            hasLegacySample={sampleCase === 'legacy'}
          />
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-2 text-sm">
            <dt className="text-gray-500">표지 아래 버튼</dt>
            <dd className="font-medium">{fillSampleCount(sampleCount > 0 ? draft.sampleButton : draft.sampleButtonEmpty, sampleCount)}</dd>
            <dt className="text-gray-500">{draft.summaryLabels.questionCount}</dt>
            <dd className="font-medium">{draft.summaryLabels.unknown}</dd>
            <dt className="text-gray-500">{draft.summaryLabels.samplePages}</dt>
            <dd className="font-medium">{sampleCount > 0 ? `${sampleCount}장` : draft.summaryLabels.noSample}</dd>
          </dl>
          <p className="text-sm">
            <span className="font-semibold">{draft.hwpPdfNoticeLabel}</span>
            <span className="block text-xs text-gray-600">{draft.hwpPdfNoticeText}</span>
          </p>
          <p className="rounded-md bg-gray-900 px-3 py-2 text-sm font-bold text-white">{resolveBundleTitle('', draft) ?? ''}</p>
          <p className="text-xs text-gray-500">전체구매 표시명을 비운 상품의 제목입니다.</p>
        </aside>
      </CardContent>
    </Card>
  )
}

export function InfoItemsTab({ display, onSave }: { display: MarketItemDisplay | null; onSave: DisplaySaver }) {
  const [draft, setDraft] = useState<MarketItemDetailDisplay | null>(() => display ? structuredClone(display.detail) : null)
  const [pending, setPending] = useState(false)

  if (!display || !draft) return <DisplayMissing />

  function move(index: number, delta: -1 | 1) {
    if (!draft) return
    const target = index + delta
    if (target < 0 || target >= draft.infoItems.length) return
    const infoItems = [...draft.infoItems]
    ;[infoItems[index], infoItems[target]] = [infoItems[target], infoItems[index]]
    setDraft({ ...draft, infoItems })
  }

  function update(index: number, patch: { label?: string; visible?: boolean }) {
    if (!draft) return
    setDraft({ ...draft, infoItems: draft.infoItems.map((info, current) => current === index ? { ...info, ...patch } : info) })
  }

  async function save() {
    if (!display || !draft) return
    // 이 탭은 자료 정보 항목만 바꾼다. 상세 안내 문구는 저장된 값 그대로 보낸다(다른 탭의 저장 안 된 초안은 섞지 않음).
    await saveDetail(onSave, { ...display.detail, infoItems: draft.infoItems }, setPending)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>자료 정보 항목</CardTitle>
        <CardDescription>
          {COMMON_NOTICE} 상품 상세 &apos;자료 상세 정보&apos; 표의 항목 이름·보이기·순서입니다. 항목을 더하거나 지울 수는 없습니다.
          빈 값인 항목은 상품마다 자동으로 빠집니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {draft.infoItems.map((info, index) => {
            const itemName = info.label.trim() || INFO_KEY_HELP[info.key]
            return (
            <li key={info.key} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="icon" aria-label={`${itemName} 위로`} disabled={pending || index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label={`${itemName} 아래로`} disabled={pending || index === draft.infoItems.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  aria-label={`${INFO_KEY_HELP[info.key]} 이름`}
                  value={info.label}
                  maxLength={MARKET_ITEM_DETAIL_SHORT_MAX}
                  disabled={pending}
                  onChange={(event) => update(index, { label: event.target.value })}
                />
                <p className="text-xs text-gray-500">{INFO_KEY_HELP[info.key]}</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-gray-700">
                <Switch checked={info.visible} disabled={pending} aria-label={`${itemName} 보이기`} onCheckedChange={(checked) => update(index, { visible: checked })} />
                보이기
              </label>
            </li>
            )
          })}
        </ul>
        <p className="text-xs text-amber-800">등록일 항목을 숨기면 상세 위쪽의 등록일 줄도 숨습니다. 학년·자료유형을 숨기면 제목 위 배지도 숨습니다.</p>
        <Button type="button" disabled={pending} onClick={() => void save()}>저장</Button>
      </CardContent>
    </Card>
  )
}
