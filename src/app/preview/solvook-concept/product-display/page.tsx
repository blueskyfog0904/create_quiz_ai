import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MarketMaterialDetail } from '@/app/preview/solvook-concept/_components/detail/market-material-detail'
import {
  MARKET_ITEM_INFO_KEYS,
  parseMarketItemDisplay,
  type MarketItemDetailDisplay,
} from '@/lib/market-item-options'
import { isProductDisplayPreviewEnabled, readProductDisplayPreviewData } from '@/lib/market-item-options-server'
import type { MarketCartItem } from '@/lib/market-cart-server'
import type {
  MarketBundlePublicSummary,
  MarketItemFile,
  MarketPublishedItem,
  MarketSubproductPublicSummary,
} from '@/lib/market-items-server'
import { CartLinePreview } from './cart-line-preview'

// 19번 9-2: 상품 상세 표시 미리보기(개발 전용). 예시 상품·설정 값은 생성 파일(output/b19-product-display-preview.json)에서 읽는다.
// 운영 DB 를 읽거나 쓰지 않고, 상세 주소를 열지 않아 조회 기록이 쓰이지 않는다(예시 상품 id 는 가짜라 조회 route 가 404).
// 주소 값: ?sample=0|3|legacy  ?bundle=named|empty|long|none  ?hide=grade,registeredAt…  ?missing=1(설정 읽기 실패)
export const dynamic = 'force-dynamic'

interface PreviewData {
  item: MarketPublishedItem
  subproducts: MarketSubproductPublicSummary[]
  bundle: Omit<MarketBundlePublicSummary, 'label'>
  bundleLabels: Record<'named' | 'empty' | 'long', string>
}

interface ProductDisplayPreviewPageProps {
  searchParams: Promise<{ sample?: string; bundle?: string; hide?: string; missing?: string }>
}

const CASE_LINKS: { label: string; query: string }[] = [
  { label: 'V1 샘플 3장', query: '?sample=3' },
  { label: 'V1 샘플 0장', query: '?sample=0' },
  { label: 'V1 옛 샘플', query: '?sample=legacy' },
  { label: 'V2 학년·등록일 숨김', query: '?hide=grade,registeredAt' },
  { label: 'V3 표시명 있음', query: '?bundle=named' },
  { label: 'V3 표시명 빔', query: '?bundle=empty' },
  { label: 'V3 표시명 40자', query: '?bundle=long' },
  { label: '설정 읽기 실패', query: '?missing=1&bundle=empty' },
]

export default async function ProductDisplayPreviewPage({ searchParams }: ProductDisplayPreviewPageProps) {
  if (!isProductDisplayPreviewEnabled()) notFound()
  const query = await searchParams
  const data = await readProductDisplayPreviewData()
  const example = data.detailPreview as PreviewData | null
  const parsed = parseMarketItemDisplay(data.display)
  if (!example || !parsed) notFound()

  const hidden = new Set((query.hide ?? '').split(','))
  const display: MarketItemDetailDisplay | null = query.missing === '1' ? null : {
    ...parsed.detail,
    infoItems: parsed.detail.infoItems.map((info) => ({ ...info, visible: info.visible && !hidden.has(info.key) })),
  }
  const samplePageCount = query.sample === '0' || query.sample === 'legacy' ? 0 : 3
  const files = (query.sample === 'legacy' ? [{ id: `${example.item.id}-legacy`, asset_kind: 'sample' }] : []) as unknown as MarketItemFile[]
  const bundleKey = query.bundle === 'empty' || query.bundle === 'long' || query.bundle === 'none' ? query.bundle : 'named'
  const bundleOption = bundleKey === 'none' ? null : { ...example.bundle, label: example.bundleLabels[bundleKey] }

  // V5 장바구니 묶음 줄: 이름이 꼬리표와 같음(한 번) · 다름(둘) · 빈 이름(꼬리표만)
  const cartLine = (n: number, optionTitle: string): MarketCartItem => ({
    id: `${example.item.id}-cart-${n}`, targetKind: 'bundle', targetId: example.bundle.id, itemId: example.item.id, workspaceSubject: 'korean',
    itemTitle: example.item.title, optionTitle, categoryName: null, purchasable: true, reason: null, partiallyOwned: false,
    originalCredits: example.bundle.priceCredits, chargedCredits: example.bundle.priceCredits, isSelected: true, createdAt: example.item.created_at,
    detailHref: null, categorySlug: null, includesPdf: false,
  })

  return (
    <div className="space-y-6 pb-16">
      <nav aria-label="미리보기 경우" className="flex flex-wrap gap-2 px-4 pt-4 text-sm">
        {CASE_LINKS.map((link) => (
          <Link key={link.query} href={`/preview/solvook-concept/product-display${link.query}`}
            className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] px-3 py-1.5 hover:border-[var(--studio-primary)]">
            {link.label}
          </Link>
        ))}
        <span className="self-center text-xs text-[var(--studio-muted)]">자료 정보 key: {MARKET_ITEM_INFO_KEYS.join(', ')}</span>
      </nav>
      <MarketMaterialDetail
        bundleOption={bundleOption}
        downloadFiles={[]}
        files={files}
        isLoggedIn={false}
        item={example.item}
        purchases={[]}
        reviews={{ summary: { average: null, count: 0 }, reviews: [], activeTags: [], viewer: { canWrite: false, myReview: null } }}
        reviewSort="latest"
        samplePageCount={samplePageCount}
        subproducts={example.subproducts}
        categoryTree={[]}
        purchasePolicy={null}
        purchaseInfo={{ termsLink: null, refundPolicyLink: null }}
        display={display}
      />
      <section aria-label="장바구니 묶음 줄 미리보기" className="mx-auto max-w-3xl px-4">
        <CartLinePreview items={[
          cartLine(1, parsed.detail.bundleDefaultTitle),
          cartLine(2, example.bundleLabels.named),
          cartLine(3, example.bundleLabels.empty),
        ]} />
      </section>
    </div>
  )
}
