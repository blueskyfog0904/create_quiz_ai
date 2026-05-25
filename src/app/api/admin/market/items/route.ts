import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createMarketItem, listMarketItemsForAdmin } from '@/lib/market-items-server'
import { listMarketMenuEntriesForAdmin } from '@/lib/market-menu-server'

export const dynamic = 'force-dynamic'

const MarketItemSchema = z.object({
  menuEntryId: z.string().uuid(),
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
  questionCount: z.number().int().min(0).nullable().optional(),
  pdfPrice: z.number().int().min(0),
  hwpPrice: z.number().int().min(0),
  zipPrice: z.number().int().min(0),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(['draft', 'published', 'hidden', 'archived']).optional(),
  draftSource: z.enum(['manual', 'auto_upload']).optional(),
  isActive: z.boolean().optional(),
})

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

export async function GET(request: Request) {
  const { user, isAdmin } = await requireAdminUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const menuEntryId = searchParams.get('menuEntryId') || undefined
    const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))
    const items = await listMarketItemsForAdmin(menuEntryId, workspaceSubject)

    return NextResponse.json({ success: true, data: items })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품 목록을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { user, isAdmin } = await requireAdminUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  try {
    const body = await request.json()
    const parsed = MarketItemSchema.safeParse(body)
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const availableMenuEntries = await listMarketMenuEntriesForAdmin(workspaceSubject)
    if (!availableMenuEntries.some((entry) => entry.id === parsed.data.menuEntryId && entry.deleted_at === null)) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '선택한 과목 작업공간에 속한 문제마켓 카테고리를 선택해주세요.' },
      }, { status: 400 })
    }

    const item = await createMarketItem({
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
      question_count: parsed.data.questionCount ?? null,
      pdf_price: parsed.data.pdfPrice,
      hwp_price: parsed.data.hwpPrice,
      zip_price: parsed.data.zipPrice,
      sort_order: parsed.data.sortOrder ?? 0,
      status: parsed.data.status ?? 'draft',
      draft_source: parsed.data.draftSource,
      is_active: parsed.data.isActive ?? true,
      created_by: user.id,
      updated_by: user.id,
    })

    return NextResponse.json({ success: true, data: item }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품 생성에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
