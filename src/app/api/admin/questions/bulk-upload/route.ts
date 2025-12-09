import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

// HTML 태그 제거 함수 (특히 <br> 태그)
function removeHtmlTags(text: string | null | undefined): string {
  if (!text) return ''
  if (typeof text !== 'string') return String(text)
  
  // <br>, <br/>, <br /> 태그 제거 (대소문자 구분 없이)
  let cleaned = text.replace(/<br\s*\/?>/gi, '')
  
  // 다른 일반적인 HTML 태그도 제거 (선택사항)
  // cleaned = cleaned.replace(/<[^>]*>/g, '')
  
  return cleaned.trim()
}

interface QuestionRow {
  문제유형: string
  지문?: string
  문제앞텍스트?: string
  문제내용: string
  문제뒤텍스트?: string
  // option 컬럼 지원 (JSON 배열, 쉼표 구분 문자열, 또는 배열)
  option?: string | any
  // 기존 한글 컬럼명도 지원
  선택지1?: string
  선택지2?: string
  선택지3?: string
  선택지4?: string
  선택지5?: string
  정답: string | number
  해설?: string
  학년?: string
  난이도?: string
}

interface ParsedQuestion {
  id: string  // Unique ID for client-side management
  problem_type_id: string
  problem_type_name: string
  passage_text: string
  question_text: string
  question_text_forward: string
  question_text_backward: string
  choices: string[]
  answer: string
  explanation: string
  grade_level: string
  difficulty: string
  isValid: boolean
  errorMessage?: string
}

interface ParseResult {
  success: boolean
  row: number
  question?: ParsedQuestion
  error?: string
}

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
    
    // 2. Parse the uploaded file
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    
    // Check file type
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.csv')) {
      return NextResponse.json({ 
        error: 'Invalid file format. Please upload .xlsx or .csv file' 
      }, { status: 400 })
    }
    
    // Read file buffer
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    
    // Get the first sheet (문제입력)
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    
    // Convert to JSON
    const rows: QuestionRow[] = XLSX.utils.sheet_to_json(sheet)
    
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data found in the file' }, { status: 400 })
    }
    
    // 3. Fetch problem types for name-to-ID mapping
    const { data: problemTypes, error: problemTypesError } = await supabase
      .from('problem_types')
      .select('id, type_name')
      .eq('is_active', true)
    
    if (problemTypesError) {
      console.error('[Bulk Upload] Error fetching problem types:', problemTypesError)
      return NextResponse.json({ error: 'Failed to fetch problem types' }, { status: 500 })
    }
    
    // Create name-to-ID map
    const problemTypeMap = new Map<string, { id: string, name: string }>()
    problemTypes?.forEach(type => {
      problemTypeMap.set(type.type_name, { id: type.id, name: type.type_name })
    })
    
    // 4. Parse and validate each row (WITHOUT saving to DB)
    const results: ParseResult[] = []
    const validGradeLevels = ['중1', '중2', '중3', '고1', '고2', '고3']
    const validDifficulties = ['하', '중', '상']
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2 // +2 because row 1 is header, and we're 0-indexed
      
      try {
        // Validate required fields
        if (!row.문제유형) {
          throw new Error('문제유형이 필요합니다.')
        }
        if (!row.문제내용) {
          throw new Error('문제내용이 필요합니다.')
        }
        // 선택지는 선택사항이므로 검증 제거
        if (row.정답 === undefined || row.정답 === null || row.정답 === '') {
          throw new Error('정답이 필요합니다.')
        }
        
        // Get problem type info
        const problemTypeInfo = problemTypeMap.get(row.문제유형)
        if (!problemTypeInfo) {
          throw new Error(`문제유형 "${row.문제유형}"을(를) 찾을 수 없습니다.`)
        }
        
        // Format answer (keep as string for preview) - HTML 태그 제거
        const answer = removeHtmlTags(String(row.정답))
        
        // Format choices as string array (선택사항)
        // option 컬럼이 있는 경우 우선 처리
        let choices: string[] = []
        
        console.log(`[Bulk Upload] Row ${rowNumber}: Parsing choices`, {
          hasOption: row.option !== undefined && row.option !== null && row.option !== '',
          optionValue: row.option,
          optionType: typeof row.option,
          optionIsArray: Array.isArray(row.option),
          선택지1: row.선택지1,
          선택지2: row.선택지2,
          선택지3: row.선택지3,
          선택지4: row.선택지4,
          선택지5: row.선택지5,
        })
        
        if (row.option !== undefined && row.option !== null && row.option !== '') {
          try {
            console.log(`[Bulk Upload] Row ${rowNumber}: Processing option column`)
            // JSON 문자열인 경우 파싱
            if (typeof row.option === 'string') {
              // JSON 배열 형식인 경우
              if (row.option.trim().startsWith('[') || row.option.trim().startsWith('{')) {
                console.log(`[Bulk Upload] Row ${rowNumber}: Parsing as JSON`)
                const parsed = JSON.parse(row.option.trim())
                console.log(`[Bulk Upload] Row ${rowNumber}: Parsed JSON:`, parsed)
                if (Array.isArray(parsed)) {
                  choices = parsed.map(c => removeHtmlTags(String(c))).filter(c => c !== '')
                } else if (parsed.choices && Array.isArray(parsed.choices)) {
                  choices = parsed.choices.map((c: any) => {
                    if (typeof c === 'string') return removeHtmlTags(c)
                    if (c && typeof c === 'object' && c.text) return removeHtmlTags(String(c.text))
                    return removeHtmlTags(String(c))
                  }).filter(c => c !== '')
                }
              } else {
                // 쉼표로 구분된 문자열인 경우
                console.log(`[Bulk Upload] Row ${rowNumber}: Parsing as comma-separated string`)
                choices = row.option.split(',').map(c => removeHtmlTags(c)).filter(c => c !== '')
              }
            } else if (Array.isArray(row.option)) {
              // 이미 배열인 경우
              console.log(`[Bulk Upload] Row ${rowNumber}: Option is already an array`)
              choices = row.option.map(c => removeHtmlTags(String(c))).filter(c => c !== '')
            }
            console.log(`[Bulk Upload] Row ${rowNumber}: Choices from option column:`, choices)
          } catch (e) {
            console.warn(`[Bulk Upload] Row ${rowNumber}: Failed to parse option column:`, e)
            // 파싱 실패 시 빈 배열로 처리
            choices = []
          }
        }
        
        // option 컬럼이 없거나 비어있으면 기존 방식 사용 (선택지1-5)
        if (choices.length === 0) {
          console.log(`[Bulk Upload] Row ${rowNumber}: Using 선택지1-5 columns`)
          const choiceArray = [
            row.선택지1 ? removeHtmlTags(String(row.선택지1)) : '',
            row.선택지2 ? removeHtmlTags(String(row.선택지2)) : '',
            row.선택지3 ? removeHtmlTags(String(row.선택지3)) : '',
            row.선택지4 ? removeHtmlTags(String(row.선택지4)) : '',
            row.선택지5 ? removeHtmlTags(String(row.선택지5)) : '',
          ]
          console.log(`[Bulk Upload] Row ${rowNumber}: Raw choice array (HTML tags removed):`, choiceArray)
          // 빈 문자열이 아닌 것만 필터링 (빈 선택지도 포함하여 저장)
          choices = choiceArray.filter(c => c !== '')
          console.log(`[Bulk Upload] Row ${rowNumber}: Filtered choices:`, choices)
        }
        
        console.log(`[Bulk Upload] Row ${rowNumber}: Final choices:`, {
          choices,
          choicesLength: choices.length,
          choicesIsArray: Array.isArray(choices),
          choicesJSON: JSON.stringify(choices)
        })
        
        // Validate grade level if provided
        let gradeLevel = row.학년 ? String(row.학년).trim() : ''
        if (gradeLevel && !validGradeLevels.includes(gradeLevel)) {
          gradeLevel = '' // Reset invalid grade level
        }
        
        // Validate difficulty if provided
        let difficulty = row.난이도 ? String(row.난이도).trim() : ''
        if (difficulty && !validDifficulties.includes(difficulty)) {
          difficulty = '' // Reset invalid difficulty
        }
        
        // Create parsed question object for preview (HTML 태그 제거)
        const parsedQuestion: ParsedQuestion = {
          id: `parsed-${rowNumber}-${Date.now()}`,
          problem_type_id: problemTypeInfo.id,
          problem_type_name: problemTypeInfo.name,
          passage_text: row.지문 ? removeHtmlTags(String(row.지문)) : '',
          question_text: removeHtmlTags(String(row.문제내용)),
          question_text_forward: row.문제앞텍스트 ? removeHtmlTags(String(row.문제앞텍스트)) : '',
          question_text_backward: row.문제뒤텍스트 ? removeHtmlTags(String(row.문제뒤텍스트)) : '',
          choices,
          answer,
          explanation: row.해설 ? removeHtmlTags(String(row.해설)) : '',
          grade_level: gradeLevel,
          difficulty,
          isValid: true,
        }
        
        console.log(`[Bulk Upload] Row ${rowNumber}: Created parsed question:`, {
          id: parsedQuestion.id,
          question_text: parsedQuestion.question_text,
          choices: parsedQuestion.choices,
          choicesLength: parsedQuestion.choices.length,
          choicesIsArray: Array.isArray(parsedQuestion.choices),
          choicesJSON: JSON.stringify(parsedQuestion.choices),
          isValid: parsedQuestion.isValid
        })
        
        results.push({
          success: true,
          row: rowNumber,
          question: parsedQuestion,
        })
        
      } catch (error: any) {
        // Even if there's an error, create a partial question object for display
        const problemTypeInfo = problemTypeMap.get(row.문제유형)
        
        const partialQuestion: ParsedQuestion = {
          id: `parsed-${rowNumber}-${Date.now()}`,
          problem_type_id: problemTypeInfo?.id || '',
          problem_type_name: row.문제유형 || '',
          passage_text: row.지문 ? removeHtmlTags(String(row.지문)) : '',
          question_text: row.문제내용 ? removeHtmlTags(String(row.문제내용)) : '',
          question_text_forward: row.문제앞텍스트 ? removeHtmlTags(String(row.문제앞텍스트)) : '',
          question_text_backward: row.문제뒤텍스트 ? removeHtmlTags(String(row.문제뒤텍스트)) : '',
          choices: (() => {
            console.log(`[Bulk Upload] Row ${rowNumber} (error case): Parsing choices for partial question`)
            // option 컬럼 처리
            if (row.option !== undefined && row.option !== null && row.option !== '') {
              try {
                if (typeof row.option === 'string') {
                  if (row.option.trim().startsWith('[') || row.option.trim().startsWith('{')) {
                    const parsed = JSON.parse(row.option.trim())
                    if (Array.isArray(parsed)) {
                      return parsed.map(c => removeHtmlTags(String(c))).filter(c => c !== '')
                    } else if (parsed.choices && Array.isArray(parsed.choices)) {
                      return parsed.choices.map((c: any) => {
                        if (typeof c === 'string') return removeHtmlTags(c)
                        if (c && typeof c === 'object' && c.text) return removeHtmlTags(String(c.text))
                        return removeHtmlTags(String(c))
                      }).filter(c => c !== '')
                    }
                  } else {
                    return row.option.split(',').map(c => removeHtmlTags(c)).filter(c => c !== '')
                  }
                } else if (Array.isArray(row.option)) {
                  return row.option.map(c => removeHtmlTags(String(c))).filter(c => c !== '')
                }
              } catch (e) {
                console.warn(`[Bulk Upload] Row ${rowNumber} (error case): Failed to parse option:`, e)
                // 파싱 실패 시 빈 배열
              }
            }
            // 기존 방식
            const choiceArray = [
              row.선택지1 ? removeHtmlTags(String(row.선택지1)) : '',
              row.선택지2 ? removeHtmlTags(String(row.선택지2)) : '',
              row.선택지3 ? removeHtmlTags(String(row.선택지3)) : '',
              row.선택지4 ? removeHtmlTags(String(row.선택지4)) : '',
              row.선택지5 ? removeHtmlTags(String(row.선택지5)) : '',
            ]
            const filtered = choiceArray.filter(c => c !== '')
            console.log(`[Bulk Upload] Row ${rowNumber} (error case): Final choices:`, filtered)
            return filtered
          })(),
          answer: row.정답 ? removeHtmlTags(String(row.정답)) : '',
          explanation: row.해설 ? removeHtmlTags(String(row.해설)) : '',
          grade_level: row.학년 ? String(row.학년).trim() : '',
          difficulty: row.난이도 ? String(row.난이도).trim() : '',
          isValid: false,
          errorMessage: error.message,
        }
        
        results.push({
          success: false,
          row: rowNumber,
          question: partialQuestion,
          error: error.message,
        })
      }
    }
    
    // 5. Return parsed questions (NO DB save)
    const validCount = results.filter(r => r.success).length
    const invalidCount = results.filter(r => !r.success).length
    
    return NextResponse.json({
      success: true,
      summary: {
        total: rows.length,
        valid: validCount,
        invalid: invalidCount,
      },
      questions: results.map(r => r.question),
      problemTypes: problemTypes?.map(pt => ({ id: pt.id, type_name: pt.type_name })) || [],
    }, { status: 200 })
    
  } catch (error) {
    console.error('[Bulk Upload] Error:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}
