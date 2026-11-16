// 관리자 '주문 조회'의 규칙(상태 이름, 필터 값, 검색 조건). DB·next에 기대지 않아 화면과 서버가 함께 쓴다.

export const PAYMENT_ORDER_STATUS_LABELS = {
  preparing: '결제 준비 중',
  ready_unknown: '결제창 확인 중',
  ready: '결제 대기',
  confirming: '승인 확인 중',
  fulfillment_pending: '지급 대기',
  completed: '결제 완료',
  cancel_pending: '취소 처리 중',
  refunded: '환불 완료',
  failed: '결제 실패',
  expired: '만료',
  manual_review: '수동 확인 필요',
} as const

// 'toss'는 과거 주문 이력용이다. 결제수단 이름은 DB(payment_methods.label)가 먼저고, 라벨이 없을 때만 이 이름을 쓴다.
export const PAYMENT_PROVIDER_LABELS = {
  payapp: '페이앱',
  kakaopay: '카카오페이',
  toss: '일반결제(이전)',
} as const

export const PAYMENT_ENVIRONMENT_LABELS = {
  live: '실결제',
  test: '테스트',
} as const

export const REFUND_REQUEST_STATUS_LABELS = {
  pending_review: '대기중',
  processing: '처리중',
  completed: '환불 완료',
  rejected: '거부',
  retryable_failed: '재처리 필요',
  manual_review: '수동 확인 필요',
} as const

export const REFUND_REQUEST_ORIGIN_LABELS = {
  user: '고객 요청',
  external_cancel: '결제사 취소',
  partial_cancel: '결제사 부분취소',
} as const

export const PAYMENT_ADMIN_ACTION_LABELS = {
  paid_confirmed: '결제 확인됨 (크레딧 지급)',
  unpaid_confirmed: '미결제 확인 (만료 처리)',
  cancel_handled: '취소 처리 확인',
  manual_refund_completed: '환불 수동 완료',
  manual_review_refund_rejected: '수동 확인 환불 거부',
  alert_resolved: '결제 경보 해소',
} as const

export const PAYMENT_EXTERNAL_METHOD_LABELS = {
  payapp_cancel_request: '페이앱 취소 요청(정산금 반환)',
  bank_transfer: '고객 계좌 송금',
  provider_admin_cancel: '결제사 관리자에서 취소',
} as const

export const CREDIT_SOURCE_STATUS_LABELS = {
  active: '사용 가능',
  pending_refund: '환불 진행 중',
  refunded: '환불됨',
} as const

// 이름표에 없는 값(나중에 추가된 상태 등)은 원래 값을 그대로 보여 준다.
export function labelOf(labels: Record<string, string>, value: string | null | undefined) {
  return value ? labels[value] ?? value : '-'
}

// 필터 값이 이름표에 있는 값이 아니면 '전체'로 본다.
export function normalizeOrderFilter<T extends string>(labels: Record<T, string>, value: unknown): T | 'all' {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? (value as T) : 'all'
}

// 검색어 한 칸: 주문번호 정확 일치 + 이메일이 맞는 회원의 주문 + 결제사 거래번호가 맞는 주문.
// PostgREST or() 조건 문자열을 만든다. 검색어는 큰따옴표로 감싸 쉼표·괄호가 조건을 깨지 않게 한다.
export function buildPaymentOrderSearchFilter(query: string, matchedUserIds: string[], matchedOrderIds: string[]) {
  const conditions = [`order_id.eq.${JSON.stringify(query)}`]
  if (matchedUserIds.length > 0) conditions.push(`user_id.in.(${matchedUserIds.join(',')})`)
  if (matchedOrderIds.length > 0) conditions.push(`id.in.(${matchedOrderIds.join(',')})`)
  return conditions.join(',')
}

// ilike 검색어의 와일드카드(%, _)와 역슬래시를 글자 그대로 찾게 한다.
export function escapeIlike(keyword: string) {
  return keyword.replace(/[\\%_]/g, '\\$&')
}

// ───── 마켓 구매 ─────

export const MARKET_ORDER_STATUS_LABELS = {
  completed: '구매 완료',
  refunded: '환불 완료',
  revoked: '회수됨',
  failed: '구매 실패',
} as const

export const MARKET_PURCHASE_LINE_TYPE_LABELS = {
  subproduct: '개별 구성',
  bundle: '묶음',
} as const

export const MARKET_ENTITLEMENT_SCOPE_LABELS = {
  item: '상품 전체',
  subproduct: '구성 1개',
  file: '파일 1개',
  legacy_asset: '이전 방식 자료',
} as const

export const MARKET_ENTITLEMENT_STATUS_LABELS = {
  active: '사용 가능',
  refunded: '환불로 회수',
  revoked: '회수됨',
} as const

export const MARKET_REFUND_REQUEST_STATUS_LABELS = {
  pending: '대기중',
  approved: '승인',
  rejected: '거부',
  canceled: '요청 취소',
  failed: '처리 실패',
} as const

export const MARKET_ITEM_STATUS_LABELS = {
  draft: '임시저장',
  published: '공개',
  hidden: '숨김',
  archived: '보관',
} as const

export const WORKSPACE_SUBJECT_LABELS = {
  korean: '국어',
  english: '영어',
} as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 검색어 한 칸: 주문 id 정확 일치 + 이메일이 맞는 회원의 주문 + 상품명이 맞는 상품의 주문.
// 주문 id는 uuid 열이라 uuid 모양일 때만 조건에 넣는다(아니면 DB가 오류를 낸다). 맞는 조건이 하나도 없으면 null(= 결과 0건).
export function buildMarketOrderSearchFilter(query: string, matchedUserIds: string[], matchedItemIds: string[]) {
  const conditions: string[] = []
  if (UUID_PATTERN.test(query)) conditions.push(`id.eq.${query}`)
  if (matchedUserIds.length > 0) conditions.push(`user_id.in.(${matchedUserIds.join(',')})`)
  if (matchedItemIds.length > 0) conditions.push(`item_id.in.(${matchedItemIds.join(',')})`)
  return conditions.length > 0 ? conditions.join(',') : null
}
