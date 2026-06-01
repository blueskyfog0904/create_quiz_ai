import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getGenerateBoardBySlug, getGenerateBoardPost } from '../../../../../data'
import JobStatusClient from './job-status-client'
import {
  resolveGenerateWorkspaceSubject,
  type WorkspaceScoped,
} from '../../../../../../workspace-subject'
import type { Database } from '@/types/supabase'

type GenerateListboardGenerationJob = WorkspaceScoped<Database['public']['Tables']['generate_listboard_generation_jobs']['Row']>
type GenerateListboardGenerationJobItem = WorkspaceScoped<Database['public']['Tables']['generate_listboard_generation_job_items']['Row']>

interface GenerateBoardJobPageProps {
  params: Promise<{ slug: string; postId: string; jobId: string }>
  searchParams: Promise<{ subject?: string }>
}

export default async function GenerateBoardJobPage({ params, searchParams }: GenerateBoardJobPageProps) {
  const user = await requireAuth()
  const { slug, postId, jobId } = await params
  const resolvedSearchParams = await searchParams
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: resolvedSearchParams.subject,
  })

  const board = await getGenerateBoardBySlug(slug, workspaceSubject)
  if (!board) {
    notFound()
  }

  const post = await getGenerateBoardPost(board.id, postId, workspaceSubject)
  if (!post) {
    notFound()
  }

  const supabase = await createClient()
  const { data: jobData, error: jobError } = await supabase
    .from('generate_listboard_generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('post_id', post.id)
    .eq('user_id', user.id)
    .eq('workspace_subject', workspaceSubject)
    .maybeSingle()

  if (jobError || !jobData) {
    notFound()
  }
  const job = jobData as GenerateListboardGenerationJob

  const { data: jobItemsData, error: jobItemsError } = await supabase
    .from('generate_listboard_generation_job_items')
    .select('*')
    .eq('job_id', job.id)
    .eq('workspace_subject', workspaceSubject)
    .order('created_at')

  if (jobItemsError) {
    throw new Error(jobItemsError.message)
  }
  const jobItems = (jobItemsData ?? []) as GenerateListboardGenerationJobItem[]

  const postItemIds = Array.from(new Set(jobItems.map((item) => item.post_item_id)))
  const problemTypeIds = Array.from(new Set(jobItems.map((item) => item.problem_type_id)))

  const [{ data: postItems }, { data: problemTypes }] = await Promise.all([
    postItemIds.length > 0
      ? supabase
        .from('generate_listboard_post_items')
        .select('id, question_number')
        .eq('workspace_subject', workspaceSubject)
        .in('id', postItemIds)
      : Promise.resolve({ data: [] as Array<{ id: string; question_number: string }> }),
    problemTypeIds.length > 0
      ? supabase
        .from('problem_types')
        .select('id, type_name')
        .eq('workspace_subject', workspaceSubject)
        .in('id', problemTypeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; type_name: string }> }),
  ])

  const postItemMap = new Map((postItems ?? []).map((item) => [item.id, item.question_number]))
  const problemTypeMap = new Map((problemTypes ?? []).map((type) => [type.id, type.type_name]))

  return (
    <JobStatusClient
      board={board}
      post={post}
      initialJob={job}
      initialItems={jobItems.map((item) => ({
        ...item,
        question_number: postItemMap.get(item.post_item_id) ?? '-',
        problem_type_name: problemTypeMap.get(item.problem_type_id) ?? '-',
      }))}
      workspaceSubject={workspaceSubject}
    />
  )
}
