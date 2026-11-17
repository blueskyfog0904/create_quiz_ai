import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createAdminClient } from '@/lib/supabase/bypass'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { getMarketItemById } from '@/lib/market-items-server'
import { getMarketSamplePagesCacheTag } from '@/lib/market-sample-pages-cache'
import {
  deactivateMarketItemSamplePage,
  listActiveMarketItemSamplePages,
  removeDraftMarketItemSamplePage,
} from '@/lib/market-sample-pages-server'

export const dynamic = 'force-dynamic'

const ADMIN_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 * 5

interface RouteContext {
  params: Promise<{ id: string; pageId: string }>
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

async function buildSignedPages(itemId: string, workspaceSubject: 'english' | 'korean') {
  const adminSupabase = createAdminClient()
  const samplePages = await listActiveMarketItemSamplePages(itemId, workspaceSubject)
  return Promise.all(samplePages.map(async (page) => {
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
      signedUrl: data.signedUrl,
      fileSizeBytes: page.file_size_bytes,
      widthPx: page.width_px,
      heightPx: page.height_px,
    }
  }))
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id, pageId } = await params
  const searchParams = new URL(request.url).searchParams
  const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))
  const draftToken = searchParams.get('draftToken')

  if (denied) {
    return denied
  }

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const deletedPage = draftToken
      ? await removeDraftMarketItemSamplePage(pageId, item.id, draftToken, item.workspace_subject)
      : await deactivateMarketItemSamplePage(pageId, item.id, item.workspace_subject)
    if (!deletedPage) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '샘플 페이지를 찾을 수 없습니다.' } }, { status: 404 })
    }
    if (!draftToken) {
      // 공개 샘플 미리보기(서명 주소 캐시)를 바로 새로 만든다(지운 이미지 주소를 더 내주지 않는다).
      revalidateTag(getMarketSamplePagesCacheTag(item.id), { expire: 0 })
    }

    await createAdminClient()
      .storage
      .from(deletedPage.storage_bucket)
      .remove([deletedPage.storage_path])
      .catch(() => undefined)

    const pages = draftToken ? [] : await buildSignedPages(item.id, item.workspace_subject)
    return NextResponse.json({ success: true, pages })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '샘플 페이지 삭제에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
