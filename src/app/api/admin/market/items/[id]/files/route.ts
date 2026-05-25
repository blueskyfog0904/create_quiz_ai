import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getMarketItemById, replaceMarketItemFile } from '@/lib/market-items-server'
import { generateMarketPdfSamplePages } from '@/lib/market-pdf-sample-generator'
import { replaceMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import {
  MARKET_SAMPLE_PAGE_MIME_TYPE,
  MARKET_STORAGE_BUCKET,
  assertMarketUploadIsAllowed,
  buildMarketSamplePageStoragePath,
  buildMarketStoragePath,
} from '@/lib/market-storage'

export const dynamic = 'force-dynamic'

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

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  try {
    const item = await getMarketItemById(id)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const formData = await request.formData()
    const assetKindValue = formData.get('assetKind')
    const fileValue = formData.get('file')

    if (assetKindValue !== 'pdf' && assetKindValue !== 'hwp' && assetKindValue !== 'zip') {
      return NextResponse.json({ success: false, error: { code: 'INVALID_ASSET_KIND', message: 'assetKind는 pdf/hwp/zip 중 하나여야 합니다.' } }, { status: 400 })
    }

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE', message: '업로드 파일이 필요합니다.' } }, { status: 400 })
    }

    assertMarketUploadIsAllowed({
      name: fileValue.name,
      size: fileValue.size,
      type: fileValue.type,
    }, assetKindValue)

    const adminSupabase = createAdminClient()
    const storagePath = buildMarketStoragePath(item.workspace_subject, item.id, assetKindValue, fileValue.name)
    const fileBuffer = Buffer.from(await fileValue.arrayBuffer())
    const generatedSamplePages = assetKindValue === 'pdf'
      ? await generateMarketPdfSamplePages(fileBuffer, fileValue.name)
      : []

    const { error: uploadError } = await adminSupabase
      .storage
      .from(MARKET_STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: fileValue.type || undefined,
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: uploadError.message.includes('Bucket not found')
            ? `Storage bucket '${MARKET_STORAGE_BUCKET}' 이(가) 존재하지 않습니다.`
            : uploadError.message,
        },
      }, { status: 500 })
    }

    const savedFile = await replaceMarketItemFile(item.id, assetKindValue, {
      storage_bucket: MARKET_STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: fileValue.name,
      mime_type: fileValue.type || null,
      file_size_bytes: fileValue.size,
      checksum: null,
      created_by: user.id,
    })
    if (!savedFile) {
      throw new Error('문제마켓 파일 메타데이터 저장에 실패했습니다.')
    }

    let samplePageCount = 0
    let sampleGenerationStatus: 'not_applicable' | 'generated' = 'not_applicable'
    if (assetKindValue === 'pdf') {
      const uploadedSamplePages = []
      for (const page of generatedSamplePages) {
        const sampleStoragePath = buildMarketSamplePageStoragePath(
          item.workspace_subject,
          item.id,
          savedFile.id,
          page.pageNumber,
          page.fileName
        )
        const { error: sampleUploadError } = await adminSupabase
          .storage
          .from(MARKET_STORAGE_BUCKET)
          .upload(sampleStoragePath, page.buffer, {
            contentType: MARKET_SAMPLE_PAGE_MIME_TYPE,
            upsert: false,
          })

        if (sampleUploadError) {
          throw new Error(sampleUploadError.message)
        }

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

      await replaceMarketItemSamplePages(item.id, {
        sourceFileId: savedFile.id,
        workspaceSubject: item.workspace_subject,
        createdBy: user.id,
        pages: uploadedSamplePages,
      })
      samplePageCount = uploadedSamplePages.length
      sampleGenerationStatus = 'generated'
    }

    return NextResponse.json({
      success: true,
      data: {
        savedFile,
        samplePageCount,
        sampleGenerationStatus,
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 파일 업로드에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
