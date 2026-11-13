import { createPaymentAdminClient } from '@/lib/payment-orders-server'

// 충전 판매 스위치의 현재 상태. 읽지 못하면 null("확인 불가")이다.
export interface PaymentSalesStatus {
  // 전체 스위치와 페이앱 스위치가 모두 켜져 있어야 새 충전 주문을 받는다.
  acceptsNewOrders: boolean
  masterAcceptsNewOrders: boolean
  payappAcceptsNewOrders: boolean
  changedAt: string
  changedBy: string
  changeTicket: string
}

// 관리자 확인을 마친 화면에서만 부른다(service role로 읽는다).
export async function getPaymentSalesStatus(): Promise<PaymentSalesStatus | null> {
  try {
    const { data, error } = await createPaymentAdminClient()
      .from('payment_runtime_config')
      .select('master_accepts_new_orders, payapp_accepts_new_orders, changed_at, changed_by, change_ticket')
      .eq('id', true)
      .limit(2)
    if (error || data?.length !== 1) {
      console.error('[payment-sales-status] 판매 스위치 조회 실패', error)
      return null
    }
    const row = data[0]
    return {
      acceptsNewOrders: row.master_accepts_new_orders && row.payapp_accepts_new_orders,
      masterAcceptsNewOrders: row.master_accepts_new_orders,
      payappAcceptsNewOrders: row.payapp_accepts_new_orders,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      changeTicket: row.change_ticket,
    }
  } catch (error) {
    console.error('[payment-sales-status] 판매 스위치 조회 실패', error)
    return null
  }
}
