-- 20261113150000_market_item_history_fk_restrict 되돌리기: 기록 FK 7개를 다시 ON DELETE CASCADE로.
-- 주의: 되돌리면 상품 행 삭제 시 구매·권리·다운로드·환불·후기 기록이 다시 함께 지워진다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.market_download_events
  DROP CONSTRAINT market_download_events_item_id_fkey,
  ADD CONSTRAINT market_download_events_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE CASCADE;

ALTER TABLE public.market_entitlements
  DROP CONSTRAINT market_entitlements_item_workspace_fkey,
  ADD CONSTRAINT market_entitlements_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE CASCADE;

ALTER TABLE public.market_item_reviews
  DROP CONSTRAINT market_item_reviews_item_workspace_fkey,
  ADD CONSTRAINT market_item_reviews_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE CASCADE;

ALTER TABLE public.market_purchase_lines
  DROP CONSTRAINT market_purchase_lines_item_workspace_fkey,
  ADD CONSTRAINT market_purchase_lines_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE CASCADE;

ALTER TABLE public.market_purchase_orders
  DROP CONSTRAINT market_purchase_orders_item_workspace_fkey,
  ADD CONSTRAINT market_purchase_orders_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_subject) REFERENCES public.market_items(id, workspace_subject) ON DELETE CASCADE;

ALTER TABLE public.market_purchases
  DROP CONSTRAINT market_purchases_item_id_fkey,
  ADD CONSTRAINT market_purchases_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE CASCADE;

ALTER TABLE public.market_refund_requests
  DROP CONSTRAINT market_refund_requests_item_id_fkey,
  ADD CONSTRAINT market_refund_requests_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE CASCADE;
