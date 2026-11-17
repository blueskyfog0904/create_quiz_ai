import { MAX_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'

// 회원 화면 문구가 쓰는 충전 정책 수치. 실제 판정은 DB가 하므로 아래 값은 DB와 같아야 한다
// (tests/point-charge-policy-contract.test.mjs가 마이그레이션 파일과 대조한다).
// - 환불 가능 일수: refund 판정 함수의 `v_order.approved_at + interval '7 days'`
//   (supabase/migrations/20261021090000_payapp_migration_b2.sql)
// - 사용기한 연수: 충전 지급 함수의 `p_approved_at + interval '1 year'`
//   (supabase/migrations/20261019090000_payapp_migration_a.sql)
// - 1회 한도: MAX_POINT_CHARGE_AMOUNT와 DB CHECK
//   (supabase/migrations/20260805100000_create_payment_orders_and_atomic_fulfillment.sql)
export const POINT_CHARGE_REFUND_DAYS = 7
export const POINT_CHARGE_VALIDITY_YEARS = 1
export const POINT_CHARGE_MAX_AMOUNT_TEXT = `${MAX_POINT_CHARGE_AMOUNT.toLocaleString('ko-KR')}원`
