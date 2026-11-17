-- 관리자 작업 기록(계획 U3-5, DB-7'; 작업계획서 W3-5a의 표 설계).
-- 배경: 관리자가 한 일(환불 승인, 상품 삭제, 요금제 변경, 권한 부여 …)이 결제 쪽(payment_admin_actions) 말고는 남지 않는다.
-- 이 파일은 추가만 한다. 기존 표·정책·함수는 바꾸지 않으므로, 적용해도 지금 동작은 달라지지 않는다.
-- 만드는 것:
--   admin_audit_log        추가 전용 기록. 행위자·대상 계정이 지워져도 기록이 남게 FK를 두지 않고(선례: payment_admin_actions),
--                          행위자의 그때 이메일(관리자 아이디는 여기서 뽑는다)을 actor_email에 함께 적는다.
--                          action 값은 CHECK로 묶지 않는다(종류를 더할 때마다 마이그레이션이 필요해지므로). 종류 목록은 코드(src/lib/admin-audit-log.ts).
--                          amount는 크레딧 수량이다(지급·회수·환불). 하루 지급 한도 합산(U3-6)이 이 열을 쓴다. 수량이 없는 일은 NULL.
--   수정 금지 트리거        UPDATE·DELETE(행 단위)와 TRUNCATE(문장 단위)를 거부한다. service_role도 거부된다.
--   record_admin_audit()   1행을 적는다. 행위자의 이메일은 함수가 profiles에서 읽어 채운다. service_role만 부른다.
--                          기록은 이 함수로만 한다(시각은 함수가 now()로 정하고, 앱이 created_at 등을 직접 넣을 길이 없다).
--   admin_audit_timeline   조회 화면용 보기. 이 기록과 결제 쪽 조치 기록(payment_admin_actions)을 같은 모양으로 이어 붙인다(읽기만).
--                          security_invoker라서 부른 역할의 권한으로 읽는다 → service_role만 읽을 수 있다.
-- 권한: RLS를 켜고 정책을 두지 않는다. anon·authenticated에는 아무 권한도 주지 않는다. service_role은 SELECT만(INSERT도 없다).
--       service_role에 표 INSERT를 주면 기록 시각(created_at)·수량(amount)을 꾸며 넣어 하루 지급 한도 합산(U3-6)을 속일 수 있다.
--       그래서 쓰기는 SECURITY DEFINER 함수 record_admin_audit(소유자 postgres)와, 그 함수를 부르는 DB 함수로만 한다.
-- 하루 한도 합산 조회(U3-6에서 쓴다) — idx_admin_audit_log_actor_action을 탄다:
--   SELECT COALESCE(SUM(amount), 0) FROM public.admin_audit_log
--    WHERE actor_id = $1 AND action = $2
--      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul');
-- 잠금: 새 표·함수·보기만 만든다. 보기를 만들 때 payment_admin_actions·payment_orders·refund_requests에 ACCESS SHARE(읽기와 같은 잠금)만 잡는다.
-- 순서: 추가만 하므로 코드 배포보다 먼저 적용해도 된다. 코드가 먼저 배포돼도 기록 실패는 무시되고 조회 화면만 "불러오지 못했습니다"가 된다.
-- 뒤 단계: 20261117120000(권한 교체·해제 함수), DB-6'(지급 함수 개정), DB-11'(회수 함수)이 이 표에 같은 트랜잭션으로 적는다.
-- 되돌리기: supabase/rollback/20261117110000_admin_audit_log_down.sql (쌓인 작업 기록이 모두 사라진다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 표 ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_user_id uuid,
  amount integer,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  CONSTRAINT admin_audit_log_reason_check CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT admin_audit_log_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX idx_admin_audit_log_created_at ON public.admin_audit_log (created_at DESC);
CREATE INDEX idx_admin_audit_log_actor ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX idx_admin_audit_log_action ON public.admin_audit_log (action, created_at DESC);
CREATE INDEX idx_admin_audit_log_target_user ON public.admin_audit_log (target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;
-- 하루 한도 합산용: 행위자·종류·시각 범위.
CREATE INDEX idx_admin_audit_log_actor_action ON public.admin_audit_log (actor_id, action, created_at);

-- 2. 수정 금지 --------------------------------------------------------------------------------------------------
CREATE FUNCTION public.prevent_admin_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_prevent_admin_audit_log_mutation$
BEGIN
  RAISE EXCEPTION 'ADMIN_AUDIT_LOG_APPEND_ONLY';
END;
$fn_prevent_admin_audit_log_mutation$;

CREATE TRIGGER prevent_admin_audit_log_mutation
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_audit_log_mutation();

CREATE TRIGGER prevent_admin_audit_log_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_admin_audit_log_mutation();

-- 3. 권한 -------------------------------------------------------------------------------------------------------
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- 새 표에는 기본 권한으로 anon·authenticated·service_role 모두 ALL이 붙는다. 전부 걷고 필요한 것만 준다.
-- service_role은 읽기만 한다(쓰기는 record_admin_audit로만).
REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_audit_log TO service_role;

-- 4. 기록 함수 --------------------------------------------------------------------------------------------------
-- 앱 코드(service_role)가 부른다. 호출한 쪽이 관리자 확인을 마친 뒤에만 부른다(이 함수는 행위자를 검사하지 않는다).
CREATE FUNCTION public.record_admin_audit(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_target_user_id uuid,
  p_amount integer,
  p_reason text,
  p_details jsonb,
  p_request_id text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_admin_audit$
DECLARE
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NULLIF(btrim(p_action), '') IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AUDIT_INVALID_ARGUMENT';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_id, actor_email, action, target_type, target_id, target_user_id, amount, reason, details, request_id
  )
  VALUES (
    p_actor_id,
    (SELECT p.email FROM public.profiles p WHERE p.id = p_actor_id),
    btrim(p_action),
    NULLIF(btrim(p_target_type), ''),
    NULLIF(btrim(p_target_id), ''),
    p_target_user_id,
    p_amount,
    NULLIF(btrim(p_reason), ''),
    COALESCE(p_details, '{}'::jsonb),
    NULLIF(btrim(p_request_id), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn_record_admin_audit$;

REVOKE ALL ON FUNCTION public.record_admin_audit(uuid, text, text, text, uuid, integer, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_audit(uuid, text, text, text, uuid, integer, text, jsonb, text)
  TO service_role;

-- 5. 조회용 보기 ------------------------------------------------------------------------------------------------
-- 결제 쪽 조치 기록은 이미 payment_admin_actions에 남으므로 다시 적지 않고, 조회할 때만 시간순으로 함께 본다.
-- source: 'admin'(이 표) | 'payment'(payment_admin_actions). 결제 쪽 행에는 이메일 스냅샷이 없어 actor_email이 NULL이다(화면이 지금 계정에서 찾는다).
CREATE VIEW public.admin_audit_timeline
 WITH (security_invoker = true)
AS
  SELECT
    'admin'::text AS source,
    l.id,
    l.created_at,
    l.actor_id,
    l.actor_email,
    l.action,
    l.target_type,
    l.target_id,
    l.target_user_id,
    l.amount,
    l.reason,
    l.details
  FROM public.admin_audit_log l
  UNION ALL
  SELECT
    'payment'::text AS source,
    a.id,
    a.created_at,
    a.actor_id,
    NULL::text AS actor_email,
    a.action,
    -- 주문·환불이 모두 없는 행(예: alert_resolved — 경보 해소)은 대상 종류가 NULL이다.
    CASE
      WHEN a.refund_request_id IS NOT NULL THEN 'refund_request'
      WHEN a.payment_order_id IS NOT NULL THEN 'payment_order'
    END AS target_type,
    COALESCE(a.refund_request_id, a.payment_order_id)::text AS target_id,
    COALESCE(o.user_id, r.user_id) AS target_user_id,
    NULL::integer AS amount,
    a.note AS reason,
    jsonb_build_object(
      'payment_order_id', a.payment_order_id,
      'refund_request_id', a.refund_request_id,
      'before', a.before_state,
      'after', a.after_state,
      'recovered_credits', a.recovered_credits,
      'unrecovered_credits', a.unrecovered_credits,
      'external_method', a.external_method,
      'details', a.details
    ) AS details
  FROM public.payment_admin_actions a
  LEFT JOIN public.payment_orders o ON o.id = a.payment_order_id
  LEFT JOIN public.refund_requests r ON r.id = a.refund_request_id;

REVOKE ALL ON TABLE public.admin_audit_timeline FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_audit_timeline TO service_role;

NOTIFY pgrst, 'reload schema';
