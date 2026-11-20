'use client'

import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  formatConsentDate,
  getAlwaysVisibleConsentLines,
  parseConsentEmphasis,
  splitConsentLines,
  type ConsentItem,
} from '@/lib/signup-consent'

// 고지 본문 한 줄: **…** 강조는 굵게·밑줄·크게(다른 글보다 20% 이상) 보인다. 글자로만 그리므로 HTML 은 해석되지 않는다.
export function ConsentTextLine({ line }: { line: string }) {
  return (
    <>
      {parseConsentEmphasis(line).map((segment, index) => (
        segment.emphasis
          ? <strong key={index} className="text-[1.25em] font-bold underline underline-offset-2">{segment.text}</strong>
          : <span key={index}>{segment.text}</span>
      ))}
    </>
  )
}

function ConsentItemRow({
  item,
  checked,
  missing,
  showRevisionNote,
  onCheckedChange,
}: {
  item: ConsentItem
  checked: boolean
  missing: boolean
  showRevisionNote: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleLines = getAlwaysVisibleConsentLines(item)
  const allLines = splitConsentLines(item.content)
  const hasMore = allLines.filter((line) => line.trim()).length > visibleLines.length
  const inputId = `consent-${item.id}`

  return (
    <li className={cn('rounded-xl border px-4 py-3', missing ? 'border-red-400 bg-red-50/60' : 'border-[var(--studio-line,#e5e7eb)]')}>
      <div className="flex items-start gap-3">
        <Checkbox
          id={inputId}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-invalid={missing || undefined}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label htmlFor={inputId} className="cursor-pointer text-sm font-semibold leading-6">
              <span className={item.required ? 'text-[var(--studio-accent,#2563eb)]' : 'text-gray-500'}>
                [{item.required ? '필수' : '선택'}]
              </span>{' '}
              {item.label}
            </label>
            {item.policyHref ? (
              <a href={item.policyHref} target="_blank" rel="noreferrer" className="text-xs text-gray-500 underline underline-offset-2">
                전문 보기
              </a>
            ) : null}
            {hasMore ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-xs text-gray-500 underline underline-offset-2"
                aria-expanded={expanded}
              >
                {expanded ? '접기' : '보기'}
              </button>
            ) : null}
          </div>
          {showRevisionNote && item.note ? (
            <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-800">
              변경 안내{item.revisedAt ? `(${formatConsentDate(item.revisedAt)})` : ''}: {item.note}
            </p>
          ) : null}
          <div className="mt-1 space-y-0.5 whitespace-pre-line break-keep text-xs leading-5 text-gray-600">
            {(expanded ? allLines : visibleLines).map((line, index) => (
              <p key={index}><ConsentTextLine line={line} /></p>
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}

export function ConsentChecklist({
  items,
  checked,
  onChange,
  highlightMissing,
  privacyPolicyHref,
  optionalHint,
  showRevisionNotes = false,
}: {
  items: ConsentItem[]
  checked: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
  highlightMissing: boolean
  privacyPolicyHref: string | null
  optionalHint: string
  showRevisionNotes?: boolean
}) {
  const allChecked = items.length > 0 && items.every((item) => checked[item.id] === true)
  const hasOptional = items.some((item) => !item.required)

  return (
    <div className="grid gap-3">
      <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-gray-50 px-4 py-3 text-sm font-semibold">
        <Checkbox
          checked={allChecked}
          onCheckedChange={(value) => onChange(Object.fromEntries(items.map((item) => [item.id, value === true])))}
        />
        {hasOptional ? '선택 항목을 포함해 모두 동의' : '모두 동의'}
      </label>
      <ul className="grid gap-2">
        {items.map((item) => (
          <ConsentItemRow
            key={item.id}
            item={item}
            checked={checked[item.id] === true}
            missing={highlightMissing && item.required && checked[item.id] !== true}
            showRevisionNote={showRevisionNotes}
            onCheckedChange={(value) => onChange({ ...checked, [item.id]: value })}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        {hasOptional ? <span>{optionalHint}</span> : <span />}
        {privacyPolicyHref ? (
          <a href={privacyPolicyHref} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            개인정보처리방침 보기
          </a>
        ) : null}
      </div>
    </div>
  )
}
