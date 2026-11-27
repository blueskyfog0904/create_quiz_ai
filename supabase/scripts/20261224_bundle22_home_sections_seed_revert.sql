-- 22번 묶음 시드 되돌림: 시드가 넣은 홈 진열 판 2 행(revision 1)만 지운다.
-- 근거: 계획 docs/plan-bundle22-home-merch.md 4절 '되돌림 스크립트'·10절 되돌리기. 마이그레이션이 아니다.
-- 언제: **22번 코드를 되돌린(revert·배포) 뒤에만** 실행한다. 새 코드는 행이 없으면 회원 홈 섹션이 0개다.
--   옛 코드는 행이 없으면 기본값(인기 12·최근 8)으로 그린다 — 지금 모습 그대로.
-- 실행 방식: 아래 '실행 확인' 의 NULL 을 'apply' 로 바꿔 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행(대표 승인).
-- 하는 일: 판 2 이고 revision 이 1 인 market_home 행을 DELETE. 판 2 인데 revision 이 1 이 아닌 행(시드 뒤 화면에서 고친 행)이 있으면 멈춘다.
--   판 1 행·다른 키는 건드리지 않는다. 작업 기록 market_home_sections_seed(mode 'revert', 지운 과목) 1행.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 실행 확인: NULL 을 'apply' 로 바꾼다.
DO $bundle22_revert_gate$
BEGIN
  IF NULL::text IS DISTINCT FROM 'apply' THEN
    RAISE EXCEPTION 'B22_REVERT: set the gate to apply';
  END IF;
END
$bundle22_revert_gate$;

-- [본문] 시작 (리허설이 이 구역만 떼어 돌린다) ---------------------------------------------------------------------------
DO $bundle22_home_sections_revert$
DECLARE
  c_tag constant text := 'B22_REVERT';
  c_bundle constant text := 'bundle22_home_sections_seed';
  v_started constant timestamptz := clock_timestamp();
  v_actor uuid;
  v_deleted text[];
BEGIN
  v_actor := nullif(current_setting('bundle22.rehearsal_actor', true), '')::uuid;
  IF v_actor IS NULL THEN
    SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
     ORDER BY u.last_sign_in_at DESC LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION '%: signed-in owner account not found', c_tag;
  END IF;

  PERFORM 1 FROM public.workspace_settings
   WHERE setting_key = 'market_home' AND workspace_subject IN ('english', 'korean')
   ORDER BY workspace_subject FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.workspace_settings
              WHERE setting_key = 'market_home' AND value ->> 'version' = '2' AND value ->> 'revision' IS DISTINCT FROM '1') THEN
    RAISE EXCEPTION '%: a version 2 market_home row was edited after the seed (revision is not 1) — stop and report', c_tag;
  END IF;

  WITH gone AS (
    DELETE FROM public.workspace_settings
     WHERE setting_key = 'market_home' AND value ->> 'version' = '2' AND value ->> 'revision' = '1'
    RETURNING workspace_subject
  )
  SELECT coalesce(array_agg(workspace_subject ORDER BY workspace_subject), '{}') INTO v_deleted FROM gone;

  PERFORM public.record_admin_audit(v_actor, 'market_home_sections_seed', 'workspace_settings', 'market_home', NULL, NULL,
    '22번 홈 진열 첫 값 되돌림 — SQL 스크립트 supabase/scripts/20261224_bundle22_home_sections_seed_revert.sql',
    jsonb_build_object('bundle', c_bundle, 'mode', 'revert', 'deletedSubjects', to_jsonb(v_deleted), 'saved_at', to_jsonb(clock_timestamp())), NULL);

  -- VERIFY
  IF EXISTS (SELECT 1 FROM public.workspace_settings WHERE setting_key = 'market_home' AND value ->> 'version' = '2') THEN
    RAISE EXCEPTION 'VERIFY: version 2 market_home rows remain';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed' AND details ->> 'bundle' = c_bundle
       AND details ->> 'mode' = 'revert' AND (details ->> 'saved_at')::timestamptz >= v_started) <> 1 THEN
    RAISE EXCEPTION 'VERIFY: audit row';
  END IF;
  RAISE NOTICE '% OK: deleted %', c_tag, v_deleted;
END
$bundle22_home_sections_revert$;
-- [본문] 끝 -----------------------------------------------------------------------------------------------------------

COMMIT;

SELECT s.workspace_subject, s.value ->> 'version' AS version, s.value ->> 'revision' AS revision
  FROM public.workspace_settings s WHERE s.setting_key = 'market_home' ORDER BY s.workspace_subject;
