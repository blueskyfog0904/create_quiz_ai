'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  MEMBER_SUSPENSION_REASON_CODE_PATTERN,
  MEMBER_SUSPENSION_TEXT_KEYS,
  MEMBER_SUSPENSION_TEXT_MAX,
  type MemberSuspensionPolicy,
  type MemberSuspensionReasonCategory,
  type MemberSuspensionTextKey,
} from '@/lib/member-suspension'
import { saveMemberSuspensionPolicyAction, type MemberSuspensionPolicyAdminData } from './suspension-policy-actions'

// 사용자 관리 위쪽 접는 카드(계획 6-3, 대표 전용): 회원 화면 문구·사유 분류·최대 정지 일수. 값은 DB(member_suspension_policy)다.
// [미리보기]는 표시만 하고, 저장은 DB 함수가 revision 을 비교한다. 쓰는 중인 분류 코드는 지울 수 없고 숨김만 된다.

// 문구 키의 화면 이름표(관리자 화면 라벨)
const TEXT_LABELS: Record<MemberSuspensionTextKey, string> = {
  bannerRestricted: '회원 화면 한 줄 안내',
  noticeTitle: '안내 화면 제목',
  noticeIntro: '안내 화면 첫 문단',
  noticeBlockedList: '막힌 것(목록)',
  noticeBlockedDownload: '막힌 것: 다운로드(다운로드도 막을 때 덧붙임)',
  noticeAvailableList: '아직 되는 것(목록)',
  noticeDeadlines: '환불 기한 안내',
  noticeObjection: '이의 방법',
  noticeUntilLifted: '끝나는 날 없음 표시',
  noticeNone: '정지가 아닐 때',
  noticeCheckFailed: '확인 실패 안내',
  apiBlocked: '막힌 동작 안내(구매·충전·후기 등)',
  loginBlocked: '로그인 화면 안내(로그인 차단)',
  deadlineChargeRefund: '기한 이름: 충전 환불(안내 화면·대표 이메일)',
  deadlineMaterialRefund: '기한 이름: 자료 환불(안내 화면·대표 이메일)',
  deadlineCreditExpiry: '기한 이름: 유료 크레딧 소멸(안내 화면·대표 이메일)',
  ownerMailDeadlines: '대표 이메일 기한 안내 틀({기한 종류}·{날짜})',
  adminMemoGuide: '관리자 메모 안내(관리자 화면)',
  adminSuspendConfirm: '정지 확인 문구(관리자 화면)',
  adminDeadlineWarning: '기한 경고(관리자 화면)',
  adminUnderageGuide: '만 14세 미만 안내(관리자 화면)',
}

// persisted: 저장돼 있던 행인지(코드 칸 잠금은 이 표시로만 한다 — 새 행에 저장된 코드와 같은 글자를 쳐도 잠기지 않게). 저장할 때는 뺀다.
type DraftCategory = MemberSuspensionReasonCategory & { persisted: boolean }
type PolicyDraft = Pick<MemberSuspensionPolicy, 'maxRestrictedDays' | 'texts' | 'reasonCategories'>
type Draft = Pick<MemberSuspensionPolicy, 'maxRestrictedDays' | 'texts'> & { reasonCategories: DraftCategory[] }

const toDraft = (policy: MemberSuspensionPolicy): Draft => ({
  maxRestrictedDays: policy.maxRestrictedDays,
  texts: { ...policy.texts },
  reasonCategories: policy.reasonCategories.map((category) => ({ ...category, persisted: true })),
})

function validateDraft(draft: PolicyDraft): string | null {
  for (const key of MEMBER_SUSPENSION_TEXT_KEYS) {
    const text = draft.texts[key].trim()
    if (!text) return `'${TEXT_LABELS[key]}'를 비워 둘 수 없습니다.`
    if (text.length > MEMBER_SUSPENSION_TEXT_MAX) return `'${TEXT_LABELS[key]}'는 ${MEMBER_SUSPENSION_TEXT_MAX}자 이내로 적어 주세요.`
  }
  const codes = new Set<string>()
  for (const category of draft.reasonCategories) {
    if (!MEMBER_SUSPENSION_REASON_CODE_PATTERN.test(category.code)) return `분류 코드 '${category.code}'는 영문 소문자로 시작하는 소문자·숫자·밑줄 2~40자여야 합니다.`
    if (codes.has(category.code)) return `분류 코드 '${category.code}'가 두 번 있습니다.`
    codes.add(category.code)
    if (!category.label.trim() || category.label.trim().length > 60) return `분류 '${category.code}'의 이름은 1~60자로 적어 주세요.`
    if (category.clause.trim().length > 100) return `분류 '${category.code}'의 관련 조항은 100자 이내로 적어 주세요.`
  }
  if (draft.reasonCategories.length === 0 || draft.reasonCategories.length > 30) return '사유 분류는 1~30개여야 합니다.'
  if (!draft.reasonCategories.some((category) => !category.hidden)) return '숨기지 않은 분류가 하나 이상 있어야 합니다.'
  if (!Number.isInteger(draft.maxRestrictedDays) || draft.maxRestrictedDays < 1 || draft.maxRestrictedDays > 365) return '최대 정지 일수는 1~365의 정수입니다.'
  return null
}

export function SuspensionPolicyCard({ data: initial }: { data: MemberSuspensionPolicyAdminData }) {
  const [data, setData] = useState(initial)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(initial.ok ? toDraft(initial.policy) : null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!data.ok || !draft) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4"><p role="alert" className="text-sm text-red-700">{data.ok ? '이용 정지 설정을 불러오지 못했습니다.' : data.error}</p></CardContent>
      </Card>
    )
  }

  const inUse = new Set(data.inUseCodes)
  const setText = (key: MemberSuspensionTextKey, value: string) => setDraft({ ...draft, texts: { ...draft.texts, [key]: value } })
  const setCategory = (index: number, change: Partial<MemberSuspensionReasonCategory>) =>
    setDraft({ ...draft, reasonCategories: draft.reasonCategories.map((category, at) => (at === index ? { ...category, ...change } : category)) })
  const move = (index: number, delta: number) => {
    const next = [...draft.reasonCategories]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft({ ...draft, reasonCategories: next })
  }
  const remove = (index: number) => setDraft({ ...draft, reasonCategories: draft.reasonCategories.filter((_, at) => at !== index) })
  const addCategory = () => setDraft({
    ...draft,
    reasonCategories: [...draft.reasonCategories, { code: '', label: '', clause: '', blocksDownloadDefault: false, hidden: false, underageGuide: false, persisted: false }],
  })

  const save = async () => {
    const normalized: PolicyDraft = {
      maxRestrictedDays: draft.maxRestrictedDays,
      texts: Object.fromEntries(MEMBER_SUSPENSION_TEXT_KEYS.map((key) => [key, draft.texts[key].trim()])) as PolicyDraft['texts'],
      reasonCategories: draft.reasonCategories.map((category) => ({
        code: category.code.trim(), label: category.label.trim(), clause: category.clause.trim(),
        blocksDownloadDefault: category.blocksDownloadDefault, hidden: category.hidden, underageGuide: category.underageGuide,
      })),
    }
    const error = validateDraft(normalized)
    if (error) return toast.error(error)
    setSaving(true)
    try {
      const result = await saveMemberSuspensionPolicyAction(data.policy.revision, normalized)
      if (!result.success) {
        toast.error(result.error)
        if (result.data?.ok) {
          setData(result.data)
          setDraft(toDraft(result.data.policy))
        }
        return
      }
      toast.success(result.changed ? '저장했습니다. 회원 화면에 바로 반영됩니다.' : '바뀐 내용이 없습니다.')
      setData(result.data)
      if (result.data.ok) setDraft(toDraft(result.data.policy))
    } catch {
      toast.error('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">이용 정지 안내 문구·사유 분류 <span className="text-sm font-normal text-gray-500">(대표 전용)</span></CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '접기' : '펼치기'}</Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6">
          <p className="text-sm text-gray-500">문구는 초안입니다. 클라이언트와 정한 뒤 여기서 고칩니다. 저장하면 회원 화면·로그인 화면·관리자 정지 창에 바로 쓰입니다.</p>

          <div className="space-y-1">
            <Label htmlFor="suspension-max-days">이용 제한 최대 일수(1~365)</Label>
            <Input
              id="suspension-max-days"
              type="number"
              min={1}
              max={365}
              step={1}
              value={draft.maxRestrictedDays}
              onChange={(event) => setDraft({ ...draft, maxRestrictedDays: Number(event.target.value) })}
              className="w-32"
            />
          </div>

          <div className="space-y-3">
            <p className="font-medium text-gray-800">사유 분류</p>
            <p className="text-xs text-gray-500">&apos;다운로드도 막기 기본&apos;은 정지 창에서 그 분류를 고르면 미리 체크됩니다(바꿀 수 있음). 정지 기록에 쓰인 코드는 지울 수 없고 숨김만 됩니다.</p>
            {draft.reasonCategories.map((category, index) => {
              const locked = category.persisted && inUse.has(category.code)
              return (
                <div key={index} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[10rem_1fr_10rem]">
                  <Input aria-label="분류 코드" placeholder="코드(영문 소문자)" value={category.code} disabled={category.persisted} onChange={(event) => setCategory(index, { code: event.target.value })} />
                  <Input aria-label="분류 이름" placeholder="이름" value={category.label} onChange={(event) => setCategory(index, { label: event.target.value })} />
                  <Input aria-label="관련 조항" placeholder="관련 조항" value={category.clause} onChange={(event) => setCategory(index, { clause: event.target.value })} />
                  <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-3">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={category.blocksDownloadDefault} onChange={(event) => setCategory(index, { blocksDownloadDefault: event.target.checked })} />
                      다운로드도 막기 기본
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={category.hidden} onChange={(event) => setCategory(index, { hidden: event.target.checked })} />
                      숨김
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={category.underageGuide} onChange={(event) => setCategory(index, { underageGuide: event.target.checked })} />
                      만 14세 미만 안내 보이기
                    </label>
                    <span className="ml-auto flex gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => move(index, -1)} disabled={index === 0} aria-label="위로">↑</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => move(index, 1)} disabled={index === draft.reasonCategories.length - 1} aria-label="아래로">↓</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => remove(index)} disabled={locked} title={locked ? '정지 기록에 쓰인 코드는 숨김만 됩니다' : undefined}>지우기</Button>
                    </span>
                  </div>
                </div>
              )
            })}
            <Button type="button" size="sm" variant="outline" onClick={addCategory}>분류 추가</Button>
          </div>

          <div className="space-y-3">
            <p className="font-medium text-gray-800">문구</p>
            {MEMBER_SUSPENSION_TEXT_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`suspension-text-${key}`}>{TEXT_LABELS[key]} <span className="text-xs font-normal text-gray-400">{key}</span></Label>
                <Textarea id={`suspension-text-${key}`} value={draft.texts[key]} onChange={(event) => setText(key, event.target.value)} className="h-16" maxLength={MEMBER_SUSPENSION_TEXT_MAX} />
              </div>
            ))}
          </div>

          {preview && (
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4 text-sm" aria-label="미리보기">
              <p className="rounded bg-red-50 px-3 py-2 text-red-800">{draft.texts.bannerRestricted} <span className="underline">자세히 보기</span></p>
              <div className="space-y-1 rounded bg-white p-3">
                <p className="text-base font-semibold">{draft.texts.noticeTitle}</p>
                <p>{draft.texts.noticeIntro}</p>
                <p><span className="text-gray-500">막힌 것 </span>{draft.texts.noticeBlockedList}, {draft.texts.noticeBlockedDownload}</p>
                <p><span className="text-gray-500">아직 되는 것 </span>{draft.texts.noticeAvailableList}</p>
                <p>{draft.texts.noticeDeadlines}</p>
                <p>{draft.texts.noticeObjection}</p>
              </div>
              <p className="rounded bg-white p-3"><span className="text-gray-500">로그인 화면 </span>{draft.texts.loginBlocked}</p>
              <p className="rounded bg-white p-3"><span className="text-gray-500">막힌 동작 </span>{draft.texts.apiBlocked}</p>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPreview(!preview)}>{preview ? '미리보기 닫기' : '미리보기'}</Button>
            <Button type="button" variant="outline" onClick={() => setDraft(toDraft(data.policy))} disabled={saving}>되돌리기</Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
