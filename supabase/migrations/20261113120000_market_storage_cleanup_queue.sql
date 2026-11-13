-- 상품을 지운 뒤 Storage 파일 삭제가 실패하면 그 파일을 다시 정리할 수 있게 적어 두는 대기 표.
-- 상품 행은 이미 사라졌으므로 파일 경로를 다른 곳에서 알 수 없다. 정리에 성공한 행은 지운다(남은 행 = 아직 정리 못 한 파일).
-- 쓰는 곳: src/lib/market-storage-cleanup.ts (service role 전용)
-- 순서: 이 표를 먼저 만들고 → 코드를 배포한다(표 없이 코드가 먼저 나가면 삭제한 상품의 파일이 기록 없이 남는다).
-- 되돌리기: 코드를 먼저 되돌린 뒤 supabase/rollback/20261113120000_market_storage_cleanup_queue_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.market_storage_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_bucket text NOT NULL CHECK (btrim(storage_bucket) <> ''),
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  source text NOT NULL CHECK (btrim(source) <> ''),
  source_item_id uuid,
  source_item_title text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_storage_cleanup_queue_target_key UNIQUE (storage_bucket, storage_path)
);

COMMENT ON TABLE public.market_storage_cleanup_queue IS '삭제된 상품의 Storage 파일 중 아직 지우지 못한 것. 정리되면 행을 지운다.';
COMMENT ON COLUMN public.market_storage_cleanup_queue.source_item_id IS '지워진 상품 id(상품 행이 없으므로 FK를 걸지 않는다)';

ALTER TABLE public.market_storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_storage_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_storage_cleanup_queue TO service_role;

NOTIFY pgrst, 'reload schema';
