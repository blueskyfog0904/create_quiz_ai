import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  findCompletedMarketPurchase,
  getMarketItemById,
  getActiveMarketItemFile,
  getPublishedMarketItemById,
  recordMarketDownloadEvent,
} from '@/lib/market-items-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

function getIpAddress(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || null
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { itemId } = await params
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const assetKind = request.nextUrl.searchParams.get('assetKind')
  if (assetKind !== 'sample' && assetKind !== 'pdf' && assetKind !== 'hwp') {
    return NextResponse.json({ success: false, error: { code: 'INVALID_ASSET_KIND', message: 'assetKind는 sample/pdf/hwp 중 하나여야 합니다.' } }, { status: 400 })
  }

  try {
    const item = assetKind === 'sample'
      ? await getPublishedMarketItemById(itemId)
      : await getMarketItemById(itemId)

    if (item && assetKind !== 'sample' && item.deleted_at !== null) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const file = await getActiveMarketItemFile(itemId, assetKind, item.workspace_subject)
    if (!file) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '요청한 파일 자산을 찾을 수 없습니다.' } }, { status: 404 })
    }

    let purchaseId: string | null = null
    if (assetKind !== 'sample') {
      const purchase = await findCompletedMarketPurchase(user.id, itemId, assetKind, item.workspace_subject)
      if (!purchase) {
        return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '구매 후 다운로드할 수 있습니다.' } }, { status: 403 })
      }
      purchaseId = purchase.id
    }

    const adminSupabase = createAdminClient()
    const { data, error } = await adminSupabase
      .storage
      .from(file.storage_bucket)
      .createSignedUrl(file.storage_path, 60 * 5, {
        download: file.original_file_name || true,
      })

    if (error || !data?.signedUrl) {
      return NextResponse.json({
        success: false,
        error: { code: 'SIGNED_URL_FAILED', message: error?.message || '다운로드 URL 생성에 실패했습니다.' },
      }, { status: 500 })
    }

    await recordMarketDownloadEvent({
      asset_kind: assetKind,
      file_id: file.id,
      item_id: itemId,
      purchase_id: purchaseId,
      user_id: user.id,
      ip_address: getIpAddress(request),
      workspace_subject: item.workspace_subject,
    })

    return NextResponse.redirect(data.signedUrl)
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 다운로드 처리에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
