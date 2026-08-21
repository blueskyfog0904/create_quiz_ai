import Link from 'next/link'
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  PackageCheck,
} from 'lucide-react'
import MarketItemActions from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioDetailPageFrame } from '@/components/page-templates/studio-detail-page-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  MarketBundlePublicSummary,
  MarketItem,
  MarketItemFile,
  MarketMenuEntry,
  MarketPurchase,
  MarketSubproductDownloadFile,
  MarketSubproductPublicSummary,
} from '@/lib/market-items-server'
import { MarketMaterialSampleButton } from './market-material-sample-button'

interface MarketMaterialDetailProps {
  bundleOption: MarketBundlePublicSummary | null
  category: MarketMenuEntry
  downloadFiles: MarketSubproductDownloadFile[]
  files: MarketItemFile[]
  isLoggedIn: boolean
  item: MarketItem
  purchases: MarketPurchase[]
  samplePageCount: number
  subproducts: MarketSubproductPublicSummary[]
}

function formatRegisteredAt(value: string) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}년 ${values.month}월 ${values.day}일`
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
  category,
  downloadFiles,
  files,
  isLoggedIn,
  item,
  purchases,
  samplePageCount,
  subproducts,
}: MarketMaterialDetailProps) {
  const boardHref = `/preview/solvook-concept/boards/${category.slug}?subject=${item.workspace_subject}`
  const startingPrice = getStartingPrice(item, files, subproducts, bundleOption)
  const hasSamplePages = samplePageCount > 0
  const hasLegacySample = files.some((file) => file.asset_kind === 'sample')
  const hasPdf = files.some((file) => file.asset_kind === 'pdf')
  const hasHwp = files.some((file) => file.asset_kind === 'hwp')
  const hasZip = files.some((file) => file.asset_kind === 'zip')
  const ownsPdf = purchases.some((purchase) => purchase.asset_kind === 'pdf')
  const ownsHwp = purchases.some((purchase) => purchase.asset_kind === 'hwp')
  const ownsZip = purchases.some((purchase) => purchase.asset_kind === 'zip')
  const sources = [item.source_1, item.source_2, item.source_3, item.source_4]
    .filter((source): source is string => Boolean(source))
  const examPeriod = [
    item.exam_year ? `${item.exam_year}년` : null,
    item.exam_month ? `${item.exam_month}월` : null,
  ].filter(Boolean).join(' ')
  const description = item.description?.trim() || item.summary?.trim()
  const materialInfoRows = [
    {
      label: '과목',
      value: item.workspace_subject === 'korean' ? '국어' : '영어',
    },
    {
      label: '학년',
      value: item.grade_level?.trim() || null,
    },
    {
      label: '출처',
      value: sources.length > 0 ? sources.join(' · ') : null,
    },
    {
      label: '자료유형',
      value: item.source_type?.trim() || null,
    },
    {
      label: '문항 수',
      value: item.question_count === null
        ? null
        : item.question_count.toLocaleString('ko-KR'),
    },
    {
      label: '등록일자',
      value: formatRegisteredAt(item.created_at),
    },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value))

  return (
    <StudioDetailPageFrame
      header={(
        <section className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)]">
          <StudioContainer className="py-6">
            <nav
              aria-label="현재 위치"
              className="flex flex-wrap items-center gap-2 text-sm text-[var(--studio-muted)]"
            >
              <Link
                href={`/preview/solvook-concept?subject=${item.workspace_subject}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                홈
              </Link>
              <span aria-hidden="true">/</span>
              <Link
                href={boardHref}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                {category.title}
              </Link>
              <span aria-hidden="true">/</span>
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
            {item.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- public market thumbnails can be remote URLs outside Next image optimization.
              <img
                src={item.thumbnail_url}
                alt={`${item.title} 표지`}
                className="aspect-[3/4] w-full rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] object-cover shadow-[var(--studio-shadow-card)]"
              />
            ) : (
              <div className="flex aspect-[3/4] w-full flex-col items-center justify-center rounded-[var(--studio-radius-card)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] px-4 text-center text-[var(--studio-muted)]">
                <FileText aria-hidden="true" className="size-8" />
                <span className="mt-3 text-sm font-bold">{category.title}</span>
              </div>
            )}
            <MarketMaterialSampleButton
              isLoggedIn={isLoggedIn}
              itemId={item.id}
              samplePageCount={samplePageCount}
              workspaceSubject={item.workspace_subject}
            />
          </div>

          <div className="min-w-0 py-1">
            <div className="flex flex-wrap gap-2">
              {examPeriod ? (
                <Badge className="border-0 bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                  {examPeriod}
                </Badge>
              ) : null}
              {item.source_type ? (
                <Badge
                  variant="outline"
                  className="border-[var(--studio-border)] text-[var(--studio-text)]"
                >
                  {item.source_type}
                </Badge>
              ) : null}
              {item.grade_level ? (
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

            <dl className="mt-6 border-y border-[var(--studio-border)] py-5 text-sm">
              <div className="flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="h-4 w-4 text-[var(--studio-muted)]" />
                <dt className="sr-only">등록일</dt>
                <dd>{formatRegisteredAt(item.created_at)}</dd>
              </div>
            </dl>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
                <span className="block text-xs text-[var(--studio-muted)]">포함 문항</span>
                <strong className="mt-1 block text-lg font-extrabold text-[var(--studio-ink)]">
                  {item.question_count === null ? '정보 없음' : `${item.question_count}개`}
                </strong>
              </div>
              <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
                <span className="block text-xs text-[var(--studio-muted)]">샘플 페이지</span>
                <strong className="mt-1 block text-lg font-extrabold text-[var(--studio-ink)]">
                  {hasSamplePages ? `${samplePageCount}장` : '제공 없음'}
                </strong>
              </div>
              <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
                <span className="block text-xs text-[var(--studio-muted)]">이용가</span>
                <strong className="mt-1 block text-lg font-extrabold text-[var(--studio-ink)]">
                  {startingPrice === null ? '가격 정보 없음' : `${startingPrice.toLocaleString('ko-KR')} 크레딧`}
                </strong>
              </div>
            </div>

            <Button asChild variant="brand" className="mt-5 lg:hidden">
              <a href="#purchase-options">구매 옵션 확인</a>
            </Button>
          </div>
        </section>
      )}
      aside={(
        <div className="sticky top-[144px] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)]">
          <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--studio-primary)]">
            PURCHASE OPTIONS
          </span>
          <h2 className="mt-2 break-keep text-lg font-extrabold text-[var(--studio-ink)]">
            필요한 자료를 선택하세요
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
            {startingPrice === null
              ? '등록된 파일과 구매 옵션을 확인할 수 있습니다.'
              : `${startingPrice.toLocaleString('ko-KR')} 크레딧부터 이용할 수 있습니다.`}
          </p>
          <Button asChild variant="brand" className="mt-5 w-full">
            <a href="#purchase-options">구매·다운로드 확인</a>
          </Button>
        </div>
      )}
      tabs={(
        <div className="space-y-6">
          <section
            aria-labelledby="market-material-information-heading"
            className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 sm:p-8"
          >
            <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--studio-primary)]">
              MATERIAL INFORMATION
            </span>
            <h2
              id="market-material-information-heading"
              className="mt-2 text-2xl font-extrabold text-[var(--studio-ink)]"
            >
              자료 상세 정보
            </h2>
            <dl className="mt-6 grid gap-x-10 gap-y-5 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-5 py-5 text-sm sm:grid-cols-2">
              {materialInfoRows.map((row) => (
                <div key={row.label} className="flex gap-6">
                  <dt className="min-w-[72px] text-[var(--studio-muted)]">{row.label}</dt>
                  <dd className="break-words font-medium text-[var(--studio-text)]">{row.value}</dd>
                </div>
              ))}
            </dl>
            {description ? (
              <div className="mt-4 whitespace-pre-line break-keep rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-5 py-5 text-sm leading-8 text-[var(--studio-muted)]">
                {description}
              </div>
            ) : null}
          </section>

          <section
            id="purchase-options"
            aria-labelledby="market-purchase-options-heading"
            className="scroll-mt-36 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-7"
          >
            <div className="mb-6 flex items-start gap-3">
              <PackageCheck aria-hidden="true" className="mt-1 size-6 text-[var(--studio-primary)]" />
              <div>
                <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--studio-primary)]">
                  PURCHASE & DOWNLOAD
                </span>
                <h2
                  id="market-purchase-options-heading"
                  className="mt-2 text-2xl font-extrabold text-[var(--studio-ink)]"
                >
                  구매 및 다운로드
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
                  실제 등록된 샘플과 파일별 구매·보유 상태를 확인하세요.
                </p>
              </div>
            </div>
            <MarketItemActions
              bundleOption={bundleOption}
              downloadFiles={downloadFiles}
              hasHwp={hasHwp}
              hasLegacySample={hasLegacySample}
              hasPdf={hasPdf}
              hasSamplePages={hasSamplePages}
              hasZip={hasZip}
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
            />
          </section>

          <Link
            href={boardHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] px-4 text-sm font-bold text-[var(--studio-text)] outline-none transition-colors hover:border-[var(--studio-primary)] hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {category.title}로 돌아가기
          </Link>
        </div>
      )}
    />
  )
}
