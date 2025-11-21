import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AIGenerationService } from '@/lib/ai'
import { AIProvider } from '@/lib/ai/types'

const GenerateRequestSchema = z.object({
  passage: z.string().max(3500, "Passage must be under 3500 characters"), // increased for buffer, UI enforces 3000
  gradeLevel: z.string(),
  difficulty: z.string(),
  problemTypeId: z.string().uuid(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } }, { status: 401 })
  }

  try {
    // 2. Validation
    const body = await request.json()
    const validation = GenerateRequestSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json({ 
        success: false, 
        error: { code: 'INVALID_INPUT', message: validation.error.errors[0].message } 
      }, { status: 400 })
    }

    const { passage, gradeLevel, difficulty, problemTypeId } = validation.data

    // 3. Fetch Problem Type
    const { data: problemType, error: dbError } = await supabase
      .from('problem_types')
      .select('*')
      .eq('id', problemTypeId)
      .single()

    if (dbError || !problemType) {
      return NextResponse.json({ 
        success: false, 
        error: { code: 'NOT_FOUND', message: 'Problem type not found' } 
      }, { status: 404 })
    }

    if (!problemType.is_active) {
        return NextResponse.json({ 
            success: false, 
            error: { code: 'INACTIVE_TYPE', message: 'This problem type is currently inactive' } 
          }, { status: 400 })
    }

    // 4. Construct Prompt
    let prompt = problemType.prompt_template
    prompt = prompt.replace('{{PASSAGE}}', passage)
    prompt = prompt.replace('{{GRADE_LEVEL}}', gradeLevel)
    prompt = prompt.replace('{{DIFFICULTY}}', difficulty)

    // Enforce JSON format explicitly in the prompt
    prompt += `

CRITICAL INSTRUCTIONS:
- Generate ONLY ONE question (not an array of questions).
- Output ONLY valid JSON in the exact format below.
- Do NOT include markdown formatting (e.g., \`\`\`json).
- Do NOT wrap the output in an array.

Required JSON structure (single object):
{
  "questionText": "Question body text",
  "choices": [
    { "label": "①", "text": "Choice 1" },
    { "label": "②", "text": "Choice 2" },
    { "label": "③", "text": "Choice 3" },
    { "label": "④", "text": "Choice 4" },
    { "label": "⑤", "text": "Choice 5" }
  ],
  "answer": "The label of the correct choice (e.g., ①)",
  "explanation": "Detailed explanation of the answer"
}`

    // 5. Call AI Service
    const result = await AIGenerationService.generate({
      provider: problemType.provider as AIProvider, // Cast to AIProvider type
      modelName: problemType.model_name,
      prompt: prompt,
      maxTokens: 4000, // Increased to prevent MAX_TOKENS error
      temperature: 0.7
    })

    if (!result.success) {
      console.error('AI Generation Error:', result.error, result.rawResponse)
      // Log to DB (optional, can be added later)
      return NextResponse.json({ 
        success: false, 
        error: { code: 'AI_ERROR', message: 'Failed to generate question. Please try again.' } 
      }, { status: 500 })
    }

    // 6. Return Result
    return NextResponse.json({
      success: true,
      data: result.data,
      rawAiResponse: result.rawResponse
    })

  } catch (error: any) {
    console.error('Generation API Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}
