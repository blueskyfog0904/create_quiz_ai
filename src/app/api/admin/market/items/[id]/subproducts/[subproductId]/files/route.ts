import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  getMarketFileTypeById,
  getMarketItemById,
  getMarketItemSubproductById,
  listMarketSubproductFilesForAdmin,
  replaceMarketSubproductFile,
} from '@/lib/market-items-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
import {
  MARKET_STORAGE_BUCKET,
  assertMarketSubproductUploadIsAllowed,
  buildMarketSubproductStoragePath,
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

    const formData = await request.formData()
    const fileTypeId = formData.get('fileTypeId')
    const fileValue = formData.get('file')
    const sortOrderValue = Number(formData.get('sortOrder') ?? 0)

    if (typeof fileTypeId !== 'string') {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'fileTypeId가 필요합니다.' } }, { status: 400 })
    }

    const fileType = await getMarketFileTypeById(fileTypeId, workspaceSubject)
    if (!fileType) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: '파일 유형을 찾을 수 없습니다.' } }, { status: 400 })
    }

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_FILE', message: '업로드 파일이 필요합니다.' } }, { status: 400 })
    }

    assertMarketSubproductUploadIsAllowed({
      name: fileValue.name,
      size: fileValue.size,
      type: fileValue.type,
    }, fileType)

    const previousFiles = await listMarketSubproductFilesForAdmin(id, subproductId, workspaceSubject)
    const nextVersion = previousFiles
      .filter((file) => file.file_type_id === fileTypeId)
      .reduce((maxVersion, file) => Math.max(maxVersion, file.version), 0) + 1
    storagePath = buildMarketSubproductStoragePath(item.workspace_subject, id, subproductId, fileType.code, nextVersion, fileValue.name)
    const fileBuffer = Buffer.from(await fileValue.arrayBuffer())

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

    const savedFile = await replaceMarketSubproductFile(id, subproduct.id, fileType.id, {
      storage_bucket: MARKET_STORAGE_BUCKET,
      storage_path: storagePath,
      original_file_name: fileValue.name,
      content_type: fileValue.type || null,
      file_size_bytes: fileValue.size,
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
