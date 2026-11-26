import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  addMarketCartItem,
  guardMarketCartRequest,
  marketCartErrorResponse,
  removeMarketCartItems,
  setMarketCartSelection,
} from '@/lib/market-cart-server'

export const dynamic = 'force-dynamic'

const AddBodySchema = z.discriminatedUnion('targetKind', [
  z.object({ targetKind: z.literal('subproduct'), subproductId: z.string().uuid() }).strict(),
  z.object({ targetKind: z.literal('bundle'), bundleOptionId: z.string().uuid() }).strict(),
])

const CartItemIdsSchema = z.array(z.string().uuid()).min(1).max(50)

const PatchBodySchema = z.object({
  ids: CartItemIdsSchema,
  isSelected: z.boolean(),
}).strict()

const DeleteBodySchema = z.object({
  ids: CartItemIdsSchema,
}).strict()

function invalidInput(message?: string) {
  return marketCartErrorResponse({ status: 400, code: 'INVALID_INPUT', message: message || '장바구니 요청이 올바르지 않습니다.' })
}

export async function POST(request: NextRequest) {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  const parsed = AddBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return invalidInput(parsed.error.issues[0]?.message)
  }

  const target = parsed.data
  const outcome = await addMarketCartItem(
    guard.userId,
    target.targetKind,
    target.targetKind === 'bundle' ? target.bundleOptionId : target.subproductId
  )
  if (!outcome.ok) {
    return marketCartErrorResponse(outcome)
  }

  // 11번 0-9·7절: 이미 담겨 있던 줄(선택을 풀어 두었을 수 있음)은 같은 요청 안에서 선택으로 바꾼다.
  // 선택 저장에 실패해도 담기 자체는 성공이므로 200 으로 두고 reselected 로 구분한다(상세 결과 창이 다른 문구로 알림).
  let reselected: boolean | null = null
  if (!outcome.data.created) {
    const cartItemId = outcome.data.cartItemId as string
    const selection = await setMarketCartSelection(guard.userId, [cartItemId], true)
    reselected = selection.ok && Array.isArray(selection.data.updatedIds) && selection.data.updatedIds.includes(cartItemId)
  }

  return NextResponse.json({
    success: true,
    data: {
      cartItemId: outcome.data.cartItemId,
      created: outcome.data.created,
      count: outcome.data.count,
      // 새로 담은 줄은 null, 이미 있던 줄은 선택으로 바꿨으면 true·못 바꿨으면 false
      reselected,
    },
  })
}

export async function PATCH(request: NextRequest) {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  const parsed = PatchBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return invalidInput(parsed.error.issues[0]?.message)
  }

  const outcome = await setMarketCartSelection(guard.userId, parsed.data.ids, parsed.data.isSelected)
  if (!outcome.ok) {
    return marketCartErrorResponse(outcome)
  }

  return NextResponse.json({
    success: true,
    data: {
      updatedIds: outcome.data.updatedIds,
      missingIds: outcome.data.missingIds,
    },
  })
}

export async function DELETE(request: NextRequest) {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  const parsed = DeleteBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return invalidInput(parsed.error.issues[0]?.message)
  }

  const outcome = await removeMarketCartItems(guard.userId, parsed.data.ids)
  if (!outcome.ok) {
    return marketCartErrorResponse(outcome)
  }

  return NextResponse.json({
    success: true,
    data: {
      removedIds: outcome.data.removedIds,
      count: outcome.data.count,
    },
  })
}
