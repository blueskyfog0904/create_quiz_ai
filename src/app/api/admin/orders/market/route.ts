import { NextRequest, NextResponse } from 'next/server'
import { listMarketOrdersForAdmin } from '@/lib/admin-orders-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'

export const dynamic = 'force-dynamic'

// 주문 조회 › 마켓 구매. 조회만 한다.
export async function GET(request: NextRequest) {
  const guard = await requireAdminApiPermission('orders.view')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const searchParams = new URL(request.url).searchParams
  try {
    const result = await listMarketOrdersForAdmin({
      q: searchParams.get('q'),
      status: searchParams.get('status'),
      subject: searchParams.get('subject'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })
    // 13번 8절: 응답에 실린 회원 이메일의 열람을 먼저 기록한다. 남기지 못하면 이메일을 가린다(Q4 가).
    const logged = await recordMemberAccess({
      access: guard.access,
      screen: 'orders.market',
      memberIds: result.orders.filter((order) => order.user?.email).map((order) => order.userId),
      fields: ['email'],
      context: { page: result.page, searched: Boolean(searchParams.get('q')?.trim()), count: result.orders.length },
      requestMeta: adminRequestMeta(request),
    })
    const data = logged ? result : { ...result, orders: result.orders.map((order) => ({ ...order, user: order.user ? { ...order.user, email: null } : null })) }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[admin-orders] 마켓 구매 주문을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '주문을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
