import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { extractHwpxTextFromBuffer, validateHwpxUploadFile } from '@/lib/question-bank/hwpx-extractor'
import { analyzeHwpxTextWithOpenAI } from '@/lib/question-bank/hwpx-ai'
import { buildHwpxPreviewQuestion } from '@/lib/question-bank/hwpx-preview'

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

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const yearId = String(formData.get('yearId') || '')
    const bookId = String(formData.get('bookId') || '')
    const defaultGradeLevel = String(formData.get('defaultGradeLevel') || '')
    const defaultDifficulty = String(formData.get('defaultDifficulty') || '')
    const sourceType = String(formData.get('sourceType') || '')

    if (!file) {
      return NextResponse.json({ error: 'HWPX 파일이 필요합니다.' }, { status: 400 })
    }

    if (!yearId || !bookId) {
      return NextResponse.json({ error: '연도와 교재를 선택해주세요.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileValidation = validateHwpxUploadFile(file.name, buffer)

    if (!fileValidation.ok) {
      return NextResponse.json({ error: fileValidation.reason }, { status: 400 })
    }

    const [
      { data: years },
      { data: books },
      { data: problemTypes, error: problemTypesError },
    ] = await Promise.all([
      supabase
        .from('question_bank_years')
        .select('id, year, label, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true),
      supabase
        .from('question_bank_books')
        .select('id, name, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true),
      supabase
        .from('question_bank_problem_types')
        .select('id, type_name, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true)
        .order('type_name'),
    ])

    if (problemTypesError) {
      return NextResponse.json({ error: '문제은행 문제유형을 불러오지 못했습니다.' }, { status: 500 })
    }

    if (!years?.some((year) => year.id === yearId)) {
      return NextResponse.json({ error: '활성 연도를 찾을 수 없습니다.' }, { status: 400 })
    }

    if (!books?.some((book) => book.id === bookId)) {
      return NextResponse.json({ error: '활성 교재를 찾을 수 없습니다.' }, { status: 400 })
    }

    const extracted = await extractHwpxTextFromBuffer(buffer)
    const analysis = await analyzeHwpxTextWithOpenAI({
      text: extracted.text,
      problemTypes: problemTypes || [],
      defaultGradeLevel,
      defaultDifficulty,
      sourceType,
    })
    const problemTypeById = new Map((problemTypes || []).map((type) => [type.id, type]))
    const problemTypeByName = new Map((problemTypes || []).map((type) => [type.type_name, type]))
    const questions = analysis.questions.map((row, rowIndex) => buildHwpxPreviewQuestion({
      row,
      rowIndex,
      yearId,
      bookId,
      problemTypeById,
      problemTypeByName,
      defaultGradeLevel,
      defaultDifficulty,
      sourceType,
    }))
    const previewQuestions = questions.map((question) => ({
      ...question,
      conversionStatus: question.conversionStatus,
      confidence: question.confidence,
      sourceSnippet: question.sourceSnippet,
    }))

    const valid = previewQuestions.filter((question) => question.conversionStatus === 'valid').length
    const invalid = previewQuestions.filter((question) => question.conversionStatus === 'invalid').length
    const needsReview = previewQuestions.filter((question) => question.conversionStatus === 'needs_review').length

    return NextResponse.json({
      success: true,
      summary: { total: previewQuestions.length, valid, invalid, needsReview },
      questions: previewQuestions,
      warnings: [...extracted.warnings, ...analysis.warnings],
      usage: analysis.usage,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HWPX 분석 중 오류가 발생했습니다.'
    const status = /크기가 너무 큽니다|너무 많습니다|나누어 업로드|한도를 초과/.test(message) ? 413 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
