import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { getActiveProblemTypes, getGenerateBoardBySlug, getGenerateBoardPostWithItems } from '../../../data'
import BoardPostClient from './board-post-client'

interface BoardPostPageProps {
  params: Promise<{ slug: string; postId: string }>
}

export default async function GenerateBoardPostPage({ params }: BoardPostPageProps) {
  await requireAuth()
  const { slug, postId } = await params

  const board = await getGenerateBoardBySlug(slug)
  if (!board) {
    notFound()
  }

  const [postResult, problemTypes] = await Promise.all([
    getGenerateBoardPostWithItems(board.id, postId),
    getActiveProblemTypes(),
  ])

  if (!postResult) {
    notFound()
  }

  return (
    <BoardPostClient
      board={board}
      post={postResult.post}
      items={postResult.items}
      problemTypes={problemTypes}
    />
  )
}
