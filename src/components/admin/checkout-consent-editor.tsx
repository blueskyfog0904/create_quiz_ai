'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  charLength,
  CHECKOUT_CONSENT_ITEM_LABEL_MAX,
  CHECKOUT_CONSENT_ITEMS_MAX,
  CHECKOUT_CONSENT_LINK_KEYS,
  CHECKOUT_CONSENT_SPECS,
  CHECKOUT_CONSENT_SUMMARY_LINE_MAX,
  CHECKOUT_CONSENT_TITLE_MAX,
  type CheckoutConsentKind,
  type CheckoutConsentProblem,
  type CheckoutConsentRawItem,
} from '@/lib/checkout-consent'
import {
  CHECKOUT_CONSENT_FINGERPRINT_HINT,
  CHECKOUT_CONSENT_LINK_LABELS,
  CHECKOUT_CONSENT_ROLE_LABELS,
  CHECKOUT_CONSENT_TARGET_LABELS,
  nextCheckoutConsentItemKey,
  type CheckoutConsentKeysInput,
} from '@/lib/checkout-consent-admin'

// 11번 9절: 접는 동의(2판) 문구 편집칸 — 자료·충전 폼이 같이 쓴다. 판(consentFormat)은 입력으로 받지 않는다.
// 한 줄 칸(제목·요약 줄·항목 이름)은 input 이다(줄바꿈 금지, 4-3 (S1)). key 는 코드가 만든다.

function ProblemText({ problems, field }: { problems: CheckoutConsentProblem[]; field: string }) {
  const matched = problems.filter((problem) => problem.field === field)
  if (matched.length === 0) return null
  return <p role="alert" className="text-xs text-red-600">{matched.map((problem) => problem.message).join(' ')}</p>
}

function Counter({ text, length: givenLength, max }: { text?: string; length?: number; max: number }) {
  const length = givenLength ?? charLength(text ?? '')
  return <span className={length > max ? 'text-red-600' : undefined}>{length}/{max}</span>
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list]
  const target = index + delta
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function CheckoutConsentEditor({
  kind,
  value,
  onChange,
  problems,
  disabled = false,
  inFingerprint,
  idPrefix,
}: {
  kind: CheckoutConsentKind
  value: CheckoutConsentKeysInput
  onChange: (next: CheckoutConsentKeysInput) => void
  problems: CheckoutConsentProblem[]
  disabled?: boolean
  // 지문(동의 원문)에 들어가는지 — 들어가면 힌트를 보인다
  inFingerprint: boolean
  idPrefix: string
}) {
  const spec = CHECKOUT_CONSENT_SPECS[kind]
  const targetLabels = CHECKOUT_CONSENT_TARGET_LABELS[kind]
  const placeholders = spec.placeholders.join(' · ')
  const summaryTotal = Object.values(value.consentSummary).reduce((total, line) => total + charLength(line), 0)
  const usedTargets = (exceptIndex: number) => new Set(value.consentItems.flatMap((item, index) => (
    index !== exceptIndex && item.view === 'text' ? item.textKeys : [])))
  const usedLinks = (exceptIndex: number) => new Set(value.consentItems.flatMap((item, index) => (
    index !== exceptIndex && item.view === 'link' ? [item.link] : [])))
  const setItems = (consentItems: CheckoutConsentRawItem[]) => onChange({ ...value, consentItems })
  const setItem = (index: number, item: CheckoutConsentRawItem) => setItems(value.consentItems.map((current, i) => (i === index ? item : current)))
  const hint = inFingerprint ? <p className="text-xs text-amber-700">{CHECKOUT_CONSENT_FINGERPRINT_HINT}</p> : null
  // 칸에 붙여 보이지 않는 문제(요약 줄 전체, 항목 목록 전체, 항목 모양·키 — 키는 코드가 만들어 DB 를 직접 고쳤을 때만 생김)는 아래 목록에 모은다.
  const otherProblems = problems.filter((problem) => problem.field === 'consentSummary' || problem.field === 'consentItems'
    || /^consentItems\.\d+(\.key)?$/.test(problem.field))

  return (
    <fieldset className="grid gap-4 rounded-md border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">접는 동의(새 방식) 문구</legend>
      <p className="text-xs text-muted-foreground">
        쓸 수 있는 자리표시: <code className="rounded bg-muted px-1">{placeholders}</code>. 기간은 숫자 대신 자리표시로 적어 주세요
        (제목·요약 줄·항목 이름에는 숫자를 쓸 수 없고, 숫자가 필요한 표현은 본문에 둡니다). &lsquo;[필수]&rsquo;는 화면이 붙입니다.
      </p>

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-consentTitle`}>동의 제목(한 줄)</Label>
        <Input
          id={`${idPrefix}-consentTitle`}
          value={value.consentTitle}
          onChange={(event) => onChange({ ...value, consentTitle: event.target.value })}
        />
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>결제 버튼 바로 위 필수 체크 옆에 보입니다.</span>
          <Counter text={value.consentTitle} max={CHECKOUT_CONSENT_TITLE_MAX} />
        </div>
        <ProblemText problems={problems} field="consentTitle" />
        {hint}
      </div>

      <div className="grid gap-3">
        <span className="text-sm font-medium">
          요약 줄(늘 보이는 핵심 줄, 역할 순서 고정)
          {spec.summaryTotalMax !== null ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">합계 <Counter length={summaryTotal} max={spec.summaryTotalMax} /></span>
          ) : null}
        </span>
        {spec.summaryRoles.map((role) => {
          const id = `${idPrefix}-summary-${role.role}`
          const present = Object.hasOwn(value.consentSummary, role.role)
          if (!present && !role.required) {
            return (
              <Button
                key={role.role}
                type="button"
                variant="adminAction"
                size="sm"
                className="w-fit"
                onClick={() => onChange({ ...value, consentSummary: { ...value.consentSummary, [role.role]: '' } })}
              >
                <Plus className="mr-1 size-4" /> {CHECKOUT_CONSENT_ROLE_LABELS[role.role]} 추가
              </Button>
            )
          }
          const line = value.consentSummary[role.role] ?? ''
          return (
            <div key={role.role} className="grid gap-1.5">
              <Label htmlFor={id}>
                {CHECKOUT_CONSENT_ROLE_LABELS[role.role] ?? role.role}
                {role.required ? <span className="ml-1 text-xs font-normal text-muted-foreground">(필수 줄)</span> : null}
                {role.placeholders.length > 0 ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">({role.placeholders.join(' · ')} 필수)</span>
                ) : null}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  value={line}
                  onChange={(event) => onChange({ ...value, consentSummary: { ...value.consentSummary, [role.role]: event.target.value } })}
                />
                {!role.required ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${CHECKOUT_CONSENT_ROLE_LABELS[role.role]} 빼기`}
                    onClick={() => {
                      const next = { ...value.consentSummary }
                      delete next[role.role]
                      onChange({ ...value, consentSummary: next })
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
              <div className="flex justify-end text-xs text-muted-foreground"><Counter text={line} max={CHECKOUT_CONSENT_SUMMARY_LINE_MAX} /></div>
              <ProblemText problems={problems} field={`consentSummary.${role.role}`} />
            </div>
          )
        })}
        {hint}
        <p className="text-xs text-muted-foreground">요약 줄은 본문·취소·환불정책보다 강하거나 다른 조건을 말하지 않게 써 주세요.</p>
      </div>

      <div className="grid gap-3">
        <span className="text-sm font-medium">세부 항목(창 안에서 하위 체크와 &lsquo;보기&rsquo;, 최대 {CHECKOUT_CONSENT_ITEMS_MAX}개)</span>
        {value.consentItems.map((item, index) => {
          const id = `${idPrefix}-item-${index}`
          const taken = usedTargets(index)
          const takenLinks = usedLinks(index)
          return (
            <div key={item.key} className="grid gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`${id}-label`} className="shrink-0">항목 이름</Label>
                <Input
                  id={`${id}-label`}
                  className="min-w-40 flex-1"
                  value={item.label}
                  onChange={(event) => setItem(index, { ...item, label: event.target.value })}
                />
                <span className="text-xs text-muted-foreground"><Counter text={item.label} max={CHECKOUT_CONSENT_ITEM_LABEL_MAX} /></span>
                <Button type="button" variant="ghost" size="icon" aria-label={`${item.label || `${index + 1}번째 항목`} 위로`} disabled={index === 0}
                  onClick={() => setItems(move(value.consentItems, index, -1))}><ArrowUp className="size-4" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`${item.label || `${index + 1}번째 항목`} 아래로`} disabled={index === value.consentItems.length - 1}
                  onClick={() => setItems(move(value.consentItems, index, 1))}><ArrowDown className="size-4" /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`${item.label || `${index + 1}번째 항목`} 삭제`}
                  onClick={() => setItems(value.consentItems.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button>
              </div>
              <ProblemText problems={problems} field={`consentItems.${index}.label`} />
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={`${id}-view`} checked={item.view === 'text'}
                    onChange={() => setItem(index, { key: item.key, label: item.label, view: 'text', textKeys: [] })} />
                  본문 보기(창 안에서 펼침)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={`${id}-view`} checked={item.view === 'link'}
                    onChange={() => setItem(index, { key: item.key, label: item.label, view: 'link', link: CHECKOUT_CONSENT_LINK_KEYS.find((link) => !takenLinks.has(link)) ?? 'refundPolicy' })} />
                  문서 링크(새 창)
                </label>
              </div>
              {item.view === 'text' ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">보여 줄 본문(여러 개면 체크한 뒤 위/아래로 순서를 정함)</span>
                  {item.textKeys.map((target, targetIndex) => (
                    <div key={target} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked
                        aria-label={`${targetLabels[target] ?? target} 빼기`}
                        onChange={() => setItem(index, { ...item, textKeys: item.textKeys.filter((candidate) => candidate !== target) })}
                      />
                      <span className="flex-1">{targetIndex + 1}. {targetLabels[target] ?? target}</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${targetLabels[target] ?? target} 위로`} disabled={targetIndex === 0}
                        onClick={() => setItem(index, { ...item, textKeys: move(item.textKeys, targetIndex, -1) })}><ArrowUp className="size-4" /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${targetLabels[target] ?? target} 아래로`} disabled={targetIndex === item.textKeys.length - 1}
                        onClick={() => setItem(index, { ...item, textKeys: move(item.textKeys, targetIndex, 1) })}><ArrowDown className="size-4" /></Button>
                    </div>
                  ))}
                  {spec.textTargets.filter((target) => !item.textKeys.includes(target)).map((target) => (
                    <label key={target} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={taken.has(target)}
                        onChange={() => setItem(index, { ...item, textKeys: [...item.textKeys, target] })}
                      />
                      {targetLabels[target] ?? target}
                      {taken.has(target) ? <span className="text-xs">(다른 항목이 씀)</span> : null}
                      {spec.requiredTargets.includes(target) ? <span className="text-xs">(꼭 넣어야 함)</span> : null}
                    </label>
                  ))}
                  <ProblemText problems={problems} field={`consentItems.${index}.textKeys`} />
                </div>
              ) : (
                <div className="grid gap-1">
                  {CHECKOUT_CONSENT_LINK_KEYS.map((link) => (
                    <label key={link} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${id}-link`}
                        checked={item.link === link}
                        disabled={takenLinks.has(link)}
                        onChange={() => setItem(index, { ...item, link })}
                      />
                      {CHECKOUT_CONSENT_LINK_LABELS[link]}
                      {takenLinks.has(link) ? <span className="text-xs text-muted-foreground">(다른 항목이 씀)</span> : null}
                    </label>
                  ))}
                  <ProblemText problems={problems} field={`consentItems.${index}.link`} />
                </div>
              )}
            </div>
          )
        })}
        {value.consentItems.length < CHECKOUT_CONSENT_ITEMS_MAX ? (
          <Button
            type="button"
            variant="adminAction"
            size="sm"
            className="w-fit"
            onClick={() => setItems([...value.consentItems, {
              key: nextCheckoutConsentItemKey(value.consentItems.map((item) => item.key)),
              label: '',
              view: 'text',
              textKeys: [],
            }])}
          >
            <Plus className="mr-1 size-4" /> 항목 추가
          </Button>
        ) : null}
        {hint}
      </div>

      {otherProblems.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 text-xs text-red-600">
          {otherProblems.map((problem, index) => <li key={index}>{problem.message}</li>)}
        </ul>
      ) : null}
      <ProblemTextList problems={problems.filter((problem) => problem.field.startsWith('body:'))} targetLabels={targetLabels} />
    </fieldset>
  )
}

function ProblemTextList({ problems, targetLabels }: { problems: CheckoutConsentProblem[]; targetLabels: Record<string, string> }) {
  if (problems.length === 0) return null
  return (
    <ul role="alert" className="list-disc pl-5 text-xs text-red-600">
      {problems.map((problem, index) => (
        <li key={index}>{targetLabels[problem.field.slice('body:'.length)] ?? problem.field}: {problem.message}</li>
      ))}
    </ul>
  )
}
