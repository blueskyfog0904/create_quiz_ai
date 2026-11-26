import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import '../src/components/features/passages/node-test-register.mjs'
import { readProductAdminSource } from './helpers/product-admin-sources.mjs'

// 19번 계획(docs/plan-bundle19-product-display.md) 9-1 의 계약·단위 시험. DB 동작은 리허설(4-6, supabase/scripts/bundle19_rehearsal)이 본다.
// 등록 훅이 켜진 뒤에 불러야 '@/' 경로를 찾는다(정적 import 는 훅보다 먼저 풀린다).
const options = await import('../src/lib/market-item-options.ts')
const cartLineTitle = await import('../src/lib/cart-line-title.ts')
const generator = await import('../supabase/scripts/bundle19_rehearsal/generate.mjs')
const generator17 = await import('../supabase/scripts/bundle17_rehearsal/generate.mjs')

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20261221100000_bundle19_product_display.sql')
const DOWN = read('supabase/rollback/20261221100000_bundle19_product_display_down.sql')
const MIGRATION_17 = read('supabase/migrations/20261219100000_bundle17_product_info.sql')
const LABEL_SCRIPT = read('supabase/scripts/20261221_bundle19_bundle_label.sql')
const LABEL_REVERT = read('supabase/scripts/20261221_bundle19_bundle_label_revert.sql')
const sqlNoComments = (sql) => sql.replace(/--[^\n]*/g, '')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry)
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(path)
  }
  return out
}
const SRC_FILES = walk('src').map((path) => relative('.', path))

function fnBody(sql, name) {
  const match = sql.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn_${name}\\$([\\s\\S]*?)\\$fn_${name}\\$;`))
  assert.ok(match, `${name} 정의`)
  return match[1]
}
const sqlArrayItems = (body, name) => [...body.match(new RegExp(`${name} text\\[\\] := ARRAY\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

// ── 마이그레이션 ─────────────────────────────────────────────────────────────────────────────────
test('마이그레이션: 기존 표 DDL 없음(설정 행 UPDATE·함수만), BEGIN/COMMIT 없음, 잠금 시간, 사전 점검 지문, NOTIFY', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.doesNotMatch(sql, /ALTER TABLE|CREATE TABLE|CREATE TRIGGER|DROP TRIGGER|CREATE INDEX|CREATE POLICY|LOCK TABLE|SET DEFAULT|ADD COLUMN|DROP /)
  assert.doesNotMatch(sql, /\bBEGIN;|\bCOMMIT;|\bROLLBACK;/)
  assert.match(sql, /SET LOCAL lock_timeout = '3s';/)
  assert.match(sql, /<> 'a42b474d9d95753ffba5041acb0c1c77'/)
  assert.match(sql, /md5\(pg_get_functiondef\('public\.save_market_item_display\(uuid,integer,jsonb,jsonb\)'::regprocedure\)\) <> '5cd1e1f548bd73aea05f5845a0212a6a'/)
  assert.equal(generator.BUNDLE17_DISPLAY_FINGERPRINT, '5cd1e1f548bd73aea05f5845a0212a6a')
  assert.match(sql, /IF v_value \? 'detail' THEN\n\s+RAISE EXCEPTION 'PRECHECK: market_item_display already has detail'/)
  assert.match(sql, /to_regprocedure\('public\.duplicate_market_item\(uuid,text,uuid,text,jsonb\)'\) IS NULL/)
  assert.match(sql, /p\.proname = 'reorder_market_item_subproducts'\) THEN\n\s+RAISE EXCEPTION 'PRECHECK: reorder_market_item_subproducts already exists'/)
  // 설정 행 한 줄: detail 더하기 + 판 +1(다른 키 그대로)
  assert.match(sql, /SET value = s\.value \|\| jsonb_build_object\('revision', \(s\.value ->> 'revision'\)::integer \+ 1, 'detail', \$json_bundle19_detail\$/)
  // VERIFY: 판이 정확히 1 오름(사전 점검이 거래 안에만 보관한 적용 전 판과 비교)
  assert.match(sql, /PERFORM set_config\('bundle19\.revision_before', v_value ->> 'revision', true\);/)
  assert.match(sql, /\(v_value ->> 'revision'\)::integer IS DISTINCT FROM current_setting\('bundle19\.revision_before'\)::integer \+ 1/)
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('마이그레이션: detail 필수 키(함수·VERIFY) = 코드 MARKET_ITEM_DISPLAY_REQUIRED_KEYS, 첫 값은 지금 화면 글자(샘플 문장만 새 문장)', () => {
  const save = fnBody(MIGRATION, 'save_market_item_display')
  const shortKeys = sqlArrayItems(save, 'v_detail_short_keys')
  const longKeys = sqlArrayItems(save, 'v_detail_long_keys')
  const summaryKeys = sqlArrayItems(save, 'v_summary_keys')
  const infoKeys = sqlArrayItems(save, 'v_info_keys')
  assert.deepEqual(shortKeys, [...options.MARKET_ITEM_DETAIL_SHORT_KEYS])
  assert.deepEqual(longKeys, [...options.MARKET_ITEM_DETAIL_LONG_KEYS])
  assert.deepEqual(sqlArrayItems(save, 'v_detail_count_keys'), [...options.MARKET_ITEM_DETAIL_COUNT_KEYS])
  assert.deepEqual(summaryKeys, [...options.MARKET_ITEM_SUMMARY_LABEL_KEYS])
  assert.deepEqual(infoKeys, [...options.MARKET_ITEM_INFO_KEYS])
  assert.deepEqual(
    options.MARKET_ITEM_DISPLAY_REQUIRED_KEYS.filter((key) => key.startsWith('detail.')),
    [...shortKeys, ...longKeys].map((key) => `detail.${key}`).concat(summaryKeys.map((key) => `detail.summaryLabels.${key}`), ['detail.infoItems']),
  )
  // 필수 키 목록은 코드 한 곳에만
  const definers = SRC_FILES.filter((path) => /MARKET_ITEM_DISPLAY_REQUIRED_KEYS = /.test(readFileSync(join(ROOT, path), 'utf8')))
  assert.deepEqual(definers, ['src/lib/market-item-options.ts'])
  // 글자 수·자리표시 규칙(4-2)
  assert.match(save, /v_max := CASE WHEN v_key = ANY \(v_detail_long_keys\) THEN 200 ELSE 30 END;/)
  assert.match(save, /CASE WHEN v_key = ANY \(v_detail_count_keys\) THEN replace\(v_text, '\{장수\}', ''\) ELSE v_text END\) ~ '\\\{\[\^\{\}\]\*\\\}'/)
  // 17번 규칙은 17번 키에만(받았을 때만), 없는 최상위 키는 그대로(합치기)
  assert.match(save, /IF p_value \? 'facetLabels' THEN/)
  assert.match(save, /IF p_value \? 'detail' THEN/)
  assert.match(save, /v_new := v_old \|\| v_patch \|\| jsonb_build_object\('revision', v_revision \+ 1\);/)
  assert.match(save, /'market_item_display_update'/)
  // 첫 값: 지금 화면 글자(샘플 설명만 Q2 새 문장), 코드 검사·파싱 통과
  const seed = generator.seedDetailFromMigration()
  assert.equal(seed.sampleTitle, '무료 샘플 미리보기')
  assert.equal(seed.sampleTitleEmpty, '샘플 준비 중')
  assert.equal(seed.sampleDescription, '샘플 {장수}장을 미리 볼 수 있어요.')
  assert.equal(seed.sampleRowButton, '샘플 보기')
  assert.equal(seed.sampleButton, '샘플 {장수}장 보기')
  assert.equal(seed.sampleButtonEmpty, '샘플 없음')
  assert.equal(seed.hwpPdfNoticeLabel, 'PDF 포함')
  assert.equal(seed.bundleDefaultTitle, '전체 패키지')
  assert.deepEqual(seed.summaryLabels, { questionCount: '포함 문항', samplePages: '샘플 페이지', unknown: '정보 없음', noSample: '제공 없음' })
  assert.deepEqual(seed.infoItems.map((info) => info.label), ['과목', '학년', '출처', '자료유형', '문항 수', '등록일자'])
  const parsed = options.parseMarketItemDetailDisplay(seed)
  assert.ok(parsed)
  assert.equal(options.findMarketItemDetailDisplayProblem(parsed), null)
  assert.ok(options.parseMarketItemDisplay({ ...generator17.seedDisplayFromMigration(), detail: seed }))
})

test('마이그레이션: 함수 권한(새 함수 EXECUTE 회수 → service_role), 기록 종류 글자 꼴, 오류 코드 = 코드 매핑', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.reorder_market_item_subproducts\(uuid, uuid, uuid\[\], jsonb\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reorder_market_item_subproducts\(uuid, uuid, uuid\[\], jsonb\) TO service_role;/)
  for (const name of ['save_market_item_display', 'reorder_market_item_subproducts']) {
    assert.match(MIGRATION, new RegExp(`FUNCTION public\\.${name}\\([^)]*\\)\\n RETURNS jsonb\\n LANGUAGE plpgsql\\n SECURITY DEFINER\\n SET search_path TO 'public', 'pg_temp'`))
  }
  const actions = [...sql.matchAll(/record_admin_audit\(p_actor_id, '([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(actions.sort(), ['market_item_display_update', 'market_subproduct_reorder'])
  for (const action of actions) assert.match(action, /^[a-z][a-z_]+[a-z]$/)
  const raised = new Set([...sql.matchAll(/RAISE EXCEPTION '(MARKET_[A-Z_]+)/g)].map((m) => m[1]))
  const known = { ...options.MARKET_ITEM_OPTION_ERROR_MESSAGES, ...options.MARKET_SUBPRODUCT_ORDER_ERROR_MESSAGES }
  for (const code of raised) assert.ok(code in known, code)
  assert.deepEqual([...raised].filter((code) => code.startsWith('MARKET_SUBPRODUCT_REORDER')).sort(), Object.keys(options.MARKET_SUBPRODUCT_ORDER_ERROR_MESSAGES).sort())
  assert.deepEqual(options.extractMarketItemOptionError('MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:ids'), { code: 'MARKET_SUBPRODUCT_REORDER_INPUT_INVALID', detail: 'ids' })
  assert.deepEqual(options.extractMarketItemOptionError('MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.summaryLabels.unknown'),
    { code: 'MARKET_ITEM_DISPLAY_INPUT_INVALID', detail: 'detail.summaryLabels.unknown' })
  // 순서 함수: 상품 행 잠금 → 지우지 않은 서브상품 전부와 집합 대조 → 10 × 순번 → 같으면 기록 없음
  const reorder = fnBody(MIGRATION, 'reorder_market_item_subproducts')
  assert.match(reorder, /FOR NO KEY UPDATE;/)
  assert.match(reorder, /s\.deleted_at IS NULL;/)
  assert.match(reorder, /RAISE EXCEPTION 'MARKET_SUBPRODUCT_REORDER_MISMATCH'/)
  assert.match(reorder, /SET sort_order = \(10 \* r\.ord\)::integer/)
  assert.ok(reorder.indexOf("RETURN jsonb_build_object('changed', false)") < reorder.indexOf('record_admin_audit'))
})

test('down: 순서 함수 지우기·17번 정의 전문(글자까지 같음)·detail 만 빼기, 17번 down 은 19번 상태에서 멈춤', () => {
  const sql = sqlNoComments(DOWN)
  assert.match(sql, /DROP FUNCTION public\.reorder_market_item_subproducts\(uuid, uuid, uuid\[\], jsonb\);/)
  assert.match(sql, /SET value = \(s\.value - 'detail'\) \|\| jsonb_build_object\('revision', \(s\.value ->> 'revision'\)::integer \+ 1\)/)
  assert.match(sql, /<> '5cd1e1f548bd73aea05f5845a0212a6a'/)
  assert.doesNotMatch(sql, /ALTER TABLE|SET DEFAULT|market_subproduct_reorder|UPDATE public\.market_item_subproducts/)
  // 17번 원본 함수 글(CREATE FUNCTION → CREATE OR REPLACE FUNCTION 만 다름)
  const original = MIGRATION_17.match(/CREATE FUNCTION public\.save_market_item_display\([\s\S]*?\$fn_save_market_item_display\$;/)[0]
  assert.ok(DOWN.includes(original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')))
  // 17번 down 의 19번 판정(본문에 detail)과 맞물린다
  assert.match(fnBody(MIGRATION, 'save_market_item_display'), /detail/)
  assert.match(read('supabase/rollback/20261219100000_bundle17_product_info_down.sql'), /p\.proname = 'save_market_item_display'\n\s+AND p\.prosrc ~\* 'detail'/)
})

// ── 표시명 스크립트(마이그레이션 밖) ─────────────────────────────────────────────────────────────────
test('표시명 스크립트: 실행 직전 건수·id md5 대조(비면 멈춤), 한 거래 기록 1건 + UPDATE, VERIFY, 표 DDL 없음', () => {
  const sql = sqlNoComments(LABEL_SCRIPT)
  assert.match(sql, /^BEGIN;\nSET LOCAL lock_timeout = '3s';/m)
  assert.match(sql, /\nCOMMIT;\n$/)
  assert.match(sql, /c_actor_id constant uuid := NULL;\n\s+c_expected_count constant integer := NULL;\n\s+c_expected_ids_md5 constant text := NULL;/)
  assert.match(sql, /IF c_actor_id IS NULL OR c_expected_count IS NULL OR c_expected_ids_md5 IS NULL THEN/)
  assert.match(sql, /IF cardinality\(v_ids\) <> c_expected_count\n\s+OR md5\(coalesce\(array_to_string\(v_ids, ','\), ''\)\) <> c_expected_ids_md5 THEN/)
  // 머리 주석의 세는 조회와 같은 순서·꼴
  assert.match(LABEL_SCRIPT, /md5\(coalesce\(string_agg\(id::text, ',' ORDER BY id\), ''\)\) AS ids_md5/)
  assert.equal(sql.split("record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update'").length - 1, 1)
  assert.match(sql, /jsonb_build_object\('mode', 'apply', 'ids', to_jsonb\(v_ids\), 'old_label', c_old_label, 'new_label', c_new_label, 'count', cardinality\(v_ids\)\)/)
  assert.match(sql, /c_old_label constant text := '전체 한번에 구매하기';\n\s+c_new_label constant text := '전체 패키지';/)
  assert.match(sql, /OR v_updated <> cardinality\(v_ids\) THEN/)
  assert.doesNotMatch(sql, /ALTER TABLE|SET DEFAULT|updated_at =/)
})

test('되돌림 스크립트: 실행 기록 ids 가운데 지금도 새 글자인 행만, 남긴 행 수를 기록·보고, 기록 1건', () => {
  const sql = sqlNoComments(LABEL_REVERT)
  assert.match(sql, /a\.details ->> 'mode' = 'apply'/)
  assert.match(sql, /WHERE o\.id = ANY \(v_applied\) AND o\.label = c_applied_label ORDER BY o\.id FOR UPDATE/)
  assert.match(sql, /UPDATE public\.market_item_bundle_options o SET label = c_restore_label WHERE o\.id = ANY \(v_ids\) AND o\.label = c_applied_label;/)
  assert.equal(sql.split("record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update'").length - 1, 1)
  assert.match(sql, /'mode', 'revert', 'ids', to_jsonb\(v_ids\), 'kept_ids', to_jsonb\(v_kept\)/)
  assert.match(sql, /\nCOMMIT;\n$/)
})

test('리허설: 생성 파일이 원본과 같고, COMMIT 없이 ROLLBACK 으로 끝나며, light 는 시험 글자 사본·기존 표 DDL 없음', () => {
  const files = generator.buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle19_rehearsal/${name}`), content, `${name} 이 생성기와 다르다(node supabase/scripts/bundle19_rehearsal/generate.mjs)`)
    assert.doesNotMatch(content, /\bCOMMIT\s*;/)
    assert.match(content, /ROLLBACK;\n$/)
  }
  const light = files['a_light.sql']
  assert.match(light, new RegExp(`c_old_label constant text := '${generator.REHEARSAL_OLD_LABEL}';`))
  assert.doesNotMatch(light.replace(/--[^\n]*/g, ''), /supabase_migrations|SET DEFAULT/)
  for (const test of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) assert.ok(light.includes(`'${test}'`), test)
  assert.match(files['b_full.sql'], /INSERT INTO supabase_migrations\.schema_migrations \(version, name\) VALUES \('20261221100000', 'bundle19_product_display'\);/)
  assert.doesNotMatch(files['b_full.sql'], new RegExp(generator.REHEARSAL_OLD_LABEL))
})

// ── 순수 함수 ────────────────────────────────────────────────────────────────────────────────────
const detail = options.parseMarketItemDetailDisplay(generator.seedDetailFromMigration())

test('buildMaterialInfoRows: 설정 순서·숨김·빈 값 빼기·출처 1~4 잇기', () => {
  const item = { subject: '국어', grade: ' 1학년 ', sources: ['가', null, '  ', '라'], materialType: '', questionCount: 1234, registeredAt: '2026년 11월 20일' }
  assert.deepEqual(options.buildMaterialInfoRows(item, detail).map((row) => [row.key, row.label, row.value]), [
    ['subject', '과목', '국어'], ['grade', '학년', '1학년'], ['sources', '출처', '가 · 라'], ['questionCount', '문항 수', '1,234'], ['registeredAt', '등록일자', '2026년 11월 20일'],
  ])
  const reordered = { infoItems: [...detail.infoItems].reverse().map((info) => (info.key === 'grade' ? { ...info, visible: false } : info)) }
  assert.deepEqual(options.buildMaterialInfoRows(item, reordered).map((row) => row.key), ['registeredAt', 'questionCount', 'sources', 'subject'])
  assert.deepEqual(options.buildMaterialInfoRows({ ...item, questionCount: null, sources: [] }, detail).map((row) => row.key), ['subject', 'grade', 'registeredAt'])
  assert.equal(options.isInfoItemVisible(reordered, 'grade'), false)
  assert.equal(options.isInfoItemVisible(reordered, 'registeredAt'), true)
  assert.equal(options.isInfoItemVisible(null, 'registeredAt'), false)
})

test('resolveBundleTitle: 앞뒤 공백·빈 값 → 기본 제목, 40자 그대로, 설정이 없으면 null', () => {
  assert.equal(options.resolveBundleTitle('  1학기 묶음  ', detail), '1학기 묶음')
  assert.equal(options.resolveBundleTitle('   ', detail), '전체 패키지')
  assert.equal(options.resolveBundleTitle('', detail), '전체 패키지')
  assert.equal(options.resolveBundleTitle(null, detail), '전체 패키지')
  const long = '가'.repeat(40)
  assert.equal(options.resolveBundleTitle(long, detail), long)
  assert.equal(options.resolveBundleTitle('', null), null)
  assert.equal(options.resolveBundleTitle('이름', null), '이름')
})

test('{장수} 채우기: 0·1·12, 자리표시 없는 문구는 그대로', () => {
  assert.equal(options.fillSampleCount(detail.sampleDescription, 0), '샘플 0장을 미리 볼 수 있어요.')
  assert.equal(options.fillSampleCount(detail.sampleDescription, 1), '샘플 1장을 미리 볼 수 있어요.')
  assert.equal(options.fillSampleCount(detail.sampleButton, 12), '샘플 12장 보기')
  assert.equal(options.fillSampleCount('샘플을 볼 수 있어요.', 3), '샘플을 볼 수 있어요.')
})

test('detail 검사(코드 = DB 규칙): 201자·31자·줄바꿈·모르는 자리표시·받지 않는 키의 {장수}·infoItems 빠짐·겹침', () => {
  const problem = (patch) => options.findMarketItemDetailDisplayProblem({ ...detail, ...patch })
  assert.equal(problem({}), null)
  assert.equal(problem({ hwpPdfNoticeText: '가'.repeat(200) }), null)
  assert.equal(problem({ hwpPdfNoticeText: '가'.repeat(201) }), 'detail.hwpPdfNoticeText')
  assert.equal(problem({ sampleRowButton: '가'.repeat(31) }), 'detail.sampleRowButton')
  assert.equal(problem({ sampleTitle: '샘플\n제목' }), 'detail.sampleTitle')
  assert.equal(problem({ sampleDescription: '샘플 {페이지}장' }), 'detail.sampleDescription')
  assert.equal(problem({ sampleTitle: '샘플 {장수}장' }), 'detail.sampleTitle')
  assert.equal(problem({ bundleDefaultTitle: '{type} 묶음' }), 'detail.bundleDefaultTitle')
  assert.equal(problem({ summaryLabels: { ...detail.summaryLabels, unknown: ' ' } }), 'detail.summaryLabels.unknown')
  assert.equal(problem({ infoItems: detail.infoItems.slice(1) }), 'detail.infoItems')
  assert.equal(problem({ infoItems: detail.infoItems.map((info, index) => (index === 1 ? { ...info, key: 'subject' } : info)) }), 'detail.infoItems')
  assert.equal(problem({ infoItems: detail.infoItems.map((info, index) => (index === 1 ? { ...info, label: '' } : info)) }), 'detail.infoItems.label')
  assert.equal(options.parseMarketItemDetailDisplay({ ...generator.seedDetailFromMigration(), infoItems: detail.infoItems.slice(1) }), null)
  assert.equal(options.parseMarketItemDetailDisplay({ ...generator.seedDetailFromMigration(), sampleTitle: ' ' }), null)
})

test('장바구니 줄 이름 겹침 정리: 같음 → 한 번(꼬리표만), 다름 → 둘, 빈 이름 → 꼬리표만', () => {
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('bundle', '전체 패키지', '전체 패키지'), null)
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('bundle', '전체 패키지', ' 전체 패키지 '), null)
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('bundle', '전체 패키지', '1학기 묶음'), '1학기 묶음')
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('bundle', '전체 패키지', ''), null)
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('bundle', '전체 패키지', null), null)
  // 개별 자료 줄은 지금 그대로(꼬리표와 같아도 숨기지 않음)
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('subproduct', '워크북', '워크북'), '워크북')
  assert.equal(cartLineTitle.resolveCartLineOptionTitle('subproduct', '워크북', null), null)
  const view = read('src/app/(solvook)/cart/_components/cart-line-list-view.tsx')
  assert.match(view, /const lineOptionTitle = resolveCartLineOptionTitle\(item\.targetKind, lineTag, item\.optionTitle\)/)
  assert.match(view, /\{lineOptionTitle \? \(/)
  assert.doesNotMatch(view, /\{item\.optionTitle \? \(/)
})

// ── 글자 고정·옛 기본 글자 ─────────────────────────────────────────────────────────────────────────
const itemActions = read('src/components/market/market-item-actions.tsx')
const materialDetail = read('src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')
const sampleButton = read('src/app/preview/solvook-concept/_components/detail/market-material-sample-button.tsx')
const sampleRow = read('src/components/market/market-sample-row.tsx')

test('글자 고정: 상세·구매 칸·샘플 버튼에 "첫 N쪽" 문장·DEFAULT_HWP_PDF_NOTICE·자료 정보 이름 6개가 없다', () => {
  for (const [name, source] of [['itemActions', itemActions], ['materialDetail', materialDetail], ['sampleButton', sampleButton], ['sampleRow', sampleRow]]) {
    assert.doesNotMatch(source, /첫 [^\n]{0,30}쪽/, name)
    assert.doesNotMatch(source, /DEFAULT_HWP_PDF_NOTICE/, name)
    assert.doesNotMatch(source, /'무료 샘플 미리보기'|'샘플 준비 중'|'샘플 없음'|'포함 문항'|'샘플 페이지'|'정보 없음'|'제공 없음'/, name)
  }
  for (const label of ['과목', '학년', '출처', '자료유형', '문항 수', '등록일자']) {
    assert.doesNotMatch(materialDetail, new RegExp(`label: '${label}'|>${label}<`), label)
  }
  assert.match(sampleButton, /\{fillSampleCount\(label, samplePageCount\)\}/)
  assert.match(materialDetail, /label=\{samplePageCount > 0 \? display\.sampleButton : display\.sampleButtonEmpty\}/)
})

test('전체구매 제목: 제목 span·체크박스 이름·담기 선택 제목에 고정 "전체 패키지"가 없고(표시명 규칙), 선택 불가 이유 두 줄은 그대로(Q8)', () => {
  const v2 = itemActions.slice(itemActions.indexOf('const renderV2PurchaseOptions'), itemActions.indexOf('const hasV2PurchaseOptions'))
  const heading = v2.slice(v2.indexOf('<h3 className="break-keep text-xl font-extrabold">'), v2.indexOf('</h3>'))
  assert.doesNotMatch(heading, /전체 패키지/)
  assert.match(heading, /renderOptionSelectControl\(bundleKey, INK_BLOCK_CHECKBOX_CLASS, `\$\{bundleTitle\} 선택`\)/)
  assert.match(itemActions, /title: bundleTitle,/)
  assert.doesNotMatch(itemActions, /bundleOption\.label \|\| '전체 패키지'/)
  // 표시명과 설정이 함께 없으면 상품 제목(이름 없는 체크박스·aria-labelledby 방지)
  assert.match(itemActions, /const bundleTitle = resolveBundleTitle\(bundleOption\?\.label, display\) \?\? itemTitle/)
  assert.match(itemActions, /const BUNDLE_SELECTED_REASON = '전체 패키지에 포함되어 함께 선택할 수 없습니다\. 개별 구매는 전체 패키지 선택을 해제하세요\.'/)
  assert.match(itemActions, /const SUBPRODUCT_SELECTED_REASON = '개별 자료를 선택한 상태에서는 전체 패키지를 함께 선택할 수 없습니다\.'/)
  assert.match(itemActions, /대표 결정\(11월 20일\)으로 표시명 사용/)
})

test('옛 기본 글자: src/ 에 "전체 한번에 구매하기"가 없고, 전체구매 INSERT 는 늘 label 을 넘긴다(DB 칸 기본값에 기대지 않음)', () => {
  for (const path of SRC_FILES) {
    assert.doesNotMatch(readFileSync(join(ROOT, path), 'utf8'), /전체 한번에 구매하기/, path)
  }
  const server = read('src/lib/market-items-server.ts')
  const upsert = server.slice(server.indexOf('export async function upsertMarketItemBundleOption'), server.indexOf('export async function disableMarketItemBundleOption'))
  assert.match(upsert, /\n\s+label: normalizeText\(input\.label\),\n/)
  assert.match(upsert, /\.insert\(payload as TablesInsert<'market_item_bundle_options'>\)/)
  assert.match(read('src/app/api/admin/market/items/[id]/bundle-option/route.ts'), /label: parsed\.data\.label \?\? '',/)
  const admin = readProductAdminSource()
  assert.match(admin, /label: '',\n/)
  assert.match(admin, /label: option\.label,\n/)
  assert.match(admin, /label: bundleForm\.label,\n/)
  // 관리자 주문 화면: 빈 표시명이면 줄 종류 이름(이미 있는 목록)으로
  assert.match(read('src/lib/admin-orders-server.ts'), /title: line\.subproduct\?\.title \?\? \(line\.bundle\?\.label \|\| null\) \?\? null,/)
})

// ── 결제 경로·상세 읽기 ─────────────────────────────────────────────────────────────────────────────
test('결제 경로 고정: 장바구니·결제 경로 파일은 표시 설정(market-item-options-server)을 가져오지 않는다, 상세 page 만 읽는다', () => {
  const cartDir = 'src/app/(solvook)/cart'
  const paths = [
    ...walk(cartDir).map((path) => relative('.', path)),
    ...walk('src/app/api/market/cart').map((path) => relative('.', path)),
    'src/lib/market-cart-server.ts',
    'src/lib/market-checkout-server.ts',
    'src/lib/cart-line-title.ts',
  ]
  for (const path of paths) {
    const source = readFileSync(join(ROOT, path), 'utf8')
    assert.doesNotMatch(source, /market-item-options-server|getMarketItemDisplay/, path)
  }
  const readers = SRC_FILES.filter((path) => path !== 'src/lib/market-item-options-server.ts'
    && /getMarketItemDisplay\(\)/.test(readFileSync(join(ROOT, path), 'utf8')))
  assert.deepEqual(readers.sort(), ['src/app/(solvook)/items/[itemId]/page.tsx', 'src/app/(solvook)/library/page.tsx', 'src/app/(solvook)/search/page.tsx'])
  const page = read('src/app/(solvook)/items/[itemId]/page.tsx')
  assert.match(page, /const displayPromise = getMarketItemDisplay\(\)\.then\(\(display\) => display\.detail\)\.catch\(\(error\) => \{/)
  assert.match(page, /display=\{display\}/)
})

test('상세 읽기 실패(display = null): 설정에 기대는 글만 숨기고 담기·가격·전체구매 선택은 그대로, 이름 없는 체크박스 없음', () => {
  // 구매 칸: 샘플 줄 전체를 숨김, HWP+PDF 기본 안내는 설정이 있을 때만
  assert.match(itemActions, /\{display \? \(\n\s+<MarketSampleRow/)
  assert.match(itemActions, /if \(hasHwpAndPdf\(subproduct\) && display\) \{/)
  // 담기 영역은 display 와 무관(조건은 지금 그대로)
  const v2 = itemActions.slice(itemActions.indexOf('const renderV2PurchaseOptions'), itemActions.indexOf('const hasV2PurchaseOptions'))
  assert.match(v2, /\{hasSelectableOption \? \(\n\s+<section aria-label="선택한 옵션 합계"/)
  assert.doesNotMatch(v2, /display \?/)
  // 본문: 자료 정보 표·요약·샘플 버튼·등록일 줄·학년/자료유형 배지
  assert.match(materialDetail, /const materialInfoRows = display\n\s+\? buildMaterialInfoRows\(/)
  assert.match(materialDetail, /\{materialInfoRows\.length > 0 \? \(/)
  assert.match(materialDetail, /\{materialInfoRows\.length > 0 \|\| description \? \(\n\s+<section\n\s+aria-labelledby="market-material-information-heading"/)
  assert.match(materialDetail, /\{display \? \(\n\s+<dl className="mt-5 grid grid-cols-\[5\.5rem_minmax\(0,1fr\)\]/)
  assert.match(materialDetail, /\{display \? \(\n\s+<MarketMaterialSampleButton/)
  assert.match(materialDetail, /const showRegisteredAt = isInfoItemVisible\(display, 'registeredAt'\) && registeredAtLabel !== null/)
  assert.match(materialDetail, /item\.source_type && isInfoItemVisible\(display, 'materialType'\)/)
  assert.match(materialDetail, /item\.grade_level && isInfoItemVisible\(display, 'grade'\)/)
  // 체크박스 이름은 늘 비지 않음: 표시명 → 기본 제목 → 상품 제목
  assert.equal(options.resolveBundleTitle('', null) ?? '상품 제목', '상품 제목')
  assert.match(read('src/app/(solvook)/items/[itemId]/page.tsx'), /if \(!display && bundleOption && !bundleOption\.label\.trim\(\)\) \{\n\s+console\.error/)
})

// ── 관리자 ───────────────────────────────────────────────────────────────────────────────────────
test('새 서브상품 순서: sortOrder 없이 만들면 지우지 않은 서브상품 max + 10(없으면 10)', () => {
  const server = read('src/lib/market-items-server.ts')
  assert.match(server, /export function nextMarketItemSubproductSortOrder\(sortOrders: number\[\]\): number \{\n\s+return sortOrders\.length > 0 \? Math\.max\(\.\.\.sortOrders\) \+ 10 : 10\n\}/)
  const helper = server.slice(server.indexOf('async function getNextMarketItemSubproductSortOrder'), server.indexOf('export async function createMarketItemSubproduct'))
  assert.match(helper, /\.is\('deleted_at', null\)/)
  assert.match(helper, /\.order\('sort_order', \{ ascending: false \}\)\n\s+\.limit\(1\)/)
  const create = server.slice(server.indexOf('export async function createMarketItemSubproduct'), server.indexOf('export async function updateMarketItemSubproduct'))
  assert.match(create, /const sortOrder = input\.sortOrder \?\? await getNextMarketItemSubproductSortOrder\(item\.id, item\.workspace_subject\)/)
  assert.match(create, /sort_order: sortOrder,/)
  // 같은 규칙을 순수 꼴로 확인(순서 저장 10·20·30 뒤 추가 → 40)
  const next = new Function(`return ${server.match(/export function nextMarketItemSubproductSortOrder\(sortOrders: number\[\]\): number (\{[\s\S]*?\n\})/)[1].replace(/^/, '(sortOrders) => ')}`)()
  assert.equal(next([10, 20, 30]), 40)
  assert.equal(next([0, 3, 1]), 13)
  assert.equal(next([]), 10)
})

test('서브상품 순서 화면·route: [위로]·[아래로] → [순서 저장](상품 저장과 따로), 공개 중 안내, products.edit route → DB 함수', () => {
  const admin = readProductAdminSource()
  assert.match(admin, /순서 바뀜 — 저장 필요/)
  assert.match(admin, /회원 상세에 바로 반영됩니다\./)
  assert.match(admin, /aria-label="위로"/)
  assert.match(admin, /aria-label="아래로"/)
  assert.match(admin, /`\/api\/admin\/market\/items\/\$\{itemId\}\/subproducts\/order`/)
  assert.match(admin, /body: JSON\.stringify\(\{ ids: subproductOrderIds \}\)/)
  const route = read('src/app/api/admin/market/items/[id]/subproducts/order/route.ts')
  assert.match(route, /requireAdminApiPermission\('products\.edit'\)/)
  assert.match(route, /export async function PUT\(/)
  assert.match(route, /callReorderMarketItemSubproducts\(guard\.access\.userId, id, parsed\.data\.ids, adminRequestMeta\(request\)\)/)
  assert.match(read('src/lib/market-item-options-server.ts'), /callMarketCatalogRpc\('reorder_market_item_subproducts', \{/)
})

test('설정 다시 읽기: 편집 화면은 visibilitychange·focus 와 [목록 새로고침]으로 다시 읽고, 고르던 값을 첫 항목으로 바꿔 끼우지 않는다', () => {
  const admin = readProductAdminSource()
  assert.doesNotMatch(admin, /MANAGE_(SUBPRODUCT_CATEGORIES|FILE_TYPES)_VALUE/)
  assert.match(admin, /document\.addEventListener\('visibilitychange', reloadQuietly\)/)
  assert.match(admin, /const refreshUploadTaxonomy = async \(\) => \{/)
  const productForm = admin.slice(admin.indexOf('const reloadUploadTaxonomy = useCallback'), admin.indexOf('return { categories: nextCategories, fileTypes: nextFileTypes }'))
  assert.doesNotMatch(productForm, /nextActiveCategories\[0\]|nextActiveFileTypes\[0\]/)
  assert.match(productForm, /\{ \.\.\.current, categoryId: '', needsReselect: true \}/)
  assert.match(productForm, /\{ \.\.\.draft, fileTypeId: '', needsReselect: true \}/)
  assert.match(admin, /다시 골라 주세요/)
  assert.match(admin, /disabled=\{isUploading \|\| !draft\.fileTypeId\}/)
})

test('상품 표시 설정: [상세 안내 문구]·[자료 정보 항목]·[구성·파일 유형] 탭, 공통 안내, 탭마다 자기 키만 보냄(route 도 부분 저장)', () => {
  const settings = read('src/app/(admin)/admin/market/product-settings/product-settings-admin.tsx')
  for (const tab of ['상세 안내 문구', '자료 정보 항목', '구성·파일 유형']) assert.match(settings, new RegExp(`<TabsTrigger value="[a-z-]+">${tab}</TabsTrigger>`))
  assert.match(settings, /expectedRevision: display\.revision, \.\.\.patch/)
  // [검색 필터 이름]은 17번 키만
  assert.match(settings, /const result = await onSave\(\{\n\s+facetLabels:[\s\S]*?libraryEmptyFilterHint: draft\.libraryEmptyFilterHint\.trim\(\),\n\s+\}\)/)
  const tabs = read('src/app/(admin)/admin/market/product-settings/detail-display-tabs.tsx')
  assert.match(tabs, /const result = await onSave\(\{ detail: trimmed \}\)/)
  assert.equal(tabs.split("국어·영어 공통 설정입니다").length - 1, 1)
  assert.equal(tabs.split('{COMMON_NOTICE}').length - 1, 2)
  assert.match(tabs, /등록일 항목을 숨기면 상세 위쪽의 등록일 줄도 숨습니다/)
  assert.match(tabs, /<MarketSampleRow\n/)
  // 미리보기는 요청 없이(onOpen 없음) 그린다
  assert.doesNotMatch(tabs, /fetch\(|onOpen=/)
  const route = read('src/app/api/admin/market/item-display/route.ts')
  assert.match(route, /facetLabels: z\.object\([\s\S]*?\)\.optional\(\),/)
  assert.match(route, /detail: DetailSchema\.optional\(\),/)
  assert.match(route, /revalidateTag\(MARKET_ITEM_DISPLAY_CACHE_TAG, \{ expire: 0 \}\)/)
  const taxonomy = read('src/app/(admin)/admin/market/product-settings/taxonomy-tab.tsx')
  assert.match(taxonomy, /readOnly=\{Boolean\(editingCategoryId\)\}/)
  assert.match(taxonomy, /readOnly=\{Boolean\(editingFileTypeId\)\}/)
  assert.match(read('src/app/(admin)/admin/market/product-settings/page.tsx'), /initialTab=\{resolvedSearchParams\?\.tab \?\? ''\}/)
})

test('개발 미리보기: development·VERCEL 아님·PRODUCT_DISPLAY_PREVIEW=1 일 때만, 아니면 404', () => {
  const server = read('src/lib/market-item-options-server.ts')
  assert.match(server, /export function isProductDisplayPreviewEnabled\(\) \{\n\s+return process\.env\.NODE_ENV === 'development'\n\s+&& !process\.env\.VERCEL\n\s+&& process\.env\.PRODUCT_DISPLAY_PREVIEW === '1'/)
  const page = read('src/app/preview/solvook-concept/product-display/page.tsx')
  assert.match(page, /if \(!isProductDisplayPreviewEnabled\(\)\) notFound\(\)/)
  assert.doesNotMatch(page, /getMarketItemDisplay|createAdminClient|supabase/)
  const preview = generator.buildPreviewData()
  assert.ok(options.parseMarketItemDisplay(preview.display))
  assert.match(preview.detailPreview.item.id, /^00000000-0000-4000-8000-/)
})
