import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const questionSchema = z.object({
  question_text: z.string().min(1, 'Question text is required'),
  passage_text: z.string().optional(),
  answer: z.string().min(1, 'Answer is required'),
  choices: z.union([
    z.array(z.string()).min(5, 'At least 5 choices required'),
    z.array(z.object({
      label: z.string(),
      text: z.string()
    })).min(5, 'At least 5 choices required')
  ]),
  explanation: z.string().optional(),
  difficulty: z.string().optional(),
  grade_level: z.string().optional(),
  problem_type_id: z.string().uuid('Invalid problem type ID'),
})

export async function POST(request: Request) {
  try {
    // 1. Check authentication and admin status
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    
    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    
    // 2. Validate request data
    const body = await request.json()
    const validatedData = questionSchema.parse(body)
    
    // 3. Insert question into database
    const { data: question, error } = await supabase
      .from('questions')
      .insert({
        question_text: validatedData.question_text,
        passage_text: validatedData.passage_text || null,
        answer: validatedData.answer,
        choices: validatedData.choices,
        explanation: validatedData.explanation || null,
        difficulty: validatedData.difficulty || null,
        grade_level: validatedData.grade_level || null,
        problem_type_id: validatedData.problem_type_id,
        user_id: user.id, // Use current admin user's ID
        source: 'admin_uploaded',
        shared_question_id: null,
        raw_ai_response: null, // Not AI generated
      })
      .select()
      .single()
    
    if (error) {
      console.error('[Admin Upload] Database error:', error)
      return NextResponse.json({ error: 'Failed to upload question' }, { status: 500 })
    }
    
    // 4. Return success response
    return NextResponse.json({ 
      success: true, 
      question 
    }, { status: 201 })
    
  } catch (error: any) {
    console.error('[Admin Upload] Error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: error.errors 
      }, { status: 400 })
    }
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

