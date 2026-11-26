-- 16번 묶음 리허설: B full — 16번 마이그레이션 원본 + 적용 절차(이력 INSERT) + light 경우 전부 + R2 세션·R3 성공·R5 회수·R6 칸 권한·R9 거절·R7 되돌리기
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle16_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle16_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 새벽 짧은 창, 적용 승인 뒤 적용 직전(refund_requests·payment_admin_actions·notifications·system_settings 를 ROLLBACK 까지 잠근다, 이력 표에 쓴다 — ROLLBACK 됨)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '300s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _rh_log, _rh_ctx TO PUBLIC;
GRANT USAGE ON SEQUENCE _rh_log_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.uid(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v::uuid FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지 [SQLSTATE]'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
-- 결과(jsonb)를 돌려주는 함수 호출: 'OK {json}' 또는 'ERR 메시지'
CREATE FUNCTION pg_temp.try_json(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN 'OK ' || coalesce(v::text, 'null');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT substr(p_result, 4)::jsonb $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 120);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.subst_once(p_src text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_from = '' OR (length(p_src) - length(replace(p_src, p_from, ''))) / length(p_from) <> 1 THEN
    RAISE EXCEPTION 'RH FAIL copy line not found exactly once: %', left(p_from, 200);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log WHERE action = p_action AND created_at >= now()
$f$;
CREATE FUNCTION pg_temp.audit_last(p_action text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT a.details FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
   ORDER BY (a.details ->> 'saved_at') DESC NULLS LAST, (a.details ->> 'retracted_at') DESC NULLS LAST LIMIT 1
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체, 넘긴 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object'
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
CREATE FUNCTION pg_temp.texts() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'member_notification_texts' $f$;
CREATE FUNCTION pg_temp.texts_rev() RETURNS integer LANGUAGE sql AS $f$ SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'member_notification_texts' $f$;
CREATE FUNCTION pg_temp.support() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'support_page_content' $f$;
CREATE FUNCTION pg_temp.save_texts(p_actor uuid, p_rev integer, p_value jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_member_notification_texts(%L, %L, %L::jsonb, %L::jsonb)', p_actor, p_rev, p_value, '{"ip": "203.0.113.16", "user_agent": "rh16"}'))
$f$;
CREATE FUNCTION pg_temp.send(p_actor uuid, p_key uuid, p_target text, p_title text, p_message text, p_link text, p_post uuid, p_expected integer,
  p_version integer DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.send_member_broadcast(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L::jsonb)', p_actor, p_key, p_target,
    p_title, p_message, p_link, p_post, p_expected,
    coalesce(p_version, (SELECT (value #>> '{broadcast,notAdvertisingStatementVersion}')::integer FROM public.system_settings WHERE key = 'member_notification_texts')),
    '{"ip": "203.0.113.16", "user_agent": "rh16"}'))
$f$;
CREATE FUNCTION pg_temp.preview(p_actor uuid, p_target text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.member_broadcast_preview(%L, %L)', p_actor, p_target))
$f$;
CREATE FUNCTION pg_temp.retract(p_actor uuid, p_id uuid, p_code text, p_redact boolean) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.retract_member_broadcast(%L, %L, %L, %L, %L::jsonb)', p_actor, p_id, p_code, p_redact, '{"ip": "203.0.113.16", "user_agent": "rh16"}'))
$f$;
-- 보내기 함수와 같은 내용 지문(재요청 대조)
CREATE FUNCTION pg_temp.sha(p_target text, p_title text, p_message text, p_link text, p_post uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(sha256(convert_to(jsonb_build_array(p_target, p_title, p_message, p_link, p_post)::text, 'UTF8')), 'hex')
$f$;
-- 기록 표에 바로 넣기(postgres, 가드는 UPDATE·DELETE 만 막음) — 상한·재요청 경우용
CREATE FUNCTION pg_temp.put_broadcast(p_actor uuid, p_target text, p_key uuid DEFAULT gen_random_uuid(), p_title text DEFAULT '시험',
  p_message text DEFAULT '시험 내용', p_retracted boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  EXECUTE 'INSERT INTO public.member_notification_broadcasts (operation_key, actor_id, target, title, message, content_sha256, recipient_count,
      not_advertising_statement_version, not_advertising_statement_text, retracted_at, retracted_by, retract_reason_code, retracted_deleted_count,
      retracted_read_count)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $8, $9, $10, $11, $11) RETURNING id'
    INTO v_id
    USING p_key, p_actor, p_target, p_title, p_message, pg_temp.sha(p_target, p_title, p_message, NULL, NULL), '리허설 경계 문장',
          CASE WHEN p_retracted THEN clock_timestamp() END, CASE WHEN p_retracted THEN p_actor END,
          CASE WHEN p_retracted THEN 'mistake' END, CASE WHEN p_retracted THEN 0 END;
  RETURN v_id;
END $f$;
CREATE FUNCTION pg_temp.recipients(p_target text, p_actor uuid) RETURNS uuid[] LANGUAGE plpgsql AS $f$
BEGIN
  RETURN ARRAY(SELECT r FROM public.member_broadcast_recipients(p_target, p_actor) r);
END $f$;
-- 화면 세션처럼(역할 + JWT claims) 한 값을 읽는다: 'OK 값' 또는 'ERR … [SQLSTATE]'. 끝나면 역할·claims 를 되돌린다.
CREATE FUNCTION pg_temp.as_session(p_sub uuid, p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_sub IS NULL THEN '' ELSE jsonb_build_object('sub', p_sub, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v;
    RESET ROLE;
    v := 'OK ' || coalesce(v, 'null');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v := 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $f$;

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로)
SELECT pg_temp.ctx_set('mode', 'full');
SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 16번 묶음: 회원 알림 문구 관리 + 공지 알림 보내기(계획 docs/plan-bundle16-notification-copy.md 4판, 5절).
-- 만드는 것:
--   1. 표 member_notification_broadcasts(공지 알림 보낸 기록 — 회원을 가리키는 칸 없음, 인원 수·공개 문구·관리자 id 만).
--      RLS 켬·정책 0, PUBLIC·anon·authenticated·service_role 전부 회수 뒤 service_role 에 SELECT 만(쓰기는 아래 DEFINER 함수만).
--      가드: UPDATE 는 회수 칸(retracted_*) NULL→값과 가림(redacted_* NULL→값, 제목·내용 → 가림 문구)만, DELETE·TRUNCATE 거부.
--   2. 설정 행 system_settings.member_notification_texts(알림 12종 문구·켜기, 마켓 환불 문장 4개, 공지 알림 설정 — 있으면 그대로)와
--      쓰기 막기 RESTRICTIVE 정책(결제·환불 결과와 환불정책 약속을 담은 문구라 대표 세션 직접 UPDATE 를 막는다).
--      답변 두 종류는 적용 순간의 support_page_content(13번) 값을 복사한다(5-2 대응표).
--   3. 함수(service_role 만 EXECUTE): member_broadcast_recipients(INVOKER)·member_broadcast_preview·save_member_notification_texts·
--      send_member_broadcast·retract_member_broadcast, 내부 검사 함수 member_notification_texts_problem(아무도 EXECUTE 없음),
--      기록 표 가드 함수.
--   4. 충전 환불 거절(5-8, 결제 DB): refund_requests.member_reject_reason 칸, 거절 함수 새 서명(5인자, DEFAULT 없음 — 옛 4인자와 겹치지 않음),
--      payment_admin_actions action CHECK 에 refund_rejected, 탈퇴 가림(member_withdrawal_facts·redact_member_text)이 새 칸을 다룬다.
--      옛 4인자 거절 함수는 DB 적용~배포 사이 옛 코드가 부르므로 두고, 배포 뒤 정리 스크립트가 지운다(5-6).
--   5. notifications.broadcast_id 칸(기록 표 FK)과 부분 인덱스.
-- 기존 표에 거는 DDL(잠금): refund_requests·payment_admin_actions·notifications 는 ACCESS EXCLUSIVE(칸 추가·CHECK 다시 만들기·FK),
--   system_settings 는 정책 만들기. 모두 아래 '[16번 기존 표 DDL]' 한 구역에 모았다(리허설 light 사본은 이 구역과 그 VERIFY 블록을 뺀다).
--   새벽에 lock_timeout 3초로 한 거래에 적용한다. 잡지 못하면 전체가 취소된다.
-- 사전 점검 지문: md5(pg_get_functiondef(oid))(운영 읽기 전용 값). 13번이 다시 정의하는 두 함수는 '13번 뒤 판'(13번 계획 18-4 light 측정값) 또는
--   '16번 확장 판'(다시 적용 — md5(prosrc), 이 파일 본문에서 계산)이면 통과한다.
-- 작업 기록(admin_audit_log)에는 공지 알림 제목·내용 원문과 회원 id 를 넣지 않는다(지문·글자 수·인원 — 원문은 가릴 수 있는 기록 표).
--   예외: 문구 수정 기록(member_notification_texts_update)은 회사 공개 문구라 바뀐 경로의 before·after 원문을 남긴다(계획 4절).
-- 되돌리기: supabase/rollback/20261218100000_bundle16_member_notifications_down.sql(키 되살리기 스크립트 → 코드 되돌리기 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(5-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle16_member_notifications$
DECLARE
  v_new_functions text[] := ARRAY['member_broadcast_recipients', 'member_broadcast_preview', 'save_member_notification_texts',
    'send_member_broadcast', 'retract_member_broadcast'];
  v_support jsonb;
  v_key text;
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed';
  END IF;
  -- 14번: 개인정보 판정 함수와 공지 글 표
  IF to_regprocedure('public.member_facing_text_pii_hits(text)') IS NULL OR to_regclass('public.site_board_posts') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 14 (member_facing_text_pii_hits / site_board_posts) is not applied';
  END IF;
  -- 13번 M1 뒤 판 또는 16번 확장 판(다시 적용)
  IF to_regprocedure('public.member_withdrawal_facts(uuid,boolean)') IS NULL
     OR NOT (md5(pg_get_functiondef('public.member_withdrawal_facts(uuid,boolean)'::regprocedure)) = '05923c4df814d40b6ec81d1d53d410aa'
             OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) = 'b2db6cf4ca0c8226b17c62a3ee113e88') THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_facts is neither the bundle 13 nor the bundle 16 version';
  END IF;
  IF to_regprocedure('public.redact_member_text(uuid,text,uuid,text,text,text)') IS NULL
     OR NOT (md5(pg_get_functiondef('public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)) = '47173300ae0fa1a96cb1d45faa6da353'
             OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = 'acf0b18ba4c87a11d96dc742565cbe71') THEN
    RAISE EXCEPTION 'PRECHECK: redact_member_text is neither the bundle 13 nor the bundle 16 version';
  END IF;
  -- 재정의 두 함수의 보안 방식·권한(적용 전과 같아야 함 — VERIFY 가 다시 본다)
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS NOT FALSE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}'
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_facts / redact_member_text security or privileges changed';
  END IF;
  -- 옛 4인자 거절 함수(운영 원문 그대로) — DB 적용~배포 사이 옛 코드가 부른다
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
     OR md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) <> '20384719deba112e977fbd3bf8e266e5' THEN
    RAISE EXCEPTION 'PRECHECK: reject_point_charge_refund(uuid,uuid,text,boolean) changed or missing';
  END IF;
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 16 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id') THEN
    RAISE EXCEPTION 'PRECHECK: notifications.broadcast_id already exists';
  END IF;
  -- 첫 적용이면(설정 행 없음) 13번 M1 의 답변 알림 키 5개가 있어야 복사할 수 있다. 다시 적용(설정 행 있음)은 아래 대조 블록이 본다.
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_notification_texts') THEN
    SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content';
    IF v_support IS NULL THEN
      RAISE EXCEPTION 'PRECHECK: support_page_content (bundle 13 M1) missing';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
                                 'answerEditedNotificationMessage'] LOOP
      IF jsonb_typeof(v_support -> 'member' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_support -> 'member' ->> v_key) = '' THEN
        RAISE EXCEPTION 'PRECHECK: support_page_content.member.% missing', v_key;
      END IF;
    END LOOP;
    IF jsonb_typeof(v_support -> 'admin' -> 'notifyOnAnswerEdit') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'PRECHECK: support_page_content.admin.notifyOnAnswerEdit missing';
    END IF;
  END IF;
END;
$precheck_bundle16_member_notifications$;

-- [16번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 공지 알림 기록 표(5-3). 다시 적용(down 이 남긴 표)이면 만들기를 건너뛰고 아래 대조 블록이 칸·가드·권한을 본다. -------------------
CREATE TABLE IF NOT EXISTS public.member_notification_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL,
  target text NOT NULL CHECK (target IN ('all_members', 'self')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND btrim(title) <> '' AND strpos(title, E'\n') = 0),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500 AND btrim(message) <> ''),
  link_url text CHECK (link_url IS NULL OR char_length(link_url) BETWEEN 1 AND 200),
  post_id uuid CONSTRAINT member_notification_broadcasts_post_id_fkey REFERENCES public.site_board_posts(id),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  recipient_count integer NOT NULL CHECK (recipient_count >= 1),
  not_advertising_statement_version integer NOT NULL CHECK (not_advertising_statement_version >= 1),
  not_advertising_statement_text text NOT NULL CHECK (btrim(not_advertising_statement_text) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retracted_at timestamptz,
  retracted_by uuid,
  retract_reason_code text CHECK (retract_reason_code IS NULL OR retract_reason_code IN ('mistake', 'pii', 'wrong_target', 'other')),
  retracted_deleted_count integer CHECK (retracted_deleted_count IS NULL OR retracted_deleted_count >= 0),
  retracted_read_count integer CHECK (retracted_read_count IS NULL OR retracted_read_count >= 0),
  redacted_at timestamptz,
  redacted_by uuid,
  CONSTRAINT member_notification_broadcasts_retracted CHECK (
    (retracted_at IS NULL) = (retracted_by IS NULL) AND (retracted_at IS NULL) = (retract_reason_code IS NULL)
    AND (retracted_at IS NULL) = (retracted_deleted_count IS NULL) AND (retracted_at IS NULL) = (retracted_read_count IS NULL)),
  CONSTRAINT member_notification_broadcasts_redacted CHECK (
    (redacted_at IS NULL) = (redacted_by IS NULL) AND (redacted_at IS NULL OR retracted_at IS NOT NULL))
);
-- 상한(최근 24시간 같은 대상 수)과 목록(최신순)
CREATE INDEX IF NOT EXISTS member_notification_broadcasts_target_created ON public.member_notification_broadcasts (target, created_at);

COMMENT ON TABLE public.member_notification_broadcasts IS
  '16번: 공지 알림 보낸 기록(회원 칸 없음, 기한 없이 보관). 쓰기는 send/retract_member_broadcast 함수만, 가드가 회수·가림 칸만 고치게 한다.';

ALTER TABLE public.member_notification_broadcasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_notification_broadcasts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_notification_broadcasts TO service_role;

-- 가드: UPDATE 는 (가) 회수 칸 NULL→값(다섯 칸 함께), (나) 가림 칸 NULL→값과 제목·내용 → 지금 가림 문구(회수된 행만)만. 나머지 칸은 그대로.
CREATE OR REPLACE FUNCTION public.guard_member_notification_broadcasts_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_notification_broadcasts_mutation$
DECLARE
  v_redacted_text text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.operation_key, NEW.actor_id, NEW.target, NEW.link_url, NEW.post_id, NEW.content_sha256, NEW.recipient_count,
          NEW.not_advertising_statement_version, NEW.not_advertising_statement_text, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.operation_key, OLD.actor_id, OLD.target, OLD.link_url, OLD.post_id, OLD.content_sha256, OLD.recipient_count,
          OLD.not_advertising_statement_version, OLD.not_advertising_statement_text, OLD.created_at) THEN
    -- 회수 칸: 그대로이거나 NULL→값
    IF NOT ((NEW.retracted_at, NEW.retracted_by, NEW.retract_reason_code, NEW.retracted_deleted_count, NEW.retracted_read_count)
              IS NOT DISTINCT FROM (OLD.retracted_at, OLD.retracted_by, OLD.retract_reason_code, OLD.retracted_deleted_count, OLD.retracted_read_count)
            OR (OLD.retracted_at IS NULL AND NEW.retracted_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'MEMBER_BROADCASTS_APPEND_ONLY';
    END IF;
    -- 가림 칸: 그대로(제목·내용도 그대로)이거나 NULL→값이고 제목·내용 = 지금 가림 문구
    IF (NEW.redacted_at, NEW.redacted_by, NEW.title, NEW.message) IS NOT DISTINCT FROM (OLD.redacted_at, OLD.redacted_by, OLD.title, OLD.message) THEN
      RETURN NEW;
    END IF;
    v_redacted_text := (SELECT s.value #>> '{broadcast,redactedText}' FROM public.system_settings s WHERE s.key = 'member_notification_texts');
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.redacted_by IS NOT NULL AND NEW.retracted_at IS NOT NULL
       AND v_redacted_text IS NOT NULL AND NEW.title = v_redacted_text AND NEW.message = v_redacted_text THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'MEMBER_BROADCASTS_APPEND_ONLY';
END;
$fn_guard_member_notification_broadcasts_mutation$;
REVOKE ALL ON FUNCTION public.guard_member_notification_broadcasts_mutation() FROM PUBLIC, anon, authenticated, service_role;

DO $triggers_bundle16_broadcasts$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.member_notification_broadcasts'::regclass
                  AND t.tgname = 'guard_member_notification_broadcasts_mutation') THEN
    CREATE TRIGGER guard_member_notification_broadcasts_mutation
      BEFORE UPDATE OR DELETE ON public.member_notification_broadcasts
      FOR EACH ROW EXECUTE FUNCTION public.guard_member_notification_broadcasts_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.member_notification_broadcasts'::regclass
                  AND t.tgname = 'guard_member_notification_broadcasts_truncate') THEN
    CREATE TRIGGER guard_member_notification_broadcasts_truncate
      BEFORE TRUNCATE ON public.member_notification_broadcasts
      FOR EACH STATEMENT EXECUTE FUNCTION public.guard_member_notification_broadcasts_mutation();
  END IF;
END;
$triggers_bundle16_broadcasts$;

-- 다시 적용: down 이 지운 post_id FK 를 다시 붙인다. 지워진 글을 가리키는 값이 있으면(14번을 되돌렸다 다시 적용) NOT VALID 로 붙이고
--   그 건수를 알린다(기록 표는 가드로 고칠 수 없다).
DO $fk_bundle16_broadcasts$
DECLARE
  v_dangling integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.member_notification_broadcasts'::regclass
                  AND c.conname = 'member_notification_broadcasts_post_id_fkey') THEN
    SELECT count(*)::integer INTO v_dangling
      FROM public.member_notification_broadcasts b
     WHERE b.post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.site_board_posts p WHERE p.id = b.post_id);
    IF v_dangling > 0 THEN
      ALTER TABLE public.member_notification_broadcasts ADD CONSTRAINT member_notification_broadcasts_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES public.site_board_posts(id) NOT VALID;
      RAISE NOTICE 'member_notification_broadcasts.post_id FK added NOT VALID (% rows point to removed posts)', v_dangling;
    ELSE
      ALTER TABLE public.member_notification_broadcasts ADD CONSTRAINT member_notification_broadcasts_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES public.site_board_posts(id);
    END IF;
  END IF;
END;
$fk_bundle16_broadcasts$;

-- 2. 설정 행 구조 검사(5-2, 저장 함수·사전 대조·VERIFY 가 같이 쓴다). 문제가 없으면 NULL, 있으면 그 경로.
--    종류 키 집합·칸 이름·글자 수·끌 수 없는 종류(enabled = true, 내용에 {사유})·상한 범위. 허용 자리표시 전체 검사는 서버 액션의 TS 규칙
--    (src/lib/member-notifications.ts)이 한다(같은 규칙을 SQL 에 두 번 쓰지 않음).
CREATE OR REPLACE FUNCTION public.member_notification_texts_problem(p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_notification_texts_problem$
DECLARE
  -- 종류 키(src/lib/member-notifications.ts MEMBER_NOTIFICATION_KIND_KEYS 와 같은 목록·순서)
  v_kinds text[] := ARRAY['chargeCompleted', 'chargeRefundCompleted', 'chargeRefundBankTransfer', 'chargeRefundProviderFinalized',
    'supportAnswerCreated', 'supportAnswerEdited', 'creditGranted', 'creditRevoked', 'marketRefundApproved', 'marketRefundException',
    'marketRefundRejected', 'chargeRefundRejected'];
  -- 끌 수 없고 내용에 {사유}가 꼭 있어야 하는 종류(Q2)
  v_locked text[] := ARRAY['creditRevoked', 'marketRefundRejected', 'chargeRefundRejected'];
  -- 내용 없이 제목만 두는 종류(내용은 marketRefundMessage 문장 4개로 만든다)
  v_title_only text[] := ARRAY['marketRefundApproved', 'marketRefundException'];
  v_categories text[] := ARRAY['compensation', 'event', 'refund', 'other'];
  v_market text[] := ARRAY['base', 'reissued', 'missing', 'unknown'];
  v_broadcast text[] := ARRAY['memberLabel', 'allMembersDailyLimit', 'selfTestDailyLimit', 'notAdvertisingStatement',
    'notAdvertisingStatementVersion', 'redactedText'];
  v_kind text;
  v_item jsonb;
  v_text text;
  v_key text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN 'value';
  END IF;
  IF ARRAY(SELECT k FROM jsonb_object_keys(p_value) k ORDER BY k) <> ARRAY['broadcast', 'kinds', 'marketRefundMessage', 'revision'] THEN
    RETURN 'keys';
  END IF;
  IF jsonb_typeof(p_value -> 'revision') <> 'number' OR (p_value ->> 'revision') !~ '^[1-9][0-9]{0,8}$' THEN
    RETURN 'revision';
  END IF;
  IF jsonb_typeof(p_value -> 'kinds') <> 'object'
     OR ARRAY(SELECT k FROM jsonb_object_keys(p_value -> 'kinds') k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_kinds) k ORDER BY k) THEN
    RETURN 'kinds';
  END IF;
  FOREACH v_kind IN ARRAY v_kinds LOOP
    v_item := p_value -> 'kinds' -> v_kind;
    IF jsonb_typeof(v_item) <> 'object'
       OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k)
          <> (CASE WHEN v_kind = ANY (v_title_only) THEN ARRAY['enabled', 'title']
                   WHEN v_kind = 'creditGranted' THEN ARRAY['categoryLabels', 'enabled', 'message', 'title']
                   ELSE ARRAY['enabled', 'message', 'title'] END) THEN
      RETURN 'kinds.' || v_kind;
    END IF;
    IF jsonb_typeof(v_item -> 'enabled') <> 'boolean' OR (v_kind = ANY (v_locked) AND (v_item -> 'enabled') <> 'true'::jsonb) THEN
      RETURN 'kinds.' || v_kind || '.enabled';
    END IF;
    v_text := CASE WHEN jsonb_typeof(v_item -> 'title') = 'string' THEN v_item ->> 'title' END;
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 100 OR v_text ~ '[\r\n]' THEN
      RETURN 'kinds.' || v_kind || '.title';
    END IF;
    IF NOT v_kind = ANY (v_title_only) THEN
      v_text := CASE WHEN jsonb_typeof(v_item -> 'message') = 'string' THEN v_item ->> 'message' END;
      IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 500 OR (v_kind = ANY (v_locked) AND strpos(v_text, '{사유}') = 0) THEN
        RETURN 'kinds.' || v_kind || '.message';
      END IF;
    END IF;
  END LOOP;
  v_item := p_value #> '{kinds,creditGranted,categoryLabels}';
  IF jsonb_typeof(v_item) <> 'object' OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_categories) k ORDER BY k) THEN
    RETURN 'kinds.creditGranted.categoryLabels';
  END IF;
  FOREACH v_key IN ARRAY v_categories LOOP
    v_text := CASE WHEN jsonb_typeof(v_item -> v_key) = 'string' THEN v_item ->> v_key END;
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 20 OR v_text ~ '[\r\n]' THEN
      RETURN 'kinds.creditGranted.categoryLabels.' || v_key;
    END IF;
  END LOOP;
  v_item := p_value -> 'marketRefundMessage';
  IF jsonb_typeof(v_item) <> 'object' OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_market) k ORDER BY k) THEN
    RETURN 'marketRefundMessage';
  END IF;
  FOREACH v_key IN ARRAY v_market LOOP
    v_text := CASE WHEN jsonb_typeof(v_item -> v_key) = 'string' THEN v_item ->> v_key END;
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RETURN 'marketRefundMessage.' || v_key;
    END IF;
  END LOOP;
  v_item := p_value -> 'broadcast';
  IF jsonb_typeof(v_item) <> 'object' OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_broadcast) k ORDER BY k) THEN
    RETURN 'broadcast';
  END IF;
  v_text := CASE WHEN jsonb_typeof(v_item -> 'memberLabel') = 'string' THEN v_item ->> 'memberLabel' END;
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 10 OR v_text ~ '[\r\n]' THEN
    RETURN 'broadcast.memberLabel';
  END IF;
  IF jsonb_typeof(v_item -> 'allMembersDailyLimit') <> 'number' OR (v_item ->> 'allMembersDailyLimit') !~ '^[1-5]$' THEN
    RETURN 'broadcast.allMembersDailyLimit';
  END IF;
  IF jsonb_typeof(v_item -> 'selfTestDailyLimit') <> 'number' OR (v_item ->> 'selfTestDailyLimit') !~ '^([1-9]|[1-4][0-9]|50)$' THEN
    RETURN 'broadcast.selfTestDailyLimit';
  END IF;
  v_text := CASE WHEN jsonb_typeof(v_item -> 'notAdvertisingStatement') = 'string' THEN v_item ->> 'notAdvertisingStatement' END;
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 500 THEN
    RETURN 'broadcast.notAdvertisingStatement';
  END IF;
  IF jsonb_typeof(v_item -> 'notAdvertisingStatementVersion') <> 'number' OR (v_item ->> 'notAdvertisingStatementVersion') !~ '^[1-9][0-9]{0,8}$' THEN
    RETURN 'broadcast.notAdvertisingStatementVersion';
  END IF;
  -- 가림 문구는 기록 표 제목 칸(60자·한 줄)에 들어간다
  v_text := CASE WHEN jsonb_typeof(v_item -> 'redactedText') = 'string' THEN v_item ->> 'redactedText' END;
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 60 OR v_text ~ '[\r\n]' THEN
    RETURN 'broadcast.redactedText';
  END IF;
  RETURN NULL;
END;
$fn_member_notification_texts_problem$;
REVOKE ALL ON FUNCTION public.member_notification_texts_problem(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 설정 행(5-2, 11절 초안) — 첫 값은 지금 운영 글 그대로, 답변 두 종류는 support_page_content 값 복사. 대표가 관리자 '알림' 화면에서 고친다. ---
--    마켓 거절의 옛 빈 사유 대체 문구는 넣지 않는다(사유 없이 보내는 길이 없음, Q2).
INSERT INTO public.system_settings (key, value, description)
SELECT 'member_notification_texts',
       jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(seed.value,
         '{kinds,supportAnswerCreated,title}', s.value #> '{member,answerCreatedNotificationTitle}'),
         '{kinds,supportAnswerCreated,message}', s.value #> '{member,answerCreatedNotificationMessage}'),
         '{kinds,supportAnswerEdited,title}', s.value #> '{member,answerEditedNotificationTitle}'),
         '{kinds,supportAnswerEdited,message}', s.value #> '{member,answerEditedNotificationMessage}'),
         '{kinds,supportAnswerEdited,enabled}', s.value #> '{admin,notifyOnAnswerEdit}'),
       '16번: 회원 알림 문구·켜기·공지 알림 설정(저장은 save_member_notification_texts 만, 대표 세션 직접 쓰기 막힘)'
  FROM (SELECT $json_member_notification_texts$
{
  "revision": 1,
  "kinds": {
    "chargeCompleted": { "enabled": true, "title": "크레딧 충전 완료", "message": "결제가 확인되어 크레딧이 충전되었습니다." },
    "chargeRefundCompleted": { "enabled": true, "title": "원 결제수단 환불이 완료되었습니다", "message": "{금액}원 결제 취소가 완료되었습니다. 환불 반영 시점은 결제수단에 따라 다를 수 있습니다." },
    "chargeRefundBankTransfer": { "enabled": true, "title": "환불이 완료되었습니다", "message": "{금액}원을 계좌로 환불했습니다." },
    "chargeRefundProviderFinalized": { "enabled": true, "title": "환불 완료", "message": "결제 취소가 확인되어 환불이 완료되었습니다." },
    "supportAnswerCreated": { "enabled": true, "title": "(복사)", "message": "(복사)" },
    "supportAnswerEdited": { "enabled": true, "title": "(복사)", "message": "(복사)" },
    "creditGranted": {
      "enabled": true,
      "title": "크레딧이 지급되었습니다",
      "message": "{분류} 사유로 {수량} 크레딧이 지급되었습니다. (내용: {내용})",
      "categoryLabels": { "compensation": "보상", "event": "이벤트", "refund": "환불", "other": "기타" }
    },
    "creditRevoked": { "enabled": true, "title": "크레딧이 회수되었습니다", "message": "잘못 지급된 크레딧 {수량}개가 회수되었습니다. (사유: {사유})" },
    "marketRefundApproved": { "enabled": true, "title": "문제마켓 환불이 승인되었습니다" },
    "marketRefundException": { "enabled": true, "title": "문제마켓 환불이 처리되었습니다" },
    "marketRefundRejected": { "enabled": true, "title": "문제마켓 환불 요청이 거절되었습니다", "message": "환불 요청이 승인되지 않았습니다. 사유: {사유}" },
    "chargeRefundRejected": { "enabled": true, "title": "충전 환불 요청이 거절되었습니다", "message": "환불 요청이 승인되지 않았습니다. 사유: {사유}" }
  },
  "marketRefundMessage": {
    "base": "{수량} 크레딧이 돌아왔습니다.",
    "reissued": "그중 {수량} 크레딧은 새 유효기간으로 다시 지급되었습니다(만료일은 크레딧 관리에서 확인해 주세요).",
    "missing": "나머지 {수량} 크레딧은 결제에 쓴 크레딧의 사정(충전 환불 이력 등)으로 돌려드리지 못했습니다. 자세한 내용은 고객센터로 문의해 주세요.",
    "unknown": "크레딧 복구 내역은 크레딧 관리에서 확인해 주세요."
  },
  "broadcast": {
    "memberLabel": "공지",
    "allMembersDailyLimit": 1,
    "selfTestDailyLimit": 10,
    "notAdvertisingStatement": "이 알림은 약관·정책 변경, 장애·점검, 결제·환불 절차 변경 같은 서비스 이용 안내입니다. 새 자료 출시·이벤트·할인·쿠폰·가격 안내가 아니며, 그런 글이나 판매·충전 화면으로 연결하지 않습니다.",
    "notAdvertisingStatementVersion": 1,
    "redactedText": "개인정보가 포함되어 가린 알림입니다."
  }
}
$json_member_notification_texts$::jsonb AS value) seed
  CROSS JOIN public.system_settings s
 WHERE s.key = 'support_page_content'
   AND NOT EXISTS (SELECT 1 FROM public.system_settings x WHERE x.key = 'member_notification_texts');

-- 다시 적용·첫 적용 공통 대조(5-1): 설정 행 구조 검사, 답변 두 종류 = 지금 support_page_content 값(키가 있을 때만 — 정리 뒤면 키가 없다).
--   다르면 멈추고 대표가 어느 글을 쓸지 정한다.
DO $copy_check_bundle16_member_notifications$
DECLARE
  v_value jsonb := (SELECT value FROM public.system_settings WHERE key = 'member_notification_texts');
  v_support jsonb := (SELECT value FROM public.system_settings WHERE key = 'support_page_content');
  v_pair text[];
  v_problem text;
BEGIN
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: member_notification_texts row missing (support_page_content not found)';
  END IF;
  v_problem := public.member_notification_texts_problem(v_value);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: member_notification_texts shape invalid at %', v_problem;
  END IF;
  -- 5-2 대응표: support_page_content 경로 ↔ member_notification_texts 경로
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['{member,answerCreatedNotificationTitle}', '{kinds,supportAnswerCreated,title}'],
    ARRAY['{member,answerCreatedNotificationMessage}', '{kinds,supportAnswerCreated,message}'],
    ARRAY['{member,answerEditedNotificationTitle}', '{kinds,supportAnswerEdited,title}'],
    ARRAY['{member,answerEditedNotificationMessage}', '{kinds,supportAnswerEdited,message}'],
    ARRAY['{admin,notifyOnAnswerEdit}', '{kinds,supportAnswerEdited,enabled}']] LOOP
    IF v_support #> v_pair[1]::text[] IS NOT NULL AND v_support #> v_pair[1]::text[] IS DISTINCT FROM v_value #> v_pair[2]::text[] THEN
      RAISE EXCEPTION 'PRECHECK: support_page_content % differs from member_notification_texts % — owner decides which text to keep', v_pair[1], v_pair[2];
    END IF;
  END LOOP;
END;
$copy_check_bundle16_member_notifications$;

-- 4. 함수(5-4) ----------------------------------------------------------------------------------------------------
-- 4-1. 받는 사람(SECURITY INVOKER — 보내기·미리보기 함수 안에서만 쓴다. 회원 id 목록이라 anon·authenticated EXECUTE 를 반드시 회수).
--      all_members = 가입을 마친 회원(탈퇴·관리자 제외, 이용 제한·로그인 차단 회원 포함), self = 행위자 본인.
CREATE FUNCTION public.member_broadcast_recipients(p_target text, p_actor_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_broadcast_recipients$
  SELECT p.id
    FROM public.profiles p
   WHERE p_target = 'all_members'
     AND p.signup_completed IS TRUE
     AND p.withdrawn_at IS NULL
     AND NOT COALESCE(p.is_admin, false)
  UNION ALL
  SELECT p_actor_id
   WHERE p_target = 'self' AND p_actor_id IS NOT NULL
$fn_member_broadcast_recipients$;

-- 4-2. 미리보기(대표만): 인원·오늘(최근 24시간) 남은 횟수·다음 가능 시각·지금 경계 문장 판. 쓰기는 없지만 clock_timestamp() 를 쓰므로
--      VOLATILE(기본값)로 둔다.
CREATE FUNCTION public.member_broadcast_preview(p_actor_id uuid, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_broadcast_preview$
DECLARE
  v_settings jsonb;
  v_limit integer;
  v_used integer;
  v_next timestamptz;
  v_count integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER';
  END IF;
  IF p_target IS NULL OR p_target NOT IN ('all_members', 'self') THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:target';
  END IF;
  SELECT s.value -> 'broadcast' INTO v_settings FROM public.system_settings s WHERE s.key = 'member_notification_texts';
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
  END IF;
  v_limit := (v_settings ->> CASE WHEN p_target = 'all_members' THEN 'allMembersDailyLimit' ELSE 'selfTestDailyLimit' END)::integer;
  SELECT count(*)::integer INTO v_used
    FROM public.member_notification_broadcasts b
   WHERE b.target = p_target AND b.created_at > clock_timestamp() - interval '24 hours';
  -- 다음 가능 시각: 창 안의 오래된 순으로 (쓴 수 - 상한)번째 행이 24시간을 넘는 때
  IF v_used >= v_limit THEN
    SELECT b.created_at + interval '24 hours' INTO v_next
      FROM public.member_notification_broadcasts b
     WHERE b.target = p_target AND b.created_at > clock_timestamp() - interval '24 hours'
     ORDER BY b.created_at
     OFFSET v_used - v_limit
     LIMIT 1;
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.member_broadcast_recipients(p_target, p_actor_id);
  RETURN jsonb_build_object(
    'target', p_target,
    'recipientCount', v_count,
    'dailyLimit', v_limit,
    'usedInWindow', v_used,
    'remaining', GREATEST(v_limit - v_used, 0),
    'nextAvailableAt', v_next,
    'notAdvertisingStatementVersion', (v_settings ->> 'notAdvertisingStatementVersion')::integer);
END;
$fn_member_broadcast_preview$;

-- 4-3. 문구 저장(대표만): 판 비교, 구조 검사(종류 키 집합·끌 수 없는 종류·{사유}·길이·상한), 모든 문구 개인정보 검사.
--      경계 문장이 바뀌면 판을 함수가 올린다(보낸 값은 무시). 바뀌면 revision + 1, 기록에 바뀐 모든 경로의 before·after 원문(계획 4절 예외).
CREATE FUNCTION public.save_member_notification_texts(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_member_notification_texts$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_revision integer;
  v_old_version integer;
  v_new_version integer;
  v_statement_changed boolean;
  v_problem text;
  v_hits text[] := ARRAY[]::text[];
  v_changes jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_INPUT_INVALID:request';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_ACTOR_NOT_OWNER';
  END IF;
  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'member_notification_texts' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
  END IF;
  v_revision := (v_old ->> 'revision')::integer;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_REVISION_CONFLICT';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'broadcast') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_INPUT_INVALID:value';
  END IF;

  -- 경계 문장 판은 함수가 정한다: 문장이 바뀌면 지금 판 + 1, 아니면 지금 판.
  v_old_version := (v_old #>> '{broadcast,notAdvertisingStatementVersion}')::integer;
  v_statement_changed := (p_value #> '{broadcast,notAdvertisingStatement}') IS DISTINCT FROM (v_old #> '{broadcast,notAdvertisingStatement}');
  v_new_version := v_old_version + CASE WHEN v_statement_changed THEN 1 ELSE 0 END;
  v_new := jsonb_set(jsonb_set(p_value, '{revision}', to_jsonb(v_revision)), '{broadcast,notAdvertisingStatementVersion}', to_jsonb(v_new_version));

  v_problem := public.member_notification_texts_problem(v_new);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_INPUT_INVALID:%', v_problem;
  END IF;

  -- 회원에게 가는 모든 글(문구·분류 이름·문장·머리표·경계 문장·가림 문구)의 개인정보 모양(종류만 돌려줌)
  SELECT COALESCE(array_agg(DISTINCT h ORDER BY h), ARRAY[]::text[]) INTO v_hits
    FROM jsonb_path_query(v_new, '$.** ? (@.type() == "string")') s,
         unnest(public.member_facing_text_pii_hits(s #>> '{}')) h;
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_PII_SUSPECTED:%', array_to_string(v_hits, ',');
  END IF;

  IF (v_new - 'revision') = (v_old - 'revision') THEN
    RETURN jsonb_build_object('changed', false, 'revision', v_revision);
  END IF;

  -- 바뀐 모든 잎 경로(kinds·categoryLabels·marketRefundMessage·broadcast)의 before·after
  WITH RECURSIVE old_leaves(path, v) AS (
    SELECT e.key, e.value FROM jsonb_each(v_old - 'revision') e
    UNION ALL
    SELECT l.path || '.' || c.key, c.value FROM old_leaves l, jsonb_each(l.v) c WHERE jsonb_typeof(l.v) = 'object'
  ), new_leaves(path, v) AS (
    SELECT e.key, e.value FROM jsonb_each(v_new - 'revision') e
    UNION ALL
    SELECT l.path || '.' || c.key, c.value FROM new_leaves l, jsonb_each(l.v) c WHERE jsonb_typeof(l.v) = 'object'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('path', COALESCE(o.path, n.path), 'before', o.v, 'after', n.v)
                            ORDER BY COALESCE(o.path, n.path)), '[]'::jsonb)
    INTO v_changes
    FROM (SELECT * FROM old_leaves WHERE jsonb_typeof(v) <> 'object') o
    FULL JOIN (SELECT * FROM new_leaves WHERE jsonb_typeof(v) <> 'object') n ON n.path = o.path
   WHERE o.v IS DISTINCT FROM n.v;

  v_new := jsonb_set(v_new, '{revision}', to_jsonb(v_revision + 1));
  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'member_notification_texts';

  PERFORM public.record_admin_audit(p_actor_id, 'member_notification_texts_update', 'system_settings', 'member_notification_texts', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_revision,
      'revision_after', v_revision + 1,
      'changes', v_changes,
      'statement_version_before', v_old_version,
      'statement_version_after', v_new_version,
      'statement_before', CASE WHEN v_statement_changed THEN v_old #>> '{broadcast,notAdvertisingStatement}' END,
      'statement_after', CASE WHEN v_statement_changed THEN v_new #>> '{broadcast,notAdvertisingStatement}' END,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'revision', v_revision + 1, 'statementVersion', v_new_version);
END;
$fn_save_member_notification_texts$;

-- 4-4. 공지 알림 보내기(대표만). 순서(10-1 단언): 대표·경계 판 → 입력·링크·개인정보 → advisory lock → 같은 operation_key(재요청) → 상한 →
--      받는 사람 한 번 뽑기·인원 대조 → 기록 행 → 알림 INSERT(같은 배열) → 작업 기록(원문·회원 id 없음).
--      링크 허용 꼴(src/lib/member-notifications.ts BROADCAST_LINK_FORMS 와 같은 목록): 없음, /notices, /notices/{게시 중인 공지 uuid}(= p_post_id),
--      /faq, /faq#{uuid}, /terms, /terms/upcoming, /terms/{하단 정보에 켜진 문서 slug}. 쿼리·그 밖의 # 는 받지 않는다.
CREATE FUNCTION public.send_member_broadcast(p_actor_id uuid, p_operation_key uuid, p_target text, p_title text, p_message text,
  p_link_url text, p_post_id uuid, p_expected_count integer, p_not_advertising_version integer, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_send_member_broadcast$
DECLARE
  c_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_settings jsonb;
  v_version integer;
  v_statement text;
  v_title text := regexp_replace(replace(replace(COALESCE(p_title, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_message text := regexp_replace(replace(replace(COALESCE(p_message, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_link text := NULLIF(btrim(COALESCE(p_link_url, '')), '');
  v_hits text[];
  v_sha text;
  v_existing public.member_notification_broadcasts%ROWTYPE;
  v_limit integer;
  v_used integer;
  v_next timestamptz;
  v_recipients uuid[];
  v_count integer;
  v_inserted integer;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:request';
  END IF;
  -- 1. 대표·경계 문장 판
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER';
  END IF;
  SELECT s.value -> 'broadcast' INTO v_settings FROM public.system_settings s WHERE s.key = 'member_notification_texts';
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
  END IF;
  v_version := (v_settings ->> 'notAdvertisingStatementVersion')::integer;
  v_statement := v_settings ->> 'notAdvertisingStatement';
  IF p_not_advertising_version IS NULL OR p_not_advertising_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'BROADCAST_CONFIRM_REQUIRED';
  END IF;

  -- 2. 입력·링크·개인정보
  IF p_operation_key IS NULL THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:operationKey';
  END IF;
  IF p_target IS NULL OR p_target NOT IN ('all_members', 'self') THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:target';
  END IF;
  IF v_title = '' OR char_length(v_title) > 60 OR strpos(v_title, E'\n') > 0 THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:title';
  END IF;
  IF v_message = '' OR char_length(v_message) > 500 THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:message';
  END IF;
  IF p_post_id IS NOT NULL AND v_link IS DISTINCT FROM '/notices/' || p_post_id::text THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:linkUrl';
  END IF;
  IF v_link IS NOT NULL AND NOT (
       v_link IN ('/notices', '/faq', '/terms', '/terms/upcoming')
       OR (v_link ~ ('^/notices/' || c_uuid || '$') AND p_post_id IS NOT NULL)
       OR v_link ~ ('^/faq#' || c_uuid || '$')
       OR (v_link ~ '^/terms/[a-z0-9][a-z0-9-]{0,49}$'
           AND EXISTS (SELECT 1 FROM public.system_settings s, jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'policyDocuments') = 'object'
                                                                             THEN s.value -> 'policyDocuments' ELSE '{}'::jsonb END) d
                        WHERE s.key = 'site_footer_content' AND d.value ->> 'slug' = substr(v_link, 8)
                          AND d.value -> 'enabled' = 'true'::jsonb AND btrim(COALESCE(d.value ->> 'content', '')) <> ''))) THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:linkUrl';
  END IF;
  IF p_post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.site_board_posts sp
                                            WHERE sp.id = p_post_id AND sp.board = 'notice' AND sp.is_published AND sp.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:postId';
  END IF;
  IF p_expected_count IS NULL OR p_expected_count < 1 THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:expectedCount';
  END IF;
  v_hits := public.member_facing_text_pii_hits(v_title) || public.member_facing_text_pii_hits(v_message);
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'BROADCAST_PII_SUSPECTED:%', array_to_string(ARRAY(SELECT DISTINCT h FROM unnest(v_hits) h ORDER BY h), ',');
  END IF;
  v_sha := encode(sha256(convert_to(jsonb_build_array(p_target, v_title, v_message, v_link, p_post_id)::text, 'UTF8')), 'hex');

  -- 3. 잠금 → 같은 operation_key(동시 두 요청도 뒤쪽이 이 자리에서 앞쪽 결과를 본다)
  PERFORM pg_advisory_xact_lock(hashtext('member_broadcast'));
  SELECT * INTO v_existing FROM public.member_notification_broadcasts b WHERE b.operation_key = p_operation_key;
  IF FOUND THEN
    IF v_existing.content_sha256 = v_sha AND v_existing.target = p_target AND v_existing.actor_id = p_actor_id THEN
      RETURN jsonb_build_object('broadcast_id', v_existing.id, 'recipient_count', v_existing.recipient_count, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'BROADCAST_IDEMPOTENCY_CONFLICT';
  END IF;

  -- 4. 상한: 같은 대상의 최근 24시간 보내기 수(회수한 것 포함)
  v_limit := (v_settings ->> CASE WHEN p_target = 'all_members' THEN 'allMembersDailyLimit' ELSE 'selfTestDailyLimit' END)::integer;
  SELECT count(*)::integer INTO v_used
    FROM public.member_notification_broadcasts b
   WHERE b.target = p_target AND b.created_at > v_now - interval '24 hours';
  IF v_used >= v_limit THEN
    SELECT b.created_at + interval '24 hours' INTO v_next
      FROM public.member_notification_broadcasts b
     WHERE b.target = p_target AND b.created_at > v_now - interval '24 hours'
     ORDER BY b.created_at
     OFFSET v_used - v_limit
     LIMIT 1;
    RAISE EXCEPTION 'BROADCAST_RATE_LIMITED:%', to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;

  -- 5. 받는 사람을 한 번만 뽑아 세고, 같은 배열로 넣는다
  v_recipients := ARRAY(SELECT r FROM public.member_broadcast_recipients(p_target, p_actor_id) r);
  v_count := cardinality(v_recipients);
  IF v_count <> p_expected_count THEN
    RAISE EXCEPTION 'BROADCAST_COUNT_CHANGED:%', v_count;
  END IF;

  -- 6. 기록 행 → 알림
  INSERT INTO public.member_notification_broadcasts (operation_key, actor_id, target, title, message, link_url, post_id, content_sha256,
    recipient_count, not_advertising_statement_version, not_advertising_statement_text, created_at)
  VALUES (p_operation_key, p_actor_id, p_target, v_title, v_message, v_link, p_post_id, v_sha, v_count, v_version, v_statement, v_now)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, is_read, broadcast_id)
  SELECT r, 'announcement', v_title, v_message, v_link, false, v_id FROM unnest(v_recipients) r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- 그 사이 탈퇴로 트리거가 버린 행이 있으면 인원이 어긋난다 — 전체 취소
  IF v_inserted <> v_count THEN
    RAISE EXCEPTION 'BROADCAST_COUNT_CHANGED:%', v_inserted;
  END IF;

  -- 7. 작업 기록(제목·내용 원문과 회원 id 없음)
  PERFORM public.record_admin_audit(p_actor_id, 'member_broadcast_send', 'member_notification_broadcast', v_id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'broadcast_id', v_id,
      'target', p_target,
      'recipient_count', v_count,
      'content_sha256', v_sha,
      'title_length', char_length(v_title),
      'message_length', char_length(v_message),
      'link_url', v_link,
      'post_id', p_post_id,
      'not_advertising_statement_version', v_version,
      'request', p_request_meta,
      'saved_at', v_now),
    p_operation_key::text);

  RETURN jsonb_build_object('broadcast_id', v_id, 'recipient_count', v_count, 'replayed', false);
END;
$fn_send_member_broadcast$;

-- 4-5. 회수(대표만): 읽은 수를 센 뒤 모든 회원의 알림 목록에서 지운다. 개인정보면 기록 표의 제목·내용도 가림 문구로(되돌릴 수 없음).
--      이미 회수한 기록은 그대로(가림만 새로 요청하면 가림). 사유는 정해진 코드만(자유 글 없음).
CREATE FUNCTION public.retract_member_broadcast(p_actor_id uuid, p_broadcast_id uuid, p_reason_code text, p_redact boolean, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_retract_member_broadcast$
DECLARE
  v_old public.member_notification_broadcasts%ROWTYPE;
  v_text text;
  v_read integer := NULL;
  v_deleted integer := NULL;
  v_retract boolean;
  v_redact boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:request';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER';
  END IF;
  IF p_broadcast_id IS NULL THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:id';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('mistake', 'pii', 'wrong_target', 'other') THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:reasonCode';
  END IF;
  -- 개인정보가 들어간 알림은 가림도 함께(화면도 같은 규칙)
  IF p_redact IS NULL OR (p_reason_code = 'pii' AND NOT p_redact) THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:redact';
  END IF;

  SELECT * INTO v_old FROM public.member_notification_broadcasts b WHERE b.id = p_broadcast_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BROADCAST_NOT_FOUND';
  END IF;
  v_retract := v_old.retracted_at IS NULL;
  v_redact := p_redact AND v_old.redacted_at IS NULL;
  IF NOT v_retract AND NOT v_redact THEN
    RETURN jsonb_build_object('changed', false, 'broadcast_id', v_old.id);
  END IF;

  IF v_redact THEN
    v_text := (SELECT s.value #>> '{broadcast,redactedText}' FROM public.system_settings s WHERE s.key = 'member_notification_texts');
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 60 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
    END IF;
  END IF;

  IF v_retract THEN
    SELECT count(*) FILTER (WHERE n.is_read IS TRUE)::integer INTO v_read FROM public.notifications n WHERE n.broadcast_id = v_old.id;
    DELETE FROM public.notifications n WHERE n.broadcast_id = v_old.id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    UPDATE public.member_notification_broadcasts
       SET retracted_at = v_now, retracted_by = p_actor_id, retract_reason_code = p_reason_code,
           retracted_deleted_count = v_deleted, retracted_read_count = v_read
     WHERE id = v_old.id;
  END IF;
  IF v_redact THEN
    UPDATE public.member_notification_broadcasts
       SET title = v_text, message = v_text, redacted_at = v_now, redacted_by = p_actor_id
     WHERE id = v_old.id;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'member_broadcast_retract', 'member_notification_broadcast', v_old.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'broadcast_id', v_old.id,
      'reason_code', p_reason_code,
      'retracted', v_retract,
      'deleted_count', v_deleted,
      'read_count', v_read,
      'redacted', v_redact,
      'request', p_request_meta,
      'retracted_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'broadcast_id', v_old.id, 'retracted', v_retract, 'redacted', v_redact,
    'deleted_count', v_deleted, 'read_count', v_read);
END;
$fn_retract_member_broadcast$;

-- 4-6. 충전 환불 거절 새 서명(5-8). 어떤 인자에도 DEFAULT 가 없다 — 옛 코드의 이름 붙은 4인자 호출은 옛 함수 하나에만, 새 코드의 5인자 호출은
--      이 함수 하나에만 맞는다(PGRST203 없음). 옛 함수의 검사·상태 변경을 그대로 하고(결제사 취소 흔적이면 거절 불가 — 돈 흐름 그대로),
--      회원에게 보낼 거절 사유(1~300자, 개인정보·긴 숫자 거절)를 같은 거래에서 member_reject_reason 에 쓴다. 모든 거절에 처리 기록 1행:
--      수동 확인 건은 지금 그대로(note = 처리 메모) + member_reason_length, 보통 거절은 action refund_rejected·note 고정 표지(회원 사유·메모 글자 없음).
--      돌려주는 값: 받는 회원 id 와 저장한 사유(다듬은 값 — 알림과 실패 안내가 증빙과 같은 글을 쓰게).
CREATE FUNCTION public.reject_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_provider_not_cancelled_confirmed boolean,
  p_member_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_reject_point_charge_refund_v16$
DECLARE
  -- 보통 거절 처리 기록의 note(규칙 값 — 회원·관리자 글이 아님)
  c_rejected_note constant text := 'refund_rejected';
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_reason text := regexp_replace(replace(replace(COALESCE(p_member_reason, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'REFUND_REJECT_ACTOR_REQUIRED';
  END IF;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_request.status NOT IN ('pending_review', 'manual_review') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;
  END IF;

  -- 결제사에서 취소된 흔적이 있으면 거절해서 크레딧 동결을 풀면 안 된다.
  IF v_request.origin <> 'user'
     OR v_order.canceled_at IS NOT NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR (v_order.provider = 'kakaopay' AND v_ppt.provider_status = 'CANCEL_PAYMENT')
     OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  IF v_request.status = 'manual_review'
     AND (p_provider_not_cancelled_confirmed IS NOT TRUE
          OR NULLIF(BTRIM(p_admin_note), '') IS NULL) THEN
    RAISE EXCEPTION 'REFUND_REJECT_CONFIRMATION_REQUIRED';
  END IF;

  -- [16번] 회원에게 보낼 거절 사유(환불정책 3-2 ⑦ — 거절할 때는 언제나 사유를 알린다)
  IF v_reason = '' OR char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_REQUIRED';
  END IF;
  IF cardinality(public.member_facing_text_pii_hits(v_reason)) > 0 THEN
    RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_PII';
  END IF;
  -- 계좌번호·카드번호 같은 긴 숫자는 받지 않는다(알림 표는 가림 대상이 아니다 — 01-11 처리방침의 환불 계좌 파기 약속)
  IF public.member_text_has_long_number(v_reason) THEN
    RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_LONG_NUMBER';
  END IF;

  UPDATE public.credit_sources
     SET status = 'active'
   WHERE id = v_request.source_id
     AND status = 'pending_refund';

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = p_admin_note,
         member_reject_reason = v_reason,
         processed_by = p_admin_id,
         processed_at = now()
   WHERE id = v_request.id;

  IF v_request.status = 'manual_review' THEN
    INSERT INTO public.payment_admin_actions (
      actor_id,
      action,
      payment_order_id,
      refund_request_id,
      before_state,
      after_state,
      note,
      details
    ) VALUES (
      p_admin_id,
      'manual_review_refund_rejected',
      v_order.id,
      v_request.id,
      jsonb_build_object('request_status', v_request.status, 'source_status', v_source.status),
      jsonb_build_object('request_status', 'rejected', 'source_status', 'active'),
      p_admin_note,
      jsonb_build_object('provider_not_cancelled_confirmed', true, 'last_error_code', v_request.last_error_code,
                         'member_reason_length', char_length(v_reason))
    );
  ELSE
    INSERT INTO public.payment_admin_actions (
      actor_id,
      action,
      payment_order_id,
      refund_request_id,
      before_state,
      after_state,
      note,
      details
    ) VALUES (
      p_admin_id,
      'refund_rejected',
      v_order.id,
      v_request.id,
      jsonb_build_object('request_status', v_request.status, 'source_status', v_source.status),
      jsonb_build_object('request_status', 'rejected', 'source_status', 'active'),
      c_rejected_note,
      jsonb_build_object('member_reason_length', char_length(v_reason), 'admin_note_present', NULLIF(BTRIM(p_admin_note), '') IS NOT NULL)
    );
  END IF;

  RETURN jsonb_build_object('user_id', v_request.user_id, 'member_reject_reason', v_reason);
END;
$fn_reject_point_charge_refund_v16$;

-- 4-7. 탈퇴 가림(5-8): 13번 뒤 판 그대로에 '-- [16번]' 줄만 바꿨다. 보안 방식·권한(EXECUTE)은 CREATE OR REPLACE 가 그대로 둔다
--      (member_withdrawal_facts = INVOKER·postgres 만, redact_member_text = DEFINER·postgres·service_role — GRANT 하지 않는다).
-- 4-7-1. member_withdrawal_facts: refund_requests 의 긴 숫자 판정에 member_reject_reason.
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  -- [13번] (가) 계좌 요청 시각: 지금 답변과 답변 수정 이력(그때 회원이 보던 글·보이기 시작한 시각)을 함께 본다.
  SELECT min(x.at) INTO v_account_at
    FROM (SELECT t.responded_at AS at
            FROM public.support_tickets t
           WHERE t.user_id = p_user_id
             AND t.responded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0)
          UNION ALL
          SELECT ar.previous_shown_at
            FROM public.support_ticket_answer_revisions ar
            JOIN public.support_tickets t ON t.id = ar.ticket_id
           WHERE t.user_id = p_user_id
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(ar.previous_response, k) > 0)) x;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at)) -- [13번] (다) 답변 수정 시각
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at, t.response_edited_at), '-infinity'::timestamptz)) AS reviewed -- [13번] 수정 시각
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      -- [13번] (나) 답변 수정 이력: 부모 문의의 환불 관련·계좌 요청 뒤, 이전 답변·수정 사유의 긴 숫자
      UNION ALL
      SELECT 'support_ticket_answer_revision', ar.id, ar.created_at,
             left(regexp_replace(COALESCE(tk.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(ar.previous_response) OR public.member_text_has_long_number(ar.reason) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_answer_revisions ar
        JOIN tk ON tk.id = ar.ticket_id
       WHERE ar.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note)
              OR public.member_text_has_long_number(rr.member_reject_reason)) -- [16번] 회원에게 보낸 거절 사유
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;
-- 4-7-2. redact_member_text: refund_request 허용 칸에 member_reject_reason.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind = 'support_ticket_answer_revision' AND p_field IN ('previous_response', 'reason')) -- [13번]
             OR (p_target_kind = 'refund_request' AND p_field IN ('reason', 'admin_note', 'member_reject_reason')) -- [16번] 회원에게 보낸 거절 사유
             OR (p_target_kind = 'market_refund_request' AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  -- [13번] 답변 수정 이력: 관리자 이벤트 가림은 수정 이력처럼 부모 문의 기준
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id
     WHERE ar.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_answer_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;
-- 4-8. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.member_broadcast_recipients(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_broadcast_preview(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_member_notification_texts(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retract_member_broadcast(uuid, uuid, text, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_broadcast_recipients(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_broadcast_preview(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_member_notification_texts(uuid, integer, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.retract_member_broadcast(uuid, uuid, text, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean, text) TO service_role;

-- 5. VERIFY(5-5) — 새 물건·설정 행·함수 ---------------------------------------------------------------------------------
DO $verify_bundle16_member_notifications$
DECLARE
  v_rel text := 'public.member_notification_broadcasts';
  v_fn text;
  v_value jsonb;
  v_support jsonb;
  v_functions text[] := ARRAY[
    'public.member_broadcast_recipients(text,uuid)',
    'public.member_broadcast_preview(uuid,text)',
    'public.save_member_notification_texts(uuid,integer,jsonb,jsonb)',
    'public.send_member_broadcast(uuid,uuid,text,text,text,text,uuid,integer,integer,jsonb)',
    'public.retract_member_broadcast(uuid,uuid,text,boolean,jsonb)',
    'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'];
BEGIN
  -- 기록 표: RLS·정책 0·권한 = service_role SELECT 만
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = to_regclass(v_rel)) <> 0
     OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass(v_rel) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'VERIFY: member_notification_broadcasts table / RLS / privileges';
  END IF;
  -- 칸(회원을 가리키는 칸 없음)·가드 트리거 2개·post_id FK(site_board_posts)
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = to_regclass(v_rel) AND a.attnum > 0 AND NOT a.attisdropped)
       <> ARRAY['actor_id', 'content_sha256', 'created_at', 'id', 'link_url', 'message', 'not_advertising_statement_text',
                'not_advertising_statement_version', 'operation_key', 'post_id', 'recipient_count', 'redacted_at', 'redacted_by',
                'retract_reason_code', 'retracted_at', 'retracted_by', 'retracted_deleted_count', 'retracted_read_count', 'target', 'title']
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
           AND t.tgname IN ('guard_member_notification_broadcasts_mutation', 'guard_member_notification_broadcasts_truncate')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(v_rel) AND c.conname = 'member_notification_broadcasts_post_id_fkey'
                     AND c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass) THEN
    RAISE EXCEPTION 'VERIFY: member_notification_broadcasts columns / guard / post_id FK';
  END IF;
  -- 다시 적용(표가 남아 있음)도 같은 표인지: 칸 형식·NOT NULL·기본값과 제약 정의(이름·종류·정의)의 지문(리허설 light 측정값)
  IF (SELECT md5(string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''),
                            ',' ORDER BY a.attname))
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = to_regclass(v_rel) AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM '985ff2dca6ab17691f3f8e89053a1606'
     OR (SELECT md5(string_agg(c.conname::text || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid), ',' ORDER BY c.conname))
           FROM pg_constraint c WHERE c.conrelid = to_regclass(v_rel) AND c.contype <> 'f') IS DISTINCT FROM 'c5cb1756014c1e41811acb07642ffc7d' THEN
    RAISE EXCEPTION 'VERIFY: member_notification_broadcasts shape differs (columns %, constraints %)',
      (SELECT md5(string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''),
                             ',' ORDER BY a.attname))
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass(v_rel) AND a.attnum > 0 AND NOT a.attisdropped),
      (SELECT md5(string_agg(c.conname::text || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid), ',' ORDER BY c.conname))
         FROM pg_constraint c WHERE c.conrelid = to_regclass(v_rel) AND c.contype <> 'f');
  END IF;
  -- 함수 5개 + 새 거절 서명: search_path·EXECUTE 는 service_role 만. 받는 사람만 INVOKER, 나머지는 DEFINER.
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM (v_fn <> 'public.member_broadcast_recipients(text,uuid)')
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % security / search_path / EXECUTE', v_fn;
    END IF;
  END LOOP;
  -- 새 거절 서명: DEFAULT 없음, 옛 4인자는 그대로(배포 뒤 정리 스크립트가 지운다)
  IF (SELECT p.pronargdefaults FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'::regprocedure) <> 0
     OR md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) <> '20384719deba112e977fbd3bf8e266e5' THEN
    RAISE EXCEPTION 'VERIFY: reject_point_charge_refund signatures';
  END IF;
  -- 내부 검사 함수·가드 함수는 아무도 EXECUTE 못 함
  FOREACH v_fn IN ARRAY ARRAY['public.member_notification_texts_problem(jsonb)', 'public.guard_member_notification_broadcasts_mutation()'] LOOP
    IF to_regprocedure(v_fn) IS NULL OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % privileges', v_fn;
    END IF;
  END LOOP;
  -- 재정의한 두 함수: 16번 본문, 보안 방식·proacl 이 적용 전과 같음
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM 'b2db6cf4ca0c8226b17c62a3ee113e88'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM 'acf0b18ba4c87a11d96dc742565cbe71'
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS NOT FALSE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}'
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_facts / redact_member_text body / security / privileges';
  END IF;
  -- 설정 행: 구조(종류 키 집합 = 코드 규칙), 개인정보 없음, 답변 두 종류 = support_page_content(키가 있을 때)
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'member_notification_texts';
  SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content';
  IF public.member_notification_texts_problem(v_value) IS NOT NULL
     OR EXISTS (SELECT 1 FROM jsonb_path_query(v_value, '$.** ? (@.type() == "string")') s
                 WHERE cardinality(public.member_facing_text_pii_hits(s #>> '{}')) > 0)
     OR (v_support #> '{member,answerCreatedNotificationTitle}' IS NOT NULL
         AND v_support #> '{member,answerCreatedNotificationTitle}' IS DISTINCT FROM v_value #> '{kinds,supportAnswerCreated,title}')
     OR (v_support #> '{admin,notifyOnAnswerEdit}' IS NOT NULL
         AND v_support #> '{admin,notifyOnAnswerEdit}' IS DISTINCT FROM v_value #> '{kinds,supportAnswerEdited,enabled}') THEN
    RAISE EXCEPTION 'VERIFY: member_notification_texts values';
  END IF;
END;
$verify_bundle16_member_notifications$;

-- 6. [16번 기존 표 DDL] 시작 — 짧은 ACCESS EXCLUSIVE(새벽, lock_timeout 3초). 리허설 light 사본은 이 구역과 아래 VERIFY 블록을 뺀다. ------------
-- 6-0. 잠금 순서를 처음에 한 번에 정한다: system_settings(앞의 설정 행 INSERT 로 이미 ROW EXCLUSIVE) → 결제 표 → 알림 표.
--      정책 만들기가 마지막에 system_settings 잠금을 올리면, system_settings 를 읽은 채 refund_requests 를 기다리는 거래(환불 요청·결제 RPC)와
--      교착이 생겨 그쪽이 취소될 수 있다.
LOCK TABLE public.system_settings, public.refund_requests, public.payment_admin_actions, public.notifications IN ACCESS EXCLUSIVE MODE;
-- 6-1. 충전 환불 거절 사유 칸(5-8): 표 CHECK 는 '비지 않음'만(1~300자는 함수 검사 — 가림 문구로 바꿀 때 길이 CHECK 에 걸리지 않게).
--      다시 적용이면(down 이 남긴 칸) 만들기를 건너뛰고 정의를 대조한다.
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS member_reject_reason text;
DO $refund_reason_check_bundle16$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.refund_requests'::regclass
                  AND c.conname = 'refund_requests_member_reject_reason_check') THEN
    ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_member_reject_reason_check
      CHECK (member_reject_reason IS NULL OR btrim(member_reject_reason) <> '');
  END IF;
END;
$refund_reason_check_bundle16$;
COMMENT ON COLUMN public.refund_requests.member_reject_reason IS
  '16번: 회원에게 보낸 충전 환불 거절 사유(환불정책 3-2 ⑦ 증빙, 탈퇴 뒤에도 환불 처리 내역과 함께 남음). 내부 메모는 admin_note.';
-- 6-2. 처리 기록 action CHECK: 기존 7개 + refund_rejected(보통 거절). DROP/ADD 를 다시 해도 같은 결과다.
ALTER TABLE public.payment_admin_actions DROP CONSTRAINT payment_admin_actions_action_check;
ALTER TABLE public.payment_admin_actions ADD CONSTRAINT payment_admin_actions_action_check
  CHECK (action = ANY (ARRAY['paid_confirmed'::text, 'unpaid_confirmed'::text, 'cancel_handled'::text, 'manual_refund_completed'::text,
                             'manual_review_refund_rejected'::text, 'alert_resolved'::text, 'withdrawn_held_order_closed'::text,
                             'refund_rejected'::text]));
-- 6-3. 회원 알림에 공지 알림 기록 id(회수가 지울 행을 찾는다). authenticated 는 이 칸을 UPDATE 하지 못한다(칸 권한은 is_read 만).
ALTER TABLE public.notifications ADD COLUMN broadcast_id uuid NULL REFERENCES public.member_notification_broadcasts(id);
CREATE INDEX notifications_broadcast_id ON public.notifications (broadcast_id) WHERE broadcast_id IS NOT NULL;
-- 6-4. 설정 행 쓰기 막기(5-2): RESTRICTIVE 정책이 대표 세션의 직접 UPDATE 를 막는다(저장은 DB 함수만). down 이 남기므로 없을 때만 만든다.
DO $policy_bundle16_member_notification_texts$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_notification_texts_no_client_write') THEN
    CREATE POLICY system_settings_member_notification_texts_no_client_write ON public.system_settings
      AS RESTRICTIVE FOR UPDATE
      USING (key <> 'member_notification_texts')
      WITH CHECK (key <> 'member_notification_texts');
  END IF;
END;
$policy_bundle16_member_notification_texts$;
-- [16번 기존 표 DDL] 끝 -------------------------------------------------------------------------------------------

DO $verify_bundle16_existing_tables$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests'
                  AND column_name = 'member_reject_reason' AND data_type = 'text' AND is_nullable = 'YES')
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.refund_requests'::regclass
           AND c.conname = 'refund_requests_member_reject_reason_check')
        IS DISTINCT FROM 'CHECK (((member_reject_reason IS NULL) OR (btrim(member_reject_reason) <> ''''::text)))' THEN
    RAISE EXCEPTION 'VERIFY: refund_requests.member_reject_reason column / check';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.payment_admin_actions'::regclass
        AND c.conname = 'payment_admin_actions_action_check') NOT LIKE '%''refund_rejected''::text%'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.payment_admin_actions'::regclass
        AND c.conname = 'payment_admin_actions_action_check') NOT LIKE '%''manual_review_refund_rejected''::text%' THEN
    RAISE EXCEPTION 'VERIFY: payment_admin_actions action check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.notifications'::regclass AND c.contype = 'f'
                  AND c.confrelid = 'public.member_notification_broadcasts'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications' AND indexname = 'notifications_broadcast_id'
                     AND indexdef LIKE '%WHERE (broadcast_id IS NOT NULL)%')
     OR has_column_privilege('authenticated', 'public.notifications', 'broadcast_id', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: notifications.broadcast_id FK / index / privileges';
  END IF;
END;
$verify_bundle16_existing_tables$;

-- 쓰기 막기 정책 존재 검사는 이름 붙인 별도 블록(15번 방식, 리허설 light 사본은 뺀다)
DO $verify_bundle16_settings_policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_notification_texts_no_client_write' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
                  AND qual = '(key <> ''member_notification_texts''::text)' AND with_check = '(key <> ''member_notification_texts''::text)') THEN
    RAISE EXCEPTION 'VERIFY: system_settings_member_notification_texts_no_client_write policy';
  END IF;
END;
$verify_bundle16_settings_policy$;

NOTIFY pgrst, 'reload schema';
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_cleanup', $rh_src_cleanup$-- 16번 묶음 5-6: 13번 답변 알림 키 정리 + 옛 4인자 충전 환불 거절 함수 삭제(계획 docs/plan-bundle16-notification-copy.md 5-6, 13절 6단계).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤).
-- 언제: 16번 코드가 배포되고, 답변 알림이 새 행(member_notification_texts)에서 읽히는 것을 확인한 뒤(10-2 운영 확인).
--   DB 적용~배포 사이에는 대표에게 '고객지원 안내 문구의 답변 알림 칸을 고치지 말 것'을 알린다.
-- 키마다(5-2 대응표):
--   이미 없음 → 정리된 것으로 보고 넘어감 / member_notification_texts 값과 같음 → 지움 / 다름 → 멈추고 대표가 어느 글을 쓸지 정한다.
--   지운 것이 있으면 revision + 1, 작업 기록 support_page_content_update(details.bundle = 'bundle16_support_keys_cleanup').
-- 옛 4인자 reject_point_charge_refund(uuid,uuid,text,boolean): 새 코드는 5인자만 부른다. 지우기 전에 5인자의 권한이 postgres·service_role 뿐인지 본다.
--   되돌릴 때는 되살리기 스크립트(20261218_bundle16_support_notification_keys_restore.sql)가 다시 만든다.
-- 기록자: 대표(owner) 계정 중 가장 최근에 로그인한 계정(10번·15번 스크립트와 같음).
-- 잠금: support_page_content 행 잠금(몇 밀리초)과 함수 삭제뿐이다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle16_support_keys_cleanup$
DECLARE
  -- support_page_content 경로 ↔ member_notification_texts 경로(5-2 대응표)
  c_pairs constant text[][] := ARRAY[
    ARRAY['{member,answerCreatedNotificationTitle}', '{kinds,supportAnswerCreated,title}'],
    ARRAY['{member,answerCreatedNotificationMessage}', '{kinds,supportAnswerCreated,message}'],
    ARRAY['{member,answerEditedNotificationTitle}', '{kinds,supportAnswerEdited,title}'],
    ARRAY['{member,answerEditedNotificationMessage}', '{kinds,supportAnswerEdited,message}'],
    ARRAY['{admin,notifyOnAnswerEdit}', '{kinds,supportAnswerEdited,enabled}']];
  v_actor uuid;
  v_texts jsonb;
  v_support jsonb;
  v_new jsonb;
  v_pair text[];
  v_removed text[] := ARRAY[]::text[];
  v_revision integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_actor := (SELECT v::uuid FROM _rh_ctx WHERE k = 'owner');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: signed-in owner account not found';
  END IF;
  SELECT value INTO v_texts FROM public.system_settings WHERE key = 'member_notification_texts';
  IF v_texts IS NULL THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: member_notification_texts missing (bundle 16 migration not applied)';
  END IF;
  SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content' FOR UPDATE;
  IF v_support IS NULL THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: support_page_content missing';
  END IF;

  v_new := v_support;
  FOREACH v_pair SLICE 1 IN ARRAY c_pairs LOOP
    IF v_support #> v_pair[1]::text[] IS NULL THEN
      CONTINUE;
    END IF;
    IF v_support #> v_pair[1]::text[] IS DISTINCT FROM v_texts #> v_pair[2]::text[] THEN
      RAISE EXCEPTION 'KEYS_CLEANUP: support_page_content % differs from member_notification_texts % — owner decides which text to keep', v_pair[1], v_pair[2];
    END IF;
    v_new := v_new #- v_pair[1]::text[];
    v_removed := v_removed || v_pair[1];
  END LOOP;

  IF cardinality(v_removed) > 0 THEN
    v_revision := (v_support ->> 'revision')::integer;
    v_new := jsonb_set(v_new, '{revision}', to_jsonb(v_revision + 1));
    UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'support_page_content';
    PERFORM public.record_admin_audit(v_actor, 'support_page_content_update', 'system_settings', 'support_page_content', NULL, NULL, NULL,
      jsonb_build_object('bundle', 'bundle16_support_keys_cleanup', 'removed', to_jsonb(v_removed),
        'revision_before', v_revision, 'revision_after', v_revision + 1, 'saved_at', v_now),
      NULL);
  END IF;

  -- 옛 4인자 거절 함수: 새 5인자의 권한을 먼저 본다
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)') IS NULL
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'))
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: 5-arg reject_point_charge_refund missing or privileges differ';
  END IF;
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NOT NULL THEN
    DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean);
  END IF;

  RAISE NOTICE 'KEYS_CLEANUP: removed % key(s), old 4-arg reject function dropped', cardinality(v_removed);
END;
$bundle16_support_keys_cleanup$;

-- [확인] 남은 키(0이어야 함)와 거절 함수 서명(5인자 하나)
SELECT (SELECT count(*) FROM public.system_settings s,
          unnest(ARRAY['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
                       'answerEditedNotificationMessage']) k
         WHERE s.key = 'support_page_content' AND s.value -> 'member' ? k)
       + (SELECT count(*) FROM public.system_settings s WHERE s.key = 'support_page_content' AND s.value -> 'admin' ? 'notifyOnAnswerEdit') AS keys_left,
       (SELECT array_agg(p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund') AS reject_signatures;
$rh_src_cleanup$);
SELECT pg_temp.ctx_set('src_restore', $rh_src_restore$-- 16번 묶음 5-5 되돌리기 1단계: 13번 답변 알림 키 되살리기 + 옛 4인자 충전 환불 거절 함수 다시 만들기(계획 docs/plan-bundle16-notification-copy.md 5-5).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤).
-- 언제: 16번 코드를 되돌리기 **전에**(되돌린 13번 코드가 옛 키와 옛 4인자 함수를 다시 쓴다). 그다음 코드 되돌리기 → down 순서.
--   이 스크립트부터 코드 되돌리기까지는 대표에게 '13번 안내 문구 탭 저장 금지'를 알린다(16번 코드의 탭은 5개 키 없이 저장한다).
-- 키마다(5-2 대응표): 없음 → member_notification_texts 값으로 넣음 / 있음·같음 → 그대로 / 있음·다름 → 그대로 두고 기록에 남기며 알린다
--   (되돌리면 그 옛 값이 쓰인다 — 대표가 확인). 넣은 것이 있으면 revision + 1. 넣었거나 다른 것이 있으면 작업 기록
--   support_page_content_update(details.bundle = 'bundle16_support_keys_restore'). 키를 더해도 16번 코드에는 영향이 없다.
-- 옛 4인자 reject_point_charge_refund(uuid,uuid,text,boolean): 없으면(정리 스크립트 뒤) 적용 전 정의 그대로 다시 만들고
--   PUBLIC·anon·authenticated 를 회수, service_role 에 EXECUTE(새 함수 기본 권한이 anon 에게 열려 있어서). 끝에서 지문·권한을 본다.
-- 기록자: 대표(owner) 계정 중 가장 최근에 로그인한 계정.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle16_support_keys_restore$
DECLARE
  c_pairs constant text[][] := ARRAY[
    ARRAY['{member,answerCreatedNotificationTitle}', '{kinds,supportAnswerCreated,title}'],
    ARRAY['{member,answerCreatedNotificationMessage}', '{kinds,supportAnswerCreated,message}'],
    ARRAY['{member,answerEditedNotificationTitle}', '{kinds,supportAnswerEdited,title}'],
    ARRAY['{member,answerEditedNotificationMessage}', '{kinds,supportAnswerEdited,message}'],
    ARRAY['{admin,notifyOnAnswerEdit}', '{kinds,supportAnswerEdited,enabled}']];
  -- 적용 전 운영 정의(2026-11-26 pg_get_functiondef 읽기 전용, md5 20384719deba112e977fbd3bf8e266e5)
  c_old_reject constant text := $old_reject$CREATE OR REPLACE FUNCTION public.reject_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_provider_not_cancelled_confirmed boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_request.status NOT IN ('pending_review', 'manual_review') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;
  END IF;

  -- 결제사에서 취소된 흔적이 있으면 거절해서 크레딧 동결을 풀면 안 된다.
  IF v_request.origin <> 'user'
     OR v_order.canceled_at IS NOT NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR (v_order.provider = 'kakaopay' AND v_ppt.provider_status = 'CANCEL_PAYMENT')
     OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  IF v_request.status = 'manual_review'
     AND (p_provider_not_cancelled_confirmed IS NOT TRUE
          OR p_admin_id IS NULL
          OR NULLIF(BTRIM(p_admin_note), '') IS NULL) THEN
    RAISE EXCEPTION 'REFUND_REJECT_CONFIRMATION_REQUIRED';
  END IF;

  UPDATE public.credit_sources
     SET status = 'active'
   WHERE id = v_request.source_id
     AND status = 'pending_refund';

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = p_admin_note,
         processed_by = p_admin_id,
         processed_at = now()
   WHERE id = v_request.id;

  IF v_request.status = 'manual_review' THEN
    INSERT INTO public.payment_admin_actions (
      actor_id,
      action,
      payment_order_id,
      refund_request_id,
      before_state,
      after_state,
      note,
      details
    ) VALUES (
      p_admin_id,
      'manual_review_refund_rejected',
      v_order.id,
      v_request.id,
      jsonb_build_object('request_status', v_request.status, 'source_status', v_source.status),
      jsonb_build_object('request_status', 'rejected', 'source_status', 'active'),
      p_admin_note,
      jsonb_build_object('provider_not_cancelled_confirmed', true, 'last_error_code', v_request.last_error_code)
    );
  END IF;
END;
$function$
$old_reject$;
  v_actor uuid;
  v_texts jsonb;
  v_support jsonb;
  v_new jsonb;
  v_pair text[];
  v_added text[] := ARRAY[]::text[];
  v_differs text[] := ARRAY[]::text[];
  v_revision integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_actor := (SELECT v::uuid FROM _rh_ctx WHERE k = 'owner');
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'KEYS_RESTORE: signed-in owner account not found';
  END IF;
  SELECT value INTO v_texts FROM public.system_settings WHERE key = 'member_notification_texts';
  IF v_texts IS NULL THEN
    RAISE EXCEPTION 'KEYS_RESTORE: member_notification_texts missing';
  END IF;
  SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content' FOR UPDATE;
  IF v_support IS NULL OR jsonb_typeof(v_support -> 'member') IS DISTINCT FROM 'object' OR jsonb_typeof(v_support -> 'admin') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'KEYS_RESTORE: support_page_content missing';
  END IF;

  v_new := v_support;
  FOREACH v_pair SLICE 1 IN ARRAY c_pairs LOOP
    IF v_texts #> v_pair[2]::text[] IS NULL THEN
      RAISE EXCEPTION 'KEYS_RESTORE: member_notification_texts % missing', v_pair[2];
    END IF;
    IF v_support #> v_pair[1]::text[] IS NULL THEN
      v_new := jsonb_set(v_new, v_pair[1]::text[], v_texts #> v_pair[2]::text[], true);
      v_added := v_added || v_pair[1];
    ELSIF v_support #> v_pair[1]::text[] IS DISTINCT FROM v_texts #> v_pair[2]::text[] THEN
      v_differs := v_differs || v_pair[1];
      RAISE NOTICE 'KEYS_RESTORE: support_page_content % differs from member_notification_texts % — the old value will be used after code rollback; tell the owner',
        v_pair[1], v_pair[2];
    END IF;
  END LOOP;

  v_revision := (v_support ->> 'revision')::integer;
  IF cardinality(v_added) > 0 THEN
    v_new := jsonb_set(v_new, '{revision}', to_jsonb(v_revision + 1));
    UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'support_page_content';
  END IF;
  IF cardinality(v_added) > 0 OR cardinality(v_differs) > 0 THEN
    PERFORM public.record_admin_audit(v_actor, 'support_page_content_update', 'system_settings', 'support_page_content', NULL, NULL, NULL,
      jsonb_build_object('bundle', 'bundle16_support_keys_restore', 'added', to_jsonb(v_added), 'differs', to_jsonb(v_differs),
        'revision_before', v_revision, 'revision_after', v_revision + CASE WHEN cardinality(v_added) > 0 THEN 1 ELSE 0 END, 'saved_at', v_now),
      NULL);
  END IF;

  -- 옛 4인자 거절 함수
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL THEN
    EXECUTE c_old_reject;
    REVOKE EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean) TO service_role;
  END IF;
  IF md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) <> '20384719deba112e977fbd3bf8e266e5'
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'KEYS_RESTORE: old 4-arg reject_point_charge_refund definition or privileges differ';
  END IF;

  RAISE NOTICE 'KEYS_RESTORE: added % key(s), % differ(s)', cardinality(v_added), cardinality(v_differs);
END;
$bundle16_support_keys_restore$;

NOTIFY pgrst, 'reload schema';
$rh_src_restore$);
SELECT pg_temp.ctx_set('src_b13_m0', $rh_src_b13_m0$-- 출시 전 작업 순서표 13번 묶음 M0: 관리자 회원 연락처 열람 기록(계획 docs/plan-bundle13-cs-tools.md 3판, 4-1·8절).
-- 만드는 것:
--   1. 표 admin_member_access_log(추가 전용): 누가·언제·어느 회원(uuid 만, FK 없음 — 회원을 완전 삭제해도 기록이 남음)·어느 화면·무슨 항목·
--      화면 정보(context, 검색어 원문은 넣지 않음)·사유·IP·기기. RLS 켬·정책 0, anon·authenticated 권한 없음, service_role 은 SELECT 만.
--   2. 가드 트리거: UPDATE·DELETE·TRUNCATE 를 거부한다(service_role 도). DB 소유자(postgres) 권한으로는 바꿀 수 있다(8-4 한계).
--   3. 기록 함수 record_admin_member_access(service_role 만): 행위자가 관리자인지 profiles 에서 보고, 개수·글자 수를 검사하고,
--      시각과 actor_role 을 함수가 정한다.
-- 01-11 시행 처리방침(10번 스크립트 apply)이 이 표·함수가 있는지 본다 — 2027-01-10 까지 운영에 있어야 한다(15절).
-- 잠금: 새 표만 만든다(기존 표 잠금 없음). profiles 는 함수 안에서 읽기만 한다.
-- 되돌리기 파일이 없다(법정 보관 기록, 4-1). M1·M2·M3 를 되돌리고 다시 적용해도 이 표에 걸리지 않는다(리허설 경우 F).
--   적용 직후 행이 0건일 때만(그 밖에는 쓰지 않는다) 아래를 한 거래에서 손으로 돌린다:
--     -- SELECT count(*) FROM public.admin_member_access_log;  -- 0 이어야 한다
--     -- DROP FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb);
--     -- DROP TABLE public.admin_member_access_log;
--     -- DROP FUNCTION public.guard_admin_member_access_log_mutation();
-- 버전: 20261217100000~130000 은 운영 마지막 적용 11번(20261216100000)·12번(20261214100000) 뒤다(적용 순서 = 파일 시각 순서). 적용 직전에 schema_migrations 최신 버전을 다시 보고 그보다 뒤가 아니면 같은 순서로 다시 정한다. 파일 단위로 적용하고 이력은 같은 거래의 schema_migrations INSERT 로 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 -----------------------------------------------------------------------------------------------------
DO $precheck_bundle13_access_log$
BEGIN
  IF to_regclass('public.admin_member_access_log') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: admin_member_access_log already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('record_admin_member_access', 'guard_admin_member_access_log_mutation')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 access log functions already exist';
  END IF;
  -- 12번이 먼저 적용돼 있어야 한다(16절 순서)
  IF to_regclass('public.member_suspensions') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 12 (20261214100000) is not applied';
  END IF;
END;
$precheck_bundle13_access_log$;

-- [13번 M0] 시작 ------------------------------------------------------------------------------------------------
-- 1. 표(4-1) ----------------------------------------------------------------------------------------------------
CREATE TABLE public.admin_member_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  actor_role text,
  screen text NOT NULL CHECK (char_length(screen) BETWEEN 1 AND 60),
  member_ids uuid[] NOT NULL CHECK (cardinality(member_ids) BETWEEN 1 AND 200 AND array_position(member_ids, NULL) IS NULL),
  fields text[] NOT NULL CHECK (cardinality(fields) BETWEEN 1 AND 10 AND array_position(fields, NULL) IS NULL),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  ip text CHECK (ip IS NULL OR char_length(ip) <= 100),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300)
);
CREATE INDEX admin_member_access_log_created ON public.admin_member_access_log (created_at DESC);
CREATE INDEX admin_member_access_log_actor_created ON public.admin_member_access_log (actor_id, created_at DESC);
CREATE INDEX admin_member_access_log_member_ids ON public.admin_member_access_log USING gin (member_ids);

COMMENT ON TABLE public.admin_member_access_log IS
  '13번: 관리자 회원 연락처 열람 기록(추가 전용, 보관 2년 — support_page_content.admin.accessLogRetentionYears). 쓰기는 record_admin_member_access 만.';

ALTER TABLE public.admin_member_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_member_access_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_member_access_log TO service_role;

-- 2. 가드 트리거(추가 전용) --------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_admin_member_access_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_admin_member_access_log_mutation$
BEGIN
  RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY';
END;
$fn_guard_admin_member_access_log_mutation$;

CREATE TRIGGER guard_admin_member_access_log_mutation
  BEFORE UPDATE OR DELETE ON public.admin_member_access_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_member_access_log_mutation();
CREATE TRIGGER guard_admin_member_access_log_truncate
  BEFORE TRUNCATE ON public.admin_member_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_admin_member_access_log_mutation();

-- 3. 기록 함수(8-1) -------------------------------------------------------------------------------------------------
--    화면 키·항목 이름은 코드 목록(src/lib/admin-member-access-log.ts)이고, 여기서는 형식만 본다(작업 기록 action 과 같은 방식).
--    p_request_meta 는 {ip, user_agent}(adminRequestMeta). 회원 수 1~200·중복 없음, 사유 200자, context 2000자.
CREATE FUNCTION public.record_admin_member_access(p_actor_id uuid, p_screen text, p_member_ids uuid[], p_fields text[],
  p_context jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_admin_member_access$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_screen IS NULL OR p_screen !~ '^[a-z][a-z0-9_.]{0,59}$'
     OR p_member_ids IS NULL OR cardinality(p_member_ids) NOT BETWEEN 1 AND 200 OR array_position(p_member_ids, NULL) IS NOT NULL
     OR cardinality(p_member_ids) <> (SELECT count(DISTINCT m) FROM unnest(p_member_ids) AS m)
     OR p_fields IS NULL OR cardinality(p_fields) NOT BETWEEN 1 AND 10
     OR EXISTS (SELECT 1 FROM unnest(p_fields) AS f WHERE f IS NULL OR f !~ '^[a-z][a-z0-9_]{0,39}$')
     OR (p_context IS NOT NULL AND (jsonb_typeof(p_context) <> 'object' OR length(p_context::text) > 2000))
     OR char_length(COALESCE(v_reason, '')) > 200
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_INPUT_INVALID';
  END IF;
  SELECT p.admin_role INTO v_role
    FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role IN ('owner', 'staff');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_ACTOR_INVALID';
  END IF;
  INSERT INTO public.admin_member_access_log (created_at, actor_id, actor_role, screen, member_ids, fields, context, reason, ip, user_agent)
  VALUES (clock_timestamp(), p_actor_id, v_role, p_screen, p_member_ids, p_fields, COALESCE(p_context, '{}'::jsonb), v_reason,
          left(NULLIF(btrim(p_request_meta ->> 'ip'), ''), 100), left(NULLIF(p_request_meta ->> 'user_agent', ''), 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn_record_admin_member_access$;

REVOKE ALL ON FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.guard_admin_member_access_log_mutation() FROM PUBLIC, anon, authenticated, service_role;
-- [13번 M0] 끝 ------------------------------------------------------------------------------------------------

-- 4. VERIFY --------------------------------------------------------------------------------------------------------
DO $verify_bundle13_access_log$
DECLARE
  v_rel constant text := 'public.admin_member_access_log';
  v_fn constant text := 'public.record_admin_member_access(uuid,text,uuid[],text[],jsonb,text,jsonb)';
BEGIN
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel)) THEN
    RAISE EXCEPTION 'VERIFY: access log table / RLS / no policies';
  END IF;
  IF NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('anon', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
     OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE') THEN
    RAISE EXCEPTION 'VERIFY: access log privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_admin_member_access_log_mutation', 'guard_admin_member_access_log_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: access log guard triggers';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'admin_member_access_log'
       AND indexname IN ('admin_member_access_log_created', 'admin_member_access_log_actor_created', 'admin_member_access_log_member_ids')) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: access log indexes';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'VERIFY: record_admin_member_access EXECUTE / SECURITY DEFINER';
  END IF;
  IF has_function_privilege('service_role', 'public.guard_admin_member_access_log_mutation()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_admin_member_access_log_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: guard function must not be executable by API roles';
  END IF;
END;
$verify_bundle13_access_log$;

NOTIFY pgrst, 'reload schema';
$rh_src_b13_m0$);
SELECT pg_temp.ctx_set('src_b13_m1', $rh_src_b13_m1$-- 출시 전 작업 순서표 13번 묶음 M1: CS 도구 추가분(계획 docs/plan-bundle13-cs-tools.md 3판, 4-2~4-4).
-- 만드는 것:
--   1. support_tickets.response_edited_at(기본값 없는 칸 — 짧은 ACCESS EXCLUSIVE).
--   2. 표 support_ticket_answer_revisions(답변 이력, 추가 전용): 그때 회원이 보던 글·보이기 시작한 시각·고친 사람·사유. RLS 켬·정책 0,
--      service_role 은 SELECT 만(쓰기는 save_support_ticket_answer 만). 가드: UPDATE·DELETE·TRUNCATE 거부 — 부모 문의 연쇄 삭제와
--      가림 함수(app.member_withdrawal_bypass = 그 회원 id)의 previous_response·reason·redaction_reviewed_at UPDATE 만 예외.
--   3. 표 support_reply_templates(답변 템플릿): RLS SELECT 정책 has_admin_permission('support.manage'), 쓰기 정책 없음(서버 키만).
--      비어 있을 때만 런북 12절 14개를 넣는다(10-2).
--   4. 설정 행 system_settings.support_page_content(회원 화면 문구 10-1·관리자 값, revision 1 — 있으면 그대로).
--   5. slug 지키기 트리거 guard_support_category_slug(문의가 있거나 탈퇴 가림 정책 slug 이면 slug 변경 거부).
--   6. 답변 저장 함수 save_support_ticket_answer(service_role 만, 4-3).
--   7. 10번 함수 재정의 4개(4-4): member_withdrawal_facts·redact_member_text·mark_member_text_reviewed·read_withdrawn_member_ticket.
--      운영 원문(pg_get_functiondef)에서 바뀐 곳만 '-- [13번]' 표시로 고쳤다. anonymize_member 는 고치지 않고 지문만 본다.
-- 작업 기록(admin_audit_log)에는 답변 글·수정 사유 원문을 넣지 않는다(가릴 수 없는 표) — 글자 수와 이력 id 만.
-- 함수 지문은 md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 1-3). 다르면 멈춘다.
-- 잠금: support_tickets 에 칸 추가(ACCESS EXCLUSIVE)·FK(SHARE ROW EXCLUSIVE), support_ticket_categories 에 FK·트리거(SHARE ROW EXCLUSIVE).
--   새벽 짧은 창에서 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 옛 코드와 함께 돌아간다(추가만 함 — 옛 답변 route 의 세션 UPDATE 도 M2 전까지 허용).
-- 되돌리기: supabase/rollback/20261217110000_bundle13_cs_tools_down.sql(M3·M2 를 먼저 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(4-2) -----------------------------------------------------------------------------------------------
DO $precheck_bundle13_cs_tools$
DECLARE
  -- 재정의할 4개(10번 원문)와 그대로여야 하는 anonymize_member
  v_same text[][] := ARRAY[
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.redact_member_text(uuid,text,uuid,text,text,text)', '90778a74269a727608f028b21b43b8f6'],
    ARRAY['public.mark_member_text_reviewed(uuid,text,uuid)', 'b626dc43a8bb8402575f99a58bb5969b'],
    ARRAY['public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)', 'cce39fd0ab514d2c9cdd9e42d225688e'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.guard_withdrawn_member_write()', '764d47be26a0254ba61c71bbd005ee9b']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1],
        CASE WHEN to_regprocedure(v_same[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) END;
    END IF;
  END LOOP;
  IF to_regclass('public.support_ticket_answer_revisions') IS NOT NULL OR to_regclass('public.support_reply_templates') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('save_support_ticket_answer', 'guard_support_ticket_answer_revisions_mutation', 'guard_support_category_slug')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'response_edited_at') THEN
    RAISE EXCEPTION 'PRECHECK: support_tickets.response_edited_at already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content') THEN
    RAISE EXCEPTION 'PRECHECK: support_page_content row already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'PRECHECK: support_ticket_categories triggers changed';
  END IF;
  IF to_regclass('public.admin_member_access_log') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: M0 (20261217100000) is not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_policy missing';
  END IF;
END;
$precheck_bundle13_cs_tools$;

-- [13번 M1] 시작 ------------------------------------------------------------------------------------------------
-- 1. 답변 수정 시각 칸(4-2 의 1) --------------------------------------------------------------------------------------
ALTER TABLE public.support_tickets ADD COLUMN response_edited_at timestamptz;

-- 2. 답변 이력(4-2 의 2) -------------------------------------------------------------------------------------------
--    edited_by 는 FK 없는 uuid(관리자 계정을 지워도 이력이 남음).
CREATE TABLE public.support_ticket_answer_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  previous_response text NOT NULL,
  previous_shown_at timestamptz NOT NULL,
  edited_by uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redaction_reviewed_at timestamptz
);
CREATE INDEX support_ticket_answer_revisions_ticket ON public.support_ticket_answer_revisions (ticket_id, created_at);

COMMENT ON TABLE public.support_ticket_answer_revisions IS
  '13번: 문의 답변 수정 이력(그때 회원이 보던 글). 쓰기는 save_support_ticket_answer 만, 탈퇴 가림 대상(support_ticket_answer_revision).';

ALTER TABLE public.support_ticket_answer_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_ticket_answer_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_ticket_answer_revisions TO service_role;

--    DELETE: 부모 문의가 이미 없으면(연쇄 삭제) 통과. UPDATE: 가림 함수 거래(bypass = 부모 문의의 회원)에서 가릴 칸만.
CREATE FUNCTION public.guard_support_ticket_answer_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_ticket_answer_revisions_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND current_setting('app.member_withdrawal_bypass', true)
         = (SELECT t.user_id::text FROM public.support_tickets t WHERE t.id = OLD.ticket_id)
     AND (NEW.id, NEW.ticket_id, NEW.previous_shown_at, NEW.edited_by, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.ticket_id, OLD.previous_shown_at, OLD.edited_by, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
END;
$fn_guard_support_ticket_answer_revisions_mutation$;

CREATE TRIGGER guard_support_ticket_answer_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.support_ticket_answer_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
CREATE TRIGGER guard_support_ticket_answer_revisions_truncate
  BEFORE TRUNCATE ON public.support_ticket_answer_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
REVOKE ALL ON FUNCTION public.guard_support_ticket_answer_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- 3. 답변 템플릿(4-2 의 3, 6절) ---------------------------------------------------------------------------------------
CREATE TABLE public.support_reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND btrim(title) <> ''),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000 AND btrim(body) <> ''),
  category_id uuid REFERENCES public.support_ticket_categories(id),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE INDEX support_reply_templates_sort ON public.support_reply_templates (sort_order, created_at);

COMMENT ON TABLE public.support_reply_templates IS
  '13번: 문의 답변 템플릿(○○ 빈칸·{사이트이름}·{문의제목}·{접수일}). 쓰기는 서버 키(관리자 고객지원 화면 서버 액션)만.';

ALTER TABLE public.support_reply_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_reply_templates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_reply_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.support_reply_templates TO service_role;
CREATE POLICY support_reply_templates_admin_select ON public.support_reply_templates
  FOR SELECT TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')));

--    첫 값: 런북 12절 중 1:1 답변용 12-2~12-7·12-10(14개). '써머썬 연구소' → {사이트이름}, 한 글자 빈칸 '○' 도 '○○' 로 맞춤(빈칸 검사),
--    12-5 의 '구매 후 7일' → 30일(8번 이후 기준). category_id 는 칸이 하나라 두 카테고리(market_refund·credit_refund)에 함께 쓰는 글은 비운다
--    (모든 문의에서 보임). 회원 화면 문구처럼 데이터다 — 대표·직원이 '답변 템플릿' 탭에서 고친다.
INSERT INTO public.support_reply_templates (title, body, category_id, sort_order)
SELECT s.title, s.body, (SELECT c.id FROM public.support_ticket_categories c WHERE c.slug = s.slug), s.sort_order
  FROM (VALUES
    ('크레딧 미반영 — 접수', E'안녕하세요, {사이트이름}입니다.\n결제 후 크레딧이 반영되지 않아 불편을 드려 죄송합니다. 결제 내역을 확인하고 있으며, 확인되는 대로 크레딧을 지급해 드리겠습니다.\n빠른 확인을 위해 결제하신 일시와 금액, 결제수단을 알려 주시면 감사하겠습니다.', 'credit_error', 10),
    ('크레딧 미반영 — 처리 완료', E'결제가 확인되어 ○○ 크레딧을 지급해 드렸습니다. 마이페이지의 크레딧 내역에서 확인하실 수 있습니다. 기다려 주셔서 감사합니다.', 'credit_error', 20),
    ('크레딧 미반영 — 결제 확인 안 됨', E'확인 결과 해당 일시에 완료된 결제 내역이 없습니다. 카드사나 결제 앱에서 결제가 승인되었는지 한 번 더 확인해 주시고, 승인 내역이 있다면 승인 일시와 금액을 알려 주시면 다시 확인하겠습니다.', 'credit_error', 30),
    ('환불 접수', E'안녕하세요, {사이트이름}입니다.\n환불 요청이 접수되었습니다. 확인 후 영업일 기준 ○○일 이내에 처리해 드리겠습니다. 처리되는 동안 해당 크레딧은 사용하실 수 없습니다.', NULL, 40),
    ('환불 접수 — 계좌 송금 안내', E'고객님의 결제는 결제 수단의 사정(휴대폰 결제의 경우 결제하신 달이 지난 경우 등)으로 결제 취소가 되지 않아, 계좌로 환불해 드리고자 합니다.\n환불받으실 은행명, 계좌번호, 예금주(결제하신 본인 명의)를 알려 주시면 확인 후 송금해 드리겠습니다.', 'credit_refund', 50),
    ('환불 완료 — 결제 취소', E'○○원 결제 취소가 완료되었습니다. 카드사·결제수단에 따라 실제 반영까지 며칠이 걸릴 수 있습니다. 해당 크레딧은 회수되었습니다.', 'credit_refund', 60),
    ('환불 완료 — 계좌 송금', E'○○월 ○○일 알려 주신 계좌로 ○○원을 송금해 드렸습니다. 해당 크레딧은 회수되었습니다. 확인 부탁드립니다.', 'credit_refund', 70),
    ('환불 완료 — 자료 문제로 크레딧 환불', E'구매하신 「○○」 자료의 문제를 확인했습니다. 불편을 드려 죄송합니다. 사용하신 ○○ 크레딧을 돌려 드렸으며, 마이페이지의 크레딧 내역에서 확인하실 수 있습니다.', 'market_refund', 80),
    ('환불 거절', E'안녕하세요, {사이트이름}입니다.\n요청하신 환불은 아래 사유로 처리해 드리기 어렵습니다.\n- 사유: ○○ (예: 충전하신 크레딧 중 일부를 이미 사용하셨습니다 / 구매 후 30일이 지났습니다 / 자료를 이미 내려받으셨습니다)\n자세한 기준은 사이트의 취소/환불정책에서 확인하실 수 있습니다. 양해 부탁드립니다.', NULL, 90),
    ('잘못 지급한 크레딧 회수 — 안내', E'안녕하세요, {사이트이름}입니다.\n○○월 ○○일 고객님 계정에 ○○ 크레딧이 지급되었는데, 이는 저희의 처리 실수로 잘못 지급된 것입니다. 혼란을 드려 죄송합니다.\n해당 크레딧은 며칠 안에 회수될 예정이오니, 그때까지 사용하지 말아 주시기를 부탁드립니다. 회수가 끝나면 다시 안내해 드리겠습니다.\n고객님께서 직접 충전하신 크레딧에는 영향이 없습니다.', NULL, 100),
    ('잘못 지급한 크레딧 회수 — 완료', E'잘못 지급되었던 ○○ 크레딧의 회수를 마쳤습니다. 현재 잔액은 ○○ 크레딧입니다. 불편을 드려 다시 한번 죄송합니다.', NULL, 110),
    ('영수증 안내', E'안녕하세요, {사이트이름}입니다.\n요청하신 ○○월 ○○일 ○○원 결제 건의 영수증(매출전표)을 보내 드립니다. (첨부 / 아래 주소에서 확인하실 수 있습니다.)\n다른 형태의 증빙이 필요하시면 말씀해 주세요.', NULL, 120),
    ('비밀번호 분실 — 카카오 가입', E'고객님은 카카오 계정으로 가입하셨습니다. 로그인 화면에서 "카카오로 시작하기"를 눌러 로그인해 주세요. 별도의 비밀번호는 없습니다.', 'account', 130),
    ('비밀번호 분실 — 이메일 가입', E'안녕하세요, {사이트이름}입니다.\n죄송하게도 현재 비밀번호 재설정 기능을 준비하고 있어, 고객님 계정은 저희가 직접 확인해 도와 드려야 합니다. 본인 확인을 위해 가입하신 이메일 주소로 이 안내에 답장해 주시면, 확인 후 처리 방법을 안내해 드리겠습니다.', 'account', 140)
  ) AS s(title, body, slug, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.support_reply_templates);

-- 4. 설정 행(4-2 의 4, 10-1) — 문구는 초안이다. 대표가 관리자 고객지원 화면 '안내 문구' 탭에서 고친다. -----------------------------
--    member: 회원 화면 문구(필수 키가 비면 저장 거부, 선택 키가 비면 그 칸을 숨김). 자리표시는 알림 문구의 {문의제목} 하나.
--    admin: templateBlankMarker(관리자 화면에서 고치지 않음 — 템플릿과 함께 스크립트로), answerEditReasonGuide, notifyOnAnswerEdit,
--           accessLogRetentionYears(2 — 01-11 시행 처리방침 3절 '기록한 날부터 2년'과 같아야 함, 관리자 화면에서 고치지 않음).
INSERT INTO public.system_settings (key, value, description)
VALUES ('support_page_content', $json_support_page_content$
{
  "revision": 1,
  "member": {
    "pageTitle": "고객지원",
    "pageDescription": "1:1 문의를 남기고 답변을 확인합니다.",
    "formTitle": "1:1 문의하기",
    "formNotice": "답변은 이메일로 보내지 않습니다. 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "responseTimeNote": "",
    "defaultCategoryHelp": "선택한 문의 유형에 맞춰 내용을 적어 주세요.",
    "historyTitle": "문의 내역",
    "historyIntro": "남겨 주신 문의와 답변을 확인하실 수 있습니다.",
    "emptyTitle": "아직 문의하신 내역이 없습니다",
    "emptyDescription": "궁금한 점이 있으시면 언제든지 문의해 주세요.",
    "categoryLabel": "문의 카테고리",
    "categoryPlaceholder": "문의 유형을 선택해 주세요",
    "subjectLabel": "제목",
    "messageLabel": "내용",
    "defaultSubjectPlaceholder": "문의 제목을 입력해 주세요",
    "defaultMessagePlaceholder": "문의 내용을 자세히 적어 주세요",
    "submitLabel": "문의 등록하기",
    "submittingLabel": "접수 중…",
    "uncategorizedLabel": "미분류",
    "editCategoryLabel": "문의 카테고리 수정",
    "editSubjectLabel": "제목 수정",
    "editMessageLabel": "내용 수정",
    "editSubjectPlaceholder": "제목을 입력하세요",
    "editMessagePlaceholder": "내용을 입력하세요",
    "cancelLabel": "취소",
    "saveEditLabel": "수정 완료",
    "editIconTitle": "문의 수정",
    "deleteIconTitle": "문의 내역 삭제",
    "needCategoryToast": "문의 카테고리를 선택해 주세요.",
    "needContentToast": "제목과 내용을 모두 입력해 주세요.",
    "deletedToast": "문의 내역이 삭제되었습니다.",
    "updatedToast": "문의 내용이 수정되었습니다.",
    "submittedTitle": "문의가 등록되었습니다",
    "submittedDescription": "빠른 시일 내에 답변드리겠습니다. 답변은 이메일로 보내지 않으니, 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "deleteConfirmTitle": "문의 내역을 삭제할까요?",
    "deleteConfirmDescription": "삭제하면 내 문의 내역에서 사라지고 되돌릴 수 없습니다. 처리에 필요한 기록은 개인정보 처리방침에 따라 보관될 수 있습니다.",
    "deleteConfirmLabel": "삭제",
    "submitFailedToast": "문의 등록에 실패했습니다.",
    "updateFailedToast": "수정에 실패했습니다.",
    "deleteFailedToast": "삭제에 실패했습니다.",
    "answerLabel": "관리자 답변",
    "answerEditedLabel": "수정됨",
    "answerCreatedNotificationTitle": "문의하신 내용에 답변이 등록되었습니다.",
    "answerCreatedNotificationMessage": "제목: {문의제목}\n\n답변을 확인해보세요.",
    "answerEditedNotificationTitle": "문의 답변이 수정되었습니다.",
    "answerEditedNotificationMessage": "제목: {문의제목}\n\n수정된 답변을 확인해 보세요."
  },
  "admin": {
    "templateBlankMarker": "○○",
    "answerEditReasonGuide": "회원에게 보이지 않는 내부 기록입니다. 왜 고쳤는지 짧게 적어 주세요. 계좌·전화 같은 개인정보는 적지 마세요.",
    "notifyOnAnswerEdit": true,
    "accessLogRetentionYears": 2
  }
}
$json_support_page_content$::jsonb, '고객지원 회원 화면 문구·답변 설정(13번, 관리자 고객지원 화면 안내 문구 탭에서 수정)')
ON CONFLICT (key) DO NOTHING;

-- 5. 카테고리 slug 지키기(4-2 의 5, Q11) — slug 가 바뀔 때만 본다. SECURITY DEFINER 라 직원 세션의 RLS 와 상관없이 센다. -------------
--    문의(회원 삭제·탈퇴 회원 문의 포함)가 1건이라도 있거나, 옛 slug 가 탈퇴 가림 정책 redactionRefundCategorySlugs 에 있으면 거부.
CREATE FUNCTION public.guard_support_category_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_category_slug$
DECLARE
  v_slugs jsonb;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.category_id = OLD.id) THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
    v_slugs := (SELECT s.value -> 'redactionRefundCategorySlugs' FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy');
    IF jsonb_typeof(v_slugs) = 'array' AND v_slugs ? OLD.slug THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_guard_support_category_slug$;
REVOKE ALL ON FUNCTION public.guard_support_category_slug() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_support_category_slug
  BEFORE UPDATE OF slug ON public.support_ticket_categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_category_slug();

-- 6. 답변 저장 함수(4-3) -------------------------------------------------------------------------------------------
--    순서: 입력 → 행위자(owner 이거나 support.manage) → 문의 FOR UPDATE → 회원 삭제·탈퇴 → 재요청(작업 기록의 action·target_id·request_id·actor_id) →
--    충돌(sha256) → 첫 답변 / 수정(이력 1행·redaction_reviewed_at 비움) → 작업 기록(같은 거래).
--    app.support_answer_write = 문의 id 는 M2 잠금 트리거가 보는 표지다(거래 로컬).
CREATE FUNCTION public.save_support_ticket_answer(p_actor_id uuid, p_ticket_id uuid, p_response text, p_status text,
  p_expected_sha256 text, p_reason text, p_operation_key text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_support_ticket_answer$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_audit public.admin_audit_log%ROWTYPE;
  v_key text := btrim(p_operation_key);
  v_reason text := NULLIF(btrim(p_reason), '');
  v_previous text;
  v_history uuid;
  v_is_edit boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR p_ticket_id IS NULL OR p_response IS NULL OR btrim(p_response) = '' OR char_length(p_response) > 10000
     OR (p_status IS NOT NULL AND p_status NOT IN ('in_progress', 'resolved', 'closed'))
     OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[0-9a-f]{64}$'
     OR NULLIF(v_key, '') IS NULL OR char_length(v_key) > 200
     OR p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE
                    AND (p.admin_role = 'owner'
                         OR (p.admin_role = 'staff' AND EXISTS (SELECT 1 FROM public.admin_permission_grants g
                                                                  WHERE g.user_id = p.id AND g.permission = 'support.manage')))) THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_ACTOR_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_NOT_FOUND';
  END IF;

  IF v_ticket.is_deleted_by_user IS TRUE THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_DELETED_BY_MEMBER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;

  -- 재요청: 같은 처리자·같은 문의·같은 키의 기록이 있으면 그 결과를 다시 만든다(이력·작업 기록·알림 추가 없음).
  --   회원 삭제·탈퇴 검사 뒤에 둔다 — 탈퇴 회원 문의는 재요청이어도 본문을 돌려주지 않는다.
  SELECT a.* INTO v_audit
    FROM public.admin_audit_log a
   WHERE a.action IN ('support_ticket_reply', 'support_ticket_reply_edit')
     AND a.target_id = p_ticket_id::text
     AND a.request_id = v_key
     AND a.actor_id = p_actor_id
   ORDER BY a.created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
        'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
        'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
      'isEdit', v_audit.action = 'support_ticket_reply_edit',
      'historyId', v_audit.details -> 'historyId',
      'replayed', true);
  END IF;

  IF encode(sha256(convert_to(COALESCE(v_ticket.admin_response, ''), 'UTF8')), 'hex') <> p_expected_sha256 THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_CONFLICT';
  END IF;

  PERFORM set_config('app.support_answer_write', p_ticket_id::text, true);
  IF v_ticket.admin_response IS NULL THEN
    -- 첫 답변
    UPDATE public.support_tickets
       SET admin_response = p_response,
           status = COALESCE(p_status, 'resolved'),
           responded_at = v_now,
           updated_at = v_now
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('status', v_ticket.status, 'length', char_length(p_response), 'request', p_request_meta), v_key);
    v_is_edit := false;
  ELSE
    -- 수정: 사유 필수, 같은 글 거부, 상태는 그대로
    IF v_reason IS NULL OR char_length(v_reason) > 300 THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REASON_REQUIRED';
    END IF;
    IF p_response = v_ticket.admin_response THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_UNCHANGED';
    END IF;
    v_previous := v_ticket.admin_response;
    INSERT INTO public.support_ticket_answer_revisions (ticket_id, previous_response, previous_shown_at, edited_by, reason)
    VALUES (p_ticket_id, v_previous,
            COALESCE(v_ticket.response_edited_at, v_ticket.responded_at, v_ticket.updated_at, v_ticket.created_at), p_actor_id, v_reason)
    RETURNING id INTO v_history;
    UPDATE public.support_tickets
       SET admin_response = p_response,
           response_edited_at = v_now,
           updated_at = v_now,
           redaction_reviewed_at = NULL
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply_edit', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('historyId', v_history, 'lengthBefore', char_length(v_previous), 'lengthAfter', char_length(p_response),
                         'reasonLength', char_length(v_reason), 'request', p_request_meta), v_key);
    v_is_edit := true;
  END IF;
  PERFORM set_config('app.support_answer_write', '', true);

  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
      'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
      'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
    'isEdit', v_is_edit,
    'historyId', v_history,
    'replayed', false);
END;
$fn_save_support_ticket_answer$;
REVOKE ALL ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;

-- 7. 10번 함수 재정의(4-4) — 운영 원문 그대로에 '-- [13번]' 줄만 더하거나 바꿨다. 권한(EXECUTE)은 CREATE OR REPLACE 가 그대로 둔다. ------
-- 7-1. member_withdrawal_facts: (가) 계좌 요청 시각에 이력, (나) 가림 항목 support_ticket_answer_revision, (다) v_last_ticket 에 수정 시각,
--      문의 '확인됨' 판정에 수정 시각.
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  -- [13번] (가) 계좌 요청 시각: 지금 답변과 답변 수정 이력(그때 회원이 보던 글·보이기 시작한 시각)을 함께 본다.
  SELECT min(x.at) INTO v_account_at
    FROM (SELECT t.responded_at AS at
            FROM public.support_tickets t
           WHERE t.user_id = p_user_id
             AND t.responded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0)
          UNION ALL
          SELECT ar.previous_shown_at
            FROM public.support_ticket_answer_revisions ar
            JOIN public.support_tickets t ON t.id = ar.ticket_id
           WHERE t.user_id = p_user_id
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(ar.previous_response, k) > 0)) x;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at)) -- [13번] (다) 답변 수정 시각
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at, t.response_edited_at), '-infinity'::timestamptz)) AS reviewed -- [13번] 수정 시각
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      -- [13번] (나) 답변 수정 이력: 부모 문의의 환불 관련·계좌 요청 뒤, 이전 답변·수정 사유의 긴 숫자
      UNION ALL
      SELECT 'support_ticket_answer_revision', ar.id, ar.created_at,
             left(regexp_replace(COALESCE(tk.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(ar.previous_response) OR public.member_text_has_long_number(ar.reason) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_answer_revisions ar
        JOIN tk ON tk.id = ar.ticket_id
       WHERE ar.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note))
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;

-- 7-2. redact_member_text: 대상 종류 support_ticket_answer_revision(칸 previous_response·reason), 관리자 이벤트 가림은 부모 문의 기준.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind = 'support_ticket_answer_revision' AND p_field IN ('previous_response', 'reason')) -- [13번]
             OR (p_target_kind IN ('refund_request', 'market_refund_request') AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  -- [13번] 답변 수정 이력: 관리자 이벤트 가림은 수정 이력처럼 부모 문의 기준
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id
     WHERE ar.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_answer_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;

-- 7-3. mark_member_text_reviewed: 대상 종류 support_ticket_answer_revision 만 더함.
CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_user uuid;
  v_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_kind IS NULL
     OR p_target_kind NOT IN ('support_ticket', 'support_ticket_revision', 'support_ticket_answer_revision', 'refund_request', 'market_refund_request') THEN -- [13번]
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id INTO v_user FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE rv.id = p_target_id;
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN -- [13번]
    SELECT t.user_id INTO v_user FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id WHERE ar.id = p_target_id;
  ELSE
    EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1 FOR UPDATE', v_table) INTO v_user USING p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET redaction_reviewed_at = $1 WHERE id = $2', v_table) USING v_at, p_target_id;
  PERFORM public.record_admin_audit(p_actor_id, 'member_text_reviewed', p_target_kind, p_target_id::text, v_user, NULL, NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('reviewed', true, 'reviewedAt', v_at);
END;
$function$
;

-- 7-4. read_withdrawn_member_ticket: 결과에 answerRevisions(답변 수정 이력) 더함.
CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'support_ticket', p_ticket_id::text, v_ticket.user_id,
    NULL, p_reason, jsonb_build_object('kind', 'ticket', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_ticket) || jsonb_build_object('revisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rv) ORDER BY rv.written_at), '[]'::jsonb)
      FROM public.support_ticket_revisions rv WHERE rv.ticket_id = p_ticket_id),
    -- [13번] 답변 수정 이력(그때 회원이 보던 글·수정 사유)
    'answerRevisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(ar) ORDER BY ar.created_at, ar.id), '[]'::jsonb)
      FROM public.support_ticket_answer_revisions ar WHERE ar.ticket_id = p_ticket_id));
END;
$function$
;

-- [13번 M1] 끝 ------------------------------------------------------------------------------------------------

-- 8. VERIFY ---------------------------------------------------------------------------------------------------------
DO $verify_bundle13_cs_tools$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  -- 회원 화면 필수 키(10-1 표 '필수', 코드 SUPPORT_PAGE_REQUIRED_KEYS 와 같은 목록·순서 — 계약 시험이 대조)
  v_required text[] := ARRAY[
    'pageTitle', 'formTitle', 'historyTitle', 'emptyTitle', 'categoryLabel', 'categoryPlaceholder', 'subjectLabel', 'messageLabel',
    'submitLabel', 'submittingLabel', 'uncategorizedLabel', 'editCategoryLabel', 'editSubjectLabel', 'editMessageLabel',
    'editSubjectPlaceholder', 'editMessagePlaceholder', 'cancelLabel', 'saveEditLabel', 'editIconTitle', 'deleteIconTitle',
    'needCategoryToast', 'needContentToast', 'deletedToast', 'updatedToast', 'submittedTitle', 'submittedDescription',
    'deleteConfirmTitle', 'deleteConfirmDescription', 'deleteConfirmLabel', 'submitFailedToast', 'updateFailedToast', 'deleteFailedToast',
    'answerLabel', 'answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
    'answerEditedNotificationMessage'];
  v_optional text[] := ARRAY[
    'pageDescription', 'formNotice', 'responseTimeNote', 'defaultCategoryHelp', 'historyIntro', 'emptyDescription',
    'defaultSubjectPlaceholder', 'defaultMessagePlaceholder', 'answerEditedLabel'];
BEGIN
  -- 답변 이력: RLS·정책 0·service_role SELECT 만·가드 2개
  v_rel := 'public.support_ticket_answer_revisions';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel))
     OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: answer revisions table / RLS / privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_support_ticket_answer_revisions_mutation', 'guard_support_ticket_answer_revisions_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: answer revisions guard triggers';
  END IF;

  -- 템플릿: RLS·SELECT 정책 1개(support.manage)·anon 없음·authenticated SELECT 만·service_role 은 DELETE 없음·첫 값 14개
  v_rel := 'public.support_reply_templates';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates'
                     AND policyname = 'support_reply_templates_admin_select' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
                     AND roles = '{authenticated}' AND qual LIKE '%has_admin_permission(''support.manage''::text)%')
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE')
     OR has_table_privilege('authenticated', v_rel, 'DELETE')
     OR NOT has_table_privilege('service_role', v_rel, 'INSERT') OR NOT has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE') THEN
    RAISE EXCEPTION 'VERIFY: reply templates table / policy / privileges';
  END IF;
  IF (SELECT count(*) FROM public.support_reply_templates WHERE created_by IS NULL AND revision = 1) <> 14
     OR EXISTS (SELECT 1 FROM public.support_reply_templates WHERE body ~ '써머썬|[^○]○[^○]|^○[^○]|[^○]○$') THEN
    RAISE EXCEPTION 'VERIFY: reply template seed';
  END IF;

  -- 설정 행: revision·필수 키(비지 않은 글)·선택 키(글)·관리자 값
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'support_page_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'member') IS DISTINCT FROM 'object' OR jsonb_typeof(v_value -> 'admin') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: support_page_content shape';
  END IF;
  FOREACH v_key IN ARRAY v_required LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'member' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content required member key %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_optional LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content optional member key %', v_key;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(v_value -> 'member')) <> cardinality(v_required) + cardinality(v_optional)
     OR btrim(COALESCE(v_value -> 'admin' ->> 'templateBlankMarker', '')) = ''
     OR jsonb_typeof(v_value -> 'admin' -> 'answerEditReasonGuide') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'admin' -> 'notifyOnAnswerEdit') IS DISTINCT FROM 'boolean'
     OR (v_value -> 'admin' -> 'accessLogRetentionYears') IS DISTINCT FROM '2'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: support_page_content keys / admin values';
  END IF;

  -- 함수: 저장 함수는 service_role 만, 트리거 함수는 아무도. 모두 search_path 고정.
  v_fn := 'public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)';
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: save_support_ticket_answer EXECUTE / SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.guard_support_category_slug()', 'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.guard_support_category_slug()'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: guard_support_category_slug must be SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)', 'public.guard_support_category_slug()',
                              'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % search_path', v_fn;
    END IF;
  END LOOP;

  -- 재정의 4개: 본문 md5(prosrc)(로컬 계산 값)와 anonymize_member 그대로
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '15147d898bdd615963fd7173e154d9f5'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM '7ddf1b9245c429205af6b36fa01bfb21'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.mark_member_text_reviewed(uuid,text,uuid)'::regprocedure) IS DISTINCT FROM '1284e5d70af808bb2b949432d92e255b'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)'::regprocedure) IS DISTINCT FROM 'ba416c661c7e9fb4c036c8516cd85d2c' THEN
    RAISE EXCEPTION 'VERIFY: bundle 10 redefinitions body';
  END IF;
  IF md5(pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure))
     <> '1346d870d3623abae580a011b0484339' THEN
    RAISE EXCEPTION 'VERIFY: anonymize_member changed';
  END IF;
END;
$verify_bundle13_cs_tools$;

-- 기존 표에 거는 것(칸·FK·slug 트리거) 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 이 DDL 과 이 블록을 뺀다).
DO $verify_bundle13_cs_tools_existing_tables$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets'
                  AND column_name = 'response_edited_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'VERIFY: support_tickets.response_edited_at';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = 'public.support_ticket_answer_revisions'::regclass
       AND c.confrelid = 'public.support_tickets'::regclass AND c.confdeltype = 'c') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = 'public.support_reply_templates'::regclass
       AND c.confrelid = 'public.support_ticket_categories'::regclass) <> 1 THEN
    RAISE EXCEPTION 'VERIFY: foreign keys';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgname = 'guard_support_category_slug'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF slug ON public.support_ticket_categories FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: slug guard trigger';
  END IF;
END;
$verify_bundle13_cs_tools_existing_tables$;

NOTIFY pgrst, 'reload schema';
$rh_src_b13_m1$);
SELECT pg_temp.ctx_set('src_b14', $rh_src_b14$-- 출시 전 작업 순서표 14번 묶음: 공지 게시판 + FAQ(계획 docs/plan-bundle14-notice-faq.md 3판, 5절).
-- 만드는 것(추가만 — 기존 표의 칸·정책·트리거·FK 를 건드리지 않는다):
--   1. 표 site_board_posts(지금 글, board = notice·faq)와 site_board_post_revisions(판 이력, 가릴 수 있음).
--      RLS 켬·정책 0, PUBLIC·anon·authenticated·service_role 전부 회수 뒤 service_role 에 SELECT 만(쓰기는 아래 DEFINER 함수만).
--      행위자 칸(created_by·updated_by·deleted_by·redacted_by·saved_by)은 FK 없는 uuid(관리자 계정을 지워도 기록이 남음 — 12번·작업 기록과 같음).
--   2. 판 이력 가드 트리거: DELETE·TRUNCATE 거부, UPDATE 는 가림 함수 거래(app.site_board_redact = 그 post_id)의 가림 칸만.
--   3. 설정 행 system_settings.site_board_content(화면 문구 초안·FAQ 분류·고정 상한, revision 1 — 있으면 그대로). 정책은 만들지 않는다(5-4).
--   4. 함수 7개(SECURITY DEFINER, search_path 고정, service_role 만 EXECUTE): site_board_actor_allowed·member_facing_text_pii_hits·
--      save_site_board_post·delete_site_board_post·reorder_site_board_posts·redact_site_board_post·save_site_board_content.
-- 잠금 순서(5-6): 쓰기 함수 다섯은 권한 확인 직후, 글 행 FOR UPDATE·설정 행 읽기·sort_order 계산보다 먼저
--   pg_advisory_xact_lock(hashtext('site_board_order')) 를 잡는다(교착·분류 지우기/상한 낮추기 경합 방지).
-- 작업 기록(admin_audit_log)에는 제목·본문 원문도 본문 지문도 넣지 않는다(가릴 수 없는 표 — 짧은 본문은 지문으로 되찾을 수 있음).
--   글자 수·바뀐 칸·판 이력 행 id 만. 원문과 지문(body_sha256)은 판 이력 표에 두고, 가림 때 지문도 함께 지운다(NULL).
-- 지문 사전 점검은 md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 계획 1절). 다르면 멈춘다.
-- 잠금: 새 표 2개를 만들고 system_settings 에 행 1개를 넣는다(행 잠금). 기존 표에 거는 DDL 은 없다.
-- 되돌리기: supabase/rollback/20261217140000_bundle14_site_board_down.sql(코드를 14번 전으로 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(5-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle14_site_board$
DECLARE
  v_new_functions text[] := ARRAY[
    'site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post', 'delete_site_board_post',
    'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation'];
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed (%)',
      CASE WHEN to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL THEN 'missing'
           ELSE md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)'))) END;
  END IF;
  IF to_regclass('public.admin_permission_grants') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'admin_role')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'withdrawn_at') THEN
    RAISE EXCEPTION 'PRECHECK: admin_permission_grants / profiles.admin_role / profiles.withdrawn_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_footer_content') THEN
    RAISE EXCEPTION 'PRECHECK: site_footer_content missing';
  END IF;
  IF to_regclass('public.site_board_posts') IS NOT NULL OR to_regclass('public.site_board_post_revisions') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 14 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 14 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content') THEN
    RAISE EXCEPTION 'PRECHECK: site_board_content row already exists';
  END IF;
END;
$precheck_bundle14_site_board$;

-- [14번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 지금 글(5-2) ------------------------------------------------------------------------------------------------
CREATE TABLE public.site_board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL CHECK (board IN ('notice', 'faq')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100 AND btrim(title) <> '' AND strpos(title, E'\n') = 0),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000 AND btrim(body) <> ''),
  link_url text CHECK (link_url IS NULL OR char_length(link_url) BETWEEN 1 AND 200),
  link_label text CHECK (link_label IS NULL OR (char_length(link_label) BETWEEN 1 AND 30 AND strpos(link_label, E'\n') = 0)),
  faq_category_key text CHECK (faq_category_key IS NULL OR faq_category_key ~ '^[a-z][a-z0-9_]{0,29}$'),
  is_pinned boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  content_updated_at timestamptz,
  deleted_at timestamptz,
  redacted_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid,
  deleted_by uuid,
  redacted_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT site_board_posts_link_pair CHECK ((link_url IS NULL) = (link_label IS NULL)),
  CONSTRAINT site_board_posts_category CHECK ((board = 'faq') = (faq_category_key IS NOT NULL)),
  CONSTRAINT site_board_posts_faq_not_pinned CHECK (board = 'notice' OR NOT is_pinned),
  CONSTRAINT site_board_posts_published_at CHECK (NOT is_published OR published_at IS NOT NULL),
  CONSTRAINT site_board_posts_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL) AND (deleted_at IS NULL OR (NOT is_published AND NOT is_pinned))),
  CONSTRAINT site_board_posts_redacted CHECK ((redacted_at IS NULL) = (redacted_by IS NULL) AND (redacted_at IS NULL OR NOT is_published))
);
-- 글 수가 적다. 정렬은 5-5 규칙으로 쿼리에서 한다.
CREATE INDEX site_board_posts_published ON public.site_board_posts (board) WHERE is_published AND deleted_at IS NULL;

COMMENT ON TABLE public.site_board_posts IS
  '14번: 공지사항·FAQ 지금 글. 쓰기는 save/delete/reorder/redact_site_board_post 함수만(service_role 은 SELECT 만).';

ALTER TABLE public.site_board_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_board_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.site_board_posts TO service_role;

-- 2. 판 이력(5-3) — 저장·삭제마다 그 뒤 상태 1행. 순서만 바꾼 것은 넣지 않는다. post_id 는 같은 묶음 안이라 FK(ON DELETE 없음). --------
CREATE TABLE public.site_board_post_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.site_board_posts(id),
  revision integer NOT NULL CHECK (revision >= 1),
  title text NOT NULL,
  body text NOT NULL,
  link_url text,
  link_label text,
  faq_category_key text,
  is_pinned boolean NOT NULL,
  is_published boolean NOT NULL,
  body_sha256 text CHECK (body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$'),
  saved_by uuid NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redacted_at timestamptz,
  redacted_by uuid,
  CONSTRAINT site_board_post_revisions_post_revision UNIQUE (post_id, revision),
  CONSTRAINT site_board_post_revisions_redacted CHECK ((redacted_at IS NULL) = (redacted_by IS NULL)),
  -- 지문은 가리지 않은 행에만 있다(가림 때 NULL — 짧은 본문을 사전 대입으로 되찾지 못하게)
  CONSTRAINT site_board_post_revisions_sha256 CHECK ((body_sha256 IS NULL) = (redacted_at IS NOT NULL))
);

COMMENT ON TABLE public.site_board_post_revisions IS
  '14번: 공지·FAQ 판 이력(게시 증빙, 기한 없음). DELETE·TRUNCATE 거부, 가림(redact_site_board_post)만 제목·본문·링크를 바꾼다.';

ALTER TABLE public.site_board_post_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_board_post_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.site_board_post_revisions TO service_role;

--    UPDATE 는 거래 로컬 설정 app.site_board_redact 가 그 post_id 와 같을 때만: 제목·본문 → 지금 가림 문구, 링크·지문 → NULL,
--    redacted_* NULL→값. 다른 칸은 그대로여야 한다(13번 가림 방식과 같음).
CREATE FUNCTION public.guard_site_board_post_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_site_board_post_revisions_mutation$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.site_board_redact', true), '') <> ''
     AND current_setting('app.site_board_redact', true) = OLD.post_id::text
     AND (NEW.id, NEW.post_id, NEW.revision, NEW.faq_category_key, NEW.is_pinned, NEW.is_published, NEW.saved_by, NEW.saved_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.post_id, OLD.revision, OLD.faq_category_key, OLD.is_pinned, OLD.is_published, OLD.saved_by, OLD.saved_at)
     AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.redacted_by IS NOT NULL
     AND NEW.link_url IS NULL AND NEW.link_label IS NULL AND NEW.body_sha256 IS NULL
     AND NEW.title = NEW.body
     AND NEW.title = (SELECT s.value ->> 'redactedText' FROM public.system_settings s WHERE s.key = 'site_board_content') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SITE_BOARD_REVISIONS_APPEND_ONLY';
END;
$fn_guard_site_board_post_revisions_mutation$;

CREATE TRIGGER guard_site_board_post_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.site_board_post_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_site_board_post_revisions_mutation();
CREATE TRIGGER guard_site_board_post_revisions_truncate
  BEFORE TRUNCATE ON public.site_board_post_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_site_board_post_revisions_mutation();
REVOKE ALL ON FUNCTION public.guard_site_board_post_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- 3. 설정 행(5-4, 11절 초안) — 문구는 초안이다. 대표가 관리자 '공지사항'·'자주 묻는 질문' 화면의 안내 문구 탭에서 고친다. -----------------
--    하단·고객지원 링크는 스위치가 아니라 게시 글이 1개 이상일 때만 보인다(Q4). FAQ 글은 넣지 않는다(답이 약관 숫자와 어긋나면 안 됨).
INSERT INTO public.system_settings (key, value, description)
VALUES ('site_board_content', $json_site_board_content$
{
  "revision": 1,
  "notice": {
    "pageTitle": "공지사항",
    "pageDescription": "서비스 변경, 점검, 약관 개정 소식을 알려 드립니다.",
    "emptyTitle": "아직 공지사항이 없습니다",
    "emptyDescription": "새 소식이 생기면 이곳에 올리겠습니다.",
    "pinnedLabel": "중요",
    "updatedLabel": "수정",
    "backToListLabel": "목록으로",
    "notFoundTitle": "공지를 찾을 수 없습니다",
    "notFoundDescription": "내려갔거나 주소가 바뀐 공지입니다. 공지 목록에서 다시 찾아 주세요.",
    "footerLinkLabel": "공지사항",
    "maxPinned": 5
  },
  "faq": {
    "pageTitle": "자주 묻는 질문",
    "pageDescription": "크레딧·결제·자료 다운로드·계정에 관해 자주 받는 질문입니다.",
    "emptyTitle": "아직 등록된 질문이 없습니다",
    "allCategoryLabel": "전체",
    "categories": [
      { "key": "credit", "label": "크레딧·결제" },
      { "key": "refund", "label": "환불" },
      { "key": "download", "label": "자료·다운로드" },
      { "key": "account", "label": "계정·회원" }
    ],
    "supportPrompt": "찾는 답이 없으면 1:1 문의를 남겨 주세요.",
    "supportLinkLabel": "1:1 문의하기",
    "footerLinkLabel": "자주 묻는 질문"
  },
  "footer": {
    "navLabel": "공지와 도움말"
  },
  "redactedText": "개인정보가 포함되어 가린 글입니다."
}
$json_site_board_content$::jsonb, '14번: 공지사항·FAQ 회원 화면 문구·FAQ 분류·고정 상한(저장은 save_site_board_content 만)')
ON CONFLICT (key) DO NOTHING;

-- 4. 함수(5-6) ----------------------------------------------------------------------------------------------------
-- 4-1. 행위자 판정: 12번 member_suspension_actor_allowed 와 같은 식. admin_role 이 빈 관리자는 거절(TS buildAdminAccess 보다 엄격).
CREATE FUNCTION public.site_board_actor_allowed(p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_site_board_actor_allowed$
  SELECT p_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL
       AND (p.admin_role = 'owner'
            OR (p.admin_role = 'staff'
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = 'content.manage'))))
$fn_site_board_actor_allowed$;

-- 4-2. 회원에게 보이는 글의 개인정보 모양(이메일·휴대폰·일반 전화·주민번호). TS src/lib/member-facing-text-pii.ts 와 같은 규칙.
--      회사 고객센터 연락처(site_footer_content.fixedFields.customerCenter.value·orderEmail.value)는 뺀다. 전화는 숫자만 남겨 비교한다.
--      돌려주는 순서: email·mobile·phone·rrn(겹치지 않게). 16번이 같은 함수를 쓴다.
CREATE FUNCTION public.member_facing_text_pii_hits(p_text text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_facing_text_pii_hits$
DECLARE
  v_fixed jsonb := (SELECT s.value -> 'fixedFields' FROM public.system_settings s WHERE s.key = 'site_footer_content');
  v_allowed_phone text := regexp_replace(COALESCE(v_fixed #>> '{customerCenter,value}', ''), '[^0-9]', '', 'g');
  v_allowed_email text := lower(btrim(COALESCE(v_fixed #>> '{orderEmail,value}', '')));
  v_hits text[] := ARRAY[]::text[];
  v_m text[];
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN v_hits;
  END IF;
  FOR v_m IN SELECT regexp_matches(p_text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)*[.][A-Za-z]{2,}', 'g') LOOP
    IF lower(v_m[1]) <> v_allowed_email THEN
      v_hits := v_hits || 'email'::text;
      EXIT;
    END IF;
  END LOOP;
  FOR v_m IN SELECT regexp_matches(p_text, '(?<![0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])', 'g') LOOP
    IF regexp_replace(v_m[1], '[^0-9]', '', 'g') <> v_allowed_phone THEN
      v_hits := v_hits || 'mobile'::text;
      EXIT;
    END IF;
  END LOOP;
  FOR v_m IN SELECT regexp_matches(p_text, '(?<![0-9])0(?:2|[3-6][1-5]|70)[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])', 'g') LOOP
    IF regexp_replace(v_m[1], '[^0-9]', '', 'g') <> v_allowed_phone THEN
      v_hits := v_hits || 'phone'::text;
      EXIT;
    END IF;
  END LOOP;
  IF p_text ~ '(?<![0-9])[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[- ]?[1-8][0-9]{6}(?![0-9])' THEN
    v_hits := v_hits || 'rrn'::text;
  END IF;
  RETURN v_hits;
END;
$fn_member_facing_text_pii_hits$;

-- 4-3. 글 저장(새 글·고침). 순서: 요청 정보 → 행위자 → advisory lock → 글 행 FOR UPDATE(판·삭제·종류) → 설정 행 → 다듬기·검사 →
--      개인정보 → 바뀐 것 없음이면 그대로 → 고정 상한 → sort_order(5-5) → 날짜 → 저장·판 이력·작업 기록(같은 거래).
--      오류: SITE_BOARD_INPUT_INVALID:칸, SITE_BOARD_PII_SUSPECTED:종류(글자는 돌려주지 않음).
CREATE FUNCTION public.save_site_board_post(p_actor_id uuid, p_id uuid, p_expected_revision integer, p_board text, p_title text, p_body text,
  p_link_url text, p_link_label text, p_faq_category_key text, p_is_pinned boolean, p_is_published boolean, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_site_board_post$
DECLARE
  v_old public.site_board_posts%ROWTYPE;
  v_new public.site_board_posts%ROWTYPE;
  v_content jsonb;
  v_created boolean := p_id IS NULL;
  v_title text := regexp_replace(replace(replace(COALESCE(p_title, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_body text := regexp_replace(replace(replace(COALESCE(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_link_url text := NULLIF(regexp_replace(COALESCE(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_label text := NULLIF(regexp_replace(COALESCE(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_category text := NULLIF(btrim(COALESCE(p_faq_category_key, '')), '');
  v_pinned boolean := COALESCE(p_is_pinned, false);
  v_published boolean := COALESCE(p_is_published, false);
  v_hits text[];
  v_link_decoded text;
  v_changed text[] := ARRAY[]::text[];
  v_max_pinned integer;
  v_sort integer;
  v_published_at timestamptz;
  v_content_updated_at timestamptz;
  v_revision_row uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE·설정 행 읽기·sort_order 계산보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF p_board IS NULL OR p_board NOT IN ('notice', 'faq') THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:board';
  END IF;
  IF v_created THEN
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:revision';
    END IF;
  ELSE
    SELECT * INTO v_old FROM public.site_board_posts WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SITE_BOARD_POST_NOT_FOUND';
    END IF;
    IF v_old.deleted_at IS NOT NULL OR v_old.redacted_at IS NOT NULL THEN
      RAISE EXCEPTION 'SITE_BOARD_POST_DELETED';
    END IF;
    IF v_old.board <> p_board THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:board';
    END IF;
    IF p_expected_revision IS DISTINCT FROM v_old.revision THEN
      RAISE EXCEPTION 'SITE_BOARD_REVISION_CONFLICT';
    END IF;
  END IF;

  SELECT s.value INTO v_content FROM public.system_settings s WHERE s.key = 'site_board_content';
  IF v_content IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_CONTENT_MISSING';
  END IF;

  -- 다듬기·검사(src/lib/site-board.ts validateSiteBoardPostInput 과 같은 순서)
  IF v_title = '' OR char_length(v_title) > 100 OR strpos(v_title, E'\n') > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:title';
  END IF;
  IF v_body = '' OR char_length(v_body) > 20000 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:body';
  END IF;
  -- 링크: 사이트 안 경로만(isAllowedNoticeLink 와 같은 규칙) + 제어문자 퍼센트 인코딩(%00-%1F·%7F) 거절(TS isAllowedSiteBoardLink 와 같음).
  --   링크가 없으면 이름도 버린다.
  IF v_link_url IS NOT NULL AND (left(v_link_url, 1) <> '/' OR left(v_link_url, 2) = '//' OR left(v_link_url, 2) = '/\'
     OR v_link_url ~ '[[:space:]]' OR v_link_url ~ '[\x01-\x1f\x7f]' OR char_length(v_link_url) > 200
     OR v_link_url ~* '%(0[0-9a-f]|1[0-9a-f]|7f)') THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:linkUrl';
  END IF;
  IF v_link_url IS NULL THEN
    v_link_label := NULL;
  ELSIF v_link_label IS NULL OR char_length(v_link_label) > 30 OR strpos(v_link_label, E'\n') > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:linkLabel';
  END IF;
  IF p_board = 'faq' THEN
    IF v_category IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_content #> '{faq,categories}') = 'array' THEN v_content #> '{faq,categories}' ELSE '[]'::jsonb END) c
       WHERE c ->> 'key' = v_category) THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faqCategoryKey';
    END IF;
    IF v_pinned THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:isPinned';
    END IF;
  ELSIF v_category IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faqCategoryKey';
  END IF;

  -- 개인정보: 제목·본문·링크 주소(원문과 퍼센트 인코딩을 푼 값 둘 다)·링크 이름(종류만 돌려줌).
  --   푸는 규칙은 TS decodeSiteBoardLinkForPii 와 같다: %XX(16진 2자리)는 바이트로, 나머지는 그대로 UTF-8 로 이어 붙여 풀고,
  --   UTF-8 이 아니면 원문 그대로 본다.
  v_link_decoded := v_link_url;
  IF v_link_url IS NOT NULL AND strpos(v_link_url, '%') > 0 THEN
    BEGIN
      SELECT convert_from(string_agg(CASE WHEN t.m[1] IS NOT NULL THEN decode(substr(t.m[1], 2), 'hex') ELSE convert_to(t.m[2], 'UTF8') END,
                                     ''::bytea ORDER BY t.ord), 'UTF8')
        INTO v_link_decoded
        FROM regexp_matches(v_link_url, '(%[0-9A-Fa-f]{2})|([^%]+|%)', 'g') WITH ORDINALITY AS t(m, ord);
    EXCEPTION WHEN OTHERS THEN
      v_link_decoded := v_link_url;
    END;
  END IF;
  v_hits := public.member_facing_text_pii_hits(v_title) || public.member_facing_text_pii_hits(v_body)
    || public.member_facing_text_pii_hits(v_link_url) || public.member_facing_text_pii_hits(v_link_decoded)
    || public.member_facing_text_pii_hits(v_link_label);
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_PII_SUSPECTED:%', array_to_string(ARRAY(SELECT DISTINCT h FROM unnest(v_hits) h ORDER BY h), ',');
  END IF;

  IF NOT v_created THEN
    IF v_old.title IS DISTINCT FROM v_title THEN v_changed := v_changed || 'title'::text; END IF;
    IF v_old.body IS DISTINCT FROM v_body THEN v_changed := v_changed || 'body'::text; END IF;
    IF v_old.link_url IS DISTINCT FROM v_link_url THEN v_changed := v_changed || 'linkUrl'::text; END IF;
    IF v_old.link_label IS DISTINCT FROM v_link_label THEN v_changed := v_changed || 'linkLabel'::text; END IF;
    IF v_old.faq_category_key IS DISTINCT FROM v_category THEN v_changed := v_changed || 'faqCategoryKey'::text; END IF;
    IF v_old.is_pinned IS DISTINCT FROM v_pinned THEN v_changed := v_changed || 'isPinned'::text; END IF;
    IF v_old.is_published IS DISTINCT FROM v_published THEN v_changed := v_changed || 'isPublished'::text; END IF;
    -- 바뀐 것이 없으면 기록·판 이력 없이 돌려준다.
    IF cardinality(v_changed) = 0 THEN
      RETURN jsonb_build_object('changed', false, 'created', false, 'id', v_old.id, 'revision', v_old.revision);
    END IF;
  END IF;

  -- 고정 상한: 잠금 뒤 읽은 maxPinned 로 '미삭제이고 고정인 글(숨김 포함)'을 센다(5-5).
  IF v_pinned AND (v_created OR NOT v_old.is_pinned) THEN
    v_max_pinned := CASE WHEN jsonb_typeof(v_content #> '{notice,maxPinned}') = 'number' THEN (v_content #>> '{notice,maxPinned}')::integer END;
    IF v_max_pinned IS NULL OR (SELECT count(*) FROM public.site_board_posts p
                                  WHERE p.board = 'notice' AND p.is_pinned AND p.deleted_at IS NULL) >= v_max_pinned THEN
      RAISE EXCEPTION 'SITE_BOARD_PIN_LIMIT';
    END IF;
  END IF;

  -- sort_order(5-5): 고정으로 바뀌면 고정 맨 뒤, 고정이 풀리면 0, FAQ 가 새로 생기거나 분류가 바뀌면 새 분류 맨 뒤.
  IF p_board = 'notice' THEN
    IF NOT v_pinned THEN
      v_sort := 0;
    ELSIF v_created OR NOT v_old.is_pinned THEN
      v_sort := COALESCE((SELECT max(p.sort_order) FROM public.site_board_posts p
                           WHERE p.board = 'notice' AND p.is_pinned AND p.deleted_at IS NULL), 0) + 1;
    ELSE
      v_sort := v_old.sort_order;
    END IF;
  ELSE
    IF v_created OR v_old.faq_category_key IS DISTINCT FROM v_category THEN
      v_sort := COALESCE((SELECT max(p.sort_order) FROM public.site_board_posts p
                           WHERE p.board = 'faq' AND p.faq_category_key = v_category AND p.deleted_at IS NULL
                             AND p.id IS DISTINCT FROM p_id), 0) + 1;
    ELSE
      v_sort := v_old.sort_order;
    END IF;
  END IF;

  -- 날짜: 처음 게시 때 published_at. 게시된 적이 있는 글의 제목·본문·링크가 바뀌면 content_updated_at.
  v_published_at := CASE WHEN v_created THEN NULL ELSE v_old.published_at END;
  IF v_published AND v_published_at IS NULL THEN
    v_published_at := v_now;
  END IF;
  v_content_updated_at := CASE WHEN v_created THEN NULL ELSE v_old.content_updated_at END;
  IF NOT v_created AND v_old.published_at IS NOT NULL
     AND v_changed && ARRAY['title', 'body', 'linkUrl', 'linkLabel']::text[] THEN
    v_content_updated_at := v_now;
  END IF;

  IF v_created THEN
    INSERT INTO public.site_board_posts (board, title, body, link_url, link_label, faq_category_key, is_pinned, sort_order,
      is_published, published_at, created_by, updated_by, created_at, updated_at, revision)
    VALUES (p_board, v_title, v_body, v_link_url, v_link_label, v_category, v_pinned, v_sort,
      v_published, v_published_at, p_actor_id, p_actor_id, v_now, v_now, 1)
    RETURNING * INTO v_new;
  ELSE
    UPDATE public.site_board_posts
       SET title = v_title, body = v_body, link_url = v_link_url, link_label = v_link_label, faq_category_key = v_category,
           is_pinned = v_pinned, sort_order = v_sort, is_published = v_published, published_at = v_published_at,
           content_updated_at = v_content_updated_at, updated_by = p_actor_id, updated_at = v_now, revision = revision + 1
     WHERE id = p_id
    RETURNING * INTO v_new;
  END IF;

  INSERT INTO public.site_board_post_revisions (post_id, revision, title, body, link_url, link_label, faq_category_key,
    is_pinned, is_published, body_sha256, saved_by, saved_at)
  VALUES (v_new.id, v_new.revision, v_new.title, v_new.body, v_new.link_url, v_new.link_label, v_new.faq_category_key,
    v_new.is_pinned, v_new.is_published, encode(sha256(convert_to(v_new.body, 'UTF8')), 'hex'), p_actor_id, v_now)
  RETURNING id INTO v_revision_row;

  -- 작업 기록: 제목·본문 원문은 넣지 않는다(지문·글자 수·바뀐 칸만).
  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_save', 'site_board_post', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'board', v_new.board,
      'post_id', v_new.id,
      'created', v_created,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'revision_row_id', v_revision_row,
      'changed_fields', to_jsonb(CASE WHEN v_created THEN ARRAY['title', 'body', 'linkUrl', 'linkLabel', 'faqCategoryKey', 'isPinned', 'isPublished']::text[] ELSE v_changed END),
      'title_length', char_length(v_new.title),
      'body_length', char_length(v_new.body),
      'body_length_before', CASE WHEN v_created THEN NULL ELSE char_length(v_old.body) END,
      'is_published_before', v_old.is_published,
      'is_published_after', v_new.is_published,
      'is_pinned_before', v_old.is_pinned,
      'is_pinned_after', v_new.is_pinned,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'created', v_created, 'id', v_new.id, 'revision', v_new.revision);
END;
$fn_save_site_board_post$;

-- 4-4. 글 삭제(숨김 보관): deleted_at, 게시 끔, 고정 해제·sort_order 0, 판 이력 1행, 작업 기록(지문·글자 수만).
CREATE FUNCTION public.delete_site_board_post(p_actor_id uuid, p_id uuid, p_expected_revision integer, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_delete_site_board_post$
DECLARE
  v_old public.site_board_posts%ROWTYPE;
  v_new public.site_board_posts%ROWTYPE;
  v_revision_row uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:id';
  END IF;
  SELECT * INTO v_old FROM public.site_board_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_BOARD_POST_NOT_FOUND';
  END IF;
  IF v_old.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_POST_DELETED';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_old.revision THEN
    RAISE EXCEPTION 'SITE_BOARD_REVISION_CONFLICT';
  END IF;

  UPDATE public.site_board_posts
     SET deleted_at = v_now, deleted_by = p_actor_id, is_published = false, is_pinned = false, sort_order = 0,
         updated_by = p_actor_id, updated_at = v_now, revision = revision + 1
   WHERE id = p_id
  RETURNING * INTO v_new;

  INSERT INTO public.site_board_post_revisions (post_id, revision, title, body, link_url, link_label, faq_category_key,
    is_pinned, is_published, body_sha256, saved_by, saved_at, redacted_at, redacted_by)
  VALUES (v_new.id, v_new.revision, v_new.title, v_new.body, v_new.link_url, v_new.link_label, v_new.faq_category_key,
    v_new.is_pinned, v_new.is_published,
    CASE WHEN v_new.redacted_at IS NULL THEN encode(sha256(convert_to(v_new.body, 'UTF8')), 'hex') END, p_actor_id, v_now,
    v_new.redacted_at, v_new.redacted_by)
  RETURNING id INTO v_revision_row;

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_delete', 'site_board_post', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'board', v_new.board,
      'post_id', v_new.id,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'revision_row_id', v_revision_row,
      'title_length', char_length(v_new.title),
      'body_length', char_length(v_new.body),
      'was_published', v_old.is_published,
      'was_pinned', v_old.is_pinned,
      'request', p_request_meta,
      'deleted_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'id', v_new.id, 'revision', v_new.revision);
END;
$fn_delete_site_board_post$;

-- 4-5. 순서 바꾸기: 범위는 공지 'pinned'(미삭제 고정 글, 숨김 포함), FAQ 는 분류 key(그 분류의 미삭제 글, 숨김 포함).
--      id 집합이 범위와 정확히 같아야 한다(빠짐·더함·중복 → SITE_BOARD_REORDER_MISMATCH). 판 이력·revision 은 바꾸지 않는다.
CREATE FUNCTION public.reorder_site_board_posts(p_actor_id uuid, p_board text, p_scope text, p_ids uuid[], p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_reorder_site_board_posts$
DECLARE
  v_before uuid[];
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF NOT ((p_board = 'notice' AND p_scope = 'pinned') OR (p_board = 'faq' AND p_scope ~ '^[a-z][a-z0-9_]{0,29}$')) THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:scope';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500 OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:ids';
  END IF;

  PERFORM 1 FROM public.site_board_posts p
   WHERE p.board = p_board AND p.deleted_at IS NULL
     AND ((p_board = 'notice' AND p.is_pinned) OR (p_board = 'faq' AND p.faq_category_key = p_scope))
   FOR UPDATE;
  SELECT COALESCE(array_agg(p.id ORDER BY p.sort_order, p.id), '{}') INTO v_before
    FROM public.site_board_posts p
   WHERE p.board = p_board AND p.deleted_at IS NULL
     AND ((p_board = 'notice' AND p.is_pinned) OR (p_board = 'faq' AND p.faq_category_key = p_scope));

  IF cardinality(p_ids) <> cardinality(v_before)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids)
     OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_ids) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_before) x) THEN
    RAISE EXCEPTION 'SITE_BOARD_REORDER_MISMATCH';
  END IF;
  IF p_ids = v_before THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.site_board_posts p
     SET sort_order = o.ord
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE p.id = o.id AND p.sort_order IS DISTINCT FROM o.ord;

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_reorder', 'site_board', p_board || ':' || p_scope, NULL, NULL, NULL,
    jsonb_build_object(
      'board', p_board,
      'scope', p_scope,
      'ids_before', to_jsonb(v_before),
      'ids_after', to_jsonb(p_ids),
      'request', p_request_meta,
      'reordered_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true);
END;
$fn_reorder_site_board_posts$;

-- 4-6. 가림(대표만, 숨김·삭제한 글만): 지금 글과 모든 판 이력의 제목·본문을 redactedText 로, 링크 주소·이름·본문 지문을 NULL 로. 되돌릴 수 없다.
--      사유는 정해진 코드만(자유 글 없음, src/lib/site-board.ts SITE_BOARD_REDACT_REASON_CODES 와 같음).
CREATE FUNCTION public.redact_site_board_post(p_actor_id uuid, p_id uuid, p_reason_code text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_redact_site_board_post$
DECLARE
  v_old public.site_board_posts%ROWTYPE;
  v_new public.site_board_posts%ROWTYPE;
  v_text text;
  v_count integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:id';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('pii', 'other') THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:reasonCode';
  END IF;
  SELECT * INTO v_old FROM public.site_board_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_BOARD_POST_NOT_FOUND';
  END IF;
  IF v_old.is_published THEN
    RAISE EXCEPTION 'SITE_BOARD_REDACT_PUBLISHED';
  END IF;
  IF v_old.redacted_at IS NOT NULL THEN
    RETURN jsonb_build_object('changed', false, 'id', v_old.id, 'revision', v_old.revision);
  END IF;

  v_text := (SELECT s.value ->> 'redactedText' FROM public.system_settings s WHERE s.key = 'site_board_content');
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 100 OR strpos(v_text, E'\n') > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_CONTENT_MISSING';
  END IF;

  PERFORM set_config('app.site_board_redact', p_id::text, true);
  UPDATE public.site_board_post_revisions
     SET title = v_text, body = v_text, link_url = NULL, link_label = NULL, body_sha256 = NULL, redacted_at = v_now, redacted_by = p_actor_id
   WHERE post_id = p_id AND redacted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.site_board_redact', '', true);

  UPDATE public.site_board_posts
     SET title = v_text, body = v_text, link_url = NULL, link_label = NULL, redacted_at = v_now, redacted_by = p_actor_id,
         updated_by = p_actor_id, updated_at = v_now, revision = revision + 1
   WHERE id = p_id
  RETURNING * INTO v_new;

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_redact', 'site_board_post', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'board', v_new.board,
      'post_id', v_new.id,
      'reason_code', p_reason_code,
      'revisions_redacted', v_count,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'request', p_request_meta,
      'redacted_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'id', v_new.id, 'revision', v_new.revision, 'revisionsRedacted', v_count);
END;
$fn_redact_site_board_post$;

-- 4-7. 안내 문구 저장(관리자 '안내 문구' 탭): 판 비교, 필수 키 빈 값 거부(SITE_BOARD_REQUIRED_KEYS 와 같은 목록), 분류 key 형식·중복,
--      글이 남은 분류 지우기 거부, maxPinned 1~20 이고 지금 고정 글 수 이상, redactedText 한 줄·100자 이하, 모든 문구 개인정보 검사.
--      저장하는 값은 아는 키만으로 다시 만든다. 기록에는 before·after(회사가 쓰는 화면 문구라 그대로, 개인정보 검사 통과).
CREATE FUNCTION public.save_site_board_content(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_site_board_content$
DECLARE
  v_notice_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'emptyDescription', 'pinnedLabel', 'updatedLabel',
    'backToListLabel', 'notFoundTitle', 'notFoundDescription', 'footerLinkLabel'];
  v_faq_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'allCategoryLabel', 'supportPrompt', 'supportLinkLabel', 'footerLinkLabel'];
  v_footer_keys text[] := ARRAY['navLabel'];
  v_old jsonb;
  v_revision integer;
  v_notice jsonb := '{}'::jsonb;
  v_faq jsonb := '{}'::jsonb;
  v_footer jsonb := '{}'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_new jsonb;
  v_key text;
  v_text text;
  v_item jsonb;
  v_max_pinned integer;
  v_redacted text;
  v_texts text[] := ARRAY[]::text[];
  v_hits text[] := ARRAY[]::text[];
  v_in_use text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 설정 행 읽기·분류 사용 중 검사·고정 수 검사보다 먼저(글 저장과 같은 잠금)
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'site_board_content' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_CONTENT_MISSING';
  END IF;
  v_revision := CASE WHEN jsonb_typeof(v_old -> 'revision') = 'number' THEN (v_old ->> 'revision')::integer END;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'SITE_BOARD_REVISION_CONFLICT';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'notice') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_value -> 'faq') IS DISTINCT FROM 'object' OR jsonb_typeof(p_value -> 'footer') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:value';
  END IF;

  -- 필수 키: 비지 않은 한 줄 글, 300자 이하
  FOREACH v_key IN ARRAY v_notice_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'notice' -> v_key) = 'string' THEN btrim(p_value -> 'notice' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:notice.%', v_key;
    END IF;
    v_notice := v_notice || jsonb_build_object(v_key, v_text);
    v_texts := v_texts || v_text;
  END LOOP;
  FOREACH v_key IN ARRAY v_faq_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'faq' -> v_key) = 'string' THEN btrim(p_value -> 'faq' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faq.%', v_key;
    END IF;
    v_faq := v_faq || jsonb_build_object(v_key, v_text);
    v_texts := v_texts || v_text;
  END LOOP;
  FOREACH v_key IN ARRAY v_footer_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'footer' -> v_key) = 'string' THEN btrim(p_value -> 'footer' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:footer.%', v_key;
    END IF;
    v_footer := v_footer || jsonb_build_object(v_key, v_text);
    v_texts := v_texts || v_text;
  END LOOP;

  -- 가림 문구: 한 줄·100자 이하(가림이 제목 CHECK 에 걸려 실패하지 않게)
  v_redacted := CASE WHEN jsonb_typeof(p_value -> 'redactedText') = 'string' THEN btrim(p_value ->> 'redactedText') END;
  IF v_redacted IS NULL OR v_redacted = '' OR char_length(v_redacted) > 100 OR v_redacted ~ '[\r\n]' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:redactedText';
  END IF;
  v_texts := v_texts || v_redacted;

  -- FAQ 분류: 1~20개, key 형식·중복, 이름 한 줄 30자 이하
  IF jsonb_typeof(p_value -> 'faq' -> 'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_value -> 'faq' -> 'categories') NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faq.categories';
  END IF;
  FOR v_item IN SELECT e FROM jsonb_array_elements(p_value -> 'faq' -> 'categories') e LOOP
    v_key := CASE WHEN jsonb_typeof(v_item -> 'key') = 'string' THEN v_item ->> 'key' END;
    v_text := CASE WHEN jsonb_typeof(v_item -> 'label') = 'string' THEN btrim(v_item ->> 'label') END;
    IF jsonb_typeof(v_item) <> 'object' OR v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{0,29}$'
       OR v_text IS NULL OR v_text = '' OR char_length(v_text) > 30 OR v_text ~ '[\r\n]'
       OR v_categories @> jsonb_build_array(jsonb_build_object('key', v_key)) THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faq.categories';
    END IF;
    v_categories := v_categories || jsonb_build_array(jsonb_build_object('key', v_key, 'label', v_text));
    v_texts := v_texts || v_text;
  END LOOP;
  -- 글(숨김 포함, 삭제 글 제외)이 남은 분류는 지울 수 없다(5-5 '분류 사용 중').
  SELECT p.faq_category_key INTO v_in_use
    FROM public.site_board_posts p
   WHERE p.board = 'faq' AND p.deleted_at IS NULL
     AND NOT (v_categories @> jsonb_build_array(jsonb_build_object('key', p.faq_category_key)))
   ORDER BY p.faq_category_key
   LIMIT 1;
  IF v_in_use IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_CATEGORY_IN_USE:%', v_in_use;
  END IF;
  v_faq := v_faq || jsonb_build_object('categories', v_categories);

  -- 고정 상한: 1~20 이고 지금 고정 글 수(미삭제 고정, 숨김 포함) 이상
  v_max_pinned := CASE WHEN jsonb_typeof(p_value -> 'notice' -> 'maxPinned') = 'number'
                        AND (p_value -> 'notice' ->> 'maxPinned') ~ '^[0-9]{1,2}$'
                       THEN (p_value -> 'notice' ->> 'maxPinned')::integer END;
  IF v_max_pinned IS NULL OR v_max_pinned < 1 OR v_max_pinned > 20
     OR v_max_pinned < (SELECT count(*) FROM public.site_board_posts p WHERE p.board = 'notice' AND p.is_pinned AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:notice.maxPinned';
  END IF;
  v_notice := v_notice || jsonb_build_object('maxPinned', v_max_pinned);

  -- 회원에게 보이는 모든 문구에 개인정보 검사(종류만 돌려줌)
  FOREACH v_text IN ARRAY v_texts LOOP
    v_hits := v_hits || public.member_facing_text_pii_hits(v_text);
  END LOOP;
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_PII_SUSPECTED:%', array_to_string(ARRAY(SELECT DISTINCT h FROM unnest(v_hits) h ORDER BY h), ',');
  END IF;

  v_new := jsonb_build_object('revision', v_revision + 1, 'notice', v_notice, 'faq', v_faq, 'footer', v_footer, 'redactedText', v_redacted);
  IF (v_new - 'revision') = (v_old - 'revision') THEN
    RETURN jsonb_build_object('changed', false, 'revision', v_revision);
  END IF;

  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'site_board_content';

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_content_update', 'system_settings', 'site_board_content', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_revision,
      'revision_after', v_revision + 1,
      'before', v_old,
      'after', v_new,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'revision', v_revision + 1);
END;
$fn_save_site_board_content$;

-- 4-8. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.site_board_actor_allowed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_facing_text_pii_hits(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.site_board_actor_allowed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_facing_text_pii_hits(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb) TO service_role;

-- 5. VERIFY(5-7) ---------------------------------------------------------------------------------------------------
DO $verify_bundle14_site_board$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  v_notice_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'emptyDescription', 'pinnedLabel', 'updatedLabel',
    'backToListLabel', 'notFoundTitle', 'notFoundDescription', 'footerLinkLabel'];
  v_faq_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'allCategoryLabel', 'supportPrompt', 'supportLinkLabel', 'footerLinkLabel'];
  v_footer_keys text[] := ARRAY['navLabel'];
  v_functions text[] := ARRAY[
    'public.site_board_actor_allowed(uuid)',
    'public.member_facing_text_pii_hits(text)',
    'public.save_site_board_post(uuid,uuid,integer,text,text,text,text,text,text,boolean,boolean,jsonb)',
    'public.delete_site_board_post(uuid,uuid,integer,jsonb)',
    'public.reorder_site_board_posts(uuid,text,text,uuid[],jsonb)',
    'public.redact_site_board_post(uuid,uuid,text,jsonb)',
    'public.save_site_board_content(uuid,integer,jsonb,jsonb)'];
BEGIN
  -- 표 2개: RLS·정책 0·권한 = service_role SELECT 만(anon·authenticated·PUBLIC 0)
  FOREACH v_rel IN ARRAY ARRAY['public.site_board_posts', 'public.site_board_post_revisions'] LOOP
    IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
       OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = to_regclass(v_rel)) <> 0
       OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
       OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
       OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
       OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('anon', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE')
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass(v_rel) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % table / RLS / privileges', v_rel;
    END IF;
  END LOOP;
  -- CHECK·인덱스·FK: 글 표는 FK 0(행위자 칸 FK 없음), 판 이력은 글 표를 가리키는 FK 1개뿐
  IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_posts'::regclass AND c.contype = 'c') <> 14
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_post_revisions'::regclass AND c.contype = 'c'
           AND c.conname = 'site_board_post_revisions_sha256') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_posts'::regclass AND c.contype = 'f') <> 0
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_post_revisions'::regclass AND c.contype = 'f') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_post_revisions'::regclass AND c.contype = 'f'
           AND c.confrelid = 'public.site_board_posts'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'site_board_posts' AND indexname = 'site_board_posts_published'
                     AND indexdef LIKE '%WHERE (is_published AND (deleted_at IS NULL))%') THEN
    RAISE EXCEPTION 'VERIFY: site_board CHECK / FK / index';
  END IF;
  -- 판 이력 가드 트리거 2개
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.site_board_post_revisions'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_site_board_post_revisions_mutation', 'guard_site_board_post_revisions_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: revisions guard triggers';
  END IF;
  -- 함수 7개: SECURITY DEFINER·search_path·EXECUTE 는 service_role 만. 가드 함수는 아무도.
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY DEFINER / search_path / EXECUTE', v_fn;
    END IF;
  END LOOP;
  v_fn := 'public.guard_site_board_post_revisions_mutation()';
  IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'VERIFY: guard function privileges / search_path';
  END IF;
  -- 설정 행: revision·필수 키(비지 않은 글)·maxPinned·분류·가림 문구, 개인정보 없음
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'site_board_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: site_board_content shape';
  END IF;
  FOREACH v_key IN ARRAY v_notice_keys LOOP
    IF jsonb_typeof(v_value -> 'notice' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'notice' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: site_board_content notice.%', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_faq_keys LOOP
    IF jsonb_typeof(v_value -> 'faq' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'faq' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: site_board_content faq.%', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_footer_keys LOOP
    IF jsonb_typeof(v_value -> 'footer' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'footer' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: site_board_content footer.%', v_key;
    END IF;
  END LOOP;
  IF jsonb_typeof(v_value -> 'redactedText') IS DISTINCT FROM 'string' OR char_length(v_value ->> 'redactedText') NOT BETWEEN 1 AND 100
     OR jsonb_typeof(v_value -> 'notice' -> 'maxPinned') IS DISTINCT FROM 'number'
     OR (v_value #>> '{notice,maxPinned}')::integer NOT BETWEEN 1 AND 20
     OR jsonb_typeof(v_value -> 'faq' -> 'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_value -> 'faq' -> 'categories') < 1
     -- 개인정보 검사 범위는 save_site_board_content 와 같다(필수 키·footer·FAQ 분류 이름·가림 문구 — 설정 행의 모든 글 값)
     OR EXISTS (SELECT 1 FROM jsonb_path_query(v_value, '$.** ? (@.type() == "string")') s
                 WHERE cardinality(public.member_facing_text_pii_hits(s #>> '{}')) > 0) THEN
    RAISE EXCEPTION 'VERIFY: site_board_content values';
  END IF;
END;
$verify_bundle14_site_board$;

NOTIFY pgrst, 'reload schema';
$rh_src_b14$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 16번 묶음 되돌리기(supabase/migrations/20261218100000_bundle16_member_notifications.sql 의 down). 계획 docs/plan-bundle16-notification-copy.md 5-5.
-- 순서(코드를 되돌리면 13번 코드가 옛 키·옛 4인자 거절 함수를 다시 쓰므로):
--   1. 키 되살리기 스크립트(supabase/scripts/20261218_bundle16_support_notification_keys_restore.sql)를 코드 되돌리기 전에 돌린다
--      (support_page_content 답변 알림 키 5개, 정리 스크립트가 지운 옛 4인자 거절 함수).
--   2. 코드 되돌리기(16번 커밋만 revert).
--   3. 이 파일(새벽, lock_timeout 3초).
-- 머리 확인: 옛 4인자 reject_point_charge_refund(uuid,uuid,text,boolean) 가 있고 권한이 postgres·service_role 뿐이어야 한다.
--   없으면 1단계를 먼저 하라고 멈춘다(새 서명을 지운 뒤 거절 함수가 하나도 없게 되는 것을 막는다).
--   회수하지 않은 공지 알림이 회원 알림 목록에 남아 있으면 멈춘다: broadcast_id 칸을 지우면 기록 표와 연결이 끊겨, 다시 적용해도
--   회수(개인정보 가림 포함)로 찾을 수 없다. 대표가 '알림' 화면에서 먼저 회수할지 정한다.
-- 지우는 것: 함수 5개·내부 검사 함수 → notifications.broadcast_id 칸(FK·인덱스와 함께) → 기록 표의 post_id FK 제약(값은 남김) → 5인자 거절 함수.
-- 남기는 것(5-5 의 4): 기록 표·가드(증빙), 설정 행과 그 쓰기 막기 정책(행이 남는 동안 대표 세션 쓰기에 열리지 않게 짝으로),
--   refund_requests.member_reject_reason 칸, 넓힌 payment_admin_actions action CHECK(지울 수 없는 refund_rejected 행이 남으므로 옛 목록으로
--   되돌리면 실패), member_withdrawal_facts·redact_member_text 의 새 칸 확장(칸과 값이 남는 동안 가릴 수 있어야 하므로).
--   확장은 허용 칸이 하나 느는 것뿐이라 옛 코드와 충돌하지 않는다. 다시 적용은 마이그레이션 5-1 의 '이미 있음' 경로를 탄다.
-- 14번과의 순서: 이 down 뒤에는 14번 down 의 머리 확인(16번 함수 이름·5인자 거절·site_board_posts 를 가리키는 다른 FK)이 통과한다.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261218100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle16_member_notifications_down$
BEGIN
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)'))
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'DOWN PRECHECK: old 4-arg reject_point_charge_refund missing or privileges differ — run the restore script first';
  END IF;
  IF to_regclass('public.member_notification_broadcasts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id')
     OR to_regprocedure('public.send_member_broadcast(uuid,uuid,text,text,text,text,uuid,integer,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 16 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_notification_broadcasts b
              WHERE b.retracted_at IS NULL
                AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.broadcast_id = b.id)) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: unretracted broadcast notifications remain — retract them first (or owner decides to keep them unlinked)';
  END IF;
END;
$precheck_bundle16_member_notifications_down$;

-- [16번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 함수(함수 5개, 내부 검사 함수)
DROP FUNCTION public.retract_member_broadcast(uuid, uuid, text, boolean, jsonb);
DROP FUNCTION public.send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb);
DROP FUNCTION public.save_member_notification_texts(uuid, integer, jsonb, jsonb);
DROP FUNCTION public.member_broadcast_preview(uuid, text);
DROP FUNCTION public.member_broadcast_recipients(text, uuid);
DROP FUNCTION public.member_notification_texts_problem(jsonb);
-- 2. notifications.broadcast_id(FK·부분 인덱스도 함께 지워진다)
ALTER TABLE public.notifications DROP COLUMN broadcast_id;
-- 3. 기록 표의 post_id FK 제약(값은 남김 — 14번 down 이 이 FK 로 멈추지 않게)
ALTER TABLE public.member_notification_broadcasts DROP CONSTRAINT member_notification_broadcasts_post_id_fkey;
-- 4. 새 거절 서명(옛 4인자는 머리 확인에서 있음을 봤다)
DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean, text);
-- [16번] 끝: 되돌림 -----------------------------------------------------------------------------------------------

DO $verify_bundle16_member_notifications_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('member_broadcast_recipients', 'member_broadcast_preview', 'save_member_notification_texts',
                                'send_member_broadcast', 'retract_member_broadcast', 'member_notification_texts_problem'))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund' AND p.pronargs = 5)
     OR to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id')
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass
                 AND c.conrelid = 'public.member_notification_broadcasts'::regclass) THEN
    RAISE EXCEPTION 'VERIFY DOWN: bundle 16 objects remain';
  END IF;
  -- 남기는 것
  IF to_regclass('public.member_notification_broadcasts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_notification_texts')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                     AND policyname = 'system_settings_member_notification_texts_no_client_write')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests' AND column_name = 'member_reject_reason')
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.payment_admin_actions'::regclass
           AND c.conname = 'payment_admin_actions_action_check') NOT LIKE '%''refund_rejected''::text%' THEN
    RAISE EXCEPTION 'VERIFY DOWN: kept objects missing';
  END IF;
END;
$verify_bundle16_member_notifications_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_down$);
SELECT pg_temp.ctx_set('src_b14_down', $rh_src_b14_down$-- 14번 묶음 되돌리기(supabase/migrations/20261217140000_bundle14_site_board.sql 의 down). 계획 docs/plan-bundle14-notice-faq.md 5-7.
-- 코드를 14번 전으로 되돌린 뒤에만 실행한다(새 코드는 표·함수가 없으면 하단 링크만 빼고, 공지·FAQ 화면은 오류가 난다).
-- 머리 확인(하나라도 어기면 멈춤):
--   ① 14번 표 2개가 있음(14번 적용 상태)
--   ② 16번 함수가 없음 — member_facing_text_pii_hits 를 부르는 16번 함수는 plpgsql 본문이라 의존성으로 잡히지 않으므로 이름으로 본다:
--      send_member_broadcast·save_member_notification_texts·retract_member_broadcast·member_broadcast_preview, 5인자 reject_point_charge_refund(16번 5-8).
--      개인정보 판정 함수를 지워 환불 거절이 실행 중에 깨지는 일을 막는다.
--   ③ site_board_posts 를 가리키는 FK 가운데 14번 판 이력 표(site_board_post_revisions)의 것이 아닌 것이 없음.
--      16번 down 은 함수와 post_id FK 를 지우고 기록 표는 증빙으로 남기므로, 기록 표가 있는 것만으로는 멈추지 않는다.
--   ④ 글이 1건이라도 있으면 대표 확인(c_allow_drop_posts = true) 전 멈춤. 지울 때 16번 기록 표에 post_id 가 남으면 그 값은 지워진 글을
--      가리키게 된다(기록 표는 가드로 고칠 수 없음) — 그래서 16번을 다시 적용할 때 FK 를 NOT VALID 로 붙인다(16번 5-1).
-- 순서: 함수 → 표 2개(가드 트리거는 표와 함께) → 가드 함수 → 설정 행.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261217140000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
-- 잠금: 14번 표만 지운다(ACCESS EXCLUSIVE, 새 표). system_settings 는 행 1개 삭제뿐.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle14_site_board_down$
DECLARE
  c_allow_drop_posts constant boolean := false;
  v_bundle16_functions text[] := ARRAY['send_member_broadcast', 'save_member_notification_texts', 'retract_member_broadcast', 'member_broadcast_preview'];
BEGIN
  IF to_regclass('public.site_board_posts') IS NULL OR to_regclass('public.site_board_post_revisions') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 14 tables missing (not the bundle 14 state)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_bundle16_functions))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund' AND p.pronargs = 5) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 16 functions exist — roll back bundle 16 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass
                AND c.conrelid <> 'public.site_board_post_revisions'::regclass) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: other foreign keys reference site_board_posts — roll back that bundle first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.site_board_posts) AND NOT c_allow_drop_posts THEN
    RAISE EXCEPTION 'DOWN PRECHECK: posts exist — owner confirms (c_allow_drop_posts)';
  END IF;
END;
$precheck_bundle14_site_board_down$;

-- [14번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 함수
DROP FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb);
DROP FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb);
DROP FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb);
DROP FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb);
DROP FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb);
DROP FUNCTION public.member_facing_text_pii_hits(text);
DROP FUNCTION public.site_board_actor_allowed(uuid);

-- 2. 표(판 이력 먼저 — 글 표를 가리킨다). 가드 트리거는 표와 함께 지워진다.
DROP TABLE public.site_board_post_revisions;
DROP TABLE public.site_board_posts;
DROP FUNCTION public.guard_site_board_post_revisions_mutation();

-- 3. 설정 행
DELETE FROM public.system_settings WHERE key = 'site_board_content';

DO $verify_bundle14_site_board_down$
BEGIN
  IF to_regclass('public.site_board_posts') IS NOT NULL OR to_regclass('public.site_board_post_revisions') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
       'site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post', 'delete_site_board_post',
       'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content') THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 14 objects remain';
  END IF;
END;
$verify_bundle14_site_board_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_b14_down$);

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료) 4개 — 대표(owner)·직원(staff)·회원(E)·예비(X).
--       모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_pool
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE;
  IF cardinality(v_pool) < 4 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(%개, 필요 4) — 실회원 id 로 대신하지 않고 멈춘다', cardinality(v_pool);
  END IF;
  PERFORM pg_temp.ctx_set('owner', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('staff', v_pool[2]::text);
  PERFORM pg_temp.ctx_set('E', v_pool[3]::text);
  PERFORM pg_temp.ctx_set('X', v_pool[4]::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 배정(@test.com 만)', jsonb_build_object('pool', cardinality(v_pool)));
END
$rh_setup$;

-- ===== 선행: 13번(M0·M1)·14번이 운영에 없으면 이 거래 안에서 원본으로 적용(있으면 건너뜀) =====
DO $rh_prereq$
DECLARE
  v_applied text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.admin_member_access_log') IS NULL THEN
    EXECUTE pg_temp.ctx('src_b13_m0');
    v_applied := v_applied || '13 M0'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content') THEN
    EXECUTE pg_temp.ctx('src_b13_m1');
    v_applied := v_applied || ('13 M1 ' || pg_temp.ctx('mode'));
  END IF;
  IF to_regclass('public.site_board_posts') IS NULL THEN
    EXECUTE pg_temp.ctx('src_b14');
    v_applied := v_applied || '14'::text;
  END IF;
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '선행 묶음(이 거래 안에서만 적용한 것)', to_jsonb(v_applied));
  -- 13번 M1 뒤 판 지문(16번 사전 점검 값)
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'setup', '16번 적용 전 재정의 대상 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p WHERE p.oid IN ('public.member_withdrawal_facts(uuid,boolean)'::regprocedure, 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure,
      'public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure);
END
$rh_prereq$;

DO $rh_before$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261218100000'), 'F0', '이력 행 없음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'F0', m FROM unnest(v_log) m;
END
$rh_before$;

-- ===== 16번 마이그레이션(원본 그대로) =====
-- 출시 전 작업 순서표 16번 묶음: 회원 알림 문구 관리 + 공지 알림 보내기(계획 docs/plan-bundle16-notification-copy.md 4판, 5절).
-- 만드는 것:
--   1. 표 member_notification_broadcasts(공지 알림 보낸 기록 — 회원을 가리키는 칸 없음, 인원 수·공개 문구·관리자 id 만).
--      RLS 켬·정책 0, PUBLIC·anon·authenticated·service_role 전부 회수 뒤 service_role 에 SELECT 만(쓰기는 아래 DEFINER 함수만).
--      가드: UPDATE 는 회수 칸(retracted_*) NULL→값과 가림(redacted_* NULL→값, 제목·내용 → 가림 문구)만, DELETE·TRUNCATE 거부.
--   2. 설정 행 system_settings.member_notification_texts(알림 12종 문구·켜기, 마켓 환불 문장 4개, 공지 알림 설정 — 있으면 그대로)와
--      쓰기 막기 RESTRICTIVE 정책(결제·환불 결과와 환불정책 약속을 담은 문구라 대표 세션 직접 UPDATE 를 막는다).
--      답변 두 종류는 적용 순간의 support_page_content(13번) 값을 복사한다(5-2 대응표).
--   3. 함수(service_role 만 EXECUTE): member_broadcast_recipients(INVOKER)·member_broadcast_preview·save_member_notification_texts·
--      send_member_broadcast·retract_member_broadcast, 내부 검사 함수 member_notification_texts_problem(아무도 EXECUTE 없음),
--      기록 표 가드 함수.
--   4. 충전 환불 거절(5-8, 결제 DB): refund_requests.member_reject_reason 칸, 거절 함수 새 서명(5인자, DEFAULT 없음 — 옛 4인자와 겹치지 않음),
--      payment_admin_actions action CHECK 에 refund_rejected, 탈퇴 가림(member_withdrawal_facts·redact_member_text)이 새 칸을 다룬다.
--      옛 4인자 거절 함수는 DB 적용~배포 사이 옛 코드가 부르므로 두고, 배포 뒤 정리 스크립트가 지운다(5-6).
--   5. notifications.broadcast_id 칸(기록 표 FK)과 부분 인덱스.
-- 기존 표에 거는 DDL(잠금): refund_requests·payment_admin_actions·notifications 는 ACCESS EXCLUSIVE(칸 추가·CHECK 다시 만들기·FK),
--   system_settings 는 정책 만들기. 모두 아래 '[16번 기존 표 DDL]' 한 구역에 모았다(리허설 light 사본은 이 구역과 그 VERIFY 블록을 뺀다).
--   새벽에 lock_timeout 3초로 한 거래에 적용한다. 잡지 못하면 전체가 취소된다.
-- 사전 점검 지문: md5(pg_get_functiondef(oid))(운영 읽기 전용 값). 13번이 다시 정의하는 두 함수는 '13번 뒤 판'(13번 계획 18-4 light 측정값) 또는
--   '16번 확장 판'(다시 적용 — md5(prosrc), 이 파일 본문에서 계산)이면 통과한다.
-- 작업 기록(admin_audit_log)에는 공지 알림 제목·내용 원문과 회원 id 를 넣지 않는다(지문·글자 수·인원 — 원문은 가릴 수 있는 기록 표).
--   예외: 문구 수정 기록(member_notification_texts_update)은 회사 공개 문구라 바뀐 경로의 before·after 원문을 남긴다(계획 4절).
-- 되돌리기: supabase/rollback/20261218100000_bundle16_member_notifications_down.sql(키 되살리기 스크립트 → 코드 되돌리기 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(5-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle16_member_notifications$
DECLARE
  v_new_functions text[] := ARRAY['member_broadcast_recipients', 'member_broadcast_preview', 'save_member_notification_texts',
    'send_member_broadcast', 'retract_member_broadcast'];
  v_support jsonb;
  v_key text;
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed';
  END IF;
  -- 14번: 개인정보 판정 함수와 공지 글 표
  IF to_regprocedure('public.member_facing_text_pii_hits(text)') IS NULL OR to_regclass('public.site_board_posts') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 14 (member_facing_text_pii_hits / site_board_posts) is not applied';
  END IF;
  -- 13번 M1 뒤 판 또는 16번 확장 판(다시 적용)
  IF to_regprocedure('public.member_withdrawal_facts(uuid,boolean)') IS NULL
     OR NOT (md5(pg_get_functiondef('public.member_withdrawal_facts(uuid,boolean)'::regprocedure)) = '05923c4df814d40b6ec81d1d53d410aa'
             OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) = 'b2db6cf4ca0c8226b17c62a3ee113e88') THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_facts is neither the bundle 13 nor the bundle 16 version';
  END IF;
  IF to_regprocedure('public.redact_member_text(uuid,text,uuid,text,text,text)') IS NULL
     OR NOT (md5(pg_get_functiondef('public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)) = '47173300ae0fa1a96cb1d45faa6da353'
             OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = 'acf0b18ba4c87a11d96dc742565cbe71') THEN
    RAISE EXCEPTION 'PRECHECK: redact_member_text is neither the bundle 13 nor the bundle 16 version';
  END IF;
  -- 재정의 두 함수의 보안 방식·권한(적용 전과 같아야 함 — VERIFY 가 다시 본다)
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS NOT FALSE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}'
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_facts / redact_member_text security or privileges changed';
  END IF;
  -- 옛 4인자 거절 함수(운영 원문 그대로) — DB 적용~배포 사이 옛 코드가 부른다
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
     OR md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) <> '20384719deba112e977fbd3bf8e266e5' THEN
    RAISE EXCEPTION 'PRECHECK: reject_point_charge_refund(uuid,uuid,text,boolean) changed or missing';
  END IF;
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 16 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id') THEN
    RAISE EXCEPTION 'PRECHECK: notifications.broadcast_id already exists';
  END IF;
  -- 첫 적용이면(설정 행 없음) 13번 M1 의 답변 알림 키 5개가 있어야 복사할 수 있다. 다시 적용(설정 행 있음)은 아래 대조 블록이 본다.
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_notification_texts') THEN
    SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content';
    IF v_support IS NULL THEN
      RAISE EXCEPTION 'PRECHECK: support_page_content (bundle 13 M1) missing';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
                                 'answerEditedNotificationMessage'] LOOP
      IF jsonb_typeof(v_support -> 'member' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_support -> 'member' ->> v_key) = '' THEN
        RAISE EXCEPTION 'PRECHECK: support_page_content.member.% missing', v_key;
      END IF;
    END LOOP;
    IF jsonb_typeof(v_support -> 'admin' -> 'notifyOnAnswerEdit') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'PRECHECK: support_page_content.admin.notifyOnAnswerEdit missing';
    END IF;
  END IF;
END;
$precheck_bundle16_member_notifications$;

-- [16번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 공지 알림 기록 표(5-3). 다시 적용(down 이 남긴 표)이면 만들기를 건너뛰고 아래 대조 블록이 칸·가드·권한을 본다. -------------------
CREATE TABLE IF NOT EXISTS public.member_notification_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL,
  target text NOT NULL CHECK (target IN ('all_members', 'self')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND btrim(title) <> '' AND strpos(title, E'\n') = 0),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500 AND btrim(message) <> ''),
  link_url text CHECK (link_url IS NULL OR char_length(link_url) BETWEEN 1 AND 200),
  post_id uuid CONSTRAINT member_notification_broadcasts_post_id_fkey REFERENCES public.site_board_posts(id),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  recipient_count integer NOT NULL CHECK (recipient_count >= 1),
  not_advertising_statement_version integer NOT NULL CHECK (not_advertising_statement_version >= 1),
  not_advertising_statement_text text NOT NULL CHECK (btrim(not_advertising_statement_text) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retracted_at timestamptz,
  retracted_by uuid,
  retract_reason_code text CHECK (retract_reason_code IS NULL OR retract_reason_code IN ('mistake', 'pii', 'wrong_target', 'other')),
  retracted_deleted_count integer CHECK (retracted_deleted_count IS NULL OR retracted_deleted_count >= 0),
  retracted_read_count integer CHECK (retracted_read_count IS NULL OR retracted_read_count >= 0),
  redacted_at timestamptz,
  redacted_by uuid,
  CONSTRAINT member_notification_broadcasts_retracted CHECK (
    (retracted_at IS NULL) = (retracted_by IS NULL) AND (retracted_at IS NULL) = (retract_reason_code IS NULL)
    AND (retracted_at IS NULL) = (retracted_deleted_count IS NULL) AND (retracted_at IS NULL) = (retracted_read_count IS NULL)),
  CONSTRAINT member_notification_broadcasts_redacted CHECK (
    (redacted_at IS NULL) = (redacted_by IS NULL) AND (redacted_at IS NULL OR retracted_at IS NOT NULL))
);
-- 상한(최근 24시간 같은 대상 수)과 목록(최신순)
CREATE INDEX IF NOT EXISTS member_notification_broadcasts_target_created ON public.member_notification_broadcasts (target, created_at);

COMMENT ON TABLE public.member_notification_broadcasts IS
  '16번: 공지 알림 보낸 기록(회원 칸 없음, 기한 없이 보관). 쓰기는 send/retract_member_broadcast 함수만, 가드가 회수·가림 칸만 고치게 한다.';

ALTER TABLE public.member_notification_broadcasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_notification_broadcasts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_notification_broadcasts TO service_role;

-- 가드: UPDATE 는 (가) 회수 칸 NULL→값(다섯 칸 함께), (나) 가림 칸 NULL→값과 제목·내용 → 지금 가림 문구(회수된 행만)만. 나머지 칸은 그대로.
CREATE OR REPLACE FUNCTION public.guard_member_notification_broadcasts_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_notification_broadcasts_mutation$
DECLARE
  v_redacted_text text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.operation_key, NEW.actor_id, NEW.target, NEW.link_url, NEW.post_id, NEW.content_sha256, NEW.recipient_count,
          NEW.not_advertising_statement_version, NEW.not_advertising_statement_text, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.operation_key, OLD.actor_id, OLD.target, OLD.link_url, OLD.post_id, OLD.content_sha256, OLD.recipient_count,
          OLD.not_advertising_statement_version, OLD.not_advertising_statement_text, OLD.created_at) THEN
    -- 회수 칸: 그대로이거나 NULL→값
    IF NOT ((NEW.retracted_at, NEW.retracted_by, NEW.retract_reason_code, NEW.retracted_deleted_count, NEW.retracted_read_count)
              IS NOT DISTINCT FROM (OLD.retracted_at, OLD.retracted_by, OLD.retract_reason_code, OLD.retracted_deleted_count, OLD.retracted_read_count)
            OR (OLD.retracted_at IS NULL AND NEW.retracted_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'MEMBER_BROADCASTS_APPEND_ONLY';
    END IF;
    -- 가림 칸: 그대로(제목·내용도 그대로)이거나 NULL→값이고 제목·내용 = 지금 가림 문구
    IF (NEW.redacted_at, NEW.redacted_by, NEW.title, NEW.message) IS NOT DISTINCT FROM (OLD.redacted_at, OLD.redacted_by, OLD.title, OLD.message) THEN
      RETURN NEW;
    END IF;
    v_redacted_text := (SELECT s.value #>> '{broadcast,redactedText}' FROM public.system_settings s WHERE s.key = 'member_notification_texts');
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.redacted_by IS NOT NULL AND NEW.retracted_at IS NOT NULL
       AND v_redacted_text IS NOT NULL AND NEW.title = v_redacted_text AND NEW.message = v_redacted_text THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'MEMBER_BROADCASTS_APPEND_ONLY';
END;
$fn_guard_member_notification_broadcasts_mutation$;
REVOKE ALL ON FUNCTION public.guard_member_notification_broadcasts_mutation() FROM PUBLIC, anon, authenticated, service_role;

DO $triggers_bundle16_broadcasts$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.member_notification_broadcasts'::regclass
                  AND t.tgname = 'guard_member_notification_broadcasts_mutation') THEN
    CREATE TRIGGER guard_member_notification_broadcasts_mutation
      BEFORE UPDATE OR DELETE ON public.member_notification_broadcasts
      FOR EACH ROW EXECUTE FUNCTION public.guard_member_notification_broadcasts_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.member_notification_broadcasts'::regclass
                  AND t.tgname = 'guard_member_notification_broadcasts_truncate') THEN
    CREATE TRIGGER guard_member_notification_broadcasts_truncate
      BEFORE TRUNCATE ON public.member_notification_broadcasts
      FOR EACH STATEMENT EXECUTE FUNCTION public.guard_member_notification_broadcasts_mutation();
  END IF;
END;
$triggers_bundle16_broadcasts$;

-- 다시 적용: down 이 지운 post_id FK 를 다시 붙인다. 지워진 글을 가리키는 값이 있으면(14번을 되돌렸다 다시 적용) NOT VALID 로 붙이고
--   그 건수를 알린다(기록 표는 가드로 고칠 수 없다).
DO $fk_bundle16_broadcasts$
DECLARE
  v_dangling integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.member_notification_broadcasts'::regclass
                  AND c.conname = 'member_notification_broadcasts_post_id_fkey') THEN
    SELECT count(*)::integer INTO v_dangling
      FROM public.member_notification_broadcasts b
     WHERE b.post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.site_board_posts p WHERE p.id = b.post_id);
    IF v_dangling > 0 THEN
      ALTER TABLE public.member_notification_broadcasts ADD CONSTRAINT member_notification_broadcasts_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES public.site_board_posts(id) NOT VALID;
      RAISE NOTICE 'member_notification_broadcasts.post_id FK added NOT VALID (% rows point to removed posts)', v_dangling;
    ELSE
      ALTER TABLE public.member_notification_broadcasts ADD CONSTRAINT member_notification_broadcasts_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES public.site_board_posts(id);
    END IF;
  END IF;
END;
$fk_bundle16_broadcasts$;

-- 2. 설정 행 구조 검사(5-2, 저장 함수·사전 대조·VERIFY 가 같이 쓴다). 문제가 없으면 NULL, 있으면 그 경로.
--    종류 키 집합·칸 이름·글자 수·끌 수 없는 종류(enabled = true, 내용에 {사유})·상한 범위. 허용 자리표시 전체 검사는 서버 액션의 TS 규칙
--    (src/lib/member-notifications.ts)이 한다(같은 규칙을 SQL 에 두 번 쓰지 않음).
CREATE OR REPLACE FUNCTION public.member_notification_texts_problem(p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_notification_texts_problem$
DECLARE
  -- 종류 키(src/lib/member-notifications.ts MEMBER_NOTIFICATION_KIND_KEYS 와 같은 목록·순서)
  v_kinds text[] := ARRAY['chargeCompleted', 'chargeRefundCompleted', 'chargeRefundBankTransfer', 'chargeRefundProviderFinalized',
    'supportAnswerCreated', 'supportAnswerEdited', 'creditGranted', 'creditRevoked', 'marketRefundApproved', 'marketRefundException',
    'marketRefundRejected', 'chargeRefundRejected'];
  -- 끌 수 없고 내용에 {사유}가 꼭 있어야 하는 종류(Q2)
  v_locked text[] := ARRAY['creditRevoked', 'marketRefundRejected', 'chargeRefundRejected'];
  -- 내용 없이 제목만 두는 종류(내용은 marketRefundMessage 문장 4개로 만든다)
  v_title_only text[] := ARRAY['marketRefundApproved', 'marketRefundException'];
  v_categories text[] := ARRAY['compensation', 'event', 'refund', 'other'];
  v_market text[] := ARRAY['base', 'reissued', 'missing', 'unknown'];
  v_broadcast text[] := ARRAY['memberLabel', 'allMembersDailyLimit', 'selfTestDailyLimit', 'notAdvertisingStatement',
    'notAdvertisingStatementVersion', 'redactedText'];
  v_kind text;
  v_item jsonb;
  v_text text;
  v_key text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN 'value';
  END IF;
  IF ARRAY(SELECT k FROM jsonb_object_keys(p_value) k ORDER BY k) <> ARRAY['broadcast', 'kinds', 'marketRefundMessage', 'revision'] THEN
    RETURN 'keys';
  END IF;
  IF jsonb_typeof(p_value -> 'revision') <> 'number' OR (p_value ->> 'revision') !~ '^[1-9][0-9]{0,8}$' THEN
    RETURN 'revision';
  END IF;
  IF jsonb_typeof(p_value -> 'kinds') <> 'object'
     OR ARRAY(SELECT k FROM jsonb_object_keys(p_value -> 'kinds') k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_kinds) k ORDER BY k) THEN
    RETURN 'kinds';
  END IF;
  FOREACH v_kind IN ARRAY v_kinds LOOP
    v_item := p_value -> 'kinds' -> v_kind;
    IF jsonb_typeof(v_item) <> 'object'
       OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k)
          <> (CASE WHEN v_kind = ANY (v_title_only) THEN ARRAY['enabled', 'title']
                   WHEN v_kind = 'creditGranted' THEN ARRAY['categoryLabels', 'enabled', 'message', 'title']
                   ELSE ARRAY['enabled', 'message', 'title'] END) THEN
      RETURN 'kinds.' || v_kind;
    END IF;
    IF jsonb_typeof(v_item -> 'enabled') <> 'boolean' OR (v_kind = ANY (v_locked) AND (v_item -> 'enabled') <> 'true'::jsonb) THEN
      RETURN 'kinds.' || v_kind || '.enabled';
    END IF;
    v_text := CASE WHEN jsonb_typeof(v_item -> 'title') = 'string' THEN v_item ->> 'title' END;
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 100 OR v_text ~ '[\r\n]' THEN
      RETURN 'kinds.' || v_kind || '.title';
    END IF;
    IF NOT v_kind = ANY (v_title_only) THEN
      v_text := CASE WHEN jsonb_typeof(v_item -> 'message') = 'string' THEN v_item ->> 'message' END;
      IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 500 OR (v_kind = ANY (v_locked) AND strpos(v_text, '{사유}') = 0) THEN
        RETURN 'kinds.' || v_kind || '.message';
      END IF;
    END IF;
  END LOOP;
  v_item := p_value #> '{kinds,creditGranted,categoryLabels}';
  IF jsonb_typeof(v_item) <> 'object' OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_categories) k ORDER BY k) THEN
    RETURN 'kinds.creditGranted.categoryLabels';
  END IF;
  FOREACH v_key IN ARRAY v_categories LOOP
    v_text := CASE WHEN jsonb_typeof(v_item -> v_key) = 'string' THEN v_item ->> v_key END;
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 20 OR v_text ~ '[\r\n]' THEN
      RETURN 'kinds.creditGranted.categoryLabels.' || v_key;
    END IF;
  END LOOP;
  v_item := p_value -> 'marketRefundMessage';
  IF jsonb_typeof(v_item) <> 'object' OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_market) k ORDER BY k) THEN
    RETURN 'marketRefundMessage';
  END IF;
  FOREACH v_key IN ARRAY v_market LOOP
    v_text := CASE WHEN jsonb_typeof(v_item -> v_key) = 'string' THEN v_item ->> v_key END;
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RETURN 'marketRefundMessage.' || v_key;
    END IF;
  END LOOP;
  v_item := p_value -> 'broadcast';
  IF jsonb_typeof(v_item) <> 'object' OR ARRAY(SELECT k FROM jsonb_object_keys(v_item) k ORDER BY k) <> ARRAY(SELECT k FROM unnest(v_broadcast) k ORDER BY k) THEN
    RETURN 'broadcast';
  END IF;
  v_text := CASE WHEN jsonb_typeof(v_item -> 'memberLabel') = 'string' THEN v_item ->> 'memberLabel' END;
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 10 OR v_text ~ '[\r\n]' THEN
    RETURN 'broadcast.memberLabel';
  END IF;
  IF jsonb_typeof(v_item -> 'allMembersDailyLimit') <> 'number' OR (v_item ->> 'allMembersDailyLimit') !~ '^[1-5]$' THEN
    RETURN 'broadcast.allMembersDailyLimit';
  END IF;
  IF jsonb_typeof(v_item -> 'selfTestDailyLimit') <> 'number' OR (v_item ->> 'selfTestDailyLimit') !~ '^([1-9]|[1-4][0-9]|50)$' THEN
    RETURN 'broadcast.selfTestDailyLimit';
  END IF;
  v_text := CASE WHEN jsonb_typeof(v_item -> 'notAdvertisingStatement') = 'string' THEN v_item ->> 'notAdvertisingStatement' END;
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 500 THEN
    RETURN 'broadcast.notAdvertisingStatement';
  END IF;
  IF jsonb_typeof(v_item -> 'notAdvertisingStatementVersion') <> 'number' OR (v_item ->> 'notAdvertisingStatementVersion') !~ '^[1-9][0-9]{0,8}$' THEN
    RETURN 'broadcast.notAdvertisingStatementVersion';
  END IF;
  -- 가림 문구는 기록 표 제목 칸(60자·한 줄)에 들어간다
  v_text := CASE WHEN jsonb_typeof(v_item -> 'redactedText') = 'string' THEN v_item ->> 'redactedText' END;
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 60 OR v_text ~ '[\r\n]' THEN
    RETURN 'broadcast.redactedText';
  END IF;
  RETURN NULL;
END;
$fn_member_notification_texts_problem$;
REVOKE ALL ON FUNCTION public.member_notification_texts_problem(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 설정 행(5-2, 11절 초안) — 첫 값은 지금 운영 글 그대로, 답변 두 종류는 support_page_content 값 복사. 대표가 관리자 '알림' 화면에서 고친다. ---
--    마켓 거절의 옛 빈 사유 대체 문구는 넣지 않는다(사유 없이 보내는 길이 없음, Q2).
INSERT INTO public.system_settings (key, value, description)
SELECT 'member_notification_texts',
       jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(seed.value,
         '{kinds,supportAnswerCreated,title}', s.value #> '{member,answerCreatedNotificationTitle}'),
         '{kinds,supportAnswerCreated,message}', s.value #> '{member,answerCreatedNotificationMessage}'),
         '{kinds,supportAnswerEdited,title}', s.value #> '{member,answerEditedNotificationTitle}'),
         '{kinds,supportAnswerEdited,message}', s.value #> '{member,answerEditedNotificationMessage}'),
         '{kinds,supportAnswerEdited,enabled}', s.value #> '{admin,notifyOnAnswerEdit}'),
       '16번: 회원 알림 문구·켜기·공지 알림 설정(저장은 save_member_notification_texts 만, 대표 세션 직접 쓰기 막힘)'
  FROM (SELECT $json_member_notification_texts$
{
  "revision": 1,
  "kinds": {
    "chargeCompleted": { "enabled": true, "title": "크레딧 충전 완료", "message": "결제가 확인되어 크레딧이 충전되었습니다." },
    "chargeRefundCompleted": { "enabled": true, "title": "원 결제수단 환불이 완료되었습니다", "message": "{금액}원 결제 취소가 완료되었습니다. 환불 반영 시점은 결제수단에 따라 다를 수 있습니다." },
    "chargeRefundBankTransfer": { "enabled": true, "title": "환불이 완료되었습니다", "message": "{금액}원을 계좌로 환불했습니다." },
    "chargeRefundProviderFinalized": { "enabled": true, "title": "환불 완료", "message": "결제 취소가 확인되어 환불이 완료되었습니다." },
    "supportAnswerCreated": { "enabled": true, "title": "(복사)", "message": "(복사)" },
    "supportAnswerEdited": { "enabled": true, "title": "(복사)", "message": "(복사)" },
    "creditGranted": {
      "enabled": true,
      "title": "크레딧이 지급되었습니다",
      "message": "{분류} 사유로 {수량} 크레딧이 지급되었습니다. (내용: {내용})",
      "categoryLabels": { "compensation": "보상", "event": "이벤트", "refund": "환불", "other": "기타" }
    },
    "creditRevoked": { "enabled": true, "title": "크레딧이 회수되었습니다", "message": "잘못 지급된 크레딧 {수량}개가 회수되었습니다. (사유: {사유})" },
    "marketRefundApproved": { "enabled": true, "title": "문제마켓 환불이 승인되었습니다" },
    "marketRefundException": { "enabled": true, "title": "문제마켓 환불이 처리되었습니다" },
    "marketRefundRejected": { "enabled": true, "title": "문제마켓 환불 요청이 거절되었습니다", "message": "환불 요청이 승인되지 않았습니다. 사유: {사유}" },
    "chargeRefundRejected": { "enabled": true, "title": "충전 환불 요청이 거절되었습니다", "message": "환불 요청이 승인되지 않았습니다. 사유: {사유}" }
  },
  "marketRefundMessage": {
    "base": "{수량} 크레딧이 돌아왔습니다.",
    "reissued": "그중 {수량} 크레딧은 새 유효기간으로 다시 지급되었습니다(만료일은 크레딧 관리에서 확인해 주세요).",
    "missing": "나머지 {수량} 크레딧은 결제에 쓴 크레딧의 사정(충전 환불 이력 등)으로 돌려드리지 못했습니다. 자세한 내용은 고객센터로 문의해 주세요.",
    "unknown": "크레딧 복구 내역은 크레딧 관리에서 확인해 주세요."
  },
  "broadcast": {
    "memberLabel": "공지",
    "allMembersDailyLimit": 1,
    "selfTestDailyLimit": 10,
    "notAdvertisingStatement": "이 알림은 약관·정책 변경, 장애·점검, 결제·환불 절차 변경 같은 서비스 이용 안내입니다. 새 자료 출시·이벤트·할인·쿠폰·가격 안내가 아니며, 그런 글이나 판매·충전 화면으로 연결하지 않습니다.",
    "notAdvertisingStatementVersion": 1,
    "redactedText": "개인정보가 포함되어 가린 알림입니다."
  }
}
$json_member_notification_texts$::jsonb AS value) seed
  CROSS JOIN public.system_settings s
 WHERE s.key = 'support_page_content'
   AND NOT EXISTS (SELECT 1 FROM public.system_settings x WHERE x.key = 'member_notification_texts');

-- 다시 적용·첫 적용 공통 대조(5-1): 설정 행 구조 검사, 답변 두 종류 = 지금 support_page_content 값(키가 있을 때만 — 정리 뒤면 키가 없다).
--   다르면 멈추고 대표가 어느 글을 쓸지 정한다.
DO $copy_check_bundle16_member_notifications$
DECLARE
  v_value jsonb := (SELECT value FROM public.system_settings WHERE key = 'member_notification_texts');
  v_support jsonb := (SELECT value FROM public.system_settings WHERE key = 'support_page_content');
  v_pair text[];
  v_problem text;
BEGIN
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: member_notification_texts row missing (support_page_content not found)';
  END IF;
  v_problem := public.member_notification_texts_problem(v_value);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: member_notification_texts shape invalid at %', v_problem;
  END IF;
  -- 5-2 대응표: support_page_content 경로 ↔ member_notification_texts 경로
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['{member,answerCreatedNotificationTitle}', '{kinds,supportAnswerCreated,title}'],
    ARRAY['{member,answerCreatedNotificationMessage}', '{kinds,supportAnswerCreated,message}'],
    ARRAY['{member,answerEditedNotificationTitle}', '{kinds,supportAnswerEdited,title}'],
    ARRAY['{member,answerEditedNotificationMessage}', '{kinds,supportAnswerEdited,message}'],
    ARRAY['{admin,notifyOnAnswerEdit}', '{kinds,supportAnswerEdited,enabled}']] LOOP
    IF v_support #> v_pair[1]::text[] IS NOT NULL AND v_support #> v_pair[1]::text[] IS DISTINCT FROM v_value #> v_pair[2]::text[] THEN
      RAISE EXCEPTION 'PRECHECK: support_page_content % differs from member_notification_texts % — owner decides which text to keep', v_pair[1], v_pair[2];
    END IF;
  END LOOP;
END;
$copy_check_bundle16_member_notifications$;

-- 4. 함수(5-4) ----------------------------------------------------------------------------------------------------
-- 4-1. 받는 사람(SECURITY INVOKER — 보내기·미리보기 함수 안에서만 쓴다. 회원 id 목록이라 anon·authenticated EXECUTE 를 반드시 회수).
--      all_members = 가입을 마친 회원(탈퇴·관리자 제외, 이용 제한·로그인 차단 회원 포함), self = 행위자 본인.
CREATE FUNCTION public.member_broadcast_recipients(p_target text, p_actor_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_broadcast_recipients$
  SELECT p.id
    FROM public.profiles p
   WHERE p_target = 'all_members'
     AND p.signup_completed IS TRUE
     AND p.withdrawn_at IS NULL
     AND NOT COALESCE(p.is_admin, false)
  UNION ALL
  SELECT p_actor_id
   WHERE p_target = 'self' AND p_actor_id IS NOT NULL
$fn_member_broadcast_recipients$;

-- 4-2. 미리보기(대표만): 인원·오늘(최근 24시간) 남은 횟수·다음 가능 시각·지금 경계 문장 판. 쓰기는 없지만 clock_timestamp() 를 쓰므로
--      VOLATILE(기본값)로 둔다.
CREATE FUNCTION public.member_broadcast_preview(p_actor_id uuid, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_broadcast_preview$
DECLARE
  v_settings jsonb;
  v_limit integer;
  v_used integer;
  v_next timestamptz;
  v_count integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER';
  END IF;
  IF p_target IS NULL OR p_target NOT IN ('all_members', 'self') THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:target';
  END IF;
  SELECT s.value -> 'broadcast' INTO v_settings FROM public.system_settings s WHERE s.key = 'member_notification_texts';
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
  END IF;
  v_limit := (v_settings ->> CASE WHEN p_target = 'all_members' THEN 'allMembersDailyLimit' ELSE 'selfTestDailyLimit' END)::integer;
  SELECT count(*)::integer INTO v_used
    FROM public.member_notification_broadcasts b
   WHERE b.target = p_target AND b.created_at > clock_timestamp() - interval '24 hours';
  -- 다음 가능 시각: 창 안의 오래된 순으로 (쓴 수 - 상한)번째 행이 24시간을 넘는 때
  IF v_used >= v_limit THEN
    SELECT b.created_at + interval '24 hours' INTO v_next
      FROM public.member_notification_broadcasts b
     WHERE b.target = p_target AND b.created_at > clock_timestamp() - interval '24 hours'
     ORDER BY b.created_at
     OFFSET v_used - v_limit
     LIMIT 1;
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.member_broadcast_recipients(p_target, p_actor_id);
  RETURN jsonb_build_object(
    'target', p_target,
    'recipientCount', v_count,
    'dailyLimit', v_limit,
    'usedInWindow', v_used,
    'remaining', GREATEST(v_limit - v_used, 0),
    'nextAvailableAt', v_next,
    'notAdvertisingStatementVersion', (v_settings ->> 'notAdvertisingStatementVersion')::integer);
END;
$fn_member_broadcast_preview$;

-- 4-3. 문구 저장(대표만): 판 비교, 구조 검사(종류 키 집합·끌 수 없는 종류·{사유}·길이·상한), 모든 문구 개인정보 검사.
--      경계 문장이 바뀌면 판을 함수가 올린다(보낸 값은 무시). 바뀌면 revision + 1, 기록에 바뀐 모든 경로의 before·after 원문(계획 4절 예외).
CREATE FUNCTION public.save_member_notification_texts(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_member_notification_texts$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_revision integer;
  v_old_version integer;
  v_new_version integer;
  v_statement_changed boolean;
  v_problem text;
  v_hits text[] := ARRAY[]::text[];
  v_changes jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_INPUT_INVALID:request';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_ACTOR_NOT_OWNER';
  END IF;
  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'member_notification_texts' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
  END IF;
  v_revision := (v_old ->> 'revision')::integer;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_REVISION_CONFLICT';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'broadcast') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_INPUT_INVALID:value';
  END IF;

  -- 경계 문장 판은 함수가 정한다: 문장이 바뀌면 지금 판 + 1, 아니면 지금 판.
  v_old_version := (v_old #>> '{broadcast,notAdvertisingStatementVersion}')::integer;
  v_statement_changed := (p_value #> '{broadcast,notAdvertisingStatement}') IS DISTINCT FROM (v_old #> '{broadcast,notAdvertisingStatement}');
  v_new_version := v_old_version + CASE WHEN v_statement_changed THEN 1 ELSE 0 END;
  v_new := jsonb_set(jsonb_set(p_value, '{revision}', to_jsonb(v_revision)), '{broadcast,notAdvertisingStatementVersion}', to_jsonb(v_new_version));

  v_problem := public.member_notification_texts_problem(v_new);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_INPUT_INVALID:%', v_problem;
  END IF;

  -- 회원에게 가는 모든 글(문구·분류 이름·문장·머리표·경계 문장·가림 문구)의 개인정보 모양(종류만 돌려줌)
  SELECT COALESCE(array_agg(DISTINCT h ORDER BY h), ARRAY[]::text[]) INTO v_hits
    FROM jsonb_path_query(v_new, '$.** ? (@.type() == "string")') s,
         unnest(public.member_facing_text_pii_hits(s #>> '{}')) h;
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_PII_SUSPECTED:%', array_to_string(v_hits, ',');
  END IF;

  IF (v_new - 'revision') = (v_old - 'revision') THEN
    RETURN jsonb_build_object('changed', false, 'revision', v_revision);
  END IF;

  -- 바뀐 모든 잎 경로(kinds·categoryLabels·marketRefundMessage·broadcast)의 before·after
  WITH RECURSIVE old_leaves(path, v) AS (
    SELECT e.key, e.value FROM jsonb_each(v_old - 'revision') e
    UNION ALL
    SELECT l.path || '.' || c.key, c.value FROM old_leaves l, jsonb_each(l.v) c WHERE jsonb_typeof(l.v) = 'object'
  ), new_leaves(path, v) AS (
    SELECT e.key, e.value FROM jsonb_each(v_new - 'revision') e
    UNION ALL
    SELECT l.path || '.' || c.key, c.value FROM new_leaves l, jsonb_each(l.v) c WHERE jsonb_typeof(l.v) = 'object'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('path', COALESCE(o.path, n.path), 'before', o.v, 'after', n.v)
                            ORDER BY COALESCE(o.path, n.path)), '[]'::jsonb)
    INTO v_changes
    FROM (SELECT * FROM old_leaves WHERE jsonb_typeof(v) <> 'object') o
    FULL JOIN (SELECT * FROM new_leaves WHERE jsonb_typeof(v) <> 'object') n ON n.path = o.path
   WHERE o.v IS DISTINCT FROM n.v;

  v_new := jsonb_set(v_new, '{revision}', to_jsonb(v_revision + 1));
  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'member_notification_texts';

  PERFORM public.record_admin_audit(p_actor_id, 'member_notification_texts_update', 'system_settings', 'member_notification_texts', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_revision,
      'revision_after', v_revision + 1,
      'changes', v_changes,
      'statement_version_before', v_old_version,
      'statement_version_after', v_new_version,
      'statement_before', CASE WHEN v_statement_changed THEN v_old #>> '{broadcast,notAdvertisingStatement}' END,
      'statement_after', CASE WHEN v_statement_changed THEN v_new #>> '{broadcast,notAdvertisingStatement}' END,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'revision', v_revision + 1, 'statementVersion', v_new_version);
END;
$fn_save_member_notification_texts$;

-- 4-4. 공지 알림 보내기(대표만). 순서(10-1 단언): 대표·경계 판 → 입력·링크·개인정보 → advisory lock → 같은 operation_key(재요청) → 상한 →
--      받는 사람 한 번 뽑기·인원 대조 → 기록 행 → 알림 INSERT(같은 배열) → 작업 기록(원문·회원 id 없음).
--      링크 허용 꼴(src/lib/member-notifications.ts BROADCAST_LINK_FORMS 와 같은 목록): 없음, /notices, /notices/{게시 중인 공지 uuid}(= p_post_id),
--      /faq, /faq#{uuid}, /terms, /terms/upcoming, /terms/{하단 정보에 켜진 문서 slug}. 쿼리·그 밖의 # 는 받지 않는다.
CREATE FUNCTION public.send_member_broadcast(p_actor_id uuid, p_operation_key uuid, p_target text, p_title text, p_message text,
  p_link_url text, p_post_id uuid, p_expected_count integer, p_not_advertising_version integer, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_send_member_broadcast$
DECLARE
  c_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_settings jsonb;
  v_version integer;
  v_statement text;
  v_title text := regexp_replace(replace(replace(COALESCE(p_title, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_message text := regexp_replace(replace(replace(COALESCE(p_message, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_link text := NULLIF(btrim(COALESCE(p_link_url, '')), '');
  v_hits text[];
  v_sha text;
  v_existing public.member_notification_broadcasts%ROWTYPE;
  v_limit integer;
  v_used integer;
  v_next timestamptz;
  v_recipients uuid[];
  v_count integer;
  v_inserted integer;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:request';
  END IF;
  -- 1. 대표·경계 문장 판
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER';
  END IF;
  SELECT s.value -> 'broadcast' INTO v_settings FROM public.system_settings s WHERE s.key = 'member_notification_texts';
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
  END IF;
  v_version := (v_settings ->> 'notAdvertisingStatementVersion')::integer;
  v_statement := v_settings ->> 'notAdvertisingStatement';
  IF p_not_advertising_version IS NULL OR p_not_advertising_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'BROADCAST_CONFIRM_REQUIRED';
  END IF;

  -- 2. 입력·링크·개인정보
  IF p_operation_key IS NULL THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:operationKey';
  END IF;
  IF p_target IS NULL OR p_target NOT IN ('all_members', 'self') THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:target';
  END IF;
  IF v_title = '' OR char_length(v_title) > 60 OR strpos(v_title, E'\n') > 0 THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:title';
  END IF;
  IF v_message = '' OR char_length(v_message) > 500 THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:message';
  END IF;
  IF p_post_id IS NOT NULL AND v_link IS DISTINCT FROM '/notices/' || p_post_id::text THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:linkUrl';
  END IF;
  IF v_link IS NOT NULL AND NOT (
       v_link IN ('/notices', '/faq', '/terms', '/terms/upcoming')
       OR (v_link ~ ('^/notices/' || c_uuid || '$') AND p_post_id IS NOT NULL)
       OR v_link ~ ('^/faq#' || c_uuid || '$')
       OR (v_link ~ '^/terms/[a-z0-9][a-z0-9-]{0,49}$'
           AND EXISTS (SELECT 1 FROM public.system_settings s, jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'policyDocuments') = 'object'
                                                                             THEN s.value -> 'policyDocuments' ELSE '{}'::jsonb END) d
                        WHERE s.key = 'site_footer_content' AND d.value ->> 'slug' = substr(v_link, 8)
                          AND d.value -> 'enabled' = 'true'::jsonb AND btrim(COALESCE(d.value ->> 'content', '')) <> ''))) THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:linkUrl';
  END IF;
  IF p_post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.site_board_posts sp
                                            WHERE sp.id = p_post_id AND sp.board = 'notice' AND sp.is_published AND sp.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:postId';
  END IF;
  IF p_expected_count IS NULL OR p_expected_count < 1 THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:expectedCount';
  END IF;
  v_hits := public.member_facing_text_pii_hits(v_title) || public.member_facing_text_pii_hits(v_message);
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'BROADCAST_PII_SUSPECTED:%', array_to_string(ARRAY(SELECT DISTINCT h FROM unnest(v_hits) h ORDER BY h), ',');
  END IF;
  v_sha := encode(sha256(convert_to(jsonb_build_array(p_target, v_title, v_message, v_link, p_post_id)::text, 'UTF8')), 'hex');

  -- 3. 잠금 → 같은 operation_key(동시 두 요청도 뒤쪽이 이 자리에서 앞쪽 결과를 본다)
  PERFORM pg_advisory_xact_lock(hashtext('member_broadcast'));
  SELECT * INTO v_existing FROM public.member_notification_broadcasts b WHERE b.operation_key = p_operation_key;
  IF FOUND THEN
    IF v_existing.content_sha256 = v_sha AND v_existing.target = p_target AND v_existing.actor_id = p_actor_id THEN
      RETURN jsonb_build_object('broadcast_id', v_existing.id, 'recipient_count', v_existing.recipient_count, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'BROADCAST_IDEMPOTENCY_CONFLICT';
  END IF;

  -- 4. 상한: 같은 대상의 최근 24시간 보내기 수(회수한 것 포함)
  v_limit := (v_settings ->> CASE WHEN p_target = 'all_members' THEN 'allMembersDailyLimit' ELSE 'selfTestDailyLimit' END)::integer;
  SELECT count(*)::integer INTO v_used
    FROM public.member_notification_broadcasts b
   WHERE b.target = p_target AND b.created_at > v_now - interval '24 hours';
  IF v_used >= v_limit THEN
    SELECT b.created_at + interval '24 hours' INTO v_next
      FROM public.member_notification_broadcasts b
     WHERE b.target = p_target AND b.created_at > v_now - interval '24 hours'
     ORDER BY b.created_at
     OFFSET v_used - v_limit
     LIMIT 1;
    RAISE EXCEPTION 'BROADCAST_RATE_LIMITED:%', to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;

  -- 5. 받는 사람을 한 번만 뽑아 세고, 같은 배열로 넣는다
  v_recipients := ARRAY(SELECT r FROM public.member_broadcast_recipients(p_target, p_actor_id) r);
  v_count := cardinality(v_recipients);
  IF v_count <> p_expected_count THEN
    RAISE EXCEPTION 'BROADCAST_COUNT_CHANGED:%', v_count;
  END IF;

  -- 6. 기록 행 → 알림
  INSERT INTO public.member_notification_broadcasts (operation_key, actor_id, target, title, message, link_url, post_id, content_sha256,
    recipient_count, not_advertising_statement_version, not_advertising_statement_text, created_at)
  VALUES (p_operation_key, p_actor_id, p_target, v_title, v_message, v_link, p_post_id, v_sha, v_count, v_version, v_statement, v_now)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, is_read, broadcast_id)
  SELECT r, 'announcement', v_title, v_message, v_link, false, v_id FROM unnest(v_recipients) r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- 그 사이 탈퇴로 트리거가 버린 행이 있으면 인원이 어긋난다 — 전체 취소
  IF v_inserted <> v_count THEN
    RAISE EXCEPTION 'BROADCAST_COUNT_CHANGED:%', v_inserted;
  END IF;

  -- 7. 작업 기록(제목·내용 원문과 회원 id 없음)
  PERFORM public.record_admin_audit(p_actor_id, 'member_broadcast_send', 'member_notification_broadcast', v_id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'broadcast_id', v_id,
      'target', p_target,
      'recipient_count', v_count,
      'content_sha256', v_sha,
      'title_length', char_length(v_title),
      'message_length', char_length(v_message),
      'link_url', v_link,
      'post_id', p_post_id,
      'not_advertising_statement_version', v_version,
      'request', p_request_meta,
      'saved_at', v_now),
    p_operation_key::text);

  RETURN jsonb_build_object('broadcast_id', v_id, 'recipient_count', v_count, 'replayed', false);
END;
$fn_send_member_broadcast$;

-- 4-5. 회수(대표만): 읽은 수를 센 뒤 모든 회원의 알림 목록에서 지운다. 개인정보면 기록 표의 제목·내용도 가림 문구로(되돌릴 수 없음).
--      이미 회수한 기록은 그대로(가림만 새로 요청하면 가림). 사유는 정해진 코드만(자유 글 없음).
CREATE FUNCTION public.retract_member_broadcast(p_actor_id uuid, p_broadcast_id uuid, p_reason_code text, p_redact boolean, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_retract_member_broadcast$
DECLARE
  v_old public.member_notification_broadcasts%ROWTYPE;
  v_text text;
  v_read integer := NULL;
  v_deleted integer := NULL;
  v_retract boolean;
  v_redact boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:request';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER';
  END IF;
  IF p_broadcast_id IS NULL THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:id';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('mistake', 'pii', 'wrong_target', 'other') THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:reasonCode';
  END IF;
  -- 개인정보가 들어간 알림은 가림도 함께(화면도 같은 규칙)
  IF p_redact IS NULL OR (p_reason_code = 'pii' AND NOT p_redact) THEN
    RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:redact';
  END IF;

  SELECT * INTO v_old FROM public.member_notification_broadcasts b WHERE b.id = p_broadcast_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BROADCAST_NOT_FOUND';
  END IF;
  v_retract := v_old.retracted_at IS NULL;
  v_redact := p_redact AND v_old.redacted_at IS NULL;
  IF NOT v_retract AND NOT v_redact THEN
    RETURN jsonb_build_object('changed', false, 'broadcast_id', v_old.id);
  END IF;

  IF v_redact THEN
    v_text := (SELECT s.value #>> '{broadcast,redactedText}' FROM public.system_settings s WHERE s.key = 'member_notification_texts');
    IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 60 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'MEMBER_NOTIFICATION_TEXTS_MISSING';
    END IF;
  END IF;

  IF v_retract THEN
    SELECT count(*) FILTER (WHERE n.is_read IS TRUE)::integer INTO v_read FROM public.notifications n WHERE n.broadcast_id = v_old.id;
    DELETE FROM public.notifications n WHERE n.broadcast_id = v_old.id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    UPDATE public.member_notification_broadcasts
       SET retracted_at = v_now, retracted_by = p_actor_id, retract_reason_code = p_reason_code,
           retracted_deleted_count = v_deleted, retracted_read_count = v_read
     WHERE id = v_old.id;
  END IF;
  IF v_redact THEN
    UPDATE public.member_notification_broadcasts
       SET title = v_text, message = v_text, redacted_at = v_now, redacted_by = p_actor_id
     WHERE id = v_old.id;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'member_broadcast_retract', 'member_notification_broadcast', v_old.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'broadcast_id', v_old.id,
      'reason_code', p_reason_code,
      'retracted', v_retract,
      'deleted_count', v_deleted,
      'read_count', v_read,
      'redacted', v_redact,
      'request', p_request_meta,
      'retracted_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'broadcast_id', v_old.id, 'retracted', v_retract, 'redacted', v_redact,
    'deleted_count', v_deleted, 'read_count', v_read);
END;
$fn_retract_member_broadcast$;

-- 4-6. 충전 환불 거절 새 서명(5-8). 어떤 인자에도 DEFAULT 가 없다 — 옛 코드의 이름 붙은 4인자 호출은 옛 함수 하나에만, 새 코드의 5인자 호출은
--      이 함수 하나에만 맞는다(PGRST203 없음). 옛 함수의 검사·상태 변경을 그대로 하고(결제사 취소 흔적이면 거절 불가 — 돈 흐름 그대로),
--      회원에게 보낼 거절 사유(1~300자, 개인정보·긴 숫자 거절)를 같은 거래에서 member_reject_reason 에 쓴다. 모든 거절에 처리 기록 1행:
--      수동 확인 건은 지금 그대로(note = 처리 메모) + member_reason_length, 보통 거절은 action refund_rejected·note 고정 표지(회원 사유·메모 글자 없음).
--      돌려주는 값: 받는 회원 id 와 저장한 사유(다듬은 값 — 알림과 실패 안내가 증빙과 같은 글을 쓰게).
CREATE FUNCTION public.reject_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_provider_not_cancelled_confirmed boolean,
  p_member_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_reject_point_charge_refund_v16$
DECLARE
  -- 보통 거절 처리 기록의 note(규칙 값 — 회원·관리자 글이 아님)
  c_rejected_note constant text := 'refund_rejected';
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_reason text := regexp_replace(replace(replace(COALESCE(p_member_reason, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'REFUND_REJECT_ACTOR_REQUIRED';
  END IF;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_request.status NOT IN ('pending_review', 'manual_review') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;
  END IF;

  -- 결제사에서 취소된 흔적이 있으면 거절해서 크레딧 동결을 풀면 안 된다.
  IF v_request.origin <> 'user'
     OR v_order.canceled_at IS NOT NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR (v_order.provider = 'kakaopay' AND v_ppt.provider_status = 'CANCEL_PAYMENT')
     OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  IF v_request.status = 'manual_review'
     AND (p_provider_not_cancelled_confirmed IS NOT TRUE
          OR NULLIF(BTRIM(p_admin_note), '') IS NULL) THEN
    RAISE EXCEPTION 'REFUND_REJECT_CONFIRMATION_REQUIRED';
  END IF;

  -- [16번] 회원에게 보낼 거절 사유(환불정책 3-2 ⑦ — 거절할 때는 언제나 사유를 알린다)
  IF v_reason = '' OR char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_REQUIRED';
  END IF;
  IF cardinality(public.member_facing_text_pii_hits(v_reason)) > 0 THEN
    RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_PII';
  END IF;
  -- 계좌번호·카드번호 같은 긴 숫자는 받지 않는다(알림 표는 가림 대상이 아니다 — 01-11 처리방침의 환불 계좌 파기 약속)
  IF public.member_text_has_long_number(v_reason) THEN
    RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_LONG_NUMBER';
  END IF;

  UPDATE public.credit_sources
     SET status = 'active'
   WHERE id = v_request.source_id
     AND status = 'pending_refund';

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = p_admin_note,
         member_reject_reason = v_reason,
         processed_by = p_admin_id,
         processed_at = now()
   WHERE id = v_request.id;

  IF v_request.status = 'manual_review' THEN
    INSERT INTO public.payment_admin_actions (
      actor_id,
      action,
      payment_order_id,
      refund_request_id,
      before_state,
      after_state,
      note,
      details
    ) VALUES (
      p_admin_id,
      'manual_review_refund_rejected',
      v_order.id,
      v_request.id,
      jsonb_build_object('request_status', v_request.status, 'source_status', v_source.status),
      jsonb_build_object('request_status', 'rejected', 'source_status', 'active'),
      p_admin_note,
      jsonb_build_object('provider_not_cancelled_confirmed', true, 'last_error_code', v_request.last_error_code,
                         'member_reason_length', char_length(v_reason))
    );
  ELSE
    INSERT INTO public.payment_admin_actions (
      actor_id,
      action,
      payment_order_id,
      refund_request_id,
      before_state,
      after_state,
      note,
      details
    ) VALUES (
      p_admin_id,
      'refund_rejected',
      v_order.id,
      v_request.id,
      jsonb_build_object('request_status', v_request.status, 'source_status', v_source.status),
      jsonb_build_object('request_status', 'rejected', 'source_status', 'active'),
      c_rejected_note,
      jsonb_build_object('member_reason_length', char_length(v_reason), 'admin_note_present', NULLIF(BTRIM(p_admin_note), '') IS NOT NULL)
    );
  END IF;

  RETURN jsonb_build_object('user_id', v_request.user_id, 'member_reject_reason', v_reason);
END;
$fn_reject_point_charge_refund_v16$;

-- 4-7. 탈퇴 가림(5-8): 13번 뒤 판 그대로에 '-- [16번]' 줄만 바꿨다. 보안 방식·권한(EXECUTE)은 CREATE OR REPLACE 가 그대로 둔다
--      (member_withdrawal_facts = INVOKER·postgres 만, redact_member_text = DEFINER·postgres·service_role — GRANT 하지 않는다).
-- 4-7-1. member_withdrawal_facts: refund_requests 의 긴 숫자 판정에 member_reject_reason.
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  -- [13번] (가) 계좌 요청 시각: 지금 답변과 답변 수정 이력(그때 회원이 보던 글·보이기 시작한 시각)을 함께 본다.
  SELECT min(x.at) INTO v_account_at
    FROM (SELECT t.responded_at AS at
            FROM public.support_tickets t
           WHERE t.user_id = p_user_id
             AND t.responded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0)
          UNION ALL
          SELECT ar.previous_shown_at
            FROM public.support_ticket_answer_revisions ar
            JOIN public.support_tickets t ON t.id = ar.ticket_id
           WHERE t.user_id = p_user_id
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(ar.previous_response, k) > 0)) x;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at)) -- [13번] (다) 답변 수정 시각
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at, t.response_edited_at), '-infinity'::timestamptz)) AS reviewed -- [13번] 수정 시각
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      -- [13번] (나) 답변 수정 이력: 부모 문의의 환불 관련·계좌 요청 뒤, 이전 답변·수정 사유의 긴 숫자
      UNION ALL
      SELECT 'support_ticket_answer_revision', ar.id, ar.created_at,
             left(regexp_replace(COALESCE(tk.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(ar.previous_response) OR public.member_text_has_long_number(ar.reason) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_answer_revisions ar
        JOIN tk ON tk.id = ar.ticket_id
       WHERE ar.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note)
              OR public.member_text_has_long_number(rr.member_reject_reason)) -- [16번] 회원에게 보낸 거절 사유
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;
-- 4-7-2. redact_member_text: refund_request 허용 칸에 member_reject_reason.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind = 'support_ticket_answer_revision' AND p_field IN ('previous_response', 'reason')) -- [13번]
             OR (p_target_kind = 'refund_request' AND p_field IN ('reason', 'admin_note', 'member_reject_reason')) -- [16번] 회원에게 보낸 거절 사유
             OR (p_target_kind = 'market_refund_request' AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  -- [13번] 답변 수정 이력: 관리자 이벤트 가림은 수정 이력처럼 부모 문의 기준
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id
     WHERE ar.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_answer_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;
-- 4-8. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.member_broadcast_recipients(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_broadcast_preview(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_member_notification_texts(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retract_member_broadcast(uuid, uuid, text, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_broadcast_recipients(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_broadcast_preview(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_member_notification_texts(uuid, integer, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.retract_member_broadcast(uuid, uuid, text, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean, text) TO service_role;

-- 5. VERIFY(5-5) — 새 물건·설정 행·함수 ---------------------------------------------------------------------------------
DO $verify_bundle16_member_notifications$
DECLARE
  v_rel text := 'public.member_notification_broadcasts';
  v_fn text;
  v_value jsonb;
  v_support jsonb;
  v_functions text[] := ARRAY[
    'public.member_broadcast_recipients(text,uuid)',
    'public.member_broadcast_preview(uuid,text)',
    'public.save_member_notification_texts(uuid,integer,jsonb,jsonb)',
    'public.send_member_broadcast(uuid,uuid,text,text,text,text,uuid,integer,integer,jsonb)',
    'public.retract_member_broadcast(uuid,uuid,text,boolean,jsonb)',
    'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'];
BEGIN
  -- 기록 표: RLS·정책 0·권한 = service_role SELECT 만
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = to_regclass(v_rel)) <> 0
     OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass(v_rel) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'VERIFY: member_notification_broadcasts table / RLS / privileges';
  END IF;
  -- 칸(회원을 가리키는 칸 없음)·가드 트리거 2개·post_id FK(site_board_posts)
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = to_regclass(v_rel) AND a.attnum > 0 AND NOT a.attisdropped)
       <> ARRAY['actor_id', 'content_sha256', 'created_at', 'id', 'link_url', 'message', 'not_advertising_statement_text',
                'not_advertising_statement_version', 'operation_key', 'post_id', 'recipient_count', 'redacted_at', 'redacted_by',
                'retract_reason_code', 'retracted_at', 'retracted_by', 'retracted_deleted_count', 'retracted_read_count', 'target', 'title']
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
           AND t.tgname IN ('guard_member_notification_broadcasts_mutation', 'guard_member_notification_broadcasts_truncate')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(v_rel) AND c.conname = 'member_notification_broadcasts_post_id_fkey'
                     AND c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass) THEN
    RAISE EXCEPTION 'VERIFY: member_notification_broadcasts columns / guard / post_id FK';
  END IF;
  -- 다시 적용(표가 남아 있음)도 같은 표인지: 칸 형식·NOT NULL·기본값과 제약 정의(이름·종류·정의)의 지문(리허설 light 측정값)
  IF (SELECT md5(string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''),
                            ',' ORDER BY a.attname))
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = to_regclass(v_rel) AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM '985ff2dca6ab17691f3f8e89053a1606'
     OR (SELECT md5(string_agg(c.conname::text || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid), ',' ORDER BY c.conname))
           FROM pg_constraint c WHERE c.conrelid = to_regclass(v_rel) AND c.contype <> 'f') IS DISTINCT FROM 'c5cb1756014c1e41811acb07642ffc7d' THEN
    RAISE EXCEPTION 'VERIFY: member_notification_broadcasts shape differs (columns %, constraints %)',
      (SELECT md5(string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''),
                             ',' ORDER BY a.attname))
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass(v_rel) AND a.attnum > 0 AND NOT a.attisdropped),
      (SELECT md5(string_agg(c.conname::text || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid), ',' ORDER BY c.conname))
         FROM pg_constraint c WHERE c.conrelid = to_regclass(v_rel) AND c.contype <> 'f');
  END IF;
  -- 함수 5개 + 새 거절 서명: search_path·EXECUTE 는 service_role 만. 받는 사람만 INVOKER, 나머지는 DEFINER.
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM (v_fn <> 'public.member_broadcast_recipients(text,uuid)')
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % security / search_path / EXECUTE', v_fn;
    END IF;
  END LOOP;
  -- 새 거절 서명: DEFAULT 없음, 옛 4인자는 그대로(배포 뒤 정리 스크립트가 지운다)
  IF (SELECT p.pronargdefaults FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'::regprocedure) <> 0
     OR md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) <> '20384719deba112e977fbd3bf8e266e5' THEN
    RAISE EXCEPTION 'VERIFY: reject_point_charge_refund signatures';
  END IF;
  -- 내부 검사 함수·가드 함수는 아무도 EXECUTE 못 함
  FOREACH v_fn IN ARRAY ARRAY['public.member_notification_texts_problem(jsonb)', 'public.guard_member_notification_broadcasts_mutation()'] LOOP
    IF to_regprocedure(v_fn) IS NULL OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % privileges', v_fn;
    END IF;
  END LOOP;
  -- 재정의한 두 함수: 16번 본문, 보안 방식·proacl 이 적용 전과 같음
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM 'b2db6cf4ca0c8226b17c62a3ee113e88'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM 'acf0b18ba4c87a11d96dc742565cbe71'
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS NOT FALSE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}'
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_facts / redact_member_text body / security / privileges';
  END IF;
  -- 설정 행: 구조(종류 키 집합 = 코드 규칙), 개인정보 없음, 답변 두 종류 = support_page_content(키가 있을 때)
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'member_notification_texts';
  SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content';
  IF public.member_notification_texts_problem(v_value) IS NOT NULL
     OR EXISTS (SELECT 1 FROM jsonb_path_query(v_value, '$.** ? (@.type() == "string")') s
                 WHERE cardinality(public.member_facing_text_pii_hits(s #>> '{}')) > 0)
     OR (v_support #> '{member,answerCreatedNotificationTitle}' IS NOT NULL
         AND v_support #> '{member,answerCreatedNotificationTitle}' IS DISTINCT FROM v_value #> '{kinds,supportAnswerCreated,title}')
     OR (v_support #> '{admin,notifyOnAnswerEdit}' IS NOT NULL
         AND v_support #> '{admin,notifyOnAnswerEdit}' IS DISTINCT FROM v_value #> '{kinds,supportAnswerEdited,enabled}') THEN
    RAISE EXCEPTION 'VERIFY: member_notification_texts values';
  END IF;
END;
$verify_bundle16_member_notifications$;

-- 6. [16번 기존 표 DDL] 시작 — 짧은 ACCESS EXCLUSIVE(새벽, lock_timeout 3초). 리허설 light 사본은 이 구역과 아래 VERIFY 블록을 뺀다. ------------
-- 6-0. 잠금 순서를 처음에 한 번에 정한다: system_settings(앞의 설정 행 INSERT 로 이미 ROW EXCLUSIVE) → 결제 표 → 알림 표.
--      정책 만들기가 마지막에 system_settings 잠금을 올리면, system_settings 를 읽은 채 refund_requests 를 기다리는 거래(환불 요청·결제 RPC)와
--      교착이 생겨 그쪽이 취소될 수 있다.
LOCK TABLE public.system_settings, public.refund_requests, public.payment_admin_actions, public.notifications IN ACCESS EXCLUSIVE MODE;
-- 6-1. 충전 환불 거절 사유 칸(5-8): 표 CHECK 는 '비지 않음'만(1~300자는 함수 검사 — 가림 문구로 바꿀 때 길이 CHECK 에 걸리지 않게).
--      다시 적용이면(down 이 남긴 칸) 만들기를 건너뛰고 정의를 대조한다.
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS member_reject_reason text;
DO $refund_reason_check_bundle16$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.refund_requests'::regclass
                  AND c.conname = 'refund_requests_member_reject_reason_check') THEN
    ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_member_reject_reason_check
      CHECK (member_reject_reason IS NULL OR btrim(member_reject_reason) <> '');
  END IF;
END;
$refund_reason_check_bundle16$;
COMMENT ON COLUMN public.refund_requests.member_reject_reason IS
  '16번: 회원에게 보낸 충전 환불 거절 사유(환불정책 3-2 ⑦ 증빙, 탈퇴 뒤에도 환불 처리 내역과 함께 남음). 내부 메모는 admin_note.';
-- 6-2. 처리 기록 action CHECK: 기존 7개 + refund_rejected(보통 거절). DROP/ADD 를 다시 해도 같은 결과다.
ALTER TABLE public.payment_admin_actions DROP CONSTRAINT payment_admin_actions_action_check;
ALTER TABLE public.payment_admin_actions ADD CONSTRAINT payment_admin_actions_action_check
  CHECK (action = ANY (ARRAY['paid_confirmed'::text, 'unpaid_confirmed'::text, 'cancel_handled'::text, 'manual_refund_completed'::text,
                             'manual_review_refund_rejected'::text, 'alert_resolved'::text, 'withdrawn_held_order_closed'::text,
                             'refund_rejected'::text]));
-- 6-3. 회원 알림에 공지 알림 기록 id(회수가 지울 행을 찾는다). authenticated 는 이 칸을 UPDATE 하지 못한다(칸 권한은 is_read 만).
ALTER TABLE public.notifications ADD COLUMN broadcast_id uuid NULL REFERENCES public.member_notification_broadcasts(id);
CREATE INDEX notifications_broadcast_id ON public.notifications (broadcast_id) WHERE broadcast_id IS NOT NULL;
-- 6-4. 설정 행 쓰기 막기(5-2): RESTRICTIVE 정책이 대표 세션의 직접 UPDATE 를 막는다(저장은 DB 함수만). down 이 남기므로 없을 때만 만든다.
DO $policy_bundle16_member_notification_texts$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_notification_texts_no_client_write') THEN
    CREATE POLICY system_settings_member_notification_texts_no_client_write ON public.system_settings
      AS RESTRICTIVE FOR UPDATE
      USING (key <> 'member_notification_texts')
      WITH CHECK (key <> 'member_notification_texts');
  END IF;
END;
$policy_bundle16_member_notification_texts$;
-- [16번 기존 표 DDL] 끝 -------------------------------------------------------------------------------------------

DO $verify_bundle16_existing_tables$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests'
                  AND column_name = 'member_reject_reason' AND data_type = 'text' AND is_nullable = 'YES')
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.refund_requests'::regclass
           AND c.conname = 'refund_requests_member_reject_reason_check')
        IS DISTINCT FROM 'CHECK (((member_reject_reason IS NULL) OR (btrim(member_reject_reason) <> ''''::text)))' THEN
    RAISE EXCEPTION 'VERIFY: refund_requests.member_reject_reason column / check';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.payment_admin_actions'::regclass
        AND c.conname = 'payment_admin_actions_action_check') NOT LIKE '%''refund_rejected''::text%'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.payment_admin_actions'::regclass
        AND c.conname = 'payment_admin_actions_action_check') NOT LIKE '%''manual_review_refund_rejected''::text%' THEN
    RAISE EXCEPTION 'VERIFY: payment_admin_actions action check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.notifications'::regclass AND c.contype = 'f'
                  AND c.confrelid = 'public.member_notification_broadcasts'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications' AND indexname = 'notifications_broadcast_id'
                     AND indexdef LIKE '%WHERE (broadcast_id IS NOT NULL)%')
     OR has_column_privilege('authenticated', 'public.notifications', 'broadcast_id', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: notifications.broadcast_id FK / index / privileges';
  END IF;
END;
$verify_bundle16_existing_tables$;

-- 쓰기 막기 정책 존재 검사는 이름 붙인 별도 블록(15번 방식, 리허설 light 사본은 뺀다)
DO $verify_bundle16_settings_policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_notification_texts_no_client_write' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
                  AND qual = '(key <> ''member_notification_texts''::text)' AND with_check = '(key <> ''member_notification_texts''::text)') THEN
    RAISE EXCEPTION 'VERIFY: system_settings_member_notification_texts_no_client_write policy';
  END IF;
END;
$verify_bundle16_settings_policy$;

NOTIFY pgrst, 'reload schema';


INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261218100000', 'bundle16_member_notifications');

DO $rh_roles$
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
END
$rh_roles$;

DO $rh_a$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 16 functions already exist', 'A', '다시 적용 거절');
  PERFORM pg_temp.ensure(pg_temp.texts_rev() = 1 AND public.member_notification_texts_problem(pg_temp.texts()) IS NULL, 'A', '설정 행 revision 1·구조 검사 통과');
  PERFORM pg_temp.ensure(pg_temp.texts() #> '{kinds,supportAnswerCreated,title}' = pg_temp.support() #> '{member,answerCreatedNotificationTitle}'
    AND pg_temp.texts() #> '{kinds,supportAnswerCreated,message}' = pg_temp.support() #> '{member,answerCreatedNotificationMessage}'
    AND pg_temp.texts() #> '{kinds,supportAnswerEdited,title}' = pg_temp.support() #> '{member,answerEditedNotificationTitle}'
    AND pg_temp.texts() #> '{kinds,supportAnswerEdited,message}' = pg_temp.support() #> '{member,answerEditedNotificationMessage}'
    AND pg_temp.texts() #> '{kinds,supportAnswerEdited,enabled}' = pg_temp.support() #> '{admin,notifyOnAnswerEdit}', 'A', '답변 두 종류 = support_page_content 복사(5-2 대응표)');
  PERFORM pg_temp.ensure((SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) = 'b2db6cf4ca0c8226b17c62a3ee113e88'
    AND (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = 'acf0b18ba4c87a11d96dc742565cbe71'
    AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) = '{postgres=X/postgres}'
    AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}',
    'A', '재정의 두 함수: 16번 본문·권한 그대로');
  PERFORM pg_temp.ensure((SELECT p.pronargdefaults FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'::regprocedure) = 0
    AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}'
    AND md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) = '20384719deba112e977fbd3bf8e266e5',
    'A', '새 거절 서명 DEFAULT 없음·service_role 만, 옛 4인자 그대로');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('member_broadcast_recipients', 'member_broadcast_preview', 'save_member_notification_texts',
     'send_member_broadcast', 'retract_member_broadcast', 'member_notification_texts_problem', 'guard_member_notification_broadcasts_mutation',
     'reject_point_charge_refund', 'member_withdrawal_facts', 'redact_member_text');
  INSERT INTO _rh_log (test, msg) VALUES ('A', 'VERIFY 통과(마이그레이션 안 블록)·다시 적용 거절·설정 행·복사·재정의 함수');
END
$rh_a$;

DO $rh_r2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_j := pg_temp.texts();
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 1, jsonb_set(v_j, '{kinds,chargeCompleted,title}', '"크레딧 충전 완료(리허설)"')), 'OK {"changed": true', 'R2', '대표 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.texts_rev() = 2 AND pg_temp.texts() #>> '{kinds,chargeCompleted,title}' = '크레딧 충전 완료(리허설)', 'R2', 'revision 2·값 바뀜');
    v_j := pg_temp.audit_last('member_notification_texts_update');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_notification_texts_update') = 1
      AND v_j -> 'changes' = '[{"path": "kinds.chargeCompleted.title", "after": "크레딧 충전 완료(리허설)", "before": "크레딧 충전 완료"}]'::jsonb
      AND v_j -> 'statement_before' = 'null'::jsonb, 'R2', '기록: 바뀐 경로 before·after 원문(4절 예외), 경계 문장 안 바뀜');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_notification_texts_update', ARRAY['changes', 'request', 'revision_after', 'revision_before', 'saved_at', 'statement_after', 'statement_before', 'statement_version_after', 'statement_version_before']::text[], ARRAY[]::text[]), 'R2', '기록 키 목록');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_staff, 2, pg_temp.texts()), 'ERR MEMBER_NOTIFICATION_ACTOR_NOT_OWNER', 'R2', '직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_e, 2, pg_temp.texts()), 'ERR MEMBER_NOTIFICATION_ACTOR_NOT_OWNER', 'R2', '회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 1, pg_temp.texts()), 'ERR MEMBER_NOTIFICATION_REVISION_CONFLICT', 'R2', '판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, pg_temp.texts()), 'OK {"changed": false', 'R2', '바뀐 것 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_notification_texts_update') = 1, 'R2', '바뀐 것 없음 기록 0');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, pg_temp.texts() #- '{kinds,chargeCompleted}'), 'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds', 'R2', '종류 삭제 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,newKind}', '{"enabled": true, "title": "새", "message": "새"}')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds', 'R2', '종류 추가 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,creditRevoked,enabled}', 'false')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds.creditRevoked.enabled', 'R2', '끌 수 없는 종류 끄기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,chargeRefundRejected,message}', '"환불 요청이 승인되지 않았습니다."')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds.chargeRefundRejected.message', 'R2', '{사유} 빼기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{broadcast,allMembersDailyLimit}', '6')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:broadcast.allMembersDailyLimit', 'R2', '상한 범위 밖 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,chargeCompleted,message}', '"문의는 010-0000-1111 로"')),
      'ERR MEMBER_NOTIFICATION_PII_SUSPECTED:mobile', 'R2', '개인정보 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_notification_texts(%L, 2, %L::jsonb, %L::jsonb)', v_owner, pg_temp.texts(), '[]')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:request', 'R2', '요청 정보 객체 아님 거절');
    -- 경계 문장: 바꾸면 함수가 판을 올린다(보낸 판 값은 무시)
    v_text := pg_temp.texts() #>> '{broadcast,notAdvertisingStatement}';
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(jsonb_set(pg_temp.texts(), '{broadcast,notAdvertisingStatement}', '"리허설 경계 문장 2판"'),
      '{broadcast,notAdvertisingStatementVersion}', '99')), 'OK {"changed": true', 'R2', '경계 문장 바꿈');
    v_j := pg_temp.audit_last('member_notification_texts_update');
    v_log := v_log || pg_temp.ensure((pg_temp.texts() #>> '{broadcast,notAdvertisingStatementVersion}')::integer = 2
      AND v_j ->> 'statement_before' = v_text
      AND v_j ->> 'statement_after' = '리허설 경계 문장 2판' AND (v_j ->> 'statement_version_before')::integer = 1 AND (v_j ->> 'statement_version_after')::integer = 2,
      'R2', '경계 판 2(함수가 정함)·기록에 이전·새 판과 문장 원문');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_notification_texts_update', ARRAY['changes', 'request', 'revision_after', 'revision_before', 'saved_at', 'statement_after', 'statement_before', 'statement_version_after', 'statement_version_before']::text[], ARRAY['010-0000-1111']::text[]), 'R2', '기록 키 목록(거절된 개인정보 글 없음)');
    -- full: 대표 세션(authenticated)의 직접 UPDATE 는 RESTRICTIVE 정책이 막는다(행이 보이지 않아 0행)
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      $q$UPDATE public.system_settings SET value = jsonb_set(value, '{kinds,creditRevoked,enabled}', 'false') WHERE key = 'member_notification_texts' RETURNING key$q$),
      'OK null', 'R2', '대표 세션 직접 UPDATE 0행(쓰기 막기 정책)');
    v_log := v_log || pg_temp.ensure(pg_temp.texts() #> '{kinds,creditRevoked,enabled}' = 'true'::jsonb, 'R2', '끌 수 없는 종류 그대로');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R2', m FROM unnest(v_log) m;
END
$rh_r2$;

DO $rh_r3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.send(v_staff, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R3', '직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_e, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R3', '회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1, 99), 'ERR BROADCAST_CONFIRM_REQUIRED', 'R3', '경계 판 다름 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', repeat('가', 61), '내용', NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:title', 'R3', '제목 61자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', E'제목\n둘째 줄', '내용', NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:title', 'R3', '제목 줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '제목', repeat('가', 501), NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:message', 'R3', '내용 501자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'other', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:target', 'R3', '대상 밖 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '문의 rh16@example.com', '내용', NULL, NULL, 1), 'ERR BROADCAST_PII_SUSPECTED:email', 'R3', '개인정보 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/faq#abc', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /faq#abc');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/faq#00000000-0000-4000-8000-00000000000g', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /faq#00000000-0000-4000-8000-00000000000g');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/notices?from=push', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /notices?from=push');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/notices#top', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /notices#top');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/terms/nothing-here', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /terms/nothing-here');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/terms/refund?x=1', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /terms/refund?x=1');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/market', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /market');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/credits/charge', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /credits/charge');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/cart', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /cart');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/checkout', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /checkout');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', 'https://example.com', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 https://example.com');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '//example.com', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 //example.com');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/notices/', NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '허용 밖 링크 /notices/');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', NULL, NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '허용 링크 (없음) — 인원 대조까지 감');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/notices', NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '허용 링크 /notices — 인원 대조까지 감');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/faq', NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '허용 링크 /faq — 인원 대조까지 감');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/terms', NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '허용 링크 /terms — 인원 대조까지 감');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/terms/upcoming', NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '허용 링크 /terms/upcoming — 인원 대조까지 감');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', '/faq#00000000-0000-4000-8000-000000000001', NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '허용 링크 /faq#00000000-0000-4000-8000-000000000001 — 인원 대조까지 감');
    -- 하단 정보에 켜진 약관 문서 slug 는 받는다
    SELECT d.value ->> 'slug' INTO v_text FROM public.system_settings s, jsonb_each(s.value -> 'policyDocuments') d
     WHERE s.key = 'site_footer_content' AND d.value -> 'enabled' = 'true'::jsonb AND btrim(COALESCE(d.value ->> 'content', '')) <> '' ORDER BY d.key LIMIT 1;
    IF v_text IS NOT NULL THEN
      v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '약관', '내용', '/terms/' || v_text, NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '켜진 약관 문서 slug 링크');
    END IF;
    -- 공지 글: 게시 중인 공지면 링크 = /notices/{id}, 다르거나 숨긴 글이면 거절
    v_r := pg_temp.try_json(format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)', v_owner, 'notice', '리허설 공지', '본문', '{"ip": "203.0.113.16", "user_agent": "rh16"}'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R3', '시험 공지 1건(14번 함수)');
    v_post := (pg_temp.res(v_r) ->> 'id')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices/' || v_post, v_post, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '게시 중 공지 링크·글 id 일치');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices', v_post, 99), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '링크·글 id 불일치 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices/' || v_post, NULL, 99), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '공지 링크에 글 id 없음 거절');
    v_r := pg_temp.try_json(format('SELECT public.save_site_board_post(%L, %L, 1, %L, %L, %L, NULL, NULL, NULL, false, false, %L::jsonb)', v_owner, v_post, 'notice', '리허설 공지', '본문', '{"ip": "203.0.113.16", "user_agent": "rh16"}'));
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices/' || v_post, v_post, 99), 'ERR BROADCAST_INPUT_INVALID:postId', 'R3', '숨긴 공지 거절');
    -- 인원: 전체 대상은 일부러 틀린 인원으로 대조 실패(실회원에게 넣지 않음)
    v_n := cardinality(pg_temp.recipients('all_members', v_owner));
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'all_members', '제목', '내용', NULL, NULL, v_n + 1), 'ERR BROADCAST_COUNT_CHANGED:' || v_n, 'R3', '인원 바뀜 거절(지금 인원 돌려줌)');
    -- 재요청: 같은 operation_key·같은 내용이면 그대로(replayed), 다른 내용이면 거절 — 잠금 뒤 상한보다 먼저
    v_key := gen_random_uuid();
    PERFORM pg_temp.put_broadcast(v_owner, 'self', v_key, '재요청 제목', '재요청 내용');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, v_key, 'self', '재요청 제목', '재요청 내용', NULL, NULL, 1), 'OK {', 'R3', '같은 키 같은 내용 replayed');
    v_log := v_log || pg_temp.ensure(pg_temp.res(pg_temp.send(v_owner, v_key, 'self', '재요청 제목', '재요청 내용', NULL, NULL, 1)) ->> 'replayed' = 'true', 'R3', 'replayed true');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, v_key, 'self', '재요청 제목', '다른 내용', NULL, NULL, 1), 'ERR BROADCAST_IDEMPOTENCY_CONFLICT', 'R3', '같은 키 다른 내용 거절');
    -- 상한: 전체 24시간 1회(회수한 것도 셈), 시험 10회
    PERFORM pg_temp.put_broadcast(v_owner, 'all_members', gen_random_uuid(), '앞선 전체', '내용', true);
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'all_members', '제목', '내용', NULL, NULL, v_n), 'ERR BROADCAST_RATE_LIMITED:', 'R3', '전체 2번째 거절(회수한 것 포함)');
    v_r := pg_temp.preview(v_owner, 'all_members');
    v_log := v_log || pg_temp.ensure(pg_temp.res(v_r) ->> 'remaining' = '0' AND pg_temp.res(v_r) ->> 'nextAvailableAt' IS NOT NULL
      AND (pg_temp.res(v_r) ->> 'recipientCount')::integer = v_n, 'R3', '미리보기: 남은 0·다음 시각·인원');
    FOR v_n IN 1 .. 9 LOOP
      PERFORM pg_temp.put_broadcast(v_owner, 'self');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_RATE_LIMITED:', 'R3', '시험 11번째 거절(재요청 행 포함 10)');
    v_log := v_log || pg_temp.expect(pg_temp.preview(v_staff, 'self'), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R3', '미리보기 직원 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R3', m FROM unnest(v_log) m;
END
$rh_r3$;

DO $rh_r3_full$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- full: 나에게만 시험 성공 → 알림 1행(type announcement·broadcast_id), 기록 행 경계 문장 = 그 판의 문장, 작업 기록에 원문·회원 id 없음
    v_key := gen_random_uuid();
    v_r := pg_temp.send(v_owner, v_key, 'self', '리허설 공지 제목', '리허설 공지 내용', '/notices', NULL, 1);
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R3', '나에게만 시험 성공');
    v_id := (pg_temp.res(v_r) ->> 'broadcast_id')::uuid;
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'replayed') = 'false' AND (pg_temp.res(v_r) ->> 'recipient_count')::integer = 1, 'R3', '인원 1·replayed false');
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE broadcast_id = $1 AND user_id = $2 AND type = ''announcement'' AND title = ''리허설 공지 제목'' AND link = ''/notices''' INTO v_n USING v_id, v_owner;
    v_log := v_log || pg_temp.ensure(v_n = 1, 'R3', '알림 1행(type·broadcast_id·링크)');
    v_log := v_log || pg_temp.ensure((SELECT b.not_advertising_statement_text = pg_temp.texts() #>> '{broadcast,notAdvertisingStatement}'
      AND b.not_advertising_statement_version = (pg_temp.texts() #>> '{broadcast,notAdvertisingStatementVersion}')::integer FROM public.member_notification_broadcasts b WHERE b.id = v_id),
      'R3', '기록 행 경계 문장 = 그 판의 문장 원문');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_broadcast_send') = 1
      AND pg_temp.audit_ok('member_broadcast_send', ARRAY['broadcast_id', 'content_sha256', 'link_url', 'message_length', 'not_advertising_statement_version', 'post_id', 'recipient_count', 'request', 'saved_at', 'target', 'title_length']::text[], ARRAY['리허설 공지 제목', '리허설 공지 내용', v_owner::text]), 'R3', '기록: 키 목록·원문·회원 id 없음');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, v_key, 'self', '리허설 공지 제목', '리허설 공지 내용', '/notices', NULL, 1), 'OK {', 'R3', '같은 거래 순차 재요청');
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE broadcast_id = $1' INTO v_n USING v_id;
    v_log := v_log || pg_temp.ensure(v_n = 1 AND pg_temp.audit_count('member_broadcast_send') = 1, 'R3', '재요청: 알림 추가 0·기록 추가 0');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R3', m FROM unnest(v_log) m;
END
$rh_r3_full$;

DO $rh_r4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_ids := pg_temp.recipients('all_members', v_owner);
    v_log := v_log || pg_temp.ensure(v_e = ANY (v_ids) AND v_x = ANY (v_ids) AND NOT v_owner = ANY (v_ids) AND NOT v_staff = ANY (v_ids), 'R4', '가입 회원 포함·관리자(대표·직원) 빠짐');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM unnest(v_ids) r JOIN public.profiles p ON p.id = r
      WHERE p.withdrawn_at IS NOT NULL OR p.signup_completed IS NOT TRUE OR p.is_admin IS TRUE), 'R4', '탈퇴·가입 미완료·관리자 0');
    UPDATE public.profiles SET signup_completed = false WHERE id = v_e;
    v_log := v_log || pg_temp.ensure(NOT v_e = ANY (pg_temp.recipients('all_members', v_owner)), 'R4', '가입 미완료 빠짐');
    UPDATE public.profiles SET signup_completed = true WHERE id = v_e;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_log := v_log || pg_temp.ensure(NOT v_x = ANY (pg_temp.recipients('all_members', v_owner)), 'R4', '탈퇴 빠짐');
    v_log := v_log || pg_temp.ensure(pg_temp.recipients('self', v_owner) = ARRAY[v_owner], 'R4', '나에게만 시험 = 행위자 1명');
    -- 이용 제한·로그인 차단(12번)은 받는 사람 식에 없다(profiles 의 가입·탈퇴·관리자만 본다) — 포함
    v_log := v_log || pg_temp.ensure(strpos(pg_get_functiondef('public.member_broadcast_recipients(text,uuid)'::regprocedure), 'suspension') = 0, 'R4', '정지 여부를 보지 않음(포함)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R4', m FROM unnest(v_log) m;
END
$rh_r4$;

DO $rh_r5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_id := pg_temp.put_broadcast(v_owner, 'self');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L WHERE id = %L', '바꿈', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '제목 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET recipient_count = 2 WHERE id = %L', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '인원 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.member_notification_broadcasts WHERE id = %L', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', 'DELETE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('TRUNCATE public.member_notification_broadcasts'), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', 'TRUNCATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L, message = %L, redacted_at = now(), redacted_by = %L WHERE id = %L',
      pg_temp.texts() #>> '{broadcast,redactedText}', pg_temp.texts() #>> '{broadcast,redactedText}', v_owner, v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '회수 전 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET retracted_at = now(), retracted_by = %L, retract_reason_code = %L, retracted_deleted_count = 0, retracted_read_count = 0 WHERE id = %L',
      v_owner, 'mistake', v_id)), 'OK', 'R5', '회수 칸 NULL→값 허용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L, message = %L, redacted_at = now(), redacted_by = %L WHERE id = %L',
      '다른 글', '다른 글', v_owner, v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '가림 문구 아닌 글로 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L, message = %L, redacted_at = now(), redacted_by = %L WHERE id = %L',
      pg_temp.texts() #>> '{broadcast,redactedText}', pg_temp.texts() #>> '{broadcast,redactedText}', v_owner, v_id)), 'OK', 'R5', '회수 뒤 가림 허용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET retracted_read_count = 5 WHERE id = %L', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '회수 칸 값→값 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R5', m FROM unnest(v_log) m;
END
$rh_r5$;

DO $rh_r5_full$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_key := gen_random_uuid();
    v_r := pg_temp.send(v_owner, v_key, 'self', '회수 시험', '회수 시험 내용', NULL, NULL, 1);
    v_id := (pg_temp.res(v_r) ->> 'broadcast_id')::uuid;
    EXECUTE 'UPDATE public.notifications SET is_read = true WHERE broadcast_id = $1' USING v_id;
    v_log := v_log || pg_temp.expect(pg_temp.retract(v_staff, v_id, 'mistake', false), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R5', '직원 회수 거절');
    v_log := v_log || pg_temp.expect(pg_temp.retract(v_owner, v_id, 'pii', false), 'ERR BROADCAST_INPUT_INVALID:redact', 'R5', '개인정보 사유는 가림 함께');
    v_r := pg_temp.retract(v_owner, v_id, 'mistake', false);
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R5', '회수');
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'deleted_count')::integer = 1 AND (pg_temp.res(v_r) ->> 'read_count')::integer = 1, 'R5', '지운 수 1·읽은 수 1');
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE broadcast_id = $1' INTO v_n USING v_id;
    v_log := v_log || pg_temp.ensure(v_n = 0, 'R5', '알림 목록에서 지워짐');
    v_log := v_log || pg_temp.ensure(pg_temp.res(pg_temp.retract(v_owner, v_id, 'mistake', false)) ->> 'changed' = 'false', 'R5', '두 번째 회수 그대로');
    v_r := pg_temp.retract(v_owner, v_id, 'pii', true);
    v_log := v_log || pg_temp.ensure(pg_temp.res(v_r) ->> 'redacted' = 'true' AND pg_temp.res(v_r) ->> 'retracted' = 'false', 'R5', '가림만 새로');
    v_log := v_log || pg_temp.ensure((SELECT b.title = pg_temp.texts() #>> '{broadcast,redactedText}' AND b.message = b.title AND b.redacted_by = v_owner
      FROM public.member_notification_broadcasts b WHERE b.id = v_id), 'R5', '가림 뒤 글 = 가림 문구');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_broadcast_retract') = 2
      AND pg_temp.audit_ok('member_broadcast_retract', ARRAY['broadcast_id', 'deleted_count', 'read_count', 'reason_code', 'redacted', 'request', 'retracted', 'retracted_at']::text[], ARRAY['회수 시험', v_owner::text]), 'R5', '회수 기록 2건(원문·회원 id 없음)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R5', m FROM unnest(v_log) m;
END
$rh_r5_full$;

DO $rh_r6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.member_broadcast_recipients(''all_members'', NULL)'), 'ERR permission denied', 'R6', 'authenticated: count(*)::text FROM public.member_broadcast_recipient');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT count(*)::text FROM public.member_broadcast_recipients(''all_members'', NULL)'), 'ERR permission denied', 'R6', 'anon: count(*)::text FROM public.member_broadcast_recipient');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT public.member_broadcast_preview(NULL, ''self'')::text'), 'ERR permission denied', 'R6', 'authenticated: public.member_broadcast_preview(NULL, ''self'')::text');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.member_broadcast_preview(NULL, ''self'')::text'), 'ERR permission denied', 'R6', 'anon: public.member_broadcast_preview(NULL, ''self'')::text');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT public.save_member_notification_texts(NULL, 1, ''{}''::jsonb, ''{}''::jsonb)::text'), 'ERR permission denied', 'R6', 'authenticated: public.save_member_notification_texts(NULL, 1, ''{}''::');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.save_member_notification_texts(NULL, 1, ''{}''::jsonb, ''{}''::jsonb)::text'), 'ERR permission denied', 'R6', 'anon: public.save_member_notification_texts(NULL, 1, ''{}''::');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT public.send_member_broadcast(NULL, NULL, ''self'', ''t'', ''m'', NULL, NULL, 1, 1, ''{}''::jsonb)::text'), 'ERR permission denied', 'R6', 'authenticated: public.send_member_broadcast(NULL, NULL, ''self'', ''t'',');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.send_member_broadcast(NULL, NULL, ''self'', ''t'', ''m'', NULL, NULL, 1, 1, ''{}''::jsonb)::text'), 'ERR permission denied', 'R6', 'anon: public.send_member_broadcast(NULL, NULL, ''self'', ''t'',');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT public.retract_member_broadcast(NULL, NULL, ''mistake'', false, ''{}''::jsonb)::text'), 'ERR permission denied', 'R6', 'authenticated: public.retract_member_broadcast(NULL, NULL, ''mistake''');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.retract_member_broadcast(NULL, NULL, ''mistake'', false, ''{}''::jsonb)::text'), 'ERR permission denied', 'R6', 'anon: public.retract_member_broadcast(NULL, NULL, ''mistake''');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT public.reject_point_charge_refund(NULL::uuid, NULL::uuid, NULL::text, NULL::boolean, NULL::text)::text'), 'ERR permission denied', 'R6', 'authenticated: public.reject_point_charge_refund(NULL::uuid, NULL::u');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.reject_point_charge_refund(NULL::uuid, NULL::uuid, NULL::text, NULL::boolean, NULL::text)::text'), 'ERR permission denied', 'R6', 'anon: public.reject_point_charge_refund(NULL::uuid, NULL::u');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT public.member_notification_texts_problem(''{}''::jsonb)'), 'ERR permission denied', 'R6', 'authenticated: public.member_notification_texts_problem(''{}''::jsonb)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.member_notification_texts_problem(''{}''::jsonb)'), 'ERR permission denied', 'R6', 'anon: public.member_notification_texts_problem(''{}''::jsonb)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.member_notification_broadcasts'), 'ERR permission denied', 'R6', '기록 표 SELECT 거절(대표 세션)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('INSERT INTO public.member_notification_broadcasts (operation_key, actor_id, target, title, message, content_sha256, recipient_count, not_advertising_statement_version, not_advertising_statement_text) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 1, 1, %L) RETURNING id::text',
        v_owner, 'self', 't', 'm', repeat('a', 64), 's')), 'ERR permission denied', 'R6', 'service_role 기록 표 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT count(*)::text FROM public.member_notification_broadcasts'), 'OK', 'R6', 'service_role SELECT 됨');
    -- full: 본인 알림의 broadcast_id UPDATE 거절, is_read 는 됨
    v_r := pg_temp.send(v_owner, gen_random_uuid(), 'self', '권한 시험', '내용', NULL, NULL, 1);
    v_id := (pg_temp.res(v_r) ->> 'broadcast_id')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('UPDATE public.notifications SET broadcast_id = NULL WHERE broadcast_id = %L RETURNING id::text', v_id)),
      'ERR permission denied', 'R6', '본인 알림 broadcast_id UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('UPDATE public.notifications SET is_read = true WHERE broadcast_id = %L RETURNING id::text', v_id)),
      'OK', 'R6', '본인 알림 is_read UPDATE 됨');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R6', m FROM unnest(v_log) m;
END
$rh_r6$;

DO $rh_r8$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_n := (pg_temp.support() ->> 'revision')::integer;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'OK', 'R8', '정리(같음 → 지움)');
    v_log := v_log || pg_temp.ensure(NOT (pg_temp.support() -> 'member') ?| ARRAY['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle', 'answerEditedNotificationMessage'] AND NOT (pg_temp.support() -> 'admin') ? 'notifyOnAnswerEdit'
      AND (pg_temp.support() ->> 'revision')::integer = v_n + 1, 'R8', '5개 키 없음·revision + 1');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_page_content_update') = 1
      AND pg_temp.audit_last('support_page_content_update') ->> 'bundle' = 'bundle16_support_keys_cleanup', 'R8', '기록 1건(bundle16_support_keys_cleanup)');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
      AND to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)') IS NOT NULL, 'R8', '옛 4인자 삭제·5인자 남음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'OK', 'R8', '다시 돌림(이미 없음 → 넘어감)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_page_content_update') = 1 AND (pg_temp.support() ->> 'revision')::integer = v_n + 1, 'R8', '두 번째는 기록·판 그대로');
    -- 되살리기(R7 1단계)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기(없음 → 넣음, 옛 4인자 다시 만듦)');
    v_log := v_log || pg_temp.ensure(pg_temp.support() #> '{member,answerCreatedNotificationTitle}' = pg_temp.texts() #> '{kinds,supportAnswerCreated,title}'
      AND pg_temp.support() #> '{member,answerEditedNotificationMessage}' = pg_temp.texts() #> '{kinds,supportAnswerEdited,message}'
      AND pg_temp.support() #> '{admin,notifyOnAnswerEdit}' = pg_temp.texts() #> '{kinds,supportAnswerEdited,enabled}'
      AND (pg_temp.support() ->> 'revision')::integer = v_n + 2, 'R7', '5개 키 = member_notification_texts 값·revision + 1');
    v_log := v_log || pg_temp.ensure(md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) = '20384719deba112e977fbd3bf8e266e5'
      AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}',
      'R7', '다시 만든 옛 4인자: 적용 전 지문·권한 service_role 만');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기 다시(있음·같음 → 그대로)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_page_content_update') = 2 AND (pg_temp.support() ->> 'revision')::integer = v_n + 2, 'R7', '같으면 기록·판 그대로');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R8', m FROM unnest(v_log) m;
END
$rh_r8$;

DO $rh_r8_differs$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.system_settings SET value = jsonb_set(value, '{member,answerCreatedNotificationTitle}', '"13번 화면에서 고친 글"') WHERE key = 'support_page_content';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'ERR KEYS_CLEANUP: support_page_content {member,answerCreatedNotificationTitle} differs', 'R8', '다름 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기: 있음·다름 → 그대로 두고 기록');
    v_log := v_log || pg_temp.ensure(pg_temp.support() #>> '{member,answerCreatedNotificationTitle}' = '13번 화면에서 고친 글'
      AND pg_temp.audit_last('support_page_content_update') -> 'differs' = '["{member,answerCreatedNotificationTitle}"]'::jsonb, 'R7', '다른 값 그대로·기록에 differs');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R8', m FROM unnest(v_log) m;
END
$rh_r8_differs$;

CREATE FUNCTION pg_temp.r9_request(p_user uuid, p_status text, p_origin text DEFAULT 'user') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_source uuid;
  v_id uuid;
BEGIN
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category)
  VALUES (p_user, 100, 100, 'pending_refund', 'plan_purchase') RETURNING id INTO v_source;
  EXECUTE 'INSERT INTO public.refund_requests (user_id, source_id, reason, status, provider, origin) VALUES ($1, $2, $3, $4, ''payapp'', $5) RETURNING id'
    INTO v_id USING p_user, v_source, '리허설 환불 사유', p_status, p_origin;
  RETURN v_id;
END $f$;

DO $rh_r9$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- 보통 거절(처리 메모 있음)
    v_id := pg_temp.r9_request(v_e, 'pending_review');
    v_post := (SELECT source_id FROM public.refund_requests WHERE id = v_id);
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, NULL::uuid, %L, false, %L)', v_id, '', '사유')), 'ERR REFUND_REJECT_ACTOR_REQUIRED', 'R9', 'p_admin_id NULL 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_id, '', '   ')), 'ERR REFUND_REJECT_MEMBER_REASON_REQUIRED', 'R9', '빈 사유 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_id, '', '연락은 rh16@example.com')), 'ERR REFUND_REJECT_MEMBER_REASON_PII', 'R9', '개인정보 사유 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_id, '', '계좌 123-456-789012 로')), 'ERR REFUND_REJECT_MEMBER_REASON_LONG_NUMBER', 'R9', '긴 숫자 사유 거절');
    v_log := v_log || pg_temp.ensure((SELECT status = 'pending_review' AND member_reject_reason IS NULL FROM public.refund_requests WHERE id = v_id)
      AND (SELECT status = 'pending_refund' FROM public.credit_sources WHERE id = v_post), 'R9', '거절 실패 → 전체 취소(크레딧 동결 그대로)');
    v_r := pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_id, '내부 처리 메모', E' 이미 사용한 크레딧이 있어\r\n환불 요건에 맞지 않습니다. '));
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R9', '보통 거절 성공');
    v_log := v_log || pg_temp.ensure(pg_temp.res(v_r) ->> 'user_id' = v_e::text
      AND pg_temp.res(v_r) ->> 'member_reject_reason' = E'이미 사용한 크레딧이 있어\n환불 요건에 맞지 않습니다.', 'R9', 'user_id·저장한(다듬은) 사유 반환');
    v_log := v_log || pg_temp.ensure((SELECT status = 'rejected' AND member_reject_reason = pg_temp.res(v_r) ->> 'member_reject_reason' AND admin_note = '내부 처리 메모'
      FROM public.refund_requests WHERE id = v_id) AND (SELECT status = 'active' FROM public.credit_sources WHERE id = v_post), 'R9', '사유 저장·내부 메모 그대로·동결 해제');
    v_log := v_log || pg_temp.ensure((SELECT count(*) = 1 AND bool_and(action = 'refund_rejected' AND note = 'refund_rejected' AND actor_id = v_owner
      AND details = jsonb_build_object('member_reason_length', char_length(pg_temp.res(v_r) ->> 'member_reject_reason'), 'admin_note_present', true))
      FROM public.payment_admin_actions WHERE refund_request_id = v_id), 'R9', '처리 기록 1행(고정 표지·글자 수만, 회원 사유·메모 글자 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_id, '', '다시')), 'ERR REFUND_REQUEST_NOT_REJECTABLE', 'R9', '재요청 거절');
    -- 메모 없는 보통 거절
    v_key := pg_temp.r9_request(v_e, 'pending_review');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_key, '', '요건에 맞지 않습니다.')), 'OK {', 'R9', '메모 없는 보통 거절 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) = 1 AND bool_and(action = 'refund_rejected' AND note = 'refund_rejected'
      AND details = jsonb_build_object('member_reason_length', char_length('요건에 맞지 않습니다.'), 'admin_note_present', false))
      FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '처리 기록 admin_note_present false');
    -- 수동 확인 건: 확인 false·빈 메모 → 확인 필요, 확인 true + 메모 → 성공(옛 동작 + member_reason_length)
    v_key := pg_temp.r9_request(v_e, 'manual_review');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_key, '결제사 미취소 확인', '사유')), 'ERR REFUND_REJECT_CONFIRMATION_REQUIRED', 'R9', '수동 확인: 확인 false 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, true, %L)', v_key, '  ', '사유')), 'ERR REFUND_REJECT_CONFIRMATION_REQUIRED', 'R9', '수동 확인: 빈 메모 거절');
    v_log := v_log || pg_temp.ensure((SELECT status = 'manual_review' FROM public.refund_requests WHERE id = v_key)
      AND NOT EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '수동 확인 거절 실패 → 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, true, %L)', v_key, '결제사 미취소 확인', '결제가 취소되지 않아 환불할 수 없습니다.')), 'OK {', 'R9', '수동 확인 거절 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) = 1 AND bool_and(action = 'manual_review_refund_rejected' AND note = '결제사 미취소 확인' AND actor_id = v_owner
      AND details = jsonb_build_object('provider_not_cancelled_confirmed', true, 'last_error_code', NULL, 'member_reason_length', char_length('결제가 취소되지 않아 환불할 수 없습니다.')))
      FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '수동 확인 처리 기록(action·note = 메모·details 기존 키 + 글자 수·actor)');
    -- 결제사 취소 흔적(격리 건)은 거절할 수 없다(돈 흐름 그대로)
    v_key := pg_temp.r9_request(v_e, 'pending_review', 'external_cancel');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, '||quote_literal(v_owner)||', %L, false, %L)', v_key, '', '사유')), 'ERR REFUND_REQUEST_NOT_REJECTABLE', 'R9', '결제사 취소 흔적 거절 불가');
    -- 옛 4인자(옛 코드 모양의 이름 붙은 호출)는 겹치지 않고 옛 동작 그대로
    v_key := pg_temp.r9_request(v_e, 'pending_review');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.reject_point_charge_refund(p_request_id => %L, p_admin_id => %L, p_admin_note => %L, p_provider_not_cancelled_confirmed => false)', v_key, v_owner, '')),
      'OK', 'R9', '옛 4인자 이름 호출 성공');
    v_log := v_log || pg_temp.ensure((SELECT status = 'rejected' AND member_reject_reason IS NULL FROM public.refund_requests WHERE id = v_key)
      AND NOT EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '옛 동작 그대로(처리 기록 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.reject_point_charge_refund(p_request_id => %L, p_admin_id => %L, p_admin_note => %L, p_provider_not_cancelled_confirmed => false, p_member_reason => %L)', v_key, v_owner, '', '사유')),
      'ERR REFUND_REQUEST_NOT_REJECTABLE', 'R9', '5인자 이름 호출은 새 함수 하나에만 맞음');
    -- 탈퇴 가림: 회원용 사유에만 긴 숫자가 있으면 가림 필요로 나오고, 가리면 빠진다
    UPDATE public.refund_requests SET member_reject_reason = '계좌 1234567890 확인' WHERE id = v_id;
    v_j := public.member_withdrawal_facts(v_e, false);
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'redactionRequired') x WHERE x ->> 'kind' = 'refund_request' AND (x ->> 'id')::uuid = v_id),
      'R9', '회원용 사유 긴 숫자 → 가림 필요');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'refund_request', v_id, 'member_reject_reason', '1234567890', 'rh16-redact-' || v_id)),
      'OK', 'R9', '새 칸 가림');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.member_withdrawal_facts(v_e, false) -> 'redactionRequired') x
      WHERE x ->> 'kind' = 'refund_request' AND (x ->> 'id')::uuid = v_id), 'R9', '가린 뒤 가림 필요에서 빠짐');
    -- 탈퇴 익명화 뒤에도 칸이 남는다(익명화는 refund_requests 를 지우거나 고치지 않는다)
    v_log := v_log || pg_temp.ensure(strpos(pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure), 'member_reject_reason') = 0
      AND pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure) !~ '(DELETE FROM|UPDATE) public\.refund_requests',
      'R9', '익명화 함수는 refund_requests 를 지우거나 고치지 않음');
    -- 실제 익명화(대표 처리 — 결제 회원 탈퇴 요청 → 익명화). 시험 계정의 결제 상태에 따라 판정이 거절할 수 있다: 통과하면 칸 보존을 단언하고,
    -- 거절되면 이유를 기록으로 남긴다(위 구조 단언이 보존을 증빙).
    DECLARE
      v_notice jsonb;
      v_req jsonb;
    BEGIN
      UPDATE public.credit_sources SET status = 'refunded', remaining_credits = 0 WHERE user_id = v_e AND id IN (SELECT source_id FROM public.refund_requests WHERE user_id = v_e AND reason = '리허설 환불 사유');
      UPDATE public.refund_requests SET status = 'rejected' WHERE user_id = v_e AND reason = '리허설 환불 사유' AND status NOT IN ('rejected', 'completed');
      v_notice := public.get_member_withdrawal_notice(v_e, 'request', true);
      v_req := public.create_member_withdrawal_request(v_e, 'email', v_notice ->> 'text', v_notice ->> 'sha256',
        (v_notice ->> 'expectedBalance')::integer, (v_notice ->> 'expectedForfeitPaid')::integer, (v_notice ->> 'expectedForfeitFree')::integer,
        '리허설 요청', v_owner, true, 'self', NULL, NULL, NULL);
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, %L, NULL, NULL, false, %L, %L, NULL, true)',
        v_owner, v_e, 'owner', (v_req ->> 'requestId')::uuid, '리허설 처리', 'rh16-anon-' || v_e));
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    IF v_r LIKE 'OK%' THEN
      v_log := v_log || pg_temp.ensure((SELECT member_reject_reason IS NOT NULL AND strpos(member_reject_reason, '1234567890') = 0 FROM public.refund_requests WHERE id = v_id),
        'R9', '익명화 통과·회원에게 보낸 거절 사유 칸 보존(가린 글)');
    ELSE
      v_log := v_log || ('NOTE R9 익명화 미실행: 익명화 판정이 거절함(구조 단언으로 보존 증빙) — ' || left(v_r, 200));
    END IF;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R9', m FROM unnest(v_log) m;
END
$rh_r9$;

DO $rh_r7$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- 옛 4인자가 없으면(정리 스크립트 뒤) down 은 멈춘다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'OK', 'R7', '정리 스크립트(옛 4인자 삭제)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: old 4-arg reject_point_charge_refund missing', 'R7', '옛 4인자 없음 → down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기');
    -- 기록 표에 공지 글을 가리키는 행 하나(14번 되돌리기 뒤 NOT VALID 경로를 보려고)
    v_r := pg_temp.try_json(format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)', v_owner, 'notice', '되돌리기 공지', '본문', '{"ip": "203.0.113.16", "user_agent": "rh16"}'));
    v_post := (pg_temp.res(v_r) ->> 'id')::uuid;
    v_r := pg_temp.send(v_owner, gen_random_uuid(), 'self', '되돌리기 공지 알림', '내용', '/notices/' || v_post, v_post, 1);
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R7', '공지 글 연결 알림 1건');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: unretracted broadcast notifications remain', 'R7', '회수 안 한 공지 알림 → down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.retract(v_owner, (pg_temp.res(v_r) ->> 'broadcast_id')::uuid, 'mistake', false), 'OK {', 'R7', '회수');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R7', '16 down');
    v_log := v_log || pg_temp.ensure(to_regclass('public.member_notification_broadcasts') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_notification_texts')
      AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'system_settings_member_notification_texts_no_client_write')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'refund_requests' AND column_name = 'member_reject_reason')
      AND (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'payment_admin_actions_action_check') LIKE '%refund_rejected%'
      AND (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = 'acf0b18ba4c87a11d96dc742565cbe71',
      'R7', '남은 것: 기록 표·설정 행·정책·칸·넓힌 CHECK·가림 확장');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_b14_down'), '  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;')),
      'OK', 'R7', '14 down(16 down 뒤 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_b14')), 'OK', 'R7', '14 재적용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'R7', '16 재적용(post_id FK NOT VALID·정책 하나·설정 행 대조)');
    v_log := v_log || pg_temp.ensure((SELECT NOT c.convalidated FROM pg_constraint c WHERE c.conname = 'member_notification_broadcasts_post_id_fkey')
      AND (SELECT count(*) FROM pg_policies WHERE policyname = 'system_settings_member_notification_texts_no_client_write') = 1, 'R7', 'FK NOT VALID·정책 하나');
    -- 다시 적용 때 답변 키가 다르면 멈춤
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R7', '16 down 다시');
    UPDATE public.system_settings SET value = jsonb_set(value, '{member,answerEditedNotificationTitle}', '"다른 글"') WHERE key = 'support_page_content';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: support_page_content {member,answerEditedNotificationTitle} differs', 'R7', '답변 키 다르면 재적용 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R7', m FROM unnest(v_log) m;
END
$rh_r7$;

DO $rh_leftover$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_notification_broadcasts) = 0
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action IN ('member_notification_texts_update', 'member_broadcast_send', 'member_broadcast_retract') AND created_at >= now()) = 0
      AND pg_temp.texts_rev() = 1, 'Z', '경우 밖에 남은 기록 행·16번 기록 0, 설정 행 revision 1(ROLLBACK 전)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'Z', m FROM unnest(v_log) m;
END
$rh_leftover$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
