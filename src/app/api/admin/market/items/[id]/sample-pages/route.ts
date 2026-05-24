import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createClient } from '@/lib/supabase/server'
import { getMarketItemById } from '@/lib/market-items-server'
import { listActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'

export const dynamic = 'force-dynamic'

const ADMIN_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 * 5

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

export async function GET(request: Request, { params }: RouteContext) {
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

    const samplePages = await listActiveMarketItemSamplePages(item.id, item.workspace_subject)
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
        pageNumber: page.page_number,
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
