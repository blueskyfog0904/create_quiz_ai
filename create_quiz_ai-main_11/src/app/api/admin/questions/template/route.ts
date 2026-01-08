import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function GET() {
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
    
    // 2. Fetch problem types from database
    const { data: problemTypes, error: problemTypesError } = await supabase
      .from('problem_types')
      .select('id, type_name')
      .eq('is_active', true)
      .order('type_name')
    
    if (problemTypesError) {
      console.error('[Template] Error fetching problem types:', problemTypesError)
      return NextResponse.json({ error: 'Failed to fetch problem types' }, { status: 500 })
    }
    
    // 3. Create workbook with two sheets
    const workbook = XLSX.utils.book_new()
    
    // Sheet 1: 문제 입력 (Main sheet with sample data)
    const mainSheetHeaders = [
      '문제유형',
      '지문',
      '문제앞텍스트',
      '문제내용',
      '문제뒤텍스트',
      'option', // option 컬럼 (JSON 배열 형식 또는 쉼표 구분 문자열)
      '선택지1', // 기존 방식도 유지 (option이 없을 경우 사용)
      '선택지2',
      '선택지3',
      '선택지4',
      '선택지5',
      '정답',
      '해설',
      '학년',
      '난이도'
    ]
    
    // Sample data row
    const sampleData = [
      problemTypes && problemTypes.length > 0 ? problemTypes[0].type_name : '문장삽입형 문제',
      'The development of technology has changed the way we communicate. (A) However, not all changes have been positive. (B) Social media, for example, has made it easier to stay connected with friends and family. (C) On the other hand, it has also led to concerns about privacy and mental health.',
      '', // 문제앞텍스트 (선택)
      '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?',
      '', // 문제뒤텍스트 (선택)
      '["(A)-(C)-(B)", "(B)-(A)-(C)", "(B)-(C)-(A)", "(C)-(A)-(B)", "(C)-(B)-(A)"]', // option 컬럼 예시 (JSON 배열 형식)
      '(A)-(C)-(B)', // 기존 방식 (option이 없을 경우 사용)
      '(B)-(A)-(C)',
      '(B)-(C)-(A)',
      '(C)-(A)-(B)',
      '(C)-(B)-(A)',
      '3',
      '글의 흐름상 기술 발전의 긍정적 측면을 먼저 언급한 후(B), 부정적 측면으로 전환(C)하고, 마지막으로 균형 잡힌 시각(A)으로 마무리하는 것이 자연스럽습니다.',
      '고1',
      '중'
    ]
    
    const mainSheetData = [mainSheetHeaders, sampleData]
    const mainSheet = XLSX.utils.aoa_to_sheet(mainSheetData)
    
    // Set column widths for better readability
    mainSheet['!cols'] = [
      { wch: 20 },  // 문제유형
      { wch: 50 },  // 지문
      { wch: 30 },  // 문제앞텍스트
      { wch: 40 },  // 문제내용
      { wch: 30 },  // 문제뒤텍스트
      { wch: 60 },  // option (JSON 배열 형식)
      { wch: 20 },  // 선택지1
      { wch: 20 },  // 선택지2
      { wch: 20 },  // 선택지3
      { wch: 20 },  // 선택지4
      { wch: 20 },  // 선택지5
      { wch: 8 },   // 정답
      { wch: 50 },  // 해설
      { wch: 10 },  // 학년
      { wch: 10 },  // 난이도
    ]
    
    XLSX.utils.book_append_sheet(workbook, mainSheet, '문제입력')
    
    // Sheet 2: 문제유형목록 (Reference sheet)
    const refSheetHeaders = ['문제유형ID', '문제유형이름']
    const refSheetData = [refSheetHeaders]
    
    if (problemTypes) {
      problemTypes.forEach(type => {
        refSheetData.push([type.id, type.type_name])
      })
    }
    
    const refSheet = XLSX.utils.aoa_to_sheet(refSheetData)
    refSheet['!cols'] = [
      { wch: 40 },  // 문제유형ID
      { wch: 30 },  // 문제유형이름
    ]
    
    XLSX.utils.book_append_sheet(workbook, refSheet, '문제유형목록')
    
    // 4. Generate Excel buffer
    const excelBuffer = XLSX.write(workbook, { 
      type: 'buffer', 
      bookType: 'xlsx' 
    })
    
    // 5. Return as downloadable file
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="question_upload_template.xlsx"',
      },
    })
    
  } catch (error) {
    console.error('[Template] Error:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

