import { notFound, redirect } from 'next/navigation'
import { listMarketItemReviewsForItem, type MarketReviewSort } from '@/lib/market-reviews-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import {
  getMarketBundlePublicSummary,
  getPublishedMarketItemById,
  listCompletedMarketPurchasesForItem,
  listMarketItemFiles,
  listMarketSubproductDownloadFilesForUser,
  listMarketSubproductPublicSummaries,
} from '@/lib/market-items-server'
import { countActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import { getCachedCategoryMenu } from '@/lib/market-category-tree-cache'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialDetail } from '@/app/preview/solvook-concept/_components/detail/market-material-detail'

interface MarketItemDetailPageProps {
  params: Promise<{
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

// 주소의 과목이 없거나 상품 과목과 다르면 상품의 실제 과목 주소로 보낸다. 공개 상품이 아니면 404.
async function redirectToItemSubject(itemId: string): Promise<never> {
  const item = await getPublishedMarketItemById(itemId)
  if (!item) {
    notFound()
  }
  redirect(`/items/${itemId}?subject=${item.workspace_subject}`)
}

export default async function MarketItemDetailPage({
  params,
  searchParams,
}: MarketItemDetailPageProps) {
  // 미들웨어가 getUser() 검증 후 전달한 유저 id 를 재사용해 auth 서버 왕복을 줄인다.
  const [{ itemId }, resolvedSearchParams, userId] = await Promise.all([
    params,
    searchParams,
    getRequestAuthUserId(),
  ])
  const subjectParam = firstValue(resolvedSearchParams.subject)
  if (!isWorkspaceSubject(subjectParam)) {
    return redirectToItemSubject(itemId)
  }
  const subject = subjectParam
  const reviewSortParam = firstValue(resolvedSearchParams.reviewSort)
  const reviewSort: MarketReviewSort = reviewSortParam === 'helpful' ? 'helpful' : 'latest'

  // item 조회가 workspace_subject = subject 로 필터되므로,
  // 나머지 조회를 subject 기준으로 함께 병렬 실행해도 결과가 동일하다.
  const [
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
    getCachedCategoryMenu(),
  ])

  if (!item) {
    return redirectToItemSubject(itemId)
  }

  return (
    <MarketMaterialDetail
      bundleOption={bundleOption}
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
