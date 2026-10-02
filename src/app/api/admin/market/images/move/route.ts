import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { marketImageErrorResponse, requireMarketImageAdmin } from '@/lib/market-images-server'

export const runtime = 'nodejs'

// folderId null = 미분류로 이동. imageIds는 .in() 필터 URL 길이 한도 때문에 200개까지(약 350개부터 실패), 더 많으면 클라이언트가 나눠 보낸다.
const MoveSchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(200),
  folderId: z.string().uuid().nullable(),
})

export async function POST(request: Request) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const parsed = MoveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.')
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('market_images')
    .update({ folder_id: parsed.data.folderId })
    .in('id', [...new Set(parsed.data.imageIds)])
    .select('id')
  if (error?.code === '23503') {
    return marketImageErrorResponse(404, 'FOLDER_NOT_FOUND', '폴더를 찾을 수 없습니다.')
  }
  if (error) {
    console.error('상품 이미지 이동에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지를 이동하지 못했습니다.')
  }

  return NextResponse.json({ success: true, data: { movedCount: data.length } })
}
