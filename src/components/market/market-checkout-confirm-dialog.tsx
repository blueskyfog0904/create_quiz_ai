'use client'

import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import {
  StudioDialogDescription,
  StudioDialogFooter,
  StudioDialogHeader,
  StudioDialogPanel,
  StudioDialogTitle,
} from '@/components/design-system/studio-dialog'
import type { MarketPurchaseNotice } from '@/lib/market-purchase-policy'
import type { MarketPurchaseLink } from '@/lib/market-purchase-info'

export interface MarketCheckoutConfirmLine {
  key: string
  title: string
  optionTitle: string | null
  expectedCredits: number
  // 409 PRICE_CHANGED로 바뀐 경우 직전에 확인했던 금액
  previousCredits: number | null
}

interface MarketCheckoutConfirmDialogProps {
  open: boolean
  title: string
  description: string
  lines: MarketCheckoutConfirmLine[]
  total: number
  balance: number
  needsAcknowledgement: boolean
  acknowledged: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  // 구매 고지(DB 문구·서버 지문). 확인창을 열 때 복사해 둔 값이고, 409 PURCHASE_NOTICE_CHANGED 때만 바뀐다. null 이면 구매 버튼을 막는다.
  purchaseNotice: MarketPurchaseNotice | null
  noticeAcknowledged: boolean
  onNoticeAcknowledgedChange: (acknowledged: boolean) => void
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
  notice: string | null
  shortfall: number | null
  chargeHref: string
  chargeHint?: string
  submitting: boolean
  retryable: boolean
  onCancel: () => void
  onConfirm: () => void
}

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
}

// 장바구니·상품 상세 공통 구매 확인 표시부. 요청·오류 분기와 상태는 각 소비처가 소유한다.
export function MarketCheckoutConfirmDialog({
  open,
  title,
  description,
  lines,
  total,
  balance,
  needsAcknowledgement,
  acknowledged,
  onAcknowledgedChange,
  purchaseNotice,
  noticeAcknowledged,
  onNoticeAcknowledgedChange,
  termsLink,
  refundPolicyLink,
  notice,
  shortfall,
  chargeHref,
  chargeHint,
  submitting,
  retryable,
  onCancel,
  onConfirm,
}: MarketCheckoutConfirmDialogProps) {
  const canConfirm = !submitting && shortfall === null && (!needsAcknowledgement || acknowledged)
    && purchaseNotice !== null && noticeAcknowledged

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onCancel()
        }
      }}
    >
      {/* 패널은 화면 높이 안에 두고(제목·본문·버튼 3줄 grid), 가운데 본문만 스크롤한다. 공용 Dialog 는 바꾸지 않는다. */}
      <StudioDialogPanel showCloseButton={false} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md">
        <StudioDialogHeader>
          <StudioDialogTitle>{title}</StudioDialogTitle>
          <StudioDialogDescription>{description}</StudioDialogDescription>
        </StudioDialogHeader>

        {open ? (
          // 본문만 스크롤하고 버튼 줄은 늘 보이게 한다(작은 화면에서 고지·알림이 함께 떠도 구매·취소 버튼이 가려지지 않음).
          <div className="-mx-1 min-h-0 min-w-0 space-y-4 overflow-y-auto px-1">
            <ul className="max-h-60 divide-y divide-[var(--studio-border)] overflow-y-auto rounded-[var(--studio-radius-control)] border border-[var(--studio-border)]">
              {lines.map((line) => (
                <li key={line.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="break-keep font-semibold text-[var(--studio-ink)]">{line.title}</p>
                    {line.optionTitle ? <p className="break-keep text-xs text-[var(--studio-muted)]">{line.optionTitle}</p> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {line.previousCredits !== null ? (
                      <p className="text-xs text-[var(--studio-muted)] line-through">{formatCredits(line.previousCredits)}</p>
                    ) : null}
                    <p className={line.previousCredits !== null ? 'font-bold text-destructive' : 'font-bold text-[var(--studio-ink)]'}>
                      {formatCredits(line.expectedCredits)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--studio-muted)]">합계</dt>
                <dd className="font-bold text-[var(--studio-ink)]">{formatCredits(total)} 크레딧</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--studio-muted)]">보유 크레딧</dt>
                <dd className="font-semibold text-[var(--studio-ink)]">{formatCredits(balance)} 크레딧</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-dashed border-[var(--studio-border)] pt-2">
                <dt className="font-semibold text-[var(--studio-ink)]">구매 후 잔액</dt>
                <dd className={balance - total < 0 ? 'font-bold text-destructive' : 'font-bold text-[var(--studio-ink)]'}>
                  {formatCredits(balance - total)} 크레딧
                </dd>
              </div>
            </dl>

            {needsAcknowledgement ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] p-3 text-sm text-[var(--studio-text)]">
                <span className="grid size-11 shrink-0 place-items-center">
                  <Checkbox
                    checked={acknowledged}
                    // 재시도는 같은 키·같은 payload여야 하므로 retryable 동안 ack를 바꾸지 못하게 한다.
                    disabled={submitting || retryable}
                    onCheckedChange={(checked) => onAcknowledgedChange(checked === true)}
                    aria-label="기보유분 차감 없이 정가 구매 확인"
                  />
                </span>
                <span className="py-3">
                  이미 구매한 개별 자료가 포함된 전체 패키지는 기보유분 차감 없이 정가로 구매됨을 확인했습니다.
                </span>
              </label>
            ) : null}

            {purchaseNotice ? (
              <div className="space-y-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm text-[var(--studio-text)]">
                <p className="whitespace-pre-line break-keep leading-6">{purchaseNotice.confirmNotice}</p>
                {termsLink || refundPolicyLink ? (
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {termsLink ? (
                      <Link href={termsLink.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--studio-ink)] underline underline-offset-2">
                        {termsLink.label}
                      </Link>
                    ) : null}
                    {refundPolicyLink ? (
                      <Link href={refundPolicyLink.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--studio-ink)] underline underline-offset-2">
                        {refundPolicyLink.label}
                      </Link>
                    ) : null}
                  </p>
                ) : null}
                <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--studio-text)]">
                  <span className="grid size-11 shrink-0 place-items-center">
                    <Checkbox
                      checked={noticeAcknowledged}
                      // 재시도는 같은 키·같은 지문이어야 하므로 retryable 동안 바꾸지 못하게 한다.
                      disabled={submitting || retryable}
                      onCheckedChange={(checked) => onNoticeAcknowledgedChange(checked === true)}
                      aria-labelledby="market-purchase-notice-checkbox-label"
                    />
                  </span>
                  <span id="market-purchase-notice-checkbox-label" className="break-keep py-3 font-semibold">[필수] {purchaseNotice.checkboxLabel}</span>
                </label>
              </div>
            ) : (
              <p role="alert" className="rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm text-[var(--studio-text)]">
                구매 안내를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
              </p>
            )}

            {notice ? (
              <div role="alert" className="rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm text-[var(--studio-text)]">
                <p>{notice}</p>
                {shortfall !== null ? (
                  <>
                    <p className="mt-1 font-bold text-destructive">{formatCredits(shortfall)} 크레딧이 부족합니다.</p>
                    <Button asChild variant="brandOutline" className="mt-3 w-full">
                      <Link href={chargeHref}>크레딧 충전하기</Link>
                    </Button>
                    {chargeHint ? <p className="mt-2 text-xs text-[var(--studio-muted)]">{chargeHint}</p> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <StudioDialogFooter>
          <Button
            variant="brandOutline"
            disabled={submitting}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button variant="brand" disabled={!canConfirm} onClick={onConfirm}>
            {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
            {retryable ? '같은 요청으로 다시 시도' : `${formatCredits(total)} 크레딧 구매`}
          </Button>
        </StudioDialogFooter>
      </StudioDialogPanel>
    </Dialog>
  )
}
