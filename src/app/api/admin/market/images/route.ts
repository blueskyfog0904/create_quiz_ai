import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import {
  MARKET_IMAGE_MAX_INPUT_BYTES,
  MARKET_IMAGE_MIME_TYPE,
  MARKET_IMAGE_NAME_MAX_LENGTH,
  MARKET_IMAGES_BUCKET,
  buildMarketImageStoragePath,
} from '@/lib/market-images'
import {
  MarketImageInputError,
  listMarketImageUsage,
  marketImageErrorResponse,
  normalizeMarketImage,
  removeMarketImageObjectIfUnreferenced,
  requireMarketImageAdmin,
  sha256Hex,
  toMarketImageDto,
  type MarketImageDto,
  type MarketImageRow,
} from '@/lib/market-images-server'

export const runtime = 'nodejs'
export const maxDuration = 60

const PAGE_SIZE = 60
// 배포 환경 요청 본문 한도(약 4.5MB)에 맞춰 한 요청의 파일 합계를 입력 한도로 제한한다.
// content-length가 없는 요청은 이 검사를 지나가지만 배포 환경(Vercel)의 본문 한도가 막는다.
const MAX_REQUEST_BYTES = MARKET_IMAGE_MAX_INPUT_BYTES + 64 * 1024
// 파일마다 sharp 처리와 DB·storage 왕복이 있어 한 요청의 파일 수를 제한한다. 더 많으면 클라이언트가 나눠 보낸다.
const MAX_FILES_PER_REQUEST = 20

// folderId: 생략 = 전체, 'unfiled' = 미분류(folder_id NULL), uuid = 해당 폴더
// cursor: 다음 페이지 시작 위치(offset). 응답의 nextCursor를 그대로 보낸다.
const ListQuerySchema = z.object({
  folderId: z.union([z.literal('unfiled'), z.string().uuid()]).optional(),
  q: z.string().trim().max(MARKET_IMAGE_NAME_MAX_LENGTH).optional(),
  sort: z.enum(['newest', 'oldest', 'name']).default('newest'),
  cursor: z.coerce.number().int().min(0).default(0),
})

const UploadFolderSchema = z.string().uuid().nullable()

type UploadResult =
  | { name: string; image: MarketImageDto; duplicated: boolean }
  | { name: string; error: string }

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function toDisplayName(fileName: string) {
  const name = fileName.trim().replace(/\.[^.]+$/, '').trim() || fileName.trim() || '이미지'
  return name.slice(0, MARKET_IMAGE_NAME_MAX_LENGTH)
}

function isStorageDuplicateError(error: unknown) {
  return typeof error === 'object' && error !== null && 'statusCode' in error && String(error.statusCode) === '409'
}

export async function GET(request: Request) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  const parsed = ListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.')
  }
  const { folderId, q, sort, cursor } = parsed.data

  try {
    const admin = createAdminClient()
    let query = admin.from('market_images').select('*')
    if (folderId === 'unfiled') query = query.is('folder_id', null)
    else if (folderId) query = query.eq('folder_id', folderId)
    if (q) query = query.ilike('display_name', `%${escapeLikePattern(q)}%`)
    if (sort === 'name') query = query.order('display_name').order('id')
    else query = query.order('created_at', { ascending: sort === 'oldest' }).order('id', { ascending: sort === 'oldest' })

    const [{ data, error }, allSizes] = await Promise.all([
      query.range(cursor, cursor + PAGE_SIZE),
      readAllQueryRows((from, to) => admin.from('market_images').select('bytes').order('id').range(from, to)),
    ])
    if (error) throw error

    const rows = (data ?? []).slice(0, PAGE_SIZE)
    const usage = await listMarketImageUsage(admin, rows.map((row) => row.id))
    return NextResponse.json({
      success: true,
      data: {
        items: rows.map((row) => {
          const rowUsage = usage.get(row.id)
          return {
            ...toMarketImageDto(admin, row),
            usageCount: (rowUsage?.items.length ?? 0) + (rowUsage?.categoryItems.length ?? 0),
          }
        }),
        nextCursor: (data?.length ?? 0) > PAGE_SIZE ? String(cursor + PAGE_SIZE) : null,
        totals: {
          count: allSizes.length,
          bytes: allSizes.reduce((sum, row) => sum + row.bytes, 0),
        },
      },
    })
  } catch (error) {
    console.error('상품 이미지 목록 조회에 실패했습니다.', error)
    return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지 목록을 불러오지 못했습니다.')
  }
}

async function findImage(admin: ReturnType<typeof createAdminClient>, column: 'source_sha256' | 'content_sha256', hash: string) {
  const { data, error } = await admin
    .from('market_images')
    .select('*')
    .eq(column, hash)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function saveImage(
  admin: ReturnType<typeof createAdminClient>,
  file: File,
  folderId: string | null,
  userId: string,
): Promise<{ row: MarketImageRow; duplicated: boolean }> {
  // D4: 받은 바이트 해시 → 정규화 결과 해시 순으로 기존 행을 찾아 재사용한다.
  const input = Buffer.from(await file.arrayBuffer())
  const sourceSha256 = sha256Hex(input)
  const bySource = await findImage(admin, 'source_sha256', sourceSha256)
  if (bySource) return { row: bySource, duplicated: true }

  const image = await normalizeMarketImage(input)
  const byContent = await findImage(admin, 'content_sha256', image.contentSha256)
  if (byContent) return { row: byContent, duplicated: true }

  // 경로가 내용 해시라 이미 있는 객체는 같은 내용이다. 충돌은 성공으로 취급한다.
  const storagePath = buildMarketImageStoragePath(image.contentSha256)
  const { error: uploadError } = await admin.storage.from(MARKET_IMAGES_BUCKET).upload(storagePath, image.buffer, {
    contentType: MARKET_IMAGE_MIME_TYPE,
    cacheControl: '31536000',
    upsert: false,
  })
  if (uploadError && !isStorageDuplicateError(uploadError)) throw uploadError
  const createdObject = !uploadError

  const { data, error } = await admin
    .from('market_images')
    .insert({
      folder_id: folderId,
      display_name: toDisplayName(file.name),
      storage_path: storagePath,
      content_sha256: image.contentSha256,
      source_sha256: sourceSha256,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      mime_type: MARKET_IMAGE_MIME_TYPE,
      created_by: userId,
    })
    .select('*')
    .single()
  if (!error) return { row: data, duplicated: false }

  // 같은 해시 동시 업로드: 먼저 저장된 행을 돌려주고, 그 행이 쓰는 객체는 지우지 않는다.
  if (error.code === '23505') {
    const existing = await findImage(admin, 'content_sha256', image.contentSha256)
    if (existing) return { row: existing, duplicated: true }
  }

  if (createdObject) await removeMarketImageObjectIfUnreferenced(admin, storagePath)
  throw error
}

export async function POST(request: Request) {
  const auth = await requireMarketImageAdmin()
  if (auth instanceof NextResponse) return auth

  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
    return marketImageErrorResponse(413, 'PAYLOAD_TOO_LARGE', '한 번에 4MB 이하로 업로드해주세요.')
  }

  let files: File[]
  let folderId: string | null
  try {
    const form = await request.formData()
    files = form.getAll('files').filter((file): file is File => file instanceof File)
    const parsedFolderId = UploadFolderSchema.safeParse(form.get('folderId') || null)
    if (!parsedFolderId.success) {
      return marketImageErrorResponse(400, 'INVALID_INPUT', '폴더 형식이 올바르지 않습니다.')
    }
    folderId = parsedFolderId.data
  } catch {
    return marketImageErrorResponse(400, 'INVALID_INPUT', '업로드 요청을 읽을 수 없습니다.')
  }
  if (files.length === 0) {
    return marketImageErrorResponse(400, 'INVALID_INPUT', '업로드할 이미지를 선택해주세요.')
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return marketImageErrorResponse(400, 'TOO_MANY_FILES', `한 번에 ${MAX_FILES_PER_REQUEST}장까지 업로드할 수 있습니다.`)
  }

  const admin = createAdminClient()
  if (folderId) {
    const { data: folder, error } = await admin.from('market_image_folders').select('id').eq('id', folderId).maybeSingle()
    if (error) {
      console.error('상품 이미지 폴더 확인에 실패했습니다.', error)
      return marketImageErrorResponse(500, 'INTERNAL_SERVER_ERROR', '이미지를 저장하지 못했습니다.')
    }
    if (!folder) return marketImageErrorResponse(404, 'FOLDER_NOT_FOUND', '폴더를 찾을 수 없습니다.')
  }

  const results: UploadResult[] = []
  for (const file of files) {
    try {
      const { row, duplicated } = await saveImage(admin, file, folderId, auth.id)
      results.push({ name: file.name, image: toMarketImageDto(admin, row), duplicated })
    } catch (error) {
      if (error instanceof MarketImageInputError) {
        results.push({ name: file.name, error: error.message })
      } else {
        console.error('상품 이미지 저장에 실패했습니다.', error)
        results.push({ name: file.name, error: '이미지를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' })
      }
    }
  }

  return NextResponse.json({ success: true, data: { results } })
}
