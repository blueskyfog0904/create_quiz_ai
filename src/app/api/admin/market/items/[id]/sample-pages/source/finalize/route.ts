import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getMarketItemById } from '@/lib/market-items-server'
import {
  MAX_GENERATED_SAMPLE_PAGE_COUNT,
  MAX_GENERATED_SAMPLE_PAGE_BYTES,
  MAX_GENERATED_SAMPLE_TOTAL_BYTES,
  MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH,
  MAX_SAMPLE_PAGE_DIMENSION_PX,
  MAX_SAMPLE_PAGE_PIXELS,
} from '@/lib/market-pdf-sample-generator'
import {
  appendDraftMarketItemSamplePages,
  deleteRemovedManualSampleUploadTargets,
  hasActiveOrDraftMarketItemSamplePageStoragePath,
  markDraftMarketItemSamplePagesAsRemoved,
} from '@/lib/market-sample-pages-server'
import {
  MARKET_SAMPLE_PAGE_MIME_TYPE,
  MARKET_STORAGE_BUCKET,
  buildMarketManualSamplePageStoragePath,
  isSafeManualSampleStoragePath,
} from '@/lib/market-storage'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

const ADMIN_SAMPLE_SOURCE_SIGNED_URL_TTL_SECONDS = 60 * 5

interface RouteContext {
  params: Promise<{ id: string }>
}

const SampleFinalizedPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  storagePath: z.string().trim().min(1),
  originalFileName: z.string().trim().min(1).max(MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH),
  storageFileName: z.string().trim().min(1).max(MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH),
  mimeType: z.literal(MARKET_SAMPLE_PAGE_MIME_TYPE),
  fileSizeBytes: z.number().int().min(1).max(MAX_GENERATED_SAMPLE_PAGE_BYTES),
  widthPx: z.number().int().min(1).max(MAX_SAMPLE_PAGE_DIMENSION_PX),
  heightPx: z.number().int().min(1).max(MAX_SAMPLE_PAGE_DIMENSION_PX),
}).refine((page) => page.widthPx * page.heightPx <= MAX_SAMPLE_PAGE_PIXELS, {
  message: '샘플 JPG 페이지 크기가 허용 범위를 초과했습니다.',
  path: ['widthPx'],
})

const FinalizeUploadSchema = z.object({
  action: z.literal('finalize_upload'),
  draftToken: z.string().trim().min(1),
  sourceBatchId: z.string().uuid(),
  pages: z.array(SampleFinalizedPageSchema).min(1).max(MAX_GENERATED_SAMPLE_PAGE_COUNT),
})

const CleanupUploadBatchSchema = z.object({
  action: z.literal('cleanup_upload_batch'),
  sourceBatchId: z.string().uuid(),
  storagePaths: z.array(z.string().trim().min(1)).min(1).max(MAX_GENERATED_SAMPLE_PAGE_COUNT),
})

const RequestSchema = z.discriminatedUnion('action', [FinalizeUploadSchema, CleanupUploadBatchSchema])

type FinalizeUploadBody = z.infer<typeof FinalizeUploadSchema>

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

function validateFinalizedPageBatch(pages: FinalizeUploadBody['pages']) {
  const pageNumbers = new Set<number>()
  let totalBytes = 0

  for (const page of pages) {
    if (pageNumbers.has(page.pageNumber)) {
      throw new Error('샘플 페이지 번호가 중복되었습니다.')
    }

    pageNumbers.add(page.pageNumber)
    totalBytes += page.fileSizeBytes
    if (totalBytes > MAX_GENERATED_SAMPLE_TOTAL_BYTES) {
      throw new Error('샘플 JPG 전체 용량이 허용 범위를 초과했습니다.')
    }
  }
}

function buildErrorResponse(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: { code, message }, ...extra }, { status })
}

async function removeStoragePaths(storagePaths: string[]) {
  if (storagePaths.length === 0) {
    return
  }

  const adminSupabase = createAdminClient()
  await adminSupabase.storage.from(MARKET_STORAGE_BUCKET).remove(Array.from(new Set(storagePaths)))
}

async function cleanupUploadedButUnfinalizedPaths(
  itemId: string,
  workspaceSubject: WorkspaceSubject,
  sourceBatchId: string,
  storagePaths: string[]
) {
  const cleanedStoragePaths: string[] = []
  const skippedStoragePaths: string[] = []
  const invalidPath = storagePaths.find((storagePath) => (
    storagePath.startsWith('/') ||
    storagePath.includes('..') ||
    storagePath.split('/').some((segment) => segment.length === 0) ||
    !isSafeManualSampleStoragePath(storagePath, workspaceSubject, itemId, sourceBatchId)
  ))

  if (invalidPath) {
    throw new Error('정리할 샘플 이미지 경로가 올바르지 않습니다.')
  }

  for (const storagePath of Array.from(new Set(storagePaths))) {
    const isReferenced = await hasActiveOrDraftMarketItemSamplePageStoragePath(itemId, workspaceSubject, storagePath)
    if (isReferenced) {
      skippedStoragePaths.push(storagePath)
      continue
    }

    cleanedStoragePaths.push(storagePath)
  }

  if (cleanedStoragePaths.length > 0) {
    await removeStoragePaths(cleanedStoragePaths)
  }

  return { cleanedStoragePaths, skippedStoragePaths }
}

function getStorageInfoSize(info: { size?: number | null; metadata?: Record<string, unknown> | null }) {
  const metadataSize = info.metadata?.size
  if (typeof info.size === 'number') {
    return info.size
  }
  if (typeof metadataSize === 'number') {
    return metadataSize
  }
  if (typeof metadataSize === 'string') {
    const parsed = Number(metadataSize)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getStorageInfoContentType(info: { contentType?: string | null; content_type?: string | null; metadata?: Record<string, unknown> | null }) {
  const metadataMimeType = info.metadata?.mimetype ?? info.metadata?.mimeType ?? info.metadata?.contentType
  if (typeof info.contentType === 'string') return info.contentType
  if (typeof info.content_type === 'string') return info.content_type
  return typeof metadataMimeType === 'string' ? metadataMimeType : null
}

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) + bytes[offset + 1]
}

function isJpegStartOfFrameMarker(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('업로드된 샘플 이미지가 JPEG 형식이 아닙니다.')
  }

  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (bytes[offset] === 0xff) {
      offset += 1
    }

    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue
    }

    if (offset + 2 > bytes.length) {
      break
    }

    const segmentLength = readUint16(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break
    }

    if (isJpegStartOfFrameMarker(marker)) {
      if (offset + 7 > bytes.length) {
        break
      }

      return {
        heightPx: readUint16(bytes, offset + 3),
        widthPx: readUint16(bytes, offset + 5),
      }
    }

    offset += segmentLength
  }

  throw new Error('업로드된 샘플 JPEG 크기를 확인할 수 없습니다.')
}

async function verifyUploadedStorageObject(storagePath: string) {
  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase.storage.from(MARKET_STORAGE_BUCKET).info(storagePath)

  if (error || !data) {
    throw new Error(error?.message || '업로드된 샘플 이미지를 찾을 수 없습니다.')
  }

  const objectSize = getStorageInfoSize(data)
  if (objectSize !== null && objectSize > MAX_GENERATED_SAMPLE_PAGE_BYTES) {
    throw new Error('업로드된 샘플 이미지 용량이 허용 범위를 초과했습니다.')
  }

  const contentType = getStorageInfoContentType(data)
  if (contentType && !contentType.toLowerCase().startsWith(MARKET_SAMPLE_PAGE_MIME_TYPE)) {
    throw new Error('업로드된 샘플 이미지 MIME 타입이 올바르지 않습니다.')
  }

  const { data: blob, error: downloadError } = await adminSupabase.storage.from(MARKET_STORAGE_BUCKET).download(storagePath)
  if (downloadError || !blob) {
    throw new Error(downloadError?.message || '업로드된 샘플 이미지를 검증하지 못했습니다.')
  }

  if (blob.size > MAX_GENERATED_SAMPLE_PAGE_BYTES) {
    throw new Error('업로드된 샘플 이미지 용량이 허용 범위를 초과했습니다.')
  }

  if (objectSize !== null && objectSize !== blob.size) {
    throw new Error('업로드된 샘플 이미지 용량을 확인하지 못했습니다.')
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const dimensions = readJpegDimensions(bytes)
  if (
    dimensions.widthPx > MAX_SAMPLE_PAGE_DIMENSION_PX ||
    dimensions.heightPx > MAX_SAMPLE_PAGE_DIMENSION_PX ||
    dimensions.widthPx * dimensions.heightPx > MAX_SAMPLE_PAGE_PIXELS
  ) {
    throw new Error('업로드된 샘플 이미지 크기가 허용 범위를 초과했습니다.')
  }

  return {
    mimeType: MARKET_SAMPLE_PAGE_MIME_TYPE,
    fileSizeBytes: blob.size,
    widthPx: dimensions.widthPx,
    heightPx: dimensions.heightPx,
  }
}

async function buildAdminSamplePagesResponse(pages: Awaited<ReturnType<typeof appendDraftMarketItemSamplePages>>) {
  const adminSupabase = createAdminClient()
  return Promise.all(pages.map(async (page) => {
    const { data, error } = await adminSupabase
      .storage
      .from(page.storage_bucket)
      .createSignedUrl(page.storage_path, ADMIN_SAMPLE_SOURCE_SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      throw new Error(error?.message || '샘플 이미지 URL 생성에 실패했습니다.')
    }

    return {
      id: page.id,
      pageNumber: page.page_number,
      originalFileName: page.original_file_name ?? null,
      signedUrl: data.signedUrl,
      fileSizeBytes: page.file_size_bytes,
      widthPx: page.width_px,
      heightPx: page.height_px,
    }
  }))
}

async function handleFinalizeUpload(
  itemId: string,
  workspaceSubject: WorkspaceSubject,
  createdBy: string,
  body: FinalizeUploadBody
) {
  validateFinalizedPageBatch(body.pages)
  const verifiedPages: Array<FinalizeUploadBody['pages'][number] & {
    verifiedFileSizeBytes: number
    verifiedWidthPx: number
    verifiedHeightPx: number
  }> = []
  let verifiedTotalBytes = 0

  for (const page of body.pages) {
    const expectedStoragePath = buildMarketManualSamplePageStoragePath(
      workspaceSubject,
      itemId,
      body.sourceBatchId,
      page.pageNumber,
      page.storageFileName
    )

    if (page.storagePath !== expectedStoragePath) {
      throw new Error('샘플 이미지 업로드 경로가 올바르지 않습니다.')
    }

    if (!isSafeManualSampleStoragePath(page.storagePath, workspaceSubject, itemId, body.sourceBatchId)) {
      throw new Error('샘플 이미지 업로드 경로가 올바르지 않습니다.')
    }

    const verified = await verifyUploadedStorageObject(page.storagePath)
    verifiedTotalBytes += verified.fileSizeBytes
    if (verifiedTotalBytes > MAX_GENERATED_SAMPLE_TOTAL_BYTES) {
      throw new Error('샘플 JPG 전체 용량이 허용 범위를 초과했습니다.')
    }

    verifiedPages.push({
      ...page,
      verifiedFileSizeBytes: verified.fileSizeBytes,
      verifiedWidthPx: verified.widthPx,
      verifiedHeightPx: verified.heightPx,
    })
  }

  const uploadedStoragePaths = verifiedPages.map((page) => page.storagePath)
  let savedPages: Awaited<ReturnType<typeof appendDraftMarketItemSamplePages>> = []

  try {
    savedPages = await appendDraftMarketItemSamplePages(itemId, {
      sourceFileId: null,
      sourceBatchId: body.sourceBatchId,
      draftToken: body.draftToken,
      workspaceSubject,
      createdBy,
      pages: verifiedPages.map((page) => ({
        pageNumber: page.pageNumber,
        storageBucket: MARKET_STORAGE_BUCKET,
        storagePath: page.storagePath,
        originalFileName: page.originalFileName,
        mimeType: MARKET_SAMPLE_PAGE_MIME_TYPE,
        fileSizeBytes: page.verifiedFileSizeBytes,
        widthPx: page.verifiedWidthPx,
        heightPx: page.verifiedHeightPx,
      })),
    })
    await deleteRemovedManualSampleUploadTargets(itemId, {
      workspaceSubject,
      draftToken: body.draftToken,
      sourceBatchId: body.sourceBatchId,
    }).catch(() => undefined)
  } catch (error) {
    await removeStoragePaths(uploadedStoragePaths).catch(() => undefined)
    throw error
  }

  try {
    const pages = await buildAdminSamplePagesResponse(savedPages)
    return NextResponse.json({ success: true, draftToken: body.draftToken, pages })
  } catch (error) {
    await markDraftMarketItemSamplePagesAsRemoved(itemId, {
      workspaceSubject,
      draftToken: body.draftToken,
      sourceBatchId: body.sourceBatchId,
      createdBy,
    }).catch(() => undefined)
    await removeStoragePaths(uploadedStoragePaths).catch(() => undefined)
    throw error
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { user, isAdmin } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (!user) {
    return buildErrorResponse(401, 'UNAUTHORIZED', '로그인이 필요합니다.')
  }

  if (!isAdmin) {
    return buildErrorResponse(403, 'FORBIDDEN', '관리자 권한이 필요합니다.')
  }

  try {
    const parsed = RequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return buildErrorResponse(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.')
    }

    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return buildErrorResponse(404, 'NOT_FOUND', '문제마켓 상품을 찾을 수 없습니다.')
    }

    if (parsed.data.action === 'cleanup_upload_batch') {
      const result = await cleanupUploadedButUnfinalizedPaths(
        item.id,
        item.workspace_subject,
        parsed.data.sourceBatchId,
        parsed.data.storagePaths
      )

      if (result.skippedStoragePaths.length > 0) {
        return buildErrorResponse(409, 'STORAGE_PATH_REFERENCED', '일부 샘플 이미지가 이미 참조 중이라 삭제하지 않았습니다.', result)
      }

      return NextResponse.json({ success: true, ...result })
    }

    return await handleFinalizeUpload(item.id, item.workspace_subject, user.id, parsed.data)
  } catch (error) {
    return buildErrorResponse(
      500,
      'INTERNAL_SERVER_ERROR',
      error instanceof Error ? error.message : '샘플 JPG 업로드 확정에 실패했습니다.'
    )
  }
}
