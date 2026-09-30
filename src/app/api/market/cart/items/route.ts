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

  return NextResponse.json({
    success: true,
    data: {
      cartItemId: outcome.data.cartItemId,
      created: outcome.data.created,
      count: outcome.data.count,
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
