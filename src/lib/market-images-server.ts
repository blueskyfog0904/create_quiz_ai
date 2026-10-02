import 'server-only'

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/bypass'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import {
  MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH,
  MARKET_IMAGE_MAX_EDGE,
  MARKET_IMAGE_MAX_INPUT_BYTES,
  MARKET_IMAGES_BUCKET,
  type MarketImageDto,
  type MarketImageFolderDto,
  type MarketImageUsage,
} from '@/lib/market-images'
import type { Database } from '@/types/supabase'

export type { MarketImageDto, MarketImageFolderDto, MarketImageUsage, MarketImageUsageRef } from '@/lib/market-images'

type AdminClient = ReturnType<typeof createAdminClient>
export type MarketImageRow = Database['public']['Tables']['market_images']['Row']
type MarketImageFolderRow = Database['public']['Tables']['market_image_folders']['Row']

// 폴더 생성·이름 변경 공용. DB check(name = btrim(name), 1~60자)와 같은 규칙이다.
export const MarketImageFolderSchema = z.object({
  name: z.string().trim()
    .min(1, '폴더 이름을 입력해주세요.')
    .max(MARKET_IMAGE_FOLDER_NAME_MAX_LENGTH, '폴더 이름은 60자 이하로 입력해주세요.'),
})

export interface NormalizedMarketImage {
  buffer: Buffer
  width: number
  height: number
  bytes: number
  contentSha256: string
}

// 사용자에게 그대로 보여 줄 입력 오류(형식·크기)
export class MarketImageInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketImageInputError'
  }
}

const UNREADABLE_IMAGE_MESSAGE = '이미지를 읽을 수 없습니다. 애니메이션이 아닌 PNG, JPG, WebP 파일(2,500만 픽셀 이하)을 선택해주세요.'

// 결정성(D4): sharp 0.34.5 고정 + 아래 고정 파라미터면 같은 입력은 같은 WebP 바이트가 된다.
const MARKET_IMAGE_WEBP_OPTIONS = { quality: 80, effort: 4 } as const

export function marketImageErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json({ success: false, error: { code, message, ...details } }, { status })
}

// 비로그인 401, 비관리자 403. 통과하면 로그인 사용자를 반환한다.
export async function requireMarketImageAdmin(): Promise<User | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return marketImageErrorResponse(401, 'UNAUTHORIZED', '로그인이 필요합니다.')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return marketImageErrorResponse(403, 'FORBIDDEN', '관리자 권한이 필요합니다.')
  }

  return user
}

export function sha256Hex(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

// 긴 변 800px 이하 WebP로 정규화한다. EXIF 회전을 적용하고 메타데이터는 남기지 않는다(sharp 기본).
export async function normalizeMarketImage(input: Buffer): Promise<NormalizedMarketImage> {
  if (input.length === 0 || input.length > MARKET_IMAGE_MAX_INPUT_BYTES) {
    throw new MarketImageInputError('0바이트보다 크고 4MB 이하인 이미지를 선택해주세요.')
  }

  try {
    const source = sharp(input, { limitInputPixels: 25_000_000 })
    const metadata = await source.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
      throw new MarketImageInputError(UNREADABLE_IMAGE_MESSAGE)
    }
    const { data, info } = await source
      .rotate()
      .resize(MARKET_IMAGE_MAX_EDGE, MARKET_IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp(MARKET_IMAGE_WEBP_OPTIONS)
      .toBuffer({ resolveWithObject: true })
    return {
      buffer: data,
      width: info.width,
      height: info.height,
      bytes: data.length,
      contentSha256: sha256Hex(data),
    }
  } catch (error) {
    if (error instanceof MarketImageInputError) throw error
    console.error('상품 이미지 정규화에 실패했습니다.', error)
    throw new MarketImageInputError(UNREADABLE_IMAGE_MESSAGE)
  }
}

export function getMarketImagePublicUrl(admin: AdminClient, storagePath: string) {
  return admin.storage.from(MARKET_IMAGES_BUCKET).getPublicUrl(storagePath).data.publicUrl
}

// storage 객체를 지우기 직전에 같은 경로를 쓰는 행이 생겼는지 다시 확인한다(동시 업로드가 객체를 재사용한 경우).
// 확인과 삭제 사이의 창을 좁힐 뿐 닫지는 않는다. 남는 경우는 계획 8절의 정합성 점검이 맡는다.
export async function removeMarketImageObjectIfUnreferenced(admin: AdminClient, storagePath: string) {
  const { data, error } = await admin
    .from('market_images')
    .select('id')
    .eq('storage_path', storagePath)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('상품 이미지 storage 객체 참조 확인에 실패해 삭제를 건너뜁니다.', storagePath, error)
    return
  }
  if (data) {
    console.error('다른 이미지 행이 쓰는 storage 객체라 삭제를 건너뜁니다.', storagePath, data.id)
    return
  }
  const { error: removeError } = await admin.storage.from(MARKET_IMAGES_BUCKET).remove([storagePath])
  if (removeError) console.error('상품 이미지 storage 객체 정리에 실패했습니다.', storagePath, removeError)
}

export function toMarketImageDto(admin: AdminClient, row: MarketImageRow): MarketImageDto {
  return {
    id: row.id,
    folderId: row.folder_id,
    displayName: row.display_name,
    storagePath: row.storage_path,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    createdAt: row.created_at,
    publicUrl: getMarketImagePublicUrl(admin, row.storage_path),
  }
}

export function toMarketImageFolderDto(row: MarketImageFolderRow, imageCount: number): MarketImageFolderDto {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    imageCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 사용처 = 삭제되지 않은 상품의 thumbnail_image_id + 카테고리 항목의 default_image_id (delete_market_image RPC와 같은 기준)
export async function listMarketImageUsage(admin: AdminClient, imageIds: string[]) {
  const usage = new Map<string, MarketImageUsage>(imageIds.map((id) => [id, { items: [], categoryItems: [] }]))
  if (imageIds.length === 0) return usage

  const [items, categoryItems] = await Promise.all([
    readAllQueryRows((from, to) => admin
      .from('market_items')
      .select('id, title, thumbnail_image_id')
      .in('thumbnail_image_id', imageIds)
      .is('deleted_at', null)
      .order('id')
      .range(from, to)),
    readAllQueryRows((from, to) => admin
      .from('market_category_items')
      .select('id, title, default_image_id')
      .in('default_image_id', imageIds)
      .order('id')
      .range(from, to)),
  ])

  for (const item of items) {
    if (item.thumbnail_image_id) usage.get(item.thumbnail_image_id)?.items.push({ id: item.id, title: item.title })
  }
  for (const categoryItem of categoryItems) {
    if (categoryItem.default_image_id) {
      usage.get(categoryItem.default_image_id)?.categoryItems.push({ id: categoryItem.id, title: categoryItem.title })
    }
  }
  return usage
}
