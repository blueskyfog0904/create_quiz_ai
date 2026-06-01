import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

const updateProblemTypeSchema = z.object({
  type_name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  prompt_template: z.string().optional(),
  provider: z.enum(['gemini', 'openai', 'claude', 'admin']).optional(),
  model_name: z.string().optional(),
  generation_provider: z.enum(['gemini', 'openai', 'claude']).nullable().optional(),
  generation_model_name: z.string().nullable().optional(),
  review_provider: z.enum(['gemini', 'openai', 'claude']).nullable().optional(),
  review_model_name: z.string().nullable().optional(),
  output_format: z.string().nullable().optional(),
  review_prompt_template: z.string().nullable().optional(),
  review_output_format: z.string().nullable().optional(),
  regeneration_prompt_template: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})

// GET - 단일 문제 유형 조회
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
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
    
    const { data: problemType, error } = await supabase
      .from('problem_types')
      .select('*')
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)
      .single()
    
    if (error) {
      console.error('[Admin Problem Type] Database error:', error)
      return NextResponse.json({ error: 'Problem type not found' }, { status: 404 })
    }
    
    return NextResponse.json({ problemType })
  } catch (error) {
    console.error('[Admin Problem Type] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - 문제 유형 수정
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
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
    
    const body = await request.json()
    const validatedData = updateProblemTypeSchema.parse(body)
    
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    
    if (validatedData.type_name !== undefined) {
      updateData.type_name = validatedData.type_name
    }
    if (validatedData.description !== undefined) {
      updateData.description = validatedData.description
    }
    if (validatedData.prompt_template !== undefined) {
      updateData.prompt_template = validatedData.prompt_template
    }
    if (validatedData.provider !== undefined) {
      updateData.provider = validatedData.provider
    }
    if (validatedData.model_name !== undefined) {
      updateData.model_name = validatedData.model_name
    }
    if (validatedData.generation_provider !== undefined) {
      updateData.generation_provider = validatedData.generation_provider
      if (validatedData.generation_provider) {
        updateData.provider = validatedData.generation_provider
      }
    }
    if (validatedData.generation_model_name !== undefined) {
      updateData.generation_model_name = validatedData.generation_model_name
      if (validatedData.generation_model_name) {
        updateData.model_name = validatedData.generation_model_name
      }
    }
    if (validatedData.review_provider !== undefined) {
      updateData.review_provider = validatedData.review_provider
    }
    if (validatedData.review_model_name !== undefined) {
      updateData.review_model_name = validatedData.review_model_name
    }
    if (validatedData.output_format !== undefined) {
      updateData.output_format = validatedData.output_format
    }
    if (validatedData.review_prompt_template !== undefined) {
      updateData.review_prompt_template = validatedData.review_prompt_template
    }
    if (validatedData.review_output_format !== undefined) {
      updateData.review_output_format = validatedData.review_output_format
    }
    if (validatedData.regeneration_prompt_template !== undefined) {
      updateData.regeneration_prompt_template = validatedData.regeneration_prompt_template
    }
    if (validatedData.is_active !== undefined) {
      updateData.is_active = validatedData.is_active
    }
    
    const { data: problemType, error } = await supabase
      .from('problem_types')
      .update(updateData)
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)
      .select()
      .single()
    
    if (error) {
      console.error('[Admin Problem Type] Database error:', error)
      return NextResponse.json({ error: 'Failed to update problem type' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, problemType })
  } catch (error) {
    console.error('[Admin Problem Type] Error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: error.issues 
      }, { status: 400 })
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - 문제 유형 삭제
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
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
    
    // Check if problem type is being used by any questions
    const { count } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('problem_type_id', id)
      .eq('workspace_subject', workspaceSubject)
    
    if (count && count > 0) {
      return NextResponse.json({ 
        error: `이 문제 유형을 사용하는 문제가 ${count}개 있어 삭제할 수 없습니다. 먼저 해당 문제들의 유형을 변경해주세요.` 
      }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('problem_types')
      .delete()
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)
    
    if (error) {
      console.error('[Admin Problem Type] Database error:', error)
      return NextResponse.json({ error: 'Failed to delete problem type' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Admin Problem Type] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
