import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

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
    }))
  ]).optional(),
  explanation: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  grade_level: z.string().nullable().optional(),
  problem_type_id: z.string().uuid().nullable().optional(),
  source: z.string().nullable().optional(),
})

// GET - 문제 상세 조회
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Check admin status
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    
    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    
    // Get question with related data
    const { data: question, error } = await supabase
      .from('questions')
      .select(`
        *,
        problem_types (id, type_name),
        profiles:user_id (id, name, email)
      `)
      .eq('id', id)
      .single()
    
    if (error) {
      console.error('[Admin Get Question] Database error:', error)
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }
    
    return NextResponse.json({ question }, { status: 200 })
    
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
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Check admin status
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    
    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    
    // Delete question (admin can delete any question)
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
    
    if (error) {
      console.error('[Admin Delete] Database error:', error)
      return NextResponse.json({ error: 'Failed to delete question' }, { status: 500 })
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
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Check admin status
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    
    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    
    // Validate request data
    const body = await request.json()
    const validatedData = updateQuestionSchema.parse(body)
    
    // Build update data
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    
    if (validatedData.question_text !== undefined) updateData.question_text = validatedData.question_text
    if (validatedData.question_text_forward !== undefined) updateData.question_text_forward = validatedData.question_text_forward
    if (validatedData.question_text_backward !== undefined) updateData.question_text_backward = validatedData.question_text_backward
    if (validatedData.passage_text !== undefined) updateData.passage_text = validatedData.passage_text
    if (validatedData.answer !== undefined) updateData.answer = validatedData.answer
    if (validatedData.choices !== undefined) updateData.choices = validatedData.choices
    if (validatedData.explanation !== undefined) updateData.explanation = validatedData.explanation
    if (validatedData.difficulty !== undefined) updateData.difficulty = validatedData.difficulty
    if (validatedData.grade_level !== undefined) updateData.grade_level = validatedData.grade_level
    if (validatedData.problem_type_id !== undefined) updateData.problem_type_id = validatedData.problem_type_id
    if (validatedData.source !== undefined) updateData.source = validatedData.source
    
    // Update question (admin can update any question)
    const { data: question, error } = await supabase
      .from('questions')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        problem_types (id, type_name),
        profiles:user_id (id, name, email)
      `)
      .single()
    
    if (error) {
      console.error('[Admin Update] Database error:', error)
      return NextResponse.json({ error: 'Failed to update question' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, question }, { status: 200 })
    
  } catch (error) {
    console.error('[Admin Update] Error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: error.issues 
      }, { status: 400 })
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
