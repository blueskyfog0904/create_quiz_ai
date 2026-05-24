import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createClient } from '@/lib/supabase/server'
import { hardDeleteMarketItemWithAssets } from '@/lib/market-item-cleanup'
import { getMarketItemById, listMarketItemFiles, updateMarketItem } from '@/lib/market-items-server'

export const dynamic = 'force-dynamic'

const MarketItemUpdateSchema = z.object({
  menuEntryId: z.string().uuid().optional(),
  title: z.string().trim().min(1),
  summary: z.string().trim().optional(),
  description: z.string().trim().optional(),
  thumbnailUrl: z.string().trim().optional(),
  examYear: z.number().int().nullable().optional(),
  examMonth: z.number().int().min(1).max(12).nullable().optional(),
  gradeLevel: z.string().trim().optional(),
  sourceType: z.string().trim().optional(),
  source1: z.string().trim().optional(),
  source2: z.string().trim().optional(),
  source3: z.string().trim().optional(),
  source4: z.string().trim().optional(),
  pdfPrice: z.number().int().min(0),
  hwpPrice: z.number().int().min(0),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(['draft', 'published', 'hidden', 'archived']).optional(),
  draftSource: z.enum(['manual', 'auto_upload']).optional(),
  isActive: z.boolean().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, isAdmin: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return {
    user,
    isAdmin: Boolean(profile?.is_admin),
  }
}

export async function GET(_: Request, { params }: RouteContext) {
  const { user, isAdmin } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(_.url).searchParams.get('subject'))

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const files = await listMarketItemFiles(id, true, workspaceSubject)

    return NextResponse.json({ success: true, data: { item, files } })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { user, isAdmin } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  try {
    const body = await request.json()
    const parsed = MarketItemUpdateSchema.safeParse(body)
    const currentItem = await getMarketItemById(id, workspaceSubject)

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    if (!currentItem) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const item = await updateMarketItem(id, {
      menu_entry_id: parsed.data.menuEntryId,
      title: parsed.data.title,
      summary: parsed.data.summary,
      description: parsed.data.description,
      thumbnail_url: parsed.data.thumbnailUrl,
      exam_year: parsed.data.examYear ?? null,
      exam_month: parsed.data.examMonth ?? null,
      grade_level: parsed.data.gradeLevel,
      source_type: parsed.data.sourceType,
      source_1: parsed.data.source1,
      source_2: parsed.data.source2,
      source_3: parsed.data.source3,
      source_4: parsed.data.source4,
      pdf_price: parsed.data.pdfPrice,
      hwp_price: parsed.data.hwpPrice,
      sort_order: parsed.data.sortOrder,
      status: parsed.data.status,
      draft_source: parsed.data.draftSource,
      is_active: parsed.data.isActive,
      updated_by: user.id,
    })

    return NextResponse.json({ success: true, data: item })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품 수정에 실패했습니다.',
      },
    }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  const { user, isAdmin } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(_.url).searchParams.get('subject'))

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    await hardDeleteMarketItemWithAssets({
      itemId: id,
      workspaceSubject: item.workspace_subject,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품 완전 삭제에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
