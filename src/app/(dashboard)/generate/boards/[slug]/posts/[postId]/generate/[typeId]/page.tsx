import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'
import { getGenerateBoardBySlug, getGenerateBoardPost } from '../../../../../data'
import TextbookGenerateClient from './textbook-generate-client'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface TextbookGeneratePageProps {
  params: Promise<{ slug: string; postId: string; typeId: string }>
}

export default async function TextbookGeneratePage({ params }: TextbookGeneratePageProps) {
  await requireAuth()
  const { slug, postId, typeId } = await params
  const board = await getGenerateBoardBySlug(slug)

  if (!board) {
    notFound()
  }

  const post = await getGenerateBoardPost(board.id, postId)
  if (!post) {
    notFound()
  }

  const supabase = await createClient()
  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', typeId)
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
    />
  )
}
