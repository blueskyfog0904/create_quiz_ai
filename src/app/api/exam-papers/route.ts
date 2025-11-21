import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const CreateExamPaperSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  questionIds: z.array(z.string().uuid()).min(1, "At least one question is required"),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ 
      success: false, 
      error: { code: 'UNAUTHORIZED', message: 'Please login first' } 
    }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = CreateExamPaperSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json({ 
        success: false, 
        error: { code: 'INVALID_INPUT', message: validation.error.errors[0].message } 
      }, { status: 400 })
    }

    const { title, description, questionIds } = validation.data

    // Create exam paper
    const { data: examPaper, error: examPaperError } = await supabase
      .from('exam_papers')
      .insert({
        paper_title: title,
        description: description || null,
        user_id: user.id
      })
      .select()
      .single()

    if (examPaperError) {
      console.error('Error creating exam paper:', examPaperError)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to create exam paper' } 
      }, { status: 500 })
    }

    // Create exam paper items
    const examPaperItems = questionIds.map((questionId, index) => ({
      exam_paper_id: examPaper.id,
      question_id: questionId,
      number: index + 1,
      order_index: index + 1
    }))

    const { error: itemsError } = await supabase
      .from('exam_paper_items')
      .insert(examPaperItems)

    if (itemsError) {
      console.error('Error creating exam paper items:', itemsError)
      // Rollback: delete exam paper
      await supabase.from('exam_papers').delete().eq('id', examPaper.id)
      
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to add questions to exam paper' } 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: examPaper
    })

  } catch (error: any) {
    console.error('Create exam paper API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  
  // Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ 
      success: false, 
      error: { code: 'UNAUTHORIZED', message: 'Please login first' } 
    }, { status: 401 })
  }

  try {
    const { data: examPapers, error } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching exam papers:', error)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to fetch exam papers' } 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: examPapers
    })

  } catch (error: any) {
    console.error('Get exam papers API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}

