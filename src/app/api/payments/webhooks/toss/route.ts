import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'

export const dynamic = 'force-dynamic'

const paymentWebhookSchema = z.object({
  eventType: z.string().trim().min(1).max(80),
  createdAt: z.string().trim().min(1).max(80),
  data: z.object({
    orderId: z.string().trim().min(6).max(64),
  }).passthrough(),
}).passthrough()

function isAuthorizedWebhook(request: Request) {
  const expectedToken = process.env.TOSS_WEBHOOK_TOKEN?.trim()
  const providedToken = new URL(request.url).searchParams.get('token')?.trim()

  if (!expectedToken || !providedToken) {
    return false
  }

  const expected = Buffer.from(expectedToken)
  const provided = Buffer.from(providedToken)
  return (
    expected.length === provided.length &&
    timingSafeEqual(expected, provided)
  )
}

export async function POST(request: Request) {
  if (!isAuthorizedWebhook(request)) {
    return NextResponse.json(
      { success: false, error: 'UNAUTHORIZED_WEBHOOK' },
      { status: 401 }
    )
  }

  const transmissionId = request.headers
    .get('tosspayments-webhook-transmission-id')
    ?.trim()
  const providerRetryCount = Number.parseInt(
    request.headers.get('tosspayments-webhook-transmission-retried-count') ??
      '0',
    10
  )
  const rawBody = await request.text()
  let body: unknown

  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { success: false, error: 'INVALID_WEBHOOK' },
      { status: 400 }
    )
  }

  const parsed = paymentWebhookSchema.safeParse(body)
  if (
    !transmissionId ||
    transmissionId.length > 200 ||
    !parsed.success
  ) {
    return NextResponse.json(
      { success: false, error: 'INVALID_WEBHOOK' },
      { status: 400 }
    )
  }

  const event = parsed.data
  const admin = createPaymentAdminClient()
  const { error: insertError } = await admin
    .from('payment_webhook_events')
    .insert({
      transmission_id: transmissionId,
      event_type: event.eventType,
      order_id: event.data.orderId,
      payload_hash: createHash('sha256').update(rawBody).digest('hex'),
      provider_retry_count: Number.isFinite(providerRetryCount)
        ? Math.max(0, providerRetryCount)
        : 0,
    })

  if (insertError && insertError.code !== '23505') {
    return NextResponse.json(
      { success: false, error: 'WEBHOOK_PERSIST_FAILED' },
      { status: 500 }
    )
  }

  if (insertError?.code === '23505') {
    return NextResponse.json({
      success: true,
      accepted: true,
      duplicate: true,
    })
  }

  if (event.eventType !== 'PAYMENT_STATUS_CHANGED') {
    await admin
      .from('payment_webhook_events')
      .update({
        processing_status: 'ignored',
        processed_at: new Date().toISOString(),
      })
      .eq('transmission_id', transmissionId)
    return NextResponse.json({ success: true, ignored: true })
  }

  return NextResponse.json({ success: true, accepted: true })
}
