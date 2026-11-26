// 관리자 작업 기록(계획 U3-5)의 종류 목록. 기록하는 코드와 조회 화면이 같이 쓰는 한 곳이다.
// DB(admin_audit_log.action)는 CHECK로 묶지 않으므로, 종류를 더할 때는 여기에 한 줄을 더한다.
// DB 함수 안에서 적는 종류(admin_permissions_replace, admin_account_revoke)도 이 목록에 있어야 한다(계약 테스트가 맞춰 본다).
export const ADMIN_AUDIT_ACTIONS = {
  credit_grant: '크레딧 수동 지급',
  credit_grant_limits_update: '크레딧 지급 기본 한도 변경',
  credit_revoke: '크레딧 수동 회수',
  market_refund_approve: '마켓 환불 승인',
  market_refund_reject: '마켓 환불 거부',
  market_refund_exception: '마켓 예외 환불(하자·고객센터 접수)',
  market_refund_owner_settle: '마켓 환불 대표 정산',
  support_ticket_reply: '문의 답변',
  market_item_status_change: '상품 상태 변경',
  market_item_price_change: '상품 가격 변경',
  market_item_delete: '상품 삭제(이력 있으면 숨김)',
  pricing_plan_create: '요금제 추가',
  pricing_plan_update: '요금제 수정',
  pricing_plan_delete: '요금제 삭제',
  pricing_plan_status_change: '요금제 판매 상태 변경',
  pricing_page_content_update: '충전 화면 문구 수정',
  point_charge_policy_update: '충전 결제 고지 문구 수정',
  point_charge_source_hold: '충전 크레딧 수동 사용 보류(SQL 템플릿)',
  point_charge_source_release: '충전 크레딧 수동 보류 해제(SQL 템플릿)',
  site_footer_save: '약관·바닥글 저장',
  site_brand_update: '사이트 이름·소개 문구 수정',
  market_purchase_policy_update: '자료 구매 고지 문구 수정',
  market_file_type_update: '파일 유형 수정',
  site_logo_update: '사이트 로고 변경',
  site_logo_reset: '사이트 로고 기본값으로 되돌리기',
  storefront_header_links_update: '회원 헤더 상단 메뉴 수정',
  signup_consent_item_save: '가입 동의 항목 저장',
  signup_consent_item_revise: '가입 동의 다시 받기(약관 개정)',
  signup_consent_texts_update: '가입 동의 안내 문구 수정',
  market_review_delete: '후기 삭제',
  payment_sales_stop: '충전 판매 중지',
  admin_account_create: '관리자 계정 생성',
  admin_account_delete: '관리자 계정 삭제',
  admin_account_password_reset: '관리자 비밀번호 재설정(대표)',
  admin_own_password_change: '내 비밀번호 변경',
  admin_permissions_replace: '관리자 권한 부여·회수',
  admin_account_revoke: '관리자 권한 해제',
  // 10번 묶음(회원 탈퇴·익명화): 모두 DB 함수가 같은 트랜잭션에서 남긴다.
  member_withdraw: '회원 탈퇴 처리(익명화, 대표)',
  member_withdraw_request: '회원 탈퇴 요청 기록(이메일·전화)',
  member_withdraw_request_reply: '탈퇴 요청 고지 발송·회신 기록',
  member_text_redact: '문의·환불 기록 가림',
  member_text_reviewed: '문의·환불 기록 가림 확인(가릴 것 없음)',
  withdrawn_held_order_close: '탈퇴 회원 보류 주문 닫기',
  withdrawn_member_event: '탈퇴 회원 보관함 추가 기록',
  withdrawn_record_view: '탈퇴 회원 보관 기록 열람',
  // 대표의 탈퇴 요청 취소는 route 가 남긴다(DB 함수가 행위자를 받지 않음).
  member_withdraw_request_cancel: '회원 탈퇴 요청 취소(대표)',
  // 10번 약관 문구 스크립트가 탈퇴 안내 문구(정책 texts)를 바꿀 때 남긴다.
  member_withdrawal_policy_update: '회원 탈퇴 안내 문구 변경',
  // 15번 묶음(공지 팝업·30일 전 고지): 팝업 저장은 DB 함수(save_site_notice_popup)가, 게시·시행·그만두기는 10번 약관 스크립트가 남긴다.
  site_notice_popup_save: '공지 팝업 저장',
  policy_upcoming_publish: '변경 예정 약관 게시',
  policy_upcoming_apply: '변경 예정 약관 시행',
  policy_upcoming_withdraw: '변경 예정 약관 고지 그만둠',
  // 11번 묶음(결제 화면 단순화): 접는 동의 문구 넣기(스크립트 A)·동의 방식 바꾸기(스크립트 B·되돌림)는 SQL 스크립트가 남긴다.
  // 관리자 화면 저장은 지금처럼 market_purchase_policy_update·point_charge_policy_update 로 남긴다.
  checkout_consent_keys_seed: '결제 동의 새 방식 문구 넣기(SQL 스크립트)',
  checkout_consent_format_change: '결제 동의 방식 바꾸기(SQL 스크립트)',
  // 12번 묶음(회원 이용 정지·관리자 메모): 모두 DB 함수가 같은 거래에서 남긴다(자유 글 없이 범위·분류·기간·글자 수만).
  member_suspend: '회원 이용 정지',
  member_suspension_lift: '회원 이용 정지 해제',
  member_suspension_notice_record: '정지 알림 발송 기록',
  member_note_add: '회원 관리자 메모 추가',
  member_note_delete: '회원 관리자 메모 삭제',
  member_note_redact: '회원 관리자 메모 가림(대표)',
  member_suspension_policy_update: '이용 정지 안내 문구 수정',
  // 13번 묶음(CS 도구): 답변 수정은 DB 함수(save_support_ticket_answer)가 같은 거래에서 남긴다(사유 원문 없이 글자 수만).
  // 나머지는 route·서버 액션이 남기고, 모두 details.request(IP·기기)를 넣는다. 열람은 작업 기록이 아니라 admin_member_access_log 에 남긴다.
  support_ticket_reply_edit: '문의 답변 수정',
  support_category_create: '문의 카테고리 추가',
  support_category_update: '문의 카테고리 수정',
  support_category_hide: '문의 카테고리 숨김',
  support_category_restore: '문의 카테고리 다시 사용',
  support_reply_template_save: '답변 템플릿 저장',
  support_reply_template_hide: '답변 템플릿 숨김',
  support_page_content_update: '고객지원 안내 문구 수정',
  // 14번 묶음(공지 게시판 + FAQ): 모두 DB 함수가 같은 거래에서 남긴다(제목·본문 원문 없이 지문·글자 수·바뀐 칸만 — 원문은 판 이력 표).
  site_board_post_save: '공지·FAQ 글 저장',
  site_board_post_delete: '공지·FAQ 글 삭제',
  site_board_post_reorder: '공지 고정·FAQ 순서 변경',
  site_board_post_redact: '공지·FAQ 글 가림',
  site_board_content_update: '공지·FAQ 안내 문구 수정',
  // 16번 묶음(회원 알림 문구 + 공지 알림): 모두 DB 함수가 같은 거래에서 남긴다. 보내기·회수 기록에는 제목·내용 원문과 회원 id 가 없다
  // (원문은 가릴 수 있는 기록 표). 문구 수정 기록은 회사 공개 문구라 바뀐 경로의 before·after 원문을 남긴다(계획 4절 예외).
  // 회원에 관한 결제·환불 처리가 아니므로 paymentLinkedActions 에 넣지 않는다(13번 14절 규칙).
  member_notification_texts_update: '회원 알림 문구 수정',
  member_broadcast_send: '공지 알림 보내기',
  member_broadcast_retract: '공지 알림 회수',
  // 17번 묶음(상품 정보 입력 보완): 모두 DB 함수가 같은 거래에서 남긴다. 결제 연결 아님(paymentLinkedActions 에 넣지 않음).
  // 이용 근거 기록에는 메모·증빙 위치 전문이 있다(회사 내부 업무 기록 — 입력 칸 옆에 개인정보를 넣지 말라는 안내).
  market_item_option_save: '상품 목록 항목(학년·자료유형·이용 근거) 저장',
  market_item_option_reorder: '상품 목록 항목 순서 변경',
  market_item_usage_basis_save: '상품 원저작물 이용 근거 저장',
  market_item_display_update: '상품 표시 설정 수정',
  // 18번 묶음(상품 업로드 개선): 복제·같은 구성으로 다음 상품은 DB 함수가 같은 거래에서 남긴다(결제 연결 아님).
  market_item_duplicate: '상품 복제·같은 구성으로 새 상품',
} as const

export type AdminAuditAction = keyof typeof ADMIN_AUDIT_ACTIONS

// 조회 화면의 출처: 이 기록(admin_audit_log)과 결제 쪽 조치 기록(payment_admin_actions)을 합쳐 본다.
export const ADMIN_AUDIT_SOURCE_LABELS = {
  admin: '관리자 작업',
  payment: '결제 조치',
} as const

export type AdminAuditSource = keyof typeof ADMIN_AUDIT_SOURCE_LABELS
