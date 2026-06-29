import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
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
  const { user, isAdmin } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
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
