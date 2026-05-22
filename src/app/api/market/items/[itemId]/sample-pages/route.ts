import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getPublishedMarketItemById } from '@/lib/market-items-server'
import { listActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { itemId } = await params
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  try {
    const workspaceSubject = resolveWorkspaceSubject(request.nextUrl.searchParams.get('subject'))
    const item = await getPublishedMarketItemById(itemId, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const samplePages = await listActiveMarketItemSamplePages(item.id, item.workspace_subject)
    const adminSupabase = createAdminClient()
    const pages = await Promise.all(samplePages.map(async (page) => {
      const { data, error } = await adminSupabase
        .storage
        .from(page.storage_bucket)
        .createSignedUrl(page.storage_path, 60 * 5)

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || '샘플 이미지 URL 생성에 실패했습니다.')
      }

      return {
        pageNumber: page.page_number,
        signedUrl: data.signedUrl,
        widthPx: page.width_px,
        heightPx: page.height_px,
      }
    }))

    return NextResponse.json({ success: true, pages })
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
