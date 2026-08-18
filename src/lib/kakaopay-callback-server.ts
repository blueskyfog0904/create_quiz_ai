import 'server-only'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createOpaqueToken,
  hashOpaqueToken,
  KAKAOPAY_RESULT_COOKIE,
  KAKAOPAY_RESULT_TTL_SECONDS,
} from '@/lib/kakaopay-checkout-server'
import {
  approveKakaoPayPayment,
  cancelKakaoPayPayment,
  getKakaoPayCallbackOrigin,
  getKakaoPayOrder,
  KakaoPayError,
  type KakaoApproveResponse,
  validateApprovedKakaoPayPayment,
  validateFreshKakaoPayOrder,
  validateFullKakaoPayCancellation,
} from '@/lib/kakaopay-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'

type KakaoPayCallbackKind = 'approve' | 'cancel' | 'fail'

const callbackClaimSchema = z.object({
  payment_order_id: z.string().uuid(),
  order_id: z.string().min(1),
  partner_order_id: z.string().min(1),
  partner_user_id: z.string().min(1),
  expected_amount: z.number().int().positive(),
  expected_credits: z.number().int().positive(),
  tax_free_amount: z.number().int().nonnegative(),
  vat_amount: z.number().int().nonnegative(),
  provider_merchant_id: z.string().min(1),
  provider_transaction_id: z.string().min(1),
  callback_kind: z.enum(['approve', 'cancel', 'fail']),
})

type CallbackClaim = z.infer<typeof callbackClaimSchema>

function createResultRedirect(resultToken?: string) {
  const response = NextResponse.redirect(
    new URL('/checkout/kakaopay/result', getKakaoPayCallbackOrigin()),
    {
      status: 303,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    }
  )

  if (resultToken) {
    response.cookies.set(KAKAOPAY_RESULT_COOKIE, resultToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: KAKAOPAY_RESULT_TTL_SECONDS,
    })
  }

  return response
}

async function markCallbackFailure(input: {
  claim: CallbackClaim
  code: string
  message: string
  manualReview: boolean
}) {
  const admin = createPaymentAdminClient()
  const { error } = await admin.rpc('mark_kakaopay_callback_failure', {
    p_payment_order_id: input.claim.payment_order_id,
    p_failure_code: input.code,
    p_failure_message: input.message,
    p_manual_review: input.manualReview,
  })

  if (error) {
    console.error('[KakaoPayCallback] Failed to persist callback failure', {
      orderId: input.claim.order_id,
      errorCode: error.code,
    })
  }
}

async function compensateInvalidApproval(
  claim: CallbackClaim,
  error: KakaoPayError
) {
  try {
    const cancellation = await cancelKakaoPayPayment({
      tid: claim.provider_transaction_id,
      cancelAmount: claim.expected_amount,
      cancelTaxFreeAmount: claim.tax_free_amount,
      cancelVatAmount: claim.vat_amount,
    })
    validateFullKakaoPayCancellation(cancellation, {
      cid: claim.provider_merchant_id,
      tid: claim.provider_transaction_id,
      partnerOrderId: claim.partner_order_id,
      partnerUserId: claim.partner_user_id,
      totalAmount: claim.expected_amount,
      taxFreeAmount: claim.tax_free_amount,
      vatAmount: claim.vat_amount,
    })
    await markCallbackFailure({
      claim,
      code: error.code,
      message: '승인정보가 주문과 일치하지 않아 결제를 취소했습니다.',
      manualReview: false,
    })
  } catch {
    await markCallbackFailure({
      claim,
      code: 'KAKAOPAY_AUTO_CANCEL_REQUIRES_REVIEW',
      message: '승인정보 불일치 후 카카오페이 취소 결과를 확인해야 합니다.',
      manualReview: true,
    })
  }
}

export async function handleKakaoPayCallback(
  request: Request,
  kind: KakaoPayCallbackKind
) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state') ?? ''
  const pgToken = url.searchParams.get('pg_token') ?? ''

  if (
    state.length < 32 ||
    state.length > 200 ||
    (kind === 'approve' && (pgToken.length < 1 || pgToken.length > 500))
  ) {
    return createResultRedirect()
  }

  const resultToken = createOpaqueToken()
  const resultTokenExpiresAt = new Date(
    Date.now() + KAKAOPAY_RESULT_TTL_SECONDS * 1000
  ).toISOString()
  const admin = createPaymentAdminClient()
  const { data: claimData, error: claimError } = await admin.rpc(
    'claim_kakaopay_callback',
    {
      p_callback_state_hash: hashOpaqueToken(state),
      p_callback_kind: kind,
      p_result_token_hash: hashOpaqueToken(resultToken),
      p_result_token_expires_at: resultTokenExpiresAt,
    }
  )

  const parsedClaim = callbackClaimSchema.safeParse(claimData)
  if (claimError || !parsedClaim.success) {
    return createResultRedirect()
  }

  const claim = parsedClaim.data
  const resultResponse = createResultRedirect(resultToken)
  if (kind !== 'approve') {
    return resultResponse
  }

  let approval: KakaoApproveResponse | null = null

  try {
    approval = await approveKakaoPayPayment({
      tid: claim.provider_transaction_id,
      partnerOrderId: claim.partner_order_id,
      partnerUserId: claim.partner_user_id,
      pgToken,
    })
    const expected = {
      cid: claim.provider_merchant_id,
      tid: claim.provider_transaction_id,
      approvalId: approval.aid,
      partnerOrderId: claim.partner_order_id,
      partnerUserId: claim.partner_user_id,
      totalAmount: claim.expected_amount,
      taxFreeAmount: claim.tax_free_amount,
      vatAmount: claim.vat_amount,
    }
    validateApprovedKakaoPayPayment(approval, expected)

    const freshOrder = await getKakaoPayOrder(claim.provider_transaction_id)
    validateFreshKakaoPayOrder(freshOrder, expected)

    const approvedAt = freshOrder.approved_at ?? approval.approved_at
    const { error: recordError } = await admin.rpc(
      'record_kakaopay_approval',
      {
        p_payment_order_id: claim.payment_order_id,
        p_provider_transaction_id: claim.provider_transaction_id,
        p_provider_approval_id: approval.aid,
        p_provider_status: freshOrder.status,
        p_payment_method_type: freshOrder.payment_method_type,
        p_approved_at: approvedAt,
      }
    )
    if (recordError) {
      console.error('[KakaoPayCallback] Approval requires reconciliation', {
        orderId: claim.order_id,
        errorCode: recordError.code,
      })
      return resultResponse
    }

    const { error: finalizeError } = await admin.rpc(
      'finalize_kakaopay_payment',
      {
        p_payment_order_id: claim.payment_order_id,
        p_provider_transaction_id: claim.provider_transaction_id,
        p_provider_approval_id: approval.aid,
        p_provider_status: freshOrder.status,
        p_payment_method_type: freshOrder.payment_method_type,
        p_provider_merchant_id: claim.provider_merchant_id,
        p_approved_at: approvedAt,
      }
    )
    if (finalizeError) {
      console.error('[KakaoPayCallback] Fulfillment requires reconciliation', {
        orderId: claim.order_id,
        errorCode: finalizeError.code,
      })
    }
  } catch (error) {
    if (
      approval &&
      error instanceof KakaoPayError &&
      error.outcome === 'definite_failure'
    ) {
      await compensateInvalidApproval(claim, error)
    } else if (
      error instanceof KakaoPayError &&
      error.outcome === 'definite_failure'
    ) {
      await markCallbackFailure({
        claim,
        code: error.code,
        message: '카카오페이 승인을 완료하지 못했습니다.',
        manualReview: false,
      })
    }
  }

  return resultResponse
}
