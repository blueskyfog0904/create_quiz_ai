import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createAdminClient } from '@/lib/supabase/bypass'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { getMarketItemById } from '@/lib/market-items-server'
import { getMarketSamplePagesCacheTag } from '@/lib/market-sample-pages-cache'
import {
  listActiveMarketItemSamplePagesWithSourceFileNames,
  updateMarketItemSamplePageDisplayOrder,
} from '@/lib/market-sample-pages-server'

export const dynamic = 'force-dynamic'

const ADMIN_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 * 5

interface RouteContext {
  params: Promise<{ id: string }>
}

// 상품 등록·수정 권한(products.edit)을 공용 가드로 확인한다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'products.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

export async function GET(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id } = await params
  const searchParams = new URL(request.url).searchParams
  const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))
  // 저장 전 생성한 샘플도 확인할 수 있게 폼이 들고 있는 draftToken을 받는다.
  const draftToken = searchParams.get('draftToken')?.trim() || null

  if (denied) {
    return denied
  }

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const samplePages = await listActiveMarketItemSamplePagesWithSourceFileNames(item.id, item.workspace_subject, draftToken)
    const expiresAt = new Date(Date.now() + ADMIN_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS * 1000).toISOString()
    const adminSupabase = createAdminClient()
    const pages = await Promise.all(samplePages.map(async (page) => {
      const { data, error } = await adminSupabase
        .storage
        .from(page.storage_bucket)
        .createSignedUrl(page.storage_path, ADMIN_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS)

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || '샘플 이미지 URL 생성에 실패했습니다.')
      }

      return {
        id: page.id,
        pageNumber: page.page_number,
        originalFileName: page.source_original_file_name ?? page.original_file_name ?? null,
        signedUrl: data.signedUrl,
        fileSizeBytes: page.file_size_bytes,
        widthPx: page.width_px,
        heightPx: page.height_px,
      }
    }))

    return NextResponse.json({ success: true, pages, expiresAt })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '샘플 페이지를 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (denied) {
    return denied
  }

  try {
    const body = await request.json()
    const pageIds = Array.isArray(body?.pageIds)
      ? body.pageIds.filter((pageId: unknown) => typeof pageId === 'string' && pageId.trim())
      : []
    if (pageIds.length === 0) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '정렬할 샘플 페이지가 없습니다.' } }, { status: 400 })
    }

    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    await updateMarketItemSamplePageDisplayOrder(item.id, pageIds, item.workspace_subject)
    // 공개 샘플 미리보기(서명 주소 캐시)를 바로 새로 만든다.
    revalidateTag(getMarketSamplePagesCacheTag(item.id), { expire: 0 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '샘플 페이지 순서 저장에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
