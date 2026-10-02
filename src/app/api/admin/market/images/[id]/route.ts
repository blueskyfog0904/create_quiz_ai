import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { MARKET_IMAGE_NAME_MAX_LENGTH } from '@/lib/market-images'
import {
  listMarketImageUsage,
  marketImageErrorResponse,
  removeMarketImageObjectIfUnreferenced,
  requireMarketImageAdmin,
  toMarketImageDto,
  type MarketImageUsage,
} from '@/lib/market-images-server'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

const ImageIdSchema = z.string().uuid()

const ImagePatchSchema = z.object({
  displayName: z.string().trim().min(1, '이미지 이름을 입력해주세요.').max(MARKET_IMAGE_NAME_MAX_LENGTH).optional(),
  folderId: z.string().uuid().nullable().optional(),
}).refine((value) => value.displayName !== undefined || value.folderId !== undefined, '변경할 항목이 없습니다.')

type DeleteMarketImageResult =
  | { ok: true; imageId: string; storagePath: string; clearedDeletedItems: number }
  | ({ ok: false; code: 'INVALID_INPUT' | 'NOT_FOUND' | 'IN_USE' } & Partial<MarketImageUsage>)

function inUseResponse(usage: MarketImageUsage) {
  return marketImageErrorResponse(409, 'IN_USE', '사용 중인 이미지는 삭제할 수 없습니다.', {
    items: usage.items,
    categoryItems: usage.categoryItems,
  })
}

// 상세 패널용: 이미지와 사용처 목록(삭제 차단 기준과 같음)
export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!ImageIdSchema.safeParse(id).success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', '입력이 올바르지 않습니다.')
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('market_images').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return marketImageErrorResponse(404, 'NOT_FOUND', '이미지를 찾을 수 없습니다.')

    const usage = (await listMarketImageUsage(admin, [id])).get(id) ?? { items: [], categoryItems: [] }
    return NextResponse.json({ success: true, data: { image: toMarketImageDto(admin, data), usage } })
  } catch (error) {
    console.error('상품 이미지 상세 조회에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지 정보를 불러오지 못했습니다.')
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const parsed = ImagePatchSchema.safeParse(await request.json().catch(() => null))
  if (!ImageIdSchema.safeParse(id).success || !parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error?.issues[0]?.message || '입력이 올바르지 않습니다.')
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('market_images')
    .update({
      ...(parsed.data.displayName !== undefined ? { display_name: parsed.data.displayName } : {}),
      ...(parsed.data.folderId !== undefined ? { folder_id: parsed.data.folderId } : {}),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error?.code === '23503') {
    return marketImageErrorResponse(404, 'FOLDER_NOT_FOUND', '폴더를 찾을 수 없습니다.')
  }
  if (error) {
    console.error('상품 이미지 수정에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지를 수정하지 못했습니다.')
  }
  if (!data) return marketImageErrorResponse(404, 'NOT_FOUND', '이미지를 찾을 수 없습니다.')

  return NextResponse.json({ success: true, data: toMarketImageDto(admin, data) })
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!ImageIdSchema.safeParse(id).success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', '입력이 올바르지 않습니다.')
  }

  const admin = createAdminClient()
  try {
    const { data, error } = await admin.rpc('delete_market_image', { p_image_id: id })
    // 확인과 삭제 사이에 다른 관리자가 이미지를 지정한 경합: FK restrict(23503)를 IN_USE로 바꾸고 사용처를 다시 조회한다.
    if (error?.code === '23503') {
      const usage = await listMarketImageUsage(admin, [id])
      return inUseResponse(usage.get(id) ?? { items: [], categoryItems: [] })
    }
    if (error) throw error

    const result = data as unknown as DeleteMarketImageResult
    if (!result.ok) {
      if (result.code === 'IN_USE') {
        return inUseResponse({ items: result.items ?? [], categoryItems: result.categoryItems ?? [] })
      }
      if (result.code === 'NOT_FOUND') {
        return marketImageErrorResponse(404, 'NOT_FOUND', '이미지를 찾을 수 없습니다.')
      }
      return marketImageErrorResponse(400, 'INVALID_INPUT', '입력이 올바르지 않습니다.')
    }

    // 행은 이미 삭제됐으므로 storage 정리 실패는 기록만 하고 성공으로 응답한다.
    await removeMarketImageObjectIfUnreferenced(admin, result.storagePath)

    return NextResponse.json({
      success: true,
      data: { imageId: result.imageId, clearedDeletedItems: result.clearedDeletedItems },
    })
  } catch (error) {
    console.error('상품 이미지 삭제에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지를 삭제하지 못했습니다.')
  }
}
