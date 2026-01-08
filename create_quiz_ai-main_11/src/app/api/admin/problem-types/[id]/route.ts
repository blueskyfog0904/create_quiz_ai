import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateProblemTypeSchema = z.object({
  type_name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
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
    if (validatedData.is_active !== undefined) {
      updateData.is_active = validatedData.is_active
    }
    
    const { data: problemType, error } = await supabase
      .from('problem_types')
      .update(updateData)
      .eq('id', id)
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
    
    if (count && count > 0) {
      return NextResponse.json({ 
        error: `이 문제 유형을 사용하는 문제가 ${count}개 있어 삭제할 수 없습니다. 먼저 해당 문제들의 유형을 변경해주세요.` 
      }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('problem_types')
      .delete()
      .eq('id', id)
    
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


