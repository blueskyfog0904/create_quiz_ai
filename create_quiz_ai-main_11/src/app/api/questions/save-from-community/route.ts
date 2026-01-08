import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const saveQuestionSchema = z.object({
  question_id: z.string().uuid('Invalid question ID'),
})

const bulkSaveQuestionsSchema = z.object({
  question_ids: z.array(z.string().uuid('Invalid question ID')),
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
        question_text_forward: originalQuestion.question_text_forward,
        question_text_backward: originalQuestion.question_text_backward,
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

export async function PUT(request: Request) {
  try {
    // 1. Check authentication
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // 2. Validate request data
    const body = await request.json()
    const { question_ids } = bulkSaveQuestionsSchema.parse(body)
    
    if (question_ids.length === 0) {
      return NextResponse.json({ error: 'No questions selected' }, { status: 400 })
    }
    
    // 3. Fetch the original questions
    const { data: originalQuestions, error: fetchError } = await supabase
      .from('questions')
      .select('*')
      .in('id', question_ids)
      .eq('source', 'admin_uploaded')
    
    if (fetchError || !originalQuestions || originalQuestions.length === 0) {
      console.error('[Bulk Save from Community] Questions not found:', fetchError)
      return NextResponse.json({ error: 'Questions not found' }, { status: 404 })
    }
    
    // 4. Check for duplicates (already saved by this user)
    const { data: existingQuestions } = await supabase
      .from('questions')
      .select('shared_question_id')
      .eq('user_id', user.id)
      .in('shared_question_id', question_ids)
    
    const existingIds = new Set(existingQuestions?.map(q => q.shared_question_id) || [])
    const questionsToSave = originalQuestions.filter(q => !existingIds.has(q.id))
    
    if (questionsToSave.length === 0) {
      return NextResponse.json({ 
        error: '선택한 모든 문제가 이미 저장되어 있습니다.' 
      }, { status: 400 })
    }
    
    // 5. Create copies in the user's question bank
    const questionsToInsert = questionsToSave.map(originalQuestion => ({
      question_text: originalQuestion.question_text,
      question_text_forward: originalQuestion.question_text_forward,
      question_text_backward: originalQuestion.question_text_backward,
      passage_text: originalQuestion.passage_text,
      answer: originalQuestion.answer,
      choices: originalQuestion.choices,
      explanation: originalQuestion.explanation,
      difficulty: originalQuestion.difficulty,
      grade_level: originalQuestion.grade_level,
      problem_type_id: originalQuestion.problem_type_id,
      user_id: user.id,
      source: 'from_community',
      shared_question_id: originalQuestion.id,
      raw_ai_response: null,
    }))
    
    const { data: newQuestions, error: insertError } = await supabase
      .from('questions')
      .insert(questionsToInsert)
      .select()
    
    if (insertError) {
      console.error('[Bulk Save from Community] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to save questions' }, { status: 500 })
    }
    
    // 6. Return success response
    const skippedCount = originalQuestions.length - questionsToSave.length
    return NextResponse.json({ 
      success: true, 
      saved_count: newQuestions?.length || 0,
      skipped_count: skippedCount,
      questions: newQuestions 
    }, { status: 201 })
    
  } catch (error) {
    console.error('[Bulk Save from Community] Error:', error)
    
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

