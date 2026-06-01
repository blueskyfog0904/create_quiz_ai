import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Database } from '@/types/supabase'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

// GET - 전체 문제 유형 리스트 조회
export async function GET(request: Request) {
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
    
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    // Fetch all problem types (including inactive)
    const { data: types, error } = await supabase
      .from('problem_types')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
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
  provider: z.enum(['gemini', 'openai', 'claude', 'admin']).optional(),
  model_name: z.string().optional(),
  generation_provider: z.enum(['gemini', 'openai', 'claude']).optional(),
  generation_model_name: z.string().optional(),
  review_provider: z.enum(['gemini', 'openai', 'claude']).nullable().optional(),
  review_model_name: z.string().nullable().optional(),
  output_format: z.string().optional(),
  review_prompt_template: z.string().optional(),
  is_active: z.boolean().optional(),
}).refine((data) => {
  const generationProvider = data.generation_provider || (data.provider !== 'admin' ? data.provider : undefined)
  const generationModelName = data.generation_model_name || data.model_name

  if (data.provider !== 'admin') {
    return data.prompt_template && data.prompt_template.trim().length > 0 &&
           generationProvider &&
           generationModelName && generationModelName.trim().length > 0
  }
  return true
}, {
  message: 'Prompt template, generation provider, and generation model name are required for AI providers',
}).refine((data) => {
  const hasReviewProvider = Boolean(data.review_provider)
  const hasReviewModel = Boolean(data.review_model_name?.trim())
  return hasReviewProvider === hasReviewModel
}, {
  message: '문제 검토 API 제공자와 모델은 함께 입력해주세요.',
})

const bulkModelUpdateSchema = z.object({
  provider: z.enum(['gemini', 'openai', 'claude']).optional(),
  model_name: z.string().optional(),
  generation_provider: z.enum(['gemini', 'openai', 'claude']).optional(),
  generation_model_name: z.string().optional(),
  review_provider: z.enum(['gemini', 'openai', 'claude']).optional(),
  review_model_name: z.string().optional(),
}).refine((data) => {
  const generationProvider = data.generation_provider || data.provider
  const generationModelName = data.generation_model_name || data.model_name
  return Boolean(generationProvider && generationModelName?.trim())
}, {
  message: '문제 생성 API 제공자와 모델은 필수입니다.',
}).refine((data) => {
  return Boolean(data.review_provider && data.review_model_name?.trim())
}, {
  message: '문제 검토 API 제공자와 모델은 필수입니다.',
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
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const generationProvider = validatedData.generation_provider || (validatedData.provider !== 'admin' ? validatedData.provider : undefined)
    const generationModelName = validatedData.generation_model_name || validatedData.model_name
    
    // 3. Insert problem type into database
    const insertData: Database['public']['Tables']['problem_types']['Insert'] & { workspace_subject: string } = {
      workspace_subject: workspaceSubject,
      type_name: validatedData.type_name,
      description: validatedData.description || null,
      provider: generationProvider || 'admin',
      is_active: validatedData.is_active !== undefined ? validatedData.is_active : true,
      model_name: generationModelName || 'admin',
      generation_provider: generationProvider || null,
      generation_model_name: generationModelName || null,
      review_provider: validatedData.review_provider || null,
      review_model_name: validatedData.review_model_name?.trim() || null,
      prompt_template: generationProvider ? validatedData.prompt_template! : 'N/A (Admin uploaded)',
      output_format: generationProvider ? (validatedData.output_format || null) : null,
      review_prompt_template: generationProvider ? (validatedData.review_prompt_template || null) : null,
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
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const generationProvider = validatedData.generation_provider || validatedData.provider!
    const generationModelName = (validatedData.generation_model_name || validatedData.model_name)!.trim()
    const reviewProvider = validatedData.review_provider!
    const reviewModelName = validatedData.review_model_name!.trim()

    // 선택한 문제 생성 provider/model 조합의 존재 여부 검증
    const { data: generationModel, error: generationModelError } = await supabase
      .from('ai_models')
      .select('id')
      .eq('provider', generationProvider)
      .eq('name', generationModelName)
      .maybeSingle()

    if (generationModelError) {
      console.error('[Admin Problem Types] Generation model validation error:', generationModelError)
      return NextResponse.json({ error: 'Failed to validate generation model' }, { status: 500 })
    }

    if (!generationModel) {
      return NextResponse.json({ error: '선택한 문제 생성 API 제공자에 해당 모델이 존재하지 않습니다.' }, { status: 400 })
    }

    // 선택한 문제 검토 provider/model 조합의 존재 여부 검증
    const { data: reviewModel, error: reviewModelError } = await supabase
      .from('ai_models')
      .select('id')
      .eq('provider', reviewProvider)
      .eq('name', reviewModelName)
      .maybeSingle()

    if (reviewModelError) {
      console.error('[Admin Problem Types] Review model validation error:', reviewModelError)
      return NextResponse.json({ error: 'Failed to validate review model' }, { status: 500 })
    }

    if (!reviewModel) {
      return NextResponse.json({ error: '선택한 문제 검토 API 제공자에 해당 모델이 존재하지 않습니다.' }, { status: 400 })
    }

    const { data: updatedTypes, error: updateError } = await supabase
      .from('problem_types')
      .update({
        provider: generationProvider,
        model_name: generationModelName,
        generation_provider: generationProvider,
        generation_model_name: generationModelName,
        review_provider: reviewProvider,
        review_model_name: reviewModelName,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_subject', workspaceSubject)
      .in('provider', ['openai', 'gemini', 'claude'])
      .select('id')

    if (updateError) {
      console.error('[Admin Problem Types] Bulk update error:', updateError)
      return NextResponse.json({ error: '일괄 변경에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedTypes?.length ?? 0,
      generation_provider: generationProvider,
      generation_model_name: generationModelName,
      review_provider: reviewProvider,
      review_model_name: reviewModelName,
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
