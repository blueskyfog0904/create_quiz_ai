# 페이앱 전환 DB 마이그레이션 체크리스트

[구현 계획](payapp-kakaopay-payment-implementation-plan.md)의 운영 DB 적용 규칙과 확인 쿼리다.
- 운영과 로컬이 같은 DB(`kzcweelnzhcmiuvjgeyi`)를 쓴다.
- 모든 쓰기는 dry-run 결과를 보여 준 뒤 사용자 승인을 받고 적용한다.

## 0. 공통 규칙

1. **단일 트랜잭션:** 파일 하나를 트랜잭션 하나로 적용한다(`apply_migration`). 중간에 BEGIN/COMMIT을 넣지 않는다. DROP과 CREATE 사이에 함수가 없는 순간이 생기면 안 된다.
2. **잠금 제한:** 파일 첫 줄에 `SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s';`을 둔다. 잠금을 얻지 못해 실패하면 재시도한다. 무한 대기하면 결제 화면 전체가 멈출 수 있다.
   - `SET LOCAL`은 트랜잭션 블록 안에서만 효과가 있다. `apply_migration`이 파일을 한 트랜잭션으로 감싸는지를 로컬과 운영 리허설에서 확인한다("SET LOCAL can only be used in transaction blocks" 경고가 없어야 함). 확인 결과를 이 문서에 기록한다. 감싸지 않으면 파일 안에 명시적으로 `BEGIN … COMMIT`을 둔다.
3. **적용 시점:** pg_cron 잡 1(health)과 3(대사)이 `*/5`로 돈다. 잡 실행 직후 1~4분 안에 적용한다. 적용 전 긴 트랜잭션이 없는지 확인한다(A-pre-3).
4. **`CASCADE` 금지.**
5. **검증 블록:** 파일 끝에 `DO $$ … RAISE EXCEPTION … $$` 검증 블록을 둔다. 오버로드 수, ACL, 제약 존재를 확인하고, 하나라도 틀리면 전체를 롤백한다.
6. **스키마 리로드:** 마지막 줄에 `NOTIFY pgrst, 'reload schema';`를 둔다.
7. **권한:** 신규·재정의 결제 함수는 모두 다음을 지킨다.
   - `SECURITY DEFINER SET search_path = public, pg_temp`
   - `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`
   - authenticated 예외: `get_my_payment_history`, `get_my_refund_requests`(authenticated와 service_role).
   - 트리거 함수는 SECURITY INVOKER 그대로 둔다(직접 호출 불가).
   - 지급 내부 함수는 `SECURITY DEFINER`로 만들고 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 한다. 소유자 권한은 유지한다(기대 `proacl = {postgres=X/postgres}`).
8. **CHECK 교체:** 대상 테이블이 12행 이하로 작으므로, 한 `ALTER TABLE` 문에서 DROP과 ADD를 하고 바로 validated 상태로 둔다.
9. **파일명:** 적용 직후 `list_migrations`에 기록된 버전으로 로컬 파일명을 바꾼다.
10. **롤백 범위:**
    - A는 다음 세 조건이 모두 0건일 때만 롤백할 수 있다. 그 뒤로는 스위치를 끄고 앞으로 고치는 방식(forward-fix)만 한다.
      - payapp 행: `select count(*) from payment_orders where provider='payapp'`
      - 같은 환불 키 중복(전체 unique 복원 불가 판정): `select cancel_idempotency_key from refund_requests where cancel_idempotency_key is not null group by 1 having count(*) > 1`
      - 격리 origin 환불: `select count(*) from refund_requests where origin <> 'user'`(origin 컬럼이 사라지면 격리 건이 일반 `manual_review`처럼 보여 거절될 수 있다)
    - 그리고 단계 4 코드(`quarantine_kakaopay_partial_cancellation` 호출)가 배포되기 전이어야 한다. 이미 배포됐으면 코드를 먼저 되돌린 뒤 롤백한다.
    - 단계 4 코드를 되돌리기 전에(A 유지 여부와 무관) 미처리 카카오 표식이 0건인지 확인한다: `select count(*) from payment_provider_transactions ppt join payment_orders po on po.id = ppt.payment_order_id where po.provider = 'kakaopay' and ppt.partial_cancel_feedback_recorded_at is not null and ppt.partial_cancel_processed_at is null`. 0건이 아니면 이전 코드는 표식을 처리하지 못하므로(매 회차 재조회, 원천 `active`면 판매 중지) 되돌리지 않고 forward-fix한다.
    - A 롤백 파일에는 다음이 모두 들어간다.
      - 교체한 함수의 이전 정의와 GRANT/REVOKE 문
      - 새로 만든 객체의 DROP 문(신규 함수 전부, 지급 내부 함수, `payment_methods`, `payment_admin_actions`, 새 컬럼, 복합 FK, 새 CHECK, 새 인덱스, 새 트리거)
      - CHECK 6개(provider 5곳 + 스냅샷)와 이전 `refund_requests_cancel_idempotency_key` 정의
      - `ALTER TABLE payment_orders ALTER COLUMN provider SET DEFAULT 'toss'`
    - 롤백 순서: 18개 인자 `prepare_payment_order`를 먼저 DROP한 뒤 17개 인자 정의를 CREATE 한다. 반환형이 바뀐 `get_my_payment_history`, `get_my_refund_requests`도 DROP 후 CREATE 한다.
    - B1 롤백: 변경 전 `site_footer_content` value 전체를 저장해 둔다.
    - B2 롤백은 저장해 둔 정의로 함수를 다시 만들고 컬럼을 되살린다(`toss_accepts_new_orders boolean NOT NULL DEFAULT false`, `toss_merchant_id text`, 현재 값 true / 'tgen_docs'). B2가 재정의하는 `prepare_payment_order`와 환불 자격 함수의 B2 직전 정의도 넣는다.

## A-pre (마이그레이션 A 적용 전, 읽기 전용)

1. 기준값을 기록한다.
   ```sql
   select provider, status, count(*) from payment_orders group by 1,2;
   select count(*) from payment_provider_transactions;
   select * from payment_runtime_config;
   select code, created_at from payment_reconciliation_alerts where resolved_at is null;
   ```
2. 새 CHECK를 기존 행에 미리 대입해 위반이 0건인지 본다.
   - `select count(*) from payment_orders where not (<새 provider_snapshot_check 식>);`
   - CHECK 5곳 각각 provider 컬럼이 허용값 밖인 행이 0건인지 본다. 컬럼명이 테이블마다 다르다: `checkout_attempts.claimed_provider`, 나머지(`payment_orders`, `payment_provider_transactions`, `refund_requests`, `payment_reconciliation_items`)는 `provider`.
3. 긴 트랜잭션이 0건인지 본다.
   ```sql
   select pid, state, xact_start, left(query,80) from pg_stat_activity
   where datname = current_database() and xact_start < now() - interval '30 seconds';
   ```
4. cron 실행 시각을 확인한다.
   ```sql
   select jobid, max(start_time) from cron.job_run_details where jobid in (1,3) group by 1;
   ```
5. 롤백 파일 `supabase/rollback/<version>_down.sql`을 만든다(0-10의 범위 전부). 작성본: `supabase/rollback/20261019090000_payapp_migration_a_down.sql`. 지우고 다시 만드는 함수(`prepare_payment_order`, `reject_point_charge_refund`, `get_my_*`)는 기본 권한이 PUBLIC·anon·authenticated를 다시 열므로 CREATE 직후 `REVOKE ALL … FROM PUBLIC, anon, authenticated`를 먼저 하고 GRANT 한다. 롤백 파일 끝에도 누수·서명 검증 블록을 둔다. `*_credits_once` 권한은 되돌리지 않는다(다시 열면 보안 구멍 복원).
   - 다음 함수들의 `pg_get_functiondef`를 저장한다.
     ```sql
     select string_agg(pg_get_functiondef(p.oid)||';', E'\n') from pg_proc p
     where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname in (
       'prepare_payment_order','enforce_payment_reconciliation_health','get_my_payment_history',
       'get_my_refund_requests','get_point_charge_refund_eligibility','request_point_charge_refund',
       'claim_point_charge_refund','finalize_point_charge_refund','reject_point_charge_refund',
       'quarantine_external_provider_cancellation','mark_payment_reconciliation_terminal',
       'claim_payment_reconciliation_batch','payment_reconciliation_backlog_count',
       'prevent_payment_order_snapshot_update','prevent_payment_provider_identifier_replacement');
     ```
   - 같은 함수들의 권한을 복원할 GRANT 문을 만든다. `consume_credits_once`, `refund_credits_once`의 회수 전 ACL도 기록용으로 함께 조회한다(롤백에서 되돌리지는 않음).
     ```sql
     select p.oid::regprocedure, p.proacl::text from pg_proc p
     where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname in (<위 목록>);
     ```
     롤백 파일에 붙일 GRANT 문은 아래 쿼리로 바로 만든다. CREATE OR REPLACE는 ACL을 유지하므로, 실제 복원이 필요한 것은 DROP 후 다시 만드는 4개(`prepare_payment_order`, `reject_point_charge_refund`, `get_my_payment_history`, `get_my_refund_requests`)다. 참고로 회수 전 `*_credits_once` ACL은 `consume_credits_once` → PUBLIC·anon·authenticated·service_role, `refund_credits_once` → anon·service_role이다. 이 2개는 다시 열면 보안 구멍이 복원되므로 롤백 파일에서 실행하지 않고 주석으로만 남긴다(필요하면 사용자 결정 후 `to_regprocedure(…) IS NOT NULL` 가드 안에서 실행).
     ```sql
     select format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
            case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end)
     from pg_proc p cross join lateral aclexplode(p.proacl) a
     where p.pronamespace='public'::regnamespace and p.prokind='f'
       and p.proname in (<목록>) and a.grantee <> p.proowner;
     ```
   - CHECK 6개의 `pg_get_constraintdef`와 `refund_requests_cancel_idempotency_key` 정의도 저장한다.
   - `refund_requests`를 대상으로 한 `ON CONFLICT`가 DB 함수에 없는지 확인한다(현재 0건).
     ```sql
     select p.oid::regprocedure from pg_proc p
     where p.pronamespace='public'::regnamespace and p.prokind='f'
       and pg_get_functiondef(p.oid) ~* 'insert into (public\.)?refund_requests[^;]*on conflict';
     ```
6. 마이그레이션 계약 테스트(정적, `node --test`)를 통과시킨다. 로컬 `supabase db reset`은 이 환경에 Docker·Supabase CLI가 없어 쓰지 않는다(2026-10-19 사용자 결정). 대신 8의 운영 리허설로 실제 스키마에서 검증한다.
7. 대사 후보 식을 비교할 준비를 한다. `claim_payment_reconciliation_batch`의 이전 후보 식을 SELECT로 옮겨 적고, 적용 전 `payment_reconciliation_backlog_count()` 값을 기록한다(현재 0).
8. 운영 리허설을 한다. 1단계 동안 필요할 때 반복해도 되며 매번 승인받지 않는다(2026-10-19 사용자 결정, 실제 적용만 승인). `BEGIN; <A 전문>; <A-post 검증>; ROLLBACK;`으로 실행한다. 리허설 중에도 DDL 잠금이 걸리므로, 대화형으로 나누지 않고 `execute_sql` 한 번 호출로 끝까지 보낸다(A-post 13·14의 임시 행 생성까지 포함).

## A-post (마이그레이션 안의 검증 블록 + 적용 후 재확인)

1. `prepare_payment_order` 오버로드가 1개이고, `pronargs=18`, `pronargdefaults=1`이다.
2. `payment_orders.provider`의 `column_default`가 NULL이다.
3. 권한 누수 0건. 이름 정규식으로 찾지 않고 셋으로 나눠 검사한다(이름 정규식은 기존 함수 6건을 잡아 검증 블록이 항상 롤백되고, 새 헬퍼 이름을 놓칠 수 있다).
   ```sql
   -- (a) 범용: public의 SECURITY DEFINER 함수 중 PUBLIC/anon이 실행할 수 있는 것 = handle_new_user만 (현재 운영 결과와 같음)
   select p.oid::regprocedure from pg_proc p
   where p.pronamespace='public'::regnamespace and p.prokind='f' and p.prosecdef
     and (p.proacl is null or p.proacl::text ~ '(\{|,)(=|anon=)X')
     and p.oid <> 'public.handle_new_user()'::regprocedure;            -- 0건
   -- (b) 이번 마이그레이션이 만들거나 고친 함수(서명을 전부 명시). 서명이 틀리면 캐스팅 오류 → 존재 확인을 겸함
   with t(oid) as (values ('public.apply_payapp_feedback(<인자 타입>)'::regprocedure) /* , … 전부 */)
   select t.oid from t join pg_proc p on p.oid = t.oid
   where p.proacl is null or p.proacl::text ~ '(\{|,)(=|anon=|authenticated=)X'
      or not p.prosecdef
      or not coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'];   -- 0건
   -- (c) authenticated 허용 목록: get_my_payment_history(), get_my_refund_requests()
   --     authenticated=X는 있고, PUBLIC(=X)·anon=X는 없어야 한다
   ```
   - (b) 목록에서 빼는 것: 트리거 함수(`prorettype='trigger'::regtype`, INVOKER), (c)의 `get_my_*` 2개. 이것들을 넣으면 검증 블록이 항상 롤백된다.
   - 지급 내부 함수는 (b)에 넣되, 추가로 `proacl`이 정확히 `{postgres=X/postgres}`인지 확인한다(`service_role=X`가 없어야 한다).
   - `consume_credits_once`, `refund_credits_once`(SECURITY INVOKER라 (a)에 안 잡힘): `proacl`에 `=X`·`anon=X`·`authenticated=X`가 없고 `service_role=X`는 있다(마이그레이션 A에서 회수).
     - 파일 안 회수와 검증 블록은 `to_regprocedure('public.consume_credits_once(uuid,integer,text,uuid,text,text)')`, `to_regprocedure('public.refund_credits_once(uuid,integer,text,uuid,text,text,text,integer)')`가 NOT NULL일 때만 실행한다(로컬에는 두 함수가 없다). `'…'::regprocedure` 캐스팅은 로컬에서 실패하므로 쓰지 않는다.
     - 운영 리허설과 적용 뒤에는 두 `to_regprocedure`가 **NOT NULL인지 필수로 확인**한다(서명 오타로 회수가 조용히 건너뛰어지는 것을 막는다).
4. `payment_methods`와 `payment_admin_actions`: RLS가 켜져 있고, ACL에 anon·authenticated가 없으며, service_role은 SELECT만 있다. `payment_methods`는 5행이다. `payment_admin_actions`의 참조 컬럼(주문·환불·처리자 id)은 FK 없이 uuid만 저장한다(FK의 SET NULL·CASCADE가 append-only 트리거와 충돌하고, RESTRICT는 계정 삭제를 막기 때문).
5. CHECK 6개(provider 5곳 + 스냅샷)에 `'payapp'`이 들어 있고 모두 `convalidated=true`다. 복합 FK와 `provider <> 'payapp' OR payment_method_code IS NOT NULL` CHECK가 있다.
6. `refund_requests_cancel_idempotency_key`가 열린 상태로 한정된 partial unique다.
7. `payment_runtime_config`: payapp은 false/NULL이고, 나머지 값은 A-pre와 같다.
8. 트리거 함수가 반영됐다.
   - `prevent_payment_order_snapshot_update`에 `payment_method_code`가 있다.
   - `prevent_payment_provider_identifier_replacement`에 결제완료·취소 표식 컬럼이 있다.
9. health 함수의 카카오페이 블록이 저장해 둔 이전 정의와 같다(계약 테스트). 반환 키 `kakaopay_disabled`도 유지된다. 카카오 부분취소 표식 블록은 그 밖에 따로 있다.
10. 호환 smoke test:
    - **(사용자 승인 필요)** 토스 test 결제 1건을 주문 생성 → 승인 → 지급까지 진행한다(현재 test 모드). 운영 DB에 주문·크레딧·결제내역 행이 실제로 생기므로, 끝난 뒤 그 건을 관리자 환불로 정리할지 남길지 미리 정한다.
    - 다음 cron 뒤 `payment_reconciliation_runs` 최근 2건이 succeeded이고 `payment_reconciliation_scheduler.consecutive_failures=0`이다.
    - 결제내역 페이지 2곳(`/mypage/payments`, legacy)이 정상이다.
11. 출시 1의 두 쿼리(미지급 판정, 취소 표식 미처리)를 한 번 실행해 문법을 확인한다(새 컬럼이 생긴 뒤라야 실행된다).
12. 대사 후보 비교: 이전 식과 새 식을 각각 SELECT로 실행해 양방향 `EXCEPT`가 모두 0건이다(현재 payapp 행과 카카오 부분취소 표식이 없으므로 같아야 한다). `payment_reconciliation_backlog_count()`가 적용 전 값과 같다.
13. `refund_requests.origin` 트리거: `'user'→'external_cancel'` UPDATE는 되고, `'external_cancel'→'user'`는 예외가 나는지 리허설 트랜잭션 안에서 확인한다.
14. `record_kakaopay_partial_cancel_marker`, `quarantine_kakaopay_partial_cancellation`: (b) 목록에 들어 있다. 리허설 트랜잭션 안에서 임시 카카오 주문으로 ① 미지급 → 표식 기록 → 주문만 `manual_review`, 처리 시각 설정 ② 지급 + 사용자 환불 `pending_review` → 표식 기록 뒤 대사 후보 식에 잡힘 → 격리 후 환불 `manual_review`·`origin='partial_cancel'`, 원천 `pending_refund`, 처리 시각 설정, 후보 식에서 빠짐 ③ 같은 호출 반복 → 알림·요청 수 변화 없음 ⑤ 거절된 요청이 있는 주문에서 새 `partial_cancel` 요청 생성(23505 없음) ⑥ 지급 + 환불 `processing` → 바로 `partial_cancel` 전환 ⑦ 격리 요청에 `finalize_point_charge_refund` → 예외 ⑧ 표식 미처리 + 격리 RPC를 `'CANCEL_PAYMENT'`로 호출 → 격리 완료, 처리 시각 설정, `provider_status='CANCEL_PAYMENT'` ④-a 표식 RPC에 `'PART_CANCEL_PAYMENT'`가 아닌 값 → 예외 ④-b 격리 RPC에 빈 상태 값 → 예외 ④-c 표식 없이 격리 RPC 호출 → 예외, 를 확인하고 롤백한다. 예외를 기대하는 확인(④·⑦·13번, 그 밖에 넣는 예외 확인 전부)은 `DO $$ BEGIN PERFORM …; RAISE EXCEPTION 'EXPECTED_ERROR_NOT_RAISED'; EXCEPTION WHEN <기대 SQLSTATE> THEN NULL; END $$`처럼 서브트랜잭션 안에서 한다(그냥 호출하면 리허설 트랜잭션이 abort돼 뒤 검증이 돌지 않는다).
15. `list_migrations` 버전으로 파일명을 바꾼다.

## B1 (약관·푸터 문구, 출시 직전)

1. **pre:**
   - `select md5(value::text) from system_settings where key='site_footer_content';` 결과를 마이그레이션의 WHERE에 넣는다.
   - 검사어('토스페이먼츠', '페이코', '일반결제', '카카오페이머니만')별 현재 개수를 기록한다.
2. **적용:** `jsonb_set`으로 정해진 경로만 고친다. 바뀐 행이 정확히 1건이 아니면 RAISE 한다.
3. **post:**
   - 검사어가 0건이다.
   - 페이앱·카카오페이 위탁 문구가 있다.
   - `/terms/privacy`, `/terms/refund` 화면을 확인한다.

## B2-pre (토스 제거 코드가 Production에 배포된 뒤)

0. 배포 직후 운영 정리(사용자 작업): 토스 상점관리자에 등록한 웹훅 URL(`/api/payments/webhooks/toss`, 배포 뒤 404)을 해제하고, Vercel의 `TOSS_*`·`NEXT_PUBLIC_TOSS_*` 환경변수 7개를 지운다.
1. DB 의존성이 0건인지 본다.
   ```sql
   select p.oid::regprocedure from pg_proc p
   where p.pronamespace='public'::regnamespace
     and p.proname not in ('finalize_toss_payment','get_toss_refund_eligibility','request_toss_refund',
       'claim_toss_refund','finalize_toss_refund','fail_toss_refund','reject_toss_refund')
     and p.prokind='f' and pg_get_functiondef(p.oid) ~ '(finalize_toss_payment|get_toss_refund_eligibility|(request|claim|finalize|fail|reject)_toss_refund|toss_accepts_new_orders|toss_merchant_id)';
   ```
   - 같은 정규식으로 `pg_views`, `pg_matviews`, `pg_policies`(qual/with_check), `cron.job.command`도 확인한다.
   - `pg_depend`에서 이 7개 함수를 참조하는 행이 0건인지 본다.
2. 진행 중인 토스 건이 0건인지 본다.
   - `payment_orders`: `provider='toss'`이고 status가 completed/failed/expired/refunded가 아닌 행
   - `refund_requests`: `provider='toss'`이고 status가 열린 상태인 행
3. 코드 확인:
   - Production SHA와 살아 있는 Preview 배포에서 `grep -rn "toss_accepts_new_orders\|toss_merchant_id\|finalize_toss_payment\|_toss_refund" src` 결과가 0건이다.
   - API 로그에서 최근 24시간 `/rpc/*toss*` 호출이 0건이다.
4. 롤백 파일에 함수 7개의 정의와 ACL, `toss_*` 현재 값을 저장한다.

## B2-post

1. 함수 7개와 컬럼 2개가 없다. `to_regprocedure`는 인자 없이 쓰면 함수가 있어도 NULL이 되므로 쓰지 않는다.
   ```sql
   select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in (
     'finalize_toss_payment','get_toss_refund_eligibility','request_toss_refund','claim_toss_refund',
     'finalize_toss_refund','fail_toss_refund','reject_toss_refund');   -- 0
   ```
2. 남겨야 할 것이 그대로 있다.
   - CHECK 5곳의 `'toss'`
   - 스냅샷 CHECK의 toss 분기
   - `payment_orders.mid`, `payment_key`
3. 토스 원천 환불을 시도하면 "환불 불가"가 나온다.
4. smoke test: checkout 화면, 카카오 route, 결제내역 화면. `src/types/supabase.ts`를 다시 생성한다.

## 출시 (단계 8)

1. **직전:**
   - 페이앱 `manual_review`가 0건이다.
   - 계획서 5.7의 미지급 판정 쿼리 결과가 0건이다.
     ```sql
     select po.order_id from payment_orders po
     join payment_provider_transactions ppt on ppt.payment_order_id = po.id
     where po.provider = 'payapp'
       and ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
       and po.source_id is null
       and ppt.cancel_feedback_recorded_at is null
       and ppt.partial_cancel_feedback_recorded_at is null;
     ```
   - 취소 표식 미처리 쿼리 결과가 0건이다.
     ```sql
     select po.order_id,
            exists (select 1 from credit_sources cs where cs.payment_order_id = po.id and cs.status = 'active') as blocks_launch
     from payment_orders po
     join payment_provider_transactions ppt on ppt.payment_order_id = po.id
     where po.provider = 'payapp'
       and ((ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes' and ppt.cancel_processed_at is null)
         or (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes' and ppt.partial_cancel_processed_at is null));
     ```
     - 0건이 아니면 원천 상태를 확인한다. 원천이 `active`인 건이 있으면 출시를 멈추고, `pending_refund`이거나 원천이 없는 건은 처리를 끝낸 뒤 출시한다.
   - 미해소 경보가 0건이다(기존 2건은 2026-10-19 `20261019061626`으로 해소함). 새로 생긴 경보가 있으면 원인을 확인한 뒤 출시한다.
   - 관리자 화면의 경보 해소(`resolve_payment_alert`)로 닫은 경보는 `payment_admin_actions where action='alert_resolved'`에서 각각 원인 처리 메모가 있는지 확인한다. 해소 뒤 health가 1회 이상(5분 이상) 돈 다음에도 0건인지 다시 본다.
2. **스위치 마이그레이션:**
   - `payapp_merchant_id`를 설정하고 `payapp_accepts_new_orders=true`로 바꾼다.
   - `changed_by`, `change_ticket`을 기록하고, 이전 값을 주석에 남긴다.
3. **직후 10분:** health가 2회 도는 동안 `changed_by`가 `payment_reconciliation_health`로 바뀌지 않는지 본다.
4. **실결제 시험:** 운영자 카드로 1건 결제 → 크레딧 지급 확인 → 관리자 환불 → 취소 통보 처리 확인.
   - 매뉴얼에 없는 실제 형식을 함께 확인한다: `payurl`이 https인지(모듈과 `store_payapp_request`가 https만 받는다. http면 둘 다 고친다), 통보의 `pay_date`·`canceldate`가 `YYYY-MM-DD HH:MM:SS`인지(아니면 `dateParseFailed` 경보가 남는다).
   - 결제하지 않은 요청 1건을 `cancelmode=ready`로 취소해 `partcancel` 없이 전취소되는지 확인한다.
5. **실패 시:** 스위치 off 마이그레이션을 적용한다.

## 카카오페이 live 전환 (별도)

1. 진행 중인 카카오 주문이 0건인지 확인한다.
2. Vercel에 live 키를 넣는다.
3. 마이그레이션으로 `accepted_provider_environment='live'`, `kakaopay_merchant_id`, `kakaopay_accepts_new_orders=true`를 설정한다.

## 운영 적용 기록

적용 방식(공통 규칙 1·2·9 대신 실제로 쓴 방법):
- `apply_migration`에 큰 파일을 다시 입력하지 않으려고, Supabase SQL Editor에서 파일 전체와 `supabase_migrations.schema_migrations` INSERT(statements에 파일 원문)를 한 번에 실행했다.
- SQL Editor는 한 번의 실행을 한 트랜잭션으로 처리한다. 리허설 파일 끝의 `RAISE`가 앞의 모든 변경을 되돌린 것으로 확인했다(`rehearsal.ran` 표식이 결과 메시지에 나와 전체가 실행됐음을 확인). 그래서 `SET LOCAL`도 그 트랜잭션 안에서 적용된다.
- 적용 뒤 `length(statements[1])`이 파일 글자 수와 같은지 확인했다.
- B2-pre 0(2026-10-21, 사용자 확인): Vercel 토스 환경변수를 삭제했다. 토스 상점관리자에는 웹훅 주소가 원래 등록되어 있지 않아 해제할 것이 없었다.

| 마이그레이션 | 적용 시각(UTC) | 기록 길이 | 결과 |
|---|---|---|---|
| `20261019090000_payapp_migration_a` | 2026-10-20 05:25 | 154052 | A-post 통과 |
| `20261020090000_payment_alert_resolution` | 2026-10-20 08:05 | 4392 | 권한·CHECK 확인 |
| `20261021090000_payapp_migration_b2` | 2026-10-21 01:37 | 21853 | B2-post 1~4 통과(토스 함수·컬럼 0, 보존 CHECK 6·컬럼 2, 실제 토스 건 `REFUND_CREDITS_ALREADY_USED` 유지, 타입 재생성) |
