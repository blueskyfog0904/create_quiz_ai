import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateQuestionSchema = z.object({
  question_text: z.string().optional(),
  passage_text: z.string().optional(),
  answer: z.string().optional(),
  choices: z.union([
    z.array(z.string()),
    z.array(z.object({
      label: z.string(),
      text: z.string()
    }))
  ]).optional(),
  explanation: z.string().optional(),
  difficulty: z.string().optional(),
  grade_level: z.string().optional(),
  problem_type_id: z.string().uuid().optional(),
})

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
    
    // Delete question
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
      .eq('source', 'admin_uploaded') // Only allow deleting admin-uploaded questions
    
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
    
    // Update question
    const updateData: any = {}
    if (validatedData.question_text !== undefined) updateData.question_text = validatedData.question_text
    if (validatedData.passage_text !== undefined) updateData.passage_text = validatedData.passage_text
    if (validatedData.answer !== undefined) updateData.answer = validatedData.answer
    if (validatedData.choices !== undefined) updateData.choices = validatedData.choices
    if (validatedData.explanation !== undefined) updateData.explanation = validatedData.explanation
    if (validatedData.difficulty !== undefined) updateData.difficulty = validatedData.difficulty
    if (validatedData.grade_level !== undefined) updateData.grade_level = validatedData.grade_level
    if (validatedData.problem_type_id !== undefined) updateData.problem_type_id = validatedData.problem_type_id
    
    const { data: question, error } = await supabase
      .from('questions')
      .update(updateData)
      .eq('id', id)
      .eq('source', 'admin_uploaded') // Only allow updating admin-uploaded questions
      .select()
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

