import 'server-only'

import { createHash } from 'node:crypto'
import {
  PayAppError,
  verifyPayAppFeedback,
  type PayAppFeedback,
} from '@/lib/payapp-server'
import type { createPaymentAdminClient } from '@/lib/payment-orders-server'
import type { Database, Json } from '@/types/supabase'

type PaymentAdminClient = ReturnType<typeof createPaymentAdminClient>
type ApplyFeedbackArgs = Database['public']['Functions']['apply_payapp_feedback']['Args']

export interface PayAppWebhookReply {
  body: 'SUCCESS' | 'FAIL'
  status: number
}

export interface PayAppRpcResult {
  result?: string
  reason?: string
  payment_order_id?: string
  order_id?: string
  user_id?: string
  marker?: string
  outcome?: string
  already_recorded?: boolean
  fulfillment_error_state?: string | null
  pay_type_mismatch?: boolean
  paid_amount_conflict?: boolean
  partial_cancel_amount_mismatch?: boolean
  partial_cancel_amount?: number | null
  actual_refund_amount?: number | null
}

export interface Alert {
  code: string
  severity: 'warning' | 'critical'
  message: string
  details: Record<string, Json | undefined>
  notifyAdmins?: boolean
}

export interface FollowUps {
  alerts: Alert[]
  userNotification?: { userId: string; title: string; message: string; link: string }
}

const SUCCESS: PayAppWebhookReply = { body: 'SUCCESS', status: 200 }
const RETRY: PayAppWebhookReply = { body: 'FAIL', status: 503 }

// 지급·취소 처리 결과 중 이벤트를 완료로 닫고 SUCCESS를 응답하는 것들.
// recorded_pending은 결제완료 기록은 남았고 지급만 실패한 것이다. 대사가 다시 지급한다(5.5.2).
const COMPLETED_FEEDBACK_RESULTS = new Set([
  'fulfilled',
  'recorded_pending',
  'already_fulfilled',
  'cancelled_before_fulfillment',
  'request_recorded',
  'expired',
  'unchanged',
  'recorded',
])

function eventDetails(feedback: PayAppFeedback, result?: PayAppRpcResult) {
  return {
    mul_no: feedback.mulNo,
    orig_mul_no: feedback.origMulNo,
    pay_state: feedback.payState,
    order_id: result?.order_id ?? feedback.orderId,
    payment_order_id: result?.payment_order_id,
  }
}

async function markEvent(
  admin: PaymentAdminClient,
  transmissionId: string,
  status: 'completed' | 'ignored' | 'failed',
  errorCode: string | null = null
) {
  await admin
    .from('payment_webhook_events')
    .update({
      processing_status: status,
      last_error_code: errorCode,
      processed_at: new Date().toISOString(),
    })
    .eq('transmission_id', transmissionId)
    // 늦게 끝난 쪽이 completed를 되돌리지 않게 한다.
    .neq('processing_status', 'completed')
}

// 경보·알림은 결제 트랜잭션 밖에서 남기고, 실패해도 응답을 바꾸지 않는다.
export async function runFollowUps(admin: PaymentAdminClient, followUps: FollowUps) {
  for (const alert of followUps.alerts) {
    try {
      await admin.rpc('record_payment_alert', {
        p_code: alert.code,
        p_severity: alert.severity,
        p_message: alert.message,
        p_details: alert.details as Json,
      })

      if (alert.notifyAdmins) {
        const { data: admins } = await admin
          .from('profiles')
          .select('id')
          .eq('is_admin', true)
        const orderId = typeof alert.details.order_id === 'string'
          ? alert.details.order_id
          : '확인 필요'

        if (admins?.length) {
          await admin.from('notifications').insert(admins.map((row) => ({
            user_id: row.id,
            type: 'warning',
            title: '페이앱 결제 확인 필요',
            message: `${alert.message} (주문 ${orderId})`,
            link: '/admin/refunds',
            is_read: false,
          })))
        }
      }
    } catch {
      // 경보 기록 실패는 결제 처리 결과와 무관하다.
    }
  }

  if (followUps.userNotification) {
    try {
      const { userId, title, message, link } = followUps.userNotification
      await admin.from('notifications').insert({
        user_id: userId,
        type: 'success',
        title,
        message,
        link,
        is_read: false,
      })
    } catch {
      // 사용자 알림 실패는 결제 처리 결과와 무관하다.
    }
  }
}

function feedbackFollowUps(feedback: PayAppFeedback, result: PayAppRpcResult): FollowUps {
  const details = eventDetails(feedback, result)
  const alerts: Alert[] = []

  if (result.pay_type_mismatch) {
    alerts.push({
      code: 'PAYAPP_PAY_TYPE_MISMATCH',
      severity: 'warning',
      message: '선택한 결제수단과 실제 결제수단이 다릅니다.',
      details: { ...details, pay_type: feedback.payType },
      notifyAdmins: true,
    })
  }
  if (result.paid_amount_conflict) {
    alerts.push({
      code: 'PAYAPP_PAID_AMOUNT_CONFLICT',
      severity: 'critical',
      message: '같은 결제에 다른 결제완료 금액이 통보되었습니다.',
      details: { ...details, price: feedback.price },
      notifyAdmins: true,
    })
  }

  const userNotification = result.result === 'fulfilled' && result.user_id
    ? {
        userId: result.user_id,
        title: '크레딧 충전 완료',
        message: '결제가 확인되어 크레딧이 충전되었습니다.',
        link: '/mypage/credits',
      }
    : undefined

  return { alerts, userNotification }
}

// 표식 기록 결과로 정해지는 경보. 취소 처리가 실패해도 남도록 처리 전에 만든다.
function markerAlerts(
  feedback: PayAppFeedback,
  marker: PayAppRpcResult,
  repeatedPartialCancel: boolean
): Alert[] {
  const details = eventDetails(feedback, marker)
  const alerts: Alert[] = []

  if (marker.partial_cancel_amount_mismatch) {
    alerts.push({
      code: 'PAYAPP_PARTIAL_CANCEL_AMOUNT_CONFLICT',
      severity: 'warning',
      message: '같은 결제에 다른 부분취소 금액이 통보되었습니다.',
      details: { ...details, price: feedback.price },
      notifyAdmins: true,
    })
  } else if (repeatedPartialCancel) {
    // 표식은 첫 부분취소만 남는다. 추가 부분취소 금액은 경보로만 알 수 있다.
    alerts.push({
      code: 'PAYAPP_PARTIAL_CANCEL_REPEATED',
      severity: 'critical',
      message: '이미 부분취소된 결제에 부분취소가 다시 통보되었습니다. 실제 환불액을 확인하세요.',
      details: { ...details, price: feedback.price },
      notifyAdmins: true,
    })
  }

  return alerts
}

// 통보와 대사가 같은 취소 처리 결과에 같은 경보를 남긴다.
export function cancellationFollowUps(
  details: Record<string, Json | undefined>,
  result: PayAppRpcResult
): FollowUps {
  const alerts: Alert[] = []

  switch (result.result) {
    case 'double_refund_suspected':
      alerts.push({
        code: 'PAYAPP_DOUBLE_REFUND_SUSPECTED',
        severity: 'critical',
        message: '계좌이체로 환불한 결제가 페이앱에서도 취소되었습니다.',
        details,
        notifyAdmins: true,
      })
      break
    case 'cancel_handling_failed':
      alerts.push({
        code: 'PAYAPP_CANCEL_HANDLING_FAILED',
        severity: 'critical',
        message: '페이앱 취소 처리에 실패해 크레딧을 묶고 수동 확인으로 보냈습니다.',
        details,
        notifyAdmins: true,
      })
      break
    case 'already_quarantined':
      // 격리 중인 결제가 승인취소되면 잔액까지 환불된 것이다. 수동 완료 때 전액 회수해야 한다.
      if (result.marker === 'cancel') {
        alerts.push({
          code: 'PAYAPP_CANCEL_AFTER_QUARANTINE',
          severity: 'critical',
          message: '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.',
          details,
          notifyAdmins: true,
        })
      }
      break
    case 'partial_cancel_after_cancel':
      alerts.push({
        code: 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL',
        severity: 'warning',
        message: '승인취소를 처리한 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.',
        details: {
          ...details,
          partial_cancel_amount: result.partial_cancel_amount ?? null,
          actual_refund_amount: result.actual_refund_amount ?? null,
        },
        notifyAdmins: true,
      })
      break
    case 'partial_cancel_quarantined':
      if (result.outcome === 'absorbed_by_refund') {
        alerts.push({
          code: 'PAYAPP_PARTIAL_CANCEL_ABSORBED',
          severity: 'warning',
          message: '전액 환불된 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.',
          details: {
            ...details,
            partial_cancel_amount: result.partial_cancel_amount ?? null,
            actual_refund_amount: result.actual_refund_amount ?? null,
          },
          notifyAdmins: true,
        })
      }
      break
    case 'deferred_refund_processing':
      alerts.push({
        code: 'PAYAPP_PARTIAL_CANCEL_DEFERRED',
        severity: 'warning',
        message: '환불 처리 중인 결제에 부분취소가 통보되었습니다. 환불이 끝난 뒤 대사가 정리합니다.',
        details,
      })
      break
  }

  const userNotification = result.result === 'refund_finalized' && result.user_id
    ? {
        userId: result.user_id,
        title: '환불 완료',
        message: '결제 취소가 확인되어 환불이 완료되었습니다.',
        link: '/mypage/payments',
      }
    : undefined

  return { alerts, userNotification }
}

export async function handlePayAppFeedback(
  body: string,
  admin: PaymentAdminClient
): Promise<PayAppWebhookReply> {
  let feedback: PayAppFeedback
  try {
    feedback = verifyPayAppFeedback(new URLSearchParams(body))
  } catch (error) {
    // 우리 키 설정이 틀린 경우 페이앱 재통보로 고칠 시간을 번다. 받은 값은 위조일 수 있어 남기지 않는다.
    const configurationInvalid = error instanceof PayAppError &&
      error.code === 'PAYAPP_CONFIGURATION_INVALID'
    await runFollowUps(admin, {
      alerts: [{
        code: configurationInvalid ? 'PAYAPP_CONFIGURATION_INVALID' : 'PAYAPP_FEEDBACK_UNAUTHORIZED',
        severity: 'critical',
        message: configurationInvalid
          ? '페이앱 설정이 없어 통보를 처리하지 못했습니다.'
          : '인증되지 않은 페이앱 통보를 거부했습니다.',
        details: {},
      }],
    })
    return { body: 'FAIL', status: configurationInvalid ? 503 : 401 }
  }

  const followUps: FollowUps = { alerts: [] }
  if (feedback.dateParseFailed) {
    followUps.alerts.push({
      code: 'PAYAPP_FEEDBACK_DATE_UNPARSED',
      severity: 'warning',
      message: '페이앱 통보의 일시 형식을 읽지 못했습니다.',
      details: eventDetails(feedback),
    })
  }

  // 다시 보내도 처리할 수 없는 통보는 기록과 경보만 남긴다.
  if (!feedback.mulNo || feedback.payState === null) {
    followUps.alerts.push({
      code: 'PAYAPP_FEEDBACK_MALFORMED',
      severity: 'warning',
      message: '결제요청번호나 결제 상태가 없는 페이앱 통보를 받았습니다.',
      details: eventDetails(feedback),
    })
    await runFollowUps(admin, followUps)
    return SUCCESS
  }

  const transmissionId = `payapp:${feedback.mulNo}:${feedback.payState}`
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ ...feedback, userId: undefined, feedbackType: undefined }))
    .digest('hex')

  // order_id는 비워 둔다(기존 대사 함수가 이 이벤트를 덮어쓰지 않게). 주문 연결은 거래 행으로 한다.
  const { error: insertError } = await admin
    .from('payment_webhook_events')
    .insert({
      transmission_id: transmissionId,
      event_type: `PAYAPP_PAY_STATE_${feedback.payState}`,
      order_id: null,
      payload_hash: payloadHash,
    })

  if (insertError && insertError.code !== '23505') return RETRY

  // 표식 기록(apply)이 실패했던 통보의 재통보도 첫 처리로 본다.
  let firstDelivery = !insertError
  if (insertError) {
    const { data: existing, error: existingError } = await admin
      .from('payment_webhook_events')
      .select('processing_status, last_error_code')
      .eq('transmission_id', transmissionId)
      .maybeSingle()

    if (existingError || !existing) return RETRY
    if (existing.processing_status === 'completed' || existing.processing_status === 'ignored') {
      return SUCCESS
    }
    firstDelivery = existing.processing_status === 'failed' &&
      (existing.last_error_code ?? '').startsWith('APPLY:')
  }

  // 생성 타입은 null 인자를 표현하지 못하지만 RPC는 NULL을 받는다.
  const { data, error } = await admin.rpc('apply_payapp_feedback', {
    p_userid: feedback.userId,
    p_mul_no: feedback.mulNo,
    p_orig_mul_no: feedback.origMulNo,
    p_order_id: feedback.orderId,
    p_pay_state: feedback.payState,
    p_price: feedback.price,
    p_orig_price: feedback.origPrice,
    p_pay_type: feedback.payType,
    p_pay_date: feedback.payDate,
    p_canceldate: feedback.cancelDate,
  } as unknown as ApplyFeedbackArgs)

  if (error) {
    await markEvent(admin, transmissionId, 'failed', `APPLY:${error.code ?? 'FAILED'}`)
    await runFollowUps(admin, followUps)
    return RETRY
  }

  const result = (data ?? {}) as PayAppRpcResult

  if (result.result === 'cancel_marker_recorded' && result.payment_order_id) {
    // 표식은 이미 커밋됐다. 처리가 실패하면 재통보나 대사가 다시 처리한다.
    // 한 번에 표식 하나(승인취소 우선)만 처리하므로, 이번 통보의 표식이 남았으면 한 번 더 부른다.
    const repeatedPartialCancel = firstDelivery &&
      result.marker === 'partial_cancel' &&
      result.already_recorded === true
    followUps.alerts.push(...markerAlerts(feedback, result, repeatedPartialCancel))

    for (let call = 0; call < 2; call += 1) {
      const { data: processed, error: processError } = await admin.rpc(
        'process_payapp_cancellation',
        { p_payment_order_id: result.payment_order_id }
      )

      if (processError) {
        await markEvent(admin, transmissionId, 'failed', `PROCESS:${processError.code ?? 'FAILED'}`)
        await runFollowUps(admin, followUps)
        return RETRY
      }

      const processedResult = (processed ?? {}) as PayAppRpcResult
      const cancellation = cancellationFollowUps(eventDetails(feedback, processedResult), processedResult)
      followUps.alerts.push(...cancellation.alerts)
      followUps.userNotification ??= cancellation.userNotification

      if (!processedResult.marker || processedResult.marker === result.marker) break
    }

    await markEvent(admin, transmissionId, 'completed')
    await runFollowUps(admin, followUps)
    return SUCCESS
  }

  if (result.result === 'ignored' || result.result === 'order_not_found') {
    const orderNotFound = result.result === 'order_not_found'
    followUps.alerts.push({
      code: orderNotFound
        ? 'PAYAPP_FEEDBACK_ORDER_NOT_FOUND'
        : result.reason ?? 'PAYAPP_FEEDBACK_IGNORED',
      severity: 'warning',
      message: orderNotFound
        ? '주문을 찾을 수 없는 페이앱 통보를 받았습니다.'
        : `페이앱 통보 검증에 실패했습니다: ${result.reason ?? '사유 없음'}`,
      details: { ...eventDetails(feedback, result), price: feedback.price },
      // 결제완료인데 주문이 없으면 돈만 받은 상태일 수 있다.
      notifyAdmins: !orderNotFound || feedback.payState === 4,
    })
    await markEvent(admin, transmissionId, 'ignored', result.reason ?? result.result)
    await runFollowUps(admin, followUps)
    return SUCCESS
  }

  if (result.result && COMPLETED_FEEDBACK_RESULTS.has(result.result)) {
    const completed = feedbackFollowUps(feedback, result)
    followUps.alerts.push(...completed.alerts)
    followUps.userNotification = completed.userNotification
    // 지급만 실패한 경우(recorded_pending) 원인을 이벤트에 남긴다.
    await markEvent(admin, transmissionId, 'completed', result.fulfillment_error_state ?? null)
    await runFollowUps(admin, followUps)
    return SUCCESS
  }

  followUps.alerts.push({
    code: 'PAYAPP_FEEDBACK_RESULT_UNKNOWN',
    severity: 'critical',
    message: '페이앱 통보 처리 결과를 해석하지 못했습니다.',
    details: { ...eventDetails(feedback, result), result: result.result ?? null },
  })
  await markEvent(admin, transmissionId, 'failed', 'RESULT_UNKNOWN')
  await runFollowUps(admin, followUps)
  return RETRY
}
