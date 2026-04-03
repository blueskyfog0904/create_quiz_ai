import { notFound } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { Database } from '@/types/supabase'
import { getGenerateBoardBySlug, getGenerateBoardPost } from '../../../../../data'
import TextbookGenerateClient from './textbook-generate-client'
import {
  resolveGenerateWorkspaceSubject,
  type WorkspaceScoped,
} from '../../../../../../workspace-subject'

type ProblemType = WorkspaceScoped<Database['public']['Tables']['problem_types']['Row']>

interface TextbookGeneratePageProps {
  params: Promise<{ slug: string; postId: string; typeId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function TextbookGeneratePage({ params, searchParams }: TextbookGeneratePageProps) {
  const { user } = await getUser()
  const { slug, postId, typeId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: resolvedSearchParams?.subject,
  })
  const board = await getGenerateBoardBySlug(slug, workspaceSubject)

  if (!board) {
    notFound()
  }

  const post = await getGenerateBoardPost(board.id, postId, workspaceSubject)
  if (!post) {
    notFound()
  }

  const supabase = createAdminClient()
  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', typeId)
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .single<ProblemType>()

  if (error || !problemType) {
    notFound()
  }

  return (
    <TextbookGenerateClient
      board={board}
      post={post}
      problemType={problemType}
      workspaceSubject={workspaceSubject}
      isLoggedIn={Boolean(user)}
    />
  )
}
