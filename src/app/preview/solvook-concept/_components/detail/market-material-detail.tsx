import Link from 'next/link'
import {
  CalendarDays,
  FileText,
} from 'lucide-react'
import MarketItemActions from '@/components/market/market-item-actions'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioDetailPageFrame } from '@/components/page-templates/studio-detail-page-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  MarketBundlePublicSummary,
  MarketItem,
  MarketItemFile,
  MarketPublishedItem,
  MarketPurchase,
  MarketSubproductDownloadFile,
  MarketSubproductPublicSummary,
} from '@/lib/market-items-server'
import type { MarketItemReviewsResult, MarketReviewSort } from '@/lib/market-reviews-server'
import { MarketMaterialSampleButton } from './market-material-sample-button'
import { MarketReviewsSection } from './market-reviews-section'
import { MarketCategorySidebar } from '@/components/market/MarketCategorySidebar'
import { findCategoryPath, type MarketCategoryNode } from '@/lib/market-category-tree'
import type { MarketPurchasePolicyView } from '@/lib/market-purchase-policy'
import type { MarketPurchaseInfo } from '@/lib/market-purchase-info'
import {
  buildMaterialInfoRows,
  formatMarketItemRegisteredAt,
  isInfoItemVisible,
  type MarketItemDetailDisplay,
} from '@/lib/market-item-options'
import {
  MarketPurchaseInfoSection,
} from '@/components/market/market-purchase-info-section'

interface MarketMaterialDetailProps {
  bundleOption: MarketBundlePublicSummary | null
  downloadFiles: MarketSubproductDownloadFile[]
  files: MarketItemFile[]
  isLoggedIn: boolean
  item: MarketPublishedItem
  purchases: MarketPurchase[]
  reviews: MarketItemReviewsResult
  reviewSort: MarketReviewSort
  samplePageCount: number
  subproducts: MarketSubproductPublicSummary[]
  categoryTree: MarketCategoryNode[]
  purchasePolicy: MarketPurchasePolicyView | null
  purchaseInfo: MarketPurchaseInfo
  // 19번: 상세 안내 문구·자료 정보 항목(DB). 읽지 못했으면 null — 자료 정보 표·학년/자료유형 배지·등록일 줄·요약 두 줄·샘플 버튼을 숨긴다.
  display: MarketItemDetailDisplay | null
}

function getStartingPrice(
  item: MarketItem,
  files: MarketItemFile[],
  subproducts: MarketSubproductPublicSummary[],
  bundleOption: MarketBundlePublicSummary | null
) {
  const prices = [
    ...subproducts.map((subproduct) => subproduct.priceCredits),
    bundleOption?.priceCredits,
    files.some((file) => file.asset_kind === 'pdf') ? item.pdf_price : null,
    files.some((file) => file.asset_kind === 'hwp') ? item.hwp_price : null,
    files.some((file) => file.asset_kind === 'zip') ? item.zip_price : null,
  ].filter((price): price is number => typeof price === 'number')

  return prices.length > 0 ? Math.min(...prices) : null
}

export function MarketMaterialDetail({
  bundleOption,
  downloadFiles,
  files,
  isLoggedIn,
  item,
  purchases,
  reviews,
  reviewSort,
  samplePageCount,
  subproducts,
  categoryTree,
  purchasePolicy,
  purchaseInfo,
  display,
}: MarketMaterialDetailProps) {
  // 상품이 연결된 칸까지의 경로(depth1 → 연결 칸). 카테고리가 없거나 공개 트리에 없으면 빈 경로.
  const categoryPath = item.category_item_id ? findCategoryPath(categoryTree, item.category_item_id) ?? [] : []
  const activeCategory = categoryPath[categoryPath.length - 1]
  const subjectLabel = item.workspace_subject === 'korean' ? '국어' : '영어'
  const startingPrice = getStartingPrice(item, files, subproducts, bundleOption)
  const hasSamplePages = samplePageCount > 0
  const hasLegacySample = files.some((file) => file.asset_kind === 'sample')
  const ownsPdf = purchases.some((purchase) => purchase.asset_kind === 'pdf')
  const ownsHwp = purchases.some((purchase) => purchase.asset_kind === 'hwp')
  const ownsZip = purchases.some((purchase) => purchase.asset_kind === 'zip')
  const examPeriod = [
    item.exam_year ? `${item.exam_year}년` : null,
    item.exam_month ? `${item.exam_month}월` : null,
  ].filter(Boolean).join(' ')
  const description = item.description?.trim() || item.summary?.trim()
  // 19번: 자료 정보 표는 DB 설정의 항목 이름·보이기·순서를 따른다(빈 값 행은 뺀다). 숨긴 학년·자료유형은 위 배지도, 숨긴 등록일자는 위 등록일 줄도 숨긴다.
  const materialInfoRows = display
    ? buildMaterialInfoRows({
      subject: subjectLabel,
      grade: item.grade_level,
      sources: [item.source_1, item.source_2, item.source_3, item.source_4],
      materialType: item.source_type,
      questionCount: item.question_count,
      registeredAt: formatMarketItemRegisteredAt(item.created_at),
    }, display)
    : []
  const registeredAtLabel = display?.infoItems.find((info) => info.key === 'registeredAt')?.label ?? null
  const showRegisteredAt = isInfoItemVisible(display, 'registeredAt') && registeredAtLabel !== null

  return (
    <StudioDetailPageFrame
      navigation={(
        <MarketCategorySidebar
          key={activeCategory?.id ?? item.workspace_subject}
          tree={categoryTree}
          subject={item.workspace_subject}
          activeId={activeCategory?.id ?? null}
        />
      )}
      header={(
        <section className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)]">
          <StudioContainer className="py-6">
            <nav
              aria-label="현재 위치"
              className="flex flex-wrap items-center gap-2 text-sm text-[var(--studio-muted)]"
            >
              <Link
                href={`/?subject=${item.workspace_subject}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                홈
              </Link>
              <span aria-hidden="true">/</span>
              {categoryPath.map((node) => (
                <span key={node.id} className="contents">
                  <Link
                    href={`/categories/${node.id}?subject=${item.workspace_subject}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                  >
                    {node.title}
                  </Link>
                  <span aria-hidden="true">/</span>
                </span>
              ))}
              <span
                aria-current="page"
                className="min-w-0 flex-1 truncate font-semibold text-[var(--studio-text)]"
              >
                {item.title}
              </span>
            </nav>
          </StudioContainer>
        </section>
      )}
      main={(
        <section className="grid min-w-0 gap-7 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-7 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[220px]">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- public market thumbnails can be remote URLs outside Next image optimization.
              <img
                src={item.thumbnailUrl}
                alt={`${item.title} 표지`}
                className="aspect-[3/4] w-full rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] object-cover"
              />
            ) : (
              <div className="flex aspect-[3/4] w-full flex-col items-center justify-center rounded-[var(--studio-radius-card)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] px-4 text-center text-[var(--studio-muted)]">
                <FileText aria-hidden="true" className="size-8" />
                <span className="mt-3 text-sm font-bold">{activeCategory?.title ?? subjectLabel}</span>
              </div>
            )}
            {display ? (
              <MarketMaterialSampleButton
                itemId={item.id}
                samplePageCount={samplePageCount}
                workspaceSubject={item.workspace_subject}
                label={samplePageCount > 0 ? display.sampleButton : display.sampleButtonEmpty}
              />
            ) : null}
          </div>

          <div className="min-w-0 py-1">
            <div className="flex flex-wrap gap-2">
              {examPeriod ? (
                <Badge className="border-0 bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                  {examPeriod}
                </Badge>
              ) : null}
              {item.source_type && isInfoItemVisible(display, 'materialType') ? (
                <Badge
                  variant="outline"
                  className="border-[var(--studio-border)] text-[var(--studio-text)]"
                >
                  {item.source_type}
                </Badge>
              ) : null}
              {item.grade_level && isInfoItemVisible(display, 'grade') ? (
                <Badge
                  variant="outline"
                  className="border-[var(--studio-border)] text-[var(--studio-text)]"
                >
                  {item.grade_level}
                </Badge>
              ) : null}
            </div>

            <h1 className="mt-5 break-words text-2xl font-extrabold leading-tight tracking-[-0.04em] text-[var(--studio-ink)] [overflow-wrap:anywhere]">
              {item.title}
            </h1>
            {item.summary ? (
              <p className="mt-4 break-keep text-base leading-7 text-[var(--studio-muted)]">
                {item.summary}
              </p>
            ) : null}

            {showRegisteredAt ? (
              <dl className="mt-6 border-y border-[var(--studio-border)] py-5 text-sm">
                <div className="flex items-center gap-2">
                  <CalendarDays aria-hidden="true" className="h-4 w-4 text-[var(--studio-muted)]" />
                  <dt className="text-[var(--studio-muted)]">{registeredAtLabel}</dt>
                  <dd>{formatMarketItemRegisteredAt(item.created_at)}</dd>
                </div>
              </dl>
            ) : null}

            {/* 자료 정보는 칸 상자 대신 한 줄씩(라벨·값), 가격은 크게. 요약 이름은 DB 설정(19번) */}
            {display ? (
              <dl className="mt-5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-2.5 text-sm">
                <dt className="text-[var(--studio-muted)]">{display.summaryLabels.questionCount}</dt>
                <dd className="font-medium text-[var(--studio-text)]">
                  {item.question_count === null ? display.summaryLabels.unknown : `${item.question_count}개`}
                </dd>
                <dt className="text-[var(--studio-muted)]">{display.summaryLabels.samplePages}</dt>
                <dd className="font-medium text-[var(--studio-text)]">
                  {hasSamplePages ? `${samplePageCount}장` : display.summaryLabels.noSample}
                </dd>
              </dl>
            ) : null}
            <p className="mt-5 [font-family:var(--studio-font-price)] text-2xl font-bold tabular-nums text-[var(--studio-ink)]">
              {startingPrice === null ? '가격 정보 없음' : `${startingPrice.toLocaleString('ko-KR')} 크레딧`}
            </p>

            <Button asChild variant="brand" className="mt-5 lg:hidden">
              <a href="#purchase-options">구매 옵션 확인</a>
            </Button>
          </div>
        </section>
      )}
      tabs={(
        <div className="space-y-6">
          {/* 19번: 자료 정보 행도 설명도 없으면(설정을 읽지 못했거나 모두 숨김·빈 값) 빈 카드를 그리지 않는다 */}
          {materialInfoRows.length > 0 || description ? (
            <section
              aria-labelledby="market-material-information-heading"
              className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 sm:p-8"
            >
              <h2
                id="market-material-information-heading"
                className="text-xl font-bold text-[var(--studio-ink)]"
              >
                자료 상세 정보
              </h2>
              {materialInfoRows.length > 0 ? (
                <dl className="mt-5 grid gap-x-10 gap-y-4 border-t border-[var(--studio-border)] pt-5 text-sm sm:grid-cols-2">
                  {materialInfoRows.map((row) => (
                    <div key={row.key} className="flex gap-6">
                      <dt className="min-w-[72px] text-[var(--studio-muted)]">{row.label}</dt>
                      <dd className="break-words font-medium text-[var(--studio-text)]">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {description ? (
                <div className="mt-5 whitespace-pre-line break-keep border-t border-[var(--studio-border)] pt-5 text-sm leading-7 text-[var(--studio-text)]">
                  {description}
                </div>
              ) : null}
            </section>
          ) : null}

          <section
            id="purchase-options"
            aria-labelledby="market-purchase-options-heading"
            className="scroll-mt-36 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-7"
          >
            {/* 머리말은 한글 제목 하나(작은 소제목·안내 문장 없음) */}
            <h2
              id="market-purchase-options-heading"
              className="mb-5 text-xl font-bold text-[var(--studio-ink)]"
            >
              자료 선택
            </h2>
            <MarketItemActions
              bundleOption={bundleOption}
              downloadFiles={downloadFiles}
              hasLegacySample={hasLegacySample}
              hasSamplePages={hasSamplePages}
              hwpPrice={item.hwp_price}
              isLoggedIn={isLoggedIn}
              itemId={item.id}
              ownsHwp={ownsHwp}
              ownsPdf={ownsPdf}
              ownsZip={ownsZip}
              pdfPrice={item.pdf_price}
              samplePageCount={samplePageCount}
              subproducts={subproducts}
              workspaceSubject={item.workspace_subject}
              zipPrice={item.zip_price}
              purchasePolicy={purchasePolicy}
              itemTitle={item.title}
              display={display}
            />
          </section>

          <MarketReviewsSection
            itemId={item.id}
            isLoggedIn={isLoggedIn}
            reviews={reviews}
            sort={reviewSort}
          />

          {/* 구매 전 확인(이용 기간·이용 범위·환불)은 상세 맨 아래에 둔다 */}
          <MarketPurchaseInfoSection
            policy={purchasePolicy}
            info={purchaseInfo}
          />
        </div>
      )}
    />
  )
}
