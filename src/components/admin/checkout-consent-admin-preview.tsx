'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckoutConsent, type CheckoutConsentLinks } from '@/components/checkout/checkout-consent'
import { CartCheckoutPanelBottom } from '@/components/checkout/cart-checkout-panel-bottom'
import { MarketLegacyConsent } from '@/components/checkout/market-legacy-consent'
import type { CheckoutConsentBundle } from '@/lib/checkout-consent'
import type { MarketPurchaseNotice } from '@/lib/market-purchase-policy'
import type { MarketPurchaseLink } from '@/lib/market-purchase-info'
import {
  CHECKOUT_PANEL_CONTENT_WIDTH,
  CHECKOUT_PANEL_WIDTH,
  CHECKOUT_PANEL_PREVIEW_MARGIN,
  checkoutPanelMaxInnerHeight,
  decideCheckoutPanelMode,
  LAPTOP_PREVIEW_VIEWPORT,
} from '@/lib/checkout-panel-layout'

// 11번 9절 미리보기: 실제 CheckoutConsent 를 실제 폭과 테마(.studio-theme / 충전 잉크) 안에서 그린다(세부 항목 창도 열 수 있음).
// 자료는 장바구니 결제 칸 아래 묶음(CartCheckoutPanelBottom)을 실제 부품으로 그려, 장바구니와 같은 판정 함수
// decideCheckoutPanelMode 로 1366×768 기준에 들어가는지 잰다. 판과 관계없이 1판 묶음을 늘 재고, 2판 키가 있으면 2판도 잰다.
// 넓은 화면(lg)에서만 잴 수 있다(좁은 화면은 결제 칸 글꼴·상자 크기가 달라 재지 않고 null).

// 장바구니 결제 칸 안쪽 폭(px). 장바구니 화면의 결제 칸 폭과 같은 상수(checkout-panel-layout.ts)를 쓴다.
// 미리보기 상자는 border-box 라 겉폭을 CHECKOUT_PANEL_WIDTH(테두리 1px·p-5 포함)로 두면 안쪽이 장바구니와 같은 358px 이 된다.
export const CART_PANEL_PREVIEW_CONTENT_WIDTH = CHECKOUT_PANEL_CONTENT_WIDTH
const CHARGE_PANEL_PREVIEW_CONTENT_WIDTH = 312

const STUDIO_CONSENT_VARS = '[--consent-ink:var(--studio-ink)] [--consent-muted:var(--studio-muted)] [--consent-line:var(--studio-border)] [--consent-ring:var(--studio-focus-ring)]'
const CK_INK_VARS = '[--ck-bg:#FAF8F5] [--ck-ink:#1C1917] [--ck-text:#44403C] [--ck-muted:#78716C] [--ck-line:#E7E5E4] [--ck-line-strong:#D6D3D1]'
const CK_CONSENT_VARS = '[--consent-ink:var(--ck-ink)] [--consent-muted:var(--ck-muted)] [--consent-line:var(--ck-line)] [--consent-ring:var(--ck-ink)]'

export type CheckoutPanelFit = boolean | null

// 높이를 재서 들어가는지(true)·넘치는지(false)·잴 수 없는지(null)를 알린다. 쓰는 도중이 아니라 내용이 바뀐 뒤·글꼴 로드 끝·창 크기 바뀜에 잰다.
function useCheckoutPanelFit(deps: unknown[]): [React.RefObject<HTMLDivElement | null>, CheckoutPanelFit] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<CheckoutPanelFit>(null)
  useLayoutEffect(() => {
    let cancelled = false
    const measure = () => {
      if (cancelled || !ref.current) return
      if (!window.matchMedia('(min-width: 1024px)').matches) {
        setFit(null)
        return
      }
      const mode = decideCheckoutPanelMode({
        bottomHeight: ref.current.getBoundingClientRect().height + CHECKOUT_PANEL_PREVIEW_MARGIN,
        maxInnerHeight: checkoutPanelMaxInnerHeight(LAPTOP_PREVIEW_VIEWPORT.height),
      })
      setFit(mode === 'sticky')
    }
    measure()
    void document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelled = true
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [ref, fit]
}

function SampleButtonRow() {
  return (
    <Button type="button" variant="brand" className="h-auto min-h-12 w-full" disabled>
      필수 동의를 체크해 주세요
    </Button>
  )
}

export function MarketCheckoutConsentPreview({
  legacyNotice,
  consent,
  termsLink,
  refundPolicyLink,
  linksVisible,
  onFitChange,
}: {
  legacyNotice: MarketPurchaseNotice | null
  consent: CheckoutConsentBundle | null
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
  linksVisible: boolean
  onFitChange: (fit: { legacy: CheckoutPanelFit; consent: CheckoutPanelFit }) => void
}) {
  const [legacyChecked, setLegacyChecked] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const links: CheckoutConsentLinks = { refundPolicy: refundPolicyLink?.href ?? null, serviceTerms: termsLink?.href ?? null }
  const [legacyRef, legacyFit] = useCheckoutPanelFit([JSON.stringify(legacyNotice)])
  const [consentRef, consentFit] = useCheckoutPanelFit([JSON.stringify(consent)])
  const effectiveConsentFit = consent ? consentFit : null
  const effectiveLegacyFit = legacyNotice ? legacyFit : null

  useEffect(() => {
    onFitChange({ legacy: effectiveLegacyFit, consent: effectiveConsentFit })
  }, [effectiveLegacyFit, effectiveConsentFit, onFitChange])

  const fitText = (fit: CheckoutPanelFit) => (fit === null ? '넓은 화면(1024px 이상)에서 열면 잽니다' : fit ? '들어감' : '넘침')

  return (
    <div className="grid gap-4">
      {!linksVisible ? (
        <p role="alert" className="text-sm text-red-600">
          취소·환불정책 또는 서비스 이용약관 문서가 꺼져 있거나 비어 있어, 새 방식(접는 동의)으로는 결제가 막힙니다. 약관 문서를 먼저 확인해 주세요.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-6">
        {legacyNotice ? (
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">예전 방식(펼친 고지) · 1366×768: {fitText(effectiveLegacyFit)}</span>
            <div className={`studio-theme rounded-md border bg-[var(--studio-surface)] p-5`} style={{ width: CHECKOUT_PANEL_WIDTH }}>
              <CartCheckoutPanelBottom
                measureRef={legacyRef}
                amountLine="합계 0 · 결제 후 잔액 0"
                consent={(
                  <MarketLegacyConsent
                    notice={legacyNotice}
                    checked={legacyChecked}
                    onCheckedChange={setLegacyChecked}
                    termsLink={termsLink}
                    refundPolicyLink={refundPolicyLink}
                  />
                )}
                buttonRow={<SampleButtonRow />}
              />
            </div>
          </div>
        ) : null}
        {consent ? (
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">새 방식(접는 동의) · 1366×768: {fitText(effectiveConsentFit)}</span>
            <div className={`studio-theme rounded-md border bg-[var(--studio-surface)] p-5 ${STUDIO_CONSENT_VARS}`} style={{ width: CHECKOUT_PANEL_WIDTH }}>
              <CartCheckoutPanelBottom
                measureRef={consentRef}
                amountLine="합계 0 · 결제 후 잔액 0"
                consent={(
                  <CheckoutConsent
                    consent={consent}
                    links={links}
                    checkedKeys={checkedKeys}
                    onCheckedKeysChange={setCheckedKeys}
                    dialogClassName={`studio-theme ${STUDIO_CONSENT_VARS}`}
                  />
                )}
                buttonRow={<SampleButtonRow />}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function PointChargeCheckoutConsentPreview({
  consent,
  termsLink,
  refundPolicyLink,
  linksVisible,
}: {
  consent: CheckoutConsentBundle
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
  linksVisible: boolean
}) {
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const links: CheckoutConsentLinks = { refundPolicy: refundPolicyLink?.href ?? null, serviceTerms: termsLink?.href ?? null }
  return (
    <div className="grid gap-2">
      {!linksVisible ? (
        <p role="alert" className="text-sm text-red-600">
          취소·환불정책 또는 서비스 이용약관 문서가 꺼져 있거나 비어 있어, 새 방식(접는 동의)으로는 충전 결제가 막힙니다.
        </p>
      ) : null}
      <div className={`studio-theme rounded-lg border border-[var(--ck-line)] bg-white p-5 ${CK_INK_VARS} ${CK_CONSENT_VARS}`} style={{ width: CHARGE_PANEL_PREVIEW_CONTENT_WIDTH + 40 }}>
        <CheckoutConsent
          consent={consent}
          links={links}
          checkedKeys={checkedKeys}
          onCheckedKeysChange={setCheckedKeys}
          dialogClassName={`${CK_INK_VARS} ${CK_CONSENT_VARS}`}
        />
      </div>
    </div>
  )
}

// 9절 '저장된 값의 지문 보기'(단계 6 대조용): 저장된 정책으로 서버가 만든 2판 지문·장바구니 문구 지문·묶음 JSON. 읽기 전용.
export function StoredCheckoutConsentFingerprint({
  consent,
  consentIgnoringLinks,
  cartTextsSha256,
}: {
  consent: CheckoutConsentBundle | null
  consentIgnoringLinks: CheckoutConsentBundle | null
  cartTextsSha256?: string | null
}) {
  const bundle = consent ?? consentIgnoringLinks
  const json = bundle ? JSON.stringify(bundle, null, 2) : null
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined)
  }
  return (
    <details className="rounded-md border p-3 text-xs">
      <summary className="cursor-pointer text-sm font-medium">저장된 값의 지문 보기(새 방식)</summary>
      <dl className="mt-3 grid gap-2">
        <div>
          <dt className="text-muted-foreground">동의 지문(noticeSha256)</dt>
          <dd className="flex flex-wrap items-center gap-2 font-mono">
            {bundle ? bundle.noticeSha256 : '새 방식 문구가 없거나 검사에 걸려 만들 수 없습니다.'}
            {bundle ? <Button type="button" variant="outline" size="sm" onClick={() => copy(bundle.noticeSha256)}>복사</Button> : null}
          </dd>
          {!consent && consentIgnoringLinks ? (
            <dd className="text-red-600">약관 문서(링크)가 닫혀 있어 결제 때는 이 지문으로도 막힙니다.</dd>
          ) : null}
        </div>
        {cartTextsSha256 !== undefined ? (
          <div>
            <dt className="text-muted-foreground">장바구니 문구 지문(cartTextsSha256)</dt>
            <dd className="flex flex-wrap items-center gap-2 font-mono">
              {cartTextsSha256 ?? '장바구니 문구가 없거나 규칙에 걸려 만들 수 없습니다.'}
              {cartTextsSha256 ? <Button type="button" variant="outline" size="sm" onClick={() => copy(cartTextsSha256)}>복사</Button> : null}
            </dd>
          </div>
        ) : null}
        {json ? (
          <div>
            <dt className="flex items-center gap-2 text-muted-foreground">
              묶음 JSON
              <Button type="button" variant="outline" size="sm" onClick={() => copy(json)}>복사</Button>
            </dt>
            <dd><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{json}</pre></dd>
          </div>
        ) : null}
      </dl>
    </details>
  )
}
