-- 22번 묶음 리허설: A light — 시드·되돌림 스크립트 본문, 경우 H1·H2·H4·H5·H6·R
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle22_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle22_rehearsal/a_light.sql (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금(낮) 돌려도 됨 — market_home 행(지금 0행)과 작업 기록만 거래 안에서 쓰고 ROLLBACK. 표 잠금 없음.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _rh_log, _rh_ctx TO PUBLIC;
GRANT USAGE ON SEQUENCE _rh_log_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 160);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
-- 과목 행의 value(없으면 NULL)
CREATE FUNCTION pg_temp.home(p_subject text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT value FROM public.workspace_settings WHERE setting_key = 'market_home' AND workspace_subject = p_subject
$f$;

-- ===== 준비: @test.com 시험 계정을 행위자로, 지금 행 수·작업 기록 수 =====
DO $rh_setup$
DECLARE
  v_actor uuid;
BEGIN
  SELECT p.id INTO v_actor
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL
   ORDER BY u.created_at LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 없음 — 대표·실회원 id 로 대신하지 않고 멈춘다';
  END IF;
  PERFORM set_config('bundle22.rehearsal_actor', v_actor::text, true);
  PERFORM pg_temp.ctx_set('pre_rows', (SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home')::text);
  PERFORM pg_temp.ctx_set('pre_audit', (SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed')::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 행위자·지금 market_home 행 수',
    jsonb_build_object('market_home_rows', pg_temp.ctx('pre_rows')::int, 'seed_audit_rows', pg_temp.ctx('pre_audit')::int));
END
$rh_setup$;

-- ===== 원본 스크립트 본문(실행 확인 구역 밖, BEGIN·COMMIT 없음) =====
SELECT pg_temp.ctx_set('src_seed', $rh_src_seed$DO $bundle22_home_sections_seed$
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
$bundle22_home_sections_seed$;$rh_src_seed$);
SELECT pg_temp.ctx_set('src_revert', $rh_src_revert$DO $bundle22_home_sections_revert$
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
$bundle22_home_sections_revert$;$rh_src_revert$);

-- ===== H1 =====
DO $rh_h1$
DECLARE
  v_log text[] := '{}';
  v_payload jsonb := NULL;
  v_r text;
  v_k jsonb;
  v_e jsonb;
  v_t timestamptz;
BEGIN
  BEGIN
    -- 경우마다 빈 상태에서 시작(거래 안, 경우가 끝나면 되돌려짐)
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    v_t := clock_timestamp();

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'OK', 'H1', '행 없음 → 시드 실행');

    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.ensure(v_k -> 'version' = '2'::jsonb AND v_k -> 'revision' = '1'::jsonb, 'H1', 'korean: 판 2·revision 1');
    v_log := v_log || pg_temp.ensure(jsonb_array_length(v_k -> 'sections') = 3
      AND v_k #>> '{sections,0,kind}' = 'popular' AND v_k #>> '{sections,0,title}' = '인기 다운로드 자료' AND v_k #>> '{sections,0,emptyText}' = '아직 다운로드 집계가 없습니다.'
      AND v_k #>> '{sections,1,kind}' = 'recent' AND v_k #>> '{sections,1,title}' = '최근 등록된 수업 자료' AND v_k #>> '{sections,1,emptyText}' = '최근 등록된 자료가 없습니다.'
      AND v_k #>> '{sections,2,kind}' = 'featured' AND v_k #> '{sections,2,isActive}' = 'false'::jsonb AND v_k #> '{sections,2,itemIds}' = '[]'::jsonb
      AND v_k ->> 'emptyHomeLink' = '국어 문제마켓 보기', 'H1', 'korean: 섹션 3개·문구 그대로·추천 꺼짐·빈 홈 링크');

    v_k := pg_temp.home('english');
    v_log := v_log || pg_temp.ensure(v_k -> 'version' = '2'::jsonb AND v_k -> 'revision' = '1'::jsonb, 'H1', 'english: 판 2·revision 1');
    v_log := v_log || pg_temp.ensure(jsonb_array_length(v_k -> 'sections') = 3
      AND v_k #>> '{sections,0,kind}' = 'popular' AND v_k #>> '{sections,0,title}' = '인기 다운로드 자료' AND v_k #>> '{sections,0,emptyText}' = '아직 다운로드 집계가 없습니다.'
      AND v_k #>> '{sections,1,kind}' = 'recent' AND v_k #>> '{sections,1,title}' = '최근 등록된 수업 자료' AND v_k #>> '{sections,1,emptyText}' = '최근 등록된 자료가 없습니다.'
      AND v_k #>> '{sections,2,kind}' = 'featured' AND v_k #> '{sections,2,isActive}' = 'false'::jsonb AND v_k #> '{sections,2,itemIds}' = '[]'::jsonb
      AND v_k ->> 'emptyHomeLink' = '영어 문제마켓 보기', 'H1', 'english: 섹션 3개·문구 그대로·추천 꺼짐·빈 홈 링크');
    v_log := v_log || pg_temp.ensure((pg_temp.home('korean') #>> '{sections,0,isActive}')::boolean AND (pg_temp.home('korean') #>> '{sections,1,isActive}')::boolean
      AND pg_temp.home('korean') #> '{sections,0,limit}' = '12'::jsonb AND pg_temp.home('korean') #> '{sections,0,rankingWindowDays}' = '30'::jsonb
      AND pg_temp.home('korean') #> '{sections,1,limit}' = '8'::jsonb, 'H1', '행 없음이면 지금 기본값(인기 12·30일·최근 8, 둘 다 켜짐) = 지금 회원 홈 모습');
    -- H5: 넣은 두 value 를 순수 시험 입력으로 낸다
    v_payload := jsonb_build_object('korean', pg_temp.home('korean'), 'english', pg_temp.home('english'));
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_revert')), 'OK', 'H1', '되돌림 실행');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home') = 0, 'H1', '되돌림 뒤 market_home 0행');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'H1', m FROM unnest(v_log) m;
  IF v_payload IS NOT NULL THEN
    INSERT INTO _rh_log (test, msg, payload) VALUES ('H1', 'payload', v_payload);
  END IF;
END
$rh_h1$;

-- ===== H2 =====
DO $rh_h2$
DECLARE
  v_log text[] := '{}';
  v_payload jsonb := NULL;
  v_r text;
  v_k jsonb;
  v_e jsonb;
  v_t timestamptz;
BEGIN
  BEGIN
    -- 경우마다 빈 상태에서 시작(거래 안, 경우가 끝나면 되돌려짐)
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    v_t := clock_timestamp();

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'OK', 'H2', '첫 시드');
    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'ERR B22_SEED: both subjects already have version 2', 'H2', '두 과목 모두 판 2 면 다시 실행은 멈춤');
    v_log := v_log || pg_temp.ensure(pg_temp.home('korean') = v_k, 'H2', '멈춘 실행은 행을 바꾸지 않음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'H2', m FROM unnest(v_log) m;
  IF v_payload IS NOT NULL THEN
    INSERT INTO _rh_log (test, msg, payload) VALUES ('H2', 'payload', v_payload);
  END IF;
END
$rh_h2$;

-- ===== H4 =====
DO $rh_h4$
DECLARE
  v_log text[] := '{}';
  v_payload jsonb := NULL;
  v_r text;
  v_k jsonb;
  v_e jsonb;
  v_t timestamptz;
BEGIN
  BEGIN
    -- 경우마다 빈 상태에서 시작(거래 안, 경우가 끝나면 되돌려짐)
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    v_t := clock_timestamp();

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'OK', 'H4', '시드');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed'
      AND details ->> 'bundle' = 'bundle22_home_sections_seed' AND details ->> 'mode' = 'seed' AND (details ->> 'saved_at')::timestamptz >= v_t
      AND details -> 'subjects' = '{"korean": "inserted", "english": "inserted"}'::jsonb AND details -> 'sectionCount' = '3'::jsonb
      AND actor_id = current_setting('bundle22.rehearsal_actor')::uuid) = 1, 'H4', '작업 기록 1행(과목 2·섹션 수 3, 시험 계정 행위자)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed'
      AND (details ->> 'saved_at')::timestamptz >= v_t AND (details::text LIKE '%인기 다운로드%' OR details::text LIKE '%문제마켓 보기%')) = 0, 'H4', '작업 기록에 문구 원문 없음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_revert')), 'OK', 'H4', '되돌림');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed'
      AND details ->> 'mode' = 'revert' AND (details ->> 'saved_at')::timestamptz >= v_t AND details -> 'deletedSubjects' = '["english", "korean"]'::jsonb) = 1, 'H4', '되돌림 작업 기록 1행');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'H4', m FROM unnest(v_log) m;
  IF v_payload IS NOT NULL THEN
    INSERT INTO _rh_log (test, msg, payload) VALUES ('H4', 'payload', v_payload);
  END IF;
END
$rh_h4$;

-- ===== H6 =====
DO $rh_h6$
DECLARE
  v_log text[] := '{}';
  v_payload jsonb := NULL;
  v_r text;
  v_k jsonb;
  v_e jsonb;
  v_t timestamptz;
BEGIN
  BEGIN
    -- 경우마다 빈 상태에서 시작(거래 안, 경우가 끝나면 되돌려짐)
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    v_t := clock_timestamp();

    -- 국어: 판 1(옛 categories 키 포함, 기본값과 다른 값), 영어: 이미 판 2(revision 7)
    INSERT INTO public.workspace_settings (workspace_subject, setting_key, value, description) VALUES
      ('korean', 'market_home', '{"version": 1, "popular": {"isActive": false, "limit": 5, "rankingWindowDays": 7}, "recent": {"isActive": true, "limit": 3}, "categories": {"isActive": true}}'::jsonb, 'rh'),
      ('english', 'market_home', '{"version": 2, "revision": 7, "sections": [], "emptyHomeLink": null}'::jsonb, 'rh');
    v_e := pg_temp.home('english');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'OK', 'H6', '국어 판 1·영어 판 2 → 시드');
    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.ensure(v_k -> 'version' = '2'::jsonb AND v_k -> 'revision' = '1'::jsonb
      AND v_k #> '{sections,0,isActive}' = 'false'::jsonb AND v_k #> '{sections,0,limit}' = '5'::jsonb AND v_k #> '{sections,0,rankingWindowDays}' = '7'::jsonb
      AND v_k #> '{sections,1,isActive}' = 'true'::jsonb AND v_k #> '{sections,1,limit}' = '3'::jsonb, 'H6', '국어 판 1 → 판 2(revision 1), 켜기·개수·기간 이어받음');
    v_log := v_log || pg_temp.ensure(pg_temp.home('english') = v_e, 'H6', '영어 판 2 행은 그대로');
    v_log := v_log || pg_temp.ensure((SELECT details -> 'subjects' FROM public.admin_audit_log WHERE action = 'market_home_sections_seed' AND (details ->> 'saved_at')::timestamptz >= v_t
      AND details ->> 'mode' = 'seed') = '{"korean": "from_version_1", "english": "kept_version_2"}'::jsonb, 'H6', '작업 기록에 과목별 처리');
    -- 국어: 읽을 수 없는 판 1(모르는 키) → 옛 코드처럼 기본값
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    INSERT INTO public.workspace_settings (workspace_subject, setting_key, value, description) VALUES
      ('korean', 'market_home', '{"version": 1, "popular": {"isActive": false, "limit": 5, "rankingWindowDays": 7}, "recent": {"isActive": false, "limit": 3}, "sourceExplorer": {}}'::jsonb, 'rh');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'OK', 'H6', '읽을 수 없는 판 1 → 시드');
    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.ensure(v_k #> '{sections,0,isActive}' = 'true'::jsonb AND v_k #> '{sections,0,limit}' = '12'::jsonb
      AND v_k #> '{sections,1,isActive}' = 'true'::jsonb AND v_k #> '{sections,1,limit}' = '8'::jsonb, 'H6', '읽을 수 없는 판 1 은 기본값(옛 코드가 그리던 모습)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'H6', m FROM unnest(v_log) m;
  IF v_payload IS NOT NULL THEN
    INSERT INTO _rh_log (test, msg, payload) VALUES ('H6', 'payload', v_payload);
  END IF;
END
$rh_h6$;

-- ===== R =====
DO $rh_r$
DECLARE
  v_log text[] := '{}';
  v_payload jsonb := NULL;
  v_r text;
  v_k jsonb;
  v_e jsonb;
  v_t timestamptz;
BEGIN
  BEGIN
    -- 경우마다 빈 상태에서 시작(거래 안, 경우가 끝나면 되돌려짐)
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    v_t := clock_timestamp();

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_seed')), 'OK', 'R', '시드');
    UPDATE public.workspace_settings SET value = jsonb_set(value, '{revision}', '2'::jsonb) WHERE setting_key = 'market_home' AND workspace_subject = 'korean';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_revert')), 'ERR B22_REVERT: a version 2 market_home row was edited', 'R', '고친 행(revision 2)이 있으면 되돌림은 멈춤');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home') = 2, 'R', '멈춘 되돌림은 아무 행도 지우지 않음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R', m FROM unnest(v_log) m;
  IF v_payload IS NOT NULL THEN
    INSERT INTO _rh_log (test, msg, payload) VALUES ('R', 'payload', v_payload);
  END IF;
END
$rh_r$;

-- ===== 경우 밖에 남은 것 없음(ROLLBACK 전) =====
DO $rh_leftover$
BEGIN
  PERFORM pg_temp.ensure((SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home')::text = pg_temp.ctx('pre_rows'), 'Z', 'market_home 행 수 그대로');
  PERFORM pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed')::text = pg_temp.ctx('pre_audit'), 'Z', '작업 기록 수 그대로');
  INSERT INTO _rh_log (test, msg) VALUES ('Z', '경우 밖에 남은 행·기록 없음');
END
$rh_leftover$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
