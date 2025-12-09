import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// HTML 태그 제거 함수 (특히 <br> 태그)
function removeHtmlTags(text: string | null | undefined): string | null {
  if (!text) return null
  if (typeof text !== 'string') return String(text)
  
  // <br>, <br/>, <br /> 태그 제거 (대소문자 구분 없이)
  let cleaned = text.replace(/<br\s*\/?>/gi, '')
  
  // 다른 일반적인 HTML 태그도 제거 (선택사항)
  // cleaned = cleaned.replace(/<[^>]*>/g, '')
  
  return cleaned.trim() || null
}

// choices 배열에서 HTML 태그 제거
function cleanChoices(choices: any[] | undefined): any[] {
  if (!choices || !Array.isArray(choices)) return []
  
  return choices.map(choice => {
    if (typeof choice === 'string') {
      return removeHtmlTags(choice) || ''
    } else if (choice && typeof choice === 'object') {
      return {
        ...choice,
        text: removeHtmlTags(choice.text) || ''
      }
    }
    return choice
  })
}

const questionSchema = z.object({
  question_text: z.string().min(1, 'Question text is required'),
  question_text_forward: z.string().optional(),
  question_text_backward: z.string().optional(),
  passage_text: z.string().optional(),
  answer: z.string().min(1, 'Answer is required'),
  choices: z.union([
    z.array(z.string()),
    z.array(z.object({
      label: z.string(),
      text: z.string()
    })),
    z.array(z.any()) // 빈 배열도 허용
  ]).optional(),
  explanation: z.string().optional(),
  difficulty: z.string().optional(),
  grade_level: z.string().optional(),
  problem_type_id: z.string().uuid('Invalid problem type ID'),
})

export async function POST(request: Request) {
  try {
    console.log('[Admin Upload] ====== START UPLOAD REQUEST ======')
    
    // 1. Check authentication and admin status
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      console.error('[Admin Upload] Unauthorized: No user found')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('[Admin Upload] User ID:', user.id)
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    
    if (!profile?.is_admin) {
      console.error('[Admin Upload] Forbidden: User is not admin')
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }
    
    console.log('[Admin Upload] Admin check passed')
    
    // 2. Validate request data
    const body = await request.json()
    console.log('[Admin Upload] Raw request body:', JSON.stringify(body, null, 2))
    console.log('[Admin Upload] Choices in body:', {
      choices: body.choices,
      choicesType: typeof body.choices,
      choicesIsArray: Array.isArray(body.choices),
      choicesLength: Array.isArray(body.choices) ? body.choices.length : 'N/A',
      choicesValue: JSON.stringify(body.choices)
    })
    
    const validatedData = questionSchema.parse(body)
    console.log('[Admin Upload] Validated data:', JSON.stringify(validatedData, null, 2))
    console.log('[Admin Upload] Choices after validation:', {
      choices: validatedData.choices,
      choicesType: typeof validatedData.choices,
      choicesIsArray: Array.isArray(validatedData.choices),
      choicesLength: Array.isArray(validatedData.choices) ? validatedData.choices.length : 'N/A',
      choicesValue: JSON.stringify(validatedData.choices),
      choicesUndefined: validatedData.choices === undefined
    })
    
    // 3. Prepare insert data (HTML 태그 제거)
    const choicesValue = validatedData.choices !== undefined ? validatedData.choices : []
    const cleanedChoices = cleanChoices(choicesValue)
    
    console.log('[Admin Upload] Choices value for DB insert:', {
      choicesValue,
      cleanedChoices,
      choicesType: typeof cleanedChoices,
      choicesIsArray: Array.isArray(cleanedChoices),
      choicesLength: Array.isArray(cleanedChoices) ? cleanedChoices.length : 'N/A',
      choicesJSON: JSON.stringify(cleanedChoices)
    })
    
    const insertData = {
      question_text: removeHtmlTags(validatedData.question_text) || '',
      question_text_forward: removeHtmlTags(validatedData.question_text_forward),
      question_text_backward: removeHtmlTags(validatedData.question_text_backward),
      passage_text: removeHtmlTags(validatedData.passage_text),
      answer: removeHtmlTags(validatedData.answer) || '',
      choices: cleanedChoices, // HTML 태그 제거된 choices
      explanation: removeHtmlTags(validatedData.explanation),
      difficulty: validatedData.difficulty || null,
      grade_level: validatedData.grade_level || null,
      problem_type_id: validatedData.problem_type_id,
      user_id: user.id,
      source: 'admin_uploaded',
      shared_question_id: null,
      raw_ai_response: null,
    }
    
    console.log('[Admin Upload] HTML tags removed from all text fields')
    
    console.log('[Admin Upload] Insert data:', JSON.stringify(insertData, null, 2))
    console.log('[Admin Upload] Insert data choices:', {
      choices: insertData.choices,
      choicesType: typeof insertData.choices,
      choicesIsArray: Array.isArray(insertData.choices),
      choicesLength: Array.isArray(insertData.choices) ? insertData.choices.length : 'N/A',
      choicesJSON: JSON.stringify(insertData.choices)
    })
    
    // 4. Insert question into database
    console.log('[Admin Upload] Attempting to insert into database...')
    const { data: question, error } = await supabase
      .from('questions')
      .insert(insertData)
      .select()
      .single()
    
    if (error) {
      console.error('[Admin Upload] Database error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        insertData: JSON.stringify(insertData, null, 2)
      })
      return NextResponse.json({ 
        error: 'Failed to upload question',
        details: error.message 
      }, { status: 500 })
    }
    
    console.log('[Admin Upload] Successfully inserted question:', {
      id: question?.id,
      choices: question?.choices,
      choicesType: typeof question?.choices,
      choicesIsArray: Array.isArray(question?.choices),
      choicesLength: Array.isArray(question?.choices) ? question?.choices.length : 'N/A',
      choicesJSON: JSON.stringify(question?.choices)
    })
    console.log('[Admin Upload] ====== END UPLOAD REQUEST (SUCCESS) ======')
    
    // 5. Return success response
    return NextResponse.json({ 
      success: true, 
      question 
    }, { status: 201 })
    
  } catch (error) {
    console.error('[Admin Upload] ====== ERROR OCCURRED ======')
    console.error('[Admin Upload] Error type:', error?.constructor?.name)
    console.error('[Admin Upload] Error message:', error instanceof Error ? error.message : String(error))
    console.error('[Admin Upload] Error stack:', error instanceof Error ? error.stack : 'N/A')
    
    if (error instanceof z.ZodError) {
      console.error('[Admin Upload] Zod validation errors:', {
        issues: error.issues,
        formatted: error.format()
      })
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: error.issues 
      }, { status: 400 })
    }
    
    console.error('[Admin Upload] ====== END UPLOAD REQUEST (ERROR) ======')
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

