import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { getVisibleMarketMenuEntryBySlug } from '@/lib/market-menu-server'
import { getMarketItemFilterOptions, listPublishedMarketItems, type MarketItemListFilters } from '@/lib/market-items-server'
import MarketListboard, { type MarketListboardFilters } from './market-listboard'

interface MarketCategoryPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
  }>
}

export default async function MarketCategoryPage({ params, searchParams }: MarketCategoryPageProps) {
  await requireAuth()
  const { slug } = await params
  const rawFilters = await searchParams
  const filters: MarketListboardFilters = {
    year: rawFilters.year?.trim() || '',
    month: rawFilters.month?.trim() || '',
    grade: rawFilters.grade?.trim() || '',
    title: rawFilters.title?.trim() || '',
  }

  const category = await getVisibleMarketMenuEntryBySlug(slug)
  if (!category) {
    notFound()
  }

  const marketFilters: MarketItemListFilters = {
    search: filters.title || undefined,
    gradeLevel: filters.grade || undefined,
    examYear: filters.year ? Number(filters.year) : undefined,
    examMonth: filters.month ? Number(filters.month) : undefined,
  }

  const [items, options] = await Promise.all([
    listPublishedMarketItems(category.id, marketFilters),
    getMarketItemFilterOptions(category.id),
  ])

  return <MarketListboard category={category} items={items} filters={filters} options={options} />
}
