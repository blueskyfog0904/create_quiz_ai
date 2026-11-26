# 16번 묶음 계획 · 회원 알림 문구 관리 + 공지 알림 보내기

작성일: 2026-11-26
판: 4 (검증 PASS, 2026-11-26) — PASS 뒤 minor 를 같은 판에서 반영함(20절)
- 1판은 세 관점 모두 FAIL(major 7), 2판은 경로·DB PASS, 법률 FAIL(major 1 — 충전 환불 거절 사유의 보관), 3판은 법률·환불 FAIL(major 3 — `payment_admin_actions` 제약, 가림 범위, 새 서명과 옛 서명의 겹침). 반영은 17~19절 표에 있고, 고친 문단 끝에 `(2판)`~`(4판)` 을 붙였다.
- 작업 순서표 16번 '알림 문구 관리'(알림 8종 문구 수정·끄기, 공지 알림 보내기)를 만든다.
- 출처: `docs/admin-content-management-plan.md` 문제 7과 메뉴표 '회원·고객 › 알림(신설)'(수정·끄기, 추가·삭제는 막음).
- **13번과의 관계**: 13번이 문의 답변 알림 문구를 `support_page_content` 의 `answerCreatedNotification*`·`answerEditedNotification*`·`admin.notifyOnAnswerEdit` 로 옮기고 "16번이 같은 키를 이어받는다"고 적었다(13번 Q15). 이 계획은 그 값을 새 행으로 **옮겨 받고**, 옮긴 뒤 옛 키를 정리한다(5-6). 같은 문구를 두 곳에서 고치는 기간을 만들지 않는다.
- **14번과의 관계**: 공지 알림은 14번 공지 글로 이어지고, 개인정보 검사는 14번 `member_facing_text_pii_hits` 를 같이 쓴다. 그래서 14번 DB 적용 뒤에 한다.
- 알림 생성 코드가 결제·환불 경로 안에 있으므로 **결제 검증 3명**을 거친다(12절).

## 0. 대표 결정이 필요한 것(질문)
답이 오기 전에는 '기본안'으로 진행한다. 지금 운영 문구를 그대로 첫 값으로 넣는다(배포해도 회원이 받는 글은 같음).

| # | 질문 | 기본안 | 이유 |
|---|---|---|---|
| Q1 | 문구 수정·끄기는 누가? | **대표만** | 충전·환불 결과 알림이 들어 있다 |
| Q2 | 끌 수 없는 알림 | **회원에게 불리한 결과를 알리는 것**: 크레딧 회수, 마켓 환불 거절, 충전 환불 거절(Q7). 이 셋은 `{사유}` 도 뺄 수 없고, **사유 없이 보내는 길이 없다**(빈 사유 대체 문구를 두지 않음) (2판) | 환불정책 3-2 ⑦ "거절할 때는 언제나 사유를 알려 드립니다"(운영 DB 본문) |
| Q3 | 공지 알림 대상 | **가입을 마친 회원 전체**(탈퇴·관리자 계정 제외, 이용 제한·로그인 차단 회원 포함)와 **'나에게만 시험'**. 결제 회원만·고른 회원은 뒤로 | 서비스 공지는 모든 회원에게. 대상 고르기는 실수 범위가 넓다 |
| Q4 | 보내기 상한 | **전체 24시간에 1회**, 시험 24시간에 10회(DB 값). 회수한 것도 횟수에 든다 | 실수로 여러 번 보내는 것을 막는다 |
| Q5 | 무엇이 광고인가 | **보낼 수 있는 것**: 약관·정책 변경, 장애·점검, 결제·환불 절차 변경 같은 서비스 이용 안내. **보내지 않는 것**: 새 자료 출시·이벤트·할인·쿠폰·가격 안내, 그리고 그런 공지 글로 연결하는 것. 정보성 안내에 광고 내용이 섞여도 광고로 본다. 보낼 때 이 경계 문장에 확인하고, 확인한 문장의 판이 기록에 남는다 (2판) | 처리방침 1절이 '새 자료·이벤트 등'을 광고성 정보로 정했다(정보통신망법 50조, 수신 동의 필요). 마케팅 발송은 4번 후속 과제로 따로 |
| Q6 | 잘못 보냈을 때 | **[회수]**: 모든 회원의 알림 목록에서 지운다(읽은 수 기록). 개인정보가 들어갔으면 기록 표의 글도 가린다. 고치기는 없다 (2판) | 고친 글을 다시 보내면 두 번 간다 |
| Q7 | 충전 환불 거절 알림을 새로 넣을까? | **넣는다.** 거절할 때 **'회원에게 보낼 거절 사유'(필수, 회원에게 그대로 안내됨) 칸을 내부 처리 메모와 따로** 둔다. 이 사유는 `refund_requests` 의 새 칸에 거절과 같은 거래로 저장되어 탈퇴 뒤에도 환불 처리 내역과 함께 남는다. 이 때문에 결제 DB 함수를 고친다(5-8) (2판·3판) | 지금은 거절해도 알림이 없다. 기존 메모 칸은 '처리 메모'(결제사 미취소 확인 등)라 회원에게 보내면 안 된다(`refunds-client.tsx:747-751`) |
| Q8 | '8종'은 지금 몇 종? | **11종 + Q7 1종, 보내는 곳 12곳**(1-2) (2판) | 뒤에 회수·예외 환불·답변 수정이 생겼고, 대사(cron) 경로가 따로 보낸다 |

## 1. 지금 상태(코드·운영 DB 읽기 전용 확인, 2026-11-26)
### 1-1. 알림 표
- `notifications`: `id`, `user_id`(profiles CASCADE), `type`(CHECK 없음), `title`, `message`, `link`, `is_read`, `created_at`. 인덱스는 PK 뿐.
- RLS: 본인 SELECT·UPDATE. 권한: authenticated 는 SELECT 와 `is_read` 칸 UPDATE 만, 쓰기는 service_role.
- 트리거 `guard_withdrawn_member_notification`(10번): 탈퇴 회원에게 가는 INSERT 를 버린다.
- 벨(`src/components/ui/notification-bell.tsx`)은 60초마다 `GET /api/notifications` 를 부르고, 열면 모두 읽음 처리(운영 쓰기)한다. 전체 목록 `/mypage/notifications`.
- 운영 데이터: 지급 15, 답변 7, 충전 완료 5, 회수 3, 마켓 환불 승인 2, 원 결제수단 환불 1, 옛 글 3(2026-02), 관리자 경보 27. 회원 19명(관리자 5, 대표 4), 탈퇴 0. `profiles.signup_completed` 있음.
- **`system_settings` 쓰기**: `system_settings_owner_update`(authenticated, `is_owner()`)가 RESTRICTIVE 정책이 없는 키를 모두 대표 세션에 연다. 중요한 키 8개만 `*_no_client_write` 로 막혀 있다. (2판)
- **새 함수 기본 권한**: 운영 `pg_default_acl` 이 새 함수에 anon·authenticated·service_role EXECUTE 를 준다. 새 표에는 service_role 전체 권한. (2판)

### 1-2. 회원에게 가는 알림(모두 코드에 글자, DB 함수는 회원 알림을 만들지 않음) (2판: 대사 경로 추가)
| 키(제안) | 이름 | 보내는 곳 | 지금 제목 / 내용 | 링크 |
|---|---|---|---|---|
| `chargeCompleted` | 충전 완료 | 웹훅 `src/lib/payapp-webhook-server.ts:155`, 관리자 결제 확인 `src/app/api/admin/payments/review/route.ts:82`, **대사 재시도 `src/lib/payment-reconciliation-server.ts:585-593`** | 크레딧 충전 완료 / 결제가 확인되어 크레딧이 충전되었습니다. | `/mypage/credits` |
| `chargeRefundCompleted` | 충전 환불 완료(원 결제수단) | `src/app/api/admin/refunds/route.ts:107` | 원 결제수단 환불이 완료되었습니다 / `{금액}`원 결제 취소가 완료되었습니다. 환불 반영 시점은 결제수단에 따라 다를 수 있습니다. | `/mypage/payments` |
| `chargeRefundBankTransfer` | 충전 환불 완료(계좌) | 같은 파일 | 환불이 완료되었습니다 / `{금액}`원을 계좌로 환불했습니다. | `/mypage/payments` |
| `chargeRefundProviderFinalized` | 결제사 취소 확인 환불 | 웹훅 `:277`, **대사 `payment-reconciliation-server.ts:151-162`·`:545-551`(웹훅 `cancellationFollowUps` 재사용)** | 환불 완료 / 결제 취소가 확인되어 환불이 완료되었습니다. | `/mypage/payments` |
| `supportAnswerCreated` | 문의 답변 | `src/app/api/admin/support/tickets/[id]/route.ts:73`(13번 뒤 DB 키) | 문의하신 내용에 답변이 등록되었습니다. / 제목: `{문의제목}`↵↵답변을 확인해보세요. | `/mypage/support` |
| `supportAnswerEdited` | 문의 답변 수정 | 13번 신설 | 13번 10-1 초안 | `/mypage/support` |
| `creditGranted` | 크레딧 지급 | `src/app/api/admin/users/credits/route.ts:109`(분류 이름 4개는 85행) | 크레딧이 지급되었습니다 / `{분류}` 사유로 `{수량}` 크레딧이 지급되었습니다. (내용: `{내용}`) | `/mypage/credits` |
| `creditRevoked` | 크레딧 회수 | `src/app/api/admin/users/credits/revoke/route.ts:78` | 크레딧이 회수되었습니다 / 잘못 지급된 크레딧 `{수량}`개가 회수되었습니다. (사유: `{사유}`) | `/mypage/credits` |
| `marketRefundApproved` | 마켓 환불 승인 | `src/app/api/admin/market/refunds/[id]/route.ts:65` | 문제마켓 환불이 승인되었습니다 / `buildMarketRefundApprovedMessage`(`src/lib/market-refund-rules.ts:75`) 문장 4개 조립 | `/mypage/credits` |
| `marketRefundException` | 마켓 예외 환불 | `src/app/api/admin/market/orders/[id]/exception-refund/route.ts:95` | 문제마켓 환불이 처리되었습니다 / 위와 같은 조립 | `/mypage/credits` |
| `marketRefundRejected` | 마켓 환불 거절 | `market/refunds/[id]/route.ts:65` | 문제마켓 환불 요청이 거절되었습니다 / 환불 요청이 승인되지 않았습니다. 사유: `{사유}`(사유는 화면에서 필수 '회원에게 안내됩니다', `market-refunds-client.tsx:373`) | `/mypage/support` |
| (Q7) `chargeRefundRejected` | 충전 환불 거절 | 없음 → `admin/refunds/route.ts` `reject` 분기(202행)에 새로 | 11절 초안 | `/mypage/payments` |
- 보내는 곳은 12곳이다(웹훅 2, 관리자 결제 확인, 대사 2, 충전 환불 route, 답변 2, 지급, 회수, 마켓 환불 route, 예외 환불).
- **중복 알림 규칙(지금 코드)**: '상태를 바꾼 경로만 알린다'. 관리자 환불은 `alreadyCompleted` 면 알림 없이 끝나고(`admin/refunds/route.ts:234`), 대사는 `!already_completed` 일 때만(152행), 웹훅은 `result === 'refund_finalized'` 일 때만(277행) 보낸다. 이 묶음은 이 판단을 바꾸지 않는다(1판 16절 1 닫음). (2판)
- **실패를 화면에 알리는 칸(지금)**: 답변 `notificationFailed`(`support-client.tsx:253`), 회수 `notified`(`revoke-credit-button.tsx:74`), 마켓 환불·예외 환불·지급·결제 확인·충전 환불은 알리지 않는다. (2판: 1판 서술 고침)
- **충전 환불 거절**: DB `reject_point_charge_refund(uuid,uuid,text,boolean)` 는 상태를 `rejected` 로, 메모를 `admin_note` 에 쓰고, **`manual_review` 일 때만** `payment_admin_actions`(action `manual_review_refund_rejected`)를 남긴다. 보통 거절(`pending_review`)은 처리 기록이 없고 route 에도 작업 기록이 없다. 가림 함수 `redact_member_text` 는 `refund_request` 의 `reason`·`admin_note` 만 다룬다. 탈퇴 익명화(`anonymize_member`)는 회원의 `notifications` 를 지운다(운영 함수 본문 확인). (3판) `payment_admin_actions` 는 `action` CHECK(7개 값, `refund_rejected` 없음), `note` NOT NULL·비지 않음 CHECK, `actor_id` NOT NULL 이고 수정·삭제 금지 트리거가 있다. 표시 이름은 `src/lib/admin-orders.ts:44-52` `PAYMENT_ADMIN_ACTION_LABELS`. 지금 거절 함수는 4번째 인자에 `DEFAULT false` 가 있고 `pending_review` 에서는 `p_admin_id` NULL 도 받으며, EXECUTE 는 service_role 만이다. 탈퇴 가림 판정 `member_withdrawal_facts` 는 `refund_requests` 의 `reason`·`admin_note` 에 긴 숫자가 있을 때만 가림 필요로 내고, 화면 칸 목록(`member-withdrawal-panel.tsx:79`)과 가림 요청의 허용 칸(`src/app/api/admin/users/[id]/withdrawal/route.ts:72` 의 `field` zod enum)도 그 둘뿐이다. (4판, PASS 뒤 위치 고침) 함수는 `void` 를 돌려주고, `rejectPointChargeRefund`(`src/lib/point-charge-refunds-server.ts:287-299`)도 반환값이 없다. 재요청은 `REFUND_REQUEST_NOT_REJECTABLE` 예외다. 화면 메모 칸은 '관리자 메모(선택)'/'처리 메모(필수)'(수동 확인 건의 결제사 미취소 확인용). (2판)
- 관리자 경보 4종(DB 함수, 대상 `is_admin`)은 같은 표를 쓰지만 이 묶음 범위가 아니다.

### 1-3. 관련 묶음
- **13번**: 답변 route 를 새로 쓰고 문구를 `support_page_content` 로 옮긴다. 필수 키 `SUPPORT_PAGE_REQUIRED_KEYS` 가 비거나 없으면 고객지원 화면이 오류다(13번 계획 540-543행). 공용 `adminRequestMeta` 를 만든다(계획 단계).
- **12번**: 이용 제한 회원에게 알림 GET·PATCH 는 '열기'. 정지 안내는 알림 표를 쓰지 않는다.
- **14번**: `site_board_posts`, `member_facing_text_pii_hits(text)`.
- 작업 기록 `record_admin_audit(…)`(지문 `a42b474d…`), 시험 `admin-audit-log-contract`(`DB_FUNCTION_ACTIONS`), `admin-guard-coverage-contract`, `admin-notifications-cleanup-contract`(웹훅 파일의 INSERT 1개 단언), `admin-notifications-service-role-contract`, `member-notification-contract`.
- 마이그레이션: 운영 마지막 `20261216100000`, 12·13·14번이 뒤에 더한다.

## 2. 목표
1. 1-2 의 모든 회원 알림이 **한 공용 함수**를 거치고, 제목·내용을 DB 행 하나에서 읽는다. 첫 배포 때 회원이 받는 글은 지금과 같다.
2. 대표가 '알림' 화면에서 문구를 고치고 켜고 끈다. 종류 추가·삭제, 끌 수 없는 종류 끄기, 필수 자리표시 빼기는 화면·DB 함수·쓰기 막기 정책·읽을 때 검사 네 곳에서 막힌다. (2판)
3. 문구를 못 읽거나 깨져도 **결제·환불·지급 결과와 재시도 판단은 그대로** 이고 알림만 빠진다. 관리자 화면 경로는 모두 같은 칸으로 실패를 알린다. (2판)
4. 공지 알림은 대표만 **미리보기 → 경계 확인 → 보내기** 로 보낸다. 24시간 상한, 같은 요청 두 번(동시 포함)은 한 번, 개인정보 거절, 인원이 미리보기와 다르면 거절, 보내기·회수가 같은 거래에서 기록된다. (2판)
5. 잘못 보낸 공지 알림을 회수하고, 개인정보가 들어갔으면 기록 표의 글도 가린다.
6. 13번 키가 옮겨진 뒤 같은 문구가 두 벌 남지 않고, 되돌릴 때도 고객지원 화면이 끊기지 않는다. (2판)

## 3. 범위
**넣는 것**: DB(설정 행 1 + 쓰기 막기 정책 1, 표 1, `notifications` 칸 1, 함수 5, **충전 환불 거절: `refund_requests` 칸 1·거절 함수 새 서명·가림 함수 재정의**(5-8)), (3판) 공용 보내기 함수와 12곳 교체, 충전 환불 거절 알림과 거절 사유 칸(`refunds-client.tsx` 포함), 관리자 '알림' 화면, 14번 편집 창 [이 공지로 알림 보내기], 벨·목록의 '공지' 머리표, 13번 키 정리·되살리기 스크립트, 시험. (2판)
**넣지 않는 것**: 관리자 경보 문구, 이메일·푸시, 마케팅 발송, 대상 고르기, 예약 보내기, 알림 보관 기간 정리.

## 4. 원칙
- **코드에는 규칙, DB 에는 글.** 종류·허용/필수 자리표시·끌 수 없는 종류·링크·type 은 코드(`src/lib/member-notifications.ts`), 글·켜기·분류 이름·상한 숫자는 DB.
- **알림은 부가 동작이다.** 돈이 움직인 뒤에 보내고, 실패가 응답·재시도 판단을 바꾸지 않는다. 문구가 없으면 코드 기본 문구로 대신 보내지 않는다(하드코딩 금지).
- **끌 수 없는 종류는 여러 겹으로 지킨다**: 쓰기 막기 정책(대표 세션 직접 수정 차단) → 저장 함수 → 읽을 때 검사(`enabled: false` 무시, 필수 자리표시가 빠졌으면 보내지 않고 관리자 화면에 실패로 알림). (2판)
- **상태를 바꾼 경로만 알린다**(1-2). 재요청·이미 끝난 건은 알림 0번.
- **지울 수 없는 작업 기록에는 지문만**, 글은 가릴 수 있는 기록 표에(14번과 같은 원칙). (2판) **예외 하나**: 알림 문구 수정 기록(`member_notification_texts_update`)은 회사가 쓰는 공개 문구(회원 정보가 아님, 개인정보 검사 통과)라 원문 before·after 를 남긴다. 광고 경계 문장의 판별 원문을 증명해야 하기 때문이다. 법률 관점에서 확인받는다(12절). (3판)
- **운영 DB 한 개**: localhost 에서 보내기·저장·회수·벨 열기를 하지 않는다.

## 5. DB 변경(마이그레이션 `20261218100000_bundle16_member_notifications.sql`, 가안)
버전은 가안이고 14번 뒤 실제 순서에 맞춰 정한다. `notifications` 칸 추가와 `system_settings` RESTRICTIVE 정책이 각 표를 잠깐 ACCESS EXCLUSIVE 로 잠근다(벨·모든 화면이 읽음). 그래서 **새벽에** `SET LOCAL lock_timeout = '3s'`, `statement_timeout = '60s'` 로 한 거래에 적용한다(15번 4-4 와 같은 규칙). (2판) `refund_requests` 칸 추가와 `payment_admin_actions` CHECK 다시 만들기(5-8)도 같은 거래에서 잠깐 잠근다(둘 다 ACCESS EXCLUSIVE, 같은 `lock_timeout`). (3판·4판)

### 5-1. 사전 점검(다르면 멈춤)
- 13번 M1: `support_page_content` 의 5개 키가 있다. 14번: `member_facing_text_pii_hits(text)`, `site_board_posts`. `record_admin_audit` 지문 `a42b474d…`.
- `notifications.broadcast_id` 가 없다. **기록 표 `member_notification_broadcasts` 가 이미 있으면**(되돌린 뒤 다시 적용) 만들기를 건너뛰고 칸·가드·권한이 기대와 같은지 대조한다. (2판)
- **다시 적용 때 남은 것 처리**(3판)
  - 5-8 의 남은 것(PASS 뒤): `member_reject_reason` 칸·칸 CHECK 는 없을 때만 만들고 있으면 정의를 대조한다. `member_withdrawal_facts`·`redact_member_text` 사전 지문은 '13번 뒤 판' **또는** '16번 확장 판' 둘 중 하나면 통과한다. action CHECK 는 DROP/ADD 를 그대로 해도 같은 결과다.
  - 기록 표의 `post_id` FK 를 다시 붙인다. 지워진 글을 가리키는 값이 있으면(14번을 되돌렸다 다시 적용한 경우) `NOT VALID` 로 붙이고 그 건수를 확인 조회에 보인다(기록 표는 가드로 고칠 수 없음).
  - 쓰기 막기 정책은 down 이 남기므로 `pg_policies` 에 없을 때만 만든다(15번 방식).
  - 설정 행이 있으면 복사를 건너뛰되, 저장 함수와 같은 구조 검사(종류 키 집합, 끌 수 없는 종류 `enabled`·`{사유}`)를 돌리고, 답변 두 종류를 지금 `support_page_content` 값과 대조한다. 키가 있고 값이 다르면 멈추고 대표가 어느 글을 쓸지 정한다(5-6 과 같은 규칙). 같거나 키가 없으면 통과한다.

### 5-2. 설정 행 `member_notification_texts`와 쓰기 막기
```
{ "revision": 1,
  "kinds": {
    "chargeCompleted": { "enabled": true, "title": "…", "message": "…" }, … 1-2 의 종류마다 …,
    "creditGranted": { …, "categoryLabels": { "compensation": "보상", "event": "이벤트", "refund": "환불", "other": "기타" } },
    "marketRefundApproved": { "enabled": true, "title": "…" }, "marketRefundException": { "enabled": true, "title": "…" },
    "marketRefundRejected": { "enabled": true, "title": "…", "message": "…{사유}" },
    "chargeRefundRejected": { "enabled": true, "title": "…", "message": "…{사유}" } },
  "marketRefundMessage": { "base": "{수량} 크레딧이 돌아왔습니다.", "reissued": "…", "missing": "…", "unknown": "…" },
  "broadcast": { "memberLabel": "공지", "allMembersDailyLimit": 1, "selfTestDailyLimit": 10,
                 "notAdvertisingStatement": "…", "notAdvertisingStatementVersion": 1, "redactedText": "…" } }
```
- 첫 값은 1-2 의 운영 글 그대로. 마켓 거절의 옛 빈 사유 대체 문구("고객지원으로 문의해 주세요.")는 넣지 않는다 — 화면이 사유를 필수로 받으므로 쓰일 일이 없고, Q2 대로 사유 없는 길을 없앤다. (2판)
- 답변 두 종류는 **적용 순간의 `support_page_content` 값을 복사**하고 VERIFY 가 같은지 본다. 대응(3판): `member.answerCreatedNotificationTitle/Message` ↔ `supportAnswerCreated.title/message`, `member.answerEditedNotificationTitle/Message` ↔ `supportAnswerEdited.title/message`, `admin.notifyOnAnswerEdit` ↔ `supportAnswerEdited.enabled`. 복사·정리·되살리기가 모두 이 표를 쓴다.
- **RESTRICTIVE 정책** `system_settings_member_notification_texts_no_client_write`(UPDATE, `key <> 'member_notification_texts'`)를 같은 거래에서 만든다. 충전·환불 결과와 환불정책 약속을 담은 결제·법적 문구이기 때문이다(13번이 정책을 생략한 근거 '결제·법적 문구가 아님'이 여기서는 성립하지 않음). 정책 존재 검사는 이름 붙인 별도 VERIFY 블록에 둔다(15번 방식). (2판)

### 5-3. 표 `member_notification_broadcasts`와 `notifications.broadcast_id`
- 칸: `id`, `operation_key UNIQUE`, `actor_id uuid`(FK 없음), `target`(`all_members`·`self`), `title`(1~60, 한 줄), `message`(1~500), `link_url`, `post_id uuid NULL REFERENCES site_board_posts`, `content_sha256`, `recipient_count`, `not_advertising_statement_version`, `not_advertising_statement_text`(보낼 때 확인한 판의 문장 원문 — 회사 공개 문구, 가드로 고칠 수 없음. 작업 기록이 2년 뒤 정리돼도 경계 증빙이 기록 표에 남음), `created_at clock_timestamp()`, `retracted_at`·`retracted_by`·`retract_reason_code`·`retracted_deleted_count`·`retracted_read_count`, `redacted_at`·`redacted_by`
- **회원을 가리키는 칸이 없다**(인원 수·공개 문구·관리자 id 만). 그래서 기한 없이 보관해도 처리방침과 어긋나지 않는다. (2판)
- 가드 트리거: UPDATE 는 `retracted_*`·`redacted_*` NULL→값과, 가림 때 `title`·`message` → `redactedText` 만. DELETE·TRUNCATE 거부. 링크는 고정 꼴(5-4)이라 가리지 않는다. (PASS 뒤)
- 권한: RLS 켬, 정책 없음, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 뒤 service_role SELECT 만. (2판)
- `ALTER TABLE notifications ADD COLUMN broadcast_id uuid NULL REFERENCES member_notification_broadcasts(id)` + 부분 인덱스. authenticated 에는 이 칸 UPDATE 권한을 주지 않는다.

### 5-4. 함수(5개) (2판)
공통: `SET search_path = public, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, service_role 만 EXECUTE. 쓰기 함수 마지막 인자 `p_request_meta jsonb`(객체 아니면 거절, details `request`).
- **`member_broadcast_recipients(p_target, p_actor_id)`** → SETOF uuid: **SECURITY INVOKER**(보내기·미리보기 함수 안에서만 쓰임, 회원 id 목록이라 anon·authenticated EXECUTE 를 반드시 회수). `all_members` = `signup_completed AND withdrawn_at IS NULL AND NOT coalesce(is_admin,false)`, `self` = 행위자.
- **`member_broadcast_preview(p_actor_id, p_target)`**(SECURITY DEFINER, STABLE): 대표 확인, 인원·오늘 남은 횟수·다음 가능 시각.
- **`save_member_notification_texts(p_actor_id, p_expected_revision, p_value, p_request_meta)`**(SECURITY DEFINER)
  - 대표만, `FOR UPDATE`, 판 충돌, 구조 검사(종류 키 집합 같음, 끌 수 없는 종류 `enabled = true` 와 `{사유}` 포함, 길이, 상한 범위, 경계 문장 비지 않음 — 문장이 바뀌면 `notAdvertisingStatementVersion + 1`), 모든 문구 개인정보 검사.
  - 허용 자리표시 전체 검사는 서버 액션의 TS 규칙(같은 규칙을 SQL 에 두 번 쓰지 않음).
  - 바뀌면 `revision + 1`, 기록 `member_notification_texts_update`: **바뀐 모든 경로**(`kinds`·`categoryLabels`·`marketRefundMessage`·`broadcast`)의 before·after 원문, 경계 문장이 바뀌면 이전·새 판 번호와 문장 원문(4절 예외). (3판)
- **`send_member_broadcast(p_actor_id, p_operation_key, p_target, p_title, p_message, p_link_url, p_post_id, p_expected_count, p_not_advertising_version, p_request_meta)`**(SECURITY DEFINER) → `{broadcast_id, recipient_count, replayed}`
  1. 대표가 아니면 `BROADCAST_ACTOR_NOT_OWNER`. `p_not_advertising_version` 이 지금 경계 문장 판과 다르면 `BROADCAST_CONFIRM_REQUIRED`.
  2. 입력 다듬기·검사(제목·내용 길이, 링크, `p_post_id` 가 있으면 게시 중인 공지이고 링크 = `/notices/{id}`) → `BROADCAST_INPUT_INVALID`.
     - **링크 허용 꼴**(PASS 뒤 좁힘, 코드 규칙과 함수가 같은 목록): 링크 없음, `/notices`, `/notices/{게시 중인 공지 uuid}`, `/faq`, `/faq#{uuid}`, 정해진 약관 경로(`/terms`, `/terms/upcoming`, 하단 정보에 있는 문서 slug 의 `/terms/{slug}`). **쿼리·그 밖의 `#` 는 받지 않는다.** 뒷부분을 자유롭게 쓰는 꼴을 없애, 링크에 이름 같은 글이 들어갈 수 없게 한다(14번 5-3 '링크 주소의 검색어 부분에도 이름이 들어갈 수 있다'와 같은 원칙). 판매·충전 화면(홈·카테고리·상품·검색·장바구니·충전·결제)은 목록에 없으므로 거절된다(Q5).
  3. **`pg_advisory_xact_lock(hashtext('member_broadcast'))` 를 먼저 잡고**, 그 뒤 같은 `operation_key` 를 찾는다: 내용 지문·대상이 같으면 그대로(`replayed`), 다르면 `BROADCAST_IDEMPOTENCY_CONFLICT`. 동시 두 요청도 뒤쪽이 `replayed` 를 받는다. (2판)
  4. 상한: 같은 대상의 최근 24시간 보내기 수(회수 포함) ≥ DB 상한 → `BROADCAST_RATE_LIMITED`(다음 가능 시각).
  5. **받는 사람을 한 번만 뽑아**(배열) 세고, 인원 ≠ `p_expected_count` 면 `BROADCAST_COUNT_CHANGED`(지금 인원). 같은 배열로 INSERT 한다(세기와 넣기가 같은 집합). (2판)
  6. 기록 행 INSERT → `INSERT INTO notifications (…, type, broadcast_id) SELECT … FROM unnest(배열)`, `type = 'announcement'`. 넣은 수 ≠ 인원이면 예외(전체 취소 — 그 사이 탈퇴로 트리거가 버린 경우).
  7. 기록 `member_broadcast_send`: `broadcast_id`, `target`, `recipient_count`, `content_sha256`, 제목·내용 글자 수, `link_url`, `post_id`, `not_advertising_statement_version`, `request`, `saved_at`. **제목·내용 원문과 회원 id 는 넣지 않는다**(원문은 가릴 수 있는 기록 표에). (2판)
- **`retract_member_broadcast(p_actor_id, p_broadcast_id, p_reason_code, p_redact boolean, p_request_meta)`**(SECURITY DEFINER): 대표만, `FOR UPDATE`, 이미 회수면 그대로(가림만 새로 요청하면 가림). 사유는 정해진 코드만(`mistake`·`pii`·`wrong_target` 등, 자유 글 없음). 읽은 수를 센 뒤 `DELETE FROM notifications WHERE broadcast_id = …`, `retracted_*` 채움, `p_redact` 면 제목·내용을 가림 문구로. 기록 `member_broadcast_retract`(지운 수·읽은 수·사유 코드·가림 여부). (2판)

### 5-5. VERIFY·되돌리기 (2판)
- VERIFY: 종류 키 집합 = 코드 규칙, 복사 값 = 원본, 쓰기 막기 정책(별도 블록), 표·가드·권한(service_role SELECT 만), 칸·인덱스, 함수 5개의 보안 방식·EXECUTE(anon·authenticated 없음), **5-8 의 새 거절 서명 EXECUTE(service_role 만)·DEFAULT 없음, 재정의한 두 함수는 보안 방식과 `proacl` 이 적용 전과 같음(`member_withdrawal_facts` = INVOKER·postgres 만, GRANT 하지 않음 / `redact_member_text` = DEFINER·postgres·service_role), action CHECK 에 `refund_rejected`**. (4판, PASS 뒤 고침)
- **되돌리기 순서**(코드를 되돌리면 13번 코드가 옛 키를 다시 읽으므로):
  1. **키 되살리기 스크립트**(`supabase/scripts/<날짜>_bundle16_support_notification_keys_restore.sql`)를 **코드를 되돌리기 전에** 돌린다. 5개 키가 없으면 `member_notification_texts` 값으로(5-2 대응표) 넣고, 있으면 그대로 둔다(키를 더해도 16번 코드에는 영향 없음). 있는데 값이 다르면 기록에 남기고 대표에게 알린다(되돌리면 그 옛 값이 쓰이므로). 기록 `support_page_content_update`. 이 스크립트부터 코드 되돌리기까지는 '13번 안내 문구 탭 저장 금지'를 대표에게 알린다(16번 코드의 탭은 5개 키 없이 저장한다). (3판) 같은 스크립트가 **옛 4인자 거절 함수**가 없으면(5-6 정리 뒤) 적용 전 정의(지문 대조)로 다시 만든다. 되돌린 코드가 그 함수를 부르기 때문이다. (3판) 다시 만든 뒤 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, `GRANT … TO service_role` 을 하고 스크립트 끝에서 `proacl` 이 운영 값(`postgres`·`service_role` 만)과 같은지 본다(새 함수 기본 권한이 anon 에게 열려 있어서). (4판)
  2. 코드 되돌리기(16번 커밋만 revert).
  3. down(`supabase/rollback/20261218100000_bundle16_member_notifications_down.sql`, 새벽): **첫머리에서 옛 4인자 `reject_point_charge_refund(uuid,uuid,text,boolean)` 가 있고 `proacl` 이 postgres·service_role 인지 확인하고, 아니면 멈춘다**(1단계 되살리기를 먼저 — 거절 함수가 하나도 없게 되는 것을 막음). (PASS 뒤) 그 뒤 함수 5개 → `notifications.broadcast_id` 칸 → 기록 표의 `post_id` FK 제약(값은 남김) → 5-8 의 새 거절 함수 서명 삭제. 가림 함수·`member_withdrawal_facts` 의 확장은 **되돌리지 않는다**(아래 4). (4판)
  4. 기록 표·가드, 설정 행과 **그 쓰기 막기 정책**, `refund_requests.member_reject_reason` 칸, 넓힌 `payment_admin_actions` action CHECK(지울 수 없는 `refund_rejected` 행이 남으므로 옛 목록으로 되돌리면 실패), 가림 함수·`member_withdrawal_facts` 의 새 칸 확장(칸과 값이 남는 동안 가릴 수 있어야 하므로)은 **남긴다**(증빙, 대표 문구 유지 — 행이 남는 동안 대표 세션 쓰기에 열리지 않게 정책도 짝으로 둠, 15번 4-5 원칙). 확장은 허용 칸이 하나 느는 것뿐이라 옛 코드와 충돌하지 않는다. (4판) 다시 적용은 5-1 의 '이미 있음' 경로. (3판)
  - **14번과의 순서**(3판): 14번 down 은 '`member_facing_text_pii_hits` 를 부르는 16번 함수(이름으로 검사: 보내기·문구 저장·회수·미리보기, 5인자 거절 서명)가 있거나, `site_board_posts` 를 가리키는 FK 가운데 14번 판 이력 표가 아닌 것이 있으면 멈춤'이고 기록 표 존재로는 멈추지 않는다(14번 5-7, 4판). 그래서 16 down → 14 down 이 통과하고, 14·16 다시 적용 때 `post_id` FK 는 5-1 대로 붙는다.

### 5-6. 13번 키 정리 스크립트(`supabase/scripts/<날짜>_bundle16_support_notification_keys_cleanup.sql`)
- 옛 4인자 거절 함수 DROP 도 이 스크립트가 한다. DROP 앞에서 새 5인자 함수의 `proacl` 이 service_role 만인지 확인한다. (4판)
- 새 코드가 배포되고 답변 알림이 새 행에서 읽히는 것을 확인한 뒤 돈다. `support_page_content` 를 `FOR UPDATE` 로 잠근다.
- 키마다: **이미 없음** → 정리된 것으로 보고 넘어감 / **복사 값과 같음** → 지움 / **다름**(DB 적용~배포 사이 13번 화면에서 고침) → 멈추고 대표가 어느 글을 쓸지 정한다. 지운 것이 있으면 `revision + 1`, 기록 `support_page_content_update`(bundle `bundle16_support_keys_cleanup`). (2판)
- DB 적용~배포 사이에는 대표에게 '고객지원 안내 문구의 답변 알림 칸을 고치지 말 것'을 알린다.

### 5-7. 리허설(운영 DB, postgres, 새벽, `BEGIN … ROLLBACK`, 반복 가능)
15번 11-2 원칙(경우 격리·표지 예외, 임시 표 + 마지막 SELECT, 마지막 줄 ROLLBACK, 생성기 사본, 표 잠금 문장은 짧은 거래에만, `lock_timeout`)을 따른다.

| 경우 | 기대 결과 |
|---|---|
| R1 적용 | VERIFY 통과, 복사 = 13번 값, 잠금이 3초 안 |
| R2 문구 저장 | 대표 성공·기록(바뀐 경로 전부, 경계 문장 판·원문 (3판)), 직원·회원 거절, 판 충돌, 종류 추가·삭제·끌 수 없는 종류 끄기·`{사유}` 빼기 거절, 개인정보 거절, 바뀐 것 없음 기록 0, **대표 세션(authenticated) 직접 UPDATE 거절** (2판) |
| R3 보내기 | 대표 성공(인원·`broadcast_id`·type·기록에 원문·회원 id 없음, 기록 행 경계 문장 = 그 판의 문장), 허용 꼴 밖(`/faq#글자`·쿼리 붙은 링크·`/terms/아무거나`) 거절 (PASS 뒤), 직원 거절, 경계 판 다름 거절, 같은 거래 안 순차 재요청 `replayed`·알림 추가 0(동시 두 요청은 `BEGIN…ROLLBACK` 로 재현할 수 없어 10-1 이 '잠금 → 재요청 → 상한' 순서를 단언 (3판)), 같은 키 다른 내용 거절, 허용 밖 링크(상품·충전·장바구니) 거절 (3판), 상한(전체 2번째·시험 11번째·회수 뒤), 인원 바뀜, 링크·공지 id 불일치·숨긴 공지, 개인정보 (2판) |
| R4 받는 사람 | 탈퇴·가입 미완료·관리자 빠짐, 이용 제한·로그인 차단 포함(12번 적용 뒤) |
| R5 회수·가림 | 지운 수·읽은 수, 두 번째 회수 그대로, 가림 뒤 글 = 가림 문구, 기록 표 DELETE·다른 UPDATE 거절 |
| R6 권한 | anon·authenticated 로 함수 5개와 새 거절 서명 호출 거절(특히 `member_broadcast_recipients`), 재정의한 두 함수의 보안 방식·`proacl` = 적용 전 (4판·PASS 뒤), 기록 표 SELECT 거절, 본인 알림 `broadcast_id` UPDATE 거절·`is_read` 는 됨, service_role 로 기록 표 INSERT 거절 (2판) |
| R7 되돌리기 | 옛 4인자 함수 없음 → down 멈춤, 다시 적용 때 5-8 남은 것(칸·CHECK·16번 확장 판 지문) 통과 (PASS 뒤), 되돌린 뒤에도 새 칸 가림 가능·넓힌 CHECK 남음, 되살리기로 다시 만든 옛 함수의 권한 = service_role 만 (4판). 키 되살리기(없음·있음 같음·있음 다름) → down → 남은 것(기록 표·설정 행·정책·칸) 확인 → **16 down → 14 down → 14 재적용 → 16 재적용**(`post_id` FK `NOT VALID`, 정책 하나, 설정 행 구조 검사·답변 키 대조, 다르면 멈춤) (3판) |
| R8 정리 | 같음 → 지움·기록, 다름 → 멈춤, 이미 없음 → 넘어감 |
| R9 충전 환불 거절(5-8) (3판·4판) | 보통 거절(처리 메모 없음 포함)·수동 확인 거절 모두 성공, `member_reject_reason` 저장·`admin_note` 는 내부 메모 그대로, 처리 기록 1행(보통 거절 `note` = 고정 표지, 회원 사유·메모 글자 없음 / 수동 확인 `note` = 메모, details 기존 키 + `member_reason_length`), action CHECK 가 `refund_rejected` 허용, `user_id` 반환. `p_admin_id` NULL·빈 사유·개인정보 사유·긴 숫자 사유 → 거절 전체 취소(크레딧 동결 그대로, 알림 0) (PASS 뒤), 재요청 `REFUND_REQUEST_NOT_REJECTABLE`. **같은 거래에서 옛 4인자 이름 호출(옛 코드 모양)이 그대로 성공하고 처리 기록 동작도 옛 그대로**(겹침 없음). 회원용 사유에만 긴 숫자 → `member_withdrawal_facts` 가림 필요에 나옴 → 가림 → 빠지고 익명화 통과. 탈퇴 익명화 뒤에도 칸이 남음 |

### 5-8. 충전 환불 거절 사유 저장(결제 DB 변경) (3판·4판)
- **칸**: `refund_requests.member_reject_reason text NULL`, 표 CHECK 는 '비지 않음'만 둔다(1~300자는 함수 검사 — 가림 문구로 바꿀 때 길이 CHECK 에 걸리지 않게). 내부 `admin_note` 와 분리한다. 탈퇴 익명화가 지우지 않는 표라 01-11 시행 처리방침의 '환불·취소 처리 내역' 보존과 함께 남고, 환불정책 3-2 ⑦의 증빙이 된다. (4판)
- **거절 함수 새 서명** `reject_point_charge_refund(p_request_id, p_admin_id, p_admin_note, p_provider_not_cancelled_confirmed, p_member_reason)` → jsonb `{user_id}`
  - SECURITY DEFINER, search_path 고정, 만든 뒤 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, `GRANT … TO service_role`. (4판)
  - **어떤 인자에도 DEFAULT 를 두지 않는다.** 그래야 옛 코드의 이름 붙은 4인자 호출은 옛 함수 하나에만, 새 코드의 5인자 호출은 새 함수 하나에만 맞는다(DEFAULT 를 옮기면 두 함수가 모두 맞아 PGRST203 으로 DB 적용~배포 사이 거절이 막힘). (4판)
  - `p_admin_id` 는 NULL 이면 `REFUND_REJECT_ACTOR_REQUIRED`(새 route 는 늘 관리자 id 를 넘김, 처리 기록 `actor_id` NOT NULL). (4판)
  - 지금 함수의 검사·상태 변경을 그대로 하고, `p_member_reason` 을 다듬어 비었거나 300자 초과면 `REFUND_REJECT_MEMBER_REASON_REQUIRED`, `member_facing_text_pii_hits` 가 있으면 `REFUND_REJECT_MEMBER_REASON_PII` 로 거절 전체를 취소한다. 같은 거래에서 `member_reject_reason` 을 채운다.
  - **모든 거절에 `payment_admin_actions` 1행**(4판)
    - 수동 확인 건: 지금 그대로(action `manual_review_refund_rejected`, `note` = 필수 처리 메모, details 기존 키 `provider_not_cancelled_confirmed`·`last_error_code`) + details `member_reason_length`.
    - 보통 거절: action `refund_rejected`, `note` = **고정 표지**(함수 안 상수 `'refund_rejected'` — 규칙 값이고 회원·관리자 글이 아님), details `member_reason_length`·`admin_note_present`. 회원 사유와 내부 메모 글자는 넣지 않는다(이 표는 고칠 수 없음). 내부 메모 원문은 가릴 수 있는 `refund_requests.admin_note` 에만 있다.
    - 이를 위해 같은 거래에서 `payment_admin_actions_action_check` 를 DROP 하고 기존 7개 값 + `refund_rejected` 로 다시 ADD 한다(5절 새벽 잠금).
  - 받는 회원 id 를 돌려준다(route 가 따로 읽지 않음).
  - 옛 4인자 함수는 DB 적용~배포 사이 옛 코드가 부르므로 두고, 배포 뒤 5-6 이 지운다. 계약 시험이 새 코드가 4인자를 부르지 않음을 본다.
- **탈퇴 가림이 새 칸을 다루게**(4판): 13번이 같은 종류의 추가에서 facts·redact 를 함께 고친 방식(13번 4-4)을 따른다. 사전 점검에서 13번 뒤 판의 지문을 대조한다(다시 적용 때는 16번 확장 판도 받음, 5-1).
  - `redact_member_text`: `refund_request` 허용 칸에 `member_reject_reason`.
  - `member_withdrawal_facts`: `refund_requests` 분기의 긴 숫자 판정과 미리보기에 `member_reject_reason`. 개인정보 검사(모양)는 계좌번호 같은 긴 숫자를 잡지 않으므로, 그런 사유는 탈퇴 때 '가림 필요'로 나와 익명화 전에 가려진다.
  - 화면 `src/app/(admin)/admin/users/[id]/member-withdrawal-panel.tsx:79` 칸 목록(`TARGET_FIELDS.refund_request`)에 '회원에게 보낸 거절 사유', 가림 요청 route `src/app/api/admin/users/[id]/withdrawal/route.ts:72` 의 `field` enum 에 `member_reject_reason`(PASS 뒤 위치 고침) — 허용 칸에 같은 칸.
  - **회원용 사유에 긴 숫자(`member_text_has_long_number`)가 있으면 거절한다**: route 400, 새 거절 함수 `REFUND_REJECT_MEMBER_REASON_LONG_NUMBER` 로 거절 전체 취소. 창 안내는 '계좌번호·카드번호 같은 숫자는 적지 마세요'. 알림 표는 가림 대상이 아니어서 들어가면 탈퇴 때까지 남기 때문이다(01-11 처리방침의 환불 계좌 파기 약속). 탈퇴 가림 확장은 혹시 남은 행에 대비해 그대로 둔다. (PASS 뒤)
- **표시 이름**: `PAYMENT_ADMIN_ACTION_LABELS` 에 `refund_rejected`('충전 환불 거절'), 시험 `tests/admin-orders-contract.test.mjs` 목록 갱신. (4판)
- 결제 DB·탈퇴 함수 변경이므로 12절 결제 검증 범위다.
- (열린 질문) 수동 확인 거절의 `note` 에는 지금처럼 처리 메모 원문이 들어가 가림 밖에 남는다. 이번에 바꾸지 않는다(16절 3).

## 6. 코드 변경
- **선행**: 13번 답변 route·고객지원 탭 배포, 13번 공용 `adminRequestMeta` 커밋, 14번 DB 적용. (2판)
- **규칙 `src/lib/member-notifications.ts`**(순수): 종류 표(키, 이름, 설명, type, 링크, 허용·필수 자리표시, 끌 수 있는지), `renderMemberNotification(kind, texts, values)` — 허용 밖·필수 빠짐이면 null, 값 속 `{…}` 안 풀림, 제목 줄바꿈 거부, 끌 수 없는 종류는 `enabled` 무시. `buildMarketRefundMessage(request, texts)` 는 옛 조립 규칙 그대로, 문장만 DB.
- **보내기 `src/lib/member-notifications-server.ts`**(server-only): `sendMemberNotification({ kind, userId, values })` → `{ sent: true } | { sent: false, reason: 'disabled' | 'texts_unavailable' | 'render_failed' | 'insert_failed' }`. 예외를 던지지 않는다. 문구는 `unstable_cache` 60초 + 태그(실패는 캐시 안 함). **회원 알림 INSERT 는 이 파일에서만.**
- **12곳 교체**: route·웹훅·대사가 글 대신 `kind`·값만 넘긴다. 웹훅·대사의 `userNotification` 은 `{ kind, userId }` 를 담고 `runFollowUps` 가 공용 함수를 부른다. 성공·재요청 판단(`alreadyGranted`·`alreadyRevoked`·`already_completed`·`replayed`·대사의 `already_fulfilled`)은 그대로.
- **관리자 화면 실패 알림 칸**(2판): 응답 칸은 `notificationFailed`(true 면 '회원 알림을 보내지 못했습니다. 고객지원으로 직접 알려 주세요.') 하나로 맞춘다. `disabled` 는 실패가 아니다.
  | 경로 | 읽는 화면 파일 |
  |---|---|
  | 답변(13번) | `support-client.tsx`(지금도 읽음) |
  | 지급 | `grant-credit-dialog.tsx` |
  | 회수 | `revoke-credit-button.tsx`(지금 `notified` → `notificationFailed` 로 바꾸고 버튼 쪽도 같이) |
  | 마켓 환불·예외 환불 | `market-refunds-client.tsx`, 예외 환불 창 |
  | 결제 확인·충전 환불(완료·거절) | `refunds-client.tsx`, 결제 확인 화면 |
- **충전 환불 거절**(Q7, 2판)
  - 화면: 거절 동작일 때 `refunds-client.tsx` 에 '회원에게 보낼 거절 사유 (필수 — 회원에게 그대로 안내됩니다)' 칸을 **처리 메모와 따로** 둔다. 입력 중 개인정보 경고.
  - route: `memberReason` 필수(1~300자), TS 개인정보 판정이나 긴 숫자 판정에 걸리면 400(PASS 뒤). 그 뒤 5-8 새 서명을 부른다. DB 가 빈 사유·개인정보를 다시 막고, **검사 함수가 오류를 내면 거절 전체가 취소되어 503**(닫힌 쪽으로 실패). 성공하면 돌려받은 `user_id` 로 `chargeRefundRejected`. (3판)
  - 저장: 사유는 `refund_requests.member_reject_reason`(5-8). 알림이 실패하면 `notificationFailed` 와 함께 **저장된 사유를 응답에 싣고**, 거절 창이 그 글을 지우지 않고 보여 주어 관리자가 고객지원으로 그대로 옮길 수 있게 한다. 요청 상세에도 저장된 사유가 보인다. (3판)
  - 재요청은 `REFUND_REQUEST_NOT_REJECTABLE` 예외라 알림이 다시 가지 않는다.
- **화면이 없는 경로의 실패 흔적**(3판): 웹훅 2곳·대사 2곳에서 `sent: false` 이고 `disabled` 가 아니면, 결과·응답은 그대로 두고 `record_payment_alert`(warning, dedupe 키 `member_notification_failed:{kind}:{한국 날짜}`, details 는 kind·reason·주문 id — 회원 id·글자 없음)를 남긴다. 이 기록이 실패해도 무시한다. 같은 kind 의 실패는 하루 한 건으로 모여 대표가 본다.
- **13번 파일**: 답변 route 가 공용 함수를 쓰고, `SUPPORT_PAGE_REQUIRED_KEYS`·안내 문구 탭에서 5개 키를 뺀다(13번 배포 뒤 그 위에).
- **벨·알림 목록**: `type = 'announcement'` 이면 `broadcast.memberLabel` 머리표를 글자로. 값은 `GET /api/notifications` 응답에 함께 싣는다. 벨 항목·목록 항목의 모양을 작은 표시 부품으로 떼어 관리자 미리보기와 같이 쓴다(동작 그대로).

## 7. 관리자 화면 `/admin/notifications`
### 7-1. 위치와 권한
- 사이드바 '회원·고객'에 '알림', 경로 권한 `owner`. 페이지 `requireAdminPagePermission('owner')`, 서버 액션 `requireAdmin()` → `assertAdminActionPermission('owner')` → 서버 키 → 5-4 함수. 시험 갱신: `admin-guard-coverage-contract`(액션 파일·`PAGE_REQUIREMENTS`), `admin-audit-log-contract`(`DB_FUNCTION_ACTIONS` 3줄).

### 7-2. '알림 문구' 탭
- 종류마다 카드: 이름·언제 가는지·받는 화면, 켜기(끌 수 없는 종류는 잠김·이유), 제목, 내용, 자리표시 단추, 예시 값 미리보기, 글자 수. 지급 카드에 분류 이름, 마켓 환불 카드에 문장 4개. 공지 알림 경계 문장(Q5)도 여기서 고친다(바꾸면 판이 오름).
- 입력 중 검사(허용 밖·필수 빠짐·개인정보) → [저장] → 확인 창(바뀐 종류·끈 종류) → 함수 → 태그 갱신. 판 충돌이면 다시 읽는다.
- 13번 '안내 문구' 탭에는 "답변 알림 문구는 '알림' 화면에서 고칩니다" 링크 한 줄.

### 7-3. '공지 알림 보내기' 탭
- 입력: 제목, 내용, 연결(게시 중인 공지 고르기 → 링크 자동 / 5-4 허용 경로 목록에서 고르기 / 없음), 대상(전체 / 나에게만 시험). 자유 입력 주소 칸은 두지 않는다. (3판) 14번 편집 창의 [이 공지로 알림 보내기](대표만)가 이 탭을 채워 연다.
- **경계 안내**(Q5 문장, DB)를 입력 칸 위에 늘 보인다.
- [미리보기]: `member_broadcast_preview` 로 인원·남은 횟수·다음 시각, 벨·목록 모양, 개인정보 경고. `operation_key`(uuid)를 만든다. 입력이 바뀌면 미리보기가 풀리고 [보내기]가 잠긴다.
- **보장 범위**(2판): 미리보기를 거쳤는지는 **화면이 강제**한다. 서버·DB 가 강제하는 것은 인원 대조(`p_expected_count` 는 미리보기로만 알 수 있음), 경계 문장 판 확인, 상한, 재요청, 개인정보, 대표 확인이다. 서명 토큰은 두지 않는다(새 비밀 값 관리가 늘고, 대표만 부르는 기능이라 위 대조로 충분).
- [보내기]: 경계 문장 체크 → 확인 창 "N명에게 보냅니다. 보낸 뒤에는 고칠 수 없고 회수만 할 수 있습니다." → 함수. 누르는 동안 잠금. `BROADCAST_COUNT_CHANGED` 면 미리보기를 다시.

### 7-4. '보낸 기록' 탭
- 시각, 보낸 사람, 대상, 인원, 제목, 링크, 읽은 수(서버 키로 셈), 회수·가림 여부. [회수](사유 코드, '개인정보가 들어감'이면 가림도 함께) → 확인 창.

## 8. 회원 화면
- 글이 DB 문구로 바뀌는 것 말고는 같다. 공지 알림은 머리표 '공지'가 붙고 누르면 공지 글로 간다.
- 공지 글을 나중에 숨기면 알림 링크가 14번 not-found(목록으로 버튼)로 간다. 14번 7-3 이 숨김 때 '이 글로 보낸 공지 알림이 있음' 경고를 보인다.
- 이용 제한 회원도 받고 읽음 처리한다. 탈퇴 회원에게는 가지 않는다.

## 9. 작업 기록 종류(`src/lib/admin-audit-log.ts`) (2판)
| 종류 | 이름 | 남기는 곳 | 보관 분류 |
|---|---|---|---|
| `member_notification_texts_update` | 회원 알림 문구 수정 | DB 함수 | 2년 쪽 |
| `member_broadcast_send` | 공지 알림 보내기 | DB 함수 | 2년 쪽 |
| `member_broadcast_retract` | 공지 알림 회수 | DB 함수 | 2년 쪽 |
| `support_page_content_update` | (13번 종류, 5-5·5-6 스크립트) | 스크립트 | 13번이 정한 대로 |
- 셋 다 회원에 관한 결제·환불 처리가 아니므로 `paymentLinkedActions` 에 넣지 않는다(13번 14절 규칙).
- 충전 환불 거절은 작업 기록이 아니라 **결제 처리 기록 `payment_admin_actions`** 에 남는다(5-8: 지금은 수동 확인 거절만 남았고, 이제 보통 거절 `refund_rejected` 도 남음, 사유는 글자 수만). 이 표는 결제 기록과 함께 보관하는 쪽이다. (3판: 2판 문장의 사실 오류 고침)

## 10. 시험
### 10-1. 계약 시험 `tests/bundle16-member-notifications-contract.test.mjs` (2판)
- `src/` 에서 `from('notifications').insert` 가 `member-notifications-server.ts` 밖에 없음. 고칠 기존 시험: `member-notification-contract`, `admin-notifications-service-role-contract`, `admin-notifications-cleanup-contract`(웹훅 INSERT 1개 단언을 공용 함수 기준으로 바꾸되 '웹훅·대사는 관리자에게 notifications 를 넣지 않는다'는 보장은 남김), **`payapp-webhook.test.mjs`·`payapp-reconciliation.test.mjs`·`admin-credit-revoke-contract.test.mjs`**(3판). 고칠 때 지킬 것: (a) 결과별 회원 알림 1건/0건 표와 '관리자에게 알림 없음' 단언은 남기고, 대상만 '보낸 kind·userId 기록'으로 바꾼다(보내기 함수를 `runFollowUps` 에 넘기거나 modules 맵으로 바꿔 끼움) (b) 비밀값 시험은 보내기 함수에 넘긴 값까지 본다 (c) 회수 시험은 `notificationFailed: false` 와 버튼의 `result.notificationFailed`
- 첫 값 = 옛 코드 글(이 시험에 기대값으로 고정), 마이그레이션 종류 키 = 코드 종류 표
- `renderMemberNotification`: 채우기, 허용 밖·필수 빠짐 null, 값 속 `{…}`, 끌 수 없는 종류 `enabled:false` 무시, 문구 없음 → `texts_unavailable`
- `buildMarketRefundMessage` = 옛 함수(8번 시험 묶음)
- **결제 경로**: 웹훅·대사·충전 환불·마켓 환불·지급·회수·결제 확인에서 문구 읽기 실패·알림 실패에도 반환 결과(`refund_finalized`·`payment_fulfilled` 등)·응답 상태·재시도 판단이 같음. `already_completed`·`already_fulfilled`·`alreadyGranted`·`alreadyRevoked`·`replayed` 면 보내기 0번
- **충전 환불 거절**: 사유 없음·개인정보 → 거절 처리 함수 호출 0번, 검사 함수 오류 → 503·알림 0번, 성공 뒤 요청 행에 회원용 사유 저장·`admin_note` 는 내부 메모 그대로·알림 1번, `REFUND_REQUEST_NOT_REJECTABLE` → 알림 0번, 처리 메모가 알림에 들어가지 않음, 알림 실패 때 응답에 저장된 사유, 새 코드가 4인자 거절 함수를 부르지 않음, 마이그레이션의 새 서명이 빈 사유를 거절 (3판), **긴 숫자 사유 → route 400·DB 거절·알림 0, 가림 route enum 과 패널 `TARGET_FIELDS.refund_request` 에 `member_reject_reason`, 링크 허용 꼴 목록(코드 = 함수), 기록 표 `not_advertising_statement_text` = 그 판 문장, down 첫머리 옛 함수 확인 (PASS 뒤), 새 서명에 DEFAULT 없음, 새 서명·재정의 함수의 EXECUTE 회수, 보통 거절 INSERT 의 `note` 가 상수 표지이고 회원 사유·메모 변수를 쓰지 않음, action CHECK 에 `refund_rejected`, `PAYMENT_ADMIN_ACTION_LABELS` 에 이름, 탈퇴 패널·가림 route enum·facts 에 새 칸, down 이 CHECK·가림 확장을 되돌리지 않음** (4판)
- 웹훅·대사 알림 실패 → `record_payment_alert` 1건(회원 id·글자 없음), 그 기록이 실패해도 결과 같음 (3판)
- 경계 문장을 바꾸면 기록에 이전·새 판과 원문이 남음, 허용 밖 링크 거절(코드 목록 = 함수 목록) (3판)
- 실패 칸 표(6절)의 route·화면 파일이 모두 `notificationFailed` 를 쓰고 읽음
- 마이그레이션: 사전 점검(이미 있음 경로 포함), 복사 VERIFY, RESTRICTIVE 정책, `lock_timeout`, 가드, 함수 EXECUTE 회수(5개), 보내기 함수의 잠금 → 재요청 → 상한 순서, 받는 사람 한 번 뽑기, 기록 details 에 원문·`user_id` 키 없음, 되돌리기의 FK 제약 삭제
- 관리자: 권한표 `owner`, 사이드바, 작업 기록 종류 3개
### 10-2. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost: 세 탭을 열고 입력·미리보기(읽기만)까지. 저장·보내기·회수·벨 열기 안 함. 충전 환불 거절 창은 열어서 칸 이름·경고까지만.
- 운영 배포 뒤: 대표가 '나에게만 시험' 1건 → 벨·목록·링크·머리표 확인 → 회수 1번(시험 건). 실제 회원 알림은 다음 실제 처리 때 읽기 조회로 확인.

## 11. 문구 초안(새로 생기는 것만, 최종은 대표가 7-2 에서)
| 키 | 초안 |
|---|---|
| `chargeRefundRejected.title` / `message` | 충전 환불 요청이 거절되었습니다 / 환불 요청이 승인되지 않았습니다. 사유: {사유} |
| `broadcast.memberLabel` | 공지 |
| `broadcast.notAdvertisingStatement` | 이 알림은 약관·정책 변경, 장애·점검, 결제·환불 절차 변경 같은 서비스 이용 안내입니다. 새 자료 출시·이벤트·할인·쿠폰·가격 안내가 아니며, 그런 글이나 판매·충전 화면으로 연결하지 않습니다. (3판) |
| `broadcast.redactedText` | 개인정보가 포함되어 가린 알림입니다. |
- 나머지 종류는 1-2 의 지금 운영 글이 첫 값이다.

## 12. 검증 관점(계획·구현 모두 PASS 까지)
1. **DB·마이그레이션**: 잠금 두 곳, 정책, 함수 권한, 복사·정리·되살리기·되돌리기 순서, 다시 적용, 14번 down 과의 순서, 동시성
2. **결제 경로**(결제 검증 3명: 지급 판정·환불·마이그레이션): 12곳에서 알림이 결과·재시도를 바꾸지 않음, '상태를 바꾼 경로만 알림', 충전 환불 거절 분기 추가, **5-8 결제 DB 변경**(`refund_requests` 칸, 거절 함수 새 서명·옛 서명과의 겹침·정리, `payment_admin_actions` CHECK·`note`·`actor_id`, 가림 함수·`member_withdrawal_facts` 재정의와 탈퇴 패널) (3판·4판)
3. **법률**: 광고 경계(Q5)·링크 허용 경로, 끌 수 없는 종류와 사유 필수(Q2·Q7), 내부 메모 분리, 거절 사유 보존(탈퇴 뒤), 기록 보관과 가림, 문구 수정 기록의 원문 예외(4절)
- 대량 발송 보안(대표만·상한·재요청·개인정보·링크·회수)은 1번과 3번이 나눠 본다.

## 13. 배포 순서
1. 계획 검증 PASS → 0절 답 반영
2. 선행(6절): 13번 배포·`adminRequestMeta`, 14번 DB 적용
3. 구현 → 계약 시험 → 구현 검증 PASS
4. 리허설(5-7, 새벽) → **DB 적용**(새벽, 승인). 옛 코드는 새 칸·행을 쓰지 않는다
5. 로컬 확인(나 → 대표, 쓰기 없음) → 대표 승인 → push·배포
6. 운영 확인(10-2) → **5-6 정리 스크립트**(승인, 13번 키 정리 + 옛 4인자 거절 함수 삭제) (3판)
7. 런북에 '공지 알림 보내기·회수'(Q5 경계, 개인정보 금지, 회수·가림 기준)와 '충전 환불 거절 사유 쓰는 법' → 진행 기록 갱신
- 일정: 12·13번의 01-10 마감 작업과 14번 뒤. 약관·동의 항목·탈퇴 정책 키를 건드리지 않아 15번 고지 기간 잠금과 충돌하지 않는다.

## 14. 15번·14번과의 정리
- 15번 14절의 팝업 기능은 하지 않는다. 공지 알림은 벨이다.
- 약관 시행 무렵 공지 알림으로 '바뀐 약관 시행' 소식을 보낼 수 있다(대표 선택). **보조 안내일 뿐이고, 약관 변경 고지는 15번 수단(변경 예정 약관 게시·팝업·재동의)이 맡는다. 회수할 수 있는 이 알림으로 법정 고지를 대신하지 않는다.** (2판)

## 15. 범위 밖(후속)
- 대상 고르기, 예약 보내기, 마케팅 발송(4번 후속), 이메일·푸시, 관리자 경보 문구 DB 화, 알림 보관 기간 자동 정리

## 16. 열린 질문
3. (4판) 수동 확인 거절의 `payment_admin_actions.note` 에 처리 메모 원문이 들어가 가릴 수 없다(지금도 같음). 이 메모 칸에 회원 개인정보를 쓰지 말라는 안내를 화면에 둘지, 다음 결제 묶음에서 표지로 바꿀지 — 기본: 화면 안내 한 줄만 더함.
1. 운영의 옛 시험 행 'Test Notification from Script'(2026-02)와 옛 '환불이 승인되었습니다' 2건을 지울지 — 지운다면 별도 스크립트(작업 기록), 대표 확인 뒤.
2. 크레딧 지급 알림의 `{내용}`(관리자가 적은 글)이 그대로 회원에게 간다(Q-7 기존 결정). 지급 창에 개인정보 경고를 더할지 — 기본: 더한다(14번 TS 판정, 막지는 않음).
- (1판 16절 1 '한 환불에 두 번'은 1-2 '상태를 바꾼 경로만 알린다' 규칙으로 닫았다. 1판 16절 4 '기록 표 보관 기한'은 5-3 '회원 칸 없음'으로 닫았다.)

## 17. 1판 검증 반영
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 경로 major | 대사(cron) 경로 2곳·재사용 1곳 빠짐, 보내는 곳 수 | 1-2 표·12곳, 6절 교체, 10-1 결제 경로 시험, 중복 규칙으로 16절 1 닫음 |
| 경로 major, 법률 major | 충전 환불 거절 사유를 내부 메모로 채움, 빈 사유 대체, 받는 회원 id | Q2·Q7, 6절 회원용 거절 사유 칸(필수·개인정보 사전 차단), `refund_requests.user_id` 선조회, 대체 문구 삭제, 10-1 |
| 경로 major | 코드 되돌린 뒤 13번 키가 없어 고객지원 오류, 키 없음 경우 미정 | 5-5 키 되살리기를 코드 되돌리기 전 별도 스크립트로, 5-6 '이미 없음' 경로, R7·R8 |
| DB major | 결제·법적 문구인데 쓰기 막기 정책 없음 | 5-2 RESTRICTIVE 정책(새벽 같은 거래), 4절 여러 겹, R2 |
| DB major | 받는 사람 함수 권한·보안 방식 누락(회원 id 노출) | 5-4 SECURITY INVOKER + EXECUTE 회수, 함수 5개, VERIFY·R6·down |
| 법률 major | 광고 경계가 자가 확인뿐, 정의 없음 | Q5 경계 문장(DB, 판), 보내기 때 판 확인·기록, 11절 초안, 런북 |
| 경로 minor | 실패 알림 칸 사실 오류·불일치 | 1-2 사실 고침, 6절 경로·화면 표로 `notificationFailed` 통일 |
| DB minor | 재요청 검사가 잠금 앞, 세기·넣기 스냅숏 다름 | 5-4 잠금 → 재요청 → 상한, 받는 사람 한 번 뽑기, R3 동시 2건 |
| DB minor | down 이 남긴 FK 가 14번 down 을 막음, 다시 적용 처리 | 5-5 FK 제약 삭제, 5-1 '이미 있음' 대조, R7 |
| DB minor | 미리보기 강제를 서버가 증명 못 함 | 7-3 보장 범위 명시(화면 강제, 서버는 인원·경계 판·상한 대조), 서명 토큰은 두지 않는 이유 |
| 법률 minor | 새 기록 종류 보관 분류, 기록 표 보관 질문 | 9절 2년 쪽, 5-3 회원 칸 없음, 10-1 원문·`user_id` 없음 시험 |
| 법률 minor | 공지 알림이 법정 고지로 오해될 수 있음 | 14절 문장 |
| (14번 반영과 맞춤) | 작업 기록에 원문 | 5-4 기록에는 지문·글자 수, 원문은 가릴 수 있는 기록 표 |

## 18. 2판 검증 반영 (3판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 법률 major | 충전 환불 거절 사유가 알림 행에만 남아 탈퇴 익명화 때 사라짐, 보통 거절은 처리 기록 없음(2판 9절 사실 오류), 알림 실패 때 사유 분실 | 5-8 `refund_requests.member_reject_reason`·새 거절 서명(같은 거래 저장, DB 도 빈 사유·개인정보 거절, 모든 거절에 처리 기록·글자 수만, `user_id` 반환)·가림 함수 대상, 6절 실패 때 저장된 사유 표시, 9절 정정, 10-1·R9, 12절 결제 검증 범위 |
| DB minor (14번 major 와 짝) | 16 down 뒤 14 down 이 표 존재로 멈춤, FK 다시 붙이기 | 14번 5-7 조건 변경과 맞춤(5-5), 5-1 FK `NOT VALID`, R7 순서 |
| DB minor | down 이 정책을 지워 남은 행이 대표 세션에 열림, 다시 적용 때 검사 없음 | 정책도 남김(재적용은 없을 때만 생성), 5-1 구조 검사·답변 키 대조 |
| DB minor | 동시 재요청은 리허설로 재현 불가 | R3 순차 재요청만, 동시성은 10-1 순서 단언 |
| DB·법률 minor | 문구 수정 기록에 원문(4절 원칙과 어긋남), 경계 문장 원문 빠질 수 있음 | 4절 예외 명시·법률 확인, 5-4 바뀐 모든 경로·경계 판과 원문, 10-1 |
| 법률 minor | 사이트 안 아무 주소나 연결 가능 | 5-4 링크 허용 경로(판매·충전 경로 거절), 7-3 자유 입력 없앰, 경계 문장 넓힘, R3 |
| 경로 minor | 깨질 기존 실행 시험 3개 누락 | 10-1 목록과 고칠 때 지킬 것 (a)(b)(c) |
| 경로 minor | 화면 없는 4곳의 실패 흔적 없음 | 6절 `record_payment_alert` 하루 한 건, 10-1 |
| 경로 minor | 되살리기·다시 적용에서 값이 다를 때, 켜기 값 대응, 사이 기간 13번 탭 저장 | 5-2 대응표, 5-1·5-5 다를 때 규칙, 저장 금지 안내 |
| 경로 minor | 개인정보 검사 오류 때, 알림 실패 때 사유 | 6절 503 닫힌 실패, 저장된 사유 표시 |

## 19. 3판 검증 반영 (4판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 법률·환불 major | `payment_admin_actions` 의 action CHECK·`note` 비지 않음·`actor_id` NOT NULL 때문에 보통 거절이 실패하거나 글이 고칠 수 없는 표로 감, down 의 CHECK 되돌리기 불가 | 5-8 CHECK 다시 만들기(같은 거래, 새벽 잠금), 보통 거절 `note` = 고정 표지, `p_admin_id` 필수, down 은 넓힌 CHECK 를 남김, 표시 이름·시험, R9·10-1 |
| 법률 major, 환불 minor | 새 칸이 탈퇴 가림 판정·화면에 없음(긴 숫자가 남음), down 뒤 가릴 수 없음, 칸 CHECK 가 가림을 막을 수 있음 | 5-8 `member_withdrawal_facts`·`redact_member_text` 재정의(지문 대조)·패널·서버 칸, 표 CHECK 는 비지 않음만, down 은 확장을 남김, R7·R9 |
| 환불 major | 새 서명에 DEFAULT 가 옮겨지면 옛 4인자 호출과 겹쳐 DB 적용~배포 사이 거절이 막힘 | 5-8 DEFAULT 없음, R9 같은 거래 옛 호출 성공, 10-1 |
| 환불 minor | 다시 만든 옛 함수·새 서명의 권한이 anon 에게 열릴 수 있음 | 5-5 되살리기 REVOKE/GRANT·`proacl` 확인, 5-6 DROP 전 확인, VERIFY·R6 |
| 14번 DB minor(짝) | 14번 down 의 FK 조건이 자기 판 이력 표를 세고, 16번 함수 목록이 없음 | 14번 5-7 에서 고침(판 이력 표 제외, pii 함수를 부르는 16번 함수 이름으로 검사). 5-5 의 '14번과의 순서' 문장은 그 조건을 그대로 가리킴 |
| — | 수동 확인 거절 `note` 가 가림 밖 | 16절 3 열린 질문 |

## 20. 4판 검증(PASS) 뒤 minor 반영
| 지적 | 반영 |
|---|---|
| 링크 꼴이 자유로워 가릴 수 없는 곳에 글이 남음 / 거절 사유 긴 숫자가 알림 표에 남음 / 경계 문장 원문이 2년 기록에만 / 재정의 함수 권한 문장이 운영과 다름 / 허용 칸 위치 오류 / 다시 적용 때 5-8 남은 것 / down 이 옛 거절 함수를 확인 안 함 | 5-4 링크 고정 꼴(쿼리 없음), 5-8·6절 긴 숫자 거절(route 400·DB 새 코드), 5-3 `not_advertising_statement_text`, VERIFY·R6 적용 전 보안 방식·`proacl`, route `:72` enum, 5-1 남은 것 처리(지문 두 판), 5-5 down 첫머리 확인, R3·R7·R9·10-1 |

