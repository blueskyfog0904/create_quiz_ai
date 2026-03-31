import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { DEFAULT_WORKSPACE_SUBJECT, assertWorkspaceSubject } from '@/lib/workspace-subject'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params

    // Fetch exam paper
    const { data: examPaper, error: examPaperError } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('workspace_subject', workspaceSubject)
      .single()

    if (examPaperError || !examPaper) {
      return NextResponse.json({ 
        success: false, 
        error: { code: 'NOT_FOUND', message: 'Exam paper not found' } 
      }, { status: 404 })
    }

    // Fetch exam paper items with questions
    const { data: items, error: itemsError } = await supabase
      .from('exam_paper_items')
      .select(`
        *,
        questions (*)
      `)
      .eq('exam_paper_id', id)
      .eq('workspace_subject', workspaceSubject)
      .order('order_index')

    if (itemsError) {
      console.error('Error fetching exam paper items:', itemsError)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to fetch exam paper questions' } 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: {
        ...examPaper,
        items
      }
    })

  } catch (error: unknown) {
    console.error('Get exam paper API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params

    // Delete exam paper (items will be cascade deleted if FK is set with ON DELETE CASCADE)
    const { error } = await supabase
      .from('exam_papers')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('workspace_subject', workspaceSubject)

    if (error) {
      console.error('Error deleting exam paper:', error)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to delete exam paper' } 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true
    })

  } catch (error: unknown) {
    console.error('Delete exam paper API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}
