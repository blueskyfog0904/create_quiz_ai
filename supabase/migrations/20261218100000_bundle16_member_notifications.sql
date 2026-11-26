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
