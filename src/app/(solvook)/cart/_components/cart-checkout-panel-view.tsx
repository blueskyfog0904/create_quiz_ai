'use client'

import { useState, type RefObject } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CartCheckoutPanelBottom } from '@/components/checkout/cart-checkout-panel-bottom'
import { CheckoutConsent, type CheckoutConsentLinks } from '@/components/checkout/checkout-consent'
import { MarketLegacyConsent } from '@/components/checkout/market-legacy-consent'
import { cn } from '@/lib/utils'
import type { CheckoutPanelMode } from '@/lib/checkout-panel-layout'
import { CHECKOUT_PANEL_STICKY_TOP } from '@/lib/checkout-panel-layout'
import type { MarketCartTexts } from '@/lib/checkout-consent'
import type { MarketPurchaseLink } from '@/lib/market-purchase-info'
import {
  formatCartCredits,
  LEGACY_CONSENT_KEY,
  type CartNoticeCopy,
  type CheckoutButtonDecision,
} from '@/lib/cart-checkout-panel'

// 11번 6-1·6-2 표시 부품: 장바구니 오른쪽 결제 칸. 요청·supabase 없음. 동의·부분 보유 확인 값은 껍데기가 든다.
// 위 영역(제목·알림 자리·부분 보유 확인·선택 목록·합계·장바구니 안내·충전 안내)과 아래 묶음(금액 줄·동의·버튼 줄).
// sticky 일 때 위 영역만 안에서 스크롤하고 아래 묶음은 늘 보인다. 이 부품 안의 상태는 목록 펼치기뿐이다.

// 동의 부품 색: studio 값을 --consent-* 변수로 넘긴다(창은 포털이라 dialogClassName 에도 다시 붙인다).
export const CART_CONSENT_THEME_CLASS = '[--consent-ink:var(--studio-ink)] [--consent-muted:var(--studio-text)] [--consent-line:var(--studio-border)] [--consent-ring:var(--studio-focus-ring)]'

export const NO_NOTICE_MESSAGE = '결제 전 확인 내용을 불러오지 못해 지금은 결제할 수 없습니다. 잠시 후 다시 시도해 주세요.'

export interface CartPanelLine {
  id: string
  title: string
  optionTitle: string | null
  credits: number
}


export interface CartCheckoutPanelViewProps {
  mode: CheckoutPanelMode
  panelRef: RefObject<HTMLElement | null>
  topRef: RefObject<HTMLDivElement | null>
  alertsRef: RefObject<HTMLDivElement | null>
  titleRef: RefObject<HTMLHeadingElement | null>
  bottomRef: RefObject<HTMLDivElement | null>
  buttonRowRef: RefObject<HTMLDivElement | null>
  primaryRef: RefObject<HTMLElement | null>
  partialAckRef: RefObject<HTMLButtonElement | null>
  statusText: string
  alertText: string
  // 위 영역이 알리지 않는 동안만 막힌 이유를 읽힌다(한 상태 변화에 하나만)
  srReason: string
  reloadFailed: boolean
  onReload: () => void
  lines: CartPanelLine[]
  total: number
  balance: number
  amountLine: string
  cartTexts: MarketCartTexts | null
  needsPartialAck: boolean
  partialAck: boolean
  onPartialAckChange: (checked: boolean) => void
  noticeCopy: CartNoticeCopy | null
  noticeAvailable: boolean
  links: CheckoutConsentLinks
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
  checkedKeys: readonly string[]
  onCheckedKeysChange: (keys: string[]) => void
  decision: CheckoutButtonDecision
  onPrimary: () => void
  onSecondary: () => void
  chargeHref: string
}

export function CartCheckoutPanelView({
  mode,
  panelRef,
  topRef,
  alertsRef,
  titleRef,
  bottomRef,
  buttonRowRef,
  primaryRef,
  partialAckRef,
  statusText,
  alertText,
  srReason,
  reloadFailed,
  onReload,
  lines,
  total,
  balance,
  amountLine,
  cartTexts,
  needsPartialAck,
  partialAck,
  onPartialAckChange,
  noticeCopy,
  noticeAvailable,
  links,
  termsLink,
  refundPolicyLink,
  checkedKeys,
  onCheckedKeysChange,
  decision,
  onPrimary,
  onSecondary,
  chargeHref,
}: CartCheckoutPanelViewProps) {
  const [listOpen, setListOpen] = useState(false)
  const sticky = mode === 'sticky'
  const consentLocked = decision.locked || decision.consentDisabled

  const consent = !noticeAvailable || !noticeCopy ? (
    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-background)] p-3">
      <p role="alert" className="break-keep text-sm leading-6 text-[var(--studio-ink)]">{NO_NOTICE_MESSAGE}</p>
      <Button type="button" variant="brandOutline" className="mt-2 min-h-11" data-checkout-focus="reload" onClick={onReload}>
        다시 불러오기
      </Button>
    </div>
  ) : noticeCopy.format === 2 ? (
    <div data-checkout-focus="consent">
      <CheckoutConsent
        consent={noticeCopy.consent}
        links={links}
        checkedKeys={checkedKeys}
        onCheckedKeysChange={onCheckedKeysChange}
        disabled={consentLocked}
        dialogClassName={cn('studio-theme', CART_CONSENT_THEME_CLASS)}
      />
    </div>
  ) : (
    <div data-checkout-focus="consent">
      <MarketLegacyConsent
        notice={noticeCopy.notice}
        checked={checkedKeys.includes(LEGACY_CONSENT_KEY)}
        onCheckedChange={(checked) => onCheckedKeysChange(checked ? [LEGACY_CONSENT_KEY] : [])}
        disabled={consentLocked}
        termsLink={termsLink}
        refundPolicyLink={refundPolicyLink}
      />
    </div>
  )

  const primaryClass = 'h-12 min-w-0 flex-1 whitespace-normal break-keep text-base font-bold'
  const buttonRow = (
    <div ref={buttonRowRef} className="flex gap-2">
      {decision.state === 'insufficient' ? (
        <Button asChild variant="brand" className={primaryClass}>
          <Link ref={primaryRef as RefObject<HTMLAnchorElement | null>} href={chargeHref}>{decision.primaryLabel}</Link>
        </Button>
      ) : (
        <Button
          ref={primaryRef as RefObject<HTMLButtonElement | null>}
          type="button"
          variant="brand"
          className={primaryClass}
          disabled={!decision.primaryEnabled}
          onClick={onPrimary}
        >
          {decision.primaryLabel}
        </Button>
      )}
      {decision.secondaryLabel ? (
        <Button type="button" variant="brandOutline" className="h-12 shrink-0 font-bold" onClick={onSecondary}>
          {decision.secondaryLabel}
        </Button>
      ) : null}
    </div>
  )

  return (
    <aside
      ref={panelRef}
      id="cart-checkout-panel"
      aria-labelledby="cart-checkout-panel-title"
      style={sticky ? { top: CHECKOUT_PANEL_STICKY_TOP, maxHeight: `calc(100dvh - ${CHECKOUT_PANEL_STICKY_TOP + 16}px)` } : undefined}
      className={cn(
        'min-w-0 self-start rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]',
        CART_CONSENT_THEME_CLASS,
        sticky && 'lg:sticky lg:flex lg:flex-col'
      )}
    >
      <div ref={topRef} className={cn('min-w-0 px-5 pb-3 pt-5', sticky && 'lg:min-h-0 lg:flex-1 lg:overflow-y-auto')}>
        <h2
          ref={titleRef}
          id="cart-checkout-panel-title"
          tabIndex={-1}
          className="text-base font-bold text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
        >
          결제 금액
        </h2>
        {/* 알림 자리: 처음부터 두 요소를 두고 글만 바꾼다(role 은 바꾸지 않음). */}
        <div ref={alertsRef} tabIndex={-1} className="outline-none">
          <p role="status" aria-live="polite" className="break-keep text-sm leading-6 text-[var(--studio-ink)] [&:not(:empty)]:mt-2">{statusText}</p>
          <p role="alert" className="break-keep text-sm font-semibold leading-6 text-destructive [&:not(:empty)]:mt-2">{alertText}</p>
        </div>
        {reloadFailed ? (
          <Button type="button" variant="brandOutline" className="mt-2 min-h-11" data-checkout-focus="reload" onClick={onReload}>
            다시 불러오기
          </Button>
        ) : null}

        {needsPartialAck && cartTexts ? (
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-[var(--studio-border)] p-3 text-sm leading-5 text-[var(--studio-ink)] has-[:disabled]:cursor-not-allowed">
            <span className="grid size-5 shrink-0 place-items-center">
              <Checkbox
                ref={partialAckRef}
                checked={partialAck}
                disabled={decision.locked}
                onCheckedChange={(checked) => onPartialAckChange(checked === true)}
              />
            </span>
            <span className="min-w-0 break-keep font-semibold">{cartTexts.partialOwnedConfirmLabel}</span>
          </label>
        ) : null}

        <button
          type="button"
          aria-expanded={listOpen}
          aria-controls="cart-checkout-panel-lines"
          onClick={() => setListOpen((open) => !open)}
          className="mt-3 flex min-h-11 w-full items-center justify-between gap-2 text-sm font-semibold text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
        >
          선택한 자료 {lines.length}건
          <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', listOpen && 'rotate-180')} />
        </button>
        <ul id="cart-checkout-panel-lines" hidden={!listOpen} className="space-y-1.5 pb-2 text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-keep text-[var(--studio-text)]">
                {line.title}{line.optionTitle ? ` · ${line.optionTitle}` : ''}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--studio-ink)]">{formatCartCredits(line.credits)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-2 space-y-2 border-t border-[var(--studio-border)] pt-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[var(--studio-muted)]">합계</dt>
            <dd className="font-semibold tabular-nums text-[var(--studio-ink)]">{formatCartCredits(total)} 크레딧</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[var(--studio-muted)]">보유 크레딧</dt>
            <dd className="font-semibold tabular-nums text-[var(--studio-ink)]">{formatCartCredits(balance)} 크레딧</dd>
          </div>
        </dl>
        {cartTexts ? (
          <p className="mt-3 break-keep text-xs leading-5 text-[var(--studio-text)]">{cartTexts.cartCheckoutNotice}</p>
        ) : null}
        <p className="mt-2 break-keep text-xs leading-5 text-[var(--studio-muted)]">
          충전 후 장바구니로 돌아오면 담아 둔 자료가 그대로 남아 있습니다.
        </p>
      </div>

      <CartCheckoutPanelBottom
        measureRef={bottomRef}
        className="px-5 pb-5"
        amountLine={amountLine}
        consent={consent}
        buttonRow={buttonRow}
      />
      <p aria-live="polite" className="sr-only">{srReason}</p>
    </aside>
  )
}
