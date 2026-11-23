# 7번 묶음 계획: 자료 구매 고지·동의와 상품 정보 표시 (1판)

작성일: 2026-11-23 · 순서표 `docs/prelaunch-work-order.md` 7번 · 사실 조사(코드 근거)는 이 문서 끝 '근거'

## 0. 결정(이미 정해진 것)
- 다운로드한 자료는 환불 불가, 받지 않았으면 일정 기간 안 환불(대표 결정 30일 — **기간 값 변경은 8번 묶음**. 이번에는 지금 동작 그대로 7일).
- 구매 자료 이용 범위: 본인 수업·학습용 인쇄, 본인이 가르치는 학생에게 인쇄물 배포 허용 / 파일 공유·재판매·온라인 게시 금지(약관 제7조, 6번 묶음 적용).
- 하드코딩 금지: 문구·값은 DB.

## 1. 범위
하는 것
- A. **환불 기간 값 한 곳**: `system_settings` 새 키 `market_purchase_policy` 의 `refundDays`(첫 값 7). 자료 환불 판정(`src/lib/market-refunds.ts`)과 구매 고지 문구가 같은 값을 씀 → 8번은 값만 30으로 바꾸고 결제 검증.
- B. **구매 확인창 필수 체크**: 상품 상세·장바구니 공용 확인창(`market-checkout-confirm-dialog.tsx`)에 고지 문구와 필수 체크("다운로드한 자료는 환불할 수 없고, 받지 않은 자료는 구매 후 {refundDays}일 안에 환불할 수 있음을 확인했습니다" — DB 문구). 체크해야 구매 버튼 활성. 기존 '기보유분 정가' 체크는 그대로(조건부).
- C. **서버 강제와 동의 기록**: 구매 API 2개(상품 상세·장바구니) body 에 `acknowledgePurchaseNotice: true` 와 `noticeSha256`(화면이 받은 고지 문구 지문) 필수(strict). 없거나 false 면 400 `PURCHASE_NOTICE_ACK_REQUIRED`, 지문이 지금 고지와 다르면 409 `PURCHASE_NOTICE_CHANGED`(화면이 새 문구로 다시 보여 줌). 통과하면 결제 RPC 를 부르기 **전에** 추가 전용 표 `market_purchase_notice_acks`(user_id, idempotency_key, notice_sha256, notice_text, refund_days, created_at)에 1행(같은 user·키는 1행만) — 결제 RPC(`checkout_market_selection`)는 **바꾸지 않음**. 주문과는 (user_id, idempotency_key) ↔ `market_checkout_batches` 로 이어짐.
- D. **상품 상세 정보 블록**(`market-material-detail.tsx` '자료 상세 정보' 아래 "구매 전 확인"): 공급자(하단 정보 상호·대표자·연락처 — DB), 파일 형식과 필요 프로그램(파일 형식 표 새 열 `required_program`, 관리자 파일 유형 설정에서 편집), 이용 기간·다운로드(DB 문구), 이용 범위 한 줄(DB 문구), 환불 고지(같은 DB 문구·같은 refundDays). 기존 고정 문구 "구매 후 바로 다운로드할 수 있으며…"(market-item-actions.tsx:1349-1351)도 DB 문구로.
- E. 관리자: '요금제' 화면이 아니라 **사이트 기본 정보와 같은 방식의 '구매 고지' 편집 카드**(문구 + refundDays 읽기 전용 표시 — 값 변경은 8번), 파일 유형 설정에 '필요 프로그램' 칸. 작업 기록.

하지 않는 것
- 환불 기간 7→30 변경과 결제 검증(8번), 결제 화면(충전) 고지(9번), 크레딧 충전 동의(이미 있음).

## 2. DB
- `system_settings` 'market_purchase_policy' 첫 값(새 키, ON CONFLICT 없이 INSERT): `{ refundDays: 7, checkboxLabel, confirmNotice, usageScopeNotice, downloadPeriodNotice, detailRefundNotice }` — 문구 자리표시 `{환불기간}` 만 허용. RESTRICTIVE FOR UPDATE 정책(세션 직접 수정 차단, 4번 선례). 관리자 저장은 서비스 키 + 작업 기록.
- `market_file_types.required_program text null`(ADD COLUMN, 첫 값: pdf→'PDF 뷰어(Adobe Acrobat Reader 등)', hwp→'한글(한컴오피스) 또는 한컴 뷰어', zip→'압축 해제 프로그램' — 데이터 UPDATE, 대표 확인).
- `market_purchase_notice_acks`: id, user_id → profiles ON DELETE CASCADE, idempotency_key uuid, notice_sha256 text CHECK hex64, notice_text text, refund_days int, created_at clock_timestamp(), UNIQUE(user_id, idempotency_key). 추가 전용 트리거(UPDATE·TRUNCATE 거부, DELETE 는 부모 profiles 가 없을 때만 — 4번 user_consents 와 같은 규칙). RLS·권한: service_role SELECT 만, 쓰기는 DEFINER 함수 `record_purchase_notice_ack(p_user_id, p_idempotency_key, p_notice_sha256)` — 함수가 지금 설정의 고지 문구를 읽어 지문을 다시 계산해 비교(다르면 `PURCHASE_NOTICE_CHANGED`), 같은 키 재요청이면 기존 행 그대로(멱등).
- 지문 규칙: `encode(sha256(convert_to(checkboxLabel 를 refundDays 로 채운 문장, 'UTF8')), 'hex')` — 화면이 보여 준 문장과 같은 값. TS 와 SQL 이 같은 채움 규칙(표 테스트).
- VERIFY·되돌리기·리허설(결제 RPC 무변경 확인 md5 포함).

## 3. 결제 안전(8번 전에 꼭 지킬 것)
- 결제 RPC·환불 RPC 는 바꾸지 않음. 회원 환불 신청 판정 코드(market-refunds.ts)는 `refundDays` 를 DB 에서 읽고, 읽지 못하면 환불 신청을 잠시 막고 "잠시 후 다시 시도"(코드 기본값으로 바꾸지 않음 — 하드코딩 금지). 관리자 승인 경로는 기간을 보지 않는 기존 동작 그대로.
- 구매 API 순서: 인증 → 약관 동의(4번) → 본문 검사 → 고지 동의 기록 → 결제 RPC. 고지 기록 실패면 결제하지 않음(fail closed). 같은 키 재시도(네트워크 유실)는 고지 기록이 이미 있어도 통과(멱등).
- 화면: 재시도(retryable) 중에는 체크를 바꿀 수 없게(기존 ack 와 같은 규칙), PRICE_CHANGED·ACK_REQUIRED·NOTICE_CHANGED 면 새 키.

## 4. 검증
- 계약 테스트: 구매 API 2개 strict 스키마·400/409·호출 순서(고지 기록이 RPC 보다 먼저), 확인창 체크 필수, 문구가 DB 값(코드 상수 없음), 환불 판정이 DB refundDays, 지문 TS=SQL 표 테스트.
- DB 리허설: 권한·추가 전용·멱등·지문 불일치 거절·삭제 연쇄·결제 RPC md5 그대로.
- 결제 검증 3명(구매 흐름·멱등·재시도, 환불 판정, DB 권한).
- 로컬 확인은 내가 먼저 브라우저로(구매 버튼은 누르지 않음 — 운영 DB), 그 뒤 대표 확인.

## 근거(사실 조사, 2026-11-23)
- 구매 API body: purchase/route.ts:11-23, cart/checkout/route.ts:11-18. RPC `checkout_market_selection(p_user_id, p_mode, p_item_id, p_lines, p_idempotency_key)` market-checkout-server.ts:109-115. 멱등 키는 `market_checkout_batches.idempotency_key`(unique(user_id, key)).
- 확인창 활성 조건 market-checkout-confirm-dialog.tsx:69, 체크 문구 코드 상수 :124-139. 상품 상세 고정 문구 market-item-actions.tsx:1349-1351.
- 다운로드: 기한·횟수 제한 없음(download/route.ts, market-items-server.ts:1487-1533). 상품 삭제·비활성이면 받을 수 없음.
- 파일 형식 `market_file_types`(code,label,extension,mime_allowlist,…) — 필요 프로그램 열 없음.
- 자료 환불 7일: market-refunds.ts:348-363 한 곳, DB 승인 함수는 기간을 보지 않음.
