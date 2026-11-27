import type {
  CREDIT_SOURCE_STATUS_LABELS,
  MARKET_ENTITLEMENT_STATUS_LABELS,
  MARKET_ITEM_STATUS_LABELS,
  MARKET_ORDER_STATUS_LABELS,
  MARKET_REFUND_REQUEST_STATUS_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  REFUND_REQUEST_STATUS_LABELS,
} from '@/lib/admin-orders'
import type { MainAdScheduleStatus } from '@/lib/main-ad-carousel'
import type { MemberSuspensionScope } from '@/lib/member-suspension'

// 관리자 상태 → 색(tone) 대응(20번 5-1 표). 같은 상태는 어느 화면에서나 같은 색이다. 대응은 이 파일에만 둔다.
// 이름(글자)은 지금처럼 각 이름표(labelOf)에서 온다. 여기는 색 규칙만.

export const ADMIN_TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const
export type AdminTone = (typeof ADMIN_TONES)[number]

type ToneMap<Labels> = Record<keyof Labels, AdminTone>

// 충전 주문
const paymentOrder = {
  preparing: 'info',
  ready_unknown: 'info',
  ready: 'info',
  confirming: 'info',
  fulfillment_pending: 'info',
  completed: 'success',
  cancel_pending: 'info',
  refunded: 'info',
  failed: 'danger',
  expired: 'neutral',
  manual_review: 'warning',
} as const satisfies ToneMap<typeof PAYMENT_ORDER_STATUS_LABELS>

// 충전 환불 요청
const refundRequest = {
  pending_review: 'warning',
  processing: 'info',
  completed: 'info',
  rejected: 'danger',
  retryable_failed: 'warning',
  manual_review: 'warning',
} as const satisfies ToneMap<typeof REFUND_REQUEST_STATUS_LABELS>

// 크레딧 출처
const creditSource = {
  active: 'success',
  pending_refund: 'info',
  refunded: 'neutral',
} as const satisfies ToneMap<typeof CREDIT_SOURCE_STATUS_LABELS>

// 자료 구매 주문
const marketOrder = {
  completed: 'success',
  refunded: 'info',
  revoked: 'danger',
  failed: 'danger',
} as const satisfies ToneMap<typeof MARKET_ORDER_STATUS_LABELS>

// 자료 환불 요청
const marketRefundRequest = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  canceled: 'neutral',
  failed: 'danger',
} as const satisfies ToneMap<typeof MARKET_REFUND_REQUEST_STATUS_LABELS>

// 자료 권한
const marketEntitlement = {
  active: 'success',
  refunded: 'info',
  revoked: 'danger',
} as const satisfies ToneMap<typeof MARKET_ENTITLEMENT_STATUS_LABELS>

// 상품
const marketItem = {
  draft: 'neutral',
  published: 'success',
  hidden: 'warning',
  archived: 'neutral',
} as const satisfies ToneMap<typeof MARKET_ITEM_STATUS_LABELS>

// 문의(support-client.tsx 의 statusConfig 키)
const supportTicket = {
  pending: 'warning',
  in_progress: 'info',
  resolved: 'success',
  closed: 'neutral',
  deleted: 'danger',
} as const

// 회원(12번). 정지 범위 키는 MemberSuspensionScope(이름은 SUSPENSION_SCOPE_LABELS 그대로).
const member = {
  active: 'success',
  withdrawn: 'neutral',
  suspension_lifted: 'neutral',
  restricted: 'danger',
  login_blocked: 'danger',
} as const satisfies Record<'active' | 'withdrawn' | 'suspension_lifted' | MemberSuspensionScope, AdminTone>

// 홈 배너(22번): 노출 중·예약·종료·꺼짐. 키는 main-ad-carousel.ts 의 MainAdScheduleStatus(getMainAdScheduleStatus 결과) 그대로.
const banner = {
  live: 'success',
  scheduled: 'info',
  ended: 'neutral',
  off: 'neutral',
} as const satisfies Record<MainAdScheduleStatus, AdminTone>

// 후기 태그(20번 1단계 시범): 활성·비활성(is_active)
const reviewTag = {
  active: 'success',
  inactive: 'neutral',
} as const

// 충전 요금제(20번 3단계): 판매중·비활성(is_active)
const pricingPlan = {
  active: 'success',
  inactive: 'neutral',
} as const

export const ADMIN_STATUS_TONES = {
  paymentOrder,
  refundRequest,
  creditSource,
  marketOrder,
  marketRefundRequest,
  marketEntitlement,
  marketItem,
  supportTicket,
  member,
  banner,
  reviewTag,
  pricingPlan,
} as const

export type AdminStatusKind = keyof typeof ADMIN_STATUS_TONES

// 표에 없는 값(나중에 생긴 상태)은 회색. 표에 빠짐없이 넣는 것은 시험(admin-kit-status-tone)이 지킨다.
export function adminStatusTone(kind: AdminStatusKind, value: string | null | undefined): AdminTone {
  const tones: Record<string, AdminTone> = ADMIN_STATUS_TONES[kind]
  return value && Object.hasOwn(tones, value) ? tones[value] : 'neutral'
}
