-- 19번 묶음 4-5: 전체구매 표시명 '전체 한번에 구매하기' → '전체 패키지'(계획 docs/plan-bundle19-product-display.md Q4·4-5·11절).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤).
-- 언제(두 번): ① 19번 마이그레이션 적용 뒤, push 직전 1차 ② 배포 직후 2차 — 1차와 배포 사이에 옛 코드가 새 상품·빈 칸 저장 때
--   옛 글자를 다시 채웠을 수 있어서다(옛 코드는 비어 있지 않은 표시명은 덮지 않는다). 2차 뒤 아래 조회가 0건이어야 한다.
--   실회원이 적은 시간에 돌린다. 결제·환불 함수는 바꾸지 않는다(금액·판정·11번 동의 지문은 표시명을 읽지 않음 — 계획 1절, 리허설 R6).
-- 돌리기 직전에 아래 읽기 조회로 세어 c_expected_count·c_expected_ids_md5 를 채우고, c_actor_id 에 대표(owner) 계정 id 를 넣는다.
--   SELECT count(*) AS n, md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS ids_md5
--     FROM public.market_item_bundle_options WHERE label = '전체 한번에 구매하기';
--   상수가 비었거나 세어 둔 값과 다르면 아무것도 바꾸지 않고 멈춘다(그 사이 행이 바뀐 것 — 다시 세어 채운다).
-- 한 거래: 작업 기록 market_bundle_label_bulk_update 1건(details: mode 'apply', ids, old_label, new_label, count) + UPDATE.
-- 잠금: 대상 행 잠금뿐이다(표 DDL 없음 — label 칸 기본값은 그대로 둔다, 계획 4-5).
-- 되돌리기: supabase/scripts/20261221_bundle19_bundle_label_revert.sql(이 기록의 ids 가운데 지금도 '전체 패키지'인 행만).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle19_bundle_label$
DECLARE
  -- [실행 직전 채움] ---------------------------------------------------------------------------------------------
  c_actor_id constant uuid := NULL;
  c_expected_count constant integer := NULL;
  c_expected_ids_md5 constant text := NULL;
  -- -------------------------------------------------------------------------------------------------------------
  c_old_label constant text := '전체 한번에 구매하기';
  c_new_label constant text := '전체 패키지';
  v_ids uuid[];
  v_updated integer;
BEGIN
  IF c_actor_id IS NULL OR c_expected_count IS NULL OR c_expected_ids_md5 IS NULL THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: fill c_actor_id / c_expected_count / c_expected_ids_md5 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: c_actor_id is not an active owner';
  END IF;

  -- 대상 행을 잠그고 센다(id 순서로 잠가 다른 거래와 엇갈리지 않게)
  SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_ids
    FROM (SELECT o.id FROM public.market_item_bundle_options o WHERE o.label = c_old_label ORDER BY o.id FOR UPDATE) b;
  IF cardinality(v_ids) <> c_expected_count
     OR md5(coalesce(array_to_string(v_ids, ','), '')) <> c_expected_ids_md5 THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: target rows changed (now % rows) — count again and refill the constants', cardinality(v_ids);
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RAISE NOTICE 'BUNDLE_LABEL: nothing to change';
    RETURN;
  END IF;

  PERFORM public.record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update', 'market_item_bundle_options', 'bulk', NULL, NULL, NULL,
    jsonb_build_object('mode', 'apply', 'ids', to_jsonb(v_ids), 'old_label', c_old_label, 'new_label', c_new_label, 'count', cardinality(v_ids)),
    NULL);
  -- updated_at 은 표의 기존 트리거(trg_market_item_bundle_options_updated_at)가 바꾼다(표시만, 금액·판정과 무관)
  UPDATE public.market_item_bundle_options o SET label = c_new_label WHERE o.id = ANY (v_ids) AND o.label = c_old_label;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- VERIFY: 대상 0건, 바뀐 건수 = 기록 건수
  IF EXISTS (SELECT 1 FROM public.market_item_bundle_options o WHERE o.id = ANY (v_ids) AND o.label = c_old_label)
     OR v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL VERIFY: updated % of % rows', v_updated, cardinality(v_ids);
  END IF;
  RAISE NOTICE 'BUNDLE_LABEL: % rows → %', v_updated, c_new_label;
END
$bundle19_bundle_label$;

SELECT count(*) AS remaining_old_label FROM public.market_item_bundle_options WHERE label = '전체 한번에 구매하기';
COMMIT;
