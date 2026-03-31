import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { DEFAULT_WORKSPACE_SUBJECT, assertWorkspaceSubject } from '@/lib/workspace-subject'
import { z } from 'zod'

// Schema for updating tags and rating
const UpdateQuestionSchema = z.object({
  tags: z.array(z.string()).optional(),
  rating: z.number().min(0).max(3).optional()
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> } // In Next.js 15+, params is a Promise
) {
  const { id } = await params
  const supabase = await createClient()
  const workspaceSubject = (() => {
    const subject = new URL(request.url).searchParams.get('subject')
    return subject ? assertWorkspaceSubject(subject) : DEFAULT_WORKSPACE_SUBJECT
  })()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = UpdateQuestionSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({ 
        success: false, 
        error: { code: 'INVALID_INPUT', message: validation.error.issues?.[0]?.message || 'Validation failed' } 
      }, { status: 400 })
    }

    const updates = validation.data

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, message: 'No changes provided' })
    }

    const { data, error } = await supabase
      .from('questions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id) // Ensure user owns the question
      .eq('workspace_subject', workspaceSubject)
      .select()
      .single()

    if (error) {
      console.error('DB Update Error:', error)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to update question' } 
      }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })

  } catch (error: unknown) {
    console.error('Update API Error:', error)
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
  const { id } = await params
  const supabase = await createClient()
  const workspaceSubject = (() => {
    const subject = new URL(request.url).searchParams.get('subject')
    return subject ? assertWorkspaceSubject(subject) : DEFAULT_WORKSPACE_SUBJECT
  })()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } }, { status: 401 })
  }

  try {
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('workspace_subject', workspaceSubject)

    if (error) {
      console.error('DB Delete Error:', error)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'DB_ERROR', message: 'Failed to delete question' } 
      }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error: unknown) {
    console.error('Delete API Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}
