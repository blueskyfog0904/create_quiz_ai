import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  MarketImageFolderSchema,
  marketImageErrorResponse,
  requireMarketImageAdmin,
  toMarketImageFolderDto,
} from '@/lib/market-images-server'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

const FolderIdSchema = z.string().uuid()

async function countFolderImages(admin: ReturnType<typeof createAdminClient>, folderId: string) {
  const { count, error } = await admin
    .from('market_images')
    .select('id', { count: 'exact', head: true })
    .eq('folder_id', folderId)
  if (error) throw error
  return count ?? 0
}

function folderNotEmptyResponse(imageCount: number) {
  return marketImageErrorResponse(
    409,
    'FOLDER_NOT_EMPTY',
    `이미지 ${imageCount}장이 남아 있어 삭제할 수 없습니다. 이미지를 이동하거나 삭제한 뒤 다시 시도하세요.`,
    { imageCount },
  )
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const parsed = MarketImageFolderSchema.safeParse(await request.json().catch(() => null))
  if (!FolderIdSchema.safeParse(id).success || !parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error?.issues[0]?.message || '입력이 올바르지 않습니다.')
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('market_image_folders')
      .update({ name: parsed.data.name })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error?.code === '23505') {
      return marketImageErrorResponse(409, 'DUPLICATE_NAME', '같은 이름의 폴더가 이미 있습니다.')
    }
    if (error) throw error
    if (!data) return marketImageErrorResponse(404, 'NOT_FOUND', '폴더를 찾을 수 없습니다.')

    return NextResponse.json({ success: true, data: toMarketImageFolderDto(data, await countFolderImages(admin, id)) })
  } catch (error) {
    console.error('상품 이미지 폴더 수정에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '폴더를 수정하지 못했습니다.')
  }
}

// 비어 있는 폴더만 삭제한다(Q2). 확인 뒤 다른 관리자가 이미지를 넣는 경합은 FK restrict(23503)가 막는다.
export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!FolderIdSchema.safeParse(id).success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', '입력이 올바르지 않습니다.')
  }

  try {
    const admin = createAdminClient()
    const imageCount = await countFolderImages(admin, id)
    if (imageCount > 0) return folderNotEmptyResponse(imageCount)

    const { data, error } = await admin.from('market_image_folders').delete().eq('id', id).select('id')
    if (error?.code === '23503') return folderNotEmptyResponse(await countFolderImages(admin, id))
    if (error) throw error
    if (data.length === 0) return marketImageErrorResponse(404, 'NOT_FOUND', '폴더를 찾을 수 없습니다.')

    return NextResponse.json({ success: true, data: { id } })
  } catch (error) {
    console.error('상품 이미지 폴더 삭제에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '폴더를 삭제하지 못했습니다.')
  }
}
