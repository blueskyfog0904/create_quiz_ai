import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getPublishedMarketItemById } from '@/lib/market-items-server'
import { listActiveMarketItemSamplePagesWithSourceFileNames } from '@/lib/market-sample-pages-server'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

const SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 * 60

interface RouteContext {
  params: Promise<{ itemId: string }>
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { itemId } = await params
  try {
    const workspaceSubject = resolveWorkspaceSubject(request.nextUrl.searchParams.get('subject'))
    const item = await getPublishedMarketItemById(itemId, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const adminSupabase = createAdminClient()
    const { data: menu, error: menuError } = await adminSupabase
      .from('market_menu_entries')
      .select('id')
      .eq('id', item.menu_entry_id)
      .eq('workspace_subject', workspaceSubject)
      .eq('is_visible', true)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    if (menuError) throw new Error(menuError.message)
    if (!menu) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const samplePages = await listActiveMarketItemSamplePagesWithSourceFileNames(itemId, workspaceSubject)
    const expiresAt = new Date(Date.now() + SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS * 1000).toISOString()

    const pathsByBucket = new Map<string, string[]>()
    for (const page of samplePages) {
      const paths = pathsByBucket.get(page.storage_bucket) ?? []
      paths.push(page.storage_path)
      pathsByBucket.set(page.storage_bucket, paths)
    }

    const signedUrlByBucketPath = new Map<string, string>()
    await Promise.all(Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
      const { data, error } = await adminSupabase
        .storage
        .from(bucket)
        .createSignedUrls(paths, SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS)

      if (error) {
        throw new Error(error.message || '샘플 이미지 URL 생성에 실패했습니다.')
      }

      for (const entry of data ?? []) {
        if (entry.error || !entry.signedUrl || !entry.path) {
          throw new Error(entry.error || '샘플 이미지 URL 생성에 실패했습니다.')
        }
        signedUrlByBucketPath.set(`${bucket}:${entry.path}`, entry.signedUrl)
      }
    }))

    const pages = samplePages.map((page) => {
      const signedUrl = signedUrlByBucketPath.get(`${page.storage_bucket}:${page.storage_path}`)
      if (!signedUrl) {
        throw new Error('샘플 이미지 URL 생성에 실패했습니다.')
      }

      return {
        id: page.id,
        pageNumber: page.page_number,
        originalFileName: page.source_original_file_name ?? page.original_file_name ?? null,
        signedUrl,
        fileSizeBytes: page.file_size_bytes,
        widthPx: page.width_px,
        heightPx: page.height_px,
      }
    })

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
