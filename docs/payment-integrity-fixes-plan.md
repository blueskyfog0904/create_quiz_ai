# 결제·크레딧 정합성 수정 계획 (출시 전 일괄 수정)

작성: 2026-11-10. 근거: 결제 정합성 점검 결과(scratchpad `payment-findings.json`, 21건, 중복 정리 후 17묶음)와 같은 날 운영 DB에서 읽은 함수 정의(`pg_get_functiondef`)·제약·인덱스·건수.
이 문서는 계획만 담는다. 코드·마이그레이션·DB는 아직 바꾸지 않았다.

---

## 1. 개요

### 1.1 목표
페이앱 신규 결제를 열기 전에, 점검에서 확인된 문제를 모두 고친다. 고친 뒤에는 아래 상황에서도 돈(PG 결제·취소), 크레딧(원천·원장·잔액 캐시), 주문 상태, 환불 요청 상태가 서로 어긋나지 않아야 한다. 어긋날 수밖에 없는 경우에는 지워지지 않는 기록(경보 행)이 남아야 한다.
- 단계 사이의 프로세스 중단(Vercel 함수 종료·시간 초과)
- 페이앱 재통보, 관리자 재클릭, 응답 유실 뒤 재시도
- 같은 주문·사용자에 대한 동시 처리(통보·대사·관리자)
- 장애 구간 동안의 통보 유실

### 1.2 범위(묶음과 원 지적 id)
| 절 | 묶음 | 원 지적 |
|---|---|---|
| 2.1 | 취소 통보 유실 탐지 | 결제 PAY-1, 환불 REF-4 |
| 2.2 | 경보 중복 제거 키 | 결제 PAY-2, 대사 REC-1(B) |
| 2.3 | 취소 후속 경보를 DB 트랜잭션 안으로, 승인취소 뒤 전액 회수 강제 | 대사 REC-1(A) |
| 2.4 | 인증 실패 통보 경보가 출시 스위치를 막음 | 결제 PAY-3 |
| 2.5 | refund_credits 원천 상태 무시·원장 불일치 | 환불 REF-1, DB CREDIT-2 |
| 2.6 | 마켓 환불 승인 비원자성 | 환불 REF-2, DB "PAY-1" |
| 2.7 | 계좌이체 이중환불 감지 순서 의존 | 환불 REF-3 |
| 2.8 | 관리자 결제확인 mul_no로 자동 paycancel | 환불 REF-5 |
| 2.9 | 부분취소 뒤 승인취소 price | 환불 REF-6 (페이앱 동작 미확인) |
| 2.10 | ready 취소 응답 유실 → 판매 정지 오탐 | 대사 REC-2 (페이앱 동작 미확인) |
| 2.11 | payment_orders updated_at 트리거가 카카오 stale 감지 무력화 | 대사 REC-3 |
| 2.12 | 'running'으로 남는 대사 run | 대사 REC-4 |
| 2.13 | health 페이앱 경보가 한 코드만 남김 | 대사 REC-5 |
| 2.14 | 크레딧 RPC 커밋 뒤 TS 후처리 실패·경합 | DB CREDIT-1, CREDIT-3 |
| 2.15 | 관리자 크레딧 지급 비원자·비멱등 | DB CREDIT-4 |
| 2.16 | 원장 CHECK 제약 부재 | DB DB-1 |
| 2.17 | 레거시 함수 `*_credits_once` | DB DB-2 |

### 1.3 바꾸지 않는 것
- 페이앱 설정(공용 계정), 페이앱 API 호출 방식(payrequest·paycancel), 결제창 흐름.
- 결제 지급 경로(`apply_payapp_feedback`의 4 처리, `payapp_fulfill_order_internal`, `retry_payapp_fulfillment`), 사용자 환불 신청·자격(`get_point_charge_refund_eligibility`), `finalize_point_charge_refund`, 격리 함수(`quarantine_*`).
- 카카오페이는 계속 꺼 둔다. 2.11은 카카오를 다시 켤 때를 위한 수정이고 현재 동작에 영향이 없다.
- 판매 차단(health)의 조건 자체(무엇이 판매를 끄는지)는 바꾸지 않는다. 경보 기록 방식만 바꾼다. 새로 추가하는 통보 미처리 점검(2.1)은 경보만 남기고 판매를 끄지 않는다.
- `resolve_payment_order_review`, `resolve_payment_alert`, 관리자 경보 화면 구조.
- 현재 미해소 경보 1건(PAYAPP_FEEDBACK_ORDER_NOT_FOUND, 2026-11-01, 사이트 밖 결제 통보)은 마이그레이션으로 지우지 않는다. 감사 기록을 남기도록 관리자 화면의 해소 기능(`resolve_payment_alert`)으로 해소한다(6.5).

### 1.4 운영 DB 현황(2026-11-10 조회, 읽기 전용)
- 페이앱 주문 0건, 전체 결제 주문 12건, `payapp_accepts_new_orders=false`, launch switch 미적용(`schema_migrations` 최신 20261021100000).
- `payment_reconciliation_alerts` 4행, 미해소 1행(위 ORDER_NOT_FOUND, details에 mul_no 있음·payment_order_id 없음).
- `payment_reconciliation_runs` 23,765행 중 status='running' 82행(마지막 2026-09-14, 리스 유효 0행). 스케줄러 lease_owner NULL, consecutive_failures 0.
- `payment_webhook_events` 6행, 모두 `payapp:%`·ignored(order_not_found).
- 원장 위반 0건: credit_sources 36행(initial≤0 0, remaining 범위 위반 0), credit_consumption 332행(amount≤0 0), profiles 14행(credits<0 0), payment_history 36행(0~100000 위반 0).
- market_refund_requests 2행: approved 1(주문·라인·이용권 모두 refunded로 일관), pending 1(주문일 2026-10-10이라 TS 7일 기준에 이미 걸림, 6.3).
- `market_purchase_orders.credit_consumptions`(jsonb 배열) 19행: 키가 `source_id`인 행 11, `sourceId`인 행 8로 섞여 있다. `market_purchases` 0행. TS `parseCreditConsumptions`는 두 키를 모두 읽는다(`market-refunds.ts:89-90`).
- `refund_requests` 3행, 모두 `payment_order_id` NULL(열이 NULL 허용, 옛 PG 시절 요청).
- `market_download_events.order_id`·`user_id`는 각각 `market_purchase_orders`·`profiles`를 참조하는 FK다. 다운로드 기록 insert는 두 행에 FOR KEY SHARE를 잡으므로 FOR UPDATE와 충돌한다(2.6).
- `*_credits_once`를 참조하는 DB 함수 0개, pg_depend 0건, src 호출 0곳(타입만).
- 재정의 대상 9개 함수(1.4 표의 앞 9개) 모두 `prosecdef = true`, `proconfig = {search_path=public, pg_temp}`, ACL `{postgres=X, service_role=X}`.
- 서버 버전 17.11.

수정 대상 함수의 현재 정의 md5(`md5(pg_get_functiondef(oid))`, 2026-11-10). 마이그레이션 사전 점검이 이 값과 다르면 멈춘다(2.0).

| 함수 | md5 |
|---|---|
| record_payment_alert | be5eb4fe912513bce4f4dda7a66a496d |
| enforce_payment_reconciliation_health | b1adcbe8f84f614c50f3b9c6c293ca9f |
| process_payapp_cancellation | eb135744b95c98b16890d3e246edb103 |
| complete_manual_point_charge_refund | 4e3d86acac2eaef79368c240aeb4098b |
| apply_payapp_feedback | 353409f7be9226b15837c12eadddcc98 |
| claim_point_charge_refund | 4a0a7159ef4fe27003040202ae7d9aa8 |
| start_payment_reconciliation_run | f82adabcf0fee73eef041d730e6add67 |
| claim_payment_reconciliation_batch | e8179468999a3dae7115ad9a356e5012 |
| refund_credits | 6a082ed597597efdbb688225076a3996 |
| consume_credits_once | 5bba3e44100b1eb403da9210b87ad53e |
| refund_credits_once | 5a7af4fbce9ef158d411b505cd419e6d |

---

## 2. 항목별 설계

### 2.0 공통 원칙
- 함수는 운영 정의(`pg_get_functiondef`)를 그대로 복사한 뒤 필요한 줄만 바꾼다(`CREATE OR REPLACE`, 인자·반환형 그대로). ACL은 `CREATE OR REPLACE`가 유지한다(현재 모두 `postgres`, `service_role`만 EXECUTE).
- `CREATE OR REPLACE`는 본문에 적지 않은 `SECURITY DEFINER`·`SET search_path`를 지운다. 재정의 9개와 새 함수 2개(`approve_market_refund`, `grant_admin_credits`)는 모두 `SECURITY DEFINER`와 `SET search_path TO 'public', 'pg_temp'`를 명시한다(트리거 함수 `payment_orders_touch_updated_at`만 SECURITY INVOKER). 계약 테스트(5.1)와 리허설(6.1, `prosecdef`·`proconfig`·`proacl` 조회)로 확인한다.
- 새 함수는 `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`을 명시한다(Supabase 기본 권한이 anon·authenticated에 EXECUTE를 주므로). 트리거 함수 `payment_orders_touch_updated_at`도 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`는 똑같이 하고 GRANT는 하지 않는다(3.3-2).
- 마이그레이션 첫 DO 블록에서 위 md5를 비교하고, 다르면 `RAISE EXCEPTION 'PAYMENT_INTEGRITY_PRECHECK: <함수> definition drifted'`로 멈춘다.
- DB 안에서 쓰는 경보 문구·코드는 지금 TS(`cancellationFollowUps`)가 쓰는 것과 같게 둔다. 관리자 화면·TS 테스트가 그 코드를 기준으로 한다.

### 2.1 취소 통보 유실 탐지 (결제 PAY-1, 환불 REF-4)

**원인**
- `src/lib/payapp-webhook-server.ts:353-362`: 이벤트 insert가 23505가 아닌 오류로 실패하면 행·경보 없이 RETRY(503)만 돌려준다.
- `:395-399`: `apply_payapp_feedback` 오류 시 `markEvent(failed, 'APPLY:…')`와 그때까지의 날짜 경보만 남기고 RETRY한다. 실패 자체를 알리는 경보가 없다.
- 페이앱 이벤트는 `order_id NULL`로 저장되므로(`:352-360`), 운영 `claim_payment_reconciliation_batch`·`record_payment_reconciliation_result`·`payment_reconciliation_backlog_count`의 `pwe.order_id = po.order_id` 조건에 걸리지 않는다. `enforce_payment_reconciliation_health`는 webhook 이벤트를 보지 않는다.
- 결과: 재통보 10회가 끝날 때까지 apply가 실패하면 표식(`cancel_feedback_recorded_at`)이 없어 대사·health 어디에서도 다시 잡지 못한다. 지급 완료 주문이면 PG 환불 + 크레딧 active가 조용히 남는다.

**변경**
1. TS `handlePayAppFeedback` apply 오류 분기(`:395-399`)에서 `followUps.alerts`에 다음을 추가한 뒤 기존대로 `runFollowUps` → RETRY.
   - code `PAYAPP_FEEDBACK_APPLY_FAILED`, severity critical, notifyAdmins true
   - message `페이앱 통보를 기록하지 못했습니다. 재통보가 끝나도 실패하면 페이앱 관리자 내역과 대조하세요.`
   - details `{ ...eventDetails(feedback), price: feedback.price, error_code: error.code ?? null }`
2. DB `enforce_payment_reconciliation_health`에 "기록되지 않은 페이앱 통보" 점검을 추가한다(경보만, 판매는 끄지 않음).
   ```sql
   -- 이미 확인(해소)된 경보가 덮은 시각 이후만 센다. 해소하면 다시 울리지 않는다.
   SELECT MAX((details->>'latest_received_at')::timestamptz)
     INTO v_feedback_ack
     FROM public.payment_reconciliation_alerts
    WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';

   SELECT COUNT(*)::integer, MAX(received_at)
     INTO v_feedback_unprocessed_count, v_feedback_latest
     FROM public.payment_webhook_events
    WHERE transmission_id LIKE 'payapp:%'
      AND received_at <= now() - interval '30 minutes'
      AND received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
      AND (processing_status = 'pending'
           OR (processing_status = 'failed' AND COALESCE(last_error_code, '') NOT LIKE 'PROCESS:%')
           -- 2회차 검증 뒤 추가: 표식 없이 ignored로 닫힌 취소 계열 통보(2.9 안전망). 사이트 밖 통보는 뺀다.
           OR (processing_status = 'ignored'
               AND event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')
               AND COALESCE(last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'));

   IF v_feedback_unprocessed_count > 0 THEN
     INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
     VALUES ('PAYAPP_FEEDBACK_UNPROCESSED', 'critical',
             '30분 넘게 처리되지 않은 페이앱 통보가 있습니다. 페이앱 관리자 내역과 대조하세요.',
             jsonb_build_object('count', v_feedback_unprocessed_count, 'latest_received_at', v_feedback_latest))
     ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
   END IF;
   ```
   - `PROCESS:` 실패는 표식이 이미 커밋된 경우라 기존 health의 취소 미처리 점검과 대사가 다룬다. 그래서 뺀다.
   - pending·failed 부분은 기존 부분 인덱스 `payment_webhook_events_pending_idx (processing_status, received_at) WHERE processing_status IN ('pending','failed')`를 탄다. ignored 취소 부분은 카페 통보(대부분 ignored)가 쌓여도 전체를 훑지 않도록 새 부분 인덱스 `payment_webhook_events_ignored_cancel_idx ON public.payment_webhook_events (received_at) WHERE processing_status = 'ignored' AND event_type IN ('PAYAPP_PAY_STATE_9','PAYAPP_PAY_STATE_64','PAYAPP_PAY_STATE_70','PAYAPP_PAY_STATE_71')`를 만든다(3.3 3단계). 실제 질의는 두 부분을 `UNION ALL`로 나눠 각 인덱스를 타게 쓴다(위 식은 의미 표현).
   - ignored 취소 조건을 넣은 이유(2회차 환불 검증 차단 2): TS ignored 분기(`payapp-webhook-server.ts:446-463`)는 `markEvent(…, 'ignored')`를 먼저 하고 그 뒤 `runFollowUps`로 경보를 남긴다. `runFollowUps`는 경보 오류를 `catch {}`로 삼킨다(`:125-127`). 그래서 경보 insert가 실패하거나 두 호출 사이에 함수가 끝나면, 재통보는 `:373-375`에서 ignored를 보고 바로 SUCCESS가 되어 "PG 환불·크레딧 active·경보 없음"이 남는다. 이 조건으로 health가 30분 뒤 반드시 잡는다. `apply_payapp_feedback` 안에서 경보를 남기는 방식(검증 제안 (a))은 고르지 않았다. 취소 계열 `order_not_found`(70·71에 `orig_mul_no`·var1이 모두 없는 경우)는 주문을 못 찾은 경로라 그 방식으로는 잡히지 않고, 이 조건은 두 경우를 함께 잡는다.
   - 현재 운영 페이앱 이벤트 6행은 모두 `PAYAPP_PAY_STATE_4`·ignored(`order_not_found`)다(2026-11-10 조회). 그래서 마이그레이션 직후 health가 새 `PAYAPP_FEEDBACK_UNPROCESSED`를 만들지 않고, 출시 스위치 사전 점검(미해소 0건)에 영향이 없다. 리허설 (d)가 이것을 확인한다.
   - ack 질의 `MAX(latest_received_at)`는 code만 조건이라 새 부분 인덱스(미해소만)를 타지 않고 해소된 행까지 읽는다. 지금 4행이라 무시한다. 경보 행이 수천 행으로 늘면 `(code)` 일반 인덱스를 추가한다(7절 17).
3. DB 쓰기조차 실패한 구간(이벤트 행이 없음)은 DB만으로 찾을 수 없다. 장애 뒤 페이앱 판매자 관리 사이트의 취소·부분취소 내역을 DB와 대조하는 런북을 추가한다(6.6). 출시 직후 4주 동안은 주 1회 정기 대조를 한다(REF-4 권고).

**예외 상황에서의 정합성**
- 표식 경로 apply는 ppt 한 행 잠금 + UPDATE 하나라 부분 커밋이 없다. 실패하면 표식이 없고, 이제 실패 사실이 경보(1)와 health(2)에 남는다.
- 재통보가 결국 성공하면 `markEvent(completed)`가 상태를 바꾸므로 health 점검에서 빠진다. 이미 남은 APPLY_FAILED 경보는 관리자가 확인 후 해소한다.
- `PAYAPP_FEEDBACK_UNPROCESSED`를 해소하면 `latest_received_at` 이전 이벤트는 계속 pending/failed/ignored여도 다시 울리지 않는다. 해소가 곧 영구 확인이다. 그래서 해소 전에 해당 이벤트가 completed·ignored(사이트 밖)가 됐는지, 아니면 6.6 절차로 수동 apply·process했는지 확인한다(6.6, 7절 18).
- `markEvent`는 오류를 확인하지 않는다(`payapp-webhook-server.ts:79-93`). 처리는 커밋됐는데 상태 갱신만 실패하면 이벤트가 pending으로 남아 30분 뒤 거짓 UNPROCESSED 경보가 날 수 있다. 판매에는 영향이 없다. 판정 기준은 6.6에 적는다(해당 mul_no의 ppt 표식·처리 시각이 이미 있으면 오탐).
- 경보 기록 자체가 DB 장애로 실패해도(1이 실패) 이벤트 행이 pending/failed로 남아 있으면 장애 복구 뒤 health(2)가 잡는다. 이벤트 행도 없으면 3의 수동 대조로만 잡힌다(7절).

**다른 호출자 영향**
- 사이트 밖(카페) 통보도 `payapp:%`다. apply가 실패하면 똑같이 경보가 난다. 재통보로 성공하면 ignored로 닫혀 health에서 빠진다.
- 관리자 알림은 재통보마다 갈 수 있다(최대 10회). 장애 상황 한정이라 허용한다.

**이번 범위에서 넣지 않는 것**
- 이벤트 insert가 23505가 아닌 오류로 실패하거나 기존 행 조회가 실패해 RETRY하는 분기(`:362`, `:372`)에는 경보를 추가하지 않는다. 대부분 DB 장애라 경보 기록도 실패하고, 이벤트 행이 없으니 health(2)도 못 잡는다. 이 구간은 6.6 수동 대조로 다룬다(7절 1).

### 2.2 경보 중복 제거 키 (결제 PAY-2, 대사 REC-1(B))

**원인**
- 운영 인덱스 `payment_reconciliation_alerts_active_code_key UNIQUE (code) WHERE resolved_at IS NULL`, `record_payment_alert`의 `ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING`.
- 주문 A의 미해소 경보가 있으면 주문 B의 같은 code 경보 행이 생기지 않는다. A를 `resolve_payment_order_review`로 처리하면(details->>'payment_order_id' 기준 자동 해소) B는 화면에서 사라진다.

**변경**
- 인덱스 교체:
  ```sql
  DROP INDEX public.payment_reconciliation_alerts_active_code_key;
  CREATE UNIQUE INDEX payment_reconciliation_alerts_active_key
    ON public.payment_reconciliation_alerts (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', '')))
    WHERE resolved_at IS NULL;
  ```
  - 주문 경보는 (code, 주문), 주문을 모르는 통보 경보는 (code, mul_no), 주문·mul_no가 없지만 따로 세야 하는 경보는 (code, `dedupe_key`), health·인증·설정 경보처럼 셋 다 없는 경보는 지금처럼 code당 1건이다.
  - `dedupe_key`는 크레딧 복구 건너뜀(2.5, 호출마다 1행), 마켓 환불 부족분(2.6, 요청마다 1행), 주문 id가 없는 환불 요청의 이중환불 의심(2.7, 요청마다 1행), TS 크레딧 환불 RPC 실패(2.5 `CREDIT_REFUND_FAILED`, 호출마다 1행)가 쓴다. 그 밖의 TS 경보에는 넣지 않으므로 기존 TS 경보의 묶임은 그대로다.
  - 새 키는 옛 키보다 느슨하므로 현재 데이터로 생성이 실패할 수 없다.
- `ON CONFLICT (code) WHERE resolved_at IS NULL`을 쓰는 운영 함수는 `record_payment_alert`(1곳), `enforce_payment_reconciliation_health`(4곳: `KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED`, 카카오 `…_FROZEN`, 페이앱 `v_payapp_code`, `PAYAPP_CANCEL_UNPROCESSED_FROZEN`) 둘뿐이다(2026-11-10 정규식 `on\s+conflict\s*\(\s*code\s*\)` 전체 함수 본문 검색, 5곳). 5곳 모두 같은 마이그레이션에서 대상 식을 `ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL`로 바꾼다. 옛 대상은 새 인덱스와 추론이 맞지 않아 오류가 나므로 같은 트랜잭션에서 함께 바꿔야 한다.
- health의 경보 INSERT는 운영 정의상 5곳이다. 위 ON CONFLICT 4곳 말고 카카오 첫 블록에 `INSERT … SELECT … WHERE NOT EXISTS (같은 code의 미해소 행)` 1곳이 더 있다. 이 문장은 ON CONFLICT가 없고, 새 인덱스에서도 details에 세 키가 없어 키가 ''라 호환되므로 **변경하지 않는다**(3회차 마이그레이션 검증 권고, 5.1에도 적음).
- plpgsql은 실제로 실행되는 분기만 계획을 세운다. 그래서 health의 한 곳이라도 옛 대상으로 남으면 리허설 (d)에서는 드러나지 않고, 그 분기 조건이 처음 참이 되는 순간 health가 예외로 실패한다. health는 finish 안에서도 호출되므로 대사 run 미종료 → 판매 정지까지 이어진다. 그래서 사후 점검(3.3 7단계)·리허설 (f)·계약 테스트(5.1)는 literal ILIKE가 아니라 위 정규식(대소문자 무시)으로 0건을 확인한다.
- `record_payment_alert`의 인자·반환형·입력 검사는 그대로다.

**정합성**
- 인덱스 교체와 함수 교체가 한 트랜잭션이라, 배포된 코드가 그 사이에 `record_payment_alert`를 불러도 옛 정의+옛 인덱스 또는 새 정의+새 인덱스만 보인다.
- 같은 주문의 같은 경보는 여전히 1건이라, 통보·대사·DB(2.3)가 같은 경보를 여러 번 남겨도 행이 늘지 않는다.

**영향**
- 관리자 경보 목록이 주문별로 늘 수 있다(의도한 변화).
- `get_payment_reconciliation_health.active_alerts` 숫자가 커질 수 있다(표시용).
- launch switch 사전 점검("미해소 경보 0건")은 그대로 동작한다.

### 2.3 취소 후속 경보를 DB 트랜잭션 안으로 + 승인취소 뒤 전액 회수 강제 (대사 REC-1(A))

**원인**
- 운영 `process_payapp_cancellation`은 `double_refund_suspected`, `already_quarantined`, `partial_cancel_after_cancel`, `partial_cancel_quarantined(absorbed)`, `deferred_refund_processing`, `cancel_handling_failed`일 때 `cancel_processed_at`·`partial_cancel_processed_at`만 커밋하고 결과 jsonb만 돌려준다.
- 경보는 앱 계층(`payapp-webhook-server.ts:214-287 cancellationFollowUps`, `payment-reconciliation-server.ts:541-551`)에서만 만든다. RPC 커밋 뒤 함수가 죽으면 경보가 사라지고, 재통보·대사는 `nothing_to_process`라 다시 만들지 않는다.
- 운영 `complete_manual_point_charge_refund`의 `v_partial`은 `origin='partial_cancel' OR partial_cancel_feedback_recorded_at IS NOT NULL`만 본다. 승인취소(전액) 표식이 있어도 부분 회수를 허용하므로, 경보를 놓친 관리자가 남은 크레딧보다 적게 회수하면 PG는 전액 환불·크레딧 일부 active로 끝난다.

**변경**
1. `process_payapp_cancellation`: 결과를 돌려주기 직전(안쪽 `BEGIN … EXCEPTION … END;` 블록 바깥)에 경보를 같은 트랜잭션에서 기록한다.
   ```sql
   -- 정상 결과 경로: IF v_result IS NOT NULL THEN … RETURN 직전
   v_alert_code := CASE
     WHEN v_result = 'double_refund_suspected' THEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED'
     WHEN v_result = 'already_quarantined' AND v_marker = 'cancel' THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
     WHEN v_result = 'partial_cancel_after_cancel' THEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL'
     WHEN v_result = 'partial_cancel_quarantined' AND v_detail->>'outcome' = 'absorbed_by_refund' THEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED'
     WHEN v_result = 'deferred_refund_processing' THEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED'
     -- 3회차 환불 검증 권고: 관리자 결제확인 주문에 열린 manual_review·user 요청이 없으면 2.8 변경 2를 지나
     -- quarantine_external_provider_cancellation으로 간다. TS 후속 경보가 없는 결과라 여기서 critical로 남긴다.
     WHEN v_result = 'external_cancel_quarantined'
          AND v_ppt.paid_feedback_recorded_at IS NULL
          AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
   END;
   IF v_alert_code IS NOT NULL THEN
     PERFORM public.record_payment_alert(
       v_alert_code,
       CASE WHEN v_alert_code IN ('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'PAYAPP_CANCEL_AFTER_QUARANTINE') THEN 'critical' ELSE 'warning' END,
       <TS cancellationFollowUps와 같은 문구>,
       jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation')
         || (v_detail - 'request_id' - 'user_id')   -- partial_cancel_amount·actual_refund_amount 등
     );
   END IF;
   ```
   실패 대체 경로(`cancel_handling_failed` RETURN 직전)에도 `PAYAPP_CANCEL_HANDLING_FAILED`(critical, details에 `error_state`)를 같은 방식으로 기록한다.
   - `external_cancel_quarantined` 분기의 경보 details에는 `jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified')`를 더한다(2.8 변경 2와 같은 reason). code는 기존 `PAYAPP_CANCEL_AFTER_QUARANTINE`이라 severity CASE·관리자 화면을 바꾸지 않는다. 4 통보로 결제번호가 검증된 주문의 외부 전취소는 지금처럼 이 경보를 만들지 않는다(health의 MONEY_RISK_REVIEW가 다룸).
2. TS는 바꾸지 않는다. `cancellationFollowUps`가 같은 경보를 다시 기록해도 2.2의 (code, payment_order_id) 키로 DO NOTHING이 된다. 관리자 알림(notifications)은 지금처럼 TS가 보낸다.
3. `complete_manual_point_charge_refund`:
   ```sql
   v_partial := v_ppt.cancel_feedback_recorded_at IS NULL
     AND COALESCE(<기존 식>, false);
   ```
   승인취소 표식이 있으면 `p_recovered_credits`는 NULL이거나 남은 크레딧과 같아야 한다(기존 비부분 분기의 검사). 아니면 `MANUAL_REFUND_RECOVERY_INVALID`로 거부된다.
4. 관리자 화면: `refundRequiresRecovery`(`src/lib/payment-review-actions.ts:62-70`)에 `cancelMarker` 입력을 추가한다. `cancelMarker`가 true면 false를 돌려준다. `admin/refunds/page.tsx`의 환불 요청 조회에 `transaction.cancel_feedback_recorded_at`를 추가하고 `refunds-client.tsx`가 넘긴다. 그러면 화면이 회수량 입력을 받지 않고 전액 회수로 보낸다.

**정합성**
- 경보와 `*_processed_at`이 한 트랜잭션에 커밋되므로 "처리 시각은 남았는데 경보는 없다"가 생기지 않는다.
- `record_payment_alert`는 입력 검사 실패 외에는 예외를 던지지 않는다(상수 입력이라 실패 불가). 유니크 충돌은 DO NOTHING이다. 같은 주문 경보를 동시에 넣으면 인덱스 대기가 잠깐 생길 뿐이다.
- 3은 DB 가드라서, 옛 화면이나 직접 API 호출로도 승인취소된 결제를 부분 회수로 마감할 수 없다.

- DB 경보 details(`payment_order_id` = 주문 uuid)와 TS 경보 details가 같은 키로 합쳐지는 근거: 웹훅 경로는 `eventDetails(feedback, processedResult)`(`payapp-webhook-server.ts:65-73`, `payment_order_id: result?.payment_order_id`)이고 운영 `process_payapp_cancellation` 반환에 `payment_order_id`가 있다. 대사 경로 TS details도 `{order_id, payment_order_id, source:'reconciliation'}`이다. 재정의에서 반환의 `payment_order_id`를 빼면 TS 경보가 별도 행(mul_no 키)으로 갈라지므로, 계약 테스트(5.1)가 반환 jsonb에 `'payment_order_id'`가 남아 있는지 검사한다.

**영향**
- 대사 경로의 `processPayAppCancellation`(`payment-reconciliation-server.ts:541-551`)도 같은 RPC라 함께 보호된다.
- `deferred_refund_processing`은 대사가 돌 때마다 반복되지만 주문당 1행이다. 관리자가 해소해도 환불이 끝날 때까지 대사가 다시 만든다(TS도 지금 같은 동작). 그래서 이 경보는 "환불이 끝난 뒤 해소"한다(6.6에 적음).

### 2.4 인증 실패 통보 경보가 출시 스위치를 막음 (결제 PAY-3)

**원인**
- `payapp-webhook-server.ts:307-322`: 인증 실패 시 `PAYAPP_FEEDBACK_UNAUTHORIZED`(critical)를 남긴다.
- launch switch 사전 점검(현 `20261021110000_payapp_launch_switch.sql:29-31`)은 미해소 경보가 1건이라도 있으면 멈춘다. 공개 URL에 외부 POST 하나만 와도 출시 적용이 막힌다.

**판단**
이 경보를 warning으로 낮추거나 무조건 빼면 안 된다. 우리 linkval 설정이 틀리면 진짜 통보가 모두 이 경보로 거부되는데, 이것이 출시 전 마지막 신호이기 때문이다.

**변경(1회차 검증 뒤 수정: 사전 점검 예외를 넣지 않고 런북으로 해소)**
- launch switch 사전 점검("미해소 경보가 있으면 멈춤")은 바꾸지 않는다. TS 경보도 그대로 critical이다.
- 1차 설계의 예외("경보 created_at 이후 인증 통과 `payapp:%` 이벤트가 있으면 무시")는 뺐다. 이 경보는 `details = {}`(`payapp-webhook-server.ts:313-321`)라 2.2 새 키에서도 code당 1행이다. 그래서 created_at은 마지막이 아니라 처음 인증 실패 시각이다. 이후 인증 실패는 `DO NOTHING`으로 흔적이 남지 않는다. 그러면 "외부 POST로 경보 생성 → 카페 통보 인증 통과 → 그 뒤 linkval/env가 깨져 모든 통보 401 → 사전 점검이 옛 이벤트를 근거로 통과" 순서에서 실제 고객 결제의 4 통보가 모두 거부된다. PAID_UNFULFILLED health는 `paid_feedback_recorded_at` 기준이라 울리지 않는다. 결국 약 2.5시간(READY_CANCEL_FAILED까지) 신호 없이 "결제됨·미지급"이 남는다. 지금 동작보다 후퇴라서 예외를 없앤다.
- 경보 마지막 시각을 DB에 남기는 방식(`DO UPDATE SET details = details || last_seen_at`)도 검토했다. 하지만 `record_payment_alert`의 반환값("새로 넣었는가")과 계약 테스트 의미가 바뀌어서 고르지 않았다.
- 대신 해소는 사람이 확인한 뒤 `resolve_payment_alert`로 한다(6.5 절차). 해소한 뒤 새로 오는 인증 실패는 첫 건부터 새 미해소 행을 만든다. 그래서 "해소 시각 이후 인증 통과 이벤트가 있고, 미해소 UNAUTHORIZED가 다시 생기지 않았다"는 것이 지금 인증이 정상이라는 근거가 된다.

**정합성·영향**
- 금전 영향은 없다. launch switch 본문은 이름 변경(3.1)과 감사 문자열 갱신 외에 바뀌지 않는다.
- 외부 POST 하나로 출시 적용이 막히는 불편은 남는다. 6.5 절차로 해소하는 데 몇 분이면 된다(안전한 실패).

### 2.5 refund_credits 원천 상태 무시·원장 불일치 (환불 REF-1, DB CREDIT-2)

**원인(운영 `refund_credits`)**
- 원천을 `SELECT initial_credits … FOR UPDATE`로 잠그면서 status·expires_at을 보지 않는다.
- `remaining = LEAST(remaining + amt, initial)`로 되살리고, 원장 기록 `v_total_refunded`에는 상한 적용 전 요청량을 더한다.
- 잔액은 `status IN ('active','pending_refund') AND 미만료`만 센다.
- 그래서 'refunded'·만료 원천으로 들어간 복구분은 잔액에 안 보이는데, credit_transactions에는 +amount 'refund'가 남아 원장 합계와 잔액이 영구히 어긋난다.
- 검증 결과 '과다 지급'은 성립하지 않았다. 남는 문제는 원장 불일치와 부분취소 뒤 전량 회수된 원천의 마켓 환불이다.
  - 근거(2회차 환불 검증에서 확인): 부분 회수 뒤 active로 남은 원천에서는 `remaining + 소비 환불량 ≤ initial − 회수량`이 항상 성립한다(회수는 remaining에서 빼고, 소비 환불량은 그 원천에서 실제로 소비된 양 이하). 그래서 운영 `LEAST(…, initial)` 상한이 지적의 권고안(상한 = initial − 회수량)과 같은 값을 준다. 회수량이 전부였던 경우는 원천이 refunded가 되어 아래의 건너뜀(2.5)·부족분(2.6) 경로로 간다.

**변경(`CREATE OR REPLACE`, 인자·반환형 그대로)**
```sql
SELECT initial_credits, remaining_credits, status, expires_at
  INTO v_source_initial, v_before, v_source_status, v_source_expires_at
  FROM public.credit_sources
 WHERE id = v_source_id AND user_id = p_user_id
 FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND'; END IF;

-- 환불 완료·만료 원천에는 되돌리지 않는다(잔액에 안 보이고 원장만 어긋난다).
-- 함수 전체를 멈추지 않고 그 항목만 건너뛴다. 같은 차감의 다른(active) 원천 몫은 계속 복구한다.
IF v_source_status NOT IN ('active', 'pending_refund')
   OR (v_source_expires_at IS NOT NULL AND v_source_expires_at <= v_now) THEN
  v_skipped_unrestorable := v_skipped_unrestorable + LEAST(v_refund_amount, v_remaining_refund);
  v_remaining_refund := v_remaining_refund - LEAST(v_refund_amount, v_remaining_refund);
  CONTINUE;
END IF;

v_refund_amount := LEAST(v_refund_amount, v_remaining_refund);
UPDATE public.credit_sources
   SET remaining_credits = LEAST(remaining_credits + v_refund_amount, v_source_initial)
 WHERE id = v_source_id
RETURNING remaining_credits INTO v_after;

v_total_refunded := v_total_refunded + (v_after - v_before);   -- 실제로 늘어난 양
-- 상한(initial)에 걸려 덜 늘어난 양. 같은 소비를 두 번 환불하려 했다는 뜻이라 막되 기록한다.
v_skipped_capped := v_skipped_capped + (v_refund_amount - (v_after - v_before));
v_remaining_refund := v_remaining_refund - v_refund_amount;
```
루프 뒤(잔액 계산·profiles UPDATE 다음):
```sql
IF v_total_refunded > 0 THEN
  INSERT INTO public.credit_transactions (...) VALUES (p_user_id, 'refund', v_total_refunded, v_new_balance, ...);  -- 기존과 같은 열
END IF;

-- 소비 내역 합이 p_amount보다 작아 배정하지 못한 양.
v_skipped_unmatched := GREATEST(v_remaining_refund, 0);
v_skipped := v_skipped_unrestorable + v_skipped_capped + v_skipped_unmatched;

-- 되돌리지 못한 양은 같은 트랜잭션의 지울 수 없는 기록으로 남긴다. 호출마다 1행(dedupe_key, 2.2).
IF v_skipped > 0 THEN
  PERFORM public.record_payment_alert(
    'CREDIT_REFUND_SOURCE_SKIPPED', 'warning',
    '일부 크레딧을 되돌리지 못했습니다(환불 완료·만료 원천, 원천 한도 초과, 소비 내역 부족). 사용자에게 보상이 필요한지 확인하세요.',
    jsonb_build_object('user_id', p_user_id, 'resource_type', p_resource_type, 'resource_id', p_resource_id,
                       'requested', p_amount, 'refunded', v_total_refunded, 'skipped', v_skipped,
                       'skipped_unrestorable', v_skipped_unrestorable, 'skipped_capped', v_skipped_capped,
                       'skipped_unmatched', v_skipped_unmatched,
                       'dedupe_key', 'credit_refund_skip:' || gen_random_uuid()::text,
                       'source', 'refund_credits'));
END IF;

RETURN jsonb_build_object('new_balance', v_new_balance, 'refunded', v_total_refunded, 'skipped', v_skipped);
```
- `v_skipped`·`v_skipped_unrestorable`·`v_skipped_capped`·`v_skipped_unmatched integer := 0`, `v_before`, `v_after`, `v_source_status`, `v_source_expires_at`을 DECLARE에 추가한다.
- 2회차 검증 뒤 추가: 상한에 걸려 덜 늘어난 양(`skipped_capped`)과 소비 내역이 모자라 남은 양(`skipped_unmatched`)도 경보에 넣는다. 1차 설계에서는 이 둘이 refunded에도 skipped에도 들어가지 않아 경보 없이 사라졌다. 운영 루프는 `source_id`가 비었거나 amount ≤ 0인 항목을 `CONTINUE`하므로, 그런 항목이 섞이면 그 몫도 unmatched로 잡힌다.
- 복구가 0이면 거래 행을 만들지 않는다. 지금은 amount 0 'refund' 행이 생길 수 있었다(원장 변화 없음).
- `profiles.credits`와 `balance_after`는 원장 잔액으로만 쓴다. `p_target_balance`는 받기만 하고 쓰지 않는다(시그니처 호환).
  - 지금은 TS 동기화(2.14에서 제거)가 어차피 원장 값으로 덮어써서 cap이 실제로 남지 않는다. 그런데 `balance_after`에는 cap 값이 남아 `ledger_vs_latest_transaction` 불일치가 생길 수 있었다.
  - 값을 넘기는 호출처: `src/app/api/questions/generate/route.ts:111-119`가 `CreditService.refundCredits`의 7번째 위치 인자로 `balanceBeforeGeneration`을 넘긴다(`targetBalance` 이름이 아니라 `grep targetBalance`에 잡히지 않음). 이 값이 `p_target_balance`로 가지만 위 이유로 쓰지 않아도 결과가 같다(3회차 환불 검증 확인).
- 반환 `refunded`는 실제 복구량, `skipped`는 복구 불가 원천이라 건너뛴 양이다(새 키, 옛 TS는 무시).
- `record_payment_alert`는 마이그레이션 1의 새 정의·새 인덱스를 전제로 한다(옛 인덱스면 code당 1행으로 묶인다). 그래서 마이그레이션 2는 1 뒤에만 적용하고, 사전 점검이 `payment_reconciliation_alerts_active_key` 존재를 확인한다(3.1, 3.4).

**1회차 검증 뒤 바꾼 점(전부-아니면-전무 RAISE 철회)**
- 1차 설계는 원천 하나라도 복구 불가면 `CREDIT_REFUND_SOURCE_NOT_RESTORABLE`로 함수 전체를 롤백했다. 이 RPC는 AI 생성·리스트보드·커뮤니티 저장 실패 환불도 쓴다. 운영 `consume_credits`는 `ORDER BY expires_at ASC NULLS LAST`로 여러 원천에 걸쳐 차감한다. 그래서 [만료 임박 S1 + active S2]에 걸친 차감에서 작업 중 S1이 만료되면, 지금은 복구되던 S2 몫까지 사라졌다. 1차 문서의 "사용자 결과는 같다"(7절 6)와 "기존 catch가 처리한다"는 틀렸다.
- 실제로 `listboard-jobs/[jobId]/run/route.ts:388`과 `retry/route.ts:453`의 `CreditService.refundCredits` 호출은 try/catch 밖이다. 예외가 나면 500이 나가고 job 최종 상태 UPDATE(run `:398` 이후, retry `:463` 이후)가 실행되지 않는다. 지금도 네트워크·DB 오류면 같은 일이 생긴다.
- 그래서 엄격한 판정은 마켓 승인(2.6 RPC 안)에서만 하고, `refund_credits`는 복구 불가 항목만 건너뛰고 기록한다.

**정합성**
- 원천 행 잠금 아래에서 상태를 판정하므로, 동시에 진행되는 `complete_manual_point_charge_refund`(원천 FOR UPDATE)와 직렬화된다.
- 원천 복구·잔액·거래·건너뜀 경보가 한 트랜잭션이다. 커밋되면 "건너뛴 양"은 반드시 경보 행으로 남는다.

**호출자 영향**
- 마켓 환불 승인: 2.6 RPC가 `refund_credits`를 부르기 전에 원천을 잠그고 직접 판정한다. 복구 가능한 항목만 넘기므로 `refund_credits`가 건너뛸 일이 없다.
- AI 생성·리스트보드·커뮤니티 저장 실패 환불: 복구 불가 원천 몫만 돌아가지 않고 나머지는 돌아간다. 건너뛴 몫은 `CREDIT_REFUND_SOURCE_SKIPPED` 경보로 남는다. 관리자는 필요하면 관리자 지급(`system_refund`)으로 보상하고 경보를 해소한다(6.6).
- 리스트보드 두 route는 환불 호출을 try/catch로 감싼다(커밋 B). 실패하면 `console.error`를 남기고 `finalBalance`를 `deductionResult.newBalance`(run)로 둔 채 job 최종 상태 UPDATE를 그대로 진행한다. retry는 반환값을 쓰지 않으므로 catch만 둔다. 커뮤니티 저장(`save-from-community/route.ts:110-131`, `:229-241` 등)과 생성(`questions/generate/route.ts:105-125`)은 이미 catch가 있다.
- 환불 RPC 실패 기록(2회차 환불 검증 권고 반영): 위 catch들은 실패를 `console.error`로만 남겨, 사용자 크레딧이 돌아가지 않았다는 사실이 지워지지 않는 기록으로 남지 않았다(기존 틈). 호출자마다 고치지 않고 `CreditService.refundCredits`의 RPC 오류 분기 한 곳에서, 오류를 던지기 전에 경보를 남긴다.
  ```ts
  if (error) {
    try {
      await rpcClient.rpc('record_payment_alert', {
        p_code: 'CREDIT_REFUND_FAILED',
        p_severity: 'warning',
        p_message: '크레딧 환불 처리에 실패했습니다. 사용자 잔액을 확인하고 필요하면 관리자 지급으로 보상하세요.',
        p_details: { user_id: userId, resource_type: resourceType, resource_id: resourceId, amount,
                     description, error_message: error.message,
                     dedupe_key: `credit_refund_failed:${crypto.randomUUID()}` },
      })
    } catch {
      // 경보 기록 실패는 원래 오류를 바꾸지 않는다.
    }
    throw …   // 기존 그대로
  }
  ```
  - `dedupe_key`는 호출마다 새 uuid다(3회차 환불 검증 권고). 리소스 단위 키면 retry route가 같은 job.id로 여러 번 환불하거나 save-from-community가 같은 question_id로 환불할 때 두 번째 실패가 첫 미해소 경보에 묶여 DO NOTHING이 되고 그 금액이 기록에서 빠진다.
  - RPC가 커밋된 뒤 응답만 유실된 경우에도 경보가 난다(오탐). `resource_id`만으로는 판정하지 않는다. 같은 리소스로 앞서 성공한 환불 행이 있으면 진짜 실패를 오탐으로 닫게 되고, `resource_id`가 NULL인 호출(save-from-community 대량 경로 `:421`·`:450`)은 비교할 수 없기 때문이다. 판정은 details의 user_id·amount·description과 경보 created_at 전후의 'refund' 거래 행으로 한다(6.6).
  - DB 장애가 원인이면 경보 기록도 실패한다. 그 경우는 지금처럼 로그만 남는다(7절 2).

### 2.6 마켓 환불 승인 비원자성 (환불 REF-2, DB "PAY-1")

**원인**
`src/lib/market-refunds.ts:496-585 approveMarketRefund`가 세 단계를 따로 호출한다.
1. CAS(pending→approved, `:519-540`)
2. `CreditService.refundCredits`(별도 RPC, `:550-561`)
3. `Promise.all` 상태 변경(orders/lines/entitlements, `:563-582`)

중간에 실패·중단되면 다음이 생긴다.
- 크레딧은 복구됐는데 이용권이 active로 남아 다운로드가 가능하다. 원천이 다시 remaining=initial이 되면 충전 환불(현금)까지 이어질 수 있다.
- 또는 approved인데 크레딧이 없다.
- `recordFailure`는 잡힌 오류만 기록하고, "크레딧 복구 실패"라는 거짓 기록이 이중 지급을 부를 수 있다.

**변경**
새 함수 `public.approve_market_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_confirmed_refund_credits integer DEFAULT NULL) RETURNS jsonb`, SECURITY DEFINER, `SET search_path TO 'public', 'pg_temp'`, service_role 전용. 순서는 다음과 같다.
1. `market_refund_requests`에서 user_id를 잠금 없이 읽는다(없으면 `MARKET_REFUND_NOT_FOUND`).
2. `profiles` FOR UPDATE. `checkout_market_selection`·`consume_credits`와 같이 프로필을 먼저 잠근다.
3. `market_refund_requests` FOR UPDATE, `status <> 'pending'` → `MARKET_REFUND_NOT_PENDING`.
4. 대상 잠금과 재검사:
   - v2_order: `market_purchase_orders` FOR UPDATE(id·user_id 일치, status='completed')
   - legacy_purchase: `market_purchases` FOR UPDATE(동일 조건)
   - 아니면 `MARKET_REFUND_TARGET_CHANGED`
5. 다운로드 재검사: `market_download_events`에 `order_id`(legacy는 `purchase_id`)가 대상인 행이 있으면 `MARKET_REFUND_TARGET_CHANGED`. 다운로드 기록 insert는 FK로 프로필·주문 행에 FOR KEY SHARE를 잡으므로, 2·4의 잠금 뒤에 센 값은 커밋 전까지 바뀌지 않는다(1.4).
6. 소비 내역은 TS에서 받지 않고, 4에서 잠근 행의 `credit_consumptions`에서 읽는다. 키는 운영 데이터처럼 두 형식을 모두 읽는다(`COALESCE(e->>'source_id', e->>'sourceId')`, `(e->>'amount')::integer`). 비었거나 배열이 아니면 `MARKET_REFUND_TARGET_CHANGED`.
7. 원천 판정(복구 전): 6의 원천을 `credit_sources … WHERE user_id = 요청 user_id FOR UPDATE`로 잠그고(없으면 `CREDIT_REFUND_SOURCE_NOT_FOUND`), `refund_credits` 루프와 같은 식으로 복구 예정량을 계산한다.
   - 복구 가능(status active·pending_refund, 미만료): 배정량 `v_alloc := LEAST(amount, 남은 요청량, initial - remaining - 이 원천에 이미 배정한 양)`을 계산하고 `v_restorable`에 더한다(같은 원천이 여러 항목에 나와도 누적으로 계산).
     - `v_alloc > 0`일 때만 `v_restore_items`에 **정규화한 새 원소** `jsonb_build_object('source_id', <COALESCE(e->>'source_id', e->>'sourceId')로 읽은 id>, 'amount', v_alloc)`을 넣는다. 원래 요소 e를 그대로 넣지 않는다. 0인 항목은 넣지 않는다.
     - 이유(2회차 환불·마이그레이션 검증 차단): 운영 `refund_credits`(md5 6a082ed5…, 2.5에서도 이 부분 유지)는 `v_item->>'source_id'`와 `v_item->>'amount'`만 읽고, `source_id`가 없으면 `CONTINUE`한다. 운영 `market_purchase_orders.credit_consumptions` 19행 중 8행(status completed 18행 중 7행)은 키가 `sourceId`다(2026-11-10 조회). 원래 요소를 넣으면 이 주문들은 refunded = 0이 되어 9단계 `MARKET_REFUND_AMOUNT_MISMATCH`로 항상 롤백된다(승인 영구 불가). 또 원래 amount를 넘기면, 상한(initial − remaining)이나 남은 요청량 때문에 덜 배정된 항목에서 `refund_credits`가 상한 때문에 덜 늘리면서 `v_remaining_refund`는 원래 amount만큼 줄인다. 그러면 refunded < v_restorable가 되어 역시 MISMATCH가 나고, 부족분 확인 경로도 영원히 통과하지 못한다. 지금 TS가 `parseCreditConsumptions` → `rpcPayload = {source_id, amount}`로 하던 정규화(`market-refunds.ts:78-99`, `credits.ts:271-274`)를 새 RPC가 대신한다.
     - 정규화한 원소의 amount 합은 `v_restorable`과 같고, 각 원소는 같은 잠금 아래 계산한 상한 안이다. 그래서 `refund_credits`는 상한·건너뜀·남은 양 없이 정확히 `v_restorable`을 복구한다(`skipped` = 0).
   - 복구 불가: 그 양을 `v_shortfall`에 더한다.
   - `v_shortfall = requested_refund_credits - v_restorable`.
8. 판정:
   - `p_confirmed_refund_credits IS NULL`(일반 승인)이고 `v_restorable <> requested_refund_credits`면 `RAISE EXCEPTION 'MARKET_REFUND_SHORTFALL' USING DETAIL = jsonb_build_object('requested', …, 'restorable', v_restorable)::text`. 아무것도 바뀌지 않는다(pending 유지).
   - `p_confirmed_refund_credits`가 있으면 `v_restorable`과 같아야 한다. 다르면(관리자가 숫자를 본 뒤 원천 상태가 바뀜) 같은 `MARKET_REFUND_SHORTFALL`을 새 숫자로 던진다.
9. `v_restorable > 0`이면 `v_refund := public.refund_credits(user_id, v_restorable, 'market_refund', request.id, '문제마켓 구매 환불', v_restore_items)`. 같은 트랜잭션이다. `(v_refund->>'refunded')::integer <> v_restorable` 또는 `(v_refund->>'skipped')::integer <> 0`이면 `RAISE EXCEPTION 'MARKET_REFUND_AMOUNT_MISMATCH'`(7에서 같은 잠금 아래 정규화·계산했으므로 나오면 버그다).
10. 상태 변경:
    - v2: orders/lines(order_id)/entitlements(source_order_id) status='refunded'
    - legacy: `market_purchases` status='refunded', refunded_at=now()
11. 요청 `status='approved', approved_refund_credits = v_restorable(실제 복구량), processed_by, processed_at=now()`. admin_note는 `p_admin_note`이고, 부족분이 있으면 `[부족분 N크레딧: 환불 완료·만료된 원천이라 복구하지 않음. 보상 여부는 관리자 판단]` 줄을 덧붙인다.
12. 부족분이 있으면 `record_payment_alert('MARKET_REFUND_SHORTFALL', 'warning', '문제마켓 환불을 부족분과 함께 승인했습니다. 보상이 필요한지 확인하세요.', {request_id, user_id, requested, refunded, shortfall, actor_id, dedupe_key: 'market_refund:'||request_id})`. 같은 트랜잭션이라 승인과 기록이 함께 커밋된다.
13. `RETURNING *`를 jsonb로 돌려주고 `new_balance`(복구가 없으면 profiles.credits), `shortfall`을 덧붙인다.

TS `approveMarketRefund(input)`:
- 입력에 `confirmedRefundCredits?: number`를 추가한다.
- 기존 사전 검사(`getRefundRequest`, `getMarketRefundEligibility`: 다운로드·7일·업그레이드 기준·스냅샷)는 그대로 둔다(빠른 안내용). 다운로드·대상 상태·소비 내역은 RPC가 잠금 아래에서 다시 본다.
- CAS·`CreditService.refundCredits`·`Promise.all`·`recordFailure`를 `admin.rpc('approve_market_refund', …)` 한 번으로 바꾼다.
- 오류 매핑:
  - `MARKET_REFUND_NOT_PENDING` → `MarketRefundConflictError('이미 처리된 환불 요청입니다.')`
  - `MARKET_REFUND_TARGET_CHANGED` → `승인 전 환불 조건이 변경되었습니다.`
  - `MARKET_REFUND_SHORTFALL` → 새 `MarketRefundShortfallError(requested, restorable)`. 문구: `환불됐거나 만료된 결제 크레딧으로 산 상품이라 N크레딧 중 M크레딧만 되돌릴 수 있습니다. 확인하면 M크레딧만 복구하고 이용권을 회수합니다.`
  - PostgreSQL `40P01`(교착)·`40001`(직렬화) → `MarketRefundConflictError('다른 처리와 겹쳤습니다. 잠시 후 다시 시도하세요.')`. `approve_market_refund`·`refund_credits`는 profiles → credit_sources 순서, `complete_manual_point_charge_refund`·`process_payapp_cancellation`은 credit_sources → profiles 순서로 잠그므로 같은 사용자에게 동시에 일어나면 교착이 날 수 있다(롤백이라 정합성은 안전).
- 성공 뒤 잔액 정합성 점검은 2.14의 실패 무시 보고 함수로 한다.

route·화면(부족분 확인 경로):
- `src/app/api/admin/market/refunds/[id]/route.ts` `BodySchema`에 `confirmedRefundCredits: z.number().int().min(0).optional()`을 추가해 approve에 넘긴다. `MarketRefundShortfallError`는 409와 `{ code: 'MARKET_REFUND_SHORTFALL', requested, restorable }`로 응답한다.
- `src/app/(admin)/admin/refunds/market-refunds-client.tsx`: 이 응답을 받으면 확인 창에 두 숫자를 보여 주고, 확인하면 `confirmedRefundCredits: restorable`로 다시 보낸다.
- 부족분 보상은 승인 뒤 별도로 관리자 지급(`system_refund`, 2.15)으로 하고, `MARKET_REFUND_SHORTFALL` 경보를 메모와 함께 해소한다(6.6).

**1회차 검증 뒤 바꾼 점**
- 1차 설계는 복구 불가면 승인을 롤백하고 "거부 뒤 관리자 지급"을 안내했다. 그런데 src 어디에도 이용권을 회수하는 관리자 경로가 없다(`market_entitlements`를 쓰는 곳은 `market-refunds.ts`·`market-items-server.ts`·`market-item-cleanup.ts`뿐이고 'revoked' 사용처 0곳). 그 안내대로 하면 "이용권 active + 크레딧 지급"이라는, 2.6이 없애려는 상태를 사람이 만든다. 그래서 이용권 회수·실제 복구량 기록·부족분 경보를 한 RPC의 명시적 확인 경로로 묶었다.
- `p_consumptions`를 TS 계산값으로 받지 않고 잠근 주문 행에서 읽는다. 승인 근거가 트랜잭션 안에서 고정된다.
- `approved_refund_credits`는 요청량이 아니라 실제 복구량이다. 상한(LEAST)이나 소비 내역 불일치로 덜 복구되면 8의 판정에 걸려 조용히 남지 않는다.

**정합성**
- 승인·크레딧·이용권·부족분 경보가 한 트랜잭션이라, 중단되면 전부 롤백(pending 유지)이고 커밋되면 전부 반영이다.
- 응답 유실 뒤 관리자가 다시 누르면 `MARKET_REFUND_NOT_PENDING`(409)이라 이중 복구가 없다.
- 요청 행 잠금과 status 검사로 승인·거부 경합이 직렬화된다. `rejectMarketRefund`의 CAS는 승인 커밋 뒤 0행이 된다.
- 부족분 확인은 관리자가 본 숫자(`p_confirmed_refund_credits`)가 잠금 아래 계산값과 같을 때만 통과한다.

**영향**
- 다운로드 route(`hasPendingMarketRefundRequestForTarget`, pending만 차단)는 그대로다. approved면 이용권이 항상 refunded라서다.
- 처리 실패 시 admin_note 기록은 없어진다. 실패하면 아무것도 바뀌지 않았으므로 기록할 중간 상태가 없다.
- 업그레이드 기준 주문 검사(`isUpgradeBaseOrder`)는 TS 사전 검사에만 남는다. 기존부터 있던 틈이고(7절), SQL로 옮기면 카테고리 slug 판정까지 복제해야 해서 이번 범위에서 넣지 않는다.

### 2.7 계좌이체 이중환불 감지 순서 의존 (환불 REF-3)

**원인**
- 운영 `complete_manual_point_charge_refund`는 `status='completed'`면 `p_external_method`와 무관하게 `already_completed`를 돌려준다.
- `process_payapp_cancellation`의 `double_refund_suspected`는 수동 완료(bank_transfer)가 먼저인 순서만 잡는다.
- PG 취소 통보가 먼저 finalize한 뒤 관리자가 계좌 송금 완료를 누르면 흔적이 없다. 응답은 `route.ts:170-175`의 '이미 완료된 환불 요청입니다.'뿐이다.

**변경**
- DB, `already_completed` 분기(1회차 검증 뒤 조건을 넓힘):
  ```sql
  IF v_request.status = 'completed' THEN
    -- 계좌 송금 외의 방식(결제사 취소 통보, 페이앱 취소 요청, 페이앱 관리자 취소)으로 이미 완료된 요청에
    -- 계좌 송금 완료가 들어오면 이중 환불 의심이다. 같은 계좌 송금의 재클릭은 제외한다.
    IF p_external_method = 'bank_transfer' AND NOT EXISTS (
         SELECT 1 FROM public.payment_admin_actions paa
          WHERE paa.refund_request_id = v_request.id
            AND paa.action = 'manual_refund_completed'
            AND paa.external_method = 'bank_transfer') THEN
      PERFORM public.record_payment_alert('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'critical',
        '이미 다른 방식으로 환불이 완료된 요청에 계좌 송금 완료가 입력되었습니다. 송금했다면 회수가 필요합니다.',
        jsonb_build_object('payment_order_id', v_request.payment_order_id, 'refund_request_id', v_request.id,
                           'actor_id', p_admin_id, 'provider_cancel_transaction_key', v_request.provider_cancel_transaction_key,
                           'dedupe_key', 'refund_request:' || v_request.id::text,
                           'source', 'complete_manual_after_completed'));
      v_double := true;
    END IF;
    … RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance, 'double_refund_suspected', v_double);
  END IF;
  ```
  - 1차 조건 `provider_cancel_transaction_key IS NOT NULL`은 "관리자가 먼저 `provider_admin_cancel`/`payapp_cancel_request`로 수동 완료(키 NULL) → 다른 관리자가 bank_transfer 입력"을 놓쳤다. 이제 그 경우도 잡는다.
  - `refund_requests.payment_order_id`는 NULL 허용이다(운영 3행 모두 NULL). NULL이면 `dedupe_key`(요청 id)가 키가 되어 다른 요청 경보와 묶이지 않는다. 값이 있으면 주문 키라서 `process_payapp_cancellation`의 같은 경보와 1행으로 합쳐진다.
  - 입력 검사(메모·방식·금액)는 그 앞에 있으므로 메모 없이 경보만 만들 수는 없다.
- TS `src/app/api/admin/refunds/route.ts:157-175`: `result.double_refund_suspected`면 409와 함께 `이미 다른 방식으로 환불이 완료된 요청입니다. 계좌로 송금했다면 이중 환불이므로 회수해야 합니다.`를 돌려준다.

**정합성·영향**
- 경보는 함수가 예외 없이 끝나야 커밋된다. 이 분기는 예외가 없다.
- 두 순서 모두 같은 code 경보를 남긴다.

### 2.8 관리자 결제확인 mul_no로 자동 paycancel (환불 REF-5)

**원인**
- 운영 `resolve_payment_order_review('paid_confirmed')`는 `p_mul_no ~ '^[0-9]+$'`만 검사해 저장한다.
- `claim_point_charge_refund`는 `admin_paid_confirmed_at`만 있어도 자동 환불을 허용한다.
- `point-charge-refund-processor.ts:96-111`이 그 번호로 바로 paycancel한다. 공용 계정이라, 입력 실수 하나가 카페 고객 결제 취소와 우리 고객 미환불로 이어진다.

**변경(DB `claim_point_charge_refund`, payapp 블록 끝, `UPDATE … status='processing'` 앞)**
```sql
IF v_provider_transaction.paid_feedback_recorded_at IS NULL
   AND v_provider_transaction.admin_paid_confirmed_at IS NOT NULL THEN
  UPDATE public.refund_requests
     SET status = 'manual_review',
         processed_by = p_admin_id,
         admin_note = p_admin_note,
         next_attempt_at = NULL,
         last_error_code = 'PAYAPP_ADMIN_CONFIRMED_MANUAL_REFUND',
         last_error_message = '관리자가 결제를 확인한 주문이라 자동 취소하지 않습니다. 페이앱 관리자에서 결제번호·금액·결제일을 대조해 취소한 뒤 수동 완료로 처리하세요.'
   WHERE id = v_request.id;
  RETURN jsonb_build_object('already_completed', false, 'manual_review_required', true,
                            'request_id', v_request.id, 'user_id', v_request.user_id, 'provider', 'payapp',
                            'payment_order_id', v_order.id, 'provider_transaction_id', NULL, 'refund_amount', NULL);
END IF;
```
- 페이앱 4 통보로 결제번호가 검증된 주문(`paid_feedback_recorded_at` 있음)은 지금처럼 자동 환불한다.

**변경 2(1회차 지급 검증 권고 반영, DB `process_payapp_cancellation`)**
- 운영 정의 142-151행은 `v_request.status = 'manual_review' AND v_request.origin = 'user'`이면 `finalize_point_charge_refund`로 바로 완료한다. 위 변경 뒤 관리자 결제확인 주문의 환불 요청은 바로 이 조합(manual_review·user)으로 남는다. 입력이 틀린 mul_no가 같은 금액의 카페 결제 번호이고 그 카페 결제가 취소되면, 우리 사용자는 현금 환불 없이 크레딧만 회수되고 환불이 "완료"가 된다.
- 그래서 `v_marker = 'cancel'` 분기의 `already_quarantined` 판정(140행) 바로 뒤에 다음을 넣는다.
  ```sql
  ELSIF v_request.id IS NOT NULL
        AND v_request.status = 'manual_review' AND v_request.origin = 'user'
        AND v_ppt.paid_feedback_recorded_at IS NULL
        AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN
    -- 관리자가 입력한 결제번호라 이 취소가 우리 결제인지 검증되지 않았다. 자동 완료하지 않는다.
    v_result := 'already_quarantined';
    v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
  ```
  - 결과 이름은 기존 `already_quarantined`를 쓴다. 그래서 TS(`cancellationFollowUps`의 `PAYAPP_CANCEL_AFTER_QUARANTINE` critical·관리자 알림, 대사의 `already_completed`)를 바꾸지 않아도 된다. 2.3의 DB 경보도 같은 code·주문 키로 같은 트랜잭션에 남는다.
  - `cancel_processed_at`은 기존 흐름대로 기록된다. 요청은 manual_review, 원천은 pending_refund 그대로다. 관리자는 콘솔에서 그 취소가 우리 결제인지 대조한 뒤 `complete_manual`로만 마감한다. 승인취소 표식이 있으므로 2.3-3에 따라 전량 회수가 강제된다.
- 이 가드로 7절 5번 위험(잘못된 mul_no의 카페 결제 취소가 우리 환불을 자동 완료)이 없어진다.
- 3회차 환불 검증으로 확인한 범위: 이 ELSIF는 열린 요청이 manual_review·user일 때만 걸린다. 요청이 없거나 pending_review이면 운영 정의의 마지막 ELSE `quarantine_external_provider_cancellation`으로 가서 `external_cancel_quarantined`가 된다. 원천은 pending_refund라 `consume_credits`(active만 사용)가 쓰지 못하는 안전한 쪽이지만, 관리자가 이것을 "외부 전취소"로 보고 `complete_manual`로 전량 회수하면 돈을 낸 우리 고객의 크레딧이 회수된다. 그래서 2.3 변경 1의 CASE에 이 경우를 `PAYAPP_CANCEL_AFTER_QUARANTINE`(reason `admin_confirmed_mul_no_unverified`, critical)으로 추가하고, 6.6 콘솔 대조 대상에 넣는다.

**TS**
- `ClaimedPointChargeRefund`에 `manual_review_required?: boolean`을 추가한다.
- `processPointChargeRefund`는 claim 직후 이 값이면 페이앱을 부르지 않고 `{ alreadyCompleted: false, manualReviewRequired: true, claimed, newBalance: null }`을 돌려준다.
- route는 `관리자 결제 확인 주문이라 자동 취소하지 않고 수동 확인으로 보냈습니다. 페이앱 관리자에서 결제를 대조해 취소한 뒤 수동 완료로 처리하세요.`(200)를 응답하고 사용자 알림을 보내지 않는다.

**정합성**
- 상태 전이(manual_review)와 "paycancel 하지 않음"이 claim 트랜잭션 하나로 정해진다. 프로세스가 중간에 죽을 틈이 없다.
- 원천은 pending_refund로 그대로 묶여 있다. 이후 `complete_manual_point_charge_refund`(origin user, 비부분 → 전량 회수)로 마감한다.
- 콘솔에서 결제를 취소해 9 통보가 오면, 변경 2(열린 manual_review·user 요청이 있을 때) 또는 2.3의 `external_cancel_quarantined` 경보(요청이 없거나 pending_review일 때)에 따라 자동 완료하지 않고 critical 경보만 남긴다. 관리자가 콘솔 대조 뒤 `complete_manual`(전량 회수)로 마감한다. 4 통보로 결제번호가 검증된 주문은 지금처럼 finalize된다.

**옛 코드 호환**
- 옛 TS는 `provider_transaction_id`가 NULL이라 `invalidRefundSnapshot`(409)으로 끝나고 paycancel하지 않는다.
- `failPointChargeRefund`는 status가 processing이 아니라 아무것도 바꾸지 않는다. 요청은 manual_review로 남는다.

### 2.9 부분취소 뒤 승인취소 price (환불 REF-6, 페이앱 동작 미확인)

**원인**
- 운영 `apply_payapp_feedback` 표식 경로는 `p_pay_state IN (9,64) AND p_price IS DISTINCT FROM v_order.expected_amount`이면 `PAYAPP_FEEDBACK_AMOUNT_MISMATCH`로 ignored 처리한다.
- 부분취소 뒤 잔액 승인취소의 price가 잔액으로 오면 표식이 안 남는다. 웹훅은 warning 경보만 남긴다(`payapp-webhook-server.ts:446-463`).

**두 동작 모두에서 안전한 변경**
1. DB, 금액 검사:
   ```sql
   ELSIF p_pay_state IN (9, 64)
     AND p_price IS DISTINCT FROM v_order.expected_amount
     AND NOT (p_price IS NOT NULL
              AND v_ppt.partial_cancel_amount IS NOT NULL
              AND p_price = v_order.expected_amount - v_ppt.partial_cancel_amount) THEN
     v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
   ```
   - `p_price IS NOT NULL`(3회차 마이그레이션 검증 권고): 이 항이 없으면 price가 NULL이고 부분취소 금액이 있을 때 `NOT (…)`이 NULL이 되어 ELSIF 전체가 거짓이 된다. 그러면 지금은 AMOUNT_MISMATCH로 ignored 처리되는 가격 없는 9·64 통보가 표식으로 기록된다. 이 항으로 지금 동작을 유지한다.
   - 원금으로 오는 경우: 기존 조건 그대로 통과하고, 이 줄은 쓰이지 않는다.
   - 잔액으로 오는 경우: 표식이 기록되고 `process_payapp_cancellation`이 격리(`already_quarantined` → 2.3 경보·전액 회수 강제) 또는 `quarantine_external_provider_cancellation`으로 넘긴다.
   - `v_ppt`는 이미 FOR UPDATE로 잠근 행이라 부분취소 기록과 직렬화된다.
2. TS ignored 분기의 severity·알림: `feedback.payState`가 9·64·70·71(취소 계열)이면 `ignored`든 `order_not_found`든 critical로 올리고 `notifyAdmins`를 true로 한다(나머지는 warning 유지, 기존 notifyAdmins 규칙 그대로). 위 식으로도 못 받는 취소(여러 번 부분취소 뒤 잔액 취소, 70보다 9가 먼저 온 경우)를 사람이 바로 보게 하기 위해서다.
   - 2회차 지급 검증 권고 반영: 70·71에 `orig_mul_no`와 var1이 모두 없으면 지금은 `order_not_found` warning만 남고 관리자 알림도 없다(`notifyAdmins = !orderNotFound || payState === 4`). 사이트 주문의 부분취소일 수 있으므로 함께 올린다. 사이트 밖 통보는 앞 분기(`PAYAPP_FOREIGN_FEEDBACK`)에서 걸러진다. 단, 이것은 페이앱이 70·71 통보에 `orig_mul_no`를 항상 보낼 때만 맞다(3회차 지급·마이그레이션 검증 정정). `payapp-webhook-server.ts:439`의 `lookupKeyPresent`는 70·71에 `orig_mul_no`가 없으면 false라서, 그런 카페 부분취소도 이 경보 경로로 와 critical 관리자 알림이 나고 이벤트는 ignored(`order_not_found`)·`PAYAPP_PAY_STATE_70`으로 남는다. 그러면 2.1 health가 30분 뒤 `PAYAPP_FEEDBACK_UNPROCESSED`도 만들고, 출시 전에는 이 경보가 launch switch 사전 점검을 막는다. 그래서 6.7에서 `orig_mul_no`가 오는지 확인하고, 6.5에 이 경보의 확인·해소 절차를 둔다.
3. 이 TS 경보는 `markEvent(ignored)` 뒤 `runFollowUps`에서 오류를 삼키며 기록되므로 유실될 수 있다. 그 안전망은 2.1 health 점검의 ignored 취소 조건이다(30분 뒤 `PAYAPP_FEEDBACK_UNPROCESSED` critical).

**영향**
- 잔액 price가 PG 실제와 다를 위험은 없다. 인증된 통보이고 mul_no·가맹점이 일치해야 하기 때문이다.
- 결과는 크레딧 격리(안전 쪽)뿐이다.

### 2.10 ready 취소 응답 유실 → 판매 정지 오탐 (대사 REC-2, 페이앱 동작 미확인)

**원인**
- `payment-reconciliation-server.ts:718-750`의 ready 분기는 `cancelPayAppPayment(mode=ready)` 오류를 구분하지 않는다. 2시간 유예 뒤 `PAYAPP_READY_CANCEL_FAILED`(manual_review)가 되고, health의 money-review 목록에 있어 페이앱 판매가 꺼진다.
- 페이앱이 ready 취소 뒤 8/16/32를 보내면 `apply_payapp_feedback`이 manual_review·READY_CANCEL_FAILED 주문도 만료시키지만, 보내는지 모른다.

**판단**
- "재취소 거절 = 이미 취소됨"으로 가려 만료 처리하면 안전하지 않다. 결제완료(4) 통보가 유실된 결제도 같은 거절을 받기 때문이다.
- 현재 money-review 분류가 4 유실을 잡는 유일한 장치이므로 분류와 판매 정지는 유지한다(두 동작 모두 돈이 안전).

**변경(관측성만)**
- `markPayAppTerminal`에 넘기는 READY_CANCEL_FAILED 메시지에 마지막 오류 코드를 붙인다. `getReconciliationError(error).code`로 얻고, PayAppError면 `providerErrorCode`도 붙인다.
- 형식: `만료된 페이앱 결제 요청을 2시간 동안 취소하지 못했습니다. 결제 여부를 확인하세요. (마지막 오류: PAYAPP_REQUEST_REJECTED/<페이앱 코드>)`. 관리자가 페이앱 콘솔에서 바로 대조할 수 있다.
- 런북(6.6): 콘솔에서 미결제를 확인하면 `unpaid_confirmed`로 만료시키고, 판매 스위치를 수동으로 다시 켠다.
- 출시 직후 테스트 결제 1건으로 "ready 만료 뒤 8/16/32 통보가 오는지"를 확인한다(6.7). 온다면 오탐은 2시간 유예 안에 자동 해소된다.

### 2.11 payment_orders updated_at 트리거 (대사 REC-3)

**원인**
- 운영 트리거 `update_payment_orders_updated_at BEFORE UPDATE → update_updated_at_column()`(NEW.updated_at=now())이 있다.
- 그래서 `claim_payment_reconciliation_batch`의 `updated_at = po.updated_at` 의도와 `record_payment_reconciliation_result`의 기록용 갱신이 updated_at을 계속 새로 만든다.
- health의 카카오 stale 조건(`updated_at <= now()-10분`)이 대사 대상 주문에서 영원히 거짓이 된다.

**변경**
1. payment_orders 전용 트리거 함수 `public.payment_orders_touch_updated_at()`(SECURITY INVOKER, `SET search_path = public, pg_temp`):
   ```sql
   IF (to_jsonb(NEW) - ARRAY['updated_at','reconcile_attempt_count','next_reconcile_at','last_reconciled_at',
                             'last_reconcile_error_code','last_reconcile_error_message'])
      = (to_jsonb(OLD) - ARRAY['updated_at','reconcile_attempt_count','next_reconcile_at','last_reconciled_at',
                               'last_reconcile_error_code','last_reconcile_error_message']) THEN
     NEW.updated_at := OLD.updated_at;   -- 대사 기록 열만 바뀐 경우
   ELSE
     NEW.updated_at := now();
   END IF;
   RETURN NEW;
   ```
   트리거는 `CREATE OR REPLACE TRIGGER update_payment_orders_updated_at BEFORE UPDATE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION public.payment_orders_touch_updated_at();`로 바꾼다(PG17 지원). DROP TRIGGER는 ACCESS EXCLUSIVE를 잡지만 이 방식은 SHARE ROW EXCLUSIVE만 잡는다. 이름이 같아 `prevent_payment_order_snapshot_update` 다음에 실행되는 순서가 유지된다. 공용 `update_updated_at_column`(7곳 사용)은 건드리지 않는다.
2. 그러면 claim이 updated_at을 바꾸지 않게 되어, `ORDER BY po.updated_at` 순서가 순환하지 않는다. 특히 표식 대상은 `next_reconcile_at`과 무관하게 매번 후보가 되므로 같은 주문만 계속 잡힐 수 있다. 그래서 `claim_payment_reconciliation_batch`의 정렬을 `ORDER BY po.last_reconciled_at ASC NULLS FIRST, po.updated_at ASC, po.id ASC`로 바꾼다(그 외 본문 그대로). `record_payment_reconciliation_result`가 처리할 때마다 `last_reconciled_at`을 갱신하므로 지금의 순환 동작이 명시적으로 유지된다.

**영향**
- 주문 상태가 바뀌는 갱신은 지금처럼 updated_at이 갱신된다.
- 페이앱 health는 ppt 시각을 쓰므로 영향이 없다. 주문 12건이라 jsonb 비교 비용은 무시할 수 있다.

### 2.12 'running'으로 남는 대사 run (대사 REC-4)

**원인**
- 운영 `start_payment_reconciliation_run`은 리스가 만료되면 새 리스만 잡는다. 이전 run 행을 닫지 않고 `consecutive_failures`도 올리지 않는다.
- 현재 running 82행(2026-09-14 이후 없음)이다.

**변경**
1. `start_payment_reconciliation_run`, 리스 획득 분기(`IF … lease_expires_at > v_now` 다음):
   ```sql
   -- 끝나지 않은 채 리스가 만료된 run을 닫는다. 직전 리스 주인이었으면 연속 실패로 센다.
   UPDATE public.payment_reconciliation_runs
      SET status = 'failed',
          completed_at = v_now,
          last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED',
          last_error_message = '대사 작업이 끝나지 않은 채 리스가 만료되었습니다.'
    WHERE status = 'running' AND lease_expires_at <= v_now;

   v_abandoned := v_scheduler.lease_owner IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.payment_reconciliation_runs
      WHERE id = v_scheduler.lease_owner AND last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED' AND completed_at = v_now);
   ```
   - 이어지는 스케줄러 UPDATE에 `consecutive_failures = consecutive_failures + CASE WHEN v_abandoned THEN 1 ELSE 0 END`, `last_error_code`(abandoned일 때만)를 추가한다.
   - status CHECK에 'failed'가 이미 있으므로 제약 변경은 없다.
2. 부분 인덱스 `CREATE INDEX payment_reconciliation_runs_running_idx ON public.payment_reconciliation_runs (lease_expires_at) WHERE status = 'running';`. 2만 행 seq scan을 피한다.
3. 백필: 마이그레이션에서 위와 같은 UPDATE로 현재 82행을 닫는다. 스케줄러는 건드리지 않는다(과거 건을 연속 실패로 세지 않음).

**정합성**
- 느리지만 살아 있는 run이 닫힌 뒤 `finish`를 부르면 `status <> 'running'`이라 `already_completed`로 끝난다. 스케줄러 갱신은 `lease_owner = p_run_id` 조건이라 새 run을 방해하지 않는다.
- `record_payment_reconciliation_result`의 run 카운터 갱신은 `status='running'` 조건이라 무시되고, 주문 쪽 기록은 그대로 된다. 그래서 닫힌 run이 그 뒤에 처리한 결과는 run 행 카운터에 남지 않는다(7절 13).
- 동시 실행은 지금도 리스 만료 시 생기므로 새로 생기는 위험은 없다.

**함수 실행 시간 상한(2회차 지급 검증 권고 반영)**
- `src/app/api/internal/payments/reconcile/route.ts`에는 `maxDuration`이 없다(src 전체에서 `maxDuration`은 마켓 이미지·시험지 PDF route 두 곳뿐). Vercel 함수 제한이 리스(4분)보다 짧으면 강제 종료된 run이 이제 abandoned로 세어지고 3회 연속이면 페이앱 판매가 꺼진다. 운영 running 82행(2026-09-14까지)이 과거 강제 종료 흔적일 수 있다.
- 이 route에 `export const maxDuration = 300`을 추가한다(리스 240초보다 길게). abandoned 집계는 마이그레이션 1부터 동작하므로, 이 한 줄은 커밋 B가 아니라 커밋 A에 넣어 **마이그레이션 1보다 먼저 배포**한다(4.2). 옛 DB와도 무관한 설정이라 호환 문제가 없다.
- 커밋 A 배포 전에 Vercel 프로젝트 설정(플랜·fluid compute)이 300초를 허용하는지 확인하고 결과를 `docs/payapp-db-migration-checklist.md`에 적는다. 허용 최대치가 240초보다 짧으면 마이그레이션 1을 적용하지 않고, 대사 `limit`을 그 시간 안에 끝나도록 줄이는 안을 따로 정한 뒤 진행한다.
- 6.3 적용 뒤 확인에 "30분 동안 abandoned 0건"을 둔다.

**영향**
- 계속 중단되면 3회 뒤 health가 페이앱을 끈다(의도).
- 성공 run 하나가 0으로 되돌린다.

### 2.13 health 페이앱 경보 한 코드만 (대사 REC-5)

**원인**
운영 health가 `IF unfulfilled / ELSIF cancel_active / ELSIF money_review`로 code 하나만 정해 INSERT한다. 그래서 위급한 `PAYAPP_CANCEL_UNPROCESSED`가 가려진다.

**변경**
- 판매 차단 판단(`v_payapp_disable`)과 `change_ticket`(첫 code)은 그대로 둔다.
- 경보 INSERT를 조건마다 따로 한다(`v_payapp_unfulfilled_count > 0` → PAID_UNFULFILLED, `v_payapp_cancel_active_count > 0` → CANCEL_UNPROCESSED, `v_payapp_money_review_count > 0` → MONEY_RISK_REVIEW). 각각 새 ON CONFLICT 대상(2.2)과 기존 문구·details를 쓴다.
- 조건별 INSERT도 `DO NOTHING`이라 details의 건수는 경보가 처음 생긴 시점 값이고 이후 갱신되지 않는다(금전 영향 없음). 런북(6.6)에 현재 건수는 질의로 다시 확인하라고 적는다.
- 이 분기들은 돈 위험 조건이 처음 참이 될 때 처음 실행된다. plpgsql은 ON CONFLICT 추론을 실행 시점에만 검사하므로, 대상 식에 오타가 있으면 바로 그 순간 health가 예외를 내고 판매 차단 UPDATE까지 함께 롤백된다(7절 21). 그래서 합성 리허설(6.1-10)에서 모든 분기를 한 번씩 실행하고, 계약 테스트(5.1)가 7곳의 대상 식이 인덱스 정의 식과 글자 그대로 같은지 검사한다.
- 스케줄러 이상 경보는 기존 블록이 남기므로 그대로 둔다.

### 2.14 크레딧 RPC 커밋 뒤 TS 후처리 실패·경합 (DB CREDIT-1, CREDIT-3)

**원인**
- `src/lib/credits.ts:223-227`(deduct)과 `:300-304`(refund)는 RPC가 커밋된 뒤 `finalizeCreditBalanceMutation` → `syncProfileBalanceCacheFromLedger`(`credit-balance.ts:175-191`, 잠금 없이 읽고 UPDATE, 실패 시 throw)를 부른다.
- 그래서 커밋된 차감을 호출자가 실패로 본다. `questions/generate/route.ts:349-361`은 402를 주고 환불하지 않는다. 마켓 환불에는 거짓 '크레딧 복구 실패' 기록이 남는다.
- 경합 시에는 오래된 값으로 profiles.credits를 덮고 거짓 불일치 알림을 보낸다.
- 운영 `consume_credits`·`refund_credits`(2.5 이후)는 이미 profiles 잠금 아래 profiles.credits를 원장 값으로 맞춘다.

**변경(`credits.ts`)**
- 새 내부 함수 `reportCreditBalanceAfterMutation(userId, context)`:
  ```ts
  try {
    const snapshot = await getCreditBalanceSnapshot(userId)
    if (snapshot.hasMismatch) await reportCreditBalanceMismatch(context, userId, snapshot)
  } catch (error) {
    console.error('[CreditService] post-commit balance check failed', { context, userId })
  }
  ```
- `deductCredits`·`refundCredits`는 `finalizeCreditBalanceMutation` 대신 이 함수를 부른다. 반환 잔액은 RPC의 `new_balance`로 한다(같은 원장 공식).
- `finalizeCreditBalanceMutation`·`syncProfileBalanceCacheFromLedger`는 `purchaseCredits`(src 호출 0곳, 기존 미사용 코드)만 쓰게 된다. 지우지 않는다(3절 원칙). 마지막 보고에서 미사용 코드로 언급한다.

**정합성**
- RPC 커밋 여부 = 호출자의 성공 판단. 커밋 뒤 실패할 수 있는 후속 호출은 모두 로그만 남긴다.
- profiles.credits는 RPC 안에서 profiles 잠금 아래로만 쓰이므로 덮어쓰기 경합이 없어진다.
- RPC 응답 자체가 유실되는 경우는 남는다(7절).

**영향**
- 화면 잔액이 RPC 반환값으로 바뀐다. 같은 공식이라 값은 같다.

### 2.15 관리자 크레딧 지급 (DB CREDIT-4)

**원인**
- `credits.ts:396-458 grantCreditsAsAdmin`이 원천 insert(커밋) → 동기화 → payment_history·credit_transactions insert를 따로 한다. 뒤 두 insert의 실패는 로그만 남긴다.
- `admin/users/credits/route.ts`에 멱등키가 없어, 재전송·더블클릭이면 두 번 지급된다.

**변경**
- 새 함수 `public.grant_admin_credits(p_user_id uuid, p_amount integer, p_source_category text, p_payment_method text, p_operation_key text) RETURNS jsonb`, SECURITY DEFINER, `SET search_path TO 'public', 'pg_temp'`, service_role 전용.
  1. 입력 검사: amount 1~10000, category ∈ (admin_grant, bonus, system_refund), operation_key 1~120자. 아니면 `ADMIN_GRANT_INPUT_INVALID`.
  2. `profiles` FOR UPDATE(없으면 `CREDIT_USER_NOT_FOUND`).
  3. `credit_transactions`에서 `operation_key = p_operation_key`인 행을 찾는다(사용자 조건 없이).
     - 있고 `user_id`·`amount`·원천 `category`·`payment_history.payment_method`(그 거래의 `source_id`로 찾은 행)가 모두 요청과 같으면 `{already_granted: true, source_id, new_balance}`를 돌려준다. `payment_method`까지 비교해 TS 입력 전체와 판정이 맞게 한다(2회차 환불 검증 권고).
     - 하나라도 다르면 `ADMIN_GRANT_IDEMPOTENCY_CONFLICT`로 거부한다. 응답 유실 뒤 모달에서 금액·대상을 고쳐 같은 키로 다시 보내면, 옛 지급을 조용히 성공으로 돌려주지 않기 위해서다.
     - `operation_key` 단독 인덱스는 없다. `credit_transactions`는 수백 행 규모라 순차 탐색으로 충분하다. 다른 사용자 사이의 같은 키 경합은 uuid 키라 일어나지 않는다.
  4. `credit_sources` insert(plan_id NULL, initial=remaining=amount, status active, category). 지금 TS insert와 같은 열이고 expires_at은 지정하지 않는다.
  5. 원장 잔액을 다시 계산하고 `profiles.credits`를 쓴다.
  6. `payment_history` insert(amount 0, payment_method, status completed, source_id).
  7. `credit_transactions` insert(type 'purchase', amount, balance_after, description `format('크레딧 %s개 구매', to_char(p_amount, 'FM999,999,999'))`, source_id, operation_key). 문구·type은 지금 TS와 같게 둔다.
  8. `{already_granted: false, source_id, new_balance}`를 돌려준다.
  - 유니크 인덱스 `uq_credit_transactions_user_operation_key`가 이중 방어다.
- TS:
  - `grantCreditsAsAdmin(userId, credits, sourceCategory, paymentMethod, operationKey)`가 RPC를 부르고 `reportCreditBalanceAfterMutation`을 쓴다.
  - route `GrantCreditSchema`에 `idempotencyKey: z.string().uuid()`(필수)를 추가하고, `admin_grant:${idempotencyKey}`를 넘긴다. `already_granted`면 사용자 알림을 다시 보내지 않고 성공을 응답한다. `ADMIN_GRANT_IDEMPOTENCY_CONFLICT`는 409와 `이전 요청과 내용이 다릅니다. 창을 닫고 다시 열어 지급하세요.`로 응답한다.
  - 클라이언트 `admin/users/users-client.tsx`(`openGrantModal`)와 `admin/credits/grant-credit-dialog.tsx`(대상 선택 시)에서 `crypto.randomUUID()`로 키를 만들어 state에 두고 body에 넣는다. 성공 뒤에는 새 키를 만든다.

**정합성**
- 원천·결제이력·거래·캐시가 한 트랜잭션이다.
- 같은 키의 재요청은 프로필 잠금 뒤 기존 거래를 찾아 그대로 돌려준다.
- 응답 유실 뒤 같은 모달에서 다시 눌러도 한 번만 지급된다.

**영향**
- route·클라이언트가 같은 빌드로 배포되므로 필수 필드로 둔다. 배포 순간 열려 있던 옛 화면은 400을 받고, 새로고침하면 된다.

### 2.16 원장 CHECK 제약 (DB DB-1)

**변경(검증된 제약으로 바로 추가, 사전 점검 뒤)**
```sql
ALTER TABLE public.credit_sources
  ADD CONSTRAINT credit_sources_initial_credits_positive CHECK (initial_credits > 0),
  ADD CONSTRAINT credit_sources_remaining_credits_range CHECK (remaining_credits >= 0 AND remaining_credits <= initial_credits);
ALTER TABLE public.credit_consumption
  ADD CONSTRAINT credit_consumption_amount_positive CHECK (amount > 0);
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_credits_nonnegative CHECK (credits >= 0);
ALTER TABLE public.payment_history VALIDATE CONSTRAINT payment_history_amount_charge_limit;
```
- 사전 점검 DO 블록: 각 위반 건수가 0이 아니면 `RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: <제약> violated (<n> rows)'`.
- 현재 쓰기 경로는 모두 이 범위를 지킨다.
  - `consume_credits`: LEAST 차감, v_deduct>0
  - `refund_credits`: LEAST 상한
  - `complete_manual`: BETWEEN 검사
  - 지급: 요금제 최소 10000, 관리자 1~10000
- 테이블이 작아(14·36·332행) ACCESS EXCLUSIVE 보유 시간은 트랜잭션 길이(1초 미만)뿐이다.

### 2.17 레거시 함수 `*_credits_once` (DB DB-2)

**변경**
```sql
DROP FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text);
DROP FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer);
```
- CASCADE 없이 지운다.
- 사전 점검: md5가 1.4 값과 같은지, 다른 함수 본문에 `_credits_once(` 참조가 없는지 확인한다(현재 0). 두 함수 자신의 머리(`CREATE OR REPLACE FUNCTION public.consume_credits_once(`)도 이 문자열에 걸리므로 반드시 자기 자신을 뺀다. 빠뜨리면 마이그레이션 2가 운영에서 항상 멈춘다.
  ```sql
  SELECT count(*) INTO v_refs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname NOT IN ('consume_credits_once', 'refund_credits_once')
     AND pg_get_functiondef(p.oid) ILIKE '%_credits_once(%';   -- '_'는 와일드카드라 더 넓게 걸릴 뿐 빠뜨리지 않는다
  IF v_refs > 0 THEN RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: _credits_once referenced by % functions', v_refs; END IF;
  ```
- `src/types/supabase.ts`의 두 함수 타입 항목을 지운다.
- `tests/payapp-migration-a-contract.test.mjs:264-268`은 이미 적용된 마이그레이션 A 파일의 `to_regprocedure … IS NOT NULL` 가드를 검사하므로 바꾸지 않는다.

---

## 3. 마이그레이션 구성

### 3.1 파일과 순서
| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | `supabase/migrations/20261110100000_payment_integrity_fixes.sql` | 2.1(health 부분), 2.2, 2.3(DB), 2.7(DB), 2.8(DB), 2.9(DB), 2.11, 2.12, 2.13 |
| 2 | `supabase/migrations/20261110110000_credit_ledger_integrity.sql` | 2.5, 2.6(DB), 2.15(DB), 2.16, 2.17 |
| 3 | `supabase/migrations/20261110120000_payapp_launch_switch.sql` (기존 `20261021110000_payapp_launch_switch.sql`을 `git mv`) | 사전 점검·스위치 동작은 그대로(2.4). 버전 문자열만 갱신 |

- launch switch는 아직 적용되지 않았고, 수정 마이그레이션이 그보다 먼저 적용되어야 한다. 그래서 파일 이름(버전)을 수정 마이그레이션 뒤로 옮긴다. 파일 이름 순서가 적용 순서와 같아야 `schema_migrations`가 거꾸로 기록되지 않는다.
- 롤백 파일도 `supabase/rollback/20261110120000_payapp_launch_switch_down.sql`로 옮긴다.
- 옮기면서 옛 버전이 남은 문자열을 새 버전으로 바꾼다. `payment_runtime_config` 감사 값이 실제 적용 버전과 맞아야 하기 때문이다.
  - 마이그레이션 `changed_by = 'migration_20261021110000_payapp_launch_switch'`(37행) → `'migration_20261110120000_payapp_launch_switch'`
  - 머리 주석의 롤백 경로(9행) → 새 롤백 파일 이름
  - 롤백 파일 1행 주석과 `changed_by = 'rollback_20261021110000_payapp_launch_switch'`(15행) → `rollback_20261110120000_…`
  - 계약 테스트 정규식(`'[^']+'`)은 그대로 통과한다. 5행의 과거 기록 주석(`codex_phase6_local_ui_check`)은 사실 기록이라 바꾸지 않는다.
- `tests/payapp-launch-switch-contract.test.mjs`는 접미사로 파일을 찾으므로 이름 변경에 영향이 없다.
- 문서의 옛 파일명 참조(`docs/payapp-db-migration-checklist.md`, `docs/payapp-activation-plan.md` 등)를 새 이름으로 바꾼다.
- 2는 1 뒤에만 적용한다. 2의 `refund_credits`·`approve_market_refund`가 남기는 경보는 1의 새 키(`dedupe_key`)로 따로 세어야 하기 때문이다. 2의 사전 점검이 `payment_reconciliation_alerts_active_key` 존재를 확인하고, 없으면 멈춘다.
- 둘 다 현재 배포 코드(0adda5e)와 호환된다. 단, 2 적용부터 커밋 B 배포 확인까지는 마켓 환불 승인·관리자 지급을 하지 않는다(4.2, 6.2). 각각 한 트랜잭션이다.
- 롤백은 반대 방향으로만 한다. 1은 2가 롤백된 뒤에만 롤백한다(3.6 롤백 1 사전 점검).
- `schema_migrations`의 version이 파일 이름과 같게 기록되어야 한다. `apply_migration`은 적용 시각으로 version을 만든다. 그래서 기존 체크리스트(`docs/payapp-db-migration-checklist.md` 237행)처럼 SQL Editor에서 파일 전체와 `supabase_migrations.schema_migrations` INSERT(version = 파일 이름의 숫자, name, statements = 파일 원문)를 한 번에 실행한다(6.2).

### 3.2 공통 머리
```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
```
- BEGIN/COMMIT·CASCADE는 쓰지 않는다(기존 계약 테스트 관례).
- 적용은 대사 cron(5분) 직후에 한다. 운영 pg_cron 잡은 둘이고 둘 다 `*/5 * * * *`다(2026-11-10 `cron.job` 조회): 대사 HTTP 호출 `payment-reconciliation-http-5m`, health 직접 호출 `payment-reconciliation-health-5m`(`SELECT public.enforce_payment_reconciliation_health();`). **두 잡의 실행이 끝난 직후** 적용한다. 마이그레이션 1이 alerts 잠금을 쥔 동안 기다리던 health·`record_payment_alert` 호출은 커밋 뒤 옛 `ON CONFLICT (code)` 계획으로 한 번 실패할 수 있다(finish 1회 실패 또는 TS 경보 1건 유실, 3회차 마이그레이션 검증). 적용 뒤 `cron.job_run_details`로 health 잡 성공을 확인한다(6.3).

### 3.3 마이그레이션 1이 바꾸는 객체
운영 앱의 잠금 순서(finish → health: payment_orders 읽기 뒤 alerts insert)에 맞춰 payment_orders → runs → alerts 순으로 잡는다.
1. 사전 점검 DO 블록: 함수 8개 md5(1.4), `payment_reconciliation_alerts_active_code_key` 존재, `pg_get_triggerdef`(트리거 `update_payment_orders_updated_at`)가 `CREATE TRIGGER update_payment_orders_updated_at BEFORE UPDATE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`과 같은지(롤백 1이 이 정의로 되돌리므로 출발점도 확인한다, 2회차 마이그레이션 검증 권고). 문자열은 리허설에서 운영 값을 그대로 읽어 파일에 적는다.
2. 새 함수 `payment_orders_touch_updated_at()`(트리거 함수, SECURITY INVOKER, 다른 새 함수와 같게 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. 운영 기본 권한이 새 함수에 anon·authenticated EXECUTE를 주기 때문이다. 트리거 함수는 직접 호출할 수 없어 실제 위험은 없고 advisor 경고·계약 테스트 일관성용이다, 3회차 마이그레이션 검증 권고). `CREATE OR REPLACE TRIGGER update_payment_orders_updated_at …`(2.11).
3. 인덱스 `payment_reconciliation_runs_running_idx`, `payment_webhook_events_ignored_cancel_idx`(2.1). 이벤트 테이블은 6행이라 SHARE 잠금 시간은 무시할 수 있다(그동안 웹훅 insert만 대기).
4. 백필: running 82행 → failed(`PAYMENT_RECONCILIATION_RUN_ABANDONED`). `GET DIAGNOSTICS`로 건수를 `RAISE NOTICE`로 남긴다.
5. 인덱스: DROP `payment_reconciliation_alerts_active_code_key`, CREATE `payment_reconciliation_alerts_active_key`.
6. 함수(CREATE OR REPLACE, 모두 `SECURITY DEFINER`·`SET search_path TO 'public', 'pg_temp'` 명시): `record_payment_alert`, `enforce_payment_reconciliation_health`, `process_payapp_cancellation`, `complete_manual_point_charge_refund`, `apply_payapp_feedback`, `claim_point_charge_refund`, `start_payment_reconciliation_run`, `claim_payment_reconciliation_batch`.
7. 사후 점검(같은 트랜잭션 끝): 정규식 `pg_get_functiondef(p.oid) ~* 'on\s+conflict\s*\(\s*code\s*\)'`에 걸리는 public 함수가 0개인지(2.2, literal ILIKE 금지), running이면서 리스가 만료된 run이 0인지, 8개 함수가 모두 `prosecdef`이고 `proconfig`에 search_path가 있는지 확인하고, 아니면 RAISE.

잠금은 payment_orders(트리거 교체 SHARE ROW EXCLUSIVE, 12행), runs(SHARE, 인덱스 생성·백필 ROW EXCLUSIVE), alerts(DROP INDEX ACCESS EXCLUSIVE, 4행) 순으로 걸리고, 모두 트랜잭션 끝까지 유지된다. 그래도 교착이 나면 롤백이라 안전하고, cron 직후 다시 적용한다.

### 3.4 마이그레이션 2가 바꾸는 객체
1. 사전 점검: `refund_credits`·`*_once` md5, 원장 위반 건수 5종(2.16), `_credits_once(` 참조 0(자기 자신 제외, 2.17), `payment_reconciliation_alerts_active_key` 존재(마이그레이션 1 적용 확인).
2. 제약: `consume_credits`의 잠금 순서(profiles → credit_sources)에 맞춰 profiles → credit_sources → credit_consumption → payment_history 순으로 ALTER한다(제약 4개 추가, `payment_history_amount_charge_limit` VALIDATE).
   - `ADD CONSTRAINT`는 ACCESS EXCLUSIVE를 잡고 COMMIT(리허설은 ROLLBACK)까지 유지한다. 운영 RLS 정책 15개와 헤더가 profiles를 읽으므로, 첫 ALTER부터 끝까지(그 사이 다른 ALTER의 잠금 대기가 각각 최대 3초) 사이트 전반의 요청과 웹훅 지급 경로가 멈춘다. 교착은 롤백이라 안전하다. 그래서 적용·큰 리허설 모두 저트래픽 시간, 대사 cron 직후에 SQL Editor에서 한 번에 실행되는 단일 배치로 짧게 하고, 리허설에서 전체 실행 시간을 기록한다(6.1, 6.2).
   - `payapp_fulfill_order_internal`은 credit_sources INSERT 뒤 profiles를 갱신할 수 있다. 판매가 켜진 상태에서 적용하면 이 ALTER 순서(profiles → credit_sources)와 교착할 수 있다(어느 쪽이 롤백되든 정합성은 안전). 그래서 마이그레이션 2는 **페이앱 판매가 꺼진 동안(`payapp_accepts_new_orders=false`)에만** 적용·리허설한다. 지금 순서(launch switch보다 먼저)는 이 조건을 만족한다(6.2, 3회차 마이그레이션 검증 권고).
3. 함수: `refund_credits` 교체. 새 함수 `approve_market_refund`, `grant_admin_credits`(+REVOKE/GRANT). 셋 다 `SECURITY DEFINER`·`SET search_path TO 'public', 'pg_temp'` 명시.
4. DROP 함수 2개.
5. 사후 점검: 세 함수 `prosecdef`·`proconfig`, 새 함수 ACL에 anon·authenticated 없음.

### 3.5 데이터 백필·현재 데이터 처리
- running 82행: 마이그레이션 1에서 닫는다.
- NOT VALID 제약: 마이그레이션 2에서 VALIDATE한다(위반 0 확인됨, 사전 점검이 다시 확인).
- 미해소 경보 1건: 마이그레이션에서 건드리지 않는다. 적용 뒤 관리자 화면에서 해소한다(6.5). 새 키에서도 유일하므로 인덱스 생성에 영향이 없다.
- 기존 approved 마켓 환불 1건은 이미 일관되므로 처리할 것이 없다.

### 3.6 롤백 파일
- `supabase/rollback/20261110100000_payment_integrity_fixes_down.sql`
  - 머리 SET LOCAL 동일.
  - 사전 점검: 미해소 경보 중 code가 같은 행이 2개 이상이면 `RAISE 'ROLLBACK_PRECHECK: duplicate unresolved alerts per code — resolve extras first'`. 옛 유니크 인덱스를 다시 만들 수 없기 때문이다.
  - 함수 8개를 1.4의 현재 정의(운영 `pg_get_functiondef` 원문)로 되돌린다. 파일 머리 주석에 md5를 적고, 계약 테스트가 원문과 비교한다.
  - 사전 점검(2회차 환불 검증 차단 3): 마이그레이션 2가 이미 롤백되었는지 확인한다. `refund_credits`의 md5가 원문 `6a082ed597597efdbb688225076a3996`이 아니거나, `to_regprocedure('public.approve_market_refund(uuid,uuid,text,integer)')`·`to_regprocedure('public.grant_admin_credits(uuid,integer,text,text,text)')` 중 하나라도 NULL이 아니면 `RAISE EXCEPTION 'ROLLBACK_PRECHECK: roll back 20261110110000 first'`. 마이그레이션 2가 남은 채 롤백 1만 하면 `record_payment_alert`가 `ON CONFLICT (code)`와 옛 code 단위 인덱스로 돌아가, 미해소 1건이 있는 동안 새 `refund_credits`·`approve_market_refund`의 `CREDIT_REFUND_SOURCE_SKIPPED`·`MARKET_REFUND_SHORTFALL`이 `dedupe_key`를 무시당해 DO NOTHING이 된다. 그러면 "되돌리지 못한 크레딧은 호출마다 지워지지 않는 기록으로 남는다"는 2.5·2.6의 전제가 깨지고 건너뛴 양이 경보 없이 사라진다.
  - 새 인덱스 DROP, 옛 인덱스 CREATE. 트리거를 `CREATE OR REPLACE TRIGGER … EXECUTE FUNCTION update_updated_at_column()`으로 되돌린 뒤 `payment_orders_touch_updated_at`·`payment_reconciliation_runs_running_idx`·`payment_webhook_events_ignored_cancel_idx`를 DROP한다. 잠금 순서는 마이그레이션과 같게(payment_orders → runs → alerts) 둔다.
  - 백필된 run 상태와 DB가 남긴 경보는 되돌리지 않는다(기록 데이터).
- `supabase/rollback/20261110110000_credit_ledger_integrity_down.sql`
  - 순서: 새 코드를 먼저 되돌린 뒤 실행한다. 새 코드는 `approve_market_refund`·`grant_admin_credits`를 쓰기 때문이다.
  - `refund_credits`를 원문(md5 6a082ed5…)으로 되돌리고, 새 함수 2개와 제약 4개를 DROP한다.
  - `*_once` 2개를 운영 원문(md5 1.4)으로 다시 만들고 `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`로 지금 ACL과 같게 한다.
  - `payment_history_amount_charge_limit`은 검증 상태 그대로 둔다(되돌릴 필요 없음).
- 롤백 순서(둘 다 적용된 경우): **커밋 B 되돌림 배포 → 롤백 2 → 롤백 1**. 롤백 1의 사전 점검이 이 순서를 강제한다(6.4).
- launch switch 롤백은 이름과 버전 문자열(3.1)만 바뀐다.
- 마이그레이션 2 롤백의 옛 `refund_credits`는 `skipped`를 돌려주지 않는다. 롤백 순서상 새 코드가 먼저 되돌려지므로 읽는 곳이 없다.
- 롤백 파일은 기존 관례대로 `supabase_migrations.schema_migrations` 행을 지우지 않는다. 그래서 롤백 뒤 고친 마이그레이션 1·2를 **같은 version으로** SQL Editor에서 다시 적용하면, 함께 실행하는 `schema_migrations` INSERT가 PK 충돌로 배치 전체를 롤백한다. 재적용은 (가) 같은 배치 앞에서 해당 version 행을 `DELETE`하거나 (나) 새 version 파일로 한다. 어느 쪽인지는 재적용 계획에서 정하고 승인받는다(6.4, 3회차 마이그레이션 검증 권고).

---

## 4. 코드 변경 목록과 호환성

### 4.1 변경 목록
| 파일 | 함수·위치 | 변경 | 절 |
|---|---|---|---|
| `src/lib/payapp-webhook-server.ts` | `handlePayAppFeedback` apply 오류 분기(:395-399) | `PAYAPP_FEEDBACK_APPLY_FAILED` 경보 추가 | 2.1 |
| 같은 파일 | ignored 분기(:446-463) | 취소 계열(9·64·70·71)은 ignored·order_not_found 모두 severity critical, notifyAdmins true | 2.9 |
| `src/app/api/internal/payments/reconcile/route.ts` | 파일 머리 | `export const maxDuration = 300` (커밋 A, 마이그레이션 1보다 먼저 배포) | 2.12 |
| `src/lib/payment-reconciliation-server.ts` | `reconcilePayAppPayment` ready 분기(:729-743) | READY_CANCEL_FAILED 메시지에 마지막 오류 코드 | 2.10 |
| `src/lib/point-charge-refunds-server.ts` | `ClaimedPointChargeRefund` | `manual_review_required?: boolean` | 2.8 |
| `src/lib/point-charge-refund-processor.ts` | `processPointChargeRefund`(:236 이후) | manual_review_required면 페이앱 호출 없이 반환 | 2.8 |
| `src/app/api/admin/refunds/route.ts` | PATCH approve(:214-239)·complete_manual(:157-175) | 수동 전환 문구, 이중환불 의심 409 | 2.7, 2.8 |
| `src/lib/payment-review-actions.ts` | `refundRequiresRecovery` | `cancelMarker` 입력, true면 false | 2.3 |
| `src/app/(admin)/admin/refunds/page.tsx` | 환불 요청 select | `transaction.cancel_feedback_recorded_at` 추가 | 2.3 |
| `src/app/(admin)/admin/refunds/refunds-client.tsx` | `RefundRequest` 타입, `requiresRecovery` | cancelMarker 전달 | 2.3 |
| `src/lib/market-refunds.ts` | `approveMarketRefund`(:496-585) | RPC `approve_market_refund` 한 번으로 교체, `confirmedRefundCredits` 입력, 새 `MarketRefundShortfallError`, 오류 매핑(40P01·40001 포함) | 2.6 |
| `src/app/api/admin/market/refunds/[id]/route.ts` | `BodySchema`, PATCH | `confirmedRefundCredits` 선택 필드, 부족분 409 응답(`code`, `requested`, `restorable`) | 2.6 |
| `src/app/(admin)/admin/refunds/market-refunds-client.tsx` | 승인 요청(:41 근처) | 부족분 응답이면 확인 창 → `confirmedRefundCredits`로 재요청 | 2.6 |
| `src/app/api/generate/listboard-jobs/[jobId]/run/route.ts` | 실패 환불(:387-396) | `refundCredits`를 try/catch로 감싸고 job 마감 계속 | 2.5 |
| `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts` | 실패 환불(:452-461) | 같은 처리 | 2.5 |
| `src/lib/credits.ts` | `deductCredits`·`refundCredits`·`grantCreditsAsAdmin`, 새 `reportCreditBalanceAfterMutation` | 커밋 뒤 실패 무시, 지급 RPC, `refundCredits` RPC 오류 시 `CREDIT_REFUND_FAILED` 경보 후 기존대로 throw | 2.5, 2.14, 2.15 |
| `src/app/api/admin/users/credits/route.ts` | `GrantCreditSchema`, POST | `idempotencyKey` 필수, already_granted 처리, `ADMIN_GRANT_IDEMPOTENCY_CONFLICT` 409 | 2.15 |
| `src/app/(admin)/admin/users/users-client.tsx`, `src/app/(admin)/admin/credits/grant-credit-dialog.tsx` | 지급 요청 | `crypto.randomUUID()` 키 전송 | 2.15 |
| `src/types/supabase.ts` | Functions | `approve_market_refund`·`grant_admin_credits` 추가, `*_credits_once` 삭제. 적용 뒤 `generate_typescript_types` 결과와 대조 | 2.6, 2.15, 2.17 |
| `docs/payapp-db-migration-checklist.md` | 운영 절차 | 6.5 UNAUTHORIZED 해소 절차·6.6 런북·6.7 확인 항목 추가, launch switch 파일명 갱신 | 2.1, 2.4 |

TS 변경이 없는 항목: 2.2(TS는 `record_payment_alert`만 부름), 2.3의 경보 부분, 2.4, 2.5의 DB 부분, 2.8 변경 2(기존 `already_quarantined` 결과 재사용), 2.11~2.13, 2.16, 2.17(타입 제외).

### 4.2 호환성
| 조합 | 결과 |
|---|---|
| 옛 코드(0adda5e) + 새 DB | 동작함. `record_payment_alert` 시그니처 동일. claim의 수동 전환은 옛 TS에서 409 문구로 끝나고 paycancel하지 않음(2.8). complete_manual의 새 키는 무시되지만 경보는 DB에 남음. 새 `refund_credits`는 복구 불가 원천을 예외 없이 건너뛰고 경보를 남김. 옛 `approveMarketRefund`가 이것을 부르면 approved·이용권 refunded가 되지만 `approved_refund_credits`는 요청량 그대로 기록되어 실제 복구량과 어긋날 수 있음. 그래서 마이그레이션 2 적용부터 커밋 B 배포 확인까지 마켓 환불 승인을 멈춘다(6.2, 필수). 관리자 지급 중지는 DB 충돌 때문이 아니다. 옛 `grantCreditsAsAdmin`은 마이그레이션 2가 바꾸는 객체를 부르지 않고 새 CHECK(1~10000 지급)와도 충돌하지 않는다. 원래부터 비원자·비멱등 경로라 이 구간에 굳이 쓰지 않는 예방 조치다. 두 중지 모두 구간을 짧게 잡는다(마이그레이션 2 적용 직후 커밋 B push). 2.8 변경 2는 기존 결과 이름이라 옛 TS가 그대로 처리함. 승인취소 표식 건은 옛 화면에서 부분 회수 입력 시 DB가 거부하므로 남은 크레딧을 입력하면 됨. `*_once` 삭제는 호출처 없음. |
| 새 코드 + 옛 DB | 지원하지 않음. `approve_market_refund`·`grant_admin_credits`가 없어 마켓 환불 승인·관리자 지급이 실패함. |

필수 배포 순서는 다음과 같다(메모리 규칙: DB 단계는 앞 코드가 배포된 뒤).
1. 운영 배포가 HEAD(0adda5e)와 같은지 확인한다.
2. 커밋 A(마이그레이션 3개·롤백·계약 테스트·문서, 그리고 대사 route의 `maxDuration = 300` 한 줄)를 push하고 배포한다. `maxDuration` 외에는 런타임 변경이 없고, 그 한 줄은 옛 DB와도 호환된다. 마이그레이션 1의 abandoned 집계(2.12)가 동작하기 전에 배포되어 있어야 한다.
3. 마이그레이션 1·2 리허설 → 승인 → 적용 → 사후 확인(6절).
4. 커밋 B(TS 변경·타입·행동 테스트)를 push하고 배포한다. push 시점은 사용자가 정한다.
5. launch switch는 기존 출시 절차대로 나중에 적용한다.

---

## 5. 테스트 계획 (오프라인, `node --test tests/*.test.mjs`)

### 5.1 새 계약 테스트
- `tests/payment-integrity-migration-contract.test.mjs` (마이그레이션 1·롤백)
  - 머리 SET LOCAL 두 줄, BEGIN/COMMIT·CASCADE 없음, anon·authenticated GRANT 없음.
  - md5 사전 점검이 8개 함수 모두에 있고 재정의보다 앞선다.
  - 재정의 8개 함수 본문마다 `SECURITY DEFINER`와 `SET search_path TO 'public', 'pg_temp'`가 있다. 트리거 함수만 SECURITY INVOKER다.
  - 잠금 순서: 트리거 교체 → runs 인덱스·백필 → alerts DROP INDEX 순이고, `DROP TRIGGER`가 없으며 `CREATE OR REPLACE TRIGGER update_payment_orders_updated_at`이 있다.
  - 새 인덱스 식에 `details ->> 'dedupe_key'`가 세 번째 항으로 들어 있다.
  - 옛 인덱스 DROP과 새 인덱스 정의(식·WHERE)가 있고, 마이그레이션 안의 모든 `ON CONFLICT`가 새 대상이다. 검사는 literal이 아니라 정규식 `/on\s+conflict\s*\(\s*code\s*\)/i` 0회로 한다. health 본문 안의 새 대상 `ON CONFLICT`가 7곳(카카오 2, 2.13로 나뉜 페이앱 조건별 3, `PAYAPP_CANCEL_UNPROCESSED_FROZEN` 1, 2.1 `PAYAPP_FEEDBACK_UNPROCESSED` 1)이고, 사후 점검 DO 블록이 같은 정규식(`~*`)을 쓴다.
  - health 본문에서 대상 식 전체 문자열 `ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL`이 **정확히 7회** 나오고, 그 안의 식이 새 인덱스 정의 식과 글자 그대로 같다(3회차 지급 검증 권고, 2.13). 실행되지 않는 분기의 오타를 오프라인에서 잡기 위해서다.
  - 카카오 첫 블록의 `INSERT … SELECT … WHERE NOT EXISTS` 문장은 운영 원문과 같다(변경하지 않음, 2.2).
  - 사전 점검에 트리거 정의(`pg_get_triggerdef`) 비교가 있다.
  - `process_payapp_cancellation`: 6개 code의 `record_payment_alert` 호출이 있고, 안쪽 EXCEPTION 블록의 `END;` 뒤에 위치한다. 반환 jsonb에 `'payment_order_id'` 키가 남아 있다(2.3, TS 경보와 같은 키로 합쳐지는 근거). 관리자 결제확인 가드(`paid_feedback_recorded_at IS NULL AND … admin_paid_confirmed_at IS NOT NULL` → `already_quarantined`)가 `finalize_point_charge_refund` 분기보다 앞선다(2.8 변경 2). 경보 CASE에 `external_cancel_quarantined`·`paid_feedback_recorded_at IS NULL`·`admin_paid_confirmed_at IS NOT NULL` → `PAYAPP_CANCEL_AFTER_QUARANTINE` 줄과 reason `admin_confirmed_mul_no_unverified`가 있다(2.3).
  - `complete_manual_point_charge_refund`: `v_partial`에 `cancel_feedback_recorded_at IS NULL`이 있고, completed 분기에 bank_transfer·`payment_admin_actions`의 `external_method = 'bank_transfer'` NOT EXISTS 조건과 `dedupe_key` 경보가 있다.
  - `apply_payapp_feedback`: 잔액 price 허용식. 허용식의 `NOT (…)` 안에 `p_price IS NOT NULL`이 있어 price가 NULL이면 지금처럼 `PAYAPP_FEEDBACK_AMOUNT_MISMATCH`로 간다(2.9).
  - 트리거 함수 `payment_orders_touch_updated_at`에 `REVOKE ALL … FROM PUBLIC, anon, authenticated`가 있다(3.3-2).
  - `claim_point_charge_refund`: admin_paid_confirmed 분기가 `status = 'processing'` UPDATE보다 앞서고, manual_review로 바꾸며 `provider_transaction_id`를 NULL로 돌려준다.
  - `start_payment_reconciliation_run`: abandoned 닫기, lease_owner일 때만 연속 실패 증가.
  - 백필 UPDATE, runs 부분 인덱스.
  - health: 조건별 INSERT 3개, `PAYAPP_FEEDBACK_UNPROCESSED` 질의(`LIKE 'payapp:%'`, `NOT LIKE 'PROCESS:%'`, `latest_received_at` ack, ignored 취소 조건의 네 `event_type`과 `<> 'PAYAPP_FOREIGN_FEEDBACK'`). 판매 차단 UPDATE에 새 조건이 들어가지 않았는지.
  - 부분 인덱스 `payment_webhook_events_ignored_cancel_idx`(WHERE에 ignored와 네 event_type).
  - 트리거 함수의 기록 열 목록, 같은 트리거 이름 재생성, claim 정렬 `last_reconciled_at ASC NULLS FIRST`.
  - 롤백: 중복 경보 사전 점검, 마이그레이션 2 롤백 확인 사전 점검(`refund_credits` md5 `6a082ed5…`, `approve_market_refund`·`grant_admin_credits`의 `to_regprocedure` NULL, `ROLLBACK_PRECHECK`)이 다른 문장보다 앞섬, 옛 인덱스 복원, 8개 함수 원문 복원(파일 머리 md5 주석과 원문 길이 비교), 트리거 복원, 새 인덱스 2개 DROP.
- `tests/credit-ledger-integrity-migration-contract.test.mjs` (마이그레이션 2·롤백)
  - 세 함수(`refund_credits`, `approve_market_refund`, `grant_admin_credits`) 본문에 `SECURITY DEFINER`와 `SET search_path TO 'public', 'pg_temp'`가 있다.
  - 사전 점검에 `payment_reconciliation_alerts_active_key` 존재 확인과 `proname NOT IN ('consume_credits_once', 'refund_credits_once')` 제외가 있다.
  - `refund_credits`: 복구 불가 판정이 UPDATE보다 앞서고 RAISE가 아니라 `CONTINUE`이며 `v_skipped`를 더한다. `RETURNING remaining_credits` 기반 실제 증가량을 쓰고, 상한 차이(`v_skipped_capped`)와 루프 뒤 남은 양(`v_skipped_unmatched`)을 `v_skipped`에 더하며, `CREDIT_REFUND_SOURCE_SKIPPED` 경보(`dedupe_key`, 세 세부 키)와 반환 `skipped`가 있다. 항목에서 `v_item->>'source_id'`를 읽는 줄은 운영 원문 그대로다(2.6 정규화의 전제). `p_target_balance`가 profiles UPDATE·`balance_after`에 쓰이지 않는다(값을 넘기는 호출처는 `questions/generate/route.ts:111-119`의 7번째 위치 인자 `balanceBeforeGeneration`, 2.5). 거래 insert가 `v_total_refunded > 0` 조건 안에 있다.
  - `approve_market_refund`: profiles FOR UPDATE가 요청 FOR UPDATE보다 앞서고, `MARKET_REFUND_NOT_PENDING`, `market_download_events` 재검사, 잠근 행의 `credit_consumptions`(`source_id`·`sourceId` 둘 다) 읽기, `credit_sources … FOR UPDATE`, `MARKET_REFUND_SHORTFALL`, `p_confirmed_refund_credits` 비교, `v_restore_items`에 넣는 원소가 `jsonb_build_object('source_id', …, 'amount', v_alloc)` 형태이고 원래 요소(`e`)를 그대로 append하지 않음, `v_alloc > 0` 조건, `refund_credits(` 호출, `refunded`·`skipped` 비교와 `MARKET_REFUND_AMOUNT_MISMATCH`, 3개 테이블 refunded, `approved_refund_credits = v_restorable`, 부족분 경보가 있고 approved UPDATE가 상태 변경 뒤에 있다. `p_consumptions` 인자가 없다. REVOKE/GRANT 두 줄.
  - `grant_admin_credits`: 입력 검사, 프로필 잠금 뒤 operation_key 조회, 멱등 비교에 `payment_method` 포함, `ADMIN_GRANT_IDEMPOTENCY_CONFLICT`, 4개 insert/update, REVOKE/GRANT.
  - 제약 ALTER 순서가 profiles → credit_sources → credit_consumption → payment_history다.
  - 제약 4개 이름·식, VALIDATE 한 줄, 위반 사전 점검 5종.
  - DROP 2개(정확한 시그니처, CASCADE 없음).
  - 롤백: 역순 DROP, `refund_credits` 원문, `*_once` 원문과 ACL.
- `tests/payapp-launch-switch-contract.test.mjs` 수정
  - 사전 점검은 미해소 경보가 하나라도 있으면 멈추는 기존 조건 그대로다(UNAUTHORIZED 예외 없음, 2.4).
  - `changed_by`와 롤백 경로 주석이 새 버전(`20261110120000`)이다.
  - 마이그레이션 디렉터리 정렬에서 launch switch가 두 수정 마이그레이션보다 뒤다.

### 5.2 새·수정 행동 테스트
- `tests/payapp-webhook.test.mjs`
  - 새 테스트 `an apply failure records a critical PAYAPP_FEEDBACK_APPLY_FAILED alert and answers FAIL`
  - 새 테스트 `an ignored cancel notification is alerted as critical, other ignored ones stay warning`
  - 새 테스트 `a partial cancel without orig_mul_no or var1 is a critical alert that notifies admins`(사이트 밖 분기 조건은 그대로)
  - 기존 `a failed first attempt …`의 경보 기대값 갱신
- `tests/payapp-refund-processor.test.mjs`
  - 새 테스트 `a claim that requires manual review never calls paycancel or fail` (cancel·fail RPC 호출 0회, 반환 `manualReviewRequired: true`)
- `tests/payapp-reconciliation.test.mjs`
  - 기존 `expired payment requests are cancelled …` 확장: 2시간 뒤 READY_CANCEL_FAILED 메시지에 오류 코드가 포함된다.
- `tests/payment-review-actions.test.mjs`
  - 새 테스트 `a recorded full cancel forces full recovery even for partial cancel requests`
- `tests/credit-mutation-post-commit.test.mjs`(새, loadModule로 `credits.ts`에 스텁 주입)
  - consume RPC 성공 + snapshot RPC 실패 → `deductCredits`가 RPC `new_balance`로 정상 반환한다.
  - refund도 같다.
  - profiles UPDATE를 부르지 않는다.
  - refund RPC 오류 → `record_payment_alert`를 `CREDIT_REFUND_FAILED`·`dedupe_key`로 한 번 부르고 기존 오류를 그대로 던진다. 같은 `resourceId`로 두 번 실패하면 두 호출의 `dedupe_key`가 다르다(`crypto.randomUUID()`, 리소스 id를 키에 쓰지 않음). details에 `description`이 들어간다. 경보 RPC도 실패하면 원래 오류가 그대로 던져진다.
- `tests/reconcile-route-duration.test.mjs`(새, 소스 계약): 대사 route에 `export const maxDuration = 300`이 있다(리스 240초보다 큼).
- `tests/market-refund-approve-rpc.test.mjs`(새)
  - `approveMarketRefund`가 `approve_market_refund`를 한 번 부르고 테이블 직접 update를 하지 않는다.
  - `MARKET_REFUND_NOT_PENDING`이면 `MarketRefundConflictError`가 된다.
  - `MARKET_REFUND_SHORTFALL`(DETAIL에 requested·restorable)이면 `MarketRefundShortfallError`가 되고 두 숫자를 담는다. route가 409와 `code`를 응답한다.
  - `confirmedRefundCredits`를 넘기면 `p_confirmed_refund_credits`로 전달된다.
  - 오류 code `40P01`·`40001`이면 "잠시 후 다시 시도" 문구의 `MarketRefundConflictError`가 된다.
  - 화면(`market-refunds-client.tsx`)이 부족분 응답에서 확인 뒤 `confirmedRefundCredits`로 다시 보낸다(소스 계약).
- `tests/admin-credit-grant-idempotency.test.mjs`(새)
  - route 스키마에 `idempotencyKey` uuid 필수.
  - 두 클라이언트가 `crypto.randomUUID()` 키를 body에 넣는다.
  - `grantCreditsAsAdmin`이 `grant_admin_credits`를 `admin_grant:` 접두어로 부른다.
  - route가 `ADMIN_GRANT_IDEMPOTENCY_CONFLICT`를 409로 응답한다.
- `tests/listboard-refund-failure.test.mjs`(새, 소스 계약)
  - run·retry route의 `CreditService.refundCredits` 호출이 try 블록 안에 있고, catch 뒤에 job 최종 상태 UPDATE가 이어진다.
- 기대값 갱신
  - `tests/credit-balance-source-of-truth.test.mjs:52-60`, `tests/credit-source-category.test.mjs:33-55`: deduct/refund/grant는 `finalizeCreditBalanceMutation`을 쓰지 않고, purchase만 쓴다.
  - `tests/market-refund-api-ui-contract.test.mjs:32`: `CreditService.refundCredits` → `approve_market_refund`.

### 5.3 기준선
- 변경 전 전체 테스트 결과를 기록하고(`docs/payapp-phase0-baseline-fails.txt` 형식), 변경 뒤 새 실패가 0인지 확인한다.
- `npx tsc --noEmit`과 lint를 통과해야 한다.

---

## 6. 운영 리허설·적용 절차

### 6.1 리허설(운영 DB, BEGIN … ROLLBACK, 승인 없이 반복 가능)
작은 리허설은 `execute_sql` 한 번으로 끝까지 보내고, 마지막에 반드시 예외로 롤백한다. 큰 리허설은 SQL Editor에서 `set_config('rehearsal.ran', …, true)` 표식 방식으로 한다(메모리 절차). `lock_timeout 3s`, cron 직후에 실행한다.
마이그레이션 2가 들어가는 리허설은 profiles·credit_sources에 ACCESS EXCLUSIVE를 ROLLBACK까지 잡는다(3.4-2). 그동안 사이트 전체의 profiles 읽기와 웹훅 지급 경로가 멈추므로, 사람이 단계 사이에서 멈추지 않도록 SQL Editor에서 한 번에 실행되는 단일 배치로 짧게, 저트래픽 시간에 한다. 리허설마다 전체 실행 시간을 기록한다(적용 시간 예측용).

마이그레이션 1 리허설에서 확인할 것(마이그레이션 본문 실행 뒤, 같은 트랜잭션 안):
```sql
-- (a) 인덱스
SELECT indexname FROM pg_indexes WHERE tablename = 'payment_reconciliation_alerts';   -- active_key 있음, active_code_key 없음
-- (b) 주문별 중복 제거: 같은 code·다른 주문 2행, 같은 주문 재기록 0행
SELECT public.record_payment_alert('REHEARSAL_ALERT', 'warning', 'r', '{"payment_order_id":"00000000-0000-4000-8000-0000000000a1"}'),
       public.record_payment_alert('REHEARSAL_ALERT', 'warning', 'r', '{"payment_order_id":"00000000-0000-4000-8000-0000000000a2"}'),
       public.record_payment_alert('REHEARSAL_ALERT', 'warning', 'r', '{"payment_order_id":"00000000-0000-4000-8000-0000000000a1"}');  -- true, true, false
-- (c) 백필
SELECT count(*) FROM payment_reconciliation_runs WHERE status = 'running' AND lease_expires_at <= now();   -- 0 (그 순간 정상 실행 중인 run은 세지 않음)
-- (d) health 실행 뒤 미해소 경보 수가 그대로(1)이고 payapp_accepts_new_orders false 그대로
--     근거: 현재 페이앱 이벤트 6행은 모두 PAYAPP_PAY_STATE_4·ignored라 새 PAYAPP_FEEDBACK_UNPROCESSED 조건(2.1)에 걸리지 않는다.
--     (d)는 실제로 실행되는 분기만 검사한다. 옛 ON CONFLICT 대상이 남았는지는 (f) 정규식이 본문 전체로 확인한다.
SELECT public.enforce_payment_reconciliation_health();
SELECT count(*) FROM payment_reconciliation_alerts WHERE resolved_at IS NULL AND code <> 'REHEARSAL_ALERT';
-- (e) 트리거: 대사 기록 열만 바꾸면 updated_at 유지
WITH o AS (SELECT id, updated_at FROM payment_orders ORDER BY created_at LIMIT 1)
UPDATE payment_orders p SET last_reconciled_at = now() FROM o WHERE p.id = o.id RETURNING p.updated_at = o.updated_at;  -- true
-- (f) 함수 본문에 옛 ON CONFLICT 대상이 없음
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f' AND pg_get_functiondef(p.oid) ~* 'on\s+conflict\s*\(\s*code\s*\)';  -- 0 (적용 전 운영 값은 함수 2개, 일치 위치는 record 1 + health 4)
-- (g) 함수 속성 보존: 8개 모두 prosecdef true, proconfig {search_path=public, pg_temp}, proacl {postgres=X, service_role=X}
SELECT p.proname, p.prosecdef, p.proconfig, p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('record_payment_alert','enforce_payment_reconciliation_health','process_payapp_cancellation',
   'complete_manual_point_charge_refund','apply_payapp_feedback','claim_point_charge_refund','start_payment_reconciliation_run',
   'claim_payment_reconciliation_batch');
-- 마지막: RAISE EXCEPTION 'REHEARSAL_OK %', current_setting('rehearsal.ran', true);
```

마이그레이션 2 리허설에서 확인할 것(2는 1에 의존하므로 같은 트랜잭션에서 1을 먼저 실행한 뒤 2를 실행한다):
```sql
SELECT conname, convalidated FROM pg_constraint
 WHERE conname IN ('credit_sources_initial_credits_positive','credit_sources_remaining_credits_range',
                   'credit_consumption_amount_positive','profiles_credits_nonnegative','payment_history_amount_charge_limit');  -- 5행 모두 true
SELECT to_regprocedure('public.consume_credits_once(uuid,integer,text,uuid,text,text)'),
       to_regprocedure('public.refund_credits_once(uuid,integer,text,uuid,text,text,text,integer)');   -- NULL, NULL
SELECT p.proname, p.prosecdef, p.proconfig, p.proacl::text FROM pg_proc p
 WHERE p.proname IN ('refund_credits','approve_market_refund','grant_admin_credits');  -- 셋 다 prosecdef true·search_path, ACL은 service_role만
```

**합성 데이터 큰 리허설(SQL Editor, 필수)**
페이앱 주문이 0건이라 위 쿼리만으로는 새 분기가 실제로 실행되지 않는다. 마이그레이션 1·2를 실행한 같은 트랜잭션 안에서 합성 행을 만들어 각 분기의 반환값과 경보 행을 확인하고 ROLLBACK한다. 대상 사용자는 운영의 테스트 계정 1명으로 한다(실제 고객 행은 읽거나 바꾸지 않는다). 합성 행에 필요한 열은 스크립트 작성 때 `information_schema`·`pg_constraint`로 운영 제약을 조회해 채운다.
1. 합성 페이앱 주문(payment_orders + payment_provider_transactions + 지급 원천 + refund_requests)을 만든다.
2. `process_payapp_cancellation`:
   - 승인취소 표식 + origin `external_cancel` 요청 → `already_quarantined`와 `PAYAPP_CANCEL_AFTER_QUARANTINE` 경보 1행(키 = 합성 payment_order_id)(2.3).
   - 처리 중 환불 + 부분취소 표식 → `deferred_refund_processing`과 `PAYAPP_PARTIAL_CANCEL_DEFERRED` 경보(2.3).
   - `admin_paid_confirmed_at`만 있고 `paid_feedback_recorded_at` 없음 + manual_review·user 요청 + 승인취소 표식 → `already_quarantined`(reason `admin_confirmed_mul_no_unverified`), 요청 manual_review·원천 pending_refund 그대로(2.8 변경 2).
   - 같은 관리자 결제확인 주문인데 열린 요청이 없음(또는 pending_review) + 승인취소 표식 → `external_cancel_quarantined`와 `PAYAPP_CANCEL_AFTER_QUARANTINE` 경보 1행(severity critical, details reason `admin_confirmed_mul_no_unverified`)(2.3, 2.8). 4 통보 표식이 있는 주문의 같은 경우 → 이 경보 0행.
3. `complete_manual_point_charge_refund`:
   - 승인취소 표식이 있는 partial_cancel 요청에 남은 크레딧보다 적은 `p_recovered_credits` → `MANUAL_REFUND_RECOVERY_INVALID`(2.3-3).
   - completed 요청(외부 방식 기록 없음)에 bank_transfer → `double_refund_suspected: true`와 경보 1행. 같은 요청에 bank_transfer 기록이 있으면 경보 없음(2.7).
4. `claim_point_charge_refund`: 관리자 결제확인 주문 → `manual_review_required: true`, 요청 manual_review, `provider_transaction_id` NULL(2.8).
5. `refund_credits`:
   - [refunded 원천 S1 + active 원천 S2]에 걸친 소비 → `refunded` = S2 몫, `skipped` = S1 몫(`skipped_unrestorable`), `CREDIT_REFUND_SOURCE_SKIPPED` 경보 1행(2.5).
   - remaining = initial인 원천으로 환불 → `refunded` 0, `skipped_capped` = 요청량, 거래 행 없음, 경보 1행.
   - 소비 내역 합 < p_amount → 차이가 `skipped_unmatched`.
   - 같은 원천이 소비 내역에 두 번 나오는 호출 → 누적 상한 안에서만 복구.
6. `approve_market_refund`(합성 market_purchase_orders·lines·entitlements·pending 요청):
   - 정상 원천(`source_id` 키) → 성공, 세 테이블 refunded, `approved_refund_credits` = 요청량.
   - **`sourceId` 키 주문**(운영 8행과 같은 형식) → 성공, 실제 복구량 = 요청량(2회차 차단 1).
   - **부분 회수된 원천**(initial − remaining < 소비량) → 확인 없이 `MARKET_REFUND_SHORTFALL`, 맞는 숫자로 확인 → 성공, `MARKET_REFUND_AMOUNT_MISMATCH`가 나지 않음.
   - 같은 원천이 `credit_consumptions`에 두 번 나오는 주문 → 누적 배정이 상한을 넘지 않음.
   - `pending_refund`(부분취소 격리 중) 원천으로 산 상품 → 복구 가능으로 판정되고, 이어서 같은 원천에 `complete_manual_point_charge_refund`의 회수 허용 범위(남은 크레딧)가 복구분만큼 늘어난 값과 맞는지 확인.
   - 같은 요청 재호출 → `MARKET_REFUND_NOT_PENDING`.
   - 소비 원천 하나를 refunded로 바꾼 요청 → 확인 없이 `MARKET_REFUND_SHORTFALL`(DETAIL 숫자), 다른 숫자로 확인 → 다시 `MARKET_REFUND_SHORTFALL`, 맞는 숫자로 확인 → 성공, `approved_refund_credits` = 복구량, admin_note 부족분 줄, `MARKET_REFUND_SHORTFALL` 경보 1행.
   - 합성 다운로드 이벤트가 있는 요청 → `MARKET_REFUND_TARGET_CHANGED`.
   - 모든 소비 원천이 refunded인 요청(`v_restorable = 0`) → 확인 없이 `MARKET_REFUND_SHORTFALL`, `p_confirmed_refund_credits = 0`으로 확인 → 성공. `refund_credits`가 호출되지 않고(그 사용자의 'refund' 거래 행이 늘지 않음), 이용권 refunded, `approved_refund_credits = 0`, `MARKET_REFUND_SHORTFALL` 경보 1행. route zod `min(0)`과 맞는 경로가 실제로 동작하는지 확인한다(3회차 환불 검증 권고).
7. `grant_admin_credits`: 같은 키 두 번 → 거래 1행·`already_granted`. 같은 키에 금액만 다르게, 또는 `payment_method`만 다르게 → `ADMIN_GRANT_IDEMPOTENCY_CONFLICT`.
8. health ignored 취소 안전망(2.1): 합성 `payapp:` 이벤트(`PAYAPP_PAY_STATE_9`, ignored, `PAYAPP_FEEDBACK_AMOUNT_MISMATCH`, received_at 31분 전) → health 실행 뒤 `PAYAPP_FEEDBACK_UNPROCESSED` 1행. 같은 조건의 `PAYAPP_FOREIGN_FEEDBACK` 이벤트만 있으면 0행.
9. 롤백 순서(위 합성 리허설과 별도 배치 두 번, 3.6):
   - 배치 A: 마이그레이션 1 → 2 → 롤백 1. 롤백 1 사전 점검의 `ROLLBACK_PRECHECK: roll back 20261110110000 first` 예외로 배치 전체가 롤백되는지 본다(이 예외가 곧 리허설 종료다).
   - 배치 B: 마이그레이션 1 → 2 → 롤백 2 → 롤백 1 → 1.4 md5 표와 일치·옛 인덱스·옛 트리거 확인 → `RAISE EXCEPTION 'REHEARSAL_OK'`.
10. health 판매 차단 분기 실제 실행(3회차 지급·마이그레이션 검증 권고, 2.13·7절 21). 8은 `PAYAPP_FEEDBACK_UNPROCESSED`만 실행하므로, 새 ON CONFLICT 7곳 중 나머지 6곳을 1~8과 같은 합성 리허설 트랜잭션(9의 별도 배치가 아님)에서 한 번씩 실행한다.
   - (가) 먼저 `payment_runtime_config.payapp_accepts_new_orders`를 true로 바꾼다(차단 UPDATE가 실제로 일어나는지 보기 위해서다. ROLLBACK으로 되돌아간다).
   - (나) 합성 페이앱 주문으로 네 조건을 동시에 만든다: 결제완료 표식 11분 전 + 지급 원천(`source_id`) NULL(PAID_UNFULFILLED), 미처리 승인취소 표식 11분 전 + active 원천(CANCEL_UNPROCESSED), money-review `failure_code` 주문(MONEY_RISK_REVIEW), 미처리 표식 + pending_refund 원천(`PAYAPP_CANCEL_UNPROCESSED_FROZEN`). 합성 카카오 주문으로 `KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED`와 `…_FROZEN` 조건도 만든다. 정확한 조건식은 스크립트 작성 때 운영 health 정의에서 읽어 맞춘다.
   - (다) health를 실행하고, 위 6개 code의 미해소 경보가 code별로 1행씩 생겼는지, `payapp_accepts_new_orders`가 false가 됐는지 확인한다. health를 한 번 더 실행해 행이 늘지 않는지도 본다.
모두 ROLLBACK된다.

리허설 뒤 읽기 전용 흔적 확인: `REHEARSAL_ALERT` 0행, running 82행 그대로, 인덱스·제약이 옛 상태.

### 6.2 적용(사용자 승인 뒤)
1. 운영 배포가 커밋 A(0adda5e + 대사 route `maxDuration`)인지, Vercel이 300초를 허용하는지(2.12) 확인한다.
2. 저트래픽 시간, 두 cron 잡(`payment-reconciliation-http-5m`, `payment-reconciliation-health-5m`)의 실행이 끝난 직후(3.2) SQL Editor에서 마이그레이션 1 파일 전체와 `supabase_migrations.schema_migrations` INSERT(version `20261110100000`, name, statements = 파일 원문)를 한 번에 실행한다. `apply_migration`은 적용 시각으로 version을 기록해 파일 이름과 어긋나므로 쓰지 않는다(기존 체크리스트 237행 방식). 실행 뒤 `SELECT version, length(statements[1]) FROM supabase_migrations.schema_migrations WHERE version = '20261110100000';`의 길이가 로컬 파일 글자 수(`wc -m`)와 같은지 확인한다(기존 체크리스트 관례).
3. 6.3 확인.
4. **마켓 환불 승인·관리자 지급 중지 시작.** 관리자에게 알린다. 마이그레이션 2 적용부터 커밋 B 배포 확인까지 옛 `approveMarketRefund`(CAS 먼저 커밋)와 옛 `grantCreditsAsAdmin`(비원자)이 새 DB와 섞이지 않게 하기 위해서다(4.2). 현재 pending 마켓 환불 1건이 있다.
5. 같은 방식(저트래픽 시간·cron 직후·단일 배치, 글자 수 대조 포함)으로 마이그레이션 2 적용(version `20261110110000`). profiles ACCESS EXCLUSIVE 때문에 실행 동안 사이트 요청이 멈춘다(3.4-2). 실행 시간을 리허설 기록과 비교한다. **페이앱 판매가 꺼진 동안(`payapp_accepts_new_orders=false`)에만 적용한다**(웹훅 지급 경로와의 교착 방지, 3.4-2).
6. 6.3 확인.
7. 커밋 B를 push(사용자 결정)하고 Vercel 배포가 Ready이며 운영 별칭이 새 배포를 가리키는지 확인한다. **중지 해제.**
8. `generate_typescript_types` 결과를 `src/types/supabase.ts`와 대조한다.

### 6.3 적용 뒤 확인 쿼리(읽기 전용)
```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;
SELECT p.proname, md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('record_payment_alert','enforce_payment_reconciliation_health','process_payapp_cancellation',
   'complete_manual_point_charge_refund','apply_payapp_feedback','claim_point_charge_refund','start_payment_reconciliation_run',
   'claim_payment_reconciliation_batch','refund_credits','approve_market_refund','grant_admin_credits');   -- 리허설 때 기록한 새 md5와 일치
SELECT status, last_error_code, count(*) FROM payment_reconciliation_runs WHERE started_at > now() - interval '30 minutes' GROUP BY 1, 2;   -- failed 0, PAYMENT_RECONCILIATION_RUN_ABANDONED 0 (succeeded·skipped는 정상)
SELECT count(*) FROM payment_reconciliation_runs WHERE status = 'running' AND lease_expires_at <= now();   -- 0
SELECT last_succeeded_at, consecutive_failures, lease_owner FROM payment_reconciliation_scheduler;   -- 10분 안에 성공, 0
SELECT code, count(*) FROM payment_reconciliation_alerts WHERE resolved_at IS NULL GROUP BY 1;   -- ORDER_NOT_FOUND 1만
SELECT payapp_accepts_new_orders FROM payment_runtime_config;   -- false 그대로
SELECT d.status, d.return_message, d.start_time FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'payment-reconciliation-health-5m' AND d.start_time > now() - interval '30 minutes' ORDER BY d.start_time DESC;   -- 적용 뒤 실행이 모두 succeeded (3.2)
```
코드 배포 뒤 확인:
- 관리자 지급 1건(테스트 계정·소액)을 하고 거래 1행·잔액 일치를 본다. 같은 키 재전송은 브라우저 개발자 도구로 같은 body를 다시 보내 `already_granted`를 확인한다.
- 마켓 환불 pending 1건은 실제 고객 요청이다. 주문일이 2026-10-10이라 TS 자격 검사의 7일 기준에 이미 걸린다. 그래서 승인을 눌러도 `승인 전 환불 조건이 변경되었습니다`로 끝나고 새 RPC가 실행되지 않는다. 새 RPC의 운영 검증은 6.1 합성 리허설로 대신한다. 이 요청은 정상 업무로 판단(거부 등)한다.
- 기존 동작 기록: "요청 시점에는 7일 안이었던 pending 요청이 승인 시점 기준으로 막힌다"는 지금도 같은 동작이다(이번 변경과 무관). `docs/payapp-db-migration-checklist.md`에 별도 항목으로 적어 둔다.

### 6.4 롤백
- 순서는 **커밋 B 되돌림 배포 → 롤백 2 → 롤백 1**이다(3.6).
- 마이그레이션 2: 커밋 B를 먼저 되돌려 배포한 뒤 롤백 파일을 실행한다.
- 마이그레이션 1: 마이그레이션 2가 롤백된 뒤에만 실행한다. 롤백 1의 사전 점검이 `refund_credits` 원문 md5와 새 함수 2개 부재를 확인하고, 아니면 멈춘다. 2가 남은 채 1만 되돌리면 2.5·2.6의 건너뜀·부족분 경보가 code당 1행으로 묶여 사라지기 때문이다. 미해소 경보 중 code 중복이 있으면 먼저 해소한다.
- 커밋 A의 `maxDuration`은 되돌리지 않아도 된다(옛 DB와 무관).
- **커밋 B 되돌림 배포부터 롤백 2 실행까지 마켓 환불 승인·관리자 지급을 중지한다.** 이 구간은 옛 `approveMarketRefund`(CAS 먼저 커밋)와 새 `refund_credits`(복구 불가 원천 건너뜀)가 섞이는, 적용 때(6.2-4)와 같은 조합이다. 롤백 2 확인 뒤 해제한다(3회차 환불 검증 권고).
- 롤백 뒤 같은 version으로 다시 적용하려면 `schema_migrations`의 해당 version 행을 먼저 지우거나 새 version 파일로 한다(3.6).
- 마이그레이션 1의 health만 문제인 경우(예: 실행 중 분기의 런타임 오류로 health·finish가 계속 실패)의 빠른 대응(forward-fix, 3회차 마이그레이션 검증 권고): 정해진 롤백 순서(커밋 B 되돌림 → 롤백 2 → 롤백 1)는 판매 차단 장치를 되살리는 데 오래 걸린다. 그래서 롤백 1 파일에 있는 운영 원문 health를 바탕으로, 원문의 `ON CONFLICT (code)` 4곳(2.2)만 새 대상 식으로 바꾼 **health 단독 교체** SQL을 리허설 때 미리 만들어 두고 6.1 합성 리허설 10과 같은 방식으로 검증해 둔다. 이 SQL은 2.1·2.13의 추가 기능은 잃지만 새 인덱스와 호환되고 판매 차단 판단은 그대로다. 실제 실행은 다른 마이그레이션과 같이 BEGIN…ROLLBACK 리허설과 사용자 승인 뒤에 한다. 이후 정식 수정은 새 version 마이그레이션으로 한다.

### 6.5 현재 미해소 경보
마이그레이션 적용 뒤 `/admin/refunds` 경보 목록에서 PAYAPP_FEEDBACK_ORDER_NOT_FOUND(2026-11-01)를 해소한다. 메모 예: `사이트 밖(카페) 결제 통보. 0adda5e 이전 기록, 사이트 주문 아님`. launch switch 사전 점검이 이것을 요구한다.

`PAYAPP_FEEDBACK_UNAUTHORIZED`가 미해소로 있으면(2.4) 출시 직전에 다음 순서로 확인한 뒤 해소한다.
1. Vercel 런타임 로그에서 페이앱 웹훅 route의 401 응답을 경보 created_at부터 지금까지 찾고, 마지막 401 시각을 적는다(로그 보존 기간 밖이면 "확인 불가"로 적는다).
2. `SELECT max(received_at) FROM payment_webhook_events WHERE transmission_id LIKE 'payapp:%';`로 마지막 인증 통과 통보 시각을 본다. 1의 마지막 401보다 뒤여야 한다.
3. 둘 다 맞으면 `resolve_payment_alert`로 해소하고 두 시각을 메모에 남긴다. 1이 "확인 불가"면 해소만 하고 4로 넘어간다.
4. 해소 뒤 새로 인증 통과 통보(카페 결제 등)가 1건 이상 기록되고, 그사이 UNAUTHORIZED 미해소 행이 다시 생기지 않았는지 확인한 뒤 launch switch를 적용한다. 해소 뒤 첫 401은 새 미해소 행을 만들므로 사전 점검이 다시 멈춘다.

카페(사이트 밖) 부분취소로 생긴 `PAYAPP_FEEDBACK_UNPROCESSED`가 미해소로 있으면(2.9-2, 70·71에 `orig_mul_no`가 없어 `order_not_found`로 남은 경우) 출시 직전에 다음 순서로 확인한 뒤 해소한다.
1. 6.6-4의 질의로 경보의 `latest_received_at`까지 남은 대상 이벤트를 모두 뽑는다.
2. 각 이벤트의 시각·금액을 페이앱 콘솔의 부분취소 내역과 맞춰, 사이트 주문이 아니라 카페 결제임을 확인한다(사이트 페이앱 주문은 출시 전 0건이라 모두 카페 결제여야 한다).
3. 행별 판정을 메모에 남기고 `resolve_payment_alert`로 해소한다. 같은 관리자 알림(`order_not_found` critical)도 함께 확인한 것으로 적는다.

### 6.6 새 수동 런북: 장애 뒤 페이앱 콘솔 취소 내역과 DB 대조
대상 상황은 다음과 같다.
- 웹훅 5xx·DB 장애·Vercel 장애가 있었던 경우(이벤트 insert·조회 실패로 경보 없이 RETRY한 구간 포함, 2.1)
- `PAYAPP_FEEDBACK_APPLY_FAILED`·`PAYAPP_FEEDBACK_UNPROCESSED` 경보가 생긴 경우
- 출시 뒤 4주간 매주 정기 대조

절차:
1. 페이앱 판매자 관리 사이트에서 장애 시작 1시간 전부터 지금까지의 승인취소·부분취소 내역(결제요청번호 mul_no, 금액, 취소일)을 내려받는다.
2. DB와 대조한다.
   ```sql
   SELECT ppt.provider_transaction_id AS mul_no, po.order_id, po.status, ppt.cancel_feedback_recorded_at,
          ppt.partial_cancel_feedback_recorded_at, ppt.partial_cancel_amount, cs.status AS source_status
     FROM payment_provider_transactions ppt
     JOIN payment_orders po ON po.id = ppt.payment_order_id
     LEFT JOIN credit_sources cs ON cs.payment_order_id = po.id
    WHERE ppt.provider = 'payapp' AND ppt.provider_transaction_id = ANY (ARRAY['<콘솔 mul_no 목록>']);
   ```
   - 결과에 없는 mul_no는 사이트 밖(카페) 결제다. 조치하지 않는다.
   - 결과에 있는데 해당 표식(9·64 → cancel, 70·71 → partial)이 NULL이면 통보가 유실된 것이다.
3. 유실분 처리
   - 페이앱 관리자에 통보 재전송 기능이 있으면 먼저 쓴다(출시 전 확인 항목 6.7).
   - 없으면 SQL Editor에서 `BEGIN;`으로 시작해 콘솔 값 그대로 `SELECT public.apply_payapp_feedback(...)`(웹훅과 같은 인자) → `SELECT public.process_payapp_cancellation('<payment_order_id>')`를 실행한다. 결과 jsonb를 확인한 뒤 `COMMIT;`한다.
   - 웹훅이 할 일을 같은 함수로 재현하는 것이라 새 경로가 생기지 않는다.
4. 확인한 `PAYAPP_FEEDBACK_*` 경보를 해소한다. 메모에 대조 범위와 결과를 남긴다.
   - `PAYAPP_FEEDBACK_UNPROCESSED`는 해소하면 `latest_received_at` 이전 이벤트를 다시 세지 않는다(영구 확인, 2.1). 해소 전에 다음 질의로 그 시각까지의 대상 이벤트가 모두 처리됐는지 본다.
     ```sql
     SELECT transmission_id, event_type, processing_status, last_error_code, received_at
       FROM payment_webhook_events
      WHERE transmission_id LIKE 'payapp:%' AND received_at <= '<details.latest_received_at>'
        AND (processing_status IN ('pending', 'failed')
             OR (processing_status = 'ignored'
                 AND event_type IN ('PAYAPP_PAY_STATE_9','PAYAPP_PAY_STATE_64','PAYAPP_PAY_STATE_70','PAYAPP_PAY_STATE_71')
                 AND COALESCE(last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'));
     ```
     각 행이 (가) 재통보로 completed가 됐거나, (나) 3의 수동 apply·process로 해당 주문 표식·처리 시각이 생겼거나, (다) 콘솔 대조로 사이트 밖 결제임이 확인된 경우에만 해소한다. 메모에 행별 판정을 남긴다.
     - 이 질의는 `details.latest_received_at` 이전만 본다. 경보가 생긴 뒤(그 시각 이후)에 들어온 대상 이벤트는 이 경보가 아니라, 해소 뒤 health가 만드는 다음 `PAYAPP_FEEDBACK_UNPROCESSED`로 넘어간다(ack가 해소 전 경보까지 MAX에 넣어도 안전함, 3회차 지급 검증 확인). 그러니 해소 직후 새 경보가 또 생기는 것은 정상이며 같은 절차로 처리한다.
   - 오탐 판정: `markEvent`는 오류를 확인하지 않으므로(2.1), 처리는 커밋됐는데 이벤트만 pending으로 남을 수 있다. 그 이벤트의 mul_no로 2의 질의를 돌려 해당 표식(`cancel_feedback_recorded_at`·`partial_cancel_feedback_recorded_at`, 결제완료면 `paid_feedback_recorded_at`)과 처리 시각(`cancel_processed_at`·`partial_cancel_processed_at`)이 이미 있으면 오탐이다. 메모에 "처리 완료·이벤트 상태만 미갱신"으로 남기고 해소한다.

관리자 결제확인(`paid_confirmed`)에 결제번호를 넣을 때와 수동 환불 전 콘솔 취소 때는 콘솔 행의 금액·결제일·구매자 연락처 끝자리를 주문과 대조한 뒤 진행한다(2.8 보완). 관리자 결제확인 주문에 승인취소 통보가 와서 `PAYAPP_CANCEL_AFTER_QUARANTINE`(details `reason = admin_confirmed_mul_no_unverified`)이 생기면, 콘솔에서 그 취소가 우리 고객 결제인지 대조한다. 열린 환불 요청이 없거나 pending_review였던 경우(결과 `external_cancel_quarantined`, 2.3)도 같은 경보·같은 대조 대상이다. 이 경우 화면에는 "외부 전취소" 격리로 보이므로, 대조 없이 `complete_manual`로 전량 회수하지 않는다(우리 결제가 아니면 돈을 낸 고객의 크레딧을 회수하게 된다). 우리 결제면 `complete_manual`(`payapp_cancel_request` 또는 `provider_admin_cancel`, 전량 회수)로 마감한다. 카페 결제면 저장된 결제번호가 틀린 것이니 우리 고객 결제를 콘솔에서 찾아 취소한 뒤 같은 방식으로 마감하고 경보에 경위를 남긴다.

관리자 결제확인 주문의 환불(2.8): `paid_feedback_recorded_at` 없이 `admin_paid_confirmed_at`만 있는 주문은 결제번호가 payrequest 응답으로 저장돼 있던 경우라도 모두 수동 환불(manual_review)로 간다. 안전 쪽 동작이며, 이런 주문의 환불 승인은 항상 콘솔 취소 + `complete_manual`로 마감한다는 뜻이다.

주문 검토 처리 전 확인(2회차 환불 검증 권고): 운영 `resolve_payment_order_review`는 어떤 조치든 `details->>'payment_order_id'`가 그 주문인 미해소 경보를 모두 해소한다. 그래서 같은 주문의 `cancel_handled`·`paid_confirmed` 처리가 2.3·2.7의 critical 경보(`PAYAPP_DOUBLE_REFUND_SUSPECTED`, `PAYAPP_CANCEL_AFTER_QUARANTINE`)까지 함께 닫는다. 주문 검토를 처리하기 전에 그 주문의 미해소 경보 목록을 먼저 보고, 이 두 경보가 있으면 이중 환불 회수·콘솔 대조를 끝낸 뒤 처리한다. critical code를 자동 해소에서 빼는 것은 `resolve_payment_order_review` 변경이라 이번 범위 밖이다(1.3, 7절 19).

경보별 해소 시점:
- `PAYAPP_PARTIAL_CANCEL_DEFERRED`: 환불이 끝난 뒤 해소한다. 환불이 끝나기 전에 해소하면 대사가 다시 만든다(2.3).
- `CREDIT_REFUND_FAILED`(2.5): details의 `user_id`·`amount`·`description`과 같은 'refund' 거래 행이 경보 `created_at` 직전(같은 요청 처리 시간 안, 몇 초~1분)에 있으면 RPC는 커밋됐고 응답만 유실된 오탐이다. `resource_id`만으로 판정하지 않는다(같은 리소스의 앞선 성공 환불 행이 있으면 진짜 실패를 오탐으로 닫게 되고, `resource_id`가 NULL인 호출은 비교할 수 없다). 같은 사용자·금액·문구의 실패 경보가 여러 건이면 거래 행과 1:1로 짝지어 남는 경보만 실패로 본다. 실패면 details의 사용자·금액만큼 관리자 지급(`system_refund`)으로 보상하고 메모를 남긴 뒤 해소한다.
- 조건별 health 경보(`PAYAPP_PAID_UNFULFILLED`·`PAYAPP_CANCEL_UNPROCESSED`·`PAYAPP_MONEY_RISK_REVIEW`, 2.13)와 `PAYAPP_FEEDBACK_UNPROCESSED`의 details 건수는 경보가 생긴 시점 값이다(`DO NOTHING`이라 갱신되지 않음). 현재 건수는 질의로 다시 확인한다.
- `CREDIT_REFUND_SOURCE_SKIPPED`(2.5)·`MARKET_REFUND_SHORTFALL`(2.6): details의 사용자·금액·리소스(그리고 `skipped_unrestorable`·`skipped_capped`·`skipped_unmatched` 구분)를 보고, `skipped_capped`는 같은 소비를 두 번 환불하려 한 흔적이라 보상하지 않고 원인 호출을 확인한다. 그 밖에는 사용자가 받아야 할 몫이면 관리자 지급(`system_refund`)으로 보상한 뒤 지급 내역을 메모에 남기고 해소한다. 결제 환불로 이미 현금이 나간 원천이라 보상하지 않는 경우도 이유를 메모에 남긴다.

READY_CANCEL_FAILED로 판매가 멈춘 경우(2.10):
1. 콘솔에서 해당 mul_no가 미결제·요청취소인지 확인한다.
2. `unpaid_confirmed`로 처리한다.
3. 다른 money-review 건이 0인지 확인한 뒤 `payment_runtime_config.payapp_accepts_new_orders`를 기존 출시 절차의 SQL로 다시 켠다.

### 6.7 출시 직후 확인할 페이앱 동작(설계는 두 결과 모두에서 안전)
- 테스트 결제 요청 1건을 결제하지 않고 30분 만료시켜, ready 취소 뒤 8/16/32 통보가 오는지 본다(2.10).
- 테스트 결제 1건을 부분취소한 뒤 승인취소해, 9 통보의 price가 원금인지 잔액인지 본다(2.9).
- 페이앱 관리자에 통보 재전송 기능이 있는지 본다(6.6).
- 카페·사이트 부분취소 통보(70·71)에 `orig_mul_no`가 항상 오는지 본다(2.9-2). 오지 않으면 카페 부분취소마다 critical 관리자 알림과 30분 뒤 `PAYAPP_FEEDBACK_UNPROCESSED`가 생긴다(6.5 절차로 해소). 카페 부분취소 통보는 출시 전에도 공용 계정으로 들어오므로 이벤트 기록(`payment_webhook_events`의 70·71 행과 `last_error_code`)으로 먼저 확인할 수 있다.
결과는 `docs/payapp-db-migration-checklist.md`에 기록한다.

---

## 7. 남은 위험

1. DB에 쓰기 자체가 불가능한 장애가 페이앱 재통보 창보다 길면 이벤트 행도 경보도 없다. 이 경우는 6.6 수동 대조로만 찾는다. 페이앱 조회 API를 쓰지 않는 설계의 한계다.
2. RPC는 커밋됐는데 응답이 유실되는 경우(consume·refund·approve·grant)는 호출자가 실패로 본다.
   - approve와 grant는 재시도가 멱등이다.
   - AI 생성 차감은 생성 1회분 손실이 남을 수 있다.
   - 크레딧 환불 RPC가 실패하면 `CREDIT_REFUND_FAILED` 경보를 남기지만(2.5), 원인이 DB 장애면 경보 기록도 실패해 로그만 남는다.
3. 2.9: 부분취소가 여러 번 있었거나 9가 70보다 먼저 오면 잔액 price를 받지 못한다. critical 경보와 관리자 알림만 남고 자동 격리되지 않는다. TS 경보가 유실돼도 2.1 health의 ignored 취소 조건이 30분 뒤 `PAYAPP_FEEDBACK_UNPROCESSED`로 다시 잡는다. 그 30분 동안은 경보가 없을 수 있다.
4. 2.10: 페이앱이 ready 취소 뒤 통보를 보내지 않는다면, 응답 유실 한 번이 판매 정지(오탐)로 이어진다. 돈은 안전하고 수동 해제가 필요하다.
5. 2.8: 잘못 입력된 mul_no 자체는 여전히 저장된다. 그 번호의 카페 결제가 나중에 취소되면 9 통보가 우리 주문에 매칭된다. 열린 manual_review·user 요청이 있으면 2.8 변경 2가, 요청이 없거나 pending_review이면 2.3의 `external_cancel_quarantined` 경보가 자동 완료를 막고 critical 경보(`PAYAPP_CANCEL_AFTER_QUARANTINE`, reason `admin_confirmed_mul_no_unverified`)와 수동 대조로 넘긴다(3회차 환불 검증 정정). 원천은 pending_refund로 묶여 사용되지 않는다. 남는 것은 관리자가 경보를 보고 콘솔 대조를 하는 데 걸리는 지연과, 대조 없이 `complete_manual`로 회수하는 사람의 실수다(6.6 런북으로만 막음).
6. 2.5: 환불 완료·만료 원천 몫의 복구는 건너뛴다(다른 원천 몫은 복구). 건너뛴 몫은 `CREDIT_REFUND_SOURCE_SKIPPED` 경보로 남고, 보상은 관리자가 판단해 수동 지급한다. 지금은 그 몫이 원장에만 거짓으로 기록되고 잔액에는 보이지 않았다. 경보를 확인하기 전까지 사용자는 그 몫을 받지 못한다.
   - 마켓 부족분 승인(2.6)도 같다. 이용권은 회수되고 부족분 보상은 관리자 지급으로 따로 한다.
7. 2.1의 통보 미처리 점검은 판매를 끄지 않는다. 경보를 보고도 대응이 늦으면 그동안 판매가 계속된다.
8. 2.2로 경보 행이 주문·mul_no별로 늘어난다. 같은 날 여러 건이 쌓이면 관리자 확인 부담이 커진다. 재통보마다 관리자 알림이 반복될 수 있다(2.1).
9. 2.11: claim 정렬 변경으로 대사 처리 순서가 바뀐다(마지막 대사 시각 기준). 주문 12건 규모에서는 영향이 없지만 행동이 바뀌는 지점이다. 새 트리거에서는 claim의 갱신이 updated_at도 last_reconciled_at도 바꾸지 않으므로, `record_payment_reconciliation_result`까지 가지 못하는 주문(처리 중 프로세스 종료가 반복되는 표식 주문)은 처리 결과가 기록되지 않아 매 run 맨 앞에 계속 잡힌다(예전에는 트리거가 updated_at을 now()로 덮어 뒤로 밀렸다). limit 20이라 지금은 다른 주문을 막지 않는다.
10. 롤백 1은 미해소 경보에 code 중복이 생기면 바로 실행할 수 없다. 먼저 해소해야 한다. 또 마이그레이션 2가 롤백된 뒤에만 실행된다(커밋 B 되돌림 → 롤백 2 → 롤백 1). 그래서 마이그레이션 1만 급히 되돌려야 하는 상황에서도 2와 커밋 B를 함께 되돌려야 한다. health만 문제일 때는 6.4의 health 단독 교체(forward-fix)로 판매 차단 장치를 먼저 되살린다.
11. 2.16 제약 때문에, 앞으로 범위를 어기는 버그는 조용히 저장되지 않고 오류로 실패한다(의도). 그 순간 해당 기능이 멈출 수 있다.
12. `purchaseCredits`(src 호출 0곳)에는 CREDIT-1·3 구조가 그대로 남는다. 이번 범위에서 지우지 않는다(미사용 코드로 보고만 함).
13. 2.12: 리스(4분)를 넘긴 run은 이제 연속 실패로 센다. 지금은 limit 20 × 페이앱 호출 10초 제한으로 최악 200초라 여유가 있다. 나중에 limit을 50으로 올리거나 run당 페이앱 호출을 늘리면 살아 있는 run이 abandoned로 세어져 3회 뒤 판매가 꺼질 수 있다. 그때는 리스 길이를 함께 늘린다. Vercel 함수 제한으로 강제 종료되는 run도 abandoned로 세어지므로, 대사 route의 `maxDuration = 300`이 리스보다 길게 유지되어야 한다(2.12). 리스를 넘겨 닫힌 살아 있는 run이 그 뒤 처리한 결과는 주문 쪽에는 기록되지만 run 행 카운터에는 남지 않는다.
14. 2.6: 업그레이드 기준 주문 검사(`isUpgradeBaseOrder`)는 잠금 밖 TS 사전 검사에만 있다. 사전 검사와 승인 사이에 차액 업그레이드가 완료되면 그 기준 주문이 환불될 수 있다(기존부터 있던 틈, 관리자 승인 경로라 빈도 매우 낮음).
15. 2.4: 외부 POST 하나로 생긴 UNAUTHORIZED 경보는 계속 출시 적용을 막는다. 6.5 확인 절차로 사람이 해소해야 한다. Vercel 로그 보존 기간 밖이면 "해소 뒤 인증 통과 통보 확인"만으로 판단한다.
16. 교착(40P01): `approve_market_refund`·`refund_credits`(profiles → credit_sources)와 `complete_manual_point_charge_refund`·`process_payapp_cancellation`(credit_sources → profiles)이 같은 사용자에게 동시에 일어나면 한쪽이 롤백된다. 정합성은 안전하고, 마켓 승인은 "다시 시도" 문구로, 웹훅은 페이앱 재통보로, 대사는 다음 run으로 다시 처리된다.
17. 2.1 health의 ack 질의(`MAX(latest_received_at)`)는 해소된 경보까지 읽는다. 경보 행이 수천 행으로 늘면 `(code)` 일반 인덱스를 추가해야 한다(지금 4행).
18. 2.1: `PAYAPP_FEEDBACK_UNPROCESSED`를 해소하면 그 시각 이전 이벤트는 다시 울리지 않는다. 사람이 6.6의 행별 확인 없이 해소하면 미처리 통보가 영구히 묻힌다. 런북 절차로만 막는다.
19. 운영 `resolve_payment_order_review`는 주문의 미해소 경보를 code와 무관하게 모두 해소한다. 2.3·2.7의 critical 경보도 같은 주문의 검토 처리에 함께 닫힐 수 있다(해소 시각은 남음). 6.6의 "주문 검토 처리 전 확인"으로만 막는다. critical code를 자동 해소에서 빼는 것은 다음 범위에서 검토한다.
20. 기존 틈(이번 변경과 무관): 다운로드 route는 서명 URL을 만든 뒤 다운로드 이벤트를 기록한다. 그래서 "환불 요청 생성 + 승인"이 한 다운로드 요청 처리 중에 끝나면 승인 뒤에 URL이 발급될 수 있다. 2.6 5단계의 FK 잠금은 커밋된 다운로드 기록 수를 고정할 뿐, 진행 중인 요청의 URL 발급까지 막지는 않는다.
21. health 실패 연쇄(3회차 지급 검증): health는 pg_cron `payment-reconciliation-health-5m`과 대사 finish 두 곳에서 불린다. health가 예외를 내면 그 트랜잭션 전체가 롤백되어 판매 차단 UPDATE(`payapp_accepts_new_orders=false`)도 사라진다. finish(true)·finish(false)도 함께 롤백되어 run은 running으로 남고, 2.12의 abandoned 집계가 연속 실패를 올리지만 차단 UPDATE가 health 안에 있어 적용되지 않는다. 즉 새 ON CONFLICT 분기(2.13 조건별 3곳, `PAYAPP_CANCEL_UNPROCESSED_FROZEN`, 카카오 2곳)에 오타가 있으면 바로 그 돈 위험 상황에서 판매가 꺼지지 않는다. 대응은 계약 테스트의 정확한 문자열 7회 검사(5.1), 합성 리허설의 분기 실제 실행(6.1-10), 적용 뒤 health cron 성공 확인(6.3), 문제 시 health 단독 교체(6.4)다.
22. 2.7의 역순(선택 권고, 이번 범위에서 넣지 않음): completed 분기의 감지는 `p_external_method = 'bank_transfer'`일 때만 동작한다. "bank_transfer로 수동 완료 → 다른 관리자가 콘솔 취소 후 `provider_admin_cancel` 입력" 순서는 9 통보(`process_payapp_cancellation`의 `double_refund_suspected`)에만 의존한다. 통보가 유실되면 2.1 health·6.6 대조로만 잡힌다. 대칭 감지(completed 요청에 bank_transfer 기록이 있는데 `provider_admin_cancel`·`payapp_cancel_request`가 들어오면 같은 경보)는 승인된 설계 밖의 추가라 다음 범위에서 검토한다.

---

## 8. 검증 기록

| 회차 | 검증 역할 | 판정 | 핵심 지적 |
|---|---|---|---|
| 1 | 지급 | PASS | 차단 없음. 권고 8건: 관리자 결제확인 주문의 9 통보 자동 완료 차단(반영, 2.8 변경 2·7절 5), 마이그레이션 2~커밋 B 사이 마켓 승인 중지(반영, 6.2), 승인 RPC 실제 복구량 검사(반영, 2.6 8·9), UNAUTHORIZED 단일 행 문제(2.4 재설계로 반영), 합성 리허설(반영, 6.1), 이벤트 insert 실패 RETRY 분기(범위 밖으로 명시, 2.1·6.6), 리스 초과 run 위험(반영, 7절 13), DEFERRED 경보 해소 시점(반영, 2.3·6.6) |
| 1 | 환불 | FAIL → 수정 | 차단 2건 모두 반영. ① `refund_credits` 전부-아니면-전무 RAISE가 비마켓 다원천 환불의 active 몫까지 잃게 함(리스트보드 run:388·retry:453 catch 밖 확인) → 복구 불가 항목만 건너뛰고 `CREDIT_REFUND_SOURCE_SKIPPED` 경보(`dedupe_key`)로 기록, 리스트보드 catch 추가, 7절 6 정정(2.5). ② 이용권 회수 관리자 경로 부재(src 'revoked' 0곳 확인) → `approve_market_refund`에 `p_confirmed_refund_credits` 확인 경로(복구 가능분만 복구·이용권 회수·실제 복구량 기록·부족분 경보)와 화면 확인 창 추가(2.6). 권고 반영: 잠근 주문 행에서 소비 내역 읽기(운영 키 `source_id`/`sourceId` 혼재 확인), 다운로드 재검사(FK 잠금 근거), 40P01·40001 매핑, 2.7 조건 확장, 2.15 멱등 충돌 거부, 6.3 pending 건 7일 경과 기록, 6.2 승인 중지. 업그레이드 검사 SQL 이전은 범위 밖(7절 14) |
| 1 | 마이그레이션 | FAIL → 수정 | 차단 1건 반영: 2.4 사전 점검 예외가 첫 인증 실패 시각만 보고 이후 설정 붕괴를 가림 → 예외 철회, 6.5 확인·해소 절차로 대체(`last_seen_at` 방식은 `record_payment_alert` 반환 의미 변경 때문에 미채택). 권고 반영: 2.17 자기 자신 제외 쿼리 명시, 함수 속성(`SECURITY DEFINER`·search_path) 보존 검사(2.0·5.1·6.1), `CREATE OR REPLACE TRIGGER`와 잠금 순서(3.3·3.4), launch switch 감사 문자열 새 버전·SQL Editor로 version 기록(3.1·6.2), 마이그레이션 2 적용~커밋 B 사이 승인·지급 중지(6.2), 2.7 NULL 주문 키 → `dedupe_key`, 6.1(c)·6.3 run 판정 조건 수정 |
| 2 | 지급 | PASS | 차단 없음. 권고 8건 모두 반영: health의 `ON CONFLICT (code)` 4곳 명시와 사후 점검·리허설 (f)·계약 테스트를 정규식 `on\s+conflict\s*\(\s*code\s*\)`로 변경(2.2·3.3·5.1·6.1), `v_restore_items` `{source_id, amount}` 정규화(2.6, 환불·마이그레이션 차단과 같은 건), `PAYAPP_FEEDBACK_UNPROCESSED` 해소 전 행별 확인 런북과 7절 18(2.1·6.6), `markEvent` 오류 미확인으로 인한 오탐 판정 기준(6.6), 대사 route `maxDuration = 300`을 커밋 A로 마이그레이션 1보다 먼저 배포(2.12·4.1·4.2·6.2), 취소 계열 `order_not_found`도 critical·관리자 알림(2.9-2), 마이그레이션 2 리허설은 단일 배치·저트래픽(6.1), `process_payapp_cancellation` 반환의 `payment_order_id` 유지 계약 테스트(2.3·5.1) |
| 2 | 환불 | FAIL → 수정 | 차단 3건 모두 운영 정의·데이터로 확인 후 반영. ① `refund_credits`는 `v_item->>'source_id'`만 읽음(운영 본문 확인), `credit_consumptions` 19행 중 8행이 `sourceId` 키(재조회) → 7단계에서 `jsonb_build_object('source_id', COALESCE(…), 'amount', v_alloc)`로 정규화·0 제외, 9단계에 `skipped <> 0` 검사 추가, 계약 테스트·합성 리허설 6에 `sourceId` 주문·부분 회수 원천 추가(2.6·5.1·6.1). ② TS ignored 분기가 `markEvent(ignored)` 뒤 경보 오류를 삼킴(`:446-463`, `:125-127`, `:373-375` 확인) → 제안 (b) 채택: health `PAYAPP_FEEDBACK_UNPROCESSED`에 ignored 취소 계열(사이트 밖 제외) 조건과 부분 인덱스 추가. (a)는 주문을 못 찾은 취소 계열 `order_not_found`를 잡지 못해 미채택(2.1·2.9·3.3·5.1·6.1). ③ 롤백 1에 마이그레이션 2 롤백 확인 사전 점검(`refund_credits` 원문 md5·새 함수 2개 부재) 추가, 순서를 커밋 B 되돌림 → 롤백 2 → 롤백 1로 고정(3.1·3.6·6.4·7절 10, 리허설 6.1-9). 권고 반영: 상한 차이·남은 양도 `CREDIT_REFUND_SOURCE_SKIPPED`에 기록(2.5), `refundCredits` RPC 실패 시 `CREDIT_REFUND_FAILED` 경보(2.5·4.1·5.2·6.6), REF-1 과다 지급 불성립 근거 명시(2.5), 주문 검토 처리 전 critical 경보 확인 런북·7절 19, 관리자 결제확인 주문은 모두 수동 환불(6.6), 멱등 비교에 `payment_method`(2.15), 합성 리허설에 같은 원천 중복·`pending_refund` 원천 사례(6.1), 다운로드 URL 발급 틈 기록(7절 20, route 확인) |
| 2 | 마이그레이션 | FAIL → 수정 | 차단 1건(환불 차단 ①과 같은 건) 반영: `v_restore_items` 정규화와 계약 테스트·리허설 사례(2.6·5.1·6.1). 권고 반영: 롤백 순서 명시·강제(3.6·6.4), profiles ACCESS EXCLUSIVE 영향과 저트래픽·cron 직후·실행 시간 기록(3.4·6.1·6.2), 마이그레이션 1 사전 점검에 `pg_get_triggerdef` 비교(3.3·5.1), `length(statements[1])`와 파일 글자 수 대조(6.2), 관리자 지급 중지 이유를 "비원자 경로라 예방"으로 정정·마켓 승인 중지는 필수로 구분(4.2), 닫힌 run의 카운터 미기록(2.12·7절 13), ack 질의 인덱스 메모(2.1·7절 17), 리허설 (d)가 새 경보를 만들지 않는 근거(운영 이벤트 6행 모두 상태 4·ignored, 2.1·6.1) |
| 3 | 지급 | PASS | 차단 없음. 권고 6건 모두 반영: health 판매 차단 분기(조건별 3·`PAYAPP_CANCEL_UNPROCESSED_FROZEN`·카카오 2)를 합성 리허설에서 스위치 true로 바꾼 뒤 실제 실행(6.1-10)·계약 테스트에 대상 식 정확한 문자열 7회 검사(5.1, 2.13), 2.9-2 근거 정정(70·71에 `orig_mul_no`가 없으면 카페 부분취소도 critical 알림·`PAYAPP_FEEDBACK_UNPROCESSED`) → 6.7 확인 항목·6.5 해소 절차 추가, 7절 9에 처리 결과가 기록되지 않는 주문이 맨 앞에 남는 점, 조건별 경보 details 건수는 생성 시점 값(2.13·6.6), ack 이후 이벤트는 다음 경보로 넘어간다는 런북 문장(6.6), health 실패 시 판매 차단 UPDATE까지 롤백되는 연쇄를 7절 21로 기록하고 대응 연결 |
| 3 | 환불 | PASS | 차단 없음. 권고 반영: 관리자 결제확인 주문의 `external_cancel_quarantined`(열린 요청 없음·pending_review)에도 2.3 DB 경보 CASE로 `PAYAPP_CANCEL_AFTER_QUARANTINE`(reason `admin_confirmed_mul_no_unverified`, critical) 추가, 7절 5 주장 정정, 6.6 대조 대상·6.1-2 리허설 사례·5.1 계약 테스트(2.3·2.8). `CREDIT_REFUND_FAILED` `dedupe_key`를 호출마다 `crypto.randomUUID()`로, details에 `description` 추가, 오탐 판정을 user_id·amount·description과 경보 created_at 전후 거래 행으로 변경(2.2·2.5·5.2·6.6, save-from-community `:421`·`:450` NULL 확인). 6.4 커밋 B 되돌림~롤백 2 사이 마켓 승인·관리자 지급 중지. `p_target_balance` 호출처 `questions/generate/route.ts:111-119` 명시(2.5·5.1). 6.1-6에 `v_restorable = 0`·확인 0 사례. 2.7 역순 대칭 감지(선택)는 승인된 설계 밖 추가라 미반영, 7절 22로 기록 |
| 3 | 마이그레이션 | PASS | 차단 없음. 권고 9건 반영: health 분기 실제 실행 리허설(지급 권고와 같은 건, 6.1-10), 두 cron 잡(`payment-reconciliation-http-5m`·`payment-reconciliation-health-5m`, 둘 다 `*/5`, `cron.job` 조회로 확인) 실행 직후 적용과 6.3 `cron.job_run_details` health 성공 확인(3.2·6.2·6.3), 트리거 함수도 `REVOKE ALL … FROM PUBLIC, anon, authenticated`(2.0·3.3-2·5.1), `apply_payapp_feedback` 허용식에 `p_price IS NOT NULL`로 NULL price 동작 유지와 계약 테스트(2.9·5.1), 롤백 뒤 같은 version 재적용 시 `schema_migrations` 행 삭제 또는 새 version(3.6·6.4), health 단독 교체 forward-fix 절차(6.4·7절 10), 마이그레이션 2는 페이앱 판매가 꺼진 동안에만 적용(3.4-2·6.2), health의 카카오 `WHERE NOT EXISTS` INSERT 1곳은 변경하지 않음 명시(2.2·5.1), `orig_mul_no` 확인(6.7, 지급 권고와 같은 건) |
