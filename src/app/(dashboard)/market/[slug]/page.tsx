import { notFound } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import {
  getVisibleMarketMenuEntryBySlugForWorkspace,
  getMarketItemFilterOptions,
  listPublishedMarketListboardRows,
  type MarketItemListFilters,
} from '@/lib/market-items-server'
import MarketListboard, { type MarketListboardFilters } from './market-listboard'

interface MarketCategoryPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
    subject?: string
  }>
}

export default async function MarketCategoryPage({ params, searchParams }: MarketCategoryPageProps) {
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

  return <MarketListboard category={category} rows={rows} filters={filters} options={options} isLoggedIn={Boolean(user)} />
}
