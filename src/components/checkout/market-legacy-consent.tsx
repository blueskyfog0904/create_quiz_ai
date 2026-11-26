'use client'

import { useId } from 'react'
import Link from 'next/link'
import { Checkbox } from '@/components/ui/checkbox'
import { CHECKOUT_CONSENT_REQUIRED_MARK } from '@/lib/checkout-consent'
import type { MarketPurchaseNotice } from '@/lib/market-purchase-policy'
import type { MarketPurchaseLink } from '@/lib/market-purchase-info'

// 11번 6-5 '1판 모드'(새 코드 + 1판 정책): 1판 지문은 '펼쳐 놓고 보았다'는 증빙이라 접지 않는다.
// confirmNotice 본문(넓은 화면은 낮은 스크롤 상자, tabIndex=0·이름) + [필수] {checkboxLabel} + 약관·환불정책 링크(없으면 숨기되 자리는 둠).
// 체크 값은 부르는 쪽이 든다. 장바구니 결제 칸과 관리자 미리보기(1판 높이 재기)가 같이 쓴다.
export function MarketLegacyConsent({
  notice,
  checked,
  onCheckedChange,
  disabled = false,
  termsLink,
  refundPolicyLink,
}: {
  notice: MarketPurchaseNotice
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
}) {
  const baseId = useId()
  const noticeId = `${baseId}-notice`
  const checkId = `${baseId}-check`
  return (
    <div className="min-w-0 text-[var(--studio-ink)]">
      <div
        id={noticeId}
        tabIndex={0}
        role="region"
        aria-label="구매 전 확인"
        className="whitespace-pre-line break-keep rounded-md border border-[var(--studio-border)] bg-[var(--studio-background)] p-3 text-xs leading-5 text-[var(--studio-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] lg:max-h-24 lg:overflow-y-auto"
      >
        {notice.confirmNotice}
      </div>
      <label htmlFor={checkId} className="mt-2 flex min-h-11 cursor-pointer items-start gap-2 py-1 text-sm leading-5 has-[:disabled]:cursor-not-allowed">
        <span className="grid size-5 shrink-0 place-items-center">
          <Checkbox
            id={checkId}
            checked={checked}
            disabled={disabled}
            aria-describedby={noticeId}
            onCheckedChange={(next) => onCheckedChange(next === true)}
          />
        </span>
        <span className="min-w-0 break-keep font-semibold">{CHECKOUT_CONSENT_REQUIRED_MARK} {notice.checkboxLabel}</span>
      </label>
      <p className="flex min-h-6 flex-wrap gap-x-3 text-xs">
        {termsLink ? (
          <Link href={termsLink.href} target="_blank" className="underline underline-offset-4">{termsLink.label}</Link>
        ) : null}
        {refundPolicyLink ? (
          <Link href={refundPolicyLink.href} target="_blank" className="underline underline-offset-4">{refundPolicyLink.label}</Link>
        ) : null}
      </p>
    </div>
  )
}
