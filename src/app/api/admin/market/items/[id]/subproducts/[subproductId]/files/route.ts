import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  getMarketFileTypeById,
  getMarketItemById,
  getMarketItemSubproductById,
  addMarketSubproductFile,
  listMarketSubproductFilesForAdmin,
} from '@/lib/market-items-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
import {
  MARKET_STORAGE_BUCKET,
  assertMarketSubproductUploadIsAllowed,
  buildMarketSubproductStoragePath,
  buildMarketSubproductStoragePrefix,
  isMarketSubproductStoragePath,
} from '@/lib/market-storage'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; subproductId: string }>
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

export async function GET(request: Request, { params }: RouteContext) {
  const { user, isAdmin } = await requireAdminUser()
  const { id, subproductId } = await params
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

    const files = await listMarketSubproductFilesForAdmin(id, subproductId, workspaceSubject)
    return NextResponse.json({ success: true, data: files })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 파일 목록을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { user, isAdmin } = await requireAdminUser()
  const { id, subproductId } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  let storagePath: string | null = null
  const adminSupabase = createAdminClient()

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const subproduct = await getMarketItemSubproductById(id, subproductId, workspaceSubject)
    if (!subproduct) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '서브상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    // 파일 본문은 Vercel 함수를 거치지 않는다(함수 요청 4.5MB 제한). 두 단계 JSON 요청:
    //   prepare: 검사 후 서명 업로드 URL 발급 → 브라우저가 Storage에 직접 업로드
    //   complete: Storage에 실제로 올라간 파일의 크기·형식을 다시 검사한 뒤 DB에 등록
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const step = body?.step
    const fileTypeId = body?.fileTypeId
    const fileName = body?.fileName

    if (typeof fileTypeId !== 'string') {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'fileTypeId가 필요합니다.' } }, { status: 400 })
    }

    if (typeof fileName !== 'string' || !fileName.trim()) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE', message: '파일 이름이 필요합니다.' } }, { status: 400 })
    }

    const fileType = await getMarketFileTypeById(fileTypeId, workspaceSubject)
    if (!fileType) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: '파일 유형을 찾을 수 없습니다.' } }, { status: 400 })
    }

    if (step === 'prepare') {
      const fileSize = body?.fileSize
      const contentType = body?.contentType
      if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
        return NextResponse.json({ success: false, error: { code: 'INVALID_FILE', message: '파일 크기를 확인할 수 없습니다.' } }, { status: 400 })
      }

      try {
        assertMarketSubproductUploadIsAllowed({
          name: fileName,
          size: fileSize,
          type: typeof contentType === 'string' ? contentType : null,
        }, fileType)
      } catch (error) {
        return NextResponse.json({
          success: false,
          error: { code: 'INVALID_FILE', message: error instanceof Error ? error.message : '업로드할 수 없는 파일입니다.' },
        }, { status: 400 })
      }

      // 같은 유형 파일이 있어도 새 파일로 추가한다(v1). 경로에는 시각이 들어가 겹치지 않는다.
      const uploadPath = buildMarketSubproductStoragePath(item.workspace_subject, id, subproductId, fileType.code, 1, fileName)
      const { data: signed, error: signError } = await adminSupabase
        .storage
        .from(MARKET_STORAGE_BUCKET)
        .createSignedUploadUrl(uploadPath, { upsert: false })

      if (signError || !signed?.token) {
        return NextResponse.json({
          success: false,
          error: { code: 'UPLOAD_FAILED', message: signError?.message || '업로드 URL을 만들지 못했습니다.' },
        }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        data: { bucket: MARKET_STORAGE_BUCKET, storagePath: uploadPath, token: signed.token },
      })
    }

    if (step !== 'complete') {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'step은 prepare 또는 complete여야 합니다.' } }, { status: 400 })
    }

    const requestedPath = body?.storagePath
    const prefix = buildMarketSubproductStoragePrefix(item.workspace_subject, id, subproductId, fileType.code, 1)
    if (typeof requestedPath !== 'string' || !isMarketSubproductStoragePath(requestedPath, prefix)) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '업로드 경로가 올바르지 않습니다.' } }, { status: 400 })
    }

    // 이미 등록된 경로면 멈춘다(아래 실패 정리가 판매 중인 파일을 지우지 않게).
    const { data: existingRows, error: existingError } = await adminSupabase
      .from('market_subproduct_files')
      .select('id')
      .eq('storage_path', requestedPath)
      .limit(1)
    if (existingError) {
      throw new Error(existingError.message)
    }
    if (existingRows && existingRows.length > 0) {
      return NextResponse.json({ success: false, error: { code: 'ALREADY_REGISTERED', message: '이미 등록된 파일입니다.' } }, { status: 409 })
    }

    const { data: uploaded, error: infoError } = await adminSupabase
      .storage
      .from(MARKET_STORAGE_BUCKET)
      .info(requestedPath)

    if (infoError || !uploaded) {
      return NextResponse.json({ success: false, error: { code: 'UPLOAD_NOT_FOUND', message: '업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.' } }, { status: 400 })
    }

    // 여기부터 실패하면 올라간 파일을 지운다.
    storagePath = requestedPath
    const uploadedSize = typeof uploaded.size === 'number' ? uploaded.size : Number(uploaded.metadata?.size)
    const uploadedContentType = uploaded.contentType ?? (typeof uploaded.metadata?.mimetype === 'string' ? uploaded.metadata.mimetype : null)
    if (!Number.isFinite(uploadedSize)) {
      throw new Error('업로드된 파일 크기를 확인할 수 없습니다.')
    }

    // 브라우저가 type을 모르면(빈 값) octet-stream으로 올라간다. prepare에서 빈 type을 건너뛴 것과 같게 MIME 검사를 건너뛴다.
    assertMarketSubproductUploadIsAllowed({
      name: fileName,
      size: uploadedSize,
      type: uploadedContentType === 'application/octet-stream' ? null : uploadedContentType,
    }, fileType)

    const sortOrderValue = Number(body?.sortOrder ?? 0)
    const savedFile = await addMarketSubproductFile(id, subproduct.id, fileType.id, {
      storage_bucket: MARKET_STORAGE_BUCKET,
      storage_path: requestedPath,
      original_file_name: fileName,
      content_type: uploadedContentType,
      file_size_bytes: uploadedSize,
      checksum: null,
      sort_order: Number.isFinite(sortOrderValue) ? sortOrderValue : 0,
      created_by: user.id,
    })

    return NextResponse.json({ success: true, data: savedFile }, { status: 201 })
  } catch (error) {
    if (storagePath) {
      await adminSupabase.storage.from(MARKET_STORAGE_BUCKET).remove([storagePath])
    }

    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 파일 업로드에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
