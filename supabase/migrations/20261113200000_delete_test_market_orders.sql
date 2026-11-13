-- 출시 전 테스트로 만든 문제마켓 주문과 딸린 기록을 지운다(운영 전 데이터 점검 U0-2, 사용자 결정 2026-11-13).
-- 대상(2026-11-13 조회): 주문 19 · 주문 상세 19 · 구매 권리 19 · 다운로드 기록 23 · 환불 요청 1 · 후기 3
--   · 일괄 구매 묶음(영수증 스냅샷) 10 (모두 관리자·테스트 계정의 것).
-- 크레딧 장부(credit_transactions, credit_sources)는 건드리지 않는다(사용자 결정 A: 쓴 크레딧은 돌려주지 않고 내역도 그대로).
-- 안전장치:
--   1) 지우기 전 건수가 위 숫자와 다르면(그 사이 새 주문·후기가 생겼으면) 아무것도 지우지 않고 멈춘다.
--   2) 지우는 행을 archive.deleted_test_market_rows_20261113에 그대로 남긴다(API로는 읽을 수 없는 스키마). 필요 없어지면 표를 지운다.
-- 되돌리기: 자동 되돌리기 없음. 필요하면 위 보관 표의 행으로 복구한다(supabase/rollback/20261113200000_delete_test_market_orders_down.sql 참고).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;

CREATE TABLE archive.deleted_test_market_rows_20261113 (
  source_table text NOT NULL,
  row_data jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE archive.deleted_test_market_rows_20261113 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE archive.deleted_test_market_rows_20261113 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_counts jsonb;
  v_expected jsonb := '{"orders": 19, "lines": 19, "entitlements": 19, "downloads": 23, "refund_requests": 1, "reviews": 3, "batches": 10}';
BEGIN
  -- 지우는 동안 새 주문·후기가 끼어들지 못하게 잠근다.
  LOCK TABLE public.market_purchase_orders, public.market_purchase_lines, public.market_entitlements,
             public.market_download_events, public.market_refund_requests, public.market_item_reviews,
             public.market_item_review_votes, public.market_checkout_batches, public.market_purchases
    IN SHARE ROW EXCLUSIVE MODE;

  v_counts := jsonb_build_object(
    'orders', (SELECT count(*) FROM public.market_purchase_orders),
    'lines', (SELECT count(*) FROM public.market_purchase_lines),
    'entitlements', (SELECT count(*) FROM public.market_entitlements),
    'downloads', (SELECT count(*) FROM public.market_download_events),
    'refund_requests', (SELECT count(*) FROM public.market_refund_requests),
    'reviews', (SELECT count(*) FROM public.market_item_reviews),
    'batches', (SELECT count(*) FROM public.market_checkout_batches)
  );
  IF v_counts <> v_expected THEN
    RAISE EXCEPTION 'TEST_MARKET_ORDER_COUNTS_CHANGED' USING DETAIL = v_counts::text;
  END IF;
  -- 예전 방식 구매 기록이 있으면 이 스크립트가 다루지 않는 행이 남으므로 멈춘다.
  IF EXISTS (SELECT 1 FROM public.market_purchases) THEN
    RAISE EXCEPTION 'TEST_MARKET_LEGACY_PURCHASES_EXIST';
  END IF;

  INSERT INTO archive.deleted_test_market_rows_20261113 (source_table, row_data)
  SELECT 'market_item_review_votes', to_jsonb(t) FROM public.market_item_review_votes t
  UNION ALL SELECT 'market_item_reviews', to_jsonb(t) FROM public.market_item_reviews t
  UNION ALL SELECT 'market_download_events', to_jsonb(t) FROM public.market_download_events t
  UNION ALL SELECT 'market_refund_requests', to_jsonb(t) FROM public.market_refund_requests t
  UNION ALL SELECT 'market_entitlements', to_jsonb(t) FROM public.market_entitlements t
  UNION ALL SELECT 'market_purchase_lines', to_jsonb(t) FROM public.market_purchase_lines t
  UNION ALL SELECT 'market_purchase_orders', to_jsonb(t) FROM public.market_purchase_orders t
  UNION ALL SELECT 'market_checkout_batches', to_jsonb(t) FROM public.market_checkout_batches t;

  -- 참조하는 쪽부터 지운다. 후기 추천(votes)은 후기를 따라, 주문 상세(lines)는 주문을 따라 지워진다.
  DELETE FROM public.market_item_reviews;
  DELETE FROM public.market_download_events;
  DELETE FROM public.market_refund_requests;
  DELETE FROM public.market_entitlements;
  DELETE FROM public.market_purchase_orders;
  -- 묶음은 주문이 가리키는 쪽이라 주문 뒤에 지운다.
  DELETE FROM public.market_checkout_batches;

  IF EXISTS (SELECT 1 FROM public.market_purchase_lines)
     OR EXISTS (SELECT 1 FROM public.market_item_review_votes) THEN
    RAISE EXCEPTION 'TEST_MARKET_ORDER_CHILD_ROWS_REMAIN';
  END IF;
END $$;
