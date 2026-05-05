import { createClient } from '@/lib/supabase/server'
import { MAX_RANDOM_EXAM_QUESTION_COUNT } from '@/lib/question-bank/random-exam'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const RandomBankExamSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해주세요.'),
  yearId: z.string().uuid('학년/연도 ID가 올바르지 않습니다.'),
  bookId: z.string().uuid('교재 ID가 올바르지 않습니다.'),
  typeCounts: z.array(z.object({
    problemTypeId: z.string().uuid('문제 유형 ID가 올바르지 않습니다.'),
    count: z.number().int().positive('문항 수는 1 이상의 정수여야 합니다.'),
  })).min(1, '문항을 1개 이상 선택해주세요.'),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  subject: z.enum(['english', 'korean']).optional(),
})

type RandomBankExamRpcRow = {
  exam_paper_id: string
  selected_question_ids: string[]
  total_count: number
}

type RpcError = {
  code?: string
  details?: string | null
  message?: string
}

type RpcErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_SCOPE'
  | 'INACTIVE_DIMENSION'
  | 'DUPLICATE_TYPE'
  | 'COUNT_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_QUESTIONS'

const RPC_ERROR_CODES: RpcErrorCode[] = [
  'AUTH_REQUIRED',
  'INVALID_SCOPE',
  'INACTIVE_DIMENSION',
  'DUPLICATE_TYPE',
  'COUNT_LIMIT_EXCEEDED',
  'INSUFFICIENT_QUESTIONS',
]

function getRpcErrorCode(error: RpcError): RpcErrorCode | null {
  const errorText = [error.code, error.message, error.details]
    .filter(Boolean)
    .join(' ')

  return RPC_ERROR_CODES.find((code) => errorText.includes(code)) ?? null
}

function getRpcErrorStatus(code: RpcErrorCode | null) {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 401
    case 'INVALID_SCOPE':
      return 400
    case 'INACTIVE_DIMENSION':
      return 400
    case 'DUPLICATE_TYPE':
      return 400
    case 'COUNT_LIMIT_EXCEEDED':
      return 400
    case 'INSUFFICIENT_QUESTIONS':
      return 409
    default:
      return 500
  }
}

function getRpcErrorMessage(code: RpcErrorCode | null) {
  switch (code) {
    case 'AUTH_REQUIRED':
      return '로그인이 필요합니다.'
    case 'INVALID_SCOPE':
      return '요청 범위가 올바르지 않습니다.'
    case 'INACTIVE_DIMENSION':
      return '사용할 수 없는 학년/교재입니다.'
    case 'DUPLICATE_TYPE':
      return '동일한 문제 유형이 중복 선택되었습니다.'
    case 'COUNT_LIMIT_EXCEEDED':
      return `전체 문항 수는 ${MAX_RANDOM_EXAM_QUESTION_COUNT}개 이하여야 합니다.`
    case 'INSUFFICIENT_QUESTIONS':
      return '요청한 유형/문항 수에 맞는 문제가 부족합니다.'
    default:
      return '랜덤 문제지를 생성하지 못했습니다.'
  }
}

function findDuplicateProblemTypeId(typeCounts: { problemTypeId: string }[]) {
  const seen = new Set<string>()

  for (const typeCount of typeCounts) {
    if (seen.has(typeCount.problemTypeId)) {
      return typeCount.problemTypeId
    }

    seen.add(typeCount.problemTypeId)
  }

  return null
}

function normalizeRpcRow(data: RandomBankExamRpcRow[] | RandomBankExamRpcRow | null) {
  return Array.isArray(data) ? data[0] : data
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: '로그인이 필요합니다.',
      }, { status: 401 })
    }

    let body: unknown

    try {
      body = await request.json()
    } catch {
      return NextResponse.json({
        success: false,
        code: 'INVALID_INPUT',
        message: '요청 본문이 올바른 JSON 형식이 아닙니다.',
      }, { status: 400 })
    }

    const validation = RandomBankExamSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        code: 'INVALID_INPUT',
        message: validation.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.',
      }, { status: 400 })
    }

    const { title, yearId, bookId, typeCounts } = validation.data
    const workspaceSubject = validation.data.workspaceSubject ?? validation.data.subject ?? DEFAULT_WORKSPACE_SUBJECT
    const duplicateProblemTypeId = findDuplicateProblemTypeId(typeCounts)

    if (duplicateProblemTypeId) {
      return NextResponse.json({
        success: false,
        code: 'DUPLICATE_TYPE',
        message: '동일한 문제 유형이 중복 선택되었습니다.',
        problemTypeId: duplicateProblemTypeId,
      }, { status: 400 })
    }

    const requestedTotalCount = typeCounts.reduce((sum, typeCount) => sum + typeCount.count, 0)

    if (requestedTotalCount > MAX_RANDOM_EXAM_QUESTION_COUNT) {
      return NextResponse.json({
        success: false,
        code: 'COUNT_LIMIT_EXCEEDED',
        message: `전체 문항 수는 ${MAX_RANDOM_EXAM_QUESTION_COUNT}개 이하여야 합니다.`,
      }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('create_random_bank_exam_paper', {
      p_workspace_subject: workspaceSubject,
      p_title: title,
      p_year_id: yearId,
      p_book_id: bookId,
      p_type_counts: typeCounts,
    })

    if (error) {
      const code = getRpcErrorCode(error)
      const status = getRpcErrorStatus(code)

      if (status === 500) {
        console.error('[Random Bank Exam] RPC error:', error)
      }

      return NextResponse.json({
        success: false,
        code: code ?? 'RANDOM_BANK_EXAM_CREATE_FAILED',
        message: getRpcErrorMessage(code),
      }, { status })
    }

    const rpcRow = normalizeRpcRow(data)

    if (!rpcRow) {
      console.error('[Random Bank Exam] RPC returned no row')
      return NextResponse.json({
        success: false,
        code: 'RANDOM_BANK_EXAM_CREATE_FAILED',
        message: '랜덤 문제지를 생성하지 못했습니다.',
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      examPaperId: rpcRow.exam_paper_id,
      selectedQuestionIds: rpcRow.selected_question_ids,
      totalCount: rpcRow.total_count,
    })
  } catch (error) {
    console.error('[Random Bank Exam] Error:', error)
    return NextResponse.json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: '서버 오류가 발생했습니다.',
    }, { status: 500 })
  }
}
