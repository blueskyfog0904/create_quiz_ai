import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { DEFAULT_WORKSPACE_SUBJECT, assertWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { z } from 'zod'

const CreateExamPaperSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  questionIds: z.array(z.string().uuid()).min(1, "At least one question is required"),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
})

type QuestionSubjectRow = {
  id: string
  user_id: string
  workspace_subject: WorkspaceSubject
}

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
        error: { code: 'INVALID_INPUT', message: validation.error.issues?.[0]?.message || 'Validation failed' } 
      }, { status: 400 })
    }

    const { title, description, questionIds } = validation.data
    const workspaceSubject = validation.data.workspaceSubject ?? DEFAULT_WORKSPACE_SUBJECT

    const { data: scopedQuestions, error: scopedQuestionsError } = await supabase
      .from('questions')
      .select('id, user_id, workspace_subject')
      .in('id', questionIds)
      .eq('user_id', user.id)

    if (scopedQuestionsError) {
      console.error('Error fetching question subjects:', scopedQuestionsError)
      return NextResponse.json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to verify selected questions' }
      }, { status: 500 })
    }

    const resolvedQuestions = (scopedQuestions ?? []) as QuestionSubjectRow[]

    if (resolvedQuestions.length !== questionIds.length) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_QUESTION_SELECTION', message: '선택한 문제 중 현재 보관함에 없는 문제가 포함되어 있습니다.' }
      }, { status: 400 })
    }

    const subjectSet = new Set(resolvedQuestions.map((question) => question.workspace_subject))
    if (subjectSet.size !== 1 || !subjectSet.has(workspaceSubject)) {
      return NextResponse.json({
        success: false,
        error: { code: 'MIXED_WORKSPACE_SUBJECT', message: '시험지는 동일한 워크스페이스 문제로만 만들 수 있습니다.' }
      }, { status: 400 })
    }

    // Create exam paper
    const examPaperPayload = {
      paper_title: title,
      description: description || null,
      user_id: user.id,
      workspace_subject: workspaceSubject,
    }

    const { data: examPaper, error: examPaperError } = await supabase
      .from('exam_papers')
      .insert(examPaperPayload)
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
      order_index: index + 1,
      workspace_subject: workspaceSubject,
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

  } catch (error: unknown) {
    console.error('Create exam paper API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const workspaceSubject = (() => {
    const subject = new URL(request.url).searchParams.get('subject')
    return subject ? assertWorkspaceSubject(subject) : DEFAULT_WORKSPACE_SUBJECT
  })()
  
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
      .eq('workspace_subject', workspaceSubject)
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

  } catch (error: unknown) {
    console.error('Get exam papers API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}
