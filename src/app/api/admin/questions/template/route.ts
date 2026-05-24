import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { QUESTION_UPLOAD_TEMPLATE_HEADERS } from '@/lib/question-bank/filled-template'

async function requireAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }

  return { user }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    const [{ data: problemTypes, error: problemTypesError }, { data: years, error: yearsError }, { data: books, error: booksError }] = await Promise.all([
      supabase
        .from('question_bank_problem_types')
        .select('id, type_name')
        .eq('is_active', true)
        .eq('workspace_subject', workspaceSubject)
        .order('type_name'),
      supabase
        .from('question_bank_years')
        .select('id, year, label, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('year', { ascending: false }),
      supabase
        .from('question_bank_books')
        .select('id, name, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ])

    if (problemTypesError || yearsError || booksError) {
      console.error('[Template] Metadata fetch error:', problemTypesError || yearsError || booksError)
      return NextResponse.json({ error: 'Failed to fetch template metadata' }, { status: 500 })
    }

    const workbook = XLSX.utils.book_new()
    const firstYear = years?.[0]
    const firstBook = books?.[0]

    const mainSheetHeaders = [...QUESTION_UPLOAD_TEMPLATE_HEADERS]

    const sampleData = [
      firstYear?.year || '2025',
      firstBook?.name || '수능특강',
      problemTypes && problemTypes.length > 0 ? problemTypes[0].id : '',
      problemTypes && problemTypes.length > 0 ? problemTypes[0].type_name : '문장삽입형 문제',
      'The development of technology has changed the way we communicate. (A) However, not all changes have been positive. (B) Social media, for example, has made it easier to stay connected with friends and family. (C) On the other hand, it has also led to concerns about privacy and mental health.',
      '',
      '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?',
      '',
      '["(A)-(C)-(B)", "(B)-(A)-(C)", "(B)-(C)-(A)", "(C)-(A)-(B)", "(C)-(B)-(A)"]',
      '(A)-(C)-(B)',
      '(B)-(A)-(C)',
      '(B)-(C)-(A)',
      '(C)-(A)-(B)',
      '(C)-(B)-(A)',
      '3',
      '글의 흐름상 기술 발전의 긍정적 측면을 먼저 언급한 후(B), 부정적 측면으로 전환(C)하고, 마지막으로 균형 잡힌 시각(A)으로 마무리하는 것이 자연스럽습니다.',
      '고1',
      '중',
      '모의고사',
      '2023년 3월',
      '31번',
      '',
      '',
    ]

    const guidanceData = [
      ['필수 메타데이터 안내'],
      ['year', '연도목록 시트의 활성 연도 숫자를 입력하거나 yearId 컬럼을 추가해 ID를 직접 입력할 수 있습니다.'],
      ['교재명', '교재목록 시트의 활성 교재명을 그대로 입력합니다. bookId 컬럼을 추가해 ID를 직접 입력할 수도 있습니다.'],
      ['bankProblemTypeId', '문제은행유형목록 시트의 bankProblemTypeId를 입력하면 문제유형 이름보다 우선합니다.'],
      ['문제유형', '문제유형목록 시트의 문제유형이름을 그대로 입력합니다. bankProblemTypeId가 없을 때 이름으로 찾습니다.'],
    ]

    const mainSheet = XLSX.utils.aoa_to_sheet([mainSheetHeaders, sampleData])
    mainSheet['!cols'] = [
      { wch: 10 },
      { wch: 20 },
      { wch: 40 },
      { wch: 20 },
      { wch: 50 },
      { wch: 30 },
      { wch: 40 },
      { wch: 30 },
      { wch: 60 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 8 },
      { wch: 50 },
      { wch: 10 },
      { wch: 10 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
    ]
    XLSX.utils.book_append_sheet(workbook, mainSheet, '문제입력')

    const guidanceSheet = XLSX.utils.aoa_to_sheet(guidanceData)
    guidanceSheet['!cols'] = [{ wch: 18 }, { wch: 90 }]
    XLSX.utils.book_append_sheet(workbook, guidanceSheet, '작성안내')

    const typeSheet = XLSX.utils.aoa_to_sheet([
      ['bankProblemTypeId', '문제유형이름'],
      ...(problemTypes || []).map((type) => [type.id, type.type_name]),
    ])
    typeSheet['!cols'] = [{ wch: 40 }, { wch: 30 }]
    XLSX.utils.book_append_sheet(workbook, typeSheet, '문제은행유형목록')

    const yearsSheet = XLSX.utils.aoa_to_sheet([
      ['yearId', 'year', 'label', 'is_active'],
      ...(years || []).map((year) => [year.id, year.year, year.label, year.is_active]),
    ])
    yearsSheet['!cols'] = [{ wch: 40 }, { wch: 10 }, { wch: 20 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(workbook, yearsSheet, '연도목록')

    const booksSheet = XLSX.utils.aoa_to_sheet([
      ['bookId', '교재명', 'is_active'],
      ...(books || []).map((book) => [book.id, book.name, book.is_active]),
    ])
    booksSheet['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(workbook, booksSheet, '교재목록')

    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    })

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="question_upload_template.xlsx"',
      },
    })
  } catch (error) {
    console.error('[Template] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
