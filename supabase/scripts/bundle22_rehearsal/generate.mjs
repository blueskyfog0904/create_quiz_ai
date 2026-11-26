// 22번 묶음 리허설 생성기(계획 docs/plan-bundle22-home-merch.md 4절 H1~H6: 실제 스크립트 본문을 실행하고, 사본은 생성기로 만들어 계약 시험으로 고정).
//   node supabase/scripts/bundle22_rehearsal/generate.mjs           → 이 폴더의 a_light.sql 을 다시 쓴다
//   node supabase/scripts/bundle22_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle22_rehearsal/a_light.sql
//   파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 지우고 넣은 market_home 행·작업 기록은 그 경우가 끝나면 되돌려진다.
//   행위자: @test.com 시험 계정(bundle22.rehearsal_actor, 거래 안 설정)만 쓴다(대표·실회원 id 를 쓰지 않음).
//   22번은 스키마 변경이 없다(마이그레이션·이력 표 없음) — 그래서 full 판이 따로 없고 light 하나뿐이다. 표 잠금 DDL 없음(행 잠금만).
//   H3(옛 코드가 판 2 를 기본값으로 읽음)는 순수 시험(tests/bundle22-home-sections.test.mjs)이 옛 파일 사본으로 본다.
//   H5: H1 이 넣은 두 value 를 payload 로 낸다 → tests/fixtures/bundle22-seed-values.json 에 옮겨 새 판 2 검사에 넣는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  seed: 'supabase/scripts/20261224_bundle22_home_sections_seed.sql',
  revert: 'supabase/scripts/20261224_bundle22_home_sections_seed_revert.sql',
}
// light 에 남으면 안 되는 글(표를 잠그는 DDL·이력 표 쓰기·COMMIT)
export const LIGHT_FORBIDDEN = ['ALTER TABLE', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'LOCK TABLE', 'CREATE INDEX',
  'DROP TABLE', 'TRUNCATE', 'supabase_migrations', 'COMMIT;']

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}
const sqlString = (text) => `'${text.replaceAll("'", "''")}'`

function assertLight(sql, label) {
  const body = sql.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) {
    if (body.includes(word)) throw new Error(`${label} still has ${word}`)
  }
}

// 스크립트의 '[본문] 시작 ~ 끝' 구역(BEGIN·실행 확인·COMMIT 밖)
export function scriptBody(path) {
  const lines = read(path).split('\n')
  const start = lines.findIndex((line) => line.includes('[본문] 시작'))
  const end = lines.findIndex((line) => line.includes('[본문] 끝'))
  if (start < 0 || end < start) throw new Error(`${path}: [본문] markers missing`)
  const body = lines.slice(start + 1, end).join('\n')
  assertLight(body, path)
  return body
}

const PRELUDE = `-- 22번 묶음 리허설: A light — 시드·되돌림 스크립트 본문, 경우 H1·H2·H4·H5·H6·R
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
`

const SETUP = `
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
`

function isolatedCase(tag, test, body) {
  return `
-- ===== ${test} =====
DO $${tag}$
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
${body}
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT ${sqlString(test)}, m FROM unnest(v_log) m;
  IF v_payload IS NOT NULL THEN
    INSERT INTO _rh_log (test, msg, payload) VALUES (${sqlString(test)}, 'payload', v_payload);
  END IF;
END
$${tag}$;
`
}

const SEED = "pg_temp.ctx('src_seed')"
const REVERT = "pg_temp.ctx('src_revert')"

// 시드가 넣은 판 2 값 모양(문구 그대로·섹션 3개·revision 1)
const seededShape = (subject, link) => `
    v_k := pg_temp.home('${subject}');
    v_log := v_log || pg_temp.ensure(v_k -> 'version' = '2'::jsonb AND v_k -> 'revision' = '1'::jsonb, '${'$'}{T}', '${subject}: 판 2·revision 1');
    v_log := v_log || pg_temp.ensure(jsonb_array_length(v_k -> 'sections') = 3
      AND v_k #>> '{sections,0,kind}' = 'popular' AND v_k #>> '{sections,0,title}' = '인기 다운로드 자료' AND v_k #>> '{sections,0,emptyText}' = '아직 다운로드 집계가 없습니다.'
      AND v_k #>> '{sections,1,kind}' = 'recent' AND v_k #>> '{sections,1,title}' = '최근 등록된 수업 자료' AND v_k #>> '{sections,1,emptyText}' = '최근 등록된 자료가 없습니다.'
      AND v_k #>> '{sections,2,kind}' = 'featured' AND v_k #> '{sections,2,isActive}' = 'false'::jsonb AND v_k #> '{sections,2,itemIds}' = '[]'::jsonb
      AND v_k ->> 'emptyHomeLink' = '${link}', '${'$'}{T}', '${subject}: 섹션 3개·문구 그대로·추천 꺼짐·빈 홈 링크');`

const withTest = (sql, test) => sql.replaceAll('${T}', test)

const H1 = isolatedCase('rh_h1', 'H1', withTest(`
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'OK', '\${T}', '행 없음 → 시드 실행');
${seededShape('korean', '국어 문제마켓 보기')}
${seededShape('english', '영어 문제마켓 보기')}
    v_log := v_log || pg_temp.ensure((pg_temp.home('korean') #>> '{sections,0,isActive}')::boolean AND (pg_temp.home('korean') #>> '{sections,1,isActive}')::boolean
      AND pg_temp.home('korean') #> '{sections,0,limit}' = '12'::jsonb AND pg_temp.home('korean') #> '{sections,0,rankingWindowDays}' = '30'::jsonb
      AND pg_temp.home('korean') #> '{sections,1,limit}' = '8'::jsonb, '\${T}', '행 없음이면 지금 기본값(인기 12·30일·최근 8, 둘 다 켜짐) = 지금 회원 홈 모습');
    -- H5: 넣은 두 value 를 순수 시험 입력으로 낸다
    v_payload := jsonb_build_object('korean', pg_temp.home('korean'), 'english', pg_temp.home('english'));
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${REVERT}), 'OK', '\${T}', '되돌림 실행');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home') = 0, '\${T}', '되돌림 뒤 market_home 0행');`, 'H1'))

const H2 = isolatedCase('rh_h2', 'H2', withTest(`
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'OK', '\${T}', '첫 시드');
    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'ERR B22_SEED: both subjects already have version 2', '\${T}', '두 과목 모두 판 2 면 다시 실행은 멈춤');
    v_log := v_log || pg_temp.ensure(pg_temp.home('korean') = v_k, '\${T}', '멈춘 실행은 행을 바꾸지 않음');`, 'H2'))

const H4 = isolatedCase('rh_h4', 'H4', withTest(`
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'OK', '\${T}', '시드');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed'
      AND details ->> 'bundle' = 'bundle22_home_sections_seed' AND details ->> 'mode' = 'seed' AND (details ->> 'saved_at')::timestamptz >= v_t
      AND details -> 'subjects' = '{"korean": "inserted", "english": "inserted"}'::jsonb AND details -> 'sectionCount' = '3'::jsonb
      AND actor_id = current_setting('bundle22.rehearsal_actor')::uuid) = 1, '\${T}', '작업 기록 1행(과목 2·섹션 수 3, 시험 계정 행위자)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed'
      AND (details ->> 'saved_at')::timestamptz >= v_t AND (details::text LIKE '%인기 다운로드%' OR details::text LIKE '%문제마켓 보기%')) = 0, '\${T}', '작업 기록에 문구 원문 없음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${REVERT}), 'OK', '\${T}', '되돌림');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed'
      AND details ->> 'mode' = 'revert' AND (details ->> 'saved_at')::timestamptz >= v_t AND details -> 'deletedSubjects' = '["english", "korean"]'::jsonb) = 1, '\${T}', '되돌림 작업 기록 1행');`, 'H4'))

const H6 = isolatedCase('rh_h6', 'H6', withTest(`
    -- 국어: 판 1(옛 categories 키 포함, 기본값과 다른 값), 영어: 이미 판 2(revision 7)
    INSERT INTO public.workspace_settings (workspace_subject, setting_key, value, description) VALUES
      ('korean', 'market_home', '{"version": 1, "popular": {"isActive": false, "limit": 5, "rankingWindowDays": 7}, "recent": {"isActive": true, "limit": 3}, "categories": {"isActive": true}}'::jsonb, 'rh'),
      ('english', 'market_home', '{"version": 2, "revision": 7, "sections": [], "emptyHomeLink": null}'::jsonb, 'rh');
    v_e := pg_temp.home('english');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'OK', '\${T}', '국어 판 1·영어 판 2 → 시드');
    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.ensure(v_k -> 'version' = '2'::jsonb AND v_k -> 'revision' = '1'::jsonb
      AND v_k #> '{sections,0,isActive}' = 'false'::jsonb AND v_k #> '{sections,0,limit}' = '5'::jsonb AND v_k #> '{sections,0,rankingWindowDays}' = '7'::jsonb
      AND v_k #> '{sections,1,isActive}' = 'true'::jsonb AND v_k #> '{sections,1,limit}' = '3'::jsonb, '\${T}', '국어 판 1 → 판 2(revision 1), 켜기·개수·기간 이어받음');
    v_log := v_log || pg_temp.ensure(pg_temp.home('english') = v_e, '\${T}', '영어 판 2 행은 그대로');
    v_log := v_log || pg_temp.ensure((SELECT details -> 'subjects' FROM public.admin_audit_log WHERE action = 'market_home_sections_seed' AND (details ->> 'saved_at')::timestamptz >= v_t
      AND details ->> 'mode' = 'seed') = '{"korean": "from_version_1", "english": "kept_version_2"}'::jsonb, '\${T}', '작업 기록에 과목별 처리');
    -- 국어: 읽을 수 없는 판 1(모르는 키) → 옛 코드처럼 기본값
    DELETE FROM public.workspace_settings WHERE setting_key = 'market_home';
    INSERT INTO public.workspace_settings (workspace_subject, setting_key, value, description) VALUES
      ('korean', 'market_home', '{"version": 1, "popular": {"isActive": false, "limit": 5, "rankingWindowDays": 7}, "recent": {"isActive": false, "limit": 3}, "sourceExplorer": {}}'::jsonb, 'rh');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'OK', '\${T}', '읽을 수 없는 판 1 → 시드');
    v_k := pg_temp.home('korean');
    v_log := v_log || pg_temp.ensure(v_k #> '{sections,0,isActive}' = 'true'::jsonb AND v_k #> '{sections,0,limit}' = '12'::jsonb
      AND v_k #> '{sections,1,isActive}' = 'true'::jsonb AND v_k #> '{sections,1,limit}' = '8'::jsonb, '\${T}', '읽을 수 없는 판 1 은 기본값(옛 코드가 그리던 모습)');`, 'H6'))

const R = isolatedCase('rh_r', 'R', withTest(`
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${SEED}), 'OK', '\${T}', '시드');
    UPDATE public.workspace_settings SET value = jsonb_set(value, '{revision}', '2'::jsonb) WHERE setting_key = 'market_home' AND workspace_subject = 'korean';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${REVERT}), 'ERR B22_REVERT: a version 2 market_home row was edited', '\${T}', '고친 행(revision 2)이 있으면 되돌림은 멈춤');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home') = 2, '\${T}', '멈춘 되돌림은 아무 행도 지우지 않음');`, 'R'))

const LEFTOVER = `
-- ===== 경우 밖에 남은 것 없음(ROLLBACK 전) =====
DO $rh_leftover$
BEGIN
  PERFORM pg_temp.ensure((SELECT count(*) FROM public.workspace_settings WHERE setting_key = 'market_home')::text = pg_temp.ctx('pre_rows'), 'Z', 'market_home 행 수 그대로');
  PERFORM pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'market_home_sections_seed')::text = pg_temp.ctx('pre_audit'), 'Z', '작업 기록 수 그대로');
  INSERT INTO _rh_log (test, msg) VALUES ('Z', '경우 밖에 남은 행·기록 없음');
END
$rh_leftover$;
`

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

export function buildRehearsalFiles() {
  const sources = `
-- ===== 원본 스크립트 본문(실행 확인 구역 밖, BEGIN·COMMIT 없음) =====
SELECT pg_temp.ctx_set('src_seed', ${dollar('rh_src_seed', scriptBody(SOURCES.seed))});
SELECT pg_temp.ctx_set('src_revert', ${dollar('rh_src_revert', scriptBody(SOURCES.revert))});
`
  const light = PRELUDE + SETUP + sources + H1 + H2 + H4 + H6 + R + LEFTOVER + FOOT
  if (/\bCOMMIT\s*;/.test(light)) throw new Error('a_light.sql contains a COMMIT statement')
  if (!light.trimEnd().endsWith('ROLLBACK;')) throw new Error('a_light.sql must end with ROLLBACK')
  assertLight(light, 'a_light.sql')
  return { 'a_light.sql': light }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildRehearsalFiles()
  const check = process.argv.includes('--check')
  let stale = 0
  for (const [name, content] of Object.entries(files)) {
    const path = join(HERE, name)
    if (check) {
      let current = ''
      try { current = readFileSync(path, 'utf8') } catch { /* 없음 */ }
      if (current !== content) { stale += 1; console.error(`stale: ${name}`) }
    } else {
      writeFileSync(path, content)
      console.log(`wrote ${name} (${content.split('\n').length} lines)`)
    }
  }
  if (stale) process.exit(1)
}
