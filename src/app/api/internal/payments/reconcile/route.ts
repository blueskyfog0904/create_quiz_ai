import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reconcilePendingPayments } from '@/lib/payment-reconciliation-server'

export const dynamic = 'force-dynamic'

const reconcileSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
}).strict()

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  return Boolean(
    cronSecret &&
      request.headers.get('Authorization') === `Bearer ${cronSecret}`
  )
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = reconcileSchema.safeParse(
    await request.json().catch(() => ({}))
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '재처리 요청이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  const run = await reconcilePendingPayments(parsed.data.limit)
  return NextResponse.json({
    success: true,
    acquired: run.acquired,
    runId: run.runId,
    backlog: run.backlog,
    processed: run.results.length,
    results: run.results,
  })
}
