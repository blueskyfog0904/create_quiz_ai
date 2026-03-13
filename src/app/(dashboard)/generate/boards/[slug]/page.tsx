import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import TextbookListboard from './textbook-listboard'
import {
  getGenerateBoardBySlug,
  getGenerateBoardFilterOptions,
  searchGenerateBoardPosts,
  type ListboardSearchFilters,
} from '../data'

interface BoardPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
  }>
}

export default async function GenerateBoardPage({ params, searchParams }: BoardPageProps) {
  await requireAuth()
  const { slug } = await params
  const rawFilters = await searchParams
  const filters: ListboardSearchFilters = {
    year: rawFilters.year?.trim() || '',
    month: rawFilters.month?.trim() || '',
    grade: rawFilters.grade?.trim() || '',
    title: rawFilters.title?.trim() || '',
  }

  const board = await getGenerateBoardBySlug(slug)
  if (!board) {
    notFound()
  }

  const [posts, options] = await Promise.all([
    searchGenerateBoardPosts(board.id, filters),
    getGenerateBoardFilterOptions(board.id),
  ])

  return (
    <TextbookListboard
      board={board}
      posts={posts}
      filters={filters}
      options={options}
    />
  )
}
