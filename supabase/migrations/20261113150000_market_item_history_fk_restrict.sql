-- 구매·권리·다운로드·환불·후기 기록이 있는 상품은 DB가 삭제 자체를 거부하게 한다(계획 W1-10, DB-2).
-- 문제: market_items를 참조하는 FK 13개가 모두 ON DELETE CASCADE라, 상품 행을 지우면 주문·권리·다운로드 기록·환불 요청·후기가 함께 사라졌다.
--       관리자 화면은 이력이 있으면 숨김으로 바꾸지만(2317398), "이력 확인"과 "삭제" 사이에 구매가 끼어드는 틈이 남아 있었다.
-- 변경: 기록에 해당하는 FK 7개를 ON DELETE RESTRICT로 바꾼다. 상품 구성물(파일·서브상품·샘플·묶음 옵션)과 조회수 6개는 CASCADE 그대로.
-- 코드: src/lib/market-item-cleanup.ts의 deleteOrHideMarketItem이 FK 위반(23503)을 받으면 숨김으로 처리한다(이미 배포됨).
-- 되돌리기: supabase/rollback/20261113150000_market_item_history_fk_restrict_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.market_download_events
  DROP CONSTRAINT market_download_events_item_id_fkey,
  ADD CONSTRAINT market_download_events_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE RESTRICT;

ALTER TABLE public.market_entitlements
  DROP CONSTRAINT market_entitlements_item_workspace_fkey,
  ADD CONSTRAINT market_entitlements_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE RESTRICT;

ALTER TABLE public.market_item_reviews
  DROP CONSTRAINT market_item_reviews_item_workspace_fkey,
  ADD CONSTRAINT market_item_reviews_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE RESTRICT;

ALTER TABLE public.market_purchase_lines
  DROP CONSTRAINT market_purchase_lines_item_workspace_fkey,
  ADD CONSTRAINT market_purchase_lines_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE RESTRICT;

ALTER TABLE public.market_purchase_orders
  DROP CONSTRAINT market_purchase_orders_item_workspace_fkey,
  ADD CONSTRAINT market_purchase_orders_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE RESTRICT;

ALTER TABLE public.market_purchases
  DROP CONSTRAINT market_purchases_item_id_fkey,
  ADD CONSTRAINT market_purchases_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE RESTRICT;

ALTER TABLE public.market_refund_requests
  DROP CONSTRAINT market_refund_requests_item_id_fkey,
  ADD CONSTRAINT market_refund_requests_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE RESTRICT;
