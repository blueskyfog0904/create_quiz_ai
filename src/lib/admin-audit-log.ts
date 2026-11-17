// 관리자 작업 기록(계획 U3-5)의 종류 목록. 기록하는 코드와 조회 화면이 같이 쓰는 한 곳이다.
// DB(admin_audit_log.action)는 CHECK로 묶지 않으므로, 종류를 더할 때는 여기에 한 줄을 더한다.
// DB 함수 안에서 적는 종류(admin_permissions_replace, admin_account_revoke)도 이 목록에 있어야 한다(계약 테스트가 맞춰 본다).
export const ADMIN_AUDIT_ACTIONS = {
  credit_grant: '크레딧 수동 지급',
  market_refund_approve: '마켓 환불 승인',
  market_refund_reject: '마켓 환불 거부',
  support_ticket_reply: '문의 답변',
  market_item_status_change: '상품 상태 변경',
  market_item_price_change: '상품 가격 변경',
  market_item_delete: '상품 삭제(이력 있으면 숨김)',
  pricing_plan_create: '요금제 추가',
  pricing_plan_update: '요금제 수정',
  pricing_plan_delete: '요금제 삭제',
  pricing_plan_status_change: '요금제 판매 상태 변경',
  site_footer_save: '약관·바닥글 저장',
  market_review_delete: '후기 삭제',
  payment_sales_stop: '충전 판매 중지',
  admin_account_create: '관리자 계정 생성',
  admin_account_delete: '관리자 계정 삭제',
  admin_account_password_reset: '관리자 비밀번호 재설정(대표)',
  admin_own_password_change: '내 비밀번호 변경',
  admin_permissions_replace: '관리자 권한 부여·회수',
  admin_account_revoke: '관리자 권한 해제',
} as const

export type AdminAuditAction = keyof typeof ADMIN_AUDIT_ACTIONS

// 조회 화면의 출처: 이 기록(admin_audit_log)과 결제 쪽 조치 기록(payment_admin_actions)을 합쳐 본다.
export const ADMIN_AUDIT_SOURCE_LABELS = {
  admin: '관리자 작업',
  payment: '결제 조치',
} as const

export type AdminAuditSource = keyof typeof ADMIN_AUDIT_SOURCE_LABELS
