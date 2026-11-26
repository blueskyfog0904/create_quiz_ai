-- 19번 묶음 4-5 되돌림: 표시명 일괄 변경(20261221_bundle19_bundle_label.sql)을 되돌린다(계획 docs/plan-bundle19-product-display.md 4-5·11절).
-- 마이그레이션이 아니다. 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤). 19번 코드를 되돌린 뒤 필요할 때만.
-- 대상: 마지막 되돌림 기록 뒤의 실행 기록(market_bundle_label_bulk_update, details.mode = 'apply' — 1차·2차 모두)의 ids 가운데
--   **지금도 '전체 패키지'인 행만** 옛 글자로 되돌린다. 그 사이 관리자가 다른 글자로 고친 행은 그대로 두고 그 수를 기록·보고한다.
--   주의: 그 사이 관리자가 일부러 같은 글자('전체 패키지')로 다시 저장한 행은 구분할 수 없어 함께 되돌린다(표시만, 금액·판정과 무관).
-- 한 거래: 작업 기록 market_bundle_label_bulk_update 1건(details: mode 'revert', ids, kept_ids, old_label, new_label, count) + UPDATE.
-- c_actor_id 에 대표(owner) 계정 id 를 넣는다(비었으면 멈춤).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle19_bundle_label_revert$
DECLARE
  -- [실행 직전 채움] ---------------------------------------------------------------------------------------------
  c_actor_id constant uuid := NULL;
  -- -------------------------------------------------------------------------------------------------------------
  c_applied_label constant text := '전체 패키지';
  c_restore_label constant text := '전체 한번에 구매하기';
  v_last_revert timestamptz;
  v_applied uuid[];
  v_ids uuid[];
  v_kept uuid[];
  v_updated integer;
BEGIN
  IF c_actor_id IS NULL THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT: fill c_actor_id first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT: c_actor_id is not an active owner';
  END IF;

  SELECT max(a.created_at) INTO v_last_revert
    FROM public.admin_audit_log a WHERE a.action = 'market_bundle_label_bulk_update' AND a.details ->> 'mode' = 'revert';
  SELECT coalesce(array_agg(DISTINCT t.x::uuid ORDER BY t.x::uuid), '{}') INTO v_applied
    FROM public.admin_audit_log a CROSS JOIN LATERAL jsonb_array_elements_text(a.details -> 'ids') AS t(x)
   WHERE a.action = 'market_bundle_label_bulk_update' AND a.details ->> 'mode' = 'apply'
     AND (v_last_revert IS NULL OR a.created_at > v_last_revert);
  IF cardinality(v_applied) = 0 THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT: no apply record to revert';
  END IF;

  -- 지금도 새 글자인 행만(행 잠금), 나머지는 남긴다
  SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_ids
    FROM (SELECT o.id FROM public.market_item_bundle_options o
           WHERE o.id = ANY (v_applied) AND o.label = c_applied_label ORDER BY o.id FOR UPDATE) b;
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO v_kept FROM unnest(v_applied) x WHERE NOT (x = ANY (v_ids));

  PERFORM public.record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update', 'market_item_bundle_options', 'bulk', NULL, NULL, NULL,
    jsonb_build_object('mode', 'revert', 'ids', to_jsonb(v_ids), 'kept_ids', to_jsonb(v_kept),
      'old_label', c_applied_label, 'new_label', c_restore_label, 'count', cardinality(v_ids)),
    NULL);
  UPDATE public.market_item_bundle_options o SET label = c_restore_label WHERE o.id = ANY (v_ids) AND o.label = c_applied_label;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT VERIFY: updated % of % rows', v_updated, cardinality(v_ids);
  END IF;
  RAISE NOTICE 'BUNDLE_LABEL_REVERT: % rows restored, % rows kept (changed by admin in between)', v_updated, cardinality(v_kept);
END
$bundle19_bundle_label_revert$;

COMMIT;
