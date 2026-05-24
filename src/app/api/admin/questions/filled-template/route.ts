import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import {
  buildFilledTemplateWorkbook,
  validateFilledTemplateQuestions,
} from '@/lib/question-bank/filled-template'

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

    const body = await request.json()
    const questions = Array.isArray(body?.questions) ? body.questions : []

    validateFilledTemplateQuestions(questions)

    const workbook = buildFilledTemplateWorkbook(questions)
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="question_upload_template_filled.xlsx"',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '템플릿 생성 중 오류가 발생했습니다.'
    const status = /너무 큽니다|120개 이하/.test(message) ? 413 : 400

    return NextResponse.json({ error: message }, { status })
  }
}
