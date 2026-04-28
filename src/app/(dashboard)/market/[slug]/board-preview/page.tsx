import { notFound } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import {
  getVisibleMarketMenuEntryBySlugForWorkspace,
  getMarketItemFilterOptions,
  listPublishedMarketListboardRows,
  type MarketItemListFilters,
} from '@/lib/market-items-server'
import MarketListboard, { type MarketListboardFilters } from '../market-listboard'
import MarketBoardPreviewClient from '../market-board-preview-client'

interface MarketBoardPreviewPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
    subject?: string
  }>
}

export default async function MarketBoardPreviewPage({ params, searchParams }: MarketBoardPreviewPageProps) {
  const { user } = await getUser()
  const { slug } = await params
  const rawFilters = await searchParams
  const filters: MarketListboardFilters = {
    year: rawFilters.year?.trim() || '',
    month: rawFilters.month?.trim() || '',
    grade: rawFilters.grade?.trim() || '',
    title: rawFilters.title?.trim() || '',
  }

  const workspaceSubject = resolveWorkspaceSubject(rawFilters.subject)
  const category = await getVisibleMarketMenuEntryBySlugForWorkspace(slug, workspaceSubject)
  if (!category) {
    notFound()
  }

  const marketFilters: MarketItemListFilters = {
    search: filters.title || undefined,
    gradeLevel: filters.grade || undefined,
    examYear: filters.year ? Number(filters.year) : undefined,
    examMonth: filters.month ? Number(filters.month) : undefined,
  }

  const [rows, options] = await Promise.all([
    listPublishedMarketListboardRows(category.id, user?.id ?? null, marketFilters),
    getMarketItemFilterOptions(category.id),
  ])

  return (
    <div className="space-y-6">
      <MarketListboard category={category} rows={rows} filters={filters} options={options} isLoggedIn={Boolean(user)} resetHref={`/market/${category.slug}/board-preview`} variant="previewHeaderOnly" />
      <MarketBoardPreviewClient categorySlug={category.slug} rows={rows} isLoggedIn={Boolean(user)} />
    </div>
  )
}
