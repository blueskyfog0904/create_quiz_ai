import Link from 'next/link'
import type { MarketPurchasePolicyView } from '@/lib/market-purchase-policy'
import type { MarketPurchaseInfo } from '@/lib/market-purchase-info'

interface MarketPurchaseInfoSectionProps {
  policy: MarketPurchasePolicyView | null
  info: MarketPurchaseInfo
}

// 상품 상세 "구매 전 확인"(이용 기간·이용 범위·청약철회 제한 고지). 문구는 모두 DB 값.
// 공급자 정보는 하단 정보(footer)에, 파일 형식은 아래 자료 선택에 있어 여기서는 보이지 않는다.
// 고지 설정을 읽지 못하면(policy null) 블록째 숨긴다(구매 버튼은 확인창에서 막힘).
export function MarketPurchaseInfoSection({ policy, info }: MarketPurchaseInfoSectionProps) {
  const rows: { label: string; content: React.ReactNode }[] = []

  if (policy) {
    rows.push({ label: '이용 기간', content: <p className="break-keep">{policy.downloadPeriodNotice}</p> })
    rows.push({
      label: '이용 범위',
      content: (
        <p className="break-keep">
          {policy.usageScopeNotice}
          {info.termsLink ? (
            <>
              {' '}
              <Link href={info.termsLink.href} className="font-semibold text-[var(--studio-ink)] underline underline-offset-2">
                {info.termsLink.label}
              </Link>
            </>
          ) : null}
        </p>
      ),
    })
    rows.push({
      label: '환불',
      content: (
        <p className="break-keep">
          {policy.detailRefundNotice}
          {info.refundPolicyLink ? (
            <>
              {' '}
              <Link href={info.refundPolicyLink.href} className="font-semibold text-[var(--studio-ink)] underline underline-offset-2">
                {info.refundPolicyLink.label}
              </Link>
            </>
          ) : null}
        </p>
      ),
    })
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="market-purchase-info-heading"
      className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 sm:p-8"
    >
      <h2 id="market-purchase-info-heading" className="text-xl font-bold text-[var(--studio-ink)]">
        구매 전 확인
      </h2>
      <dl className="mt-5 space-y-4 border-t border-[var(--studio-border)] pt-5 text-sm leading-6">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1 sm:flex-row sm:gap-6">
            <dt className="shrink-0 text-[var(--studio-muted)] sm:min-w-[72px]">{row.label}</dt>
            <dd className="min-w-0 text-[var(--studio-text)]">{row.content}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
