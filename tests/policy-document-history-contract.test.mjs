import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// 출시 전 작업 순서표 6번 묶음: 약관 본문 이력(계획 docs/plan-bundle6-terms-revision.md 3판)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20261120130000_policy_document_history.sql')
const ROLLBACK = read('supabase/rollback/20261120130000_policy_document_history_down.sql')

test('사본 표: 추가 전용·UNIQUE 없음(A→B→A 도 남음)·권한은 service_role SELECT 만·시퀀스 권한 회수', () => {
  assert.doesNotMatch(MIGRATION, /UNIQUE \(doc_key, content_sha256\)/)
  assert.match(MIGRATION, /CONSTRAINT policy_document_snapshots_hash_matches CHECK \(content_sha256 = encode\(sha256\(convert_to\(content, 'UTF8'\)\), 'hex'\)\)/)
  assert.match(MIGRATION, /REVOKE ALL ON TABLE public\.policy_document_snapshots FROM PUBLIC, anon, authenticated, service_role;\n/)
  assert.match(MIGRATION, /REVOKE ALL ON SEQUENCE public\.policy_document_snapshots_seq_seq FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(MIGRATION, /GRANT SELECT ON TABLE public\.policy_document_snapshots TO service_role;/)
  assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON public\.policy_document_snapshots/)
  assert.match(MIGRATION, /BEFORE TRUNCATE ON public\.policy_document_snapshots/)
})

test('저장 트리거: site_footer_content 행만, 직전 사본과 해시가 다를 때만 한 행, 문자열이 아닌 본문은 건너뜀', () => {
  assert.match(MIGRATION, /AFTER INSERT OR UPDATE ON public\.system_settings\n  FOR EACH ROW\n  WHEN \(NEW\.key = 'site_footer_content'\)/)
  assert.match(MIGRATION, /jsonb_each\(NEW\.value -> 'policyDocuments'\)/)
  assert.match(MIGRATION, /ORDER BY p\.seq DESC\n     LIMIT 1;\n    IF v_latest IS DISTINCT FROM v_hash THEN/)
  assert.match(MIGRATION, /IF jsonb_typeof\(v_doc\.doc -> 'content'\) IS DISTINCT FROM 'string' THEN\n      CONTINUE;/)
  assert.match(MIGRATION, /UPDATE public\.system_settings SET value = value WHERE key = 'site_footer_content';/)
})

test('동의 기록: 4번 정의 md5 를 확인한 뒤 교체, DEFINER·search_path 유지, 연결 약관 본문 지문을 함께 적음', () => {
  assert.match(MIGRATION, /md5\(pg_get_functiondef\('public\.consent_record_internal\(uuid,jsonb,text\)'::regprocedure\)\) <> '5b14ce9ffa188648c781f48e7a8ef2bd'/)
  const fn = MIGRATION.slice(MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.consent_record_internal'))
  assert.match(fn, /SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'/)
  assert.match(fn, /INSERT INTO public\.user_consents \(user_id, item_id, item_version, agreed, source, policy_sha256\)/)
  assert.match(fn, /d\.value ->> 'slug' = v_item\.policy_slug/)
  assert.match(MIGRATION, /ADD CONSTRAINT user_consents_policy_sha256_check CHECK \(policy_sha256 IS NULL OR policy_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.match(MIGRATION, /'\{postgres=X\/postgres\}'/)
  assert.match(MIGRATION, /VERIFY: consent hashes without snapshot/)
})

test('되돌리기: 함수를 4번 정의로 먼저 되돌린 뒤 열·표를 지운다', () => {
  assert.match(ROLLBACK, /코드 배포 뒤에는 되돌리지 말 것/)
  const restoreAt = ROLLBACK.indexOf('CREATE OR REPLACE FUNCTION public.consent_record_internal')
  assert.ok(restoreAt > 0)
  assert.ok(restoreAt < ROLLBACK.indexOf('DROP COLUMN IF EXISTS policy_sha256'))
  // 되돌리는 함수 본문에는 지울 열을 쓰지 않는다
  assert.doesNotMatch(ROLLBACK.slice(restoreAt, ROLLBACK.indexOf('$fn_consent_record_internal$;', restoreAt)), /policy_sha256/)
})

test('화면: 약관 이력은 site.manage 읽기 전용, 회원 상세는 동의 당시 약관 사본으로 연결', () => {
  const page = read('src/app/(admin)/admin/footer/policy-history/page.tsx')
  assert.match(page, /await requireAdminPagePermission\('site\.manage'\)/)
  assert.match(page, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(rawHash\)/)
  assert.doesNotMatch(page, /'use server'|\.insert\(|\.update\(|\.delete\(/)
  assert.match(read('src/lib/signup-consent-server.ts'), /readConsentLog\(userId, \{ withPolicyHash: true \}\)/)
  assert.match(read('src/app/(admin)/admin/users/[id]/page.tsx'), /const canViewPolicyHistory = hasAdminPermission\(access, 'site\.manage'\)/)
  assert.match(read('src/app/(admin)/admin/users/[id]/page.tsx'), /\/admin\/footer\/policy-history\?hash=\$\{entry\.policySha256\}/)
  assert.match(read('src/app/(admin)/admin/footer/footer-client.tsx'), /href="\/admin\/footer\/policy-history"/)
})
