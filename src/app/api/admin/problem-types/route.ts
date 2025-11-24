import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

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
    const insertData: any = {
      type_name: validatedData.type_name,
      description: validatedData.description || null,
      provider: validatedData.provider,
      is_active: validatedData.is_active !== undefined ? validatedData.is_active : true,
    }
    
    // Only add these fields for AI providers (not admin)
    if (validatedData.provider !== 'admin') {
      insertData.prompt_template = validatedData.prompt_template
      insertData.model_name = validatedData.model_name
      insertData.output_format = validatedData.output_format || null
    } else {
      // For admin provider, use placeholder values
      insertData.prompt_template = 'N/A (Admin uploaded)'
      insertData.model_name = 'admin'
      insertData.output_format = null
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
    
  } catch (error: any) {
    console.error('[Admin Problem Type] Error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: error.errors 
      }, { status: 400 })
    }
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

