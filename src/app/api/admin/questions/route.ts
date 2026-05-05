import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { isUuidishString } from '@/lib/question-bank/validation'

type BankQuestionRow = {
  total_count?: number | null
  [key: string]: unknown
}

function withoutTotalCount(row: BankQuestionRow) {
  const question = { ...row }
  delete question.total_count
  return question
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check admin authentication
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
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const rawPage = Number.parseInt(searchParams.get('page') || '1', 10)
    const rawLimit = Number.parseInt(searchParams.get('limit') || '20', 10)
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 20
    const search = searchParams.get('search') || ''
    const gradeLevel = searchParams.get('grade_level') || ''
    const difficulty = searchParams.get('difficulty') || ''
    const problemTypeId = (searchParams.get('problem_type_id') || '').trim()
    const yearId = (searchParams.get('year_id') || searchParams.get('yearId') || '').trim()
    const bookId = (searchParams.get('book_id') || searchParams.get('bookId') || '').trim()
    const sortBy = searchParams.get('sort_by') || 'created_at'
    const sortOrder = searchParams.get('sort_order') || 'desc'
    const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))

    if (
      (problemTypeId && !isUuidishString(problemTypeId)) ||
      (yearId && !isUuidishString(yearId)) ||
      (bookId && !isUuidishString(bookId))
    ) {
      return NextResponse.json({ error: 'Invalid question bank filter' }, { status: 400 })
    }

    const offset = (page - 1) * limit

    const { data: bankQuestions, error } = await supabase
      .rpc('admin_list_bank_questions', {
        p_workspace_subject: workspaceSubject,
        p_year_id: yearId || null,
        p_book_id: bookId || null,
        p_problem_type_id: problemTypeId || null,
        p_source: 'admin_uploaded',
        p_search: search || null,
        p_grade_level: gradeLevel || null,
        p_difficulty: difficulty || null,
        p_sort_by: sortBy,
        p_sort_order: sortOrder,
        p_limit: limit,
        p_offset: offset,
      })

    if (error) {
      console.error('Error fetching questions:', error)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    const bankQuestionRows = (bankQuestions || []) as BankQuestionRow[]
    let total = bankQuestionRows[0]?.total_count || 0

    if (bankQuestionRows.length === 0 && offset > 0) {
      const { data: fallbackBankQuestions, error: fallbackError } = await supabase
        .rpc('admin_list_bank_questions', {
          p_workspace_subject: workspaceSubject,
          p_year_id: yearId || null,
          p_book_id: bookId || null,
          p_problem_type_id: problemTypeId || null,
          p_source: 'admin_uploaded',
          p_search: search || null,
          p_grade_level: gradeLevel || null,
          p_difficulty: difficulty || null,
          p_sort_by: sortBy,
          p_sort_order: sortOrder,
          p_limit: 1,
          p_offset: 0,
        })

      if (fallbackError) {
        console.error('Error fetching question count fallback:', fallbackError)
        return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
      }

      const fallbackRows = (fallbackBankQuestions || []) as BankQuestionRow[]
      total = fallbackRows[0]?.total_count || 0
    }

    const questions = bankQuestionRows.map(withoutTotalCount)

    return NextResponse.json({
      questions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error in admin questions route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
