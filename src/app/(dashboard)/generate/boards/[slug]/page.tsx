import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import TextbookListboard from './textbook-listboard'
import {
  getGenerateBoardBySlug,
  getGenerateBoardFilterOptions,
  searchGenerateBoardPosts,
  type ListboardSearchFilters,
} from '../data'
import { resolveGenerateWorkspaceSubject } from '../../workspace-subject'

interface BoardPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
    subject?: string
  }>
}

export default async function GenerateBoardPage({ params, searchParams }: BoardPageProps) {
  await requireAuth()
  const { slug } = await params
  const rawFilters = await searchParams
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: rawFilters.subject,
  })
  const filters: ListboardSearchFilters = {
    year: rawFilters.year?.trim() || '',
    month: rawFilters.month?.trim() || '',
    grade: rawFilters.grade?.trim() || '',
    title: rawFilters.title?.trim() || '',
  }

  const board = await getGenerateBoardBySlug(slug, workspaceSubject)
  if (!board) {
    notFound()
  }

  const [posts, options] = await Promise.all([
    searchGenerateBoardPosts(board.id, filters, workspaceSubject),
    getGenerateBoardFilterOptions(board.id, workspaceSubject),
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
