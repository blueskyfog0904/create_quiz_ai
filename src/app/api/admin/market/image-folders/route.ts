import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import {
  MarketImageFolderSchema,
  marketImageErrorResponse,
  requireMarketImageAdmin,
  toMarketImageFolderDto,
} from '@/lib/market-images-server'

export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  try {
    const admin = createAdminClient()
    const [{ data: folders, error }, images] = await Promise.all([
      admin.from('market_image_folders').select('*').order('sort_order').order('name'),
      readAllQueryRows((from, to) => admin.from('market_images').select('folder_id').order('id').range(from, to)),
    ])
    if (error) throw error

    const counts = new Map<string | null, number>()
    for (const image of images) counts.set(image.folder_id, (counts.get(image.folder_id) ?? 0) + 1)

    return NextResponse.json({
      success: true,
      data: {
        folders: (folders ?? []).map((folder) => toMarketImageFolderDto(folder, counts.get(folder.id) ?? 0)),
        unfiledCount: counts.get(null) ?? 0,
        totalCount: images.length,
      },
    })
  } catch (error) {
    console.error('상품 이미지 폴더 목록 조회에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '폴더 목록을 불러오지 못했습니다.')
  }
}

export async function POST(request: Request) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const parsed = MarketImageFolderSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.')
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('market_image_folders')
    .insert({ name: parsed.data.name, created_by: auth.id })
    .select('*')
    .single()
  if (error?.code === '23505') {
    return marketImageErrorResponse(409, 'DUPLICATE_NAME', '같은 이름의 폴더가 이미 있습니다.')
  }
  if (error) {
    console.error('상품 이미지 폴더 생성에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '폴더를 만들지 못했습니다.')
  }

  return NextResponse.json({ success: true, data: toMarketImageFolderDto(data, 0) }, { status: 201 })
}
