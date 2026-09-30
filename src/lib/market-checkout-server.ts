import 'server-only'

import { createAdminClient } from '@/lib/supabase/bypass'

export type MarketCheckoutMode = 'cart' | 'direct'

export interface MarketCheckoutLineInput {
  cartItemId?: string
  targetKind?: 'subproduct' | 'bundle'
  targetId?: string
  expectedCredits: number
  acknowledgeNoDiscount: boolean
}

export interface MarketCheckoutReceiptOrder {
  orderId: string
  cartItemId: string | null
  targetKind: 'subproduct' | 'bundle'
  targetId: string
  itemId: string
  workspaceSubject: string
  itemTitle: string
  optionTitle: string | null
  categoryName: string | null
  originalCredits: number
  chargedCredits: number
  upgradeBaseOrderId: string | null
}

export interface MarketCheckoutReceipt {
  ok: true
  batchId: string
  mode: MarketCheckoutMode
  totalCredits: number
  balanceAfter: number
  orders: MarketCheckoutReceiptOrder[]
  createdAt: string
  alreadyCompleted: boolean
}

export type MarketCheckoutOutcome =
  | { ok: true; receipt: MarketCheckoutReceipt }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }

type CheckoutRpcResult = MarketCheckoutReceipt | ({ ok: false; code: string } & Record<string, unknown>)

// 2.3(b): 교착·serialization 실패는 같은 키로 최대 3회 재시도, batch UNIQUE 위반은 1회 재호출해 replay로 처리한다.
const RETRYABLE_SQLSTATES = new Set(['40P01', '40001'])
const MAX_RETRIES = 3

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 422,
  NOT_FOUND: 404,
  CART_CHANGED: 409,
  PRICE_CHANGED: 409,
  ALREADY_OWNED: 409,
  ACK_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CONFLICTING_SELECTION: 422,
  CART_LIMIT: 422,
  INSUFFICIENT_CREDITS: 402,
  RETRY_EXHAUSTED: 503,
}

const MESSAGE_BY_CODE: Record<string, string> = {
  INVALID_INPUT: '구매 요청이 올바르지 않습니다.',
  NOT_FOUND: '구매 가능한 문제마켓 상품을 찾을 수 없습니다.',
  CART_CHANGED: '장바구니가 변경되었습니다. 다시 확인해주세요.',
  PRICE_CHANGED: '가격 또는 판매 상태가 변경되었습니다. 최신 정보를 확인한 뒤 다시 구매해주세요.',
  ALREADY_OWNED: '이미 구매한 자료입니다.',
  ACK_REQUIRED: '이미 구매한 자료가 포함되어 있어도 전체 패키지는 정가로 구매됨을 확인해주세요.',
  IDEMPOTENCY_CONFLICT: '이미 다른 내용으로 처리된 구매 요청입니다. 다시 시도해주세요.',
  CONFLICTING_SELECTION: '함께 구매할 수 없는 자료가 선택되었습니다.',
  CART_LIMIT: '장바구니에는 최대 50개까지 담을 수 있습니다.',
  INSUFFICIENT_CREDITS: '크레딧이 부족합니다.',
  RETRY_EXHAUSTED: '요청이 몰려 구매를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
  INTERNAL_SERVER_ERROR: '문제마켓 구매 처리에 실패했습니다.',
}

export function toMarketCheckoutFailure(code: string, details?: Record<string, unknown>): MarketCheckoutOutcome {
  return {
    ok: false,
    status: STATUS_BY_CODE[code] ?? 500,
    code,
    message: MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.INTERNAL_SERVER_ERROR,
    details,
  }
}

// checkout_market_selection RPC 호출. 분류는 RPC의 jsonb code 또는 SQLSTATE로만 한다(메시지 정규식 금지).
export async function runMarketCheckout(input: {
  userId: string
  mode: MarketCheckoutMode
  itemId: string | null
  lines: MarketCheckoutLineInput[]
  idempotencyKey: string
}): Promise<MarketCheckoutOutcome> {
  const rpcClient = createAdminClient() as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{
      data: unknown
      error: { code?: string; message: string } | null
    }>
  }

  let retries = 0
  let replayed = false

  for (;;) {
    const { data, error } = await rpcClient.rpc('checkout_market_selection', {
      p_user_id: input.userId,
      p_mode: input.mode,
      p_item_id: input.itemId,
      p_lines: input.lines,
      p_idempotency_key: input.idempotencyKey,
    })

    if (!error) {
      const result = data as CheckoutRpcResult
      if (result.ok) {
        return { ok: true, receipt: result }
      }
      return toMarketCheckoutFailure(result.code, result)
    }

    if (error.code && RETRYABLE_SQLSTATES.has(error.code)) {
      if (retries < MAX_RETRIES) {
        retries += 1
        continue
      }
      return toMarketCheckoutFailure('RETRY_EXHAUSTED')
    }

    if (error.code === '23505' && !replayed) {
      replayed = true
      continue
    }

    if (error.code === 'P0402') {
      return toMarketCheckoutFailure('INSUFFICIENT_CREDITS')
    }

    console.error('[MarketCheckout] checkout_market_selection failed', { code: error.code })
    return toMarketCheckoutFailure('INTERNAL_SERVER_ERROR')
  }
}
