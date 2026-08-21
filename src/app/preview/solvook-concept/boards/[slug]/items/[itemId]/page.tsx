import { notFound } from 'next/navigation'
import { getUser } from '@/lib/auth'
import {
  getMarketBundlePublicSummary,
  getPublishedMarketItemById,
  getVisibleMarketMenuEntryBySlugForWorkspace,
  listCompletedMarketPurchasesForItem,
  listMarketItemFiles,
  listMarketSubproductDownloadFilesForUser,
  listMarketSubproductPublicSummaries,
} from '@/lib/market-items-server'
import { listActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialDetail } from '../../../../_components/detail/market-material-detail'

interface SolvookMarketItemDetailPageProps {
  params: Promise<{
    slug: string
    itemId: string
  }>
  searchParams: Promise<{
    subject?: string | string[]
  }>
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function SolvookMarketItemDetailPage({
  params,
  searchParams,
}: SolvookMarketItemDetailPageProps) {
  const [{ slug, itemId }, resolvedSearchParams, { user }] = await Promise.all([
    params,
    searchParams,
    getUser(),
  ])
  const subject = resolveWorkspaceSubject(firstValue(resolvedSearchParams.subject))
  const category = await getVisibleMarketMenuEntryBySlugForWorkspace(slug, subject)

  if (!category) {
    notFound()
  }

  const item = await getPublishedMarketItemById(itemId, category.workspace_subject)

  if (!item || item.menu_entry_id !== category.id) {
    notFound()
  }

  const [
    files,
    samplePages,
    subproducts,
    bundleOption,
    downloadFiles,
    purchases,
  ] = await Promise.all([
    listMarketItemFiles(item.id, false, item.workspace_subject),
    listActiveMarketItemSamplePages(item.id, item.workspace_subject),
    listMarketSubproductPublicSummaries(item.id, user?.id, item.workspace_subject),
    getMarketBundlePublicSummary(item.id, user?.id, item.workspace_subject),
    user
      ? listMarketSubproductDownloadFilesForUser(user.id, item.id, item.workspace_subject)
      : Promise.resolve([]),
    user
      ? listCompletedMarketPurchasesForItem(user.id, item.id, item.workspace_subject)
      : Promise.resolve([]),
  ])

  return (
    <MarketMaterialDetail
      bundleOption={bundleOption}
      category={category}
      downloadFiles={downloadFiles}
      files={files}
      isLoggedIn={Boolean(user)}
      item={item}
      purchases={purchases}
      samplePageCount={samplePages.length}
      subproducts={subproducts}
    />
  )
}
