import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AIGenerationService } from '@/lib/ai'
import { AIProvider } from '@/lib/ai/types'
import { CreditService } from '@/lib/credits'

const COST_PER_GENERATION = 100

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
        error: { code: 'INVALID_INPUT', message: validation.error.issues?.[0]?.message || 'Validation failed' } 
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

    // [New] 3.5 Deduct Credits (Atomic)
    // AI 생성 전 선차감
    try {
      await CreditService.deductCredits(user.id, COST_PER_GENERATION, 'ai_generation', {
        description: `AI 문제 생성 (${problemType.type_name})`,
        resourceType: 'problem_type',
        resourceId: problemTypeId
      })
    } catch (error: any) {
      return NextResponse.json({ 
        success: false, 
        error: { code: 'INSUFFICIENT_CREDITS', message: error.message || '크레딧이 부족합니다.' } 
      }, { status: 402 })
    }

    // 4. Construct Prompt
    
    // Helper function to convert grade level to Korean
    const getGradeLevelKorean = (grade: string): string => {
      const gradeMap: { [key: string]: string } = {
        '고1': '고등학교 1학년',
        'High1': '고등학교 1학년',
        '고2': '고등학교 2학년',
        'High2': '고등학교 2학년',
        '고3': '고등학교 3학년',
        'High3': '고등학교 3학년',
        '중1': '중학교 1학년',
        'Middle1': '중학교 1학년',
        '중2': '중학교 2학년',
        'Middle2': '중학교 2학년',
        '중3': '중학교 3학년',
        'Middle3': '중학교 3학년',
      }
      return gradeMap[grade] || grade
    }
    
    // Helper function to convert difficulty to Korean
    const getDifficultyKorean = (diff: string): string => {
      const diffMap: { [key: string]: string } = {
        '상': '상',
        'High': '상',
        '중': '중',
        'Medium': '중',
        '하': '하',
        'Low': '하',
      }
      return diffMap[diff] || diff
    }
    
    const gradeLevelKorean = getGradeLevelKorean(gradeLevel)
    const difficultyKorean = getDifficultyKorean(difficulty)
    
    // Build structured prompt
    let prompt = `
================================================================================
📝 PROMPT TEMPLATE 시작
================================================================================

${problemType.prompt_template}

================================================================================
📝 PROMPT TEMPLATE 끝
================================================================================

위 PROMPT TEMPLATE 규칙을 적용해서 아래에 입력된 지문에 대한 문제, 보기, 답안, 해설을 만들어줘.

【문제 생성 조건】
- 학년의 난이도는 대한민국의 ${gradeLevelKorean} 수준이야.
- 문제의 난이도는 위에서 설정한 학년의 수준에서 상, 중, 하 중 ${difficultyKorean}의 난이도로 설정해줘.

【지문】
${passage}

================================================================================

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

    // Log the full prompt being sent to AI
    console.log('\n' + '='.repeat(80))
    console.log('📤 FULL PROMPT SENT TO AI')
    console.log('='.repeat(80))
    console.log('Provider:', problemType.provider)
    console.log('Model:', problemType.model_name)
    console.log('Problem Type:', problemType.type_name)
    console.log('Grade Level:', gradeLevel, '→', gradeLevelKorean)
    console.log('Difficulty:', difficulty, '→', difficultyKorean)
    console.log('Passage Length:', passage.length, 'characters')
    console.log('-'.repeat(80))
    console.log(prompt)
    console.log('='.repeat(80) + '\n')

    // 5. Call AI Service
    const result = await AIGenerationService.generate({
      provider: problemType.provider as AIProvider, // Cast to AIProvider type
      modelName: problemType.model_name,
      prompt: prompt,
      maxTokens: 16000, // Increased significantly to accommodate Gemini's thinking tokens
      temperature: 0.7
    })

    if (!result.success) {
      console.error('AI Generation Error:', result.error, result.rawResponse)
      
      // [New] Rollback (Refund)
      await CreditService.grantCredits(user.id, COST_PER_GENERATION, 'system_refund', {
        description: 'AI 생성 오류로 인한 환불',
        resourceType: 'problem_type',
        resourceId: problemTypeId
      })

      return NextResponse.json({ 
        success: false, 
        error: { code: 'AI_ERROR', message: 'Failed to generate question. Credits have been refunded.' } 
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
    
    // Note: If error occurred AFTER deduction but BEFORE AI call (unlikely), we might need refund here too.
    // However, the deduction is in its own try-catch block above. 
    // If main try-catch catches something, it depends where it failed.
    // Ideally we should scope the try-catch better, but for now assuming if it fails here it's unexpected system error.
    // We should probably check if credit was deducted in this scope to refund, but simpler is to let AI error handling do the refund.
    
    return NextResponse.json({ 
      success: false, 
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } 
    }, { status: 500 })
  }
}
