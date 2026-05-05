import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
}

function removeHtmlTags(text: string | null | undefined): string {
  if (!text) return ''
  if (typeof text !== 'string') return String(text)

  return text.replace(/<br\s*\/?>/gi, '').trim()
}

interface QuestionRow {
  문제유형: string
  지문?: string
  문제앞텍스트?: string
  문제내용: string
  문제뒤텍스트?: string
  option?: string | unknown
  선택지1?: string
  선택지2?: string
  선택지3?: string
  선택지4?: string
  선택지5?: string
  정답: string | number
  해설?: string
  학년?: string
  난이도?: string
  출처종류?: string
  출처1?: string
  출처2?: string
  출처3?: string
  출처4?: string
  yearId?: string
  bookId?: string
  year?: string | number
  bookSlug?: string
  book?: string
}

interface ParsedQuestion {
  id: string
  clientRowId: string
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
  yearId: string
  bookId: string
  isValid: boolean
  errorMessage?: string
  source_type?: string
  source_1?: string
  source_2?: string
  source_3?: string
  source_4?: string
}

interface ParseResult {
  success: boolean
  row: number
  question?: ParsedQuestion
  error?: string
}

type BankYear = { id: string, year: number, label: string | null, is_active: boolean | null }
type BankBook = { id: string, slug: string, name: string, is_active: boolean | null }

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

function parseChoices(row: QuestionRow) {
  if (row.option !== undefined && row.option !== null && row.option !== '') {
    try {
      if (typeof row.option === 'string') {
        if (row.option.trim().startsWith('[') || row.option.trim().startsWith('{')) {
          const parsed: unknown = JSON.parse(row.option.trim())
          if (Array.isArray(parsed)) {
            return parsed.map((c) => removeHtmlTags(String(c))).filter(Boolean)
          }
          if (parsed && typeof parsed === 'object' && 'choices' in parsed) {
            const parsedChoices = (parsed as { choices?: unknown }).choices
            if (Array.isArray(parsedChoices)) {
              return parsedChoices.map((c) => {
                if (typeof c === 'string') return removeHtmlTags(c)
                if (c && typeof c === 'object' && 'text' in c) return removeHtmlTags(String((c as { text?: unknown }).text))
                return removeHtmlTags(String(c))
              }).filter(Boolean)
            }
          }
        } else {
          return row.option.split(',').map((c) => removeHtmlTags(c)).filter(Boolean)
        }
      }

      if (Array.isArray(row.option)) {
        return row.option.map((c) => removeHtmlTags(String(c))).filter(Boolean)
      }
    } catch {
      return []
    }
  }

  return [row.선택지1, row.선택지2, row.선택지3, row.선택지4, row.선택지5]
    .map((choice) => choice ? removeHtmlTags(String(choice)) : '')
    .filter(Boolean)
}

function resolveQuestionBankMetadata(row: QuestionRow, years: BankYear[], books: BankBook[]) {
  const yearId = typeof row.yearId === 'string' ? row.yearId.trim() : ''
  const bookId = typeof row.bookId === 'string' ? row.bookId.trim() : ''
  let resolvedYear: BankYear | undefined
  let resolvedBook: BankBook | undefined

  if (yearId) {
    resolvedYear = years.find((year) => year.id === yearId)
    if (!resolvedYear) {
      throw new Error(`연도 ID "${yearId}"을(를) 찾을 수 없거나 비활성 상태입니다.`)
    }
  } else {
    const yearValue = row.year !== undefined && row.year !== null ? String(row.year).trim() : ''
    if (!yearValue) {
      throw new Error('year 또는 yearId가 필요합니다.')
    }
    resolvedYear = years.find((year) => String(year.year) === yearValue || year.label === yearValue)
    if (!resolvedYear) {
      throw new Error(`연도 "${yearValue}"을(를) 찾을 수 없거나 비활성 상태입니다.`)
    }
  }

  if (bookId) {
    resolvedBook = books.find((book) => book.id === bookId)
    if (!resolvedBook) {
      throw new Error(`교재 ID "${bookId}"을(를) 찾을 수 없거나 비활성 상태입니다.`)
    }
  } else {
    const bookValue = row.bookSlug?.trim() || row.book?.trim() || ''
    if (!bookValue) {
      throw new Error('bookSlug/book 또는 bookId가 필요합니다.')
    }
    resolvedBook = books.find((book) => book.slug === bookValue || book.name === bookValue)
    if (!resolvedBook) {
      throw new Error(`교재 "${bookValue}"을(를) 찾을 수 없거나 비활성 상태입니다.`)
    }
  }

  return { yearId: resolvedYear.id, bookId: resolvedBook.id }
}

function buildPartialQuestion(row: QuestionRow, rowNumber: number, error: unknown, problemTypeInfo?: { id: string, name: string }): ParsedQuestion {
  const clientRowId = `row-${rowNumber}`

  return {
    id: `parsed-${rowNumber}-${Date.now()}`,
    clientRowId,
    problem_type_id: problemTypeInfo?.id || '',
    problem_type_name: problemTypeInfo?.name || row.문제유형 || '',
    passage_text: row.지문 ? removeHtmlTags(String(row.지문)) : '',
    question_text: row.문제내용 ? removeHtmlTags(String(row.문제내용)) : '',
    question_text_forward: row.문제앞텍스트 ? removeHtmlTags(String(row.문제앞텍스트)) : '',
    question_text_backward: row.문제뒤텍스트 ? removeHtmlTags(String(row.문제뒤텍스트)) : '',
    choices: parseChoices(row),
    answer: row.정답 ? removeHtmlTags(String(row.정답)) : '',
    explanation: row.해설 ? removeHtmlTags(String(row.해설)) : '',
    grade_level: row.학년 ? String(row.학년).trim() : '',
    difficulty: row.난이도 ? String(row.난이도).trim() : '',
    yearId: typeof row.yearId === 'string' ? row.yearId : '',
    bookId: typeof row.bookId === 'string' ? row.bookId : '',
    source_type: row.출처종류 ? removeHtmlTags(String(row.출처종류)) : '',
    source_1: row.출처1 ? removeHtmlTags(String(row.출처1)) : '',
    source_2: row.출처2 ? removeHtmlTags(String(row.출처2)) : '',
    source_3: row.출처3 ? removeHtmlTags(String(row.출처3)) : '',
    source_4: row.출처4 ? removeHtmlTags(String(row.출처4)) : '',
    isValid: false,
    errorMessage: getErrorMessage(error),
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.csv')) {
      return NextResponse.json({ error: 'Invalid file format. Please upload .xlsx or .csv file' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows: QuestionRow[] = XLSX.utils.sheet_to_json(sheet)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data found in the file' }, { status: 400 })
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    const [{ data: problemTypes, error: problemTypesError }, { data: years, error: yearsError }, { data: books, error: booksError }] = await Promise.all([
      supabase
        .from('problem_types')
        .select('id, type_name')
        .eq('is_active', true)
        .eq('workspace_subject', workspaceSubject),
      supabase
        .from('question_bank_years')
        .select('id, year, label, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true),
      supabase
        .from('question_bank_books')
        .select('id, slug, name, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true),
    ])

    if (problemTypesError || yearsError || booksError) {
      console.error('[Bulk Upload] Metadata fetch error:', problemTypesError || yearsError || booksError)
      return NextResponse.json({ error: 'Failed to fetch upload metadata' }, { status: 500 })
    }

    const problemTypeMap = new Map<string, { id: string, name: string }>()
    problemTypes?.forEach((type) => {
      problemTypeMap.set(type.type_name, { id: type.id, name: type.type_name })
    })

    const results: ParseResult[] = []
    const validGradeLevels = ['중1', '중2', '중3', '고1', '고2', '고3']
    const validDifficulties = ['하', '중', '상']

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2
      const clientRowId = `row-${rowNumber}`
      const problemTypeInfo = problemTypeMap.get(row.문제유형)

      try {
        if (!row.문제유형) throw new Error('문제유형이 필요합니다.')
        if (!row.문제내용) throw new Error('문제내용이 필요합니다.')
        if (row.정답 === undefined || row.정답 === null || row.정답 === '') throw new Error('정답이 필요합니다.')
        if (!problemTypeInfo) throw new Error(`문제유형 "${row.문제유형}"을(를) 찾을 수 없습니다.`)

        const { yearId, bookId } = resolveQuestionBankMetadata(row, years || [], books || [])
        const gradeLevel = row.학년 && validGradeLevels.includes(String(row.학년).trim()) ? String(row.학년).trim() : ''
        const difficulty = row.난이도 && validDifficulties.includes(String(row.난이도).trim()) ? String(row.난이도).trim() : ''

        results.push({
          success: true,
          row: rowNumber,
          question: {
            id: `parsed-${rowNumber}-${Date.now()}`,
            clientRowId,
            problem_type_id: problemTypeInfo.id,
            problem_type_name: problemTypeInfo.name,
            passage_text: row.지문 ? removeHtmlTags(String(row.지문)) : '',
            question_text: removeHtmlTags(String(row.문제내용)),
            question_text_forward: row.문제앞텍스트 ? removeHtmlTags(String(row.문제앞텍스트)) : '',
            question_text_backward: row.문제뒤텍스트 ? removeHtmlTags(String(row.문제뒤텍스트)) : '',
            choices: parseChoices(row),
            answer: removeHtmlTags(String(row.정답)),
            explanation: row.해설 ? removeHtmlTags(String(row.해설)) : '',
            grade_level: gradeLevel,
            difficulty,
            yearId,
            bookId,
            source_type: row.출처종류 ? removeHtmlTags(String(row.출처종류)) : '',
            source_1: row.출처1 ? removeHtmlTags(String(row.출처1)) : '',
            source_2: row.출처2 ? removeHtmlTags(String(row.출처2)) : '',
            source_3: row.출처3 ? removeHtmlTags(String(row.출처3)) : '',
            source_4: row.출처4 ? removeHtmlTags(String(row.출처4)) : '',
            isValid: true,
          },
        })
      } catch (error: unknown) {
        results.push({
          success: false,
          row: rowNumber,
          question: buildPartialQuestion(row, rowNumber, error, problemTypeInfo),
          error: getErrorMessage(error),
        })
      }
    }

    const validCount = results.filter((result) => result.success).length
    const invalidCount = results.filter((result) => !result.success).length

    return NextResponse.json({
      success: true,
      summary: {
        total: rows.length,
        valid: validCount,
        invalid: invalidCount,
      },
      questions: results.map((result) => result.question),
      problemTypes: problemTypes?.map((pt) => ({ id: pt.id, type_name: pt.type_name })) || [],
      years: years || [],
      books: books || [],
    }, { status: 200 })
  } catch (error) {
    console.error('[Bulk Upload] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
