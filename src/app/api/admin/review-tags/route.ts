import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createMarketReviewTag, listMarketReviewTagsForAdmin } from '@/lib/market-reviews-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

// 후기 태그는 후기 관리 권한(reviews.manage)으로 다룬다.
async function requireAdminUser() {
  const guard = await requireAdminApiPermission('reviews.manage')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
  const tags = await listMarketReviewTagsForAdmin(workspaceSubject)
  return NextResponse.json({ success: true, data: tags })
}

const CreateSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']),
  label: z.string().min(1).max(80),
  sort_order: z.number().int().optional(),
})

export async function POST(request: NextRequest) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  const result = await createMarketReviewTag({
    workspaceSubject: parsed.data.workspace_subject,
    label: parsed.data.label,
    sortOrder: parsed.data.sort_order,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
