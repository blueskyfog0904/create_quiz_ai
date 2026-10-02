import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_IMAGE_MAX_BULK_ITEM_IDS } from '@/lib/market-images'
import {
  MARKET_IMAGE_NOT_FOUND_MESSAGE,
  isMarketImageReferenceError,
  marketImageErrorResponse,
  requireMarketImageAdmin,
} from '@/lib/market-images-server'

export const runtime = 'nodejs'

// 선택한 상품들의 이미지를 한 번에 지정한다(제안 F). imageId null = 상품 이미지 해제(카테고리 기본 이미지로 표시).
const BulkThumbnailSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(MARKET_IMAGE_MAX_BULK_ITEM_IDS),
  imageId: z.string().uuid().nullable(),
})

export async function POST(request: Request) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const parsed = BulkThumbnailSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.')
  }

  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('market_items')
    .update({ thumbnail_image_id: parsed.data.imageId, updated_by: auth.id })
    .in('id', [...new Set(parsed.data.itemIds)])
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .select('id')
  if (error && isMarketImageReferenceError(error)) {
    return marketImageErrorResponse(404, 'IMAGE_NOT_FOUND', MARKET_IMAGE_NOT_FOUND_MESSAGE)
  }
  if (error) {
    console.error('상품 이미지 일괄 지정에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '상품 이미지를 지정하지 못했습니다.')
  }

  return NextResponse.json({ success: true, data: { updatedCount: data.length } })
}
