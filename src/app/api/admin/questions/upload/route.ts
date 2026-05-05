import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

function removeHtmlTags(text: string | null | undefined): string | null {
  if (!text) return null
  if (typeof text !== 'string') return String(text)

  return text.replace(/<br\s*\/?>/gi, '').trim() || null
}

type ChoiceLike = string | { text?: string } | Record<string, unknown>

function cleanChoices(choices: unknown): ChoiceLike[] {
  if (!Array.isArray(choices)) return []

  return choices.map((choice) => {
    if (typeof choice === 'string') {
      return removeHtmlTags(choice) || ''
    }

    if (choice && typeof choice === 'object') {
      const nextChoice = { ...choice } as Record<string, unknown>
      if ('text' in nextChoice) {
        nextChoice.text = removeHtmlTags(typeof nextChoice.text === 'string' ? nextChoice.text : undefined) || ''
      }
      return nextChoice
    }

    return choice as ChoiceLike
  })
}

const questionSchema = z.object({
  question_text: z.string().min(1, 'Question text is required'),
  question_text_forward: z.string().optional().nullable(),
  question_text_backward: z.string().optional().nullable(),
  passage_text: z.string().optional().nullable(),
  answer: z.string().min(1, 'Answer is required'),
  choices: z.array(z.unknown()).optional(),
  explanation: z.string().optional().nullable(),
  difficulty: z.string().optional().nullable(),
  grade_level: z.string().optional().nullable(),
  problem_type_id: z.string().uuid('Invalid problem type ID'),
  source_type: z.string().optional().nullable(),
  source_1: z.string().optional().nullable(),
  source_2: z.string().optional().nullable(),
  source_3: z.string().optional().nullable(),
  source_4: z.string().optional().nullable(),
}).passthrough()

const singleUploadSchema = questionSchema.extend({
  yearId: z.string().uuid('Year is required'),
  bookId: z.string().uuid('Book is required'),
})

const bulkUploadSchema = z.object({
  questions: z.array(z.object({
    question: questionSchema,
    yearId: z.string().uuid('Year is required'),
    bookId: z.string().uuid('Book is required'),
    clientRowId: z.string().optional(),
  })).min(1, 'Questions are required'),
})

function sanitizeQuestionPayload(input: Record<string, unknown>) {
  const sanitized = { ...input }
  delete sanitized.user_id
  delete sanitized.userId
  delete sanitized.workspace_subject
  delete sanitized.source
  delete sanitized.shared_question_id

  return {
    question_text: removeHtmlTags(typeof sanitized.question_text === 'string' ? sanitized.question_text : '') || '',
    question_text_forward: removeHtmlTags(typeof sanitized.question_text_forward === 'string' ? sanitized.question_text_forward : undefined),
    question_text_backward: removeHtmlTags(typeof sanitized.question_text_backward === 'string' ? sanitized.question_text_backward : undefined),
    passage_text: removeHtmlTags(typeof sanitized.passage_text === 'string' ? sanitized.passage_text : undefined),
    answer: removeHtmlTags(typeof sanitized.answer === 'string' ? sanitized.answer : '') || '',
    choices: cleanChoices(sanitized.choices),
    explanation: removeHtmlTags(typeof sanitized.explanation === 'string' ? sanitized.explanation : undefined),
    difficulty: typeof sanitized.difficulty === 'string' && sanitized.difficulty ? sanitized.difficulty : null,
    grade_level: typeof sanitized.grade_level === 'string' && sanitized.grade_level ? sanitized.grade_level : null,
    problem_type_id: sanitized.problem_type_id,
    source_type: removeHtmlTags(typeof sanitized.source_type === 'string' ? sanitized.source_type : undefined),
    source_1: removeHtmlTags(typeof sanitized.source_1 === 'string' ? sanitized.source_1 : undefined),
    source_2: removeHtmlTags(typeof sanitized.source_2 === 'string' ? sanitized.source_2 : undefined),
    source_3: removeHtmlTags(typeof sanitized.source_3 === 'string' ? sanitized.source_3 : undefined),
    source_4: removeHtmlTags(typeof sanitized.source_4 === 'string' ? sanitized.source_4 : undefined),
  }
}

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

  return NextResponse.json({ error: error.message || 'Upload failed' }, { status })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const body = await request.json()
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    if (body && typeof body === 'object' && Array.isArray((body as { questions?: unknown }).questions)) {
      const { questions } = bulkUploadSchema.parse(body)
      const rpcQuestions = questions.map(({ question, yearId, bookId, clientRowId }) => ({
        question: sanitizeQuestionPayload(question),
        yearId,
        bookId,
        clientRowId,
      }))

      const { data, error } = await supabase.rpc('create_admin_bank_questions_bulk', {
        p_workspace_subject: workspaceSubject,
        p_questions: rpcQuestions,
      })

      if (error) {
        return rpcErrorResponse(error)
      }

      const result = Array.isArray(data) ? data[0] : data
      return NextResponse.json({ success: true, result }, { status: 201 })
    }

    const { yearId, bookId, ...question } = singleUploadSchema.parse(body)
    const questionPayload = sanitizeQuestionPayload(question)

    const { data: questionId, error } = await supabase.rpc('create_admin_bank_question', {
      p_workspace_subject: workspaceSubject,
      p_question: questionPayload,
      p_year_id: yearId,
      p_book_id: bookId,
    })

    if (error) {
      return rpcErrorResponse(error)
    }

    return NextResponse.json({
      success: true,
      questionId,
      question: { id: questionId },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues,
      }, { status: 400 })
    }

    console.error('[Admin Upload] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
