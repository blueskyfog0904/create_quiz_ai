import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { MARKET_IMAGE_MAX_CHECK_HASHES, isSha256Hex } from '@/lib/market-images'
import {
  marketImageErrorResponse,
  requireMarketImageAdmin,
  toMarketImageDto,
} from '@/lib/market-images-server'

export const runtime = 'nodejs'

// 클라이언트가 보낼 바이트의 SHA-256(D4). 일치하면 업로드를 생략한다.
const CheckSchema = z.object({
  hashes: z.array(z.string().refine(isSha256Hex, '이미지 해시 형식이 올바르지 않습니다.')).min(1).max(MARKET_IMAGE_MAX_CHECK_HASHES),
})

export async function POST(request: Request) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const parsed = CheckSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.')
  }

  try {
    const hashes = [...new Set(parsed.data.hashes)]
    const list = hashes.join(',')
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('market_images')
      .select('*')
      .or(`source_sha256.in.(${list}),content_sha256.in.(${list})`)
      .order('created_at')
    if (error) throw error

    const matches = hashes.flatMap((hash) => {
      const row = (data ?? []).find((image) => image.source_sha256 === hash || image.content_sha256 === hash)
      return row ? [{ hash, image: toMarketImageDto(admin, row) }] : []
    })
    return NextResponse.json({ success: true, data: { matches } })
  } catch (error) {
    console.error('상품 이미지 중복 확인에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지 중복 여부를 확인하지 못했습니다.')
  }
}
