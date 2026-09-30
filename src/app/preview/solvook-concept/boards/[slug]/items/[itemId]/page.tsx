import { notFound } from 'next/navigation'
import { listMarketItemReviewsForItem, type MarketReviewSort } from '@/lib/market-reviews-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import {
  getMarketBundlePublicSummary,
  getPublishedMarketItemById,
  getVisibleMarketMenuEntryBySlugForWorkspace,
  listCompletedMarketPurchasesForItem,
  listMarketItemFiles,
  listMarketSubproductDownloadFilesForUser,
  listMarketSubproductPublicSummaries,
} from '@/lib/market-items-server'
import { countActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialDetail } from '../../../../_components/detail/market-material-detail'
import { listMarketCategoryMenu } from '@/lib/market-categories-server'

interface SolvookMarketItemDetailPageProps {
  params: Promise<{
    slug: string
    itemId: string
  }>
  searchParams: Promise<{
    subject?: string | string[]
    reviewSort?: string | string[]
  }>
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function SolvookMarketItemDetailPage({
  params,
  searchParams,
}: SolvookMarketItemDetailPageProps) {
  // 미들웨어가 getUser() 검증 후 전달한 유저 id 를 재사용해 auth 서버 왕복을 줄인다.
  const [{ slug, itemId }, resolvedSearchParams, userId] = await Promise.all([
    params,
    searchParams,
    getRequestAuthUserId(),
  ])
  const subject = resolveWorkspaceSubject(firstValue(resolvedSearchParams.subject))
  const reviewSortParam = firstValue(resolvedSearchParams.reviewSort)
  const reviewSort: MarketReviewSort = reviewSortParam === 'helpful' ? 'helpful' : 'latest'

  // category/item 조회가 모두 workspace_subject = subject 로 필터되므로,
  // 나머지 조회를 subject 기준으로 함께 병렬 실행해도 결과가 동일하다.
  const [
    category,
    item,
    files,
    samplePageCount,
    subproducts,
    bundleOption,
    downloadFiles,
    purchases,
    reviews,
    menu,
  ] = await Promise.all([
    getVisibleMarketMenuEntryBySlugForWorkspace(slug, subject),
    getPublishedMarketItemById(itemId, subject),
    listMarketItemFiles(itemId, false, subject),
    countActiveMarketItemSamplePages(itemId, subject),
    listMarketSubproductPublicSummaries(itemId, userId ?? undefined, subject),
    getMarketBundlePublicSummary(itemId, userId ?? undefined, subject),
    userId
      ? listMarketSubproductDownloadFilesForUser(userId, itemId, subject)
      : Promise.resolve([]),
    userId
      ? listCompletedMarketPurchasesForItem(userId, itemId, subject)
      : Promise.resolve([]),
    listMarketItemReviewsForItem(itemId, subject, { viewerId: userId, sort: reviewSort }),
    listMarketCategoryMenu(true),
  ])

  if (!category) {
    notFound()
  }

  if (!item || item.menu_entry_id !== category.id) {
    notFound()
  }

  return (
    <MarketMaterialDetail
      bundleOption={bundleOption}
      category={category}
      downloadFiles={downloadFiles}
      files={files}
      isLoggedIn={Boolean(userId)}
      item={item}
      purchases={purchases}
      reviews={reviews}
      reviewSort={reviewSort}
      samplePageCount={samplePageCount}
      subproducts={subproducts}
      categoryTree={menu[subject]}
    />
  )
}
