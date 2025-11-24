import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { QuestionSchema } from '@/lib/ai/types'

const SaveQuestionSchema = z.object({
  question: QuestionSchema,
  passage: z.string(),
  gradeLevel: z.string(),
  difficulty: z.string(),
  problemTypeId: z.string().uuid(),
  rawAiResponse: z.string().optional()
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

    const { question, passage, gradeLevel, difficulty, problemTypeId, rawAiResponse } = validation.data

    const { data, error } = await supabase
      .from('questions')
      .insert({
        user_id: user.id,
        question_text: question.questionText,
        choices: question.choices,
        answer: question.answer,
        explanation: question.explanation,
        passage_text: passage,
        grade_level: gradeLevel,
        difficulty: difficulty,
        problem_type_id: problemTypeId,
        raw_ai_response: rawAiResponse,
        source: 'ai_generated',
        shared_question_id: null
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

    return NextResponse.json({ success: true, data })

  } catch (error: any) {
    console.error('Save API Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}

