import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getGenerateBoardBySlug, getGenerateBoardPost } from '../../../../../data'
import JobStatusClient from './job-status-client'

interface GenerateBoardJobPageProps {
  params: Promise<{ slug: string; postId: string; jobId: string }>
}

export default async function GenerateBoardJobPage({ params }: GenerateBoardJobPageProps) {
  await requireAuth()
  const { slug, postId, jobId } = await params

  const board = await getGenerateBoardBySlug(slug)
  if (!board) {
    notFound()
  }

  const post = await getGenerateBoardPost(board.id, postId)
  if (!post) {
    notFound()
  }

  const supabase = await createClient()
  const { data: job, error: jobError } = await supabase
    .from('generate_listboard_generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('post_id', post.id)
    .maybeSingle()

  if (jobError || !job) {
    notFound()
  }

  const { data: jobItems, error: jobItemsError } = await supabase
    .from('generate_listboard_generation_job_items')
    .select('*')
    .eq('job_id', job.id)
    .order('created_at')

  if (jobItemsError) {
    throw new Error(jobItemsError.message)
  }

  const postItemIds = Array.from(new Set((jobItems ?? []).map((item) => item.post_item_id)))
  const problemTypeIds = Array.from(new Set((jobItems ?? []).map((item) => item.problem_type_id)))

  const [{ data: postItems }, { data: problemTypes }] = await Promise.all([
    postItemIds.length > 0
      ? supabase.from('generate_listboard_post_items').select('id, question_number').in('id', postItemIds)
      : Promise.resolve({ data: [] as Array<{ id: string; question_number: string }> }),
    problemTypeIds.length > 0
      ? supabase.from('problem_types').select('id, type_name').in('id', problemTypeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; type_name: string }> }),
  ])

  const postItemMap = new Map((postItems ?? []).map((item) => [item.id, item.question_number]))
  const problemTypeMap = new Map((problemTypes ?? []).map((type) => [type.id, type.type_name]))

  return (
    <JobStatusClient
      board={board}
      post={post}
      initialJob={job}
      initialItems={(jobItems ?? []).map((item) => ({
        ...item,
        question_number: postItemMap.get(item.post_item_id) ?? '-',
        problem_type_name: problemTypeMap.get(item.problem_type_id) ?? '-',
      }))}
    />
  )
}
