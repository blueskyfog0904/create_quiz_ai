import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'
import { getGenerateBoardBySlug, getGenerateBoardPost } from '../../../../../data'
import TextbookGenerateClient from './textbook-generate-client'
import {
  DEFAULT_GENERATE_WORKSPACE_SUBJECT,
  type WorkspaceScoped,
} from '../../../../../../workspace-subject'

type ProblemType = WorkspaceScoped<Database['public']['Tables']['problem_types']['Row']>

interface TextbookGeneratePageProps {
  params: Promise<{ slug: string; postId: string; typeId: string }>
}

export default async function TextbookGeneratePage({ params }: TextbookGeneratePageProps) {
  await requireAuth()
  const { slug, postId, typeId } = await params
  const workspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
  const board = await getGenerateBoardBySlug(slug, workspaceSubject)

  if (!board) {
    notFound()
  }

  const post = await getGenerateBoardPost(board.id, postId, workspaceSubject)
  if (!post) {
    notFound()
  }

  const supabase = await createClient()
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
    />
  )
}
