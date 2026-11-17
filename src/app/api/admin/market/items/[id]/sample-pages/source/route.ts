import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createAdminClient } from '@/lib/supabase/bypass'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { getMarketItemById } from '@/lib/market-items-server'
import {
  MAX_GENERATED_SAMPLE_PAGE_COUNT,
  MAX_GENERATED_SAMPLE_PAGE_BYTES,
  MAX_GENERATED_SAMPLE_TOTAL_BYTES,
  MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH,
  MAX_SAMPLE_PAGE_DIMENSION_PX,
  MAX_SAMPLE_PAGE_PIXELS,
} from '@/lib/market-pdf-sample-generator'
import { recordManualSampleUploadTargetsForCleanup } from '@/lib/market-sample-pages-server'
import {
  MARKET_SAMPLE_PAGE_MIME_TYPE,
  MARKET_STORAGE_BUCKET,
  buildMarketManualSamplePageStoragePath,
} from '@/lib/market-storage'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

const SamplePageMetadataSchema = z.object({
  pageNumber: z.number().int().min(1),
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

const SampleUploadTargetSchema = z.object({
  draftToken: z.string().trim().min(1).optional(),
  pages: z.array(SamplePageMetadataSchema).min(1).max(MAX_GENERATED_SAMPLE_PAGE_COUNT),
})

// 상품 등록·수정 권한(products.edit)을 공용 가드로 확인한다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'products.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

function validateSamplePageBatch(pages: z.infer<typeof SamplePageMetadataSchema>[]) {
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

export async function POST(request: Request, { params }: RouteContext) {
  const { user, denied } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (denied) {
    return denied
  }

  try {
    const parsed = SampleUploadTargetSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    try {
      validateSamplePageBatch(parsed.data.pages)
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: error instanceof Error ? error.message : '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const adminSupabase = createAdminClient()
    const sourceBatchId = randomUUID()
    const draftToken = parsed.data.draftToken || randomUUID()
    const uploadTargets = []

    for (const page of parsed.data.pages) {
      const storagePath = buildMarketManualSamplePageStoragePath(
        item.workspace_subject,
        item.id,
        sourceBatchId,
        page.pageNumber,
        page.storageFileName
      )
      const { data, error } = await adminSupabase
        .storage
        .from(MARKET_STORAGE_BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false })

      if (error || !data?.token) {
        throw new Error(error?.message || '샘플 이미지 업로드 URL 생성에 실패했습니다.')
      }

      uploadTargets.push({
        pageNumber: page.pageNumber,
        storagePath,
        token: data.token,
        originalFileName: page.originalFileName,
        storageFileName: page.storageFileName,
        mimeType: page.mimeType,
        fileSizeBytes: page.fileSizeBytes,
        widthPx: page.widthPx,
        heightPx: page.heightPx,
      })
    }

    await recordManualSampleUploadTargetsForCleanup(item.id, {
      sourceBatchId,
      draftToken,
      workspaceSubject: item.workspace_subject,
      createdBy: user.id,
      pages: uploadTargets.map((page) => ({
        pageNumber: page.pageNumber,
        storageBucket: MARKET_STORAGE_BUCKET,
        storagePath: page.storagePath,
        originalFileName: page.originalFileName,
        mimeType: page.mimeType,
        fileSizeBytes: page.fileSizeBytes,
        widthPx: page.widthPx,
        heightPx: page.heightPx,
      })),
    })

    return NextResponse.json({
      success: true,
      draftToken,
      sourceBatchId,
      bucket: MARKET_STORAGE_BUCKET,
      uploadTargets,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '샘플 JPG 업로드 URL 생성에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
