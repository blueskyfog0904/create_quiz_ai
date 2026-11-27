-- 22번 묶음 시드: 홈 진열 판 2 첫 값(국어·영어 workspace_settings.market_home 행).
-- 근거: 계획 docs/plan-bundle22-home-merch.md 3-1·4절·10절. 마이그레이션이 아니다(적용 이력에 넣지 않는다). 스키마 변경 없음 — 행만 넣는다(표 잠금 없음).
-- 언제: 22번 구현 검증 PASS·리허설(supabase/scripts/bundle22_rehearsal/a_light.sql) 뒤, 22번 코드 push 전(10절 4). 대표 승인 뒤 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행.
--   옛 코드는 판 2 값을 기본값(인기 12·최근 8)으로 읽으므로 시드~배포 사이 회원 홈은 그대로다(리허설 H3).
--   시드 ~ 배포 사이 '홈 진열' 저장 금지(옛 화면이 판 1 로 덮음 — 덮여도 새 화면의 revision 0 저장이나 이 스크립트 다시 실행으로 복구).
--   push 직전: SELECT workspace_subject, value->>'version', value->>'revision' FROM public.workspace_settings WHERE setting_key = 'market_home'; 가 두 행 모두 2·1 인지 본다.
-- 실행 방식: 아래 '실행 확인' 의 NULL 을 'apply' 로 바꿔 실행한다(NULL 이면 멈춤).
-- 하는 일(과목마다):
--   행 없음 → 판 2(revision 1) INSERT … ON CONFLICT DO NOTHING
--   행이 판 1(또는 판 칸이 2 가 아님) → 그 행만 판 2(revision 1)로 UPDATE … WHERE value->>'version' IS DISTINCT FROM '2' (H6).
--     판 1 값이 지금 코드 검사를 통과하면 인기·최근의 켜기·개수·기간을 이어받고, 통과하지 못하면 지금 기본값(옛 코드가 그리던 모습)을 쓴다.
--   행이 이미 판 2 → 건드리지 않는다(NOTICE). 두 과목 모두 판 2 면 할 일이 없으므로 멈춘다(H2).
-- 문구: 지금 코드 글자 그대로 4개(제목 2·빈 문구 2) + 추천 제목 초안 + 빈 홈 링크(지금 빈 배너 틀의 '○○ 문제마켓 보기'). 최종은 대표가 '홈 진열' 화면에서 고친다.
-- 섹션 id 는 gen_random_uuid(). 추천 섹션은 꺼진 채, 상품 없음.
-- VERIFY: 넣은 행이 판 2·revision 1·섹션 3개·문구 그대로, 작업 기록 market_home_sections_seed 1행.
-- 되돌리기: supabase/scripts/20261224_bundle22_home_sections_seed_revert.sql — 코드를 되돌린 뒤에만(새 코드에서는 행이 없으면 섹션 0개).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 실행 확인: NULL 을 'apply' 로 바꾼다.
DO $bundle22_seed_gate$
BEGIN
  IF NULL::text IS DISTINCT FROM 'apply' THEN
    RAISE EXCEPTION 'B22_SEED: set the gate to apply';
  END IF;
END
$bundle22_seed_gate$;

-- [본문] 시작 (리허설이 이 구역만 떼어 돌린다) ---------------------------------------------------------------------------
DO $bundle22_home_sections_seed$
DECLARE
  c_tag constant text := 'B22_SEED';
  c_bundle constant text := 'bundle22_home_sections_seed';
  -- 문구 초안(지금 코드 글자 그대로). 최종은 대표가 화면에서.
  c_popular_title constant text := '인기 다운로드 자료';
  c_popular_empty constant text := '아직 다운로드 집계가 없습니다.';
  c_recent_title constant text := '최근 등록된 수업 자료';
  c_recent_empty constant text := '최근 등록된 자료가 없습니다.';
  c_featured_title constant text := '추천 자료';
  c_link_korean constant text := '국어 문제마켓 보기';
  c_link_english constant text := '영어 문제마켓 보기';
  v_started constant timestamptz := clock_timestamp();
  v_actor uuid;
  v_subject text;
  v_old jsonb;
  v_exists boolean;
  v_v1_ok boolean;
  v_p_active boolean;
  v_p_limit integer;
  v_p_days integer;
  v_r_active boolean;
  v_r_limit integer;
  v_new jsonb;
  v_result jsonb := '{}'::jsonb;
  v_row jsonb;
  v_n integer;
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION '%: record_admin_audit missing', c_tag;
  END IF;
  -- 행위자: 리허설은 시험 계정(bundle22.rehearsal_actor), 실제 실행은 마지막으로 로그인한 대표 계정
  v_actor := nullif(current_setting('bundle22.rehearsal_actor', true), '')::uuid;
  IF v_actor IS NULL THEN
    SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
     ORDER BY u.last_sign_in_at DESC LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION '%: signed-in owner account not found', c_tag;
  END IF;

  -- 있는 행 잠금(행 잠금뿐, 몇 밀리초)
  PERFORM 1 FROM public.workspace_settings
   WHERE setting_key = 'market_home' AND workspace_subject IN ('english', 'korean')
   ORDER BY workspace_subject FOR UPDATE;
  IF (SELECT count(*) FROM public.workspace_settings
       WHERE setting_key = 'market_home' AND workspace_subject IN ('english', 'korean') AND value ->> 'version' = '2') = 2 THEN
    RAISE EXCEPTION '%: both subjects already have version 2 market_home rows — nothing to seed (stop and report)', c_tag;
  END IF;

  FOREACH v_subject IN ARRAY ARRAY['korean', 'english'] LOOP
    v_old := NULL;
    v_exists := false;
    SELECT s.value, true INTO v_old, v_exists FROM public.workspace_settings s
     WHERE s.workspace_subject = v_subject AND s.setting_key = 'market_home';
    v_exists := coalesce(v_exists, false);

    IF v_exists AND v_old ->> 'version' = '2' THEN
      RAISE NOTICE '%: % already version 2 (revision %) — left as is', c_tag, v_subject, v_old ->> 'revision';
      v_result := v_result || jsonb_build_object(v_subject, 'kept_version_2');
      CONTINUE;
    END IF;

    -- 지금 모습(옛 코드 normalizeMarketHomeConfig): 판 1 이 검사를 통과하면 그 값, 아니면 기본값(인기 켜짐·12개·30일, 최근 켜짐·8개)
    v_p_active := true; v_p_limit := 12; v_p_days := 30; v_r_active := true; v_r_limit := 8;
    v_v1_ok := false;
    IF v_exists AND jsonb_typeof(v_old) = 'object' AND v_old -> 'version' = '1'::jsonb
       AND jsonb_typeof(v_old -> 'popular') = 'object' AND jsonb_typeof(v_old -> 'recent') = 'object' THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_old) k WHERE k NOT IN ('version', 'popular', 'recent', 'categories'))
         AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_old -> 'popular') k) = ARRAY['isActive', 'limit', 'rankingWindowDays']
         AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_old -> 'recent') k) = ARRAY['isActive', 'limit']
         AND jsonb_typeof(v_old #> '{popular,isActive}') = 'boolean' AND jsonb_typeof(v_old #> '{recent,isActive}') = 'boolean'
         AND jsonb_typeof(v_old #> '{popular,limit}') = 'number' AND jsonb_typeof(v_old #> '{popular,rankingWindowDays}') = 'number'
         AND jsonb_typeof(v_old #> '{recent,limit}') = 'number' THEN
        IF (v_old #>> '{popular,limit}') ~ '^[0-9]+$' AND (v_old #>> '{popular,rankingWindowDays}') ~ '^[0-9]+$'
           AND (v_old #>> '{recent,limit}') ~ '^[0-9]+$' THEN
          IF (v_old #>> '{popular,limit}')::numeric BETWEEN 1 AND 24
             AND (v_old #>> '{popular,rankingWindowDays}')::numeric BETWEEN 1 AND 90
             AND (v_old #>> '{recent,limit}')::numeric BETWEEN 1 AND 24 THEN
            v_v1_ok := true;
            v_p_active := (v_old #>> '{popular,isActive}')::boolean;
            v_p_limit := (v_old #>> '{popular,limit}')::integer;
            v_p_days := (v_old #>> '{popular,rankingWindowDays}')::integer;
            v_r_active := (v_old #>> '{recent,isActive}')::boolean;
            v_r_limit := (v_old #>> '{recent,limit}')::integer;
          END IF;
        END IF;
      END IF;
    END IF;

    v_new := jsonb_build_object(
      'version', 2,
      'revision', 1,
      'sections', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'kind', 'popular', 'isActive', v_p_active, 'title', c_popular_title,
                           'emptyText', c_popular_empty, 'limit', v_p_limit, 'rankingWindowDays', v_p_days),
        jsonb_build_object('id', gen_random_uuid()::text, 'kind', 'recent', 'isActive', v_r_active, 'title', c_recent_title,
                           'emptyText', c_recent_empty, 'limit', v_r_limit),
        jsonb_build_object('id', gen_random_uuid()::text, 'kind', 'featured', 'isActive', false, 'title', c_featured_title,
                           'emptyText', NULL, 'itemIds', '[]'::jsonb)
      ),
      'emptyHomeLink', CASE v_subject WHEN 'korean' THEN c_link_korean ELSE c_link_english END
    );

    IF NOT v_exists THEN
      INSERT INTO public.workspace_settings (workspace_subject, setting_key, value, description, updated_by)
      VALUES (v_subject, 'market_home', v_new, '문제마켓 홈 진열(22번 판 2)', v_actor)
      ON CONFLICT (workspace_subject, setting_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%: % market_home row appeared meanwhile — run again', c_tag, v_subject;
      END IF;
      v_result := v_result || jsonb_build_object(v_subject, 'inserted');
    ELSE
      UPDATE public.workspace_settings
         SET value = v_new, description = '문제마켓 홈 진열(22번 판 2)', updated_by = v_actor, updated_at = now()
       WHERE workspace_subject = v_subject AND setting_key = 'market_home' AND value ->> 'version' IS DISTINCT FROM '2';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%: % market_home row changed meanwhile — run again', c_tag, v_subject;
      END IF;
      v_result := v_result || jsonb_build_object(v_subject, CASE WHEN v_v1_ok THEN 'from_version_1' ELSE 'replaced_unreadable' END);
    END IF;
  END LOOP;

  PERFORM public.record_admin_audit(v_actor, 'market_home_sections_seed', 'workspace_settings', 'market_home', NULL, NULL,
    '22번 홈 진열 첫 값 넣기 — SQL 스크립트 supabase/scripts/20261224_bundle22_home_sections_seed.sql',
    jsonb_build_object('bundle', c_bundle, 'mode', 'seed', 'subjects', v_result, 'sectionCount', 3, 'saved_at', to_jsonb(clock_timestamp())), NULL);

  -- VERIFY
  FOREACH v_subject IN ARRAY ARRAY['korean', 'english'] LOOP
    IF v_result ->> v_subject = 'kept_version_2' THEN
      CONTINUE;
    END IF;
    SELECT s.value INTO v_row FROM public.workspace_settings s WHERE s.workspace_subject = v_subject AND s.setting_key = 'market_home';
    IF v_row IS NULL OR v_row -> 'version' <> '2'::jsonb OR v_row -> 'revision' <> '1'::jsonb
       OR jsonb_typeof(v_row -> 'sections') <> 'array' OR jsonb_array_length(v_row -> 'sections') <> 3
       OR (SELECT array_agg(e ->> 'kind' ORDER BY o) FROM jsonb_array_elements(v_row -> 'sections') WITH ORDINALITY AS t(e, o)) <> ARRAY['popular', 'recent', 'featured']
       OR v_row #>> '{sections,0,title}' <> c_popular_title OR v_row #>> '{sections,0,emptyText}' <> c_popular_empty
       OR v_row #>> '{sections,1,title}' <> c_recent_title OR v_row #>> '{sections,1,emptyText}' <> c_recent_empty
       OR v_row #>> '{sections,2,title}' <> c_featured_title OR v_row #> '{sections,2,emptyText}' <> 'null'::jsonb
       OR v_row #> '{sections,2,itemIds}' <> '[]'::jsonb OR v_row #> '{sections,2,isActive}' <> 'false'::jsonb
       OR v_row ->> 'emptyHomeLink' IS DISTINCT FROM (CASE v_subject WHEN 'korean' THEN c_link_korean ELSE c_link_english END)
       OR (SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(v_row -> 'sections') e) <> 3 THEN
      RAISE EXCEPTION 'VERIFY: % market_home value', v_subject;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed' AND details ->> 'bundle' = c_bundle
       AND details ->> 'mode' = 'seed' AND (details ->> 'saved_at')::timestamptz >= v_started) <> 1 THEN
    RAISE EXCEPTION 'VERIFY: audit row';
  END IF;
  RAISE NOTICE '% OK: %', c_tag, v_result;
END
$bundle22_home_sections_seed$;
-- [본문] 끝 -----------------------------------------------------------------------------------------------------------

COMMIT;

-- 확인 조회(읽기만): 두 행의 판·revision·섹션 종류
SELECT s.workspace_subject, s.value ->> 'version' AS version, s.value ->> 'revision' AS revision,
       (SELECT string_agg(e ->> 'kind' || ':' || (e ->> 'isActive'), ', ' ORDER BY o) FROM jsonb_array_elements(s.value -> 'sections') WITH ORDINALITY AS t(e, o)) AS sections,
       s.updated_at
  FROM public.workspace_settings s WHERE s.setting_key = 'market_home' ORDER BY s.workspace_subject;
