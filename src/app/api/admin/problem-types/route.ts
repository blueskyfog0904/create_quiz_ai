import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Database } from '@/types/supabase'

// GET - 전체 문제 유형 리스트 조회
export async function GET() {
  try {
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
    
    // Fetch all problem types (including inactive)
    const { data: types, error } = await supabase
      .from('problem_types')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('[Admin Problem Types] Database error:', error)
      return NextResponse.json({ error: 'Failed to fetch problem types' }, { status: 500 })
    }
    
    return NextResponse.json({ types: types || [] })
  } catch (error) {
    console.error('[Admin Problem Types] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const problemTypeSchema = z.object({
  type_name: z.string().min(1, 'Problem type name is required'),
  description: z.string().optional(),
  prompt_template: z.string().optional(),
  provider: z.enum(['gemini', 'openai', 'admin'], { message: 'Provider must be gemini, openai, or admin' }),
  model_name: z.string().optional(),
  output_format: z.string().optional(),
  is_active: z.boolean().optional(),
}).refine((data) => {
  // If provider is not 'admin', require prompt_template and model_name
  if (data.provider !== 'admin') {
    return data.prompt_template && data.prompt_template.trim().length > 0 &&
           data.model_name && data.model_name.trim().length > 0
  }
  return true
}, {
  message: 'Prompt template and model name are required for AI providers',
})

const bulkModelUpdateSchema = z.object({
  provider: z.enum(['gemini', 'openai']),
  model_name: z.string().min(1, 'Model name is required'),
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
    const validatedData = problemTypeSchema.parse(body)
    
    // 3. Insert problem type into database
    const insertData: Database['public']['Tables']['problem_types']['Insert'] = {
      type_name: validatedData.type_name,
      description: validatedData.description || null,
      provider: validatedData.provider,
      is_active: validatedData.is_active !== undefined ? validatedData.is_active : true,
      model_name: validatedData.provider !== 'admin' ? validatedData.model_name! : 'admin',
      prompt_template: validatedData.provider !== 'admin' ? validatedData.prompt_template! : 'N/A (Admin uploaded)',
      output_format: validatedData.provider !== 'admin' ? (validatedData.output_format || null) : null,
    }
    
    const { data: problemType, error } = await supabase
      .from('problem_types')
      .insert(insertData)
      .select()
      .single()
    
    if (error) {
      console.error('[Admin Problem Type] Database error:', error)
      return NextResponse.json({ error: 'Failed to create problem type' }, { status: 500 })
    }
    
    // 4. Return success response
    return NextResponse.json({ 
      success: true, 
      problemType 
    }, { status: 201 })
    
  } catch (error) {
    console.error('[Admin Problem Type] Error:', error)
    
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

// PATCH - 등록된 AI 문제 유형 모델 일괄 변경
export async function PATCH(request: Request) {
  try {
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
    const validatedData = bulkModelUpdateSchema.parse(body)

    // 선택한 provider/model 조합의 존재 여부 검증
    const { data: model, error: modelError } = await supabase
      .from('ai_models')
      .select('id')
      .eq('provider', validatedData.provider)
      .eq('name', validatedData.model_name)
      .maybeSingle()

    if (modelError) {
      console.error('[Admin Problem Types] Model validation error:', modelError)
      return NextResponse.json({ error: 'Failed to validate target model' }, { status: 500 })
    }

    if (!model) {
      return NextResponse.json({ error: '선택한 제공자에 해당 모델이 존재하지 않습니다.' }, { status: 400 })
    }

    const { data: updatedTypes, error: updateError } = await supabase
      .from('problem_types')
      .update({
        provider: validatedData.provider,
        model_name: validatedData.model_name,
        updated_at: new Date().toISOString(),
      })
      .in('provider', ['openai', 'gemini'])
      .select('id')

    if (updateError) {
      console.error('[Admin Problem Types] Bulk update error:', updateError)
      return NextResponse.json({ error: '일괄 변경에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedTypes?.length ?? 0,
      provider: validatedData.provider,
      model_name: validatedData.model_name,
    })
  } catch (error) {
    console.error('[Admin Problem Types] Bulk update error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
