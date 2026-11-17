import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import {
  buildFilledTemplateWorkbook,
  validateFilledTemplateQuestions,
} from '@/lib/question-bank/filled-template'

// 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
async function requireAdminUser() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser()

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
