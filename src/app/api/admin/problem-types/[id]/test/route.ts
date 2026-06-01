import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { AIProvider } from '@/lib/ai/types'
import {
  MAX_ADMIN_REVIEW_ATTEMPTS,
  buildPromptBundleFromProblemType,
  runQuestionGenerationReviewLoop,
} from '@/lib/ai/question-generation-workflow'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

export const dynamic = 'force-dynamic'

const TestRequestSchema = z.object({
  passage: z.string().min(1).max(3500),
  passageId: z.string().uuid().optional(),
  gradeLevel: z.string().min(1),
  difficulty: z.string().min(1),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  maxAttempts: z.number().int().min(1).max(MAX_ADMIN_REVIEW_ATTEMPTS).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const validation = TestRequestSchema.safeParse(body)

  if (!validation.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: validation.error.issues[0]?.message || '입력이 올바르지 않습니다.' } }, { status: 400 })
  }

  const workspaceSubject = resolveAdminWorkspaceSubject(validation.data.workspaceSubject)
  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)
    .single()

  if (error || !problemType) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제 유형을 찾을 수 없습니다.' } }, { status: 404 })
  }

  const loopResult = await runQuestionGenerationReviewLoop({
    passage: validation.data.passage,
    gradeLevel: validation.data.gradeLevel,
    difficulty: validation.data.difficulty,
    workspaceSubject,
    promptBundle: buildPromptBundleFromProblemType(problemType),
    provider: problemType.provider as AIProvider,
    modelName: problemType.model_name,
    maxAttempts: validation.data.maxAttempts,
    includeTrace: true,
    traceMode: 'admin_full',
    signal: request.signal,
  })

  return NextResponse.json({
    success: loopResult.status === 'passed',
    status: loopResult.status,
    finalQuestion: loopResult.finalQuestion,
    lastQuestion: loopResult.lastQuestion,
    finalReview: loopResult.finalReview,
    attempts: loopResult.attempts,
    stopReason: loopResult.stopReason,
  })
}
