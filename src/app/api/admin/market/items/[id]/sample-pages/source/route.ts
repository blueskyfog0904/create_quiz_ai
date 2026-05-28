import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
import { getMarketItemById } from '@/lib/market-items-server'
import { generateMarketPdfSamplePages, parseMarketSamplePageSelection } from '@/lib/market-pdf-sample-generator'
import { appendDraftMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import {
  MARKET_SAMPLE_PAGE_MIME_TYPE,
  MARKET_STORAGE_BUCKET,
  MAX_SAMPLE_SOURCE_PDF_SIZE,
  assertSampleSourcePdfUploadIsAllowed,
  buildMarketManualSamplePageStoragePath,
} from '@/lib/market-storage'

export const dynamic = 'force-dynamic'

const ADMIN_SAMPLE_SOURCE_SIGNED_URL_TTL_SECONDS = 60 * 5

interface RouteContext {
  params: Promise<{ id: string }>
}

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
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const formData = await request.formData()
    const fileValue = formData.get('file')
    if (!(fileValue instanceof File)) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE', message: '샘플 PDF 파일이 필요합니다.' } }, { status: 400 })
    }

    try {
      assertSampleSourcePdfUploadIsAllowed({
        name: fileValue.name,
        size: fileValue.size,
        type: fileValue.type,
      })
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_FILE',
          message: error instanceof Error ? error.message : '샘플 PDF 업로드에는 PDF 파일만 사용할 수 있습니다.',
        },
      }, { status: 400 })
    }

    if (fileValue.type && fileValue.type !== 'application/pdf') {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE', message: '샘플 PDF 업로드에는 PDF 파일만 사용할 수 있습니다.' } }, { status: 400 })
    }

    const fileBuffer = Buffer.from(await fileValue.arrayBuffer())
    const requestedPages = formData.get('pages') ?? formData.get('pageNumbers') ?? '1,2,3'
    const pageNumbers = parseMarketSamplePageSelection(String(requestedPages))
    const generatedSamplePages = await generateMarketPdfSamplePages(fileBuffer, fileValue.name, pageNumbers)
    const adminSupabase = createAdminClient()
    const batchId = randomUUID()
    const draftToken = String(formData.get('draftToken') || randomUUID())
    const uploadedSamplePages = []
    const uploadedStoragePaths: string[] = []

    try {
      for (const page of generatedSamplePages) {
        const sampleStoragePath = buildMarketManualSamplePageStoragePath(
          item.workspace_subject,
          item.id,
          batchId,
          page.pageNumber,
          page.fileName
        )
        const { error: uploadError } = await adminSupabase
          .storage
          .from(MARKET_STORAGE_BUCKET)
          .upload(sampleStoragePath, page.buffer, {
            contentType: MARKET_SAMPLE_PAGE_MIME_TYPE,
            upsert: false,
          })

        if (uploadError) {
          throw new Error(uploadError.message)
        }

        uploadedStoragePaths.push(sampleStoragePath)
        uploadedSamplePages.push({
          pageNumber: page.pageNumber,
          storageBucket: MARKET_STORAGE_BUCKET,
          storagePath: sampleStoragePath,
          originalFileName: page.fileName,
          mimeType: page.mimeType,
          fileSizeBytes: page.fileSizeBytes,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
        })
      }

      const savedPages = await appendDraftMarketItemSamplePages(item.id, {
        sourceFileId: null,
        sourceBatchId: batchId,
        draftToken,
        workspaceSubject: item.workspace_subject,
        createdBy: user.id,
        pages: uploadedSamplePages,
      })

      const pages = await Promise.all(savedPages.map(async (page) => {
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
          signedUrl: data.signedUrl,
          fileSizeBytes: page.file_size_bytes,
          widthPx: page.width_px,
          heightPx: page.height_px,
        }
      }))

      return NextResponse.json({ success: true, draftToken, sourceBatchId: batchId, pages }, { status: 201 })
    } catch (error) {
      if (uploadedStoragePaths.length > 0) {
        await adminSupabase.storage.from(MARKET_STORAGE_BUCKET).remove(uploadedStoragePaths).catch(() => undefined)
      }
      throw error
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : `샘플 PDF는 ${Math.round(MAX_SAMPLE_SOURCE_PDF_SIZE / 1024 / 1024)}MB 이하만 업로드할 수 있습니다.`,
      },
    }, { status: 500 })
  }
}
