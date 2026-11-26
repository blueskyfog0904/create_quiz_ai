import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  findCompletedMarketPurchase,
  getMarketItemById,
  getActiveMarketItemFile,
  getActiveMarketSubproductFileForDownload,
  listMarketV2EntitlementsForItem,
  recordMarketDownloadEvent,
  recordMarketV2DownloadEvent,
} from '@/lib/market-items-server'
import {
  findMarketSubproductFileV2Entitlement,
  getMarketPurchaseKindsToCheck,
  listMarketSubproductFileV2Entitlements,
  isMarketAssetCoveredByPurchaseKind,
  type MarketPaidAssetKind,
} from '@/lib/market-purchase'
import { hasPendingMarketRefundRequestForTarget, listPendingMarketRefundScopes } from '@/lib/market-refunds'
import { isPendingRefundBlockingFile } from '@/lib/market-refund-rules'
import { createAdminClient as createScopeClient } from '@/lib/supabase/bypass'
import { checkMemberSuspensionForApi, memberSuspensionDownloadRedirect } from '@/lib/member-suspension-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

function getIpAddress(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || null
}

function getUserAgent(request: NextRequest) {
  return request.headers.get('user-agent')
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { itemId } = await params
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }
  // 12번 5-1: '다운로드도 막기'를 고른 정지면 안내 화면으로 303 이동(확인 실패도 ?check=failed 로 이동 — 날 JSON 없음).
  const suspension = await checkMemberSuspensionForApi(user.id, 'download')
  if (suspension) {
    return memberSuspensionDownloadRedirect(request, suspension)
  }

  const fileId = request.nextUrl.searchParams.get('fileId')
  if (fileId) {
    return handleMarketV2Download(request, user.id, itemId, fileId)
  }

  return handleLegacyMarketDownload(request, user.id, itemId)
}

async function handleMarketV2Download(
  request: NextRequest,
  userId: string,
  itemId: string,
  fileId: string
) {
  try {
    const file = await getActiveMarketSubproductFileForDownload(itemId, fileId)
    if (!file) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '요청한 파일을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const entitlements = await listMarketV2EntitlementsForItem(userId, itemId, file.workspace_subject)
    // 같은 상품에 권한이 여러 개일 수 있다(구성 구매 뒤 묶음 구매 등). 파일을 덮는 권한을 정해진 순서로 보면서
    // 환불 심사 중이 아닌 주문의 권한을 찾으면 그 권한으로 내려받는다. 다른 주문이 심사 중이어도 막지 않는다.
    const target = { itemId, subproductId: file.subproduct_id, fileId: file.id }
    const coveringEntitlements = listMarketSubproductFileV2Entitlements(target, entitlements)
    // 8번: 심사 중인 요청이 부분 환불이면 그 대상 자료(같은 분류의 교체본 포함)만 막는다. 전체·예외 요청은 그 주문 권한 전부.
    const pendingScopes = await listPendingMarketRefundScopes(
      coveringEntitlements.map((candidate) => candidate.source_order_id).filter((id): id is string => Boolean(id))
    )
    let fileCategorySlug: string | null = null
    if (pendingScopes.size > 0) {
      const { data: fileSubproduct, error: fileSubproductError } = await createScopeClient()
        .from('market_item_subproducts')
        .select('market_subproduct_categories(slug)')
        .eq('id', file.subproduct_id)
        .maybeSingle()
      // 분류를 못 읽으면 교체본 차단을 판단할 수 없으므로 내려주지 않는다(fail closed).
      if (fileSubproductError) throw new Error(fileSubproductError.message)
      fileCategorySlug = (fileSubproduct as { market_subproduct_categories: { slug: string } | null } | null)?.market_subproduct_categories?.slug ?? null
    }
    const pendingRefundOrderIds = coveringEntitlements
      .map((candidate) => candidate.source_order_id)
      .filter((orderId): orderId is string => Boolean(orderId) && isPendingRefundBlockingFile(
        pendingScopes.get(orderId as string), { subproductId: file.subproduct_id, categorySlug: fileCategorySlug }
      ))
    const entitlement = findMarketSubproductFileV2Entitlement(target, coveringEntitlements, pendingRefundOrderIds)

    if (!entitlement) {
      if (coveringEntitlements.length === 0) {
        return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '구매 후 다운로드할 수 있습니다.' } }, { status: 403 })
      }

      if (pendingRefundOrderIds.length > 0) {
        return NextResponse.json({
          success: false,
          error: { code: 'PENDING_REFUND', message: '환불 요청이 접수되어 심사 중입니다. 심사 중에는 다운로드할 수 없습니다.' },
        }, { status: 403 })
      }

      return NextResponse.json({ success: false, error: { code: 'INVALID_ENTITLEMENT', message: '다운로드 권한의 구매 정보를 확인할 수 없습니다.' } }, { status: 500 })
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

    await recordMarketV2DownloadEvent({
      event_target_type: 'subproduct_file',
      asset_kind: 'subproduct_file',
      item_id: itemId,
      subproduct_file_id: file.id,
      order_id: entitlement.source_order_id,
      entitlement_id: entitlement.id,
      user_id: userId,
      ip_address: getIpAddress(request),
      user_agent: getUserAgent(request),
      signed_url_expires_at: new Date(Date.now() + (60 * 5 * 1000)).toISOString(),
      workspace_subject: file.workspace_subject,
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

async function handleLegacyMarketDownload(request: NextRequest, userId: string, itemId: string) {
  const assetKind = request.nextUrl.searchParams.get('assetKind')
  if (assetKind !== 'pdf' && assetKind !== 'hwp' && assetKind !== 'zip') {
    return NextResponse.json({ success: false, error: { code: 'INVALID_ASSET_KIND', message: 'assetKind는 pdf/hwp/zip 중 하나여야 합니다.' } }, { status: 400 })
  }

  try {
    const item = await getMarketItemById(itemId)

    if (item && item.deleted_at !== null) {
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
    const purchaseCandidates = getMarketPurchaseKindsToCheck(assetKind as MarketPaidAssetKind)
    const purchases = await Promise.all(
      purchaseCandidates.map((purchaseKind) => findCompletedMarketPurchase(userId, itemId, purchaseKind, item.workspace_subject))
    )
    const purchase = purchases.find((candidate) => (
      candidate && isMarketAssetCoveredByPurchaseKind(assetKind as MarketPaidAssetKind, candidate.asset_kind as MarketPaidAssetKind)
    )) ?? null
    if (!purchase) {
      return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '구매 후 다운로드할 수 있습니다.' } }, { status: 403 })
    }
    purchaseId = purchase.id

    const hasPendingRefund = await hasPendingMarketRefundRequestForTarget({
      targetKind: 'legacy_purchase',
      legacyPurchaseId: purchaseId,
    })

    if (hasPendingRefund) {
      return NextResponse.json({
        success: false,
        error: { code: 'PENDING_REFUND', message: '환불 요청이 접수되어 심사 중입니다. 심사 중에는 다운로드할 수 없습니다.' },
      }, { status: 403 })
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
      user_id: userId,
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
