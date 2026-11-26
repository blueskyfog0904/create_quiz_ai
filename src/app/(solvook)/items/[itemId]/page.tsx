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
import { getCachedCategoryTree } from '@/lib/market-category-tree-cache'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import { getMarketPurchasePolicyView } from '@/lib/market-purchase-policy-server'
import { buildMarketPurchaseInfo } from '@/lib/market-purchase-info'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { getMarketItemDisplay } from '@/lib/market-item-options-server'
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

  // 19번: 상세 안내 문구·자료 정보 항목(DB 상품 표시 설정, 60초 캐시). 상품 상세에서만 읽는다(장바구니·결제 경로는 읽지 않음).
  // 읽지 못하면 null — 설정에 기대는 글(샘플 줄·샘플 버튼·자료 정보·요약·HWP+PDF 기본 안내)만 숨기고 담기·가격·전체구매 선택은 그대로.
  const displayPromise = getMarketItemDisplay().then((display) => display.detail).catch((error) => {
    console.error('[item-detail] 상품 표시 설정 읽기 실패', error instanceof Error ? error.message : error)
    return null
  })

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
    categoryTree,
    purchasePolicy,
    footerContent,
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
    getCachedCategoryTree(),
    // 구매 고지 문구·환불 기간(읽지 못하면 null — 상세 고지 줄은 숨기고 구매 확인창의 구매 버튼은 막힘)
    getMarketPurchasePolicyView(),
    getSiteFooterContent(),
  ])

  if (!item) {
    return redirectToItemSubject(itemId)
  }
  const display = await displayPromise
  if (!display && bundleOption && !bundleOption.label.trim()) {
    console.error('[item-detail] 전체구매 표시명과 기본 제목이 모두 없어 상품 제목을 씀', itemId)
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
      categoryTree={categoryTree[subject]}
      purchasePolicy={purchasePolicy}
      purchaseInfo={buildMarketPurchaseInfo(footerContent)}
      display={display}
    />
  )
}
