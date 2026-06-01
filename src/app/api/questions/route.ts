import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { QuestionSchema } from '@/lib/ai/types'
import { normalizeQuestionTextBackward } from '@/lib/questions/normalize-question-field'
import { linkAiQuestionGenerationRunToQuestion } from '@/lib/ai/question-generation-run-logs'

const SaveQuestionSchema = z.object({
  question: QuestionSchema,
  passage: z.string().optional(),
  problemTypeId: z.string().uuid(),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  generationRunId: z.string().uuid().optional(),
  rawAiResponse: z.string().optional(),
  questionTextForward: z.string().optional(),
  questionTextBackward: z.string().optional(),
  tags: z.array(z.string()).optional(),
  passageId: z.string().optional(),
  source_passage_id: z.string().optional(),
  rating: z.number().int().min(0).max(3).optional()
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = SaveQuestionSchema.safeParse(body)

    if (!validation.success) {
        return NextResponse.json({ 
          success: false, 
          error: { code: 'INVALID_INPUT', message: validation.error.issues?.[0]?.message || 'Validation failed' } 
        }, { status: 400 })
    }

    const {
      question,
      passage,
      problemTypeId,
      workspaceSubject = 'english',
      generationRunId,
      rawAiResponse,
      questionTextForward,
      questionTextBackward,
      tags,
      passageId,
      source_passage_id,
      rating
    } = validation.data

    const resolvedPassageId = passageId || source_passage_id

    const toDbNull = (value?: string | null) => {
      if (value === undefined || value === null) return null
      const trimmed = value.trim()
      return trimmed.length ? value : null
    }

    const forwardText = questionTextForward === undefined
      ? toDbNull(question.questionTextForward)
      : toDbNull(questionTextForward)
    const backwardText = questionTextBackward === undefined
      ? toDbNull(normalizeQuestionTextBackward(question.questionTextBackward))
      : toDbNull(normalizeQuestionTextBackward(questionTextBackward))
    const passageText = toDbNull(question.passageText) || toDbNull(passage) || null

    let finalTags = tags

    // If passageId is provided but no tags, try to fetch tags from passage
    if (resolvedPassageId && (!tags || tags.length === 0)) {
      const { data: passageData } = await supabase
        .from('passages')
        .select('tags')
        .eq('id', resolvedPassageId)
        .single()

      if (passageData?.tags) {
        finalTags = passageData.tags
      }
    }

    const { data, error } = await supabase
      .from('questions')
      .insert({
        user_id: user.id,
        workspace_subject: workspaceSubject,
        question_text: question.questionText,
        question_text_forward: forwardText ?? null,
        question_text_backward: backwardText ?? null,
        choices: question.choices,
        answer: question.answer,
        explanation: toDbNull(question.explanation) || null,
        passage_text: passageText,
        grade_level: null,
        difficulty: null,
        problem_type_id: problemTypeId,
        raw_ai_response: rawAiResponse,
        source: 'ai_generated',
        shared_question_id: null,
        tags: finalTags || null,
        passage_id: resolvedPassageId || null,
        rating: rating || 0
      })
      .select()
      .single()

    if (error) {
        console.error('DB Insert Error:', error)
        return NextResponse.json({ 
            success: false, 
            error: { code: 'DB_ERROR', message: 'Failed to save question' } 
        }, { status: 500 })
    }

    if (generationRunId) {
      await linkAiQuestionGenerationRunToQuestion({
        generationRunId,
        questionId: data.id,
        userId: user.id,
        workspaceSubject,
        problemTypeId,
        allowedSources: ['single', 'multi', 'textbook'],
      })
    }

    return NextResponse.json({ success: true, data })

  } catch (error: unknown) {
    console.error('Save API Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}
