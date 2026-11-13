import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cleanupAutoUploadDraftMarketItems } from '@/lib/market-item-cleanup'
import { cleanupRemovedManualSampleUploadTargets } from '@/lib/market-sample-pages-server'
import { retryMarketStorageCleanup } from '@/lib/market-storage-cleanup'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'
// 정리할 파일이 많을 때도 끝까지 돌도록(자동 실행 쪽 대기 시간은 55초)
export const maxDuration = 60

const CLEANUP_TASKS = ['autoUploadDrafts', 'manualSampleUploadTargets', 'storageCleanup'] as const

const CleanupRequestSchema = z.object({
  subject: z.string().optional(),
  olderThanHours: z.number().int().min(1).max(24 * 30).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
  // 실행할 정리 작업. 생략하면 전부 실행한다.
  tasks: z.array(z.enum(CLEANUP_TASKS)).min(1).optional(),
// 모르는 키는 거절한다(키를 잘못 써서 뜻하지 않게 전체 정리가 실행되지 않게).
}).strict()

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

    const workspaceSubject = resolveWorkspaceSubject(parsed.data.subject)
    const tasks = new Set(parsed.data.tasks ?? CLEANUP_TASKS)
    const result = tasks.has('autoUploadDrafts')
      ? await cleanupAutoUploadDraftMarketItems({
        workspaceSubject,
        olderThanHours: parsed.data.olderThanHours,
        limit: parsed.data.limit,
        dryRun: parsed.data.dryRun ?? true,
      })
      : null
    const manualSampleUploadTargets = tasks.has('manualSampleUploadTargets')
      ? await cleanupRemovedManualSampleUploadTargets({
        workspaceSubject,
        olderThanHours: parsed.data.olderThanHours,
        limit: parsed.data.limit,
        dryRun: parsed.data.dryRun ?? true,
      })
      : null
    // 상품 삭제 뒤 지우지 못한 파일을 다시 정리한다(과목과 무관한 대기 표).
    // 이 단계가 실패해도 앞에서 끝난 정리 결과는 그대로 돌려준다.
    const storageCleanup = tasks.has('storageCleanup')
      ? await retryMarketStorageCleanup({
        limit: parsed.data.limit,
        dryRun: parsed.data.dryRun ?? true,
      }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : '남은 파일 정리에 실패했습니다.' }))
      : null

    return NextResponse.json({ success: true, data: { autoUploadDrafts: result, manualSampleUploadTargets, storageCleanup } })
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
