# 9번 묶음 계획: 결제·환불 안내 DB화 + 다시 지급한 크레딧 처리 (8판 — 확정)

작성일: 2026-11-23 · 순서표 `docs/prelaunch-work-order.md` 9번
판 이력: 1판 → 1회차 검증(4명 FAIL, major 25) → 2판(대표 추가 결정 2건) → 2회차 검증(4명 FAIL, major 14) → 3판(취소·회수 경로를 표·규칙으로 확정, 문구 정확성) → 3회차 검증(4명 FAIL, major 6) → 4판(부분 회수 끝 상태·쓴 몫 정의·남은 옛 문장·되돌리기 뒤 화면·런북 수단) → 4회차 검증(환불 흐름 PASS, 나머지 FAIL major 8) → 5판(자동 '이미 쓴 몫' 계산·권장 회수량을 없애고 원천별 원자료 기록으로 단순화, 지급이 늦은 결제의 마감 기준일, 런북 수단 통일) → 5회차 검증(FAIL, major 8 = 서로 겹쳐 4가지) → 6판(결제 내역 마감을 판정 함수 값 그대로, 만료 정리는 원장 아닌 관리 기록에만, 템플릿 요청 origin·순서·해제, 대표 판단 근거를 원천별 사용 내역으로) → 6회차 검증(지급·환불 흐름·마이그레이션 PASS, 법률 FAIL major 1 — '1년을 넘지 않습니다' 절대 문장) → 7판(범위 문장 + 경미 지적 반영) → 7회차 확인(결제 통합 PASS, 법률 major 1 = 범위 문장의 조항 참조 '5절 ⑥' 오류) → 8판(참조를 '3-2절 ⑥', ④·⑤ 한 트랜잭션, 경미 지적 반영) → 8회차 법률 확인 PASS — 확정, 구현 시작.
대표 지시(2026-11-23 밤): 꼭 대표 확인이 필요한 것이 아니면 확인 없이 계획대로 진행. 판매 켜기·충전 판매 상태 변경은 하지 않는다.

## 0. 결정
1. (대표) 약관 '1년 이내' 문장은 실제 규칙대로 고친다.
2. (대표) 결제·크레딧 화면 문구를 DB 로, 관리자 요금제 화면에서 고친다. 결제 직전 동의를 기록한다(기록 실패면 결제 안 함).
3. (대표) 미성년자 결제 취소·서비스 종료는 고지 + 런북. 계좌 환불 기능·종료 일괄 환불은 변호사 확인 뒤.
4. (대표) 자료 환불로 다시 지급한 크레딧은 원래 충전분과 같이 본다(유료 판정·두 번 세지 않음) + 원래 결제 취소 경보.
5. (대표) 충전 환불 마감 = 결제일(한국 날짜) 다음 날부터 {충전환불기간}일째 되는 날 24시. 화면 'N월 N일(한국 시간)까지'.
6. (대표) 원래 충전 결제가 취소되면 그 결제에서 비롯한 재지급 크레딧도 함께 사용 보류하고 수동 완료 때 회수. 부분취소에서는 '원래 충전분과 같은 순서·상한'(아래 2-4), 전액취소면 남은 것 전부. 이미 쓴 몫은 경보 뒤 대표 판단.
7. (진행 중 정함, 대표 지시 범위) 이용기간 문구는 실제 계산(결제 시각 + 1년)대로 '결제한 때부터 1년'으로 쓰고 크레딧 화면 만료를 날짜·시각까지 보인다(만료 규칙 자체는 안 바꿈). 이용기간·충전 한도는 설정에 넣지 않고 글자로(계약 시험이 지급 함수·DB CHECK 와 대조). 카카오페이 결제 경로는 코드에서 막는다. DB 적용~코드 배포 사이 옛 코드가 동의 기록 없이 결제를 받을 수 있는 구간은 **출시 전이라 0-2 의 예외로 두고**(충전 판매 상태는 건드리지 않음) 적용 시각 뒤 주문을 사후 점검한다. 결제 연결 없는 옛 원천은 출시 전 테스트 데이터 삭제 목록.
8. 변호사 확인 목록에 추가(문구는 지금 규칙대로 두고 고지만 정확히): '그 충전 건을 일부 쓰면 남은 크레딧도 단순 변심 철회 불가'의 효력, '유료 크레딧 1년 소멸·만료분'의 처리, 미성년자 취소 때 이미 쓴 몫, **청약철회 말일이 토·일·공휴일이면 다음 평일까지 늘어나는지(민법 161조)** — 결과가 나오기 전까지는 런북 4로 처리(마지막 날이 주말·공휴일이고 다음 평일에 고객센터·화면으로 온 신청은 기간 안으로 보고 콘솔 취소). 자동 연장(공휴일 DB 목록 포함)은 대표 확인 사항으로 남김. 또 '크레딧은 회사 자체 자료 구매에만 쓰는 자사 포인트로서 선불전자지급수단이 아니라는 전제(사용처 확대 때 재검토)'.
10. (5판) 다시 지급한 크레딧이 얽힌 취소에서 '이미 쓴 몫'·권장 회수량을 자동 계산하지 않는다. 같은 결제를 여러 번 수동 완료할 수 있어 자동 계산이 이중 청구로 이어질 위험이 있다 — 원천별 원자료만 기록·표시하고 대표가 런북으로 판단.
9. 순서: ① 9번 DB 적용 → ② 타입 재생성·코드 배포 → ③ VERIFY·사후 점검 → ④ 약관·충전 화면 문구 스크립트 → ⑤ 8번 환불정책 본문(초안 B, ⑥ 수정, ④ 뒤 본문 기준으로 다시 만든 스크립트) → (⑥ 자료 판매 켜기 — 대표). ④ 이후 코드를 9번 이전으로 되돌리지 않는다.

## 1. 범위
**한다**: 충전 정책 설정·판정 함수 재정의, 결제 동의 기록, 카카오페이 경로 차단, 관리자 문구 칸, 결제·크레딧·충전·결제 내역 화면 문구, 재지급 크레딧 보류·회수·경보·자료 환불 엔진 뿌리 판정, 약관 문장 교체 스크립트, 런북 4개.
**안 한다**: 계좌 환불 기능, 남은 분 부분 환불, 종료 일괄 환불, 충전 환불 조건(미사용 전액) 변경, 만료 규칙 변경, 나이 확인, 이용기간·한도 설정화.

## 2. DB (마이그레이션 1개 + 되돌리기 2개, 리허설 → 적용)
마이그레이션 버전은 8번(20261124100000)보다 뒤인 `20261125100000_point_charge_policy`, 적용은 8번처럼 schema_migrations 기록 + statements md5 확인.
### 2-0. 함수 표 (사전·새 md5 = md5(pg_get_functiondef(oid)), 8번과 같은 측정; 사전 값 = 2026-11-23 운영 값, 다르면 RAISE / 재정의는 새 md5 를 VERIFY 고정)
| 함수 | 처리 | 바꾸는 이유 | 사전 md5 | 되돌리기 |
|---|---|---|---|---|
| get_point_charge_refund_eligibility(uuid,uuid) | 재정의 | 마감 셈법·설정값, 재지급 원천 사유 | 0245acd07bad83535eb6e1099cffae7a | 나 |
| quarantine_external_provider_cancellation(uuid,text,timestamptz,text) | 재정의 | 자손 보류·경보 | 7262e621179dda8b3094b8455a6718a1 | 가 |
| quarantine_payapp_partial_cancellation(uuid) | 재정의 | 자손 보류·경보 | e0d24cd68b52d8011bf3adce4e0c5eb7 | 가 |
| process_payapp_cancellation(uuid) | 재정의 | 실패 대체 경로(원래 원천 격리·manual_review 생성)에도 자손 보류·경보 | 31878a1c6c5247c501c46b3d49091a82 | 가 |
| complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer) | 재정의 | 자손 함께 회수(완료 시점 재계산)·상태 규칙 | 90c81af8fb2ebf8cb9a4a848d81dc688 | 가 |
| market_refund_allocate(uuid,integer,uuid[]) | 재정의 | ⓪ 판정에 뿌리 상태 | 0eca13d1b2dcce79e5872a4ce8b82453 | 가 |
| request_point_charge_refund | 그대로 | (판정 결과를 따름) | c73ccb6ce327baa49ff8d327150ee32f | – |
| claim_point_charge_refund | 그대로 | 기간 안 봄 | d2ff0d91837f27466e471437ab2cdb26 | – |
| finalize_point_charge_refund | 그대로 | 기간 안 봄 | 1503dbe6cde53241b7ab2e2ed17be814 | – |
| reject_point_charge_refund | 그대로 | 외부 취소는 거절 불가 전제 | 20384719deba112e977fbd3bf8e266e5 | – |
| fail_ / requeue_stuck_point_charge_refund | 그대로 | | 88e2b4cb94d68da451b42994f19adb14 / d2129147f1ed7c465ede85815edb653c | – |
| prepare_payment_order | 그대로 | | 462fed08230394ce2b047818477ddc74 | – |
| record_payment_alert | 그대로 | | 80ee3155bf958c47a908fba4b28935e1 | – |
| consume_credits | 그대로 | active 만 씀(보류 = 사용 중지) | 2c2398857d424d5522462517e26479c0 | – |
| market_refund_settle / approve_market_refund / settle_market_refund_by_owner | 그대로 | 자손 생성·in_progress 사용처 | 7682e64882413f0d31a943e3c515a492 / 5039e98d8060a72f40b93e5f4db00417 / 2ac88461650e13da79673e362ba0e677 | – |
| quarantine_kakaopay_partial_cancellation | 그대로(보류 대상 제외) | 카카오페이 경로 차단, 운영 kakaopay 결제 0건 | 2907ff25ef4f84f3507713363528f09f | – |
| revoke_admin_credits / get_credit_balance_snapshot / refund_credits / resolve_payment_order_review / grant_admin_credits | 그대로 | 재지급 회수 금지·pending_refund 잔액 포함·비활성 원천 건너뜀·원천 refunded 일 때만 주문 닫기·system_refund 생성 | 8c1f5e5e316c18b48556c18ca9bad86f / 1c30e49ad8edb7b767af6356bda2ef8d / bdfb58486f758ba173fae2691b0f4385 / c9be280b25e58591f026dd196f2bc1ef / dc251535d674a072f1b36ab3d78a864d | – |
| get_manual_refund_recovery_preview(uuid) | 새로(service_role) | 관리자 수동 완료 화면의 원천별 원자료·상한을 수동 완료와 같은 헬퍼·정의로 | – | 나 |
| payapp_fulfill_order_internal(uuid,timestamptz) | 그대로 | 원천을 지급 순간(now())에 만들고 approved_at 은 p_approved_at — 마감 기준시각 GREATEST 의 전제 | 78cd0333f01a23a4d63228369175f517 | – |
| approve_market_partial_refund / admin_exception_market_refund | 그대로 | allocate ⓪ 결과(NEEDS_OWNER)를 쓰는 호출자 | 222c7849cfe61fbc81328c75be6a1f27 / af93b0e327efbf8ccaaef88994a84785 | – |
- 불변 조건: 기간은 신청 시각에 판정 함수에서만 본다(claim·finalize 는 안 봄).
- 계약 시험: 재정의 함수는 원래 사본과의 차이가 `-- [9번] 시작/끝` 표시 구역 안에만 있다(교체 구역은 원래 줄을 고정 접두어 `-- [9번 원래]` 주석으로 남겨 대조; 마이그레이션을 정규식으로 훑는 기존 시험은 `--` 로 시작하는 줄을 빼고 찾는다). 교체 구역: 판정 22·67·99행 부근, 수동 완료 112-133·168-190행 부근과 payment_admin_actions INSERT·RETURN 부근, allocate 73-75행 부근. 격리 3곳은 덧붙임만(기존 알림 format 은 그대로 두고, 자손이 있을 때 [9번] 블록에서 별도 알림 1건을 추가). 9번 적용 뒤에는 8번 down·재적용을 하지 않는다(8번 파일은 allocate 를 md5 확인 없이 덮음 — 필요하면 9번 (가) down 을 먼저).

### 2-1. 설정 `point_charge_policy`
- 키: `version(1 이상 정수 — 관리자 저장이 올림, VERIFY 는 값 고정 안 함; 없거나 숫자가 아니면 TS 저장을 막고 새로고침 안내), refundDays(7), checkoutTitle, checkoutItems{product, validity, refund, restriction, otherCases}, minorNotice, agreeLabel, creditsGuide, refundRequestConfirm[], refundRequestAccepted, refundBlockReasons{코드: 문구}`.
- 자리표시는 `{충전환불기간}` 하나(다른 중괄호 거절). 지문 대상 키(checkoutTitle·checkoutItems 5개·minorNotice·agreeLabel)는 각각 빈 값 금지, `checkoutItems.refund` 에 `{충전환불기간}` 필수. 관리자 화면 칸마다 '꼭 들어가야 할 내용' 표시.
- 결제 화면·동의 함수가 보는 필수 검사는 refundDays + 지문 대상 키만(TS·SQL 같은 규칙, 계약 시험 대조). 크레딧 화면용 키는 키마다 코드 대체 문장(결제를 막지 않음).
- 넣기 `INSERT … ON CONFLICT (key) DO NOTHING`. RESTRICTIVE 정책 `system_settings_point_charge_policy_no_client_write`(7번 모양) + VERIFY.
- 내부 함수 `point_charge_refund_days()`(7~3650 정수 아니면 NULL — 법정 7일보다 짧은 값은 판정·동의·TS 검사 모두 거부), `point_charge_refund_deadline(p_base timestamptz, p_days integer)` = `market_refund_deadline(p_base, p_days)`(판정 함수가 2-2 의 일수(GREATEST·대체값)를 넘긴다; 기준시각 = **GREATEST(payment_orders.approved_at, credit_sources.created_at)** — 결제일, 다만 크레딧 지급이 늦어졌으면 지급일. 보통은 같은 날이라 0-5 그대로, 늦으면 회원에게 유리). 둘 다 STABLE·SECURITY INVOKER, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`(ACL = postgres 만, 8번과 같음).

### 2-2. 판정 함수
- 결제 확인 뒤 마감을 계산하되 NULL 이면 기억만. '처리 중·완료·이미 씀·만료' 검사를 먼저 하고, 일수 = GREATEST(설정 refundDays, 그 결제 동의 행 refund_days) — 동의한 기간보다 짧게 판정하지 않음(동의 행: payment_orders.checkout_attempt_id → checkout_attempts.id → (user_id, checkout_attempt_id) → acks). 설정이 NULL 이면 동의 행 refund_days, 그것도 없으면 법정 최소 7(설정 장애로 법정 기간 안의 철회를 막지 않게). 이 대체 일수로 마감을 계산해 **모든 반환**의 refundable_until 에 넣고, 반환에 `policy_fallback`(true/false)·사용한 일수를 싣는다. 판정 함수는 쓰기를 하지 않는다(STABLE 유지 — 경보는 TS 가 policy_fallback 을 보고 남김). `REFUND_POLICY_UNAVAILABLE` 은 '마감 계산 자체 실패'에만. `IF NOT (now() < 마감)` → `REFUND_REQUEST_PERIOD_EXPIRED`. `refundable_until` = 새 마감.
- 재지급 원천(system_refund + 재지급 연결 있음)은 `REFUND_REISSUED_SOURCE`(전용 문구·코드 대체 문장 모두 '자료 환불로 다시 받은 크레딧은 단순 변심 결제 취소 대상이 아닙니다(미성년자 결제 취소·서비스 종료는 취소·환불정책 7·8절)'), 연결 없는 system_refund 는 지금처럼 `REFUND_PAID_SOURCE_REQUIRED`.
- 운영 규칙: refundDays 는 낮추지 않는다. 올릴 때는 범위 문장('1년을 넘지 않습니다')도 같은 작업에서 다시 확인(VERIFY: refundDays ≤ 365). 바꿀 때는 같은 작업에서 약관 본문 숫자도 바꾼다(VERIFY: 약관의 충전 환불 일수 = refundDays).

### 2-3. 결제 동의 기록
- 표 `point_charge_checkout_acks`: `id, user_id, checkout_attempt_id(= checkout_attempts.checkout_attempt_id, 화면 UUID), plan_id, plan_name, amount, credits, refund_days, notice_text(CHECK 비어 있지 않음), notice_sha256, refund_policy_sha256(기록 시점 refundPolicy 최신 사본 policy_document_snapshots 의 content_sha256 — 동의한 정책 판), created_at`, 유일 (user_id, checkout_attempt_id). 가드·RLS·권한은 7번 `market_purchase_notice_acks` 와 같음(FK profiles ON DELETE CASCADE, DELETE 는 프로필이 없을 때만). 결제한 회원은 payment_orders.user_id RESTRICT 로 프로필이 지워지지 않아 5년 보존된다(10번 익명화는 프로필을 지우지 않는 방식으로).
- 지문 = sha256(fill(checkoutTitle) ‖ LF ‖ fill(product) ‖ LF ‖ fill(validity) ‖ LF ‖ fill(refund) ‖ LF ‖ fill(restriction) ‖ LF ‖ fill(otherCases) ‖ LF ‖ fill(minorNotice) ‖ LF ‖ fill(agreeLabel)).
- `record_point_charge_checkout_ack(p_user_id, p_checkout_attempt_id, p_plan_id, p_expected_amount, p_expected_credits, p_notice_sha256)`(service_role 만): 설정 문제 `NOTICE_POLICY_UNAVAILABLE`, 요금제 비활성 `PLAN_UNAVAILABLE`, 금액·크레딧이 DB 요금제와 다름 `PLAN_CHANGED`, 지문 다름 `NOTICE_CHANGED`(details), 같은 user+attempt 행이 있으면 지문·plan_id·금액·크레딧이 모두 같을 때만 OK, 아니면 `NOTICE_KEY_CONFLICT`.
- 페이앱 주문 준비 API 순서: 인증 → 약관 동의 → 본문·`acknowledgeCheckoutNotice`(없음/false → 스키마 검사보다 먼저 400 `CHECKOUT_NOTICE_REQUIRED` '결제 화면이 바뀌었습니다. 새로고침한 뒤 결제 전 확인을 다시 읽고 동의해 주세요') → 요금제·결제수단·런타임 게이트 → `checkout_attempts` 에서 (user_id, checkout_attempt_id) 로 payment_order_id 조회(오류면 503 끝) → 주문이 있으면 기록 건너뛰고 지금처럼 prepare → existingOrderResponse(단 결과가 결제창 재사용(reuse_payurl)인데 그 attempt 의 **동의 행이 없으면**(①~② 사이 옛 코드가 만든 주문) 재사용하지 않고 409 `CHECKOUT_NOTICE_CHANGED` 로 새 attempt — 안내에 '이전에 연 결제창은 닫아 주세요', 이전 결제창은 ready_expires_at(최대 30분)까지 살아 있으므로 ③ 사후 점검 대상. 동의 행이 있으면 지문이 달라도 그 주문을 만들 때의 동의가 기록돼 있으므로 그대로 재사용. 결과 화면(show_result)은 그대로; reuse_payurl 분기의 동의 행 조회가 오류면 503 으로 끝 — 새 attempt 로 보내지 않음) → 없으면 기록(PLAN_CHANGED·NOTICE_CHANGED·KEY_CONFLICT 409 `CHECKOUT_NOTICE_CHANGED`/`CHECKOUT_PLAN_CHANGED`, 그 밖 503, 결제 안 함) → prepare.
- 409 `CHECKOUT_NOTICE_CHANGED`·`CHECKOUT_PLAN_CHANGED` 응답에는 라우트가 캐시 없이 다시 읽은 결제 전 확인 보기(채운 문구·noticeSha256)와 요금제 price·credits 를 싣는다. attempt 저장 키에 noticeSha256 도 넣는다.
- 화면: 409 `CHECKOUT_NOTICE_CHANGED`/`PLAN_CHANGED` 면 응답의 새 문구·값으로 상태를 바꾸고 체크를 풀고 저장된 attempt 를 지워 새 attempt 로(동의 행만 있고 주문이 없는 경우는 이중 결제 없음, reuse_payurl 분기는 위 안내). 응답의 credits 도 plan 과 비교.
- 카카오페이: 주문 라우트 맨 앞 503 `PAYMENT_PROVIDER_RETIRED`, 결제 화면 서버 페이지의 kakaopay 가용 판정·provider 'kakaopay' 제거, 시험 갱신.

### 2-4. 재지급 크레딧: 뿌리·보류·회수·경보·자료 환불 엔진
- 헬퍼(내부, ACL postgres 만, RAISE 하지 않음): `credit_source_paid_root(p_source_id)` → (root_source_id, payment_order_id, root_status, root_cash_flag[완료·열린 refund_requests 또는 처리 안 된 취소 표식], root_in_progress[열린 요청·표식·pending_refund]); `credit_source_reissued_descendants(p_root_source_id) → setof uuid`(재귀, 20단계, 순환 중단). 반환은 원천 id(주문은 credit_sources.payment_order_id).
- 새 열 `refund_requests.held_reissued_source_ids uuid[] NOT NULL DEFAULT '{}'`(ADD COLUMN IF NOT EXISTS, 표시·감사용 — 회수 판단은 완료 시점 재계산). 되돌리기에서 남김, 타입 재생성.
- **보류**(quarantine_external_provider_cancellation 의 두 분기(payapp, toss·kakaopay) 모두, quarantine_payapp_partial_cancellation, process_payapp_cancellation 실패 대체 경로): 원래 원천을 격리하는 같은 트랜잭션에서 **각 분기의 profiles FOR UPDATE 뒤**, 자손 중 active 인 것을 id 순으로 잠그고 한 문장으로 pending_refund. 안쪽 블록에서는 보류 실패를 RAISE 해 실패 대체 경로로 보낸다. 실패 대체 경로는 원래 원천 격리·요청 생성을 먼저 하고, 자손 보류는 하위 BEGIN…EXCEPTION 블록에서 한다 — 그 블록이 실패하면 원래 원천 격리는 유지하고 critical 경보 `REISSUED_CREDIT_HOLD_FAILED`(회수는 수동 완료의 재계산이 맡음). 경보(`REISSUED_CREDIT_HELD`·`REISSUED_CREDIT_HOLD_FAILED`, details: dedupe_key = 'refund_request:' || 요청 id(요청이 없으면 'hold:' || 주문 id || ':' || 시각), 주문은 order_payment_order_id·가맹점 주문번호 order_id 키, 자손별 initial/remaining/만료/보류 — payment_order_id·mul_no 키를 넣지 않음(유일 인덱스 COALESCE 순서·resolve_payment_order_review 일괄 해소 때문 — 결제번호가 필요하면 order_mul_no 같은 다른 이름); 같은 결제 두 번째 보류는 경보 2건)는 예외를 삼키고 실패 시 별도 경보.
- **회수**(complete_manual_point_charge_refund): 완료 시점에 profiles 잠금 뒤 자손을 **다시 계산**(active·pending_refund 모두), id 순 잠금.
  - '쓸 수 있는 몫' = `status IN ('active','pending_refund') AND (expires_at IS NULL OR expires_at > now())` 인 원천의 remaining. 만료 정리 대상 = `expires_at IS NOT NULL AND expires_at <= now()` — 0 으로 정리하되 회수량과 따로 기록.
  - 전액 모드: 원래 + 자손의 쓸 수 있는 몫 전부 회수, 모두 refunded. p_recovered_credits 는 NULL 이거나 그 합과 같아야 함(옛 관리자 화면은 전액 모드에서 값을 안 보냄 — 배포 틈 호환).
  - 부분 모드: 입력 회수량을 expires_at ASC(NULL 맨 뒤, consume 순서)로 원래·자손에서 차감, 상한 = 쓸 수 있는 몫 합. 끝 상태: **원래 원천은 원래 + 자손 remaining 합(만료 정리 뒤)이 0 일 때만 refunded, 아니면 remaining 이 0 이어도 active**(이후 오는 승인취소·부분취소가 지금 경로를 그대로 타도록 — 운영에도 active·remaining 0 결제 원천이 있음). 자손은 각자 remaining > 0 이면 active, 0 이면 refunded. 주문 refunded/completed 는 같은 합으로.
  - recovered_credits·unrecovered_credits = 원천 합. **원천별 원자료**(initial, 완료 직전 remaining, 회수량, 만료 정리량, 완료 뒤 상태)를 payment_admin_actions.details.sources[] 에 남기고, credit_transactions 에는 **회수량만** 원천별 1행(type refund, resource_type refund_request, source_id 원천)으로 남긴다. 만료 정리량은 원장에 쓰지 않고 payment_admin_actions.details.sources[].expired_cleared 에만(이 표는 추가 전용 트리거가 있어 증빙으로 충분; credit_transactions type CHECK 에 expire 없음 — 바꾸지 않음). 다음 완료는 이 관리 기록을 읽어 앞선 회수·만료 정리를 안다.
  - 모드: 앞선 부분취소 표식이 있는 결제(complete_manual 의 v_partial 판정)는 부분 모드만 가능 — 전액을 회수하려면 쓸 수 있는 몫 합 전체를 입력(미리보기가 모드와 이 값을 표시). 그리고 Σ(이 주문의 completed refund_amount) + p_refund_amount ≤ expected_amount 가 아니면 MANUAL_REFUND_INPUT_INVALID(같은 결제 여러 번 완료의 입력 실수 방지), 미리보기에 '남은 환불 가능 금액'.
  - '이미 쓴 몫'·권장 회수량은 **자동 계산하지 않는다**(0-10). 자손이 하나 이상 있는 결제를 완료하면 `REISSUED_CREDIT_SETTLE_REVIEW` 경보(details: dedupe_key = 'refund_request:' || 요청 id — 완료마다 1건, 주문 id 는 order_payment_order_id 키로, 원천별 원자료)를 남기고, 대표가 런북 3으로 판단한다. 판단 근거(미리보기·화면이 원천별 원값으로 보임, 계산값 없음): 소비 총량(credit_consumption, 복구·재지급 전 값 — credit_transactions 는 사용을 원천 없이 합계로만 남기므로 쓰지 않음), 자료 환불 복구(allocated_items.restored, source_id=이 원천), 재지급으로 넘긴 양(allocated_items.reissued, source_id=이 원천 = 자식 원천 initial), 순사용(initial−remaining, 복구 반영), 앞선 회수·만료 정리(payment_admin_actions.details.sources[]). 화면에 '소비 총량을 사슬 전체로 더하면 재지급분이 두 번 들어감' 안내.
  - 격리 함수 3곳의 관리자 알림 '사용 크레딧'과 반환값 used_credit_amount 는 A 기준(initial−remaining) 그대로. 자손이 있으면 [9번] 블록에서 **별도 관리자 알림 1건**('다시 지급한 크레딧이 있어 결제 기준 사용량과 다름 — 수동 완료 화면에서 원천별 확인')을 추가한다(기존 format 은 고치지 않음). TS 는 이 값을 대표 판단에 쓰지 않는다.
- **이미 환불한 금액·회수한 크레딧의 정의**(런북 2·8절 계산): 이미 환불한 금액 = 그 payment_order_id 의 refund_requests 중 status='completed' 인 refund_amount 합(열린·거절 요청은 결제 전액이 임시로 들어 있으므로 뺌). 회수한 크레딧 = 그 주문의 payment_admin_actions(action='manual_refund_completed').recovered_credits 합 + 회원 신청 완료(finalize)로 0 이 된 initial. 분모가 0 이하이면 계산하지 않고 대표 판단.
- **자료 환불 엔진**(market_refund_allocate ⓪): 소비 원천이 system_refund 면 뿌리의 root_cash_flag·root_status 도 보고 해당하면 NEEDS_OWNER, root_in_progress 면 in_progress=true(대표 정산이 CANCEL_IN_PROGRESS 로 멈춤).
- **두 번 세지 않음**(런북 계산): 유료 미사용 = 뿌리가 같은 원천 중 status IN ('active','pending_refund') AND (expires_at IS NULL OR expires_at > 기준) 의 remaining 합(보류 여부와 관계없이 같은 값, refunded 는 뺌).

### 2-5. VERIFY
설정 키 모양·refundDays 7·자리표시·필수 키, 정책, 함수 ACL(새 정의자 함수 service_role 만, 내부 함수 postgres 만, 공개 실행 가능 정의자 함수는 handle_new_user 뿐), 표 가드·RLS·권한, 새 열, 재정의 새 md5, 그대로 함수 md5, 마감식 예(2026-11-23 23:30 KST 결제 → 2026-12-01 00:00 KST).

### 2-6. 되돌리기(둘로 나눔)
- (가) 돈 경로 down: 표의 '가' 5개를 원래 정의로(DOWN_VERIFY md5). 사전 조건: 보류 중 자손 0, manual_review 요청 0. '부분 완료 끝 상태(A active·주문 completed·같은 뿌리 자손 remaining>0)' 건수를 조회해 근거에 적고, 있으면 (가) 기간 감시 목록. 코드 배포 뒤에 실행하면 **재적용 전까지 수동 완료를 하지 않는다**(런북, 유일한 보호 — 새 화면의 전액 모드는 옛 함수에서 자손이 있으면 멈추지만 부분 모드는 통과하므로). 재적용 직후 점검 쿼리: '주문 refunded 또는 A refunded 인데 같은 뿌리의 자손 중 status IN (active, pending_refund) AND remaining > 0', '(가) 기간 동안 자손에서 consume 된 거래' — 있으면 REISSUED_CREDIT_SETTLE_REVIEW 로 대표 판단.
- (나) 판정·동의 down: 판정 함수를 원래로, 동의 함수 제거(동의 기록이 1건이라도 있으면 함수·표는 남기고 멈춤). **코드 배포 전에만**(배포 뒤라면 코드를 먼저 되돌림, 단 ④ 뒤에는 코드를 되돌리지 않음 — 앞으로 고침).
- (나)는 get_manual_refund_recovery_preview 도 DROP(배포 전이므로 호출자 없음). 헬퍼 4개(credit_source_paid_root, credit_source_reissued_descendants, point_charge_refund_days, point_charge_refund_deadline)·설정·표·열·정책은 남김. 재적용은 IF NOT EXISTS·ON CONFLICT DO NOTHING·사전 md5 원래/새 둘 다 허용, 정책·트리거는 DROP … IF EXISTS 뒤 CREATE, CHECK 제약은 DROP CONSTRAINT IF EXISTS 뒤 ADD(8번 방식). 리허설: (가)·(나) 각각 down → 재적용.

### 2-7. 운영 순서 상세
① 적용 시각 기록 → DB 적용 → 로컬 확인(Claude 가 브라우저로, 결제 버튼은 누르지 않음; 대표의 localhost 확인 뒤 push 규칙은 2026-11-23 대표 지시 '확인 없이 진행'으로 이번 묶음은 면제 — 틈을 짧게 하려고 확인 즉시 진행) → ② 타입 재생성·push·배포(배포 시각 기록; 그 사이 크레딧 화면 마감 날짜가 하루 늦게 보임, 출시 전이라 허용) → ③ VERIFY + 'created_at ≥ 적용 시각인 payapp 주문 중 (user_id, checkout_attempt_id) 동의 행 없는 것' 조회(payment_orders → checkout_attempts → acks) 결과를 계획 근거에 기록 → ④ 스크립트 → ⑤ 8번 B. 적용~배포 사이 관리자 요금제 문구·약관 저장, 수동 환불 완료, 자료 환불 대표 정산 금지(8번 방식). ③ 점검 범위는 적용 시각 이후 전체.

## 3. 코드
- `point-charge-policy.ts`: 상수 `POINT_CHARGE_REFUND_DAYS` 제거, 설정 해석·저장 검사·채우기·지문, 캐시(태그)·돈 경로는 캐시 없이. 충전 환불 경로 코드에 '7일' 글자 없음(계약 시험): `knownRefundRpcMessages` 기간 문구를 숫자 없이, `REFUND_POLICY_UNAVAILABLE`·`REFUND_REISSUED_SOURCE` 매핑 추가.
- 결제 화면: 결제 전 확인·미성년자 안내를 **모든 폭에서 동의 체크 바로 위**(order-last 제거 또는 aside 안), 그다음 체크·결제 버튼. 취소·환불정책 전문 링크 유지(동의 문구 안 정책 이름은 코드가 링크로 감쌈), '(필수)' 표기는 코드 한 곳에서만. 요청에 `acknowledgeCheckoutNotice`·`noticeSha256`·`expectedAmount`·`expectedCredits`. 설정 못 읽으면 결제 버튼 막고 안내.
- 크레딧 화면: 구매일도 한국 시간 날짜, 원천별 판정 예외를 잡아 '확인하지 못했습니다'(잔액·내역 그대로), 환불 마감 `formatMarketRefundLastDay`, 만료 칸과 '다음 사용기한' 모두 한국 시간 'YYYY.MM.DD HH:mm까지', DB 문구(키별 대체), 재지급 표시는 서버가 서비스 키로 재지급 연결을 조회한 원천만. 신청 API 는 문구를 못 읽어도 막지 않음. 크레딧 화면 서버·결제 내역 서버·신청 API 는 판정 반환 `policy_fallback=true`(거절 사유가 PERIOD_EXPIRED 여도)를, 결제 화면 서버는 필수 키 실패를 만나면 `record_payment_alert('POINT_CHARGE_POLICY_UNAVAILABLE')`(최선 노력, details 에 payment_order_id·user_id·source_id·attempted_at — 주문별로 쌓여 장애 중 시도 시각 증빙). 대체 판정으로 신청·거절된 것 모두 경보(런북 4: 경보가 있는 기간에 PERIOD_EXPIRED 로 거절된 신청은 현재 약관 일수로 다시 판단; 경보 시각이 첫 화면 조회 시각일 수 있으며, 회원에게 유리하게 그 시각을 신청 시각으로 본다 — 런북 4). 옛 /legacy 크레딧 화면은 꺼짐 유지(켜려면 같은 규칙).
- 충전 화면 `{환불기간}` = DB refundDays(못 읽으면 그 줄 생략).
- 결제 내역(`/mypage/payments`) 상세에 이 결제에 동의한 안내(notice_text)와 환불 마감 'N월 N일(한국 시간)까지'(본인 것만, 서버 서비스 키; **마감은 TS 로 계산하지 않고 그 주문 원천에 대한 get_point_charge_refund_eligibility 의 refundable_until 을 그대로** — 크레딧 화면과 같은 값, 원천이 아직 없거나 refundable_until 이 NULL 이면 마감 칸 대신 취소·환불정책 링크, 판정 RPC 실패는 주문별로 잡아 마감 칸만 '확인할 수 없음'(동의 안내·결제 기록은 그대로); 지급 일시가 결제 일시와 다르면 '크레딧 지급 일시'도 표시; 동의 행은 payment_orders.checkout_attempt_id → checkout_attempts.id → (user_id, checkout_attempt_id) → acks 로 찾음 — payment_orders.checkout_attempt_id 는 내부 PK 라 acks 와 바로 잇지 않음) — 계약내용 교부(전자상거래법 13조2항). 결제(승인) 일시도 한국 시간으로. 동의 행이 없는 결제(9번 이전·①~② 사이)는 동의 안내 칸 대신 '이 결제는 결제 전 확인 기록 이전 결제입니다 — 기준은 취소·환불정책' 고정 안내와 마감만(지금 설정 문구를 동의 문구로 보여 주지 않음).
- 관리자 요금제 화면: 새 문구 칸(필수 표시), 저장 = 원본 jsonb 위에 문구 키만 + `.eq('value->>version', 폼을 열 때 값)`·`.eq('value->>refundDays', 현재값)`, 저장할 때 version+1(맞지 않으면 '다른 곳에서 바뀌었습니다 — 새로고침'), 작업 기록(action `point_charge_policy_update`)에 바뀐 키·새 지문, 권한 설명에 '결제 고지 문구 포함'.
- 관리자 수동 완료 화면·목록 API: `get_manual_refund_recovery_preview` 로 원래 + 자손(사슬 전체) 원천별 원자료(initial·남은·쓸 수 있는 몫·만료·Σ사용(credit_consumption)·Σ자료 환불 복구)와 이 결제의 앞선 수동 완료 기록, 부분취소 금액(payment_provider_transactions), 처리 모드, 남은 환불 가능 금액, 상한을 받아 표시(계산값 없음). 부분 회수 입력 상한 = 쓸 수 있는 몫 합. 전액 모드도 화면이 미리보기에서 받은 쓸 수 있는 몫 합을 recoveredCredits 로 보내고 API 는 다시 계산하지 않고 넘김(달라지면 MANUAL_REFUND_RECOVERY_INVALID → 새로고침 안내).
- 약관 화면 대체 섹션 제거, `footer-content.ts` 기본값 교체.
- 기존 시험 갱신: point-charge-policy-contract, point-charge-compliance-ui-contract, pricing-refund-summary, checkout-payment-methods-contract, kakaopay-checkout-contract, 외 구현 때 깨지는 것(point-charge-policy-contract 65-67행의 20261119100000 seed 단언은 ④ 스크립트 파일 대조로 바꿈 — seed 는 이력으로 두고 고치지 않음). 계약 시험: revoke_admin_credits 가 재지급 연결 원천을 거절, 충전 화면 문구에 옛 기한 표현 없음, 결제 내역 서버가 checkout_attempts 를 거쳐 동의 행을 찾고 마감은 판정 함수 값을 씀. 작업 기록 action 키 추가(point_charge_policy_update, point_charge_source_hold, point_charge_source_release; ④ 는 6번과 같은 키). 보류·해제 템플릿은 저장소 파일(`supabase/scripts/bundle9_point_charge_hold.sql`, `…_release.sql`)로 커밋하고, admin-audit-log-contract 에 스크립트 출처(SCRIPT_ACTIONS)를 더해 'src ∪ 마이그레이션 ∪ 스크립트 = 목록'으로. 새 9번 계약 시험(지문 TS=SQL, 라우트 순서, 카카오페이 차단, **충전 환불 마감은 TS 로 계산하지 않음 — 크레딧 화면·결제 내역 서버가 refundable_until 만 씀**, 재정의 함수 = 원래 + [9번] 블록).

## 4. 약관·충전 화면 스크립트(6번 방식, 배포 뒤) — 저장소 `supabase/scripts/20261124_bundle9_policy_text.sql` 로 커밋(적용 이력과 분리, 시험이 교체문을 문구 초안과 대조)
- 사전 md5(refundPolicy·serviceTerms·privacyPolicy), FOR UPDATE, 바꿀 문장이 정확히 1번씩 있는지 확인, 교체, 사본 +2(refundPolicy·serviceTerms, privacyPolicy md5 그대로), `record_admin_audit`.
- 교체: 환불정책 '포인트 충전 심사 필수 안내' 첫 줄·넷째 줄, 2절③ '결제일로부터 1년' 문장, 3절① '구매 후 7일 이내…' 문장, 8절에 환산식 한 문장('남은 유료 크레딧 × (결제 금액 − 이미 환불한 금액) ÷ (지급 크레딧 − 회수한 크레딧), 1원 미만 버림, 재지급분은 원래 충전분으로'); 이용약관 '크레딧 이용조건' 첫 문장, 13조에 '환불 금액 계산은 취소·환불정책 8절' 연결. VERIFY: refundPolicy·serviceTerms·pricing_page_content 에 '1년 이내'·'결제시점으로부터'·'결제일로부터'·'구매 후 7일 이내'·'구매 후 {환불기간}일' 0건, 약관 충전 환불 일수(3절①, 심사 안내 첫·넷째 줄, 이용약관 크레딧 이용조건) = refundDays.
- 함께 넣는 문장: 환불정책 3절④ 끝 '표시·광고나 계약 내용과 다르게 제공된 경우에는 제공받은 날부터 3개월, 그 사실을 안 날(또는 알 수 있었던 날)부터 30일 안에 취소할 수 있습니다.', 5절 '회사 사정으로 환급이 늦어지면 관련 법령에 따른 지연배상금을 지급합니다.'
- 근거 기록: 페이앱 심사가 옛 '1년 이내' 문구를 요구하는지 확인 내용(페이앱 설정은 건드리지 않음) — 새 첫 줄 끝에 범위 문장 '충전한 크레딧의 이용기간과 단순 변심에 따른 환불 신청 기간은 모두 결제한 때부터 1년을 넘지 않습니다(자료 환불로 다시 받은 크레딧의 이용기간은 3-2절 ⑥, 결제 오류·표시와 다른 제공·미성년자·서비스 종료는 3절④·7절·8절).'를 덧붙여 상한 표현을 남긴다. VERIFY: '1년을 넘지 않습니다' 문장이 이 범위 문장으로만 1번, 범위 문장이 가리키는 '3-2. 문제마켓 자료 환불' ⑥ 이 본문에 있고 그 ⑥ 에 다시 지급한 크레딧의 유효기간 문장이 있음. **④와 ⑤ 는 한 트랜잭션(한 스크립트)으로 묶는다** — 3-2절 참조가 없는 판이 생기지 않고, ⑤ 가 실패하면 ④ 도 함께 롤백된다. 3-2절 ⑥ 존재·유효기간 문장 확인과 '5절 ⑥' 문자열 0건 확인은 이 묶음 스크립트 끝 VERIFY 에서 한다.
- 출시 전 오기 정정으로 기록(기존 결제 payapp completed 4·toss 1 이 대표·시험 결제인지 확인해 근거에 적음).
- ④·⑤ 실행 전부터 VERIFY 끝까지 사이트 기본 정보·요금제 문구 화면 저장 금지(열린 화면은 닫고 다시 연다). ⑤ 스크립트 끝에 ④ VERIFY 를 다시 돈다.
- `pricing_page_content`(사본 트리거 없음 → 바꾸기 전·뒤 값을 record_admin_audit details 에, FOR UPDATE, 바꿀 원문이 정확히 1번씩 있는지 확인): notice_items[0].body·notice_items[1].body·refund_items[1]·refund_items[3번째]·refund_items[5]·summary_note 를 결제 전 확인과 같은 뜻으로(문구 초안 D). 충전 화면 문구의 기준은 ④ 교체문(문구 초안 D) — `pricing-page-content.ts` 에는 문구 기본값이 없음.
- 8번 초안 B 저장 스크립트는 이 스크립트 뒤 본문 md5 로 다시 만든다.

## 5. 검증
- 계획: 결제 3명 + 법률 1명, PASS 까지.
- 리허설(운영 BEGIN…ROLLBACK): 마감 경계(23:59:59 KST 허용·다음 날 00:00 거절, TimeZone 두 가지), 신청 뒤 기간 지나도 claim·finalize 성공, 설정 깨짐 → 다른 사유 우선·기간 자리 UNAVAILABLE, 재지급 원천 사유, 동의 기록(정상·문구 바뀜·같은 attempt 재요청·다른 plan·금액 바뀜·요금제 비활성·지문 TS=SQL), 주문 있는 attempt 재요청 → 기록 건너뜀, 뿌리(사슬 2단계·순환·끊김), 보류(외부 취소 두 분기·부분취소·실패 대체 경로 각각, 실패 대체 경로 강제 + 그 안 자손 보류도 실패 → 원래는 격리·HOLD_FAILED 경보), 보류 누락 active 자손이 있는 상태의 수동 완료, 전액·부분 회수(원래 만료 잔량 + 자손 유효 잔량, 부분 뒤 자손 active·consume 가능, 원래 0·자손 잔량 남음 → 원래 active 유지 → 이어서 승인취소 통보 → 자손 보류·수동 완료로 회수, 같은 상태에서 부분취소 재통보 → absorbed 아님), 같은 결제 두 번 수동 완료(부분 → 승인취소 → 전액) 원천별 원자료·앞선 기록 표시, 만료일 없는 자손, 경보 code·완료마다 1건, 수동 완료 미리보기 = 수동 완료 결과, 지급이 늦은 결제(paid_confirmed 를 5일 전 p_paid_at 으로) → 판정·크레딧 화면·결제 내역 마감 모두 지급일 기준(VERIFY 예: approved_at 2026-11-01 10:00 KST, 원천 created_at 2026-11-05 → 2026-11-13 00:00 KST), 열린 요청만 있는 결제의 런북 2 '이미 환불한 금액' = 0, 보류 뒤 유료 미사용 = 보류 전, 템플릿 요청 → 수동 완료 전액에서 자손까지 회수, 뿌리 격리 중 부분 승인·예외 환불 경로, 보류(요청 생성 포함)·해제 템플릿, (가) 상태 + 자손 있는 결제: 전액 모드 새 화면 값 → MANUAL_REFUND_RECOVERY_INVALID 로 멈춤 / 부분 모드 → 통과(그래서 (가) 기간 수동 완료 금지), 템플릿 보류 → 관리자 거절 시도 → 막힘, 템플릿 보류 → 해제 → 원래·자손 active·요청 닫힘·잔액 그대로, 만료 잔량 있는 원천의 수동 완료 성공·만료 정리는 관리 기록에만, 앞선 부분취소 결제는 부분 모드만·환불액 합 초과 거절, 설정 깨짐 → 7일 안은 허용(동의 행 refund_days 또는 7)·모든 반환에 대체 refundable_until·policy_fallback·PostgREST(service_role rpc)로 호출해도 오류 없음, 동의 refund_days > 현재 설정 → 동의 값 기준, 해제 템플릿: 보류 중 승인취소 통보가 오면 해제 막힘·열린 회원 요청이 있는 결제는 그 요청을 manual_review·external_cancel 로 바꿔 보류(processing 이면 멈춤), 자료 환불 복구 1건 + 재지급 1건이 있는 결제의 미리보기 원천별 값 = 직접 조회값, 같은 결제 두 번째 보류 → 경보 2건, acks 의 refund_policy_sha256 = 그 시각 최신 사본, 결제창 재사용 attempt 에 동의 없음 → 새 attempt, refundDays 6 → UNAVAILABLE, 뿌리 격리 중 재지급분 자료 환불 → NEEDS_OWNER·in_progress → 대표 정산 CANCEL_IN_PROGRESS, 두 세션 경합(settle 이 새 자손 만드는 동안 격리), 유료 미사용 계산(만료 잔량 제외), 되돌리기 (가)·(나) 각각 → 재적용(관리자가 문구를 저장해 version 이 오른 상태에서도 관리자 수정 문구 보존), 옛 코드 + 새 DB·새 코드 + 옛 DB.
- 구현: 같은 4명 + 브라우저(375px·1280px 에서 고지 → 체크 → 버튼 순서, 결제 직전까지만 — 실결제 금지).

## 6. 문구(`docs/bundle9-copy-draft.md`) — 대표 지시로 초안대로 진행, 검증 지적 반영
결제 전 확인 5항목(지급 크레딧·가격·1회 충전·결제 즉시 지급 / 결제한 때부터 1년·지나면 못 씀 / 취소 기간·조건·방법(크레딧 화면 또는 고객센터)·효과·3영업일·휴대폰 결제 계좌 단서 / 하나라도 쓰면 단순 변심 취소 불가·차감 순서 / 결제 오류·서비스 종료 별도 기준), 미성년자 안내(예외 요지), 동의 체크('위' 없이), 크레딧 화면 문구, '1년' 교체문(시각 기준), ⑥ 수정문(취소·환불된 금액만큼 함께 회수, 이미 쓴 몫은 알리고 정산·미성년자는 7절), 런북 4개(사용 보류 수단: PG 로 취소할 수 있으면 '접수 즉시 페이앱 콘솔 전취소'가 보류(취소 통보 → 격리가 원래·자손을 묶음), 그 사이 쓴 몫은 경보·대표 판단 / PG 불가면 대표 승인 SQL 템플릿(보류(요청 생성 포함)·해제 템플릿) — 5절 리허설에 포함; 미성년자 — PG 불가 분기, 서비스 종료 — 부분취소 반영 환산식, 재지급 취소 경보, 고객센터로 접수된 충전 철회 — 접수 시각 기준·장애 중 시도 시각, 휴대폰 당월 경과 계좌 환불·계좌 정보 파기).
