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
    sourceType?: string
    source1?: string
    source2?: string
    source3?: string
    source4?: string
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
    sourceType: rawFilters.sourceType?.normalize('NFC').trim() || '',
    source1: rawFilters.source1?.normalize('NFC').trim() || '',
    source2: rawFilters.source2?.normalize('NFC').trim() || '',
    source3: rawFilters.source3?.normalize('NFC').trim() || '',
    source4: rawFilters.source4?.normalize('NFC').trim() || '',
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
    sourceType: filters.sourceType || undefined,
    source1: filters.source1 || undefined,
    source2: filters.source2 || undefined,
    source3: filters.source3 || undefined,
    source4: filters.source4 || undefined,
  }

  const [rows, options] = await Promise.all([
    listPublishedMarketListboardRows(category.id, user?.id ?? null, marketFilters),
    getMarketItemFilterOptions(category.id),
  ])

  return <MarketListboard category={category} rows={rows} filters={filters} options={options} isLoggedIn={Boolean(user)} />
}
