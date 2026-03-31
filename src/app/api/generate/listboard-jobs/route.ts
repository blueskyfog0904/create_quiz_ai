import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { TablesInsert } from '@/types/supabase'
import {
  resolveGenerateWorkspaceSubject,
  type WorkspaceSubject,
} from '@/app/(dashboard)/generate/workspace-subject'

export const dynamic = 'force-dynamic'

const COST_PER_GENERATION = 100

const CreateListboardJobSchema = z.object({
  postId: z.string().uuid(),
  postItemIds: z.array(z.string().uuid()).min(1),
  problemTypeIds: z.array(z.string().uuid()).min(1),
  gradeLevel: z.string().min(1),
  difficulty: z.string().min(1),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
})

const unique = (values: string[]) => Array.from(new Set(values))

export async function POST(request: Request) {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = CreateListboardJobSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: validation.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const workspaceSubject = resolveGenerateWorkspaceSubject({
      workspaceSubject: validation.data.workspaceSubject,
      referer: request.headers.get('referer'),
    })
    const postItemIds = unique(validation.data.postItemIds)
    const problemTypeIds = unique(validation.data.problemTypeIds)

    const { data: post, error: postError } = await supabase
      .from('generate_listboard_posts')
      .select('id, title, grade_level')
      .eq('id', validation.data.postId)
      .eq('workspace_subject', workspaceSubject)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (postError || !post) {
      return NextResponse.json({
        success: false,
        error: { code: 'NOT_FOUND', message: '게시글을 찾을 수 없습니다.' },
      }, { status: 404 })
    }

    const { data: postItems, error: itemsError } = await supabase
      .from('generate_listboard_post_items')
      .select('id, question_number, passage_text')
      .eq('post_id', post.id)
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('id', postItemIds)

    if (itemsError) {
      throw new Error(itemsError.message)
    }

    if ((postItems ?? []).length !== postItemIds.length) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_ITEMS', message: '선택한 문항 중 사용할 수 없는 항목이 있습니다.' },
      }, { status: 400 })
    }

    const { data: problemTypes, error: problemTypesError } = await supabase
      .from('problem_types')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .neq('model_name', 'admin')
      .in('id', problemTypeIds)

    if (problemTypesError) {
      throw new Error(problemTypesError.message)
    }

    if ((problemTypes ?? []).length !== problemTypeIds.length) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_TYPES', message: '선택한 문제 유형 중 사용할 수 없는 항목이 있습니다.' },
      }, { status: 400 })
    }

    const requestedItemCount = postItemIds.length
    const requestedTypeCount = problemTypeIds.length
    const requestedGenerationCount = requestedItemCount * requestedTypeCount
    const requiredCredits = requestedGenerationCount * COST_PER_GENERATION

    const jobPayload: TablesInsert<'generate_listboard_generation_jobs'> & {
      workspace_subject: WorkspaceSubject
    } = {
      post_id: post.id,
      user_id: user.id,
      workspace_subject: workspaceSubject,
      status: 'queued',
      selected_problem_type_ids: problemTypeIds,
      requested_item_count: requestedItemCount,
      requested_type_count: requestedTypeCount,
      requested_generation_count: requestedGenerationCount,
      completed_count: 0,
      failed_count: 0,
      cancelled_count: 0,
      credit_reserved: requiredCredits,
      credit_charged: 0,
    }

    const { data: job, error: jobError } = await adminSupabase
      .from('generate_listboard_generation_jobs')
      .insert(jobPayload)
      .select('*')
      .single()

    if (jobError || !job) {
      throw new Error(jobError?.message || '배치 생성 작업 생성에 실패했습니다.')
    }

    const jobItemsPayload: Array<
      TablesInsert<'generate_listboard_generation_job_items'> & {
        workspace_subject: WorkspaceSubject
      }
    > = postItemIds.flatMap((postItemId) => (
      problemTypeIds.map((problemTypeId) => ({
        job_id: job.id,
        post_id: post.id,
        post_item_id: postItemId,
        problem_type_id: problemTypeId,
        workspace_subject: workspaceSubject,
        status: 'queued',
        credit_charged: 0,
        attempt_count: 0,
      }))
    ))

    const { data: jobItems, error: jobItemsError } = await adminSupabase
      .from('generate_listboard_generation_job_items')
      .insert(jobItemsPayload)
      .select('*')

    if (jobItemsError || !jobItems) {
      await adminSupabase
        .from('generate_listboard_generation_jobs')
        .delete()
        .eq('id', job.id)

      throw new Error(jobItemsError?.message || '작업 항목 생성에 실패했습니다.')
    }

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        requestedGenerationCount,
        requiredCredits,
        postTitle: post.title,
        status: 'queued',
        gradeLevel: validation.data.gradeLevel || post.grade_level || '1학년',
        difficulty: validation.data.difficulty,
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '배치 생성 작업 생성 중 오류가 발생했습니다.',
      },
    }, { status: 500 })
  }
}
