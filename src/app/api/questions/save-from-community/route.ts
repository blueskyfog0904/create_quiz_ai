import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const saveQuestionSchema = z.object({
  question_id: z.string().uuid('Invalid question ID'),
})

export async function POST(request: Request) {
  try {
    // 1. Check authentication
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // 2. Validate request data
    const body = await request.json()
    const { question_id } = saveQuestionSchema.parse(body)
    
    // 3. Fetch the original question
    const { data: originalQuestion, error: fetchError } = await supabase
      .from('questions')
      .select('*')
      .eq('id', question_id)
      .eq('source', 'admin_uploaded')
      .single()
    
    if (fetchError || !originalQuestion) {
      console.error('[Save from Community] Question not found:', fetchError)
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }
    
    // 4. Check for duplicate (already saved by this user)
    const { data: existingQuestion } = await supabase
      .from('questions')
      .select('id')
      .eq('user_id', user.id)
      .eq('shared_question_id', question_id)
      .single()
    
    if (existingQuestion) {
      return NextResponse.json({ 
        error: '이미 저장된 문제입니다.' 
      }, { status: 400 })
    }
    
    // 5. Create a copy in the user's question bank
    const { data: newQuestion, error: insertError } = await supabase
      .from('questions')
      .insert({
        question_text: originalQuestion.question_text,
        passage_text: originalQuestion.passage_text,
        answer: originalQuestion.answer,
        choices: originalQuestion.choices,
        explanation: originalQuestion.explanation,
        difficulty: originalQuestion.difficulty,
        grade_level: originalQuestion.grade_level,
        problem_type_id: originalQuestion.problem_type_id,
        user_id: user.id,
        source: 'from_community',
        shared_question_id: question_id,
        raw_ai_response: null,
      })
      .select()
      .single()
    
    if (insertError) {
      console.error('[Save from Community] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save question' }, { status: 500 })
    }
    
    // 6. Return success response
    return NextResponse.json({ 
      success: true, 
      question: newQuestion 
    }, { status: 201 })
    
  } catch (error) {
    console.error('[Save from Community] Error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: error.issues 
      }, { status: 400 })
    }
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

