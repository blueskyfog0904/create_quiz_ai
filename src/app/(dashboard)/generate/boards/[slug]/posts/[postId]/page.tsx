import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { getActiveProblemTypes, getGenerateBoardBySlug, getGenerateBoardPostWithItems } from '../../../data'
import BoardPostClient from './board-post-client'
import { resolveGenerateWorkspaceSubject } from '../../../../workspace-subject'

interface BoardPostPageProps {
  params: Promise<{ slug: string; postId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function GenerateBoardPostPage({ params, searchParams }: BoardPostPageProps) {
  await requireAuth()
  const { slug, postId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: resolvedSearchParams?.subject,
  })

  const board = await getGenerateBoardBySlug(slug, workspaceSubject)
  if (!board) {
    notFound()
  }

  const [postResult, problemTypes] = await Promise.all([
    getGenerateBoardPostWithItems(board.id, postId, workspaceSubject),
    getActiveProblemTypes(workspaceSubject),
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
      workspaceSubject={workspaceSubject}
    />
  )
}
