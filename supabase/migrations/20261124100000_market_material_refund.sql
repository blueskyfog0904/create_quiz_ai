-- 출시 전 작업 순서표 8번 묶음: 자료 환불 30일·예외 환불·패키지 부분 환불(계획 docs/plan-bundle8-material-refund.md 8판, 대표 확정).
-- 만드는 것:
--   1. 설정: refundDays 30, 구매 고지 문구(대표 확인 문구 — docs/bundle8-copy-draft.md), 새 키 partialRefundConfirmNotice.
--   2. 표·열: 패키지 구성 기록, 환불 요청 종류·대상·배정 기록·접수 근거, 주문 환불 누계, 재지급 원천 연결, 문의 수정 판 보관,
--      활성 서브상품 (상품, 분류) 유일, 환불 요청 유일 인덱스 교체, 전체 환불 INSERT 검사, 관리자 이벤트는 pending 에만.
--   3. 함수: 환불 엔진(allocate/settle), 이용권 재구성, 부분 환불 신청·미리보기·승인, 예외 환불, 대표 정산,
--      approve_market_refund·evaluate_market_targets·revoke_admin_credits·update_own_pending_support_ticket 재정의.
-- 결제 함수 checkout_market_selection 은 바꾸지 않는다(VERIFY 로 md5 확인).
-- 잠금 순서: profiles → 환불 요청 → 주문 → 라인 → 원천 → 이용권. 새 함수는 거절 판정을 첫 쓰기 전에 끝내고 jsonb code 로 돌려준다
--   (approve_market_refund 만 옛 코드 호환을 위해 RAISE). 첫 쓰기 뒤의 실패는 모두 RAISE(전체 롤백).
-- 순서: DB 적용 → 타입 재생성·코드 배포 → 정책 본문 저장(판매를 켜기 전 같은 날).
--   DB 적용부터 코드 배포까지(그리고 되돌린 기간에도) 관리자 화면에서 구매 고지를 저장하지 않는다 —
--   옛 코드는 partialRefundConfirmNotice 를 지운 채 저장해, 새 코드가 정책을 읽지 못하고 재적용 때 문구를 초안으로 덮는다.
-- 되돌리기: supabase/rollback/20261124100000_market_material_refund_down.sql — 부분·예외 환불·재지급·대표 정산이 1건이라도 생기면 되돌리지 않는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- 0. 사전 점검: 재정의할 함수가 계획 때 본 운영 정의 그대로이고, 같은 분류 중복이 없다 ------------------------------
DO $precheck$
BEGIN
  IF md5(pg_get_functiondef('public.approve_market_refund(uuid,uuid,text,integer)'::regprocedure)) <> '3639ac2383927d33f065012f0c59d1e9' THEN
    RAISE EXCEPTION 'PRECHECK: approve_market_refund changed';
  END IF;
  IF md5(pg_get_functiondef('public.evaluate_market_targets(uuid,jsonb)'::regprocedure)) <> '128f6ad5e14626a9fc2bfa29f831752d' THEN
    RAISE EXCEPTION 'PRECHECK: evaluate_market_targets changed';
  END IF;
  IF md5(pg_get_functiondef('public.revoke_admin_credits(uuid,uuid,integer,text,text)'::regprocedure)) <> '3e64b0a4a9163d72d561ee5503fba429' THEN
    RAISE EXCEPTION 'PRECHECK: revoke_admin_credits changed';
  END IF;
  -- 문의 수정 함수는 되돌리기(down)가 새 정의(판 보관)를 남겨 두므로 원래 값·이번 값 둘 다 받는다.
  IF md5(pg_get_functiondef('public.update_own_pending_support_ticket(uuid,uuid,text,text)'::regprocedure))
       NOT IN ('ed40fb5a478afaf27a5f1440aca1eb70', 'cb221135b63d2bcc590b7fa4d2a082b0') THEN
    RAISE EXCEPTION 'PRECHECK: update_own_pending_support_ticket changed';
  END IF;
  IF md5(pg_get_functiondef('public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)'::regprocedure)) <> '0cda5ff7689d998cc6cf2fd213b0004d' THEN
    RAISE EXCEPTION 'PRECHECK: checkout_market_selection changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_item_subproducts WHERE deleted_at IS NULL AND is_active
              GROUP BY item_id, category_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'PRECHECK: duplicate active subproduct category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_refund_requests WHERE status = 'pending') THEN
    RAISE EXCEPTION 'PRECHECK: pending market refund requests exist';
  END IF;
END;
$precheck$;

-- 1. 설정 ---------------------------------------------------------------------------------------------------------
-- 문구는 첫 적용(partialRefundConfirmNotice 없음)에서만 넣는다 — 되돌린 뒤 재적용해도 그사이 관리자가 고친 문구를 덮지 않는다.
UPDATE public.system_settings
   SET value = value || jsonb_build_object('refundDays', 30), updated_at = now()
 WHERE key = 'market_purchase_policy' AND value ? 'partialRefundConfirmNotice';
UPDATE public.system_settings
   SET value = value || jsonb_build_object(
         'refundDays', 30,
         'checkboxLabel', '다운로드한 자료(받은 것으로 보는 자료 포함)는 단순 변심으로 환불할 수 없고, 받지 않은 자료는 구매일 다음 날부터 {자료환불기간}일째 되는 날까지 환불 신청할 수 있음을 확인했습니다.',
         'confirmNotice', '받지 않은 자료의 환불은 자료 보관함이나 고객센터(1:1 문의·이메일·전화)로 신청할 수 있습니다. 자료 안의 파일을 하나라도 받으면 그 자료를 받은 것으로 보고, 문제(HWP)에 PDF 파일이 들어 있으면 HWP를 받을 때 문제(PDF)도 받은 것으로 봅니다. 전체 패키지는 받지 않은 자료만큼 정가 비율로 환불합니다. 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 환불해 드립니다. 환불은 결제에 쓴 크레딧으로 돌아오며, 환불되면 그 자료는 더 받을 수 없습니다. HWP로 업그레이드한 PDF 주문은 업그레이드 주문을 먼저(또는 함께) 환불하면 환불할 수 있습니다.',
         'detailRefundNotice', '다운로드한 자료(받은 것으로 보는 자료 포함)는 단순 변심으로 환불할 수 없고, 받지 않은 자료는 구매일 다음 날부터 {자료환불기간}일째 되는 날까지 자료 보관함이나 고객센터로 환불 신청할 수 있습니다. 자료 안의 파일을 하나라도 받으면 그 자료를 받은 것으로 보고, 문제(HWP)에 PDF 파일이 들어 있으면 HWP를 받을 때 문제(PDF)도 받은 것으로 봅니다. 전체 패키지는 받지 않은 자료만큼, 구매 당시 구성 자료(문제 PDF 포함) 정가 합에 대한 비율로 환불하고 1크레딧 미만은 버립니다. 남는 자료가 없게 되면 남은 금액을 모두 돌려드립니다. 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 환불해 드립니다. 환불은 결제에 쓴 크레딧으로 돌아오며, 환불되면 그 자료는 더 받을 수 없습니다.',
         'refundExpiredReason', '구매일 다음 날부터 {자료환불기간}일이 지난 자료는 단순 변심으로 환불할 수 없습니다.',
         'partialRefundConfirmNotice', '아직 받지 않은 자료가 모두 함께 환불됩니다. 남기고 싶은 자료는 먼저 받은 뒤 신청해 주세요. 환불 금액은 낸 크레딧 × (환불할 자료 정가 합 ÷ 구매 당시 구성 자료 정가 합)이며 1크레딧 미만은 버립니다. 환불 뒤에는 이미 받은 자료만 받을 수 있고, 남은 문제(PDF)는 문제(HWP) 차액 구매의 기준이 되지 않습니다.'
       ),
       updated_at = now()
 WHERE key = 'market_purchase_policy' AND NOT (value ? 'partialRefundConfirmNotice');

-- 2. 표·열 ---------------------------------------------------------------------------------------------------------
-- 2-1. 패키지 구성 기록(구매 순간의 서브상품·정가). 결제 함수는 그대로 두고 라인 INSERT 트리거로 같은 트랜잭션에서 남긴다.
CREATE TABLE IF NOT EXISTS public.market_bundle_line_components (
  line_id uuid NOT NULL REFERENCES public.market_purchase_lines(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  subproduct_id uuid NOT NULL,
  category_slug text NOT NULL,
  list_price_credits integer NOT NULL CHECK (list_price_credits >= 0),
  backfilled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (line_id, subproduct_id)
);
CREATE INDEX IF NOT EXISTS idx_market_bundle_line_components_order ON public.market_bundle_line_components (order_id);

-- 2-2. 환불 요청 열
ALTER TABLE public.market_refund_requests
  ADD COLUMN IF NOT EXISTS refund_kind text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS refund_subproduct_ids uuid[],
  ADD COLUMN IF NOT EXISTS allocated_items jsonb,
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS support_ticket_id uuid,
  ADD COLUMN IF NOT EXISTS claim_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_type text,
  ADD COLUMN IF NOT EXISTS claim_channel text,
  ADD COLUMN IF NOT EXISTS prior_request_id uuid,
  ADD COLUMN IF NOT EXISTS reject_code text;
ALTER TABLE public.market_refund_requests DROP CONSTRAINT IF EXISTS market_refund_requests_refund_kind_check;
ALTER TABLE public.market_refund_requests ADD CONSTRAINT market_refund_requests_refund_kind_check
  CHECK (refund_kind IN ('full', 'partial', 'exception'));
ALTER TABLE public.market_refund_requests DROP CONSTRAINT IF EXISTS market_refund_requests_claim_type_check;
ALTER TABLE public.market_refund_requests ADD CONSTRAINT market_refund_requests_claim_type_check
  CHECK (claim_type IS NULL OR claim_type IN ('defect', 'withdrawal'));
ALTER TABLE public.market_refund_requests DROP CONSTRAINT IF EXISTS market_refund_requests_claim_channel_check;
ALTER TABLE public.market_refund_requests ADD CONSTRAINT market_refund_requests_claim_channel_check
  CHECK (claim_channel IS NULL OR claim_channel IN ('library', 'ticket', 'email', 'phone'));
ALTER TABLE public.market_refund_requests DROP CONSTRAINT IF EXISTS market_refund_requests_reject_code_check;
ALTER TABLE public.market_refund_requests ADD CONSTRAINT market_refund_requests_reject_code_check
  CHECK (reject_code IS NULL OR reject_code IN ('TARGET_CHANGED', 'PROVIDED_CONFIRMED', 'OTHER'));

-- 2-3. 주문 환불 누계(명목 committed = 승인 요청 금액 합, 실제 refunded = 복구 + 재지급)
ALTER TABLE public.market_purchase_orders
  ADD COLUMN IF NOT EXISTS refund_committed_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_credits integer NOT NULL DEFAULT 0;
UPDATE public.market_purchase_orders o
   SET refund_committed_credits = t.committed,
       refunded_credits = t.refunded
  FROM (
    SELECT r.order_id,
           COALESCE(sum(r.requested_refund_credits), 0)::integer AS committed,
           COALESCE(sum(r.approved_refund_credits), 0)::integer AS refunded
      FROM public.market_refund_requests r
     WHERE r.target_kind = 'v2_order' AND r.status = 'approved' AND r.order_id IS NOT NULL
     GROUP BY r.order_id
  ) t
 WHERE o.id = t.order_id;
ALTER TABLE public.market_purchase_orders DROP CONSTRAINT IF EXISTS market_purchase_orders_refund_totals_check;
ALTER TABLE public.market_purchase_orders ADD CONSTRAINT market_purchase_orders_refund_totals_check
  CHECK (refunded_credits >= 0 AND refunded_credits <= refund_committed_credits AND refund_committed_credits <= charged_credits);

-- 2-4. 재지급 원천 연결(회수 금지·9번 유료 추적)
CREATE TABLE IF NOT EXISTS public.market_refund_reissued_sources (
  source_id uuid PRIMARY KEY REFERENCES public.credit_sources(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.market_refund_requests(id) ON DELETE CASCADE,
  original_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 2-5. 문의 수정 판 보관(철회 의사를 처음 보낸 시각·내용의 증빙)
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS member_updated_at timestamptz;
-- 적용 전에 회원이 고친 대기 문의: 답변 전(pending)이면 updated_at 이 회원 수정 시각이다. 늦은 쪽으로 잡아 기간을 넓히지 않는다.
UPDATE public.support_tickets SET member_updated_at = updated_at
 WHERE member_updated_at IS NULL AND status = 'pending' AND updated_at > created_at;
CREATE TABLE IF NOT EXISTS public.support_ticket_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  subject text,
  message text,
  category_id uuid,
  written_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_revisions_ticket ON public.support_ticket_revisions (ticket_id, written_at);

-- 2-6. 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_item_subproducts_active_category
  ON public.market_item_subproducts (item_id, category_id)
  WHERE is_active AND deleted_at IS NULL;
DROP INDEX IF EXISTS public.uq_market_refund_requests_pending_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_refund_requests_pending_order_v2
  ON public.market_refund_requests (order_id)
  WHERE target_kind = 'v2_order' AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_refund_requests_full_approved_order
  ON public.market_refund_requests (order_id)
  WHERE target_kind = 'v2_order' AND status = 'approved' AND refund_kind = 'full';
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_refund_requests_prior
  ON public.market_refund_requests (prior_request_id)
  WHERE prior_request_id IS NOT NULL;

-- 2-7. 추가 전용 가드(부모가 지워질 때의 연쇄 삭제만 허용)
CREATE OR REPLACE FUNCTION public.guard_market_bundle_line_components_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.market_purchase_lines l WHERE l.id = OLD.line_id)
       AND EXISTS (SELECT 1 FROM public.market_purchase_orders o WHERE o.id = OLD.order_id) THEN
      RAISE EXCEPTION 'MARKET_BUNDLE_LINE_COMPONENTS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_BUNDLE_LINE_COMPONENTS_APPEND_ONLY';
END;
$fn$;
DROP TRIGGER IF EXISTS guard_market_bundle_line_components_mutation ON public.market_bundle_line_components;
CREATE TRIGGER guard_market_bundle_line_components_mutation
  BEFORE UPDATE OR DELETE ON public.market_bundle_line_components
  FOR EACH ROW EXECUTE FUNCTION public.guard_market_bundle_line_components_mutation();
DROP TRIGGER IF EXISTS guard_market_bundle_line_components_truncate ON public.market_bundle_line_components;
CREATE TRIGGER guard_market_bundle_line_components_truncate
  BEFORE TRUNCATE ON public.market_bundle_line_components
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_market_bundle_line_components_mutation();

CREATE OR REPLACE FUNCTION public.guard_market_refund_reissued_sources_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.id = OLD.source_id)
       AND EXISTS (SELECT 1 FROM public.market_refund_requests r WHERE r.id = OLD.request_id) THEN
      RAISE EXCEPTION 'MARKET_REFUND_REISSUED_SOURCES_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_REFUND_REISSUED_SOURCES_APPEND_ONLY';
END;
$fn$;
DROP TRIGGER IF EXISTS guard_market_refund_reissued_sources_mutation ON public.market_refund_reissued_sources;
CREATE TRIGGER guard_market_refund_reissued_sources_mutation
  BEFORE UPDATE OR DELETE ON public.market_refund_reissued_sources
  FOR EACH ROW EXECUTE FUNCTION public.guard_market_refund_reissued_sources_mutation();
DROP TRIGGER IF EXISTS guard_market_refund_reissued_sources_truncate ON public.market_refund_reissued_sources;
CREATE TRIGGER guard_market_refund_reissued_sources_truncate
  BEFORE TRUNCATE ON public.market_refund_reissued_sources
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_market_refund_reissued_sources_mutation();

CREATE OR REPLACE FUNCTION public.guard_support_ticket_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
END;
$fn$;
DROP TRIGGER IF EXISTS guard_support_ticket_revisions_mutation ON public.support_ticket_revisions;
CREATE TRIGGER guard_support_ticket_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.support_ticket_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_revisions_mutation();
DROP TRIGGER IF EXISTS guard_support_ticket_revisions_truncate ON public.support_ticket_revisions;
CREATE TRIGGER guard_support_ticket_revisions_truncate
  BEFORE TRUNCATE ON public.support_ticket_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_support_ticket_revisions_mutation();

-- 2-8. 패키지 구성 기록 트리거(결제 트랜잭션 안에서 실행, 0행이면 결제 전체 롤백)
CREATE OR REPLACE FUNCTION public.record_market_bundle_line_components()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.market_bundle_line_components (line_id, order_id, subproduct_id, category_slug, list_price_credits)
  SELECT NEW.id, NEW.order_id, s.id, COALESCE(c.slug, 'uncategorized'), s.price_credits
    FROM public.market_item_subproducts s
    LEFT JOIN public.market_subproduct_categories c ON c.id = s.category_id
   WHERE s.item_id = NEW.item_id
     AND s.workspace_subject = NEW.workspace_subject
     AND s.is_active AND s.deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    -- 구매 API 는 SQLSTATE P0409 로만 구분한다(메시지 글자 판정 금지).
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'MARKET_BUNDLE_COMPONENTS_EMPTY';
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS record_market_bundle_line_components ON public.market_purchase_lines;
CREATE TRIGGER record_market_bundle_line_components
  AFTER INSERT ON public.market_purchase_lines
  FOR EACH ROW WHEN (NEW.line_type = 'bundle')
  EXECUTE FUNCTION public.record_market_bundle_line_components();

-- 기존 패키지 라인 중 구성 기록이 없는 것은 지금 값으로 채운다(시험 주문 — backfilled 표시).
INSERT INTO public.market_bundle_line_components (line_id, order_id, subproduct_id, category_slug, list_price_credits, backfilled)
SELECT l.id, l.order_id, s.id, COALESCE(c.slug, 'uncategorized'), s.price_credits, true
  FROM public.market_purchase_lines l
  JOIN public.market_item_subproducts s ON s.item_id = l.item_id AND s.workspace_subject = l.workspace_subject
                                       AND s.is_active AND s.deleted_at IS NULL
  LEFT JOIN public.market_subproduct_categories c ON c.id = s.category_id
 WHERE l.line_type = 'bundle'
   AND NOT EXISTS (SELECT 1 FROM public.market_bundle_line_components x WHERE x.line_id = l.id)
ON CONFLICT DO NOTHING;

-- 2-9. 전체 환불 요청 INSERT 검사(일부 환불된 주문은 전액 요청 불가 — TS 직접 INSERT 경로 보호)
CREATE OR REPLACE FUNCTION public.guard_market_refund_request_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.target_kind = 'v2_order' AND NEW.refund_kind = 'full' AND EXISTS (
    SELECT 1 FROM public.market_purchase_orders o
     WHERE o.id = NEW.order_id AND o.refund_committed_credits <> 0
  ) THEN
    RAISE EXCEPTION 'MARKET_REFUND_PARTIALLY_REFUNDED';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS guard_market_refund_request_insert ON public.market_refund_requests;
CREATE TRIGGER guard_market_refund_request_insert
  BEFORE INSERT ON public.market_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_market_refund_request_insert();

-- 2-10. 관리자 이벤트는 처리할 요청(pending)에만
DROP TRIGGER IF EXISTS trg_admin_event_market_refund_requested ON public.market_refund_requests;
CREATE TRIGGER trg_admin_event_market_refund_requested
  AFTER INSERT ON public.market_refund_requests
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.admin_event_on_market_refund_requested();

-- 2-11. 권한
ALTER TABLE public.market_bundle_line_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_refund_reissued_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_bundle_line_components FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.market_refund_reissued_sources FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.support_ticket_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.market_bundle_line_components TO service_role;
GRANT SELECT ON TABLE public.market_refund_reissued_sources TO service_role;
GRANT SELECT ON TABLE public.support_ticket_revisions TO service_role;

-- 3. 함수 ---------------------------------------------------------------------------------------------------------
-- 3-1. 마감: 구매일(한국 시간) 다음 날부터 p_days 일째 되는 날 24:00(= 구매일 + p_days + 1 일 00:00 KST). 조건은 '기준 시각 < 마감'.
CREATE OR REPLACE FUNCTION public.market_refund_deadline(p_created_at timestamptz, p_days integer)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ((((p_created_at AT TIME ZONE 'Asia/Seoul')::date + p_days + 1)::timestamp) AT TIME ZONE 'Asia/Seoul')
$fn$;

-- 3-2. 환불 기간 설정(1~3650 정수가 아니면 NULL)
CREATE OR REPLACE FUNCTION public.market_purchase_refund_days()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN jsonb_typeof(s.value -> 'refundDays') = 'number'
            AND (s.value ->> 'refundDays')::numeric = trunc((s.value ->> 'refundDays')::numeric)
            AND (s.value ->> 'refundDays')::numeric BETWEEN 1 AND 3650
           THEN (s.value ->> 'refundDays')::numeric::integer
         END
    FROM public.system_settings s
   WHERE s.key = 'market_purchase_policy'
$fn$;

-- 3-3. 패키지 주문 판정: 구성·받은 것·환불된 것·정가 합. 쓰기 없음.
--   받은 것: 이 주문 다운로드의 서브상품과 같은 분류의 구성(활성 서브상품은 분류당 하나 — 교체본은 같은 분류).
--   문제(PDF)는 question_pdf 를 받았거나, question_hwp 파일을 받은 시각에 그 HWP 자료에 활성 PDF 파일이 있었으면 받은 것.
--   구성과 다른 분류의 추가 자료는 영향 없음. 환불된 것: 승인 요청들의 대상 합집합(전체 승인은 구성 전부).
CREATE OR REPLACE FUNCTION public.market_bundle_refund_state(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_composition jsonb;
  v_provided uuid[];
  v_refunded uuid[];
  v_list_sum integer;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('subproduct_id', c.subproduct_id, 'slug', c.category_slug,
                                               'price', c.list_price_credits) ORDER BY c.category_slug, c.subproduct_id), '[]'::jsonb),
         COALESCE(sum(c.list_price_credits), 0)::integer
    INTO v_composition, v_list_sum
    FROM public.market_bundle_line_components c
    JOIN public.market_purchase_lines l ON l.id = c.line_id
   WHERE l.order_id = p_order_id;

  WITH downloads AS (
    SELECT DISTINCT s.id AS subproduct_id, COALESCE(sc.slug, 'uncategorized') AS slug, d.created_at
      FROM public.market_download_events d
      JOIN public.market_subproduct_files f ON f.id = d.subproduct_file_id
      JOIN public.market_item_subproducts s ON s.id = f.subproduct_id
      LEFT JOIN public.market_subproduct_categories sc ON sc.id = s.category_id
     WHERE d.order_id = p_order_id AND d.event_target_type = 'subproduct_file'
  )
  SELECT COALESCE(array_agg(DISTINCT c.subproduct_id), '{}')
    INTO v_provided
    FROM public.market_bundle_line_components c
    JOIN public.market_purchase_lines l ON l.id = c.line_id
   WHERE l.order_id = p_order_id
     AND (
       EXISTS (SELECT 1 FROM downloads dl WHERE dl.slug = c.category_slug)
       OR (c.category_slug = 'question_pdf' AND EXISTS (
         SELECT 1 FROM downloads dl
          WHERE dl.slug = 'question_hwp'
            AND EXISTS (
              SELECT 1 FROM public.market_subproduct_files f2
                JOIN public.market_file_types ft ON ft.id = f2.file_type_id
               WHERE f2.subproduct_id = dl.subproduct_id
                 AND lower(ft.code) = 'pdf'
                 AND f2.created_at <= dl.created_at
                 AND (f2.deleted_at IS NULL OR f2.deleted_at > dl.created_at)
            )
       ))
     );

  SELECT CASE
           WHEN bool_or(r.refund_kind = 'full') THEN
             (SELECT COALESCE(array_agg(c.subproduct_id), '{}') FROM public.market_bundle_line_components c
                JOIN public.market_purchase_lines l ON l.id = c.line_id WHERE l.order_id = p_order_id)
           ELSE COALESCE((SELECT array_agg(DISTINCT x) FROM public.market_refund_requests r2, unnest(r2.refund_subproduct_ids) x
                           WHERE r2.order_id = p_order_id AND r2.status = 'approved'), '{}')
         END
    INTO v_refunded
    FROM public.market_refund_requests r
   WHERE r.order_id = p_order_id AND r.status = 'approved';

  RETURN jsonb_build_object(
    'composition', v_composition,
    'provided', to_jsonb(COALESCE(v_provided, '{}')),
    'refunded', to_jsonb(COALESCE(v_refunded, '{}'::uuid[])),
    'list_sum', v_list_sum,
    'download_count', (SELECT count(*) FROM public.market_download_events d WHERE d.order_id = p_order_id)
  );
END;
$fn$;

-- 3-4. 대상 금액: 남는 구성이 없으면 남은 금액 전부, 아니면 정가 비율(버림). 남은 금액(charged − committed)을 넘지 않음.
CREATE OR REPLACE FUNCTION public.market_bundle_refund_amount(p_order_id uuid, p_targets uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.market_purchase_orders%ROWTYPE;
  v_state jsonb;
  v_target_sum integer;
  v_left integer;
  v_remaining_count integer;
BEGIN
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id;
  v_state := public.market_bundle_refund_state(p_order_id);
  v_left := v_order.charged_credits - v_order.refund_committed_credits;
  IF (v_state ->> 'list_sum')::integer <= 0 OR p_targets IS NULL OR cardinality(p_targets) = 0 THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(sum((e ->> 'price')::integer), 0)::integer INTO v_target_sum
    FROM jsonb_array_elements(v_state -> 'composition') e
   WHERE (e ->> 'subproduct_id')::uuid = ANY (p_targets);
  SELECT count(*) INTO v_remaining_count
    FROM jsonb_array_elements(v_state -> 'composition') e
   WHERE NOT ((e ->> 'subproduct_id')::uuid = ANY (p_targets))
     AND NOT ((e ->> 'subproduct_id') IN (SELECT jsonb_array_elements_text(v_state -> 'refunded')));
  IF v_remaining_count = 0 THEN
    RETURN GREATEST(v_left, 0);
  END IF;
  RETURN LEAST(GREATEST(v_left, 0),
               floor(v_order.charged_credits::numeric * v_target_sum / (v_state ->> 'list_sum')::numeric)::integer);
END;
$fn$;

-- 3-5. 업그레이드 기준 주문을 막는 업그레이드 주문(HWP 차액) — completed 이고 남은 금액이 있으면 그 id.
CREATE OR REPLACE FUNCTION public.market_order_upgrade_blocker(p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT u.id
    FROM public.market_purchase_orders base
    JOIN public.market_checkout_batches b ON b.user_id = base.user_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.result_payload -> 'orders', '[]'::jsonb)) o
    JOIN public.market_purchase_orders u ON u.id = NULLIF(o ->> 'orderId', '')::uuid
   WHERE base.id = p_order_id
     AND o ->> 'upgradeBaseOrderId' = p_order_id::text
     AND u.status = 'completed'
     AND u.refund_committed_credits < u.charged_credits
   LIMIT 1
$fn$;

-- 3-6. 환불 엔진 ① 배정(쓰기 없음, 원천 FOR UPDATE). 호출자가 profiles·요청·주문을 잠근 뒤 부른다.
--   원천별 남은 소비 = 주문 소비 − 이전 승인 요청 taken 합. 남은 소비 > 0 인 원천 중 하나라도
--   현금 환불 이력·pending_refund·열린 충전 환불·처리 안 된 취소 표시·refunded 이면 NEEDS_OWNER(in_progress 는 취소가 아직 진행 중인지).
--   아니면 소비 역순으로: 복구 가능(active·남은 기간 ≥ min(구매 때 남은 기간, 30일), 원천 상한 안) → 복구,
--   만료·기간 미달 active → 재지급(유효기간 = 지금 + 구매 때 남은 기간, 최소 1일), 상한 초과 → unrecovered(capped),
--   소비 내역 결손 → unrecovered(unmatched).
CREATE OR REPLACE FUNCTION public.market_refund_allocate(p_order_id uuid, p_amount integer, p_exclude uuid[] DEFAULT '{}')
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_order public.market_purchase_orders%ROWTYPE;
  v_src record;
  v_source public.credit_sources%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_left integer := p_amount;
  v_take integer;
  v_cap integer;
  v_restore integer;
  v_restored integer := 0;
  v_reissued integer := 0;
  v_unrecovered integer := 0;
  v_needs_owner boolean := false;
  v_in_progress boolean := false;
  v_flags jsonb := '[]'::jsonb;
  v_po uuid;
  v_has_cash boolean;
  v_open boolean;
  v_marker boolean;
  v_reason text;
  v_purchase_left interval;
BEGIN
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id;
  IF NOT FOUND OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('code', 'INVALID');
  END IF;

  FOR v_src IN
    WITH cons AS (
      SELECT NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
             COALESCE((e ->> 'amount')::integer, 0) AS amount, ord
        FROM jsonb_array_elements(COALESCE(v_order.credit_consumptions, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    ), grouped AS (
      SELECT source_id, sum(amount)::integer AS consumed, min(ord) AS first_ord
        FROM cons WHERE source_id IS NOT NULL AND amount > 0 GROUP BY source_id
    ), prior AS (
      SELECT (x ->> 'source_id')::uuid AS source_id, sum(COALESCE((x ->> 'taken')::integer, 0))::integer AS taken
        FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
       WHERE r.order_id = p_order_id AND r.status = 'approved' AND x ? 'source_id' AND (x ->> 'source_id') IS NOT NULL
       GROUP BY 1
    )
    SELECT g.source_id, GREATEST(g.consumed - COALESCE(p.taken, 0), 0) AS remaining_consumed, g.first_ord
      FROM grouped g LEFT JOIN prior p ON p.source_id = g.source_id
     ORDER BY g.first_ord DESC
  LOOP
    CONTINUE WHEN v_src.remaining_consumed <= 0 OR v_src.source_id = ANY (COALESCE(p_exclude, '{}'));

    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_src.source_id AND user_id = v_order.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;

    v_po := COALESCE(v_source.payment_order_id,
                     (SELECT rr.payment_order_id FROM public.refund_requests rr WHERE rr.source_id = v_source.id
                       AND rr.payment_order_id IS NOT NULL ORDER BY rr.created_at LIMIT 1));
    v_has_cash := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_source.id AND rr.status = 'completed');
    v_open := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_source.id
                       AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review'));
    v_marker := v_po IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.payment_provider_transactions t
       WHERE t.payment_order_id = v_po
         AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
           OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL)));

    IF v_has_cash OR v_open OR v_marker OR v_source.status <> 'active' THEN
      v_needs_owner := true;
      IF v_open OR v_marker OR v_source.status = 'pending_refund' THEN
        v_in_progress := true;
      END IF;
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'remaining_consumed', v_src.remaining_consumed, 'status', v_source.status,
        'cash_refunded', v_has_cash, 'refund_open', v_open, 'cancel_marker', v_marker));
    END IF;
  END LOOP;

  IF v_needs_owner THEN
    RETURN jsonb_build_object('code', 'NEEDS_OWNER', 'in_progress', v_in_progress, 'owner_sources', v_flags);
  END IF;

  FOR v_src IN
    WITH cons AS (
      SELECT NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
             COALESCE((e ->> 'amount')::integer, 0) AS amount, ord
        FROM jsonb_array_elements(COALESCE(v_order.credit_consumptions, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    ), grouped AS (
      SELECT source_id, sum(amount)::integer AS consumed, min(ord) AS first_ord
        FROM cons WHERE source_id IS NOT NULL AND amount > 0 GROUP BY source_id
    ), prior AS (
      SELECT (x ->> 'source_id')::uuid AS source_id, sum(COALESCE((x ->> 'taken')::integer, 0))::integer AS taken
        FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
       WHERE r.order_id = p_order_id AND r.status = 'approved' AND (x ->> 'source_id') IS NOT NULL
       GROUP BY 1
    )
    SELECT g.source_id, GREATEST(g.consumed - COALESCE(p.taken, 0), 0) AS remaining_consumed, g.first_ord
      FROM grouped g LEFT JOIN prior p ON p.source_id = g.source_id
     ORDER BY g.first_ord DESC
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN v_src.remaining_consumed <= 0 OR v_src.source_id = ANY (COALESCE(p_exclude, '{}'));
    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_src.source_id FOR UPDATE;
    v_take := LEAST(v_src.remaining_consumed, v_left);
    v_purchase_left := CASE WHEN v_source.expires_at IS NULL THEN NULL ELSE v_source.expires_at - v_order.created_at END;

    IF v_source.expires_at IS NULL
       OR (v_source.expires_at > v_now AND v_source.expires_at - v_now >= LEAST(v_purchase_left, interval '30 days')) THEN
      v_cap := GREATEST(v_source.initial_credits - v_source.remaining_credits, 0);
      v_restore := LEAST(v_take, v_cap);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'taken', v_take, 'restored', v_restore, 'reissued', 0,
        'unrecovered', v_take - v_restore, 'reason', CASE WHEN v_take > v_restore THEN 'capped' END));
      v_restored := v_restored + v_restore;
      v_unrecovered := v_unrecovered + (v_take - v_restore);
    ELSE
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'taken', v_take, 'restored', 0, 'reissued', v_take, 'unrecovered', 0,
        'reason', NULL,
        'reissued_expires_at', v_now + GREATEST(v_purchase_left, interval '1 day')));
      v_reissued := v_reissued + v_take;
    END IF;
    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'source_id', NULL, 'taken', v_left, 'restored', 0, 'reissued', 0, 'unrecovered', v_left, 'reason', 'unmatched'));
    v_unrecovered := v_unrecovered + v_left;
  END IF;

  RETURN jsonb_build_object('code', 'OK', 'items', v_items, 'requested', p_amount,
    'restored', v_restored, 'reissued', v_reissued, 'unrecovered', v_unrecovered,
    'restorable', v_restored + v_reissued);
END;
$fn$;

-- 3-7. 환불 엔진 ② 실행(배정대로). 재지급 원천 먼저 → refund_credits(최종 잔액) → 재지급 거래·연결 → 누계·상태 → 요청 approved.
CREATE OR REPLACE FUNCTION public.market_refund_settle(p_request_id uuid, p_admin_id uuid, p_allocation jsonb, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_request public.market_refund_requests%ROWTYPE;
  v_order public.market_purchase_orders%ROWTYPE;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_restore_items jsonb := '[]'::jsonb;
  v_reissue jsonb := '[]'::jsonb;
  v_restored integer := 0;
  v_reissued integer := 0;
  v_unrecovered integer := 0;
  v_new_source uuid;
  v_refund jsonb;
  v_new_balance integer;
  v_note text;
  v_reasons text;
BEGIN
  SELECT * INTO v_request FROM public.market_refund_requests WHERE id = p_request_id;
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = v_request.order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocation -> 'items')
  LOOP
    IF COALESCE((v_item ->> 'reissued')::integer, 0) > 0 THEN
      INSERT INTO public.credit_sources (user_id, plan_id, initial_credits, remaining_credits, status, source_category, expires_at)
      VALUES (v_request.user_id, NULL, (v_item ->> 'reissued')::integer, (v_item ->> 'reissued')::integer, 'active',
              'system_refund', NULLIF(v_item ->> 'reissued_expires_at', '')::timestamptz)
      RETURNING id INTO v_new_source;
      v_item := v_item || jsonb_build_object('reissued_source_id', v_new_source);
      v_reissue := v_reissue || jsonb_build_array(v_item);
      v_reissued := v_reissued + (v_item ->> 'reissued')::integer;
    END IF;
    IF COALESCE((v_item ->> 'restored')::integer, 0) > 0 THEN
      v_restore_items := v_restore_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_item ->> 'source_id', 'amount', (v_item ->> 'restored')::integer));
      v_restored := v_restored + (v_item ->> 'restored')::integer;
    END IF;
    v_unrecovered := v_unrecovered + COALESCE((v_item ->> 'unrecovered')::integer, 0);
    v_items := v_items || jsonb_build_array(v_item);
  END LOOP;

  IF v_restored + v_reissued + v_unrecovered <> v_request.requested_refund_credits THEN
    RAISE EXCEPTION 'MARKET_REFUND_AMOUNT_MISMATCH';
  END IF;

  IF v_restored > 0 THEN
    v_refund := public.refund_credits(v_request.user_id, v_restored, 'market_refund', v_request.id, '문제마켓 구매 환불', v_restore_items);
    IF (v_refund ->> 'refunded')::integer <> v_restored OR (v_refund ->> 'skipped')::integer <> 0 THEN
      RAISE EXCEPTION 'MARKET_REFUND_AMOUNT_MISMATCH';
    END IF;
    v_new_balance := (v_refund ->> 'new_balance')::integer;
  ELSE
    SELECT COALESCE(sum(remaining_credits), 0)::integer INTO v_new_balance
      FROM public.credit_sources
     WHERE user_id = v_request.user_id AND status IN ('active', 'pending_refund') AND (expires_at IS NULL OR expires_at > v_now);
    UPDATE public.profiles SET credits = v_new_balance WHERE id = v_request.user_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_reissue)
  LOOP
    INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id,
                                            resource_type, resource_id, operation_key)
    VALUES (v_request.user_id, 'refund', (v_item ->> 'reissued')::integer, v_new_balance,
            '문제마켓 구매 환불(유효기간이 지난 크레딧을 다시 지급)', (v_item ->> 'reissued_source_id')::uuid,
            'market_refund', v_request.id,
            'market_refund_reissue:' || v_request.id::text || ':' || COALESCE(v_item ->> 'source_id', 'none'));
    INSERT INTO public.market_refund_reissued_sources (source_id, request_id, original_source_id)
    VALUES ((v_item ->> 'reissued_source_id')::uuid, v_request.id, NULLIF(v_item ->> 'source_id', '')::uuid);
  END LOOP;

  UPDATE public.market_purchase_orders
     SET refund_committed_credits = refund_committed_credits + v_request.requested_refund_credits,
         refunded_credits = refunded_credits + v_restored + v_reissued
   WHERE id = v_order.id
  RETURNING * INTO v_order;
  IF v_order.refund_committed_credits = v_order.charged_credits THEN
    UPDATE public.market_purchase_orders SET status = 'refunded' WHERE id = v_order.id;
    UPDATE public.market_purchase_lines SET status = 'refunded' WHERE order_id = v_order.id;
  END IF;

  SELECT string_agg(DISTINCT x ->> 'reason', ',') INTO v_reasons
    FROM jsonb_array_elements(v_items) x WHERE (x ->> 'reason') IS NOT NULL;
  v_note := p_note;
  IF v_unrecovered > 0 THEN
    v_note := concat_ws(E'\n', NULLIF(p_note, ''),
      format('[미지급 %s크레딧: %s. 보상 여부는 관리자 판단]', v_unrecovered, COALESCE(v_reasons, '-')));
  END IF;

  UPDATE public.market_refund_requests
     SET status = 'approved',
         approved_refund_credits = v_restored + v_reissued,
         allocated_items = v_items,
         admin_note = v_note,
         processed_by = p_admin_id,
         processed_at = v_now
   WHERE id = v_request.id;

  IF v_unrecovered > 0 THEN
    PERFORM public.record_payment_alert(
      'MARKET_REFUND_SHORTFALL', 'warning',
      '문제마켓 환불을 미지급분과 함께 승인했습니다. 보상이 필요한지 확인하세요.',
      jsonb_build_object('request_id', v_request.id, 'user_id', v_request.user_id,
                         'requested', v_request.requested_refund_credits, 'refunded', v_restored + v_reissued,
                         'shortfall', v_unrecovered, 'actor_id', p_admin_id,
                         'sources', (SELECT jsonb_agg(jsonb_build_object('source_id', x -> 'source_id', 'reason', x -> 'reason',
                                                                        'amount', x -> 'unrecovered'))
                                       FROM jsonb_array_elements(v_items) x WHERE COALESCE((x ->> 'unrecovered')::integer, 0) > 0),
                         'dedupe_key', 'market_refund:' || v_request.id::text));
  END IF;

  RETURN jsonb_build_object('new_balance', v_new_balance, 'restored', v_restored, 'reissued', v_reissued,
                            'unrecovered', v_unrecovered);
END;
$fn$;

-- 3-8. 이용권 재구성(멱등). 서브상품 주문 먼저(회수), 그다음 패키지 주문(남길 집합과 정확히 맞춤).
CREATE OR REPLACE FUNCTION public.market_rebuild_order_entitlements(p_user_id uuid, p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.market_purchase_orders%ROWTYPE;
  v_state jsonb;
  v_keep uuid[];
  v_item_ent public.market_entitlements%ROWTYPE;
  v_has_item boolean;
  v_sub uuid;
  v_sub_active boolean;
  v_slug text;
  v_replacement uuid;
  v_repl_count integer;
BEGIN
  FOR v_order IN
    SELECT * FROM public.market_purchase_orders
     WHERE user_id = p_user_id AND item_id = p_item_id AND purchase_type = 'subproduct'
     ORDER BY created_at, id
  LOOP
    IF v_order.status <> 'completed' OR v_order.refund_committed_credits >= v_order.charged_credits THEN
      UPDATE public.market_entitlements SET status = 'refunded'
       WHERE source_order_id = v_order.id AND status = 'active';
    END IF;
  END LOOP;

  FOR v_order IN
    SELECT * FROM public.market_purchase_orders
     WHERE user_id = p_user_id AND item_id = p_item_id AND purchase_type = 'bundle'
     ORDER BY created_at, id
  LOOP
    CONTINUE WHEN v_order.refund_committed_credits = 0;

    SELECT * INTO v_item_ent FROM public.market_entitlements
     WHERE source_order_id = v_order.id AND scope = 'item'
     ORDER BY created_at LIMIT 1;
    v_has_item := FOUND;
    IF v_has_item AND v_item_ent.status = 'active' THEN
      UPDATE public.market_entitlements SET status = 'refunded' WHERE id = v_item_ent.id;
    END IF;

    v_keep := '{}';
    IF v_order.status = 'completed' AND v_order.refund_committed_credits < v_order.charged_credits
       AND NOT (v_has_item AND v_item_ent.status = 'revoked') THEN
      v_state := public.market_bundle_refund_state(v_order.id);
      -- 남는 구성(비활성·삭제면 같은 분류의 활성 서브상품으로 대체)
      FOR v_sub, v_slug IN
        SELECT (e ->> 'subproduct_id')::uuid, e ->> 'slug'
          FROM jsonb_array_elements(v_state -> 'composition') e
         WHERE NOT ((e ->> 'subproduct_id') IN (SELECT jsonb_array_elements_text(v_state -> 'refunded')))
      LOOP
        SELECT s.is_active AND s.deleted_at IS NULL INTO v_sub_active FROM public.market_item_subproducts s WHERE s.id = v_sub;
        IF COALESCE(v_sub_active, false) THEN
          v_keep := array_append(v_keep, v_sub);
        ELSE
          SELECT count(*), min(s.id::text)::uuid INTO v_repl_count, v_replacement
            FROM public.market_item_subproducts s
            JOIN public.market_subproduct_categories c ON c.id = s.category_id
           WHERE s.item_id = p_item_id AND s.is_active AND s.deleted_at IS NULL AND c.slug = v_slug;
          IF v_repl_count = 1 THEN
            v_keep := array_append(v_keep, v_replacement);
          ELSIF v_repl_count > 1 THEN
            PERFORM public.record_payment_alert('MARKET_REFUND_REPLACEMENT_AMBIGUOUS', 'warning',
              '패키지 일부 환불 뒤 남길 자료의 교체본을 하나로 정하지 못했습니다. 이용권을 확인하세요.',
              jsonb_build_object('order_id', v_order.id, 'slug', v_slug,
                                 'dedupe_key', 'market_refund_replacement:' || v_order.id::text || ':' || v_slug));
          END IF;
        END IF;
      END LOOP;
      -- 이 주문으로 받은 구성과 다른 분류의 추가 자료
      v_keep := v_keep || COALESCE((
        SELECT array_agg(DISTINCT s.id)
          FROM public.market_download_events d
          JOIN public.market_subproduct_files f ON f.id = d.subproduct_file_id
          JOIN public.market_item_subproducts s ON s.id = f.subproduct_id
          LEFT JOIN public.market_subproduct_categories c ON c.id = s.category_id
         WHERE d.order_id = v_order.id
           AND s.is_active AND s.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_state -> 'composition') e
                            WHERE e ->> 'slug' = COALESCE(c.slug, 'uncategorized'))
      ), '{}');
    END IF;

    UPDATE public.market_entitlements SET status = 'refunded'
     WHERE source_order_id = v_order.id AND scope = 'subproduct' AND status = 'active'
       AND NOT (subproduct_id = ANY (v_keep));

    FOREACH v_sub IN ARRAY v_keep
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.market_entitlements e
                      WHERE e.user_id = p_user_id AND e.subproduct_id = v_sub AND e.scope = 'subproduct' AND e.status = 'active') THEN
        INSERT INTO public.market_entitlements (workspace_subject, user_id, item_id, scope, subproduct_id, file_id, source_order_id, status)
        VALUES (v_order.workspace_subject, p_user_id, p_item_id, 'subproduct', v_sub, NULL, v_order.id, 'active');
      END IF;
    END LOOP;
  END LOOP;
END;
$fn$;

-- 3-9. 부분 환불 판정(쓰기 없음): 기준 시각 기준 기간·대상·금액. 신청·미리보기·고객센터 철회가 같이 쓴다.
CREATE OR REPLACE FUNCTION public.market_partial_refund_calc(p_order_id uuid, p_base_time timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.market_purchase_orders%ROWTYPE;
  v_days integer;
  v_deadline timestamptz;
  v_state jsonb;
  v_targets uuid[];
  v_amount integer;
BEGIN
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status <> 'completed' OR v_order.purchase_type <> 'bundle' THEN
    RETURN jsonb_build_object('code', 'NOT_ELIGIBLE');
  END IF;
  v_days := public.market_purchase_refund_days();
  IF v_days IS NULL THEN
    RETURN jsonb_build_object('code', 'POLICY_UNAVAILABLE');
  END IF;
  v_deadline := public.market_refund_deadline(v_order.created_at, v_days);
  IF NOT (p_base_time < v_deadline) THEN
    RETURN jsonb_build_object('code', 'REFUND_PERIOD_EXPIRED', 'deadline', v_deadline);
  END IF;
  v_state := public.market_bundle_refund_state(p_order_id);
  IF jsonb_array_length(v_state -> 'composition') = 0 OR (v_state ->> 'list_sum')::integer <= 0 THEN
    RETURN jsonb_build_object('code', 'COMPOSITION_UNKNOWN');
  END IF;
  IF (v_state ->> 'download_count')::integer = 0 AND v_order.refund_committed_credits = 0 THEN
    RETURN jsonb_build_object('code', 'FULL_REFUND_AVAILABLE', 'deadline', v_deadline);
  END IF;
  SELECT COALESCE(array_agg((e ->> 'subproduct_id')::uuid), '{}') INTO v_targets
    FROM jsonb_array_elements(v_state -> 'composition') e
   WHERE NOT ((e ->> 'subproduct_id') IN (SELECT jsonb_array_elements_text(v_state -> 'provided')))
     AND NOT ((e ->> 'subproduct_id') IN (SELECT jsonb_array_elements_text(v_state -> 'refunded')));
  IF cardinality(v_targets) = 0 THEN
    RETURN jsonb_build_object('code', 'NOTHING_TO_REFUND', 'deadline', v_deadline, 'provided', v_state -> 'provided');
  END IF;
  v_amount := public.market_bundle_refund_amount(p_order_id, v_targets);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('code', 'NOTHING_TO_REFUND', 'deadline', v_deadline, 'provided', v_state -> 'provided');
  END IF;
  RETURN jsonb_build_object('code', 'OK', 'targets', to_jsonb(v_targets), 'amount', v_amount, 'deadline', v_deadline,
                            'provided', v_state -> 'provided', 'state', v_state);
END;
$fn$;

-- 3-10. 미리보기(service_role, 잠금 없음) — 보관함·관리자 화면이 같은 판정을 보여 준다.
CREATE OR REPLACE FUNCTION public.preview_market_partial_refund(p_user_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_latest public.market_refund_requests%ROWTYPE;
  v_base timestamptz := now();
  v_prior_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.market_purchase_orders WHERE id = p_order_id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_refund_requests WHERE order_id = p_order_id AND status = 'pending') THEN
    RETURN jsonb_build_object('code', 'ALREADY_PENDING');
  END IF;
  -- 신청 함수(3-11)와 같은 규칙: 가장 최근 요청이 '판정 근거가 바뀜'으로 거부된 부분 신청이고 아직 이어진 신청이 없으면
  -- 그 신청 시각으로 판정하고, 이어서 신청할 앞 신청 id 를 함께 돌려준다.
  SELECT * INTO v_latest FROM public.market_refund_requests WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_latest.user_id = p_user_id AND v_latest.refund_kind = 'partial' AND v_latest.status = 'rejected'
     AND v_latest.reject_code = 'TARGET_CHANGED'
     AND NOT EXISTS (SELECT 1 FROM public.market_refund_requests r3 WHERE r3.prior_request_id = v_latest.id) THEN
    v_base := LEAST(now(), COALESCE(v_latest.claim_received_at, v_latest.created_at));
    v_prior_id := v_latest.id;
  END IF;
  RETURN (public.market_partial_refund_calc(p_order_id, v_base) - 'state') || jsonb_build_object('prior_request_id', v_prior_id);
END;
$fn$;

-- 3-11. 부분 환불 신청(회원, service_role)
CREATE OR REPLACE FUNCTION public.request_market_partial_refund(p_user_id uuid, p_order_id uuid, p_expected_credits integer,
                                                               p_reason text, p_prior_request_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.market_purchase_orders%ROWTYPE;
  v_prior public.market_refund_requests%ROWTYPE;
  v_base timestamptz := now();
  v_calc jsonb;
  v_id uuid;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_refund_requests WHERE order_id = p_order_id AND status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_PENDING');
  END IF;
  IF p_prior_request_id IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.market_refund_requests WHERE id = p_prior_request_id;
    IF FOUND AND v_prior.user_id = p_user_id AND v_prior.order_id = p_order_id AND v_prior.refund_kind = 'partial'
       AND v_prior.status = 'rejected' AND v_prior.reject_code = 'TARGET_CHANGED'
       AND NOT EXISTS (SELECT 1 FROM public.market_refund_requests r2
                        WHERE r2.order_id = p_order_id AND r2.created_at > v_prior.created_at)
       AND NOT EXISTS (SELECT 1 FROM public.market_refund_requests r3 WHERE r3.prior_request_id = p_prior_request_id) THEN
      v_base := LEAST(now(), COALESCE(v_prior.claim_received_at, v_prior.created_at));
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'PRIOR_NOT_ELIGIBLE');
    END IF;
  END IF;

  v_calc := public.market_partial_refund_calc(p_order_id, v_base);
  IF v_calc ->> 'code' <> 'OK' THEN
    RETURN jsonb_build_object('ok', false, 'code', v_calc ->> 'code', 'details', v_calc - 'state');
  END IF;
  IF p_expected_credits IS DISTINCT FROM (v_calc ->> 'amount')::integer THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_CHANGED', 'details', v_calc - 'state');
  END IF;

  BEGIN
    INSERT INTO public.market_refund_requests (
      workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, status, reason,
      eligibility_snapshot, refund_kind, refund_subproduct_ids, claim_received_at, claim_channel, prior_request_id)
    VALUES (v_order.workspace_subject, p_user_id, v_order.item_id, 'v2_order', p_order_id, (v_calc ->> 'amount')::integer,
            'pending', NULLIF(btrim(p_reason), ''),
            jsonb_build_object('kind', 'partial', 'judged_at', now(), 'base_time', v_base, 'calc', v_calc),
            'partial', ARRAY(SELECT jsonb_array_elements_text(v_calc -> 'targets'))::uuid[], v_base, 'library',
            p_prior_request_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_PENDING');
  END;
  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'amount', (v_calc ->> 'amount')::integer,
                            'targets', v_calc -> 'targets');
END;
$fn$;

-- 3-12. 전체 환불 승인 재정의(시그니처 그대로). v2 는 엔진·재구성, legacy 는 예전 단계 그대로. 거절은 예전처럼 RAISE.
CREATE OR REPLACE FUNCTION public.approve_market_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_confirmed_refund_credits integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid;
  v_request public.market_refund_requests%ROWTYPE;
  v_order public.market_purchase_orders%ROWTYPE;
  v_consumptions jsonb;
  v_item jsonb;
  v_source_id uuid;
  v_amount integer;
  v_take integer;
  v_remaining_request integer;
  v_source public.credit_sources%ROWTYPE;
  v_allocated jsonb := '{}'::jsonb;
  v_already integer;
  v_alloc integer;
  v_restorable integer := 0;
  v_shortfall integer;
  v_restore_items jsonb := '[]'::jsonb;
  v_refund jsonb;
  v_new_balance integer;
  v_note text;
  v_plan jsonb;
  v_settle jsonb;
BEGIN
  SELECT user_id INTO v_user_id FROM public.market_refund_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MARKET_REFUND_NOT_FOUND';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;
  SELECT * INTO v_request FROM public.market_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MARKET_REFUND_NOT_FOUND';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'MARKET_REFUND_NOT_PENDING';
  END IF;

  IF v_request.target_kind = 'v2_order' THEN
    IF v_request.refund_kind <> 'full' THEN
      RAISE EXCEPTION 'MARKET_REFUND_KIND_MISMATCH';
    END IF;
    SELECT * INTO v_order FROM public.market_purchase_orders
     WHERE id = v_request.order_id AND user_id = v_request.user_id AND status = 'completed'
     FOR UPDATE;
    IF NOT FOUND OR v_order.refund_committed_credits <> 0 THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
    IF EXISTS (SELECT 1 FROM public.market_download_events WHERE order_id = v_request.order_id) THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
    IF public.market_order_upgrade_blocker(v_order.id) IS NOT NULL THEN
      RAISE EXCEPTION 'MARKET_REFUND_UPGRADE_BASE_ORDER';
    END IF;
    IF v_request.requested_refund_credits <> v_order.charged_credits THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
    PERFORM 1 FROM public.market_purchase_lines WHERE order_id = v_order.id FOR UPDATE;

    v_plan := public.market_refund_allocate(v_order.id, v_request.requested_refund_credits);
    IF v_plan ->> 'code' = 'NEEDS_OWNER' THEN
      RAISE EXCEPTION 'MARKET_REFUND_NEEDS_OWNER' USING DETAIL = (v_plan - 'owner_sources')::text;
    ELSIF v_plan ->> 'code' <> 'OK' THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
    v_restorable := (v_plan ->> 'restorable')::integer;
    IF (p_confirmed_refund_credits IS NULL AND v_restorable <> v_request.requested_refund_credits)
       OR (p_confirmed_refund_credits IS NOT NULL AND p_confirmed_refund_credits <> v_restorable) THEN
      RAISE EXCEPTION 'MARKET_REFUND_SHORTFALL'
        USING DETAIL = jsonb_build_object(
          'requested', v_request.requested_refund_credits, 'restorable', v_restorable,
          'restored', (v_plan ->> 'restored')::integer, 'reissued', (v_plan ->> 'reissued')::integer,
          'unrecovered', (v_plan ->> 'unrecovered')::integer,
          'sources', (SELECT jsonb_agg(jsonb_build_object('source_id', x -> 'source_id', 'reason', x -> 'reason', 'amount', x -> 'unrecovered'))
                        FROM jsonb_array_elements(v_plan -> 'items') x WHERE COALESCE((x ->> 'unrecovered')::integer, 0) > 0)
        )::text;
    END IF;

    v_settle := public.market_refund_settle(v_request.id, p_admin_id, v_plan, p_admin_note);
    UPDATE public.market_entitlements SET status = 'refunded' WHERE source_order_id = v_order.id AND status = 'active';
    PERFORM public.market_rebuild_order_entitlements(v_order.user_id, v_order.item_id);

    SELECT * INTO v_request FROM public.market_refund_requests WHERE id = v_request.id;
    RETURN to_jsonb(v_request) || jsonb_build_object(
      'new_balance', (v_settle ->> 'new_balance')::integer,
      'shortfall', (v_settle ->> 'unrecovered')::integer
    );
  ELSIF v_request.target_kind = 'legacy_purchase' THEN
    SELECT credit_consumptions INTO v_consumptions
      FROM public.market_purchases
     WHERE id = v_request.legacy_purchase_id AND user_id = v_request.user_id AND status = 'completed'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
  ELSE
    RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
  END IF;

  -- 아래는 옛 구매(legacy_purchase) 경로 — 예전 단계 그대로(운영 0행).
  IF EXISTS (SELECT 1 FROM public.market_download_events WHERE purchase_id = v_request.legacy_purchase_id) THEN
    RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
  END IF;
  IF v_consumptions IS NULL OR jsonb_typeof(v_consumptions) <> 'array' OR jsonb_array_length(v_consumptions) = 0 THEN
    RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
  END IF;

  v_remaining_request := v_request.requested_refund_credits;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_consumptions)
  LOOP
    EXIT WHEN v_remaining_request <= 0;
    v_source_id := NULLIF(COALESCE(v_item->>'source_id', v_item->>'sourceId'), '')::uuid;
    v_amount := COALESCE((v_item->>'amount')::integer, 0);
    IF v_source_id IS NULL OR v_amount <= 0 THEN
      CONTINUE;
    END IF;
    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_source_id AND user_id = v_request.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;
    v_take := LEAST(v_amount, v_remaining_request);
    IF v_source.status IN ('active', 'pending_refund') AND (v_source.expires_at IS NULL OR v_source.expires_at > v_now) THEN
      v_already := COALESCE((v_allocated->>v_source_id::text)::integer, 0);
      v_alloc := GREATEST(LEAST(v_take, v_source.initial_credits - v_source.remaining_credits - v_already), 0);
      IF v_alloc > 0 THEN
        v_restore_items := v_restore_items || jsonb_build_array(jsonb_build_object('source_id', v_source_id, 'amount', v_alloc));
        v_allocated := v_allocated || jsonb_build_object(v_source_id::text, v_already + v_alloc);
        v_restorable := v_restorable + v_alloc;
      END IF;
    END IF;
    v_remaining_request := v_remaining_request - v_take;
  END LOOP;
  v_shortfall := v_request.requested_refund_credits - v_restorable;
  IF (p_confirmed_refund_credits IS NULL AND v_restorable <> v_request.requested_refund_credits)
     OR (p_confirmed_refund_credits IS NOT NULL AND p_confirmed_refund_credits <> v_restorable) THEN
    RAISE EXCEPTION 'MARKET_REFUND_SHORTFALL'
      USING DETAIL = jsonb_build_object('requested', v_request.requested_refund_credits, 'restorable', v_restorable)::text;
  END IF;
  IF v_restorable > 0 THEN
    v_refund := public.refund_credits(v_request.user_id, v_restorable, 'market_refund', v_request.id, '문제마켓 구매 환불', v_restore_items);
    IF (v_refund->>'refunded')::integer <> v_restorable OR (v_refund->>'skipped')::integer <> 0 THEN
      RAISE EXCEPTION 'MARKET_REFUND_AMOUNT_MISMATCH';
    END IF;
    v_new_balance := (v_refund->>'new_balance')::integer;
  ELSE
    SELECT credits INTO v_new_balance FROM public.profiles WHERE id = v_request.user_id;
  END IF;
  UPDATE public.market_purchases SET status = 'refunded', refunded_at = v_now WHERE id = v_request.legacy_purchase_id;
  v_note := p_admin_note;
  IF v_shortfall > 0 THEN
    v_note := concat_ws(E'\n', NULLIF(p_admin_note, ''),
      format('[부족분 %s크레딧: 환불 완료·만료된 원천이라 복구하지 않음. 보상 여부는 관리자 판단]', v_shortfall));
  END IF;
  UPDATE public.market_refund_requests
     SET status = 'approved', approved_refund_credits = v_restorable, admin_note = v_note,
         processed_by = p_admin_id, processed_at = v_now
   WHERE id = v_request.id
  RETURNING * INTO v_request;
  IF v_shortfall > 0 THEN
    PERFORM public.record_payment_alert(
      'MARKET_REFUND_SHORTFALL', 'warning',
      '문제마켓 환불을 부족분과 함께 승인했습니다. 보상이 필요한지 확인하세요.',
      jsonb_build_object('request_id', v_request.id, 'user_id', v_request.user_id,
                         'requested', v_request.requested_refund_credits, 'refunded', v_restorable,
                         'shortfall', v_shortfall, 'actor_id', p_admin_id,
                         'dedupe_key', 'market_refund:' || v_request.id::text));
  END IF;
  RETURN to_jsonb(v_request) || jsonb_build_object('new_balance', v_new_balance, 'shortfall', v_shortfall);
END;
$function$;

-- 3-13. 부분 환불 승인(관리자, service_role). 판정이 바뀌었으면 요청을 TARGET_CHANGED 로 거부해 두고 돌려준다.
CREATE OR REPLACE FUNCTION public.approve_market_partial_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text,
                                                               p_confirmed_refund_credits integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_user_id uuid;
  v_request public.market_refund_requests%ROWTYPE;
  v_order public.market_purchase_orders%ROWTYPE;
  v_calc jsonb;
  v_plan jsonb;
  v_settle jsonb;
  v_same_targets boolean;
BEGIN
  SELECT user_id INTO v_user_id FROM public.market_refund_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT * INTO v_request FROM public.market_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_PENDING');
  END IF;
  IF v_request.refund_kind <> 'partial' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'KIND_MISMATCH');
  END IF;
  IF v_user_id = p_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SELF_TARGET');
  END IF;
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = v_request.order_id FOR UPDATE;
  PERFORM 1 FROM public.market_purchase_lines WHERE order_id = v_order.id FOR UPDATE;

  -- 기간은 다시 보지 않는다(신청 시각 기준). 대상·금액만 다시 판정.
  v_calc := public.market_partial_refund_calc(v_order.id, COALESCE(v_request.claim_received_at, v_request.created_at));
  v_same_targets := v_calc ->> 'code' = 'OK'
    AND (SELECT array_agg(x ORDER BY x) FROM unnest(v_request.refund_subproduct_ids) x)
      = (SELECT array_agg(x::uuid ORDER BY x::uuid) FROM jsonb_array_elements_text(v_calc -> 'targets') x)
    AND (v_calc ->> 'amount')::integer = v_request.requested_refund_credits;
  IF NOT v_same_targets OR v_order.status <> 'completed' THEN
    UPDATE public.market_refund_requests
       SET status = 'rejected', reject_code = 'TARGET_CHANGED',
           admin_note = '신청 뒤 받은 자료나 금액이 바뀌어 처리하지 못했습니다. 같은 주문에서 다시 신청하면 처음 신청한 시각으로 판단합니다.',
           processed_by = p_admin_id, processed_at = now()
     WHERE id = v_request.id;
    RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED', 'details', v_calc - 'state');
  END IF;

  v_plan := public.market_refund_allocate(v_order.id, v_request.requested_refund_credits);
  IF v_plan ->> 'code' = 'NEEDS_OWNER' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NEEDS_OWNER', 'details', v_plan);
  ELSIF v_plan ->> 'code' <> 'OK' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED');
  END IF;
  IF (v_plan ->> 'unrecovered')::integer > 0
     AND p_confirmed_refund_credits IS DISTINCT FROM (v_plan ->> 'restorable')::integer THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MARKET_REFUND_SHORTFALL', 'details', v_plan);
  END IF;

  v_settle := public.market_refund_settle(v_request.id, p_admin_id, v_plan, p_admin_note);
  PERFORM public.market_rebuild_order_entitlements(v_order.user_id, v_order.item_id);
  SELECT * INTO v_request FROM public.market_refund_requests WHERE id = v_request.id;
  RETURN jsonb_build_object('ok', true, 'request', to_jsonb(v_request), 'new_balance', (v_settle ->> 'new_balance')::integer,
                            'shortfall', (v_settle ->> 'unrecovered')::integer);
END;
$fn$;

-- 3-14. 예외 환불(관리자, service_role). defect = 하자·소개와 다름(기간·다운로드 무관, 1건 한도),
--       withdrawal = 연락처로 접수된 받지 않은 자료 환불(판정 강제, 한도 없음; ticket 은 문의 판 시각, email·phone 은 대표만).
CREATE OR REPLACE FUNCTION public.admin_exception_market_refund(
  p_admin_id uuid, p_order_id uuid, p_claim_type text, p_claim_channel text, p_subproduct_ids uuid[],
  p_expected_credits integer, p_expected_committed integer, p_reason text,
  p_support_ticket_id uuid, p_ticket_revision_id uuid, p_claim_received_at timestamptz,
  p_confirmed_refund_credits integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_order public.market_purchase_orders%ROWTYPE;
  v_is_owner boolean;
  v_limits jsonb;
  v_per_request numeric;
  v_base timestamptz;
  v_ticket public.support_tickets%ROWTYPE;
  v_ticket_snapshot jsonb;
  v_state jsonb;
  v_targets uuid[];
  v_amount integer;
  v_calc jsonb;
  v_days integer;
  v_plan jsonb;
  v_request_id uuid;
  v_settle jsonb;
  v_remaining uuid[];
BEGIN
  IF p_claim_type NOT IN ('defect', 'withdrawal') OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INPUT_INVALID');
  END IF;
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF v_order.user_id = p_admin_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SELF_TARGET');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_order.user_id FOR UPDATE;
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id FOR UPDATE;
  PERFORM 1 FROM public.market_purchase_lines WHERE order_id = v_order.id FOR UPDATE;

  SELECT (p.is_admin IS TRUE AND p.admin_role = 'owner') INTO v_is_owner FROM public.profiles p WHERE p.id = p_admin_id;
  v_is_owner := COALESCE(v_is_owner, false);
  IF NOT v_is_owner THEN
    SELECT g.limits INTO v_limits FROM public.admin_permission_grants g
     WHERE g.user_id = p_admin_id AND g.permission = 'refunds.market' FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    END IF;
  END IF;

  IF v_order.status <> 'completed' OR v_order.refund_committed_credits <> COALESCE(p_expected_committed, -1) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_CHANGED', 'details',
      jsonb_build_object('committed', v_order.refund_committed_credits, 'status', v_order.status));
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_refund_requests WHERE order_id = v_order.id AND status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PENDING_REQUEST_EXISTS');
  END IF;
  IF v_order.purchase_type = 'subproduct' AND public.market_order_upgrade_blocker(v_order.id) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UPGRADE_BASE_ORDER');
  END IF;

  -- 접수 시각
  IF p_claim_type = 'withdrawal' THEN
    IF p_claim_channel = 'ticket' THEN
      SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_support_ticket_id;
      IF NOT FOUND OR v_ticket.user_id <> v_order.user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TICKET_INVALID');
      END IF;
      IF p_ticket_revision_id IS NOT NULL THEN
        SELECT written_at INTO v_base FROM public.support_ticket_revisions
         WHERE id = p_ticket_revision_id AND ticket_id = v_ticket.id;
        IF NOT FOUND THEN
          RETURN jsonb_build_object('ok', false, 'code', 'TICKET_INVALID');
        END IF;
      ELSE
        v_base := COALESCE(v_ticket.member_updated_at, v_ticket.created_at);
      END IF;
      IF v_base < v_order.created_at THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TICKET_INVALID');
      END IF;
      SELECT jsonb_build_object(
               'ticket_id', v_ticket.id, 'created_at', v_ticket.created_at, 'member_updated_at', v_ticket.member_updated_at,
               'subject', v_ticket.subject, 'message', v_ticket.message, 'category_id', v_ticket.category_id,
               'revisions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'subject', r.subject, 'message', r.message,
                                                                       'category_id', r.category_id, 'written_at', r.written_at)
                                                    ORDER BY r.written_at)
                                        FROM public.support_ticket_revisions r WHERE r.ticket_id = v_ticket.id), '[]'::jsonb))
        INTO v_ticket_snapshot;
    ELSIF p_claim_channel IN ('email', 'phone') THEN
      IF NOT v_is_owner THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OWNER_ONLY');
      END IF;
      IF p_claim_received_at IS NULL OR p_claim_received_at < v_order.created_at OR p_claim_received_at > now() THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_TIME_INVALID');
      END IF;
      v_base := p_claim_received_at;
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'INPUT_INVALID');
    END IF;
    -- TARGET_CHANGED 로 거부된 앞 부분 신청이 더 이르면 그 시각
    v_base := LEAST(v_base, COALESCE((SELECT min(COALESCE(r.claim_received_at, r.created_at)) FROM public.market_refund_requests r
                                       WHERE r.order_id = v_order.id AND r.status = 'rejected' AND r.reject_code = 'TARGET_CHANGED'), v_base));
  ELSE
    IF p_claim_received_at IS NULL OR p_claim_received_at < v_order.created_at OR p_claim_received_at > now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_TIME_INVALID');
    END IF;
    v_base := p_claim_received_at;
  END IF;

  -- 대상·금액
  IF v_order.purchase_type = 'subproduct' THEN
    IF p_claim_type = 'withdrawal' THEN
      v_days := public.market_purchase_refund_days();
      IF v_days IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'POLICY_UNAVAILABLE');
      END IF;
      IF EXISTS (SELECT 1 FROM public.market_download_events WHERE order_id = v_order.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_DOWNLOADED');
      END IF;
      IF NOT (v_base < public.market_refund_deadline(v_order.created_at, v_days)) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REFUND_PERIOD_EXPIRED');
      END IF;
    END IF;
    v_targets := NULL;
    v_amount := v_order.charged_credits - v_order.refund_committed_credits;
  ELSE
    v_state := public.market_bundle_refund_state(v_order.id);
    IF jsonb_array_length(v_state -> 'composition') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'COMPOSITION_UNKNOWN');
    END IF;
    SELECT COALESCE(array_agg((e ->> 'subproduct_id')::uuid), '{}') INTO v_remaining
      FROM jsonb_array_elements(v_state -> 'composition') e
     WHERE NOT ((e ->> 'subproduct_id') IN (SELECT jsonb_array_elements_text(v_state -> 'refunded')));
    IF p_claim_type = 'withdrawal' THEN
      IF (v_state ->> 'download_count')::integer = 0 THEN
        v_days := public.market_purchase_refund_days();
        IF v_days IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'code', 'POLICY_UNAVAILABLE');
        END IF;
        IF NOT (v_base < public.market_refund_deadline(v_order.created_at, v_days)) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'REFUND_PERIOD_EXPIRED');
        END IF;
        v_targets := v_remaining;
      ELSE
        v_calc := public.market_partial_refund_calc(v_order.id, v_base);
        IF v_calc ->> 'code' <> 'OK' THEN
          RETURN jsonb_build_object('ok', false, 'code', v_calc ->> 'code', 'details', v_calc - 'state');
        END IF;
        v_targets := ARRAY(SELECT jsonb_array_elements_text(v_calc -> 'targets'))::uuid[];
      END IF;
    ELSE
      IF p_subproduct_ids IS NULL OR cardinality(p_subproduct_ids) = 0 OR NOT (p_subproduct_ids <@ v_remaining) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TARGET_INVALID');
      END IF;
      v_targets := p_subproduct_ids;
    END IF;
    v_amount := public.market_bundle_refund_amount(v_order.id, v_targets);
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTHING_TO_REFUND');
  END IF;
  IF p_expected_credits IS DISTINCT FROM v_amount THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_CHANGED', 'details',
      jsonb_build_object('amount', v_amount, 'targets', to_jsonb(v_targets), 'committed', v_order.refund_committed_credits));
  END IF;
  IF p_claim_type = 'defect' AND NOT v_is_owner THEN
    v_per_request := CASE WHEN jsonb_typeof(v_limits -> 'per_request') = 'number' THEN (v_limits ->> 'per_request')::numeric END;
    IF v_per_request IS NULL OR v_order.refund_committed_credits + v_amount > v_per_request THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ADMIN_LIMIT_EXCEEDED');
    END IF;
  END IF;

  v_plan := public.market_refund_allocate(v_order.id, v_amount);
  IF v_plan ->> 'code' NOT IN ('OK', 'NEEDS_OWNER') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED');
  END IF;
  IF v_plan ->> 'code' = 'OK' AND (v_plan ->> 'unrecovered')::integer > 0
     AND p_confirmed_refund_credits IS DISTINCT FROM (v_plan ->> 'restorable')::integer THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MARKET_REFUND_SHORTFALL', 'details', v_plan);
  END IF;

  INSERT INTO public.market_refund_requests (
    workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, status, reason,
    eligibility_snapshot, refund_kind, refund_subproduct_ids, requested_by, support_ticket_id, claim_received_at,
    claim_type, claim_channel)
  VALUES (v_order.workspace_subject, v_order.user_id, v_order.item_id, 'v2_order', v_order.id, v_amount,
          CASE WHEN v_plan ->> 'code' = 'NEEDS_OWNER' THEN 'pending' ELSE 'approved' END, btrim(p_reason),
          jsonb_build_object('kind', 'exception', 'claim_type', p_claim_type, 'claim_channel', p_claim_channel,
                             'base_time', v_base, 'targets', to_jsonb(v_targets), 'state', v_state, 'calc', v_calc,
                             'ticket', v_ticket_snapshot, 'judged_at', now()),
          'exception', v_targets, p_admin_id, p_support_ticket_id, v_base, p_claim_type, p_claim_channel)
  RETURNING id INTO v_request_id;

  IF v_plan ->> 'code' = 'NEEDS_OWNER' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NEEDS_OWNER', 'request_id', v_request_id, 'details', v_plan);
  END IF;

  v_settle := public.market_refund_settle(v_request_id, p_admin_id, v_plan, btrim(p_reason));
  IF v_order.purchase_type = 'subproduct' THEN
    UPDATE public.market_entitlements SET status = 'refunded' WHERE source_order_id = v_order.id AND status = 'active';
  END IF;
  PERFORM public.market_rebuild_order_entitlements(v_order.user_id, v_order.item_id);
  PERFORM public.record_admin_audit(p_admin_id, 'market_refund_exception', 'market_refund_request', v_request_id::text,
    v_order.user_id, (v_settle ->> 'restored')::integer + (v_settle ->> 'reissued')::integer, btrim(p_reason),
    jsonb_build_object('order_id', v_order.id, 'claim_type', p_claim_type, 'claim_channel', p_claim_channel,
                       'requested', v_amount, 'targets', to_jsonb(v_targets), 'unrecovered', (v_settle ->> 'unrecovered')::integer),
    NULL);
  RETURN jsonb_build_object('ok', true, 'request_id', v_request_id, 'amount', v_amount,
                            'new_balance', (v_settle ->> 'new_balance')::integer, 'shortfall', (v_settle ->> 'unrecovered')::integer);
END;
$fn$;

-- 3-15. 대표 정산(service_role). NEEDS_OWNER 로 멈춘 pending 요청만, 문제 원천(⓪)의 몫만 대표가 정한다.
CREATE OR REPLACE FUNCTION public.settle_market_refund_by_owner(p_request_id uuid, p_owner_id uuid, p_items jsonb, p_note text,
                                                                p_confirmed_refund_credits integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_user_id uuid;
  v_request public.market_refund_requests%ROWTYPE;
  v_order public.market_purchase_orders%ROWTYPE;
  v_owner_sources jsonb;
  v_owner_ids uuid[];
  v_item jsonb;
  v_src public.credit_sources%ROWTYPE;
  v_plan_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_owner_total integer := 0;
  v_normal jsonb;
  v_normal_amount integer;
  v_plan jsonb;
  v_settle jsonb;
  v_calc jsonb;
  v_purchase_left interval;
  v_seen uuid[] := '{}';
  v_sid uuid;
  v_restored integer;
  v_reissued integer;
  v_unrecovered integer;
  v_remaining_consumed integer;
BEGIN
  IF NULLIF(btrim(p_note), '') IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INPUT_INVALID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner_id AND is_admin IS TRUE AND admin_role = 'owner') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OWNER_ONLY');
  END IF;
  SELECT user_id INTO v_user_id FROM public.market_refund_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF v_user_id = p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SELF_TARGET');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  SELECT * INTO v_request FROM public.market_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.status <> 'pending' OR v_request.target_kind <> 'v2_order' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_PENDING');
  END IF;
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = v_request.order_id FOR UPDATE;
  PERFORM 1 FROM public.market_purchase_lines WHERE order_id = v_order.id FOR UPDATE;
  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED');
  END IF;

  -- 요청 종류별로 다른 경로와 같은 문턱을 다시 본다.
  IF v_request.refund_kind = 'full' THEN
    IF v_order.refund_committed_credits <> 0
       OR EXISTS (SELECT 1 FROM public.market_download_events WHERE order_id = v_order.id)
       OR v_request.requested_refund_credits <> v_order.charged_credits THEN
      RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED');
    END IF;
  ELSIF v_request.refund_kind = 'partial'
        OR (v_request.refund_kind = 'exception' AND v_request.claim_type = 'withdrawal' AND v_order.purchase_type = 'bundle'
            AND EXISTS (SELECT 1 FROM public.market_download_events WHERE order_id = v_order.id)) THEN
    -- 받지 않은 자료 환불(부분·고객센터 접수): (d)처럼 대상·금액을 다시 판정하고, 바뀌었으면 거부해 닫는다.
    -- 받은 자료가 없는 패키지의 고객센터 접수는 (e)가 '남은 구성 전부'로 만들었고 대기 중 주문 전체가 막히므로 아래 금액 확인만 한다
    -- (calc 는 다운로드 0건이면 FULL_REFUND_AVAILABLE 을 돌려주므로 여기서 비교하면 안 된다).
    v_calc := public.market_partial_refund_calc(v_order.id, COALESCE(v_request.claim_received_at, v_request.created_at));
    IF v_calc ->> 'code' <> 'OK'
       OR (SELECT array_agg(x ORDER BY x) FROM unnest(v_request.refund_subproduct_ids) x)
          IS DISTINCT FROM (SELECT array_agg(x::uuid ORDER BY x::uuid) FROM jsonb_array_elements_text(v_calc -> 'targets') x)
       OR (v_calc ->> 'amount')::integer <> v_request.requested_refund_credits THEN
      UPDATE public.market_refund_requests
         SET status = 'rejected', reject_code = 'TARGET_CHANGED',
             admin_note = CASE WHEN v_request.refund_kind = 'exception'
               THEN '접수 뒤 받은 자료나 금액이 바뀌어 처리하지 못했습니다. 고객센터로 다시 요청해 주시면 처음 접수한 시각으로 판단합니다.'
               ELSE '신청 뒤 받은 자료나 금액이 바뀌어 처리하지 못했습니다. 같은 주문에서 다시 신청하면 처음 신청한 시각으로 판단합니다.' END,
             processed_by = p_owner_id, processed_at = now()
       WHERE id = v_request.id;
      RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED', 'rejected', true);
    END IF;
  ELSIF v_request.refund_kind = 'exception' THEN
    IF v_request.refund_subproduct_ids IS NOT NULL
       AND public.market_bundle_refund_amount(v_order.id, v_request.refund_subproduct_ids) <> v_request.requested_refund_credits THEN
      RETURN jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED');
    END IF;
  END IF;
  IF v_order.purchase_type = 'subproduct' AND public.market_order_upgrade_blocker(v_order.id) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UPGRADE_BASE_ORDER');
  END IF;

  v_plan := public.market_refund_allocate(v_order.id, v_request.requested_refund_credits);
  IF v_plan ->> 'code' <> 'NEEDS_OWNER' THEN
    -- 예외 요청은 일반 승인 경로가 없다. 대기 중 원인(열린 충전 환불·취소 표시)이 사라졌으면 대표가 엔진 배정대로 닫는다.
    IF v_request.refund_kind <> 'exception' OR v_plan ->> 'code' <> 'OK' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_OWNER_CASE');
    END IF;
    -- 창을 연 뒤 원인이 풀렸는데 예전 원천 값으로 보냄 → 다시 열어 원천 입력 없이 정산하게 한다.
    IF jsonb_array_length(p_items) <> 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OWNER_CONTEXT_STALE');
    END IF;
    -- (e)와 같은 확인값 규칙: 돌려줄 수 없는 몫이 있으면 숫자를 보여 주고 확인받는다.
    IF (v_plan ->> 'unrecovered')::integer > 0
       AND p_confirmed_refund_credits IS DISTINCT FROM (v_plan ->> 'restorable')::integer THEN
      RETURN jsonb_build_object('ok', false, 'code', 'MARKET_REFUND_SHORTFALL', 'details', v_plan);
    END IF;
    v_plan_items := v_plan -> 'items';
  ELSE
  IF (v_plan ->> 'in_progress')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CANCEL_IN_PROGRESS', 'details', v_plan);
  END IF;
  v_owner_sources := v_plan -> 'owner_sources';
  SELECT COALESCE(array_agg((x ->> 'source_id')::uuid), '{}') INTO v_owner_ids FROM jsonb_array_elements(v_owner_sources) x;

  -- 대표 지정(문제 원천만)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sid := NULLIF(v_item ->> 'source_id', '')::uuid;
    IF v_sid IS NULL OR NOT (v_sid = ANY (v_owner_ids)) OR v_sid = ANY (v_seen) OR NULLIF(btrim(v_item ->> 'reason'), '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID');
    END IF;
    v_seen := array_append(v_seen, v_sid);
    v_restored := COALESCE((v_item ->> 'restored')::integer, 0);
    v_reissued := COALESCE((v_item ->> 'reissued')::integer, 0);
    v_unrecovered := COALESCE((v_item ->> 'unrecovered')::integer, 0);
    SELECT (x ->> 'remaining_consumed')::integer INTO v_remaining_consumed FROM jsonb_array_elements(v_owner_sources) x
     WHERE (x ->> 'source_id')::uuid = v_sid;
    IF v_restored < 0 OR v_reissued < 0 OR v_unrecovered < 0 OR v_restored + v_reissued + v_unrecovered > v_remaining_consumed THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID');
    END IF;
    SELECT * INTO v_src FROM public.credit_sources WHERE id = v_sid FOR UPDATE;
    v_purchase_left := CASE WHEN v_src.expires_at IS NULL THEN NULL ELSE v_src.expires_at - v_order.created_at END;
    IF v_restored > 0 AND NOT (v_src.status = 'active'
         AND (v_src.expires_at IS NULL OR (v_src.expires_at > now() AND v_src.expires_at - now() >= LEAST(v_purchase_left, interval '30 days')))
         AND v_restored <= GREATEST(v_src.initial_credits - v_src.remaining_credits, 0)) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID');
    END IF;
    v_plan_items := v_plan_items || jsonb_build_array(jsonb_build_object(
      'source_id', v_sid, 'taken', v_restored + v_reissued + v_unrecovered, 'restored', v_restored, 'reissued', v_reissued,
      'unrecovered', v_unrecovered, 'reason', 'owner_settled:' || btrim(v_item ->> 'reason'),
      'reissued_expires_at', CASE WHEN v_reissued > 0 THEN
        CASE WHEN v_purchase_left IS NULL THEN NULL ELSE now() + GREATEST(v_purchase_left, interval '1 day') END END));
    v_owner_total := v_owner_total + v_restored + v_reissued + v_unrecovered;
  END LOOP;
  IF cardinality(v_seen) <> cardinality(v_owner_ids) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID');
  END IF;

  -- 정상 원천 몫은 엔진 규칙대로(문제 원천을 뺀 금액으로 다시 배정 — 문제 원천은 이미 대표 지정)
  v_normal_amount := v_request.requested_refund_credits - v_owner_total;
  IF v_normal_amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID');
  END IF;
  IF v_normal_amount > 0 THEN
    v_normal := public.market_refund_allocate(v_order.id, v_normal_amount, v_owner_ids);
    IF v_normal ->> 'code' <> 'OK' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID', 'details', v_normal);
    END IF;
    -- 문제 원천 몫을 덜 지정해 생긴 차액이 '소비 기록 결손'으로 적히지 않게 막는다(문제 원천은 남은 소비까지 모두 정한다).
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_normal -> 'items') x WHERE x ->> 'reason' = 'unmatched') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID', 'details', v_normal);
    END IF;
    v_plan_items := v_plan_items || (v_normal -> 'items');
  END IF;
  END IF;

  SELECT COALESCE(sum((x ->> 'taken')::integer), 0)::integer INTO v_total FROM jsonb_array_elements(v_plan_items) x;
  IF v_total <> v_request.requested_refund_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ITEMS_INVALID');
  END IF;

  v_settle := public.market_refund_settle(v_request.id, p_owner_id, jsonb_build_object('items', v_plan_items), btrim(p_note));
  IF v_order.purchase_type = 'subproduct' OR v_request.refund_kind = 'full' THEN
    UPDATE public.market_entitlements SET status = 'refunded' WHERE source_order_id = v_order.id AND status = 'active';
  END IF;
  PERFORM public.market_rebuild_order_entitlements(v_order.user_id, v_order.item_id);
  PERFORM public.record_admin_audit(p_owner_id, 'market_refund_owner_settle', 'market_refund_request', v_request.id::text,
    v_order.user_id, (v_settle ->> 'restored')::integer + (v_settle ->> 'reissued')::integer, btrim(p_note),
    jsonb_build_object('order_id', v_order.id, 'items', v_plan_items), NULL);
  RETURN jsonb_build_object('ok', true, 'request_id', v_request.id, 'new_balance', (v_settle ->> 'new_balance')::integer,
                            'shortfall', (v_settle ->> 'unrecovered')::integer);
END;
$fn$;

-- 3-16. 결제 판정 재정의: R5 차액 기준에서 패키지 출처 PDF 이용권 제외, 패키지 판매 가능에 활성 서브상품 조건.
CREATE OR REPLACE FUNCTION public.evaluate_market_targets(p_user_id uuid, p_targets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_target jsonb;
  v_kind text;
  v_target_id uuid;
  v_found boolean;
  v_item_id uuid;
  v_ws text;
  v_item_title text;
  v_option_title text;
  v_category_name text;
  v_category_slug text;
  v_price integer;
  v_available boolean;
  v_includes_pdf boolean;
  v_has_item_scope boolean;
  v_owned boolean;
  v_partial boolean;
  v_charged integer;
  v_base_order_id uuid;
  v_hwp_count integer;
  v_target_is_hwp boolean;
  v_owned_pdf_max integer;
  v_result jsonb := '[]'::jsonb;
begin
  for v_target in select value from jsonb_array_elements(p_targets) loop
    v_kind := v_target->>'targetKind';
    v_target_id := (v_target->>'targetId')::uuid;
    v_found := false;
    v_item_id := null;
    v_ws := null;
    v_item_title := null;
    v_option_title := null;
    v_category_name := null;
    v_category_slug := null;
    v_price := null;
    v_available := false;
    v_includes_pdf := false;
    v_has_item_scope := false;
    v_owned := false;
    v_partial := false;
    v_charged := null;
    v_base_order_id := null;

    if v_kind = 'subproduct' then
      select s.item_id, i.workspace_subject, i.title, s.title, c.name, c.slug, s.price_credits,
             i.status = 'published' and i.is_active and i.deleted_at is null
               and s.is_active and s.deleted_at is null
               and s.price_credits > 0
               and exists (
                 select 1 from public.market_subproduct_files f
                 where f.subproduct_id = s.id
                   and f.workspace_subject = s.workspace_subject
                   and f.is_active and f.deleted_at is null
               ),
             exists (
               select 1
               from public.market_subproduct_files f
               join public.market_file_types ft on ft.id = f.file_type_id
               where f.subproduct_id = s.id
                 and f.workspace_subject = s.workspace_subject
                 and f.is_active and f.deleted_at is null
                 and lower(ft.code) = 'pdf'
             )
        into v_item_id, v_ws, v_item_title, v_option_title, v_category_name, v_category_slug, v_price,
             v_available, v_includes_pdf
      from public.market_item_subproducts s
      join public.market_items i on i.id = s.item_id and i.workspace_subject = s.workspace_subject
      left join public.market_subproduct_categories c on c.id = s.category_id
      where s.id = v_target_id;
      v_found := found;
    elsif v_kind = 'bundle' then
      select b.item_id, i.workspace_subject, i.title, b.label, b.price_credits,
             i.status = 'published' and i.is_active and i.deleted_at is null
               and b.is_active
               and b.price_credits > 0
               and exists (
                 select 1 from public.market_subproduct_files f
                 where f.item_id = b.item_id
                   and f.workspace_subject = b.workspace_subject
                   and f.is_active and f.deleted_at is null
               )
               -- 8번: 패키지 구성 기록 트리거와 같은 기준(활성 서브상품 1개 이상)
               and exists (
                 select 1 from public.market_item_subproducts s2
                 where s2.item_id = b.item_id
                   and s2.workspace_subject = b.workspace_subject
                   and s2.is_active and s2.deleted_at is null
               )
        into v_item_id, v_ws, v_item_title, v_option_title, v_price, v_available
      from public.market_item_bundle_options b
      join public.market_items i on i.id = b.item_id and i.workspace_subject = b.workspace_subject
      where b.id = v_target_id;
      v_found := found;
    end if;

    if v_found then
      v_charged := v_price;

      select coalesce(bool_or(e.scope = 'item'), false)
        into v_has_item_scope
      from public.market_entitlements e
      where e.user_id = p_user_id and e.item_id = v_item_id and e.status = 'active';

      if v_kind = 'bundle' then
        -- R1
        v_owned := v_has_item_scope;
        -- R6
        v_partial := exists (
          select 1
          from public.market_entitlements e
          join public.market_item_subproducts s on s.id = e.subproduct_id
          where e.user_id = p_user_id and e.item_id = v_item_id
            and e.scope = 'subproduct' and e.status = 'active'
            and s.is_active and s.deleted_at is null
        );
      else
        -- R2, R3
        v_owned := v_has_item_scope or exists (
          select 1 from public.market_entitlements e
          where e.user_id = p_user_id and e.item_id = v_item_id
            and e.scope = 'subproduct' and e.subproduct_id = v_target_id and e.status = 'active'
        );

        -- R4
        if not v_owned and v_category_slug = 'question_pdf' then
          v_owned := exists (
            select 1
            from public.market_item_subproducts s
            join public.market_subproduct_categories c on c.id = s.category_id
            join public.market_entitlements e
              on e.subproduct_id = s.id and e.user_id = p_user_id
             and e.scope = 'subproduct' and e.status = 'active'
            where s.item_id = v_item_id and s.workspace_subject = v_ws
              and s.is_active and s.deleted_at is null
              and c.slug = 'question_hwp'
              and exists (
                select 1
                from public.market_subproduct_files f
                join public.market_file_types ft on ft.id = f.file_type_id
                where f.subproduct_id = s.id
                  and f.workspace_subject = s.workspace_subject
                  and f.is_active and f.deleted_at is null
                  and lower(ft.code) = 'pdf'
              )
          );
        end if;

        -- R5: 유일한 활성 question_hwp + PDF 포함 + item scope 없음 + 미보유 + 보유 PDF 최대가 < HWP 가격
        if not v_owned and v_category_slug = 'question_hwp' and v_includes_pdf then
          select count(*), coalesce(bool_or(s.id = v_target_id), false)
            into v_hwp_count, v_target_is_hwp
          from public.market_item_subproducts s
          join public.market_subproduct_categories c on c.id = s.category_id
          where s.item_id = v_item_id and s.workspace_subject = v_ws
            and s.is_active and s.deleted_at is null
            and c.slug = 'question_hwp';

          if v_hwp_count = 1 and v_target_is_hwp then
            select max(s.price_credits)
              into v_owned_pdf_max
            from public.market_item_subproducts s
            join public.market_subproduct_categories c on c.id = s.category_id
            join public.market_entitlements e
              on e.subproduct_id = s.id and e.user_id = p_user_id
             and e.scope = 'subproduct' and e.status = 'active'
            where s.item_id = v_item_id and s.workspace_subject = v_ws
              and s.is_active and s.deleted_at is null
              and c.slug = 'question_pdf'
              -- 8번: 패키지 일부 환불로 갈라진 PDF 이용권(출처 주문이 패키지)은 차액 기준이 아니다
              and not exists (select 1 from public.market_purchase_orders ob
                               where ob.id = e.source_order_id and ob.purchase_type = 'bundle');

            if v_owned_pdf_max is not null and v_price - v_owned_pdf_max > 0 then
              v_charged := v_price - v_owned_pdf_max;

              -- 기준 주문: 최대가 PDF 권한의 source_order_id, 동률이면 주문 created_at → id 오름차순
              select e.source_order_id
                into v_base_order_id
              from public.market_item_subproducts s
              join public.market_subproduct_categories c on c.id = s.category_id
              join public.market_entitlements e
                on e.subproduct_id = s.id and e.user_id = p_user_id
               and e.scope = 'subproduct' and e.status = 'active'
              left join public.market_purchase_orders o on o.id = e.source_order_id
              where s.item_id = v_item_id and s.workspace_subject = v_ws
                and s.is_active and s.deleted_at is null
                and c.slug = 'question_pdf'
                and s.price_credits = v_owned_pdf_max
                and o.purchase_type is distinct from 'bundle'
              order by o.created_at, o.id
              limit 1;
            end if;
          end if;
        end if;
      end if;
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'targetKind', v_kind,
      'targetId', v_target_id,
      'itemId', v_item_id,
      'workspaceSubject', v_ws,
      'itemTitle', v_item_title,
      'optionTitle', v_option_title,
      'categoryName', v_category_name,
      'categorySlug', v_category_slug,
      'includesPdf', v_includes_pdf,
      'available', v_found and v_available,
      'owned', v_owned,
      'partiallyOwned', v_partial,
      'purchasable', v_found and v_available and not v_owned,
      'reason', case
        when not v_found then 'NOT_FOUND'
        when not v_available then 'UNAVAILABLE'
        when v_owned then 'ALREADY_OWNED'
      end,
      'originalCredits', v_price,
      'chargedCredits', v_charged,
      'upgradeBaseOrderId', v_base_order_id
    ));
  end loop;

  return v_result;
end;
$function$;

-- 3-17. 크레딧 회수 재정의: 자료 환불 재지급 원천은 회수 거절.
CREATE OR REPLACE FUNCTION public.revoke_admin_credits(p_actor_id uuid, p_source_id uuid, p_amount integer, p_reason text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid;
  v_actor_is_admin boolean;
  v_actor_role text;
  v_grant_limits jsonb;
  v_per_grant numeric;
  v_is_replay boolean := false;
  v_existing public.credit_transactions%ROWTYPE;
  v_category text;
  v_status text;
  v_remaining integer;
  v_expires_at timestamptz;
  v_new_balance integer;
BEGIN
  -- ① 인자
  IF p_actor_id IS NULL OR p_source_id IS NULL
     OR p_amount IS NULL OR p_amount < 1
     OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500
     OR p_operation_key IS NULL
     OR length(p_operation_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_INPUT_INVALID';
  END IF;

  -- 결제 충전분 원천은 잠그기 전에 거른다(결제 환불 함수들은 "원천 → 프로필" 순서로 잠그므로, 같은 원천을 반대 순서로 잠그지 않게).
  SELECT s.user_id, s.source_category INTO v_user_id, v_category
    FROM public.credit_sources s
   WHERE s.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_FOUND';
  END IF;
  IF v_user_id = p_actor_id THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SELF_TARGET';
  END IF;
  IF v_category IS NULL OR v_category NOT IN ('admin_grant', 'bonus', 'system_refund') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT';
  END IF;
  -- 8번: 자료 환불로 다시 지급한 크레딧(결제 대금의 환급)은 회수하지 않는다.
  IF EXISTS (SELECT 1 FROM public.market_refund_reissued_sources r WHERE r.source_id = p_source_id) THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_MARKET_REFUND';
  END IF;

  -- ② 행위자: 관리자(대표 또는 직원). 행위자 프로필은 잠그지 않는다(지급 함수와 같은 방식).
  SELECT p.is_admin, p.admin_role
    INTO v_actor_is_admin, v_actor_role
    FROM public.profiles p
   WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_actor_is_admin IS NOT TRUE
     OR (v_actor_role IS DISTINCT FROM 'owner' AND v_actor_role IS DISTINCT FROM 'staff') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED';
  END IF;

  IF v_actor_role = 'staff' THEN
    SELECT g.limits
      INTO v_grant_limits
      FROM public.admin_permission_grants g
     WHERE g.user_id = p_actor_id AND g.permission = 'credits.revoke'
       FOR UPDATE;
    IF NOT FOUND
       OR (SELECT count(*) FROM public.admin_permission_grants g
            WHERE g.user_id = p_actor_id AND g.permission IN ('members.view', 'credits.view')) <> 2 THEN
      RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED';
    END IF;

    v_is_replay := EXISTS (SELECT 1 FROM public.credit_transactions t WHERE t.operation_key = p_operation_key);

    IF NOT v_is_replay THEN
      v_per_grant := CASE
        WHEN jsonb_typeof(v_grant_limits -> 'per_grant') = 'number' THEN (v_grant_limits ->> 'per_grant')::numeric
      END;
      IF v_per_grant IS NULL OR v_per_grant < 1 THEN
        RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_NOT_SET';
      END IF;
      IF p_amount > v_per_grant THEN
        RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_PER_GRANT limit=%', v_per_grant;
      END IF;
    END IF;
  END IF;

  -- ③ 대상 프로필 잠금 → 같은 키의 재요청이면 기존 결과
  PERFORM 1
    FROM public.profiles
   WHERE id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing
    FROM public.credit_transactions
   WHERE operation_key = p_operation_key
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM v_user_id
       OR v_existing.source_id IS DISTINCT FROM p_source_id
       OR v_existing.type IS DISTINCT FROM 'refund'
       OR v_existing.amount IS DISTINCT FROM -p_amount THEN
      RAISE EXCEPTION 'ADMIN_REVOKE_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT COALESCE(SUM(remaining_credits), 0)::integer
      INTO v_new_balance
      FROM public.credit_sources
     WHERE user_id = v_user_id
       AND status IN ('active', 'pending_refund')
       AND (expires_at IS NULL OR expires_at > v_now);

    RETURN jsonb_build_object(
      'already_revoked', true,
      'user_id', v_user_id,
      'new_balance', v_new_balance,
      'source_remaining', (SELECT s.remaining_credits FROM public.credit_sources s WHERE s.id = p_source_id)
    );
  END IF;

  -- 재요청으로 보고 한도를 건너뛰었는데 기존 거래가 없으면 회수하지 않는다.
  IF v_is_replay THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_REPLAY_MISSING';
  END IF;

  -- ④ 원천 잠금과 확인
  -- 잠근 프로필의 원천인지 다시 확인한다(그 사이 원천이 지워졌거나 주인이 달라졌으면 회수하지 않는다).
  SELECT s.source_category, s.status, s.remaining_credits, s.expires_at
    INTO v_category, v_status, v_remaining, v_expires_at
    FROM public.credit_sources s
   WHERE s.id = p_source_id
     AND s.user_id = v_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_FOUND';
  END IF;

  IF v_category IS NULL OR v_category NOT IN ('admin_grant', 'bonus', 'system_refund') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT';
  END IF;
  -- 8번: 자료 환불로 다시 지급한 크레딧(결제 대금의 환급)은 회수하지 않는다.
  IF EXISTS (SELECT 1 FROM public.market_refund_reissued_sources r WHERE r.source_id = p_source_id) THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_MARKET_REFUND';
  END IF;
  IF v_status IS DISTINCT FROM 'active' OR (v_expires_at IS NOT NULL AND v_expires_at <= v_now) THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ACTIVE';
  END IF;
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_EXCEEDS_REMAINING remaining=%', v_remaining;
  END IF;

  -- ⑤ 회수
  UPDATE public.credit_sources
     SET remaining_credits = remaining_credits - p_amount
   WHERE id = p_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_user_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    operation_key
  ) VALUES (
    v_user_id,
    'refund',
    -p_amount,
    v_new_balance,
    format('크레딧 %s개 관리자 회수', to_char(p_amount, 'FM999,999,999,999')),
    p_source_id,
    p_operation_key
  );

  PERFORM public.record_admin_audit(
    p_actor_id,
    'credit_revoke',
    'member',
    v_user_id::text,
    v_user_id,
    p_amount,
    btrim(p_reason),
    jsonb_build_object(
      'source_id', p_source_id,
      'source_category', v_category,
      'operation_key', p_operation_key,
      'new_balance', v_new_balance,
      'source_remaining', v_remaining - p_amount
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'already_revoked', false,
    'user_id', v_user_id,
    'new_balance', v_new_balance,
    'source_remaining', v_remaining - p_amount
  );
END;
$function$;

-- 3-18. 문의 수정 재정의: 고치기 직전 판 보관, 회원 수정 시각 기록.
CREATE OR REPLACE FUNCTION public.update_own_pending_support_ticket(p_ticket_id uuid, p_category_id uuid, p_subject text, p_message text)
 RETURNS support_tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_category public.support_ticket_categories%rowtype;
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then
    raise exception '인증이 필요합니다.' using errcode = '28000';
  end if;

  if v_subject is null or v_message is null then
    raise exception '제목과 내용을 모두 입력해주세요.' using errcode = '22023';
  end if;

  select *
    into v_category
  from public.support_ticket_categories
  where id = p_category_id
    and is_active is true
    and deleted_at is null;

  if not found then
    raise exception '유효한 문의 카테고리를 선택해주세요.' using errcode = '22023';
  end if;

  -- 8번: 고치기 직전 판을 보관한다(환불 의사를 처음 보낸 시각·내용의 증빙).
  insert into public.support_ticket_revisions (ticket_id, subject, message, category_id, written_at)
  select t.id, t.subject, t.message, t.category_id, coalesce(t.member_updated_at, t.created_at)
  from public.support_tickets t
  where t.id = p_ticket_id
    and t.user_id = v_user_id
    and t.status = 'pending'
    and coalesce(t.is_deleted_by_user, false) is false;

  update public.support_tickets
  set
    category_id = v_category.id,
    category_snapshot = jsonb_build_object(
      'id', v_category.id,
      'slug', v_category.slug,
      'name', v_category.name,
      'description', v_category.description,
      'help_text', v_category.help_text
    ),
    subject = v_subject,
    message = v_message,
    member_updated_at = now(),
    updated_at = timezone('utc'::text, now())
  where id = p_ticket_id
    and user_id = v_user_id
    and status = 'pending'
    and coalesce(is_deleted_by_user, false) is false
  returning * into v_ticket;

  if not found then
    raise exception '수정 가능한 문의를 찾을 수 없습니다.' using errcode = '22023';
  end if;

  return v_ticket;
end;
$function$;

-- 4. 실행 권한 -------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.market_refund_deadline(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_purchase_refund_days() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_bundle_refund_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_bundle_refund_amount(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_order_upgrade_blocker(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_refund_allocate(uuid, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_refund_settle(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_rebuild_order_entitlements(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_partial_refund_calc(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_market_bundle_line_components() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_market_bundle_line_components_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_market_refund_reissued_sources_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_support_ticket_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_market_refund_request_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_market_partial_refund(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_market_partial_refund(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_market_partial_refund(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_exception_market_refund(uuid, uuid, text, text, uuid[], integer, integer, text, uuid, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_market_refund_by_owner(uuid, uuid, jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_market_partial_refund(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_market_partial_refund(uuid, uuid, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_market_partial_refund(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_exception_market_refund(uuid, uuid, text, text, uuid[], integer, integer, text, uuid, uuid, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_market_refund_by_owner(uuid, uuid, jsonb, text, integer) TO service_role;

-- 5. VERIFY --------------------------------------------------------------------------------------------------------
DO $verify_material_refund$
DECLARE
  v_text text;
  v_sig text;
  v_acl text;
  v_value jsonb;
BEGIN
  -- 설정
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'market_purchase_policy';
  IF v_value -> 'refundDays' IS DISTINCT FROM '30'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(v_value)) <> 10
     OR jsonb_typeof(v_value -> 'partialRefundConfirmNotice') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'VERIFY: market_purchase_policy';
  END IF;
  IF strpos(v_value ->> 'checkboxLabel', '{자료환불기간}') = 0 OR strpos(v_value ->> 'detailRefundNotice', '{자료환불기간}') = 0
     OR strpos(v_value ->> 'refundExpiredReason', '{자료환불기간}') = 0 THEN
    RAISE EXCEPTION 'VERIFY: placeholder';
  END IF;

  -- (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 함수 ACL
  FOREACH v_sig IN ARRAY ARRAY[
    'public.preview_market_partial_refund(uuid,uuid)',
    'public.request_market_partial_refund(uuid,uuid,integer,text,uuid)',
    'public.approve_market_partial_refund(uuid,uuid,text,integer)',
    'public.admin_exception_market_refund(uuid,uuid,text,text,uuid[],integer,integer,text,uuid,uuid,timestamp with time zone,integer)',
    'public.settle_market_refund_by_owner(uuid,uuid,jsonb,text,integer)',
    'public.approve_market_refund(uuid,uuid,text,integer)'
  ] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: service acl % = %', v_sig, v_acl;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.market_refund_deadline(timestamp with time zone,integer)', 'public.market_purchase_refund_days()',
    'public.market_bundle_refund_state(uuid)', 'public.market_bundle_refund_amount(uuid,uuid[])',
    'public.market_order_upgrade_blocker(uuid)', 'public.market_refund_allocate(uuid,integer,uuid[])',
    'public.market_refund_settle(uuid,uuid,jsonb,text)', 'public.market_rebuild_order_entitlements(uuid,uuid)',
    'public.market_partial_refund_calc(uuid,timestamp with time zone)', 'public.record_market_bundle_line_components()',
    'public.guard_market_bundle_line_components_mutation()', 'public.guard_market_refund_reissued_sources_mutation()',
    'public.guard_support_ticket_revisions_mutation()', 'public.guard_market_refund_request_insert()'
  ] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: internal acl % = %', v_sig, v_acl;
    END IF;
  END LOOP;
  SELECT string_agg(p.proname, ', ') INTO v_text FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('preview_market_partial_refund', 'request_market_partial_refund', 'approve_market_partial_refund',
                       'admin_exception_market_refund', 'settle_market_refund_by_owner', 'record_market_bundle_line_components')
     AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']);
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: definer/search_path: %', v_text;
  END IF;

  -- 표 권한
  SELECT string_agg(format('%s:%s:%s', table_name, grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('market_bundle_line_components', 'market_refund_reissued_sources', 'support_ticket_revisions')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: table grants: %', v_text;
  END IF;

  -- 인덱스·트리거
  IF to_regclass('public.uq_market_refund_requests_pending_order') IS NOT NULL
     OR to_regclass('public.uq_market_refund_requests_pending_order_v2') IS NULL
     OR to_regclass('public.uq_market_refund_requests_full_approved_order') IS NULL
     OR to_regclass('public.uq_market_item_subproducts_active_category') IS NULL THEN
    RAISE EXCEPTION 'VERIFY: indexes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'record_market_bundle_line_components'
                  AND tgrelid = 'public.market_purchase_lines'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_admin_event_market_refund_requested'
                     AND pg_get_triggerdef(oid) LIKE '%WHEN ((new.status = ''pending''::text))%') THEN
    RAISE EXCEPTION 'VERIFY: triggers';
  END IF;

  -- 누계·구성 채우기
  IF EXISTS (
    SELECT 1 FROM public.market_purchase_orders o
     WHERE o.refund_committed_credits <> COALESCE((SELECT sum(r.requested_refund_credits) FROM public.market_refund_requests r
                                                     WHERE r.order_id = o.id AND r.status = 'approved'), 0)
        OR o.refunded_credits <> COALESCE((SELECT sum(r.approved_refund_credits) FROM public.market_refund_requests r
                                            WHERE r.order_id = o.id AND r.status = 'approved'), 0)
  ) THEN
    RAISE EXCEPTION 'VERIFY: order refund totals';
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_purchase_lines l WHERE l.line_type = 'bundle'
              AND NOT EXISTS (SELECT 1 FROM public.market_bundle_line_components c WHERE c.line_id = l.id)) THEN
    RAISE EXCEPTION 'VERIFY: bundle components backfill';
  END IF;

  -- 결제 함수는 그대로
  IF md5(pg_get_functiondef('public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)'::regprocedure)) <> '0cda5ff7689d998cc6cf2fd213b0004d' THEN
    RAISE EXCEPTION 'VERIFY: checkout_market_selection changed';
  END IF;
  -- 다시 정의한 함수의 새 지문(다음 묶음의 사전 검사 기준)
  IF md5(pg_get_functiondef('public.approve_market_refund(uuid,uuid,text,integer)'::regprocedure)) <> '5039e98d8060a72f40b93e5f4db00417'
     OR md5(pg_get_functiondef('public.evaluate_market_targets(uuid,jsonb)'::regprocedure)) <> '56f84c9673e7663b5f14c10d2bf890d9'
     OR md5(pg_get_functiondef('public.revoke_admin_credits(uuid,uuid,integer,text,text)'::regprocedure)) <> '8c1f5e5e316c18b48556c18ca9bad86f'
     OR md5(pg_get_functiondef('public.update_own_pending_support_ticket(uuid,uuid,text,text)'::regprocedure)) <> 'cb221135b63d2bcc590b7fa4d2a082b0' THEN
    RAISE EXCEPTION 'VERIFY: redefined function md5';
  END IF;
  -- 보호 트리거·이어 신청 인덱스
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'guard_market_refund_request_insert', 'guard_market_bundle_line_components_mutation',
        'guard_market_bundle_line_components_truncate', 'guard_market_refund_reissued_sources_mutation',
        'guard_market_refund_reissued_sources_truncate', 'guard_support_ticket_revisions_mutation',
        'guard_support_ticket_revisions_truncate')) <> 7
     OR to_regclass('public.uq_market_refund_requests_prior') IS NULL THEN
    RAISE EXCEPTION 'VERIFY: guard triggers / prior index';
  END IF;
  -- 마감식: 11-23 23:30 KST 구매, 30일 → 12-24 00:00 KST
  IF public.market_refund_deadline('2026-11-23 23:30:00+09'::timestamptz, 30) <> '2026-12-24 00:00:00+09'::timestamptz THEN
    RAISE EXCEPTION 'VERIFY: deadline';
  END IF;
END;
$verify_material_refund$;

NOTIFY pgrst, 'reload schema';

