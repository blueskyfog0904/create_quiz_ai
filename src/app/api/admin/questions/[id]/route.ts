import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

const updateQuestionSchema = z.object({
  question_text: z.string().optional(),
  question_text_forward: z.string().nullable().optional(),
  question_text_backward: z.string().nullable().optional(),
  passage_text: z.string().nullable().optional(),
  answer: z.string().optional(),
  choices: z.union([
    z.array(z.string()),
    z.array(z.object({
      label: z.string(),
      text: z.string()
    })),
    z.array(z.unknown()),
  ]).optional(),
  explanation: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  grade_level: z.string().nullable().optional(),
  problem_type_id: z.string().uuid().nullable().optional(),
  source_type: z.string().nullable().optional(),
  source_1: z.string().nullable().optional(),
  source_2: z.string().nullable().optional(),
  source_3: z.string().nullable().optional(),
  source_4: z.string().nullable().optional(),
  yearId: z.string().uuid('Year is required'),
  bookId: z.string().uuid('Book is required'),
})

async function requireAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }

  return { user }
}

function rpcErrorResponse(error: { message?: string | null, code?: string | null, details?: string | null }) {
  const message = `${error.message || ''} ${error.details || ''}`
  let status = 500

  if (message.includes('AUTH_REQUIRED')) status = 401
  else if (message.includes('ADMIN_REQUIRED')) status = 403
  else if (
    message.includes('INVALID_SCOPE') ||
    message.includes('INVALID_SOURCE') ||
    message.includes('INACTIVE_DIMENSION') ||
    message.includes('BULK_UPLOAD_BATCH_TOO_LARGE')
  ) status = 400
  else if (error.code === '23505' || /duplicate|unique/i.test(message)) status = 409

  return NextResponse.json({ error: error.message || 'Failed to update question' }, { status })
}

function sanitizeQuestionPatch(input: z.infer<typeof updateQuestionSchema>) {
  const patch: Record<string, unknown> = {}

  if (input.question_text !== undefined) patch.question_text = input.question_text
  if (input.question_text_forward !== undefined) patch.question_text_forward = input.question_text_forward
  if (input.question_text_backward !== undefined) patch.question_text_backward = input.question_text_backward
  if (input.passage_text !== undefined) patch.passage_text = input.passage_text
  if (input.answer !== undefined) patch.answer = input.answer
  if (input.choices !== undefined) patch.choices = input.choices
  if (input.explanation !== undefined) patch.explanation = input.explanation
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty
  if (input.grade_level !== undefined) patch.grade_level = input.grade_level
  if (input.problem_type_id !== undefined) patch.problem_type_id = input.problem_type_id
  if (input.source_type !== undefined) patch.source_type = input.source_type
  if (input.source_1 !== undefined) patch.source_1 = input.source_1
  if (input.source_2 !== undefined) patch.source_2 = input.source_2
  if (input.source_3 !== undefined) patch.source_3 = input.source_3
  if (input.source_4 !== undefined) patch.source_4 = input.source_4

  return patch
}

// GET - 문제 상세 조회
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    const { data: question, error } = await supabase
      .from('questions')
      .select(`
        *,
        problem_types (id, type_name),
        profiles:user_id (id, name, email)
      `)
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)
      .single()

    if (error) {
      console.error('[Admin Get Question] Database error:', error)
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    const { data: metadata, error: metadataError } = await supabase
      .from('question_bank_question_metadata')
      .select('year_id, book_id')
      .eq('question_id', id)
      .eq('workspace_subject', workspaceSubject)
      .maybeSingle()

    if (metadataError) {
      console.error('[Admin Get Question] Metadata error:', metadataError)
      return NextResponse.json({ error: 'Failed to fetch question metadata' }, { status: 500 })
    }

    const questionBankMetadata = metadata ? {
      yearId: metadata.year_id,
      bookId: metadata.book_id,
    } : null

    return NextResponse.json({ question, questionBankMetadata }, { status: 200 })
  } catch (error) {
    console.error('[Admin Get Question] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - 문제 삭제
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    const { error: itemsError } = await supabase
      .from('exam_paper_items')
      .delete()
      .eq('question_id', id)
      .eq('workspace_subject', workspaceSubject)

    if (itemsError) {
      console.error('[Admin Delete] Failed to delete dependency (exam_paper_items):', itemsError)
      return NextResponse.json({ error: 'Failed to delete dependencies (exam_paper_items)' }, { status: 500 })
    }

    const supabaseAdmin = createAdminClient()

    const { error: unlinkError } = await supabaseAdmin
      .from('questions')
      .update({ shared_question_id: null })
      .eq('shared_question_id', id)
      .eq('workspace_subject', workspaceSubject)

    if (unlinkError) {
      console.error('[Admin Delete] Failed to unlink shared questions:', unlinkError)
      return NextResponse.json({ error: 'Failed to unlink shared questions' }, { status: 500 })
    }

    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)

    if (error) {
      console.error('[Admin Delete] Database error:', error)
      return NextResponse.json({ error: `Failed to delete question: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('[Admin Delete] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - 문제 수정
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const body = await request.json()
    const validatedData = updateQuestionSchema.parse(body)
    const { yearId, bookId } = validatedData
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const questionPatch = sanitizeQuestionPatch(validatedData)

    const { data: updateResult, error } = await supabase.rpc('update_admin_bank_question', {
      p_question_id: id,
      p_workspace_subject: workspaceSubject,
      p_question_patch: questionPatch,
      p_year_id: yearId,
      p_book_id: bookId,
    })

    if (error) {
      return rpcErrorResponse(error)
    }

    const copiedUpdatedCount = Array.isArray(updateResult)
      ? updateResult[0]?.copied_updated_count ?? 0
      : updateResult?.copied_updated_count ?? 0

    console.info('[Admin Update] update_admin_bank_question copied_updated_count:', copiedUpdatedCount)

    const { data: question, error: fetchError } = await supabase
      .from('questions')
      .select(`
        *,
        problem_types (id, type_name),
        profiles:user_id (id, name, email)
      `)
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)
      .single()

    if (fetchError) {
      console.error('[Admin Update] Fetch updated question error:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch updated question' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      question,
      questionBankMetadata: { yearId, bookId },
      copied_updated_count: copiedUpdatedCount,
    }, { status: 200 })
  } catch (error) {
    console.error('[Admin Update] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues,
      }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
