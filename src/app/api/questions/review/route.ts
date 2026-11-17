import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { QuestionSchema } from '@/lib/ai/types'
import { buildQuestionGenerationConfigFromProblemType, reviewGeneratedQuestion } from '@/lib/ai/question-generation-workflow'
import { getProblemTypeDefaultPrompts } from '@/lib/ai/problem-type-default-prompts'
import { resolveGenerateWorkspaceSubject } from '@/app/(dashboard)/generate/workspace-subject'

export const dynamic = 'force-dynamic'

const ReviewRequestSchema = z.object({
  problemTypeId: z.string().uuid(),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  passage: z.string().max(3500).optional(),
  generatedQuestion: QuestionSchema,
  rawGenerationResponse: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  // 꺼 둔 기능(AI 문제 생성)의 관리자용 검수 API다. 다시 켜더라도 대표 관리자만 쓴다.
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return NextResponse.json({ success: false, error: { code: guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR', message: adminApiGuardMessage(guard) } }, { status: guard.status })
  }

  const body = await request.json().catch(() => null)
  const validation = ReviewRequestSchema.safeParse(body)

  if (!validation.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: validation.error.issues[0]?.message || '입력이 올바르지 않습니다.' } }, { status: 400 })
  }

  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: validation.data.workspaceSubject,
    referer: request.headers.get('referer'),
  })

  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', validation.data.problemTypeId)
    .eq('workspace_subject', workspaceSubject)
    .single()

  if (error || !problemType) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제 유형을 찾을 수 없습니다.' } }, { status: 404 })
  }

  const defaultPrompts = await getProblemTypeDefaultPrompts(supabase, workspaceSubject)
  const generationConfig = buildQuestionGenerationConfigFromProblemType(problemType, { defaultPrompts })
  if (!generationConfig.modelConfig) {
    return NextResponse.json({
      success: false,
      error: {
        code: generationConfig.error?.code || 'REVIEW_MODEL_NOT_CONFIGURED',
        message: generationConfig.error?.message || '문제 검토 API 제공자와 모델을 먼저 설정해주세요.',
      },
    }, { status: 409 })
  }

  const result = await reviewGeneratedQuestion({
    promptBundle: generationConfig.promptBundle,
    passage: validation.data.passage || '',
    workspaceSubject,
    generatedQuestion: validation.data.generatedQuestion,
    provider: generationConfig.modelConfig.reviewProvider,
    modelName: generationConfig.modelConfig.reviewModelName,
    signal: request.signal,
  })

  if (!result.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'REVIEW_FAILED', message: result.error },
      rawReviewResponse: result.rawReviewResponse,
      renderedReviewPrompt: result.renderedReviewPrompt,
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    ...result.review,
    rawReviewResponse: result.rawReviewResponse,
    renderedReviewPrompt: result.renderedReviewPrompt,
  })
}
