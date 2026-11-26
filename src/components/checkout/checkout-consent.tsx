'use client'

import { useId, useRef, useState } from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon, MinusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  StudioDialogFooter,
  StudioDialogHeader,
  StudioDialogPanel,
  StudioDialogTitle,
} from '@/components/design-system'
import { cn } from '@/lib/utils'
import {
  CHECKOUT_CONSENT_REQUIRED_MARK,
  type CheckoutConsentBundle,
  type CheckoutConsentLinkKey,
} from '@/lib/checkout-consent'

// 11번 6-5: 결제 버튼 바로 위 공통 동의 부품(장바구니 결제 칸·충전 화면·관리자 미리보기).
//   ☐ [필수] {consentTitle}   [세부 항목]
//   요약 줄 전부(늘 보임 — 줄이거나 흐리게 하지 않는다)
// 체크 값은 부르는 쪽(껍데기)이 든다(제어 값). 이 부품 안의 상태는 창 열림·보기 펼침뿐이다.
// 색은 CSS 변수(--consent-ink·--consent-muted·--consent-line·--consent-ring)만 쓴다. 부르는 쪽이 값을 준다.
// 창은 포털이라 dialogClassName 으로 테마 클래스·변수를 다시 붙인다.

export type CheckoutConsentLinks = Partial<Record<CheckoutConsentLinkKey, string | null>>

// link 항목의 주소가 하나라도 없으면 부품 대신 고지 없음으로 그린다(6-5).
export function canRenderCheckoutConsent(consent: CheckoutConsentBundle, links: CheckoutConsentLinks): boolean {
  return consent.consentItems.every((item) => item.view !== 'link' || Boolean(links[item.link]))
}

export function isCheckoutConsentComplete(consent: CheckoutConsentBundle, checkedKeys: readonly string[]): boolean {
  return consent.consentItems.every((item) => checkedKeys.includes(item.key))
}

interface CheckoutConsentProps {
  consent: CheckoutConsentBundle
  links: CheckoutConsentLinks
  checkedKeys: readonly string[]
  onCheckedKeysChange: (keys: string[]) => void
  // 결제 중·재시도 대기 등: 체크는 잠그고 창 열기·보기는 열어 둔다(6-4)
  disabled?: boolean
  dialogClassName?: string
  className?: string
}

const CHECK_ROOT_CLASS = 'grid size-5 shrink-0 place-content-center rounded-[4px] border-[1.5px] border-[var(--consent-ink)] bg-white text-white outline-none data-[state=checked]:bg-[var(--consent-ink)] data-[state=indeterminate]:bg-[var(--consent-ink)] focus-visible:ring-2 focus-visible:ring-[var(--consent-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function ConsentCheck({ id, checked, disabled, onChange, describedBy, label }: {
  id: string
  checked: boolean | 'indeterminate'
  disabled?: boolean
  onChange: (checked: boolean) => void
  describedBy?: string
  label?: string
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-label={label}
      onCheckedChange={(next) => onChange(next === true)}
      className={CHECK_ROOT_CLASS}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center">
        {checked === 'indeterminate'
          ? <MinusIcon aria-hidden="true" className="size-3.5" />
          : <CheckIcon aria-hidden="true" className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export function CheckoutConsent({
  consent,
  links,
  checkedKeys,
  onCheckedKeysChange,
  disabled = false,
  dialogClassName,
  className,
}: CheckoutConsentProps) {
  const baseId = useId()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const detailsButtonRef = useRef<HTMLButtonElement>(null)

  const itemKeys = consent.consentItems.map((item) => item.key)
  const checkedCount = itemKeys.filter((key) => checkedKeys.includes(key)).length
  const allChecked = checkedCount === itemKeys.length
  const topChecked: boolean | 'indeterminate' = allChecked ? true : checkedCount > 0 ? 'indeterminate' : false
  const titleId = `${baseId}-title`
  const summaryId = `${baseId}-summary`
  const topId = `${baseId}-all`

  const toggleItem = (key: string, checked: boolean) => {
    const next = checked ? [...new Set([...checkedKeys, key])] : checkedKeys.filter((candidate) => candidate !== key)
    onCheckedKeysChange(itemKeys.filter((candidate) => next.includes(candidate)))
  }

  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => (current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]))
  }

  return (
    <div role="group" aria-labelledby={titleId} className={cn('min-w-0 text-[var(--consent-ink)]', className)}>
      <div className="flex min-w-0 items-start gap-1">
        <label htmlFor={topId} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2 py-2.5 has-[:disabled]:cursor-not-allowed">
          <ConsentCheck
            id={topId}
            checked={topChecked}
            disabled={disabled}
            describedBy={summaryId}
            onChange={() => onCheckedKeysChange(allChecked ? [] : [...itemKeys])}
          />
          <span id={titleId} className="min-w-0 break-keep text-sm font-bold leading-5">
            {CHECKOUT_CONSENT_REQUIRED_MARK} {consent.consentTitle}
          </span>
        </label>
        <button
          ref={detailsButtonRef}
          type="button"
          onClick={() => setDialogOpen(true)}
          aria-haspopup="dialog"
          aria-label={`세부 항목, ${itemKeys.length}개 중 ${checkedCount}개 동의`}
          className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm font-semibold text-[var(--consent-ink)] underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--consent-ring)]"
        >
          세부 항목
        </button>
      </div>
      <ul id={summaryId} className="space-y-1 break-keep pl-7 text-sm leading-6 text-[var(--consent-ink)]">
        {consent.consentSummary.map((line, index) => (
          <li key={index} className="relative before:absolute before:-left-3 before:content-['·']">{line}</li>
        ))}
      </ul>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <StudioDialogPanel
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            detailsButtonRef.current?.focus()
          }}
          // 창 높이는 내용에 맞추고(최대는 화면 안), 넘치면 목록만 창 안에서 스크롤 — [닫기]는 목록 바로 아래.
          // studio-theme(base 층)의 min-height: 100% 가 창을 화면 높이로 늘리지 않게 min-h-0 을 끝에 둔다.
          className={cn('flex h-auto max-h-[min(640px,calc(100dvh-2rem))] flex-col gap-4 sm:max-w-[480px]', dialogClassName, 'min-h-0')}
        >
          <StudioDialogHeader className="text-left sm:text-left [&]:px-0">
            <StudioDialogTitle className="text-left text-[var(--consent-ink)]">세부 항목 — {consent.consentTitle}</StudioDialogTitle>
          </StudioDialogHeader>
          <ul className="-mx-2 min-h-0 shrink overflow-y-auto px-2 text-sm">
            {consent.consentItems.map((item, index) => {
              const itemId = `${baseId}-item-${index}`
              const panelId = `${baseId}-panel-${index}`
              const expanded = expandedKeys.includes(item.key)
              const href = item.view === 'link' ? links[item.link] ?? null : null
              return (
                <li key={item.key} className="border-b border-[var(--consent-line)] last:border-b-0">
                  <div className="flex min-w-0 items-center gap-1">
                    <label htmlFor={itemId} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed">
                      <ConsentCheck
                        id={itemId}
                        checked={checkedKeys.includes(item.key)}
                        disabled={disabled}
                        onChange={(checked) => toggleItem(item.key, checked)}
                      />
                      <span className="min-w-0 break-keep font-semibold text-[var(--consent-ink)]">{item.label}</span>
                    </label>
                    {item.view === 'text' ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        aria-label={`${item.label} 본문 보기`}
                        onClick={() => toggleExpanded(item.key)}
                        className="inline-flex min-h-11 shrink-0 items-center px-2 text-[var(--consent-muted)] underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--consent-ring)]"
                      >
                        보기
                      </button>
                    ) : href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${item.label} 보기(새 창)`}
                        className="inline-flex min-h-11 shrink-0 items-center px-2 text-[var(--consent-muted)] underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--consent-ring)]"
                      >
                        보기
                      </a>
                    ) : null}
                  </div>
                  {item.view === 'text' ? (
                    <div id={panelId} hidden={!expanded} className="space-y-2 pb-3 pl-7 leading-6 text-[var(--consent-muted)]">
                      {item.texts.map((text, textIndex) => (
                        <p key={textIndex} className="whitespace-pre-line break-keep">{text}</p>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <StudioDialogFooter>
            <Button type="button" variant="brand" onClick={() => setDialogOpen(false)}>
              닫기
            </Button>
          </StudioDialogFooter>
        </StudioDialogPanel>
      </Dialog>
    </div>
  )
}
