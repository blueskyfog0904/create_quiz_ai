import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { TablesInsert } from '@/types/supabase'
import { parseStagedGeneratedQuestion } from '@/lib/questions/generated-question-staging'
import { normalizeQuestionTextBackward } from '@/lib/questions/normalize-question-field'
import {
  resolveGenerateWorkspaceSubject,
  type WorkspaceSubject,
} from '@/app/(dashboard)/generate/workspace-subject'

export const dynamic = 'force-dynamic'

const SaveListboardJobItemsSchema = z.object({
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  items: z.array(z.object({
    jobItemId: z.string().uuid(),
    rating: z.number().int().min(0).max(3).optional(),
    tags: z.array(z.string()).optional(),
  })).min(1),
})

interface RouteContext {
  params: Promise<{ jobId: string }>
}

const toDbNull = (value?: string | null) => {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length ? value : null
}

export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
  const { jobId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = SaveListboardJobItemsSchema.safeParse(body)

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
    const normalizedItems = validation.data.items.map((item) => ({
      jobItemId: item.jobItemId,
      rating: item.rating ?? 0,
      tags: Array.from(new Set((item.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    }))
    const jobItemIds = Array.from(new Set(normalizedItems.map((item) => item.jobItemId)))

    const { data: job, error: jobError } = await supabase
      .from('generate_listboard_generation_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .eq('workspace_subject', workspaceSubject)
      .maybeSingle()

    if (jobError || !job) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const { data: existingItems, error: existingItemsError } = await supabase
      .from('generate_listboard_generation_job_items')
      .select('*')
      .eq('job_id', job.id)
      .eq('workspace_subject', workspaceSubject)
      .in('id', jobItemIds)

    if (existingItemsError) {
      throw new Error(existingItemsError.message)
    }

    if ((existingItems ?? []).length !== jobItemIds.length) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_ITEMS', message: '저장할 수 없는 항목이 포함되어 있습니다.' },
      }, { status: 400 })
    }

    const saveCandidates = (existingItems ?? []).filter((item) => (
      item.status === 'completed'
      && item.question_id === null
      && ['unsaved', 'save_failed'].includes(item.save_status)
    ))

    if (saveCandidates.length === 0) {
      return NextResponse.json({
        success: false,
        error: { code: 'NO_SAVEABLE_ITEMS', message: '저장 가능한 생성 결과가 없습니다.' },
      }, { status: 409 })
    }

    const postItemIds = Array.from(new Set(saveCandidates.map((item) => item.post_item_id)))
    const problemTypeIds = Array.from(new Set(saveCandidates.map((item) => item.problem_type_id)))

    const [{ data: postItems, error: postItemsError }, { data: problemTypes, error: problemTypesError }] = await Promise.all([
      supabase
        .from('generate_listboard_post_items')
        .select('id, passage_text')
        .eq('workspace_subject', workspaceSubject)
        .in('id', postItemIds),
      supabase
        .from('problem_types')
        .select('id')
        .eq('workspace_subject', workspaceSubject)
        .in('id', problemTypeIds),
    ])

    if (postItemsError || problemTypesError) {
      throw new Error(postItemsError?.message || problemTypesError?.message || '저장 준비에 실패했습니다.')
    }

    const postItemMap = new Map((postItems ?? []).map((item) => [item.id, item]))
    const problemTypeSet = new Set((problemTypes ?? []).map((item) => item.id))

    let savedCount = 0
    let failedCount = 0
    const savedQuestionIds: string[] = []

    const metadataMap = new Map(normalizedItems.map((item) => [item.jobItemId, item]))

    for (const item of saveCandidates) {
      const { data: lockedRows, error: lockError } = await adminSupabase
        .from('generate_listboard_generation_job_items')
        .update({
          save_status: 'saving',
          save_error_message: null,
        })
        .eq('id', item.id)
        .eq('job_id', job.id)
        .eq('workspace_subject', workspaceSubject)
        .eq('status', 'completed')
        .is('question_id', null)
        .in('save_status', ['unsaved', 'save_failed'])
        .select('*')

      if (lockError) {
        throw new Error(lockError.message)
      }

      const lockedItem = lockedRows?.[0]
      if (!lockedItem) {
        continue
      }

      try {
        const stagedQuestion = parseStagedGeneratedQuestion(lockedItem.generated_question)
        const postItem = postItemMap.get(lockedItem.post_item_id)
        const metadata = metadataMap.get(lockedItem.id)

        if (!stagedQuestion || !postItem || !problemTypeSet.has(lockedItem.problem_type_id)) {
          throw new Error('저장에 필요한 생성 결과 또는 참조 데이터를 찾지 못했습니다.')
        }

        const questionPayload: TablesInsert<'questions'> & {
          workspace_subject: WorkspaceSubject
        } = {
          user_id: user.id,
          workspace_subject: workspaceSubject,
          question_text: stagedQuestion.questionText,
          question_text_forward: toDbNull(stagedQuestion.questionTextForward),
          question_text_backward: toDbNull(normalizeQuestionTextBackward(stagedQuestion.questionTextBackward)),
          choices: stagedQuestion.choices,
          answer: stagedQuestion.answer,
          explanation: toDbNull(stagedQuestion.explanation),
          passage_text: toDbNull(stagedQuestion.passageText) || postItem.passage_text,
          grade_level: job.grade_level,
          difficulty: job.difficulty,
          problem_type_id: lockedItem.problem_type_id,
          raw_ai_response: lockedItem.raw_ai_response,
          source: 'ai_generated',
          shared_question_id: null,
          tags: metadata?.tags ?? [],
          rating: metadata?.rating ?? 0,
          generate_listboard_post_id: job.post_id,
          generate_listboard_post_item_id: lockedItem.post_item_id,
          generate_generation_job_item_id: lockedItem.id,
        }

        const { data: savedQuestion, error: questionError } = await adminSupabase
          .from('questions')
          .insert(questionPayload)
          .select('id')
          .single()

        if (questionError || !savedQuestion) {
          throw new Error(questionError?.message || '문제 저장에 실패했습니다.')
        }

        await adminSupabase
          .from('generate_listboard_generation_job_items')
          .update({
            question_id: savedQuestion.id,
            save_status: 'saved',
            saved_at: new Date().toISOString(),
            save_error_message: null,
          })
          .eq('id', lockedItem.id)
          .eq('workspace_subject', workspaceSubject)

        savedCount += 1
        savedQuestionIds.push(savedQuestion.id)
      } catch (error) {
        failedCount += 1
        await adminSupabase
          .from('generate_listboard_generation_job_items')
          .update({
            save_status: 'save_failed',
            save_error_message: error instanceof Error ? error.message : '문제 저장 중 오류가 발생했습니다.',
          })
          .eq('id', lockedItem.id)
          .eq('workspace_subject', workspaceSubject)
      }
    }

    revalidatePath('/generate/boards/[slug]/posts/[postId]/jobs/[jobId]', 'page')
    revalidatePath('/library/purchased', 'page')

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        savedCount,
        failedCount,
        savedQuestionIds,
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '선택 저장 중 오류가 발생했습니다.',
      },
    }, { status: 500 })
  }
}
