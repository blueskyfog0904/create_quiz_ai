import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cleanupAutoUploadDraftMarketItems } from '@/lib/market-item-cleanup'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

const CleanupRequestSchema = z.object({
  subject: z.string().optional(),
  olderThanHours: z.number().int().min(1).max(24 * 30).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
})

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('Authorization')

  return Boolean(cronSecret && authorization === `Bearer ${cronSecret}`)
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '정리 작업 권한이 없습니다.' } }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = CleanupRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const result = await cleanupAutoUploadDraftMarketItems({
      workspaceSubject: resolveWorkspaceSubject(parsed.data.subject),
      olderThanHours: parsed.data.olderThanHours,
      limit: parsed.data.limit,
      dryRun: parsed.data.dryRun ?? true,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '자동 업로드 임시 상품 정리에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
