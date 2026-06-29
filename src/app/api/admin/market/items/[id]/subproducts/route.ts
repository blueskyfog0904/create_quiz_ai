import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  createMarketItemSubproduct,
  getMarketItemById,
  listMarketItemSubproductsForAdmin,
} from '@/lib/market-items-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SubproductSchema = z.object({
  categoryId: z.string().uuid(),
  description: z.string().trim().optional().nullable(),
  purchaseNoticeLabel: z.string().trim().max(24).optional().nullable(),
  purchaseNoticeText: z.string().trim().max(160).optional().nullable(),
  priceCredits: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
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

export async function GET(request: Request, { params }: RouteContext) {
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
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const subproducts = await listMarketItemSubproductsForAdmin(id, workspaceSubject)
    return NextResponse.json({ success: true, data: subproducts })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 목록을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: RouteContext) {
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
    const parsed = SubproductSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const subproduct = await createMarketItemSubproduct({
      itemId: id,
      workspaceSubject,
      categoryId: parsed.data.categoryId,
      description: parsed.data.description,
      purchaseNoticeLabel: parsed.data.purchaseNoticeLabel,
      purchaseNoticeText: parsed.data.purchaseNoticeText,
      priceCredits: parsed.data.priceCredits,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
    })

    return NextResponse.json({ success: true, data: subproduct }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 생성에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
