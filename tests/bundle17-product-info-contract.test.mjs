import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import '../src/components/features/passages/node-test-register.mjs'
import { readProductAdminSource } from './helpers/product-admin-sources.mjs'

// 17번 계획(docs/plan-bundle17-product-info.md) 10-1 의 계약 시험. DB 동작은 리허설(5-8, supabase/scripts/bundle17_rehearsal)이 본다.
// 등록 훅이 켜진 뒤에 불러야 '@/' 경로를 찾는다(정적 import 는 훅보다 먼저 풀린다).
const options = await import('../src/lib/market-item-options.ts')
const generator = await import('../supabase/scripts/bundle17_rehearsal/generate.mjs')
// 19번이 설정 행에 detail 을 더했다(필수 키) — 17번 첫 값 시험은 19번 첫 값과 합친 행으로 읽는다
const generator19 = await import('../supabase/scripts/bundle19_rehearsal/generate.mjs')

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20261219100000_bundle17_product_info.sql')
const DOWN = read('supabase/rollback/20261219100000_bundle17_product_info_down.sql')
const EXAMPLES = JSON.parse(read('tests/fixtures/bundle17-product-info-examples.json'))
const sqlNoComments = (sql) => sql.replace(/--[^\n]*/g, '')

function fnBody(name) {
  const match = MIGRATION.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn_${name}\\$([\\s\\S]*?)\\$fn_${name}\\$;`))
  assert.ok(match, `${name} 정의`)
  return match[1]
}

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
const isAdminFile = (path) => path.startsWith('src/app/api/admin/') || path.startsWith('src/app/(admin)/')

// ── 마이그레이션 ─────────────────────────────────────────────────────────────────────────────────
test('마이그레이션: 사전 점검 지문(기록 함수·가입 함수), 잠금 시간, BEGIN/COMMIT 없음, NOTIFY', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.match(sql, /SET LOCAL lock_timeout = '3s';/)
  assert.match(sql, /<> 'a42b474d9d95753ffba5041acb0c1c77'/)
  assert.match(sql, /md5\(pg_get_functiondef\('public\.handle_new_user\(\)'::regprocedure\)\) <> '61bc7b1469fb4dd6e795725040efe394'/)
  assert.doesNotMatch(sql, /\bBEGIN;|\bCOMMIT;|\bROLLBACK;/)
  assert.doesNotMatch(sql, /DROP |ALTER POLICY|CREATE POLICY|LOCK TABLE|ADD COLUMN/)
  // 코드가 기대는 식별값이 있는지 먼저 본다
  for (const value of ['question_pdf', 'question_hwp', "'pdf', 'hwp', 'zip'"]) assert.ok(sql.includes(value), value)
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('마이그레이션: 추가형 — 기존 표에는 트리거 2개와 근거 표의 상품 FK 만(한 구역), market_items 에 칸·FK 없음', () => {
  const sql = sqlNoComments(MIGRATION)
  const section = MIGRATION.match(/\n-- 6\. \[17번 기존 표 DDL\] 시작[\s\S]*?\n-- \[17번 기존 표 DDL\] 끝/)[0]
  const outside = sqlNoComments(MIGRATION.replace(section, ''))
  for (const match of sql.matchAll(/ALTER TABLE ([a-z_.]+)/g)) {
    assert.ok(['public.market_item_attribute_options', 'public.market_item_usage_bases'].includes(match[1]), match[1])
  }
  assert.doesNotMatch(outside, /REFERENCES public\.market_items|CREATE TRIGGER/)
  const triggers = [...section.matchAll(/CREATE TRIGGER (\w+)\s+BEFORE UPDATE OF ([a-z_, ]+) OR DELETE ON (public\.[a-z_]+)/g)].map((m) => [m[1], m[2], m[3]])
  assert.deepEqual(triggers, [
    ['guard_market_subproduct_category_identity', 'slug, workspace_subject', 'public.market_subproduct_categories'],
    ['guard_market_file_type_identity', 'code, workspace_subject', 'public.market_file_types'],
  ])
  assert.match(section, /FOREIGN KEY \(item_id\) REFERENCES public\.market_items\(id\) ON DELETE CASCADE/)
  assert.doesNotMatch(sql, /ALTER TABLE public\.market_items\b/)
  // system_settings 에는 행 INSERT 만(있으면 그대로)
  assert.match(sql, /INSERT INTO public\.system_settings \(key, value, description\)\nVALUES \('market_item_display'[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/)
})

test('마이그레이션: 표 권한 = service_role SELECT 만(PUBLIC·anon·authenticated·service_role 회수), RLS 켬·정책 없음, updated_by 는 FK 없음', () => {
  const sql = sqlNoComments(MIGRATION)
  for (const table of ['market_item_attribute_options', 'market_item_usage_bases']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;\\nREVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated, service_role;\\nGRANT SELECT ON TABLE public\\.${table} TO service_role;`))
    assert.equal([...sql.matchAll(new RegExp(`GRANT [A-Z, ]+ ON TABLE public\\.${table}`, 'g'))].length, 1, table)
  }
  assert.doesNotMatch(sql, /updated_by uuid REFERENCES|updated_by uuid NOT NULL REFERENCES/)
  assert.match(sql, /  updated_by uuid,\n/)
  // 함수: service_role 만 EXECUTE, 트리거 함수는 아무도
  for (const match of sql.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${match[1]}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`), match[1])
  }
  for (const name of ['guard_market_subproduct_category_identity', 'guard_market_file_type_identity']) {
    assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`), name)
  }
  assert.equal([...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g)].length, 5)
})

test('마이그레이션: 쓰기 함수는 권한 확인 직후 advisory lock, 그다음 행 잠금(잠금 순서)', () => {
  for (const name of ['save_market_item_option', 'reorder_market_item_options', 'save_market_item_usage_basis', 'save_market_item_display']) {
    const body = sqlNoComments(fnBody(name))
    const actor = body.indexOf('public.market_catalog_actor_allowed(p_actor_id)')
    const lock = body.indexOf('pg_advisory_xact_lock(')
    const rowLock = Math.min(...['FOR UPDATE', 'FOR SHARE'].map((word) => body.indexOf(word)).filter((index) => index >= 0))
    assert.ok(actor > 0 && actor < lock && lock < rowLock, name)
  }
  assert.match(fnBody('save_market_item_option'), /pg_advisory_xact_lock\(hashtext\('market_item_options:' \|\| p_subject \|\| ':' \|\| p_kind\)\)/)
  assert.match(fnBody('reorder_market_item_options'), /pg_advisory_xact_lock\(hashtext\('market_item_options:' \|\| p_subject \|\| ':' \|\| p_kind\)\)/)
  // 이름 바꾸기는 과목 + 옛 이름으로 상품 칸을 바꾼다(grade → grade_level, material_type → source_type)
  const save = fnBody('save_market_item_option')
  assert.match(save, /UPDATE public\.market_items SET grade_level = v_label WHERE workspace_subject = p_subject AND grade_level = v_old\.label;/)
  assert.match(save, /UPDATE public\.market_items SET source_type = v_label WHERE workspace_subject = p_subject AND source_type = v_old\.label;/)
  // 이용 근거: 상품 행 FOR SHARE 로 과목을 읽고, 근거 항목은 같은 과목·usage_basis
  const basis = fnBody('save_market_item_usage_basis')
  assert.match(basis, /FROM public\.market_items i WHERE i\.id = p_item_id FOR SHARE/)
  assert.match(basis, /v_option\.workspace_subject <> v_subject OR v_option\.kind <> 'usage_basis'/)
})

test('잠금 트리거: 표마다 따로(slug·code·과목), DELETE 는 늘 거절, ERRCODE P0001', () => {
  const cat = fnBody('guard_market_subproduct_category_identity')
  const ft = fnBody('guard_market_file_type_identity')
  assert.match(cat, /NEW\.slug IS DISTINCT FROM OLD\.slug OR NEW\.workspace_subject IS DISTINCT FROM OLD\.workspace_subject/)
  assert.doesNotMatch(cat, /\.code\b/)
  assert.match(ft, /NEW\.code IS DISTINCT FROM OLD\.code OR NEW\.workspace_subject IS DISTINCT FROM OLD\.workspace_subject/)
  assert.doesNotMatch(ft, /\.slug\b/)
  for (const body of [cat, ft]) {
    assert.match(body, /IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION 'MARKET_IDENTIFIER_LOCKED' USING ERRCODE = 'P0001';/)
  }
})

test('작업 기록 종류: DB 함수 안 글자 꼴·admin-audit-log 등록, 결제 연결 아님', () => {
  const audit = read('src/lib/admin-audit-log.ts')
  for (const action of ['market_item_option_save', 'market_item_option_reorder', 'market_item_usage_basis_save', 'market_item_display_update']) {
    assert.match(MIGRATION, new RegExp(`record_admin_audit\\(p_actor_id, '${action}',`), action)
    assert.match(audit, new RegExp(`  ${action}: '`), action)
    assert.deepEqual(generator.AUDIT_DETAIL_KEYS[action], [...generator.AUDIT_DETAIL_KEYS[action]].sort(), action)
  }
  // 결제 연결 기록(13번 14절 paymentLinkedActions 정책 값)에 넣지 않는다고 주석에 남김
  assert.match(audit, /17번 묶음[^\n]*결제 연결 아님\(paymentLinkedActions 에 넣지 않음\)/)
})

test('오류 코드 목록 = market-item-options.ts 매핑(마이그레이션 RAISE 코드와 같음)', () => {
  const raised = new Set([...sqlNoComments(MIGRATION).matchAll(/RAISE EXCEPTION '(MARKET_[A-Z_]+)/g)].map((m) => m[1]))
  assert.deepEqual([...raised].sort(), Object.keys(options.MARKET_ITEM_OPTION_ERROR_MESSAGES).sort())
  assert.deepEqual(options.extractMarketItemOptionError('ERROR: MARKET_OPTION_INPUT_INVALID:label (P0001)'), { code: 'MARKET_OPTION_INPUT_INVALID', detail: 'label' })
  assert.deepEqual(options.extractMarketItemOptionError('MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.type'), { code: 'MARKET_ITEM_DISPLAY_INPUT_INVALID', detail: 'facetLabels.type' })
  assert.equal(options.extractMarketItemOptionError('other error'), null)
})

test('표시 설정: 필수 키 = 코드 MARKET_ITEM_DISPLAY_REQUIRED_KEYS, 첫 값은 코드 규칙을 통과하고 {type} 을 채움', () => {
  const save = fnBody('save_market_item_display')
  const facetKeys = [...save.match(/v_facet_keys text\[\] := ARRAY\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  // 19번 detail.* 키는 19번 계약 시험이 19번 저장 함수와 대조한다
  assert.deepEqual([...facetKeys.map((key) => `facetLabels.${key}`), 'libraryEmptyFilterHint'],
    options.MARKET_ITEM_DISPLAY_REQUIRED_KEYS.filter((key) => !key.startsWith('detail.')))
  assert.deepEqual(facetKeys, [...options.MARKET_ITEM_FACET_KEYS])
  assert.match(save, /char_length\(v_text\) > 20 OR v_text ~ '\[\[:cntrl:\]\]' OR strpos\(v_text, '\{type\}'\) > 0/)
  assert.match(save, /char_length\(v_hint\) > 60/)
  // 17번 키만 다시 만들고 다른 키는 저장된 값 그대로(19번 키 자리) — 본문에 19번 키 이름이 없어야 down 의 19번 판정이 맞다
  assert.match(save, /v_new := v_old \|\| jsonb_build_object\('revision', v_revision \+ 1, 'facetLabels', v_facets, 'libraryEmptyFilterHint', v_hint\);/)
  assert.doesNotMatch(save, /detail/i)
  const seed = { ...generator.seedDisplayFromMigration(), detail: generator19.seedDetailFromMigration() }
  const display = options.parseMarketItemDisplay(seed)
  assert.ok(display)
  assert.equal(options.findMarketItemDisplayProblem(display), null, '첫 값 그대로 저장 → 성공(2판)')
  assert.equal(options.fillLibraryEmptyFilterHint(display), '검색어나 구성 필터를 바꿔 보세요.')
  assert.equal(options.findMarketItemDisplayProblem({ ...display, facetLabels: { ...display.facetLabels, type: '{type}' } }), 'facetLabels.type')
  assert.equal(options.findMarketItemDisplayProblem({ ...display, facetLabels: { ...display.facetLabels, year: '가'.repeat(21) } }), 'facetLabels.year')
  assert.equal(options.findMarketItemDisplayProblem({ ...display, libraryEmptyFilterHint: '가'.repeat(61) }), 'libraryEmptyFilterHint')
  assert.equal(options.parseMarketItemDisplay({ ...seed, facetLabels: { ...seed.facetLabels, grade: ' ' } }), null)
})

test('첫 값: 두 과목 같게, 11절 초안(학년 4·자료유형 4·이용 근거 5), 이름 규칙 통과', () => {
  const seed = generator.seedOptionsFromMigration()
  const labels = (kind) => seed.filter((option) => option.kind === kind).map((option) => option.label)
  assert.deepEqual(labels('grade'), ['1학년', '2학년', '3학년', '전체'])
  assert.deepEqual(labels('material_type'), ['수능특강', '교과서', '모의고사', '부교재'])
  assert.equal(labels('usage_basis').length, 5)
  for (const option of seed) assert.ok(options.isValidMarketItemOptionLabel(option.label), option.label)
  assert.match(MIGRATION, /FROM \(VALUES \('korean'\), \('english'\)\) AS s\(subject\)\n  CROSS JOIN jsonb_to_recordset/)
})

test('route 검사 예시 묶음(목록에 있음·없음·숨김인데 지금 값·다른 과목 이름) — 리허설 P2 와 같은 표', () => {
  const seed = generator.seedOptionsFromMigration()
  const files = generator.buildRehearsalFiles()
  for (const example of EXAMPLES.optionValueChecks) {
    const list = seed.filter((option) => option.kind === example.kind)
      .map((option) => ({ label: option.label, isActive: option.label !== example.hide }))
    // addOther 는 다른 과목에만 더하므로 이 과목 목록에는 없다
    const result = options.checkMarketItemOptionValue({ value: example.value, current: example.current, options: list })
    assert.equal(result.ok, example.ok, example.name)
    assert.ok(files['a_light.sql'].includes(`route 검사 예시: ${example.name}`), example.name)
  }
})

test('상품 저장 route: 학년·자료유형은 캐시 없이 DB 목록으로 검사, 출처 1~4 는 100자, 지금 값과 같으면 통과', () => {
  const server = read('src/lib/market-item-options-server.ts')
  const check = server.slice(server.indexOf('export async function findMarketItemProductOptionProblem'))
  assert.match(check, /readMarketItemOptionsUncached\(subject, check\.kind\)/)
  assert.doesNotMatch(check, /listMarketItemOptions\(|getCachedProductOptions/)
  const post = read('src/app/api/admin/market/items/route.ts')
  const patch = read('src/app/api/admin/market/items/[id]/route.ts')
  for (const route of [post, patch]) {
    for (const n of [1, 2, 3, 4]) assert.match(route, new RegExp(`source${n}: z\\.string\\(\\)\\.trim\\(\\)\\.max\\(MARKET_ITEM_SOURCE_MAX, SOURCE_TOO_LONG\\)\\.optional\\(\\),`))
    assert.match(route, /const optionProblem = await findMarketItemProductOptionProblem\(/)
  }
  assert.match(post, /\}, null\)\n/)
  assert.match(patch, /\{ gradeLevel: currentItem\.grade_level, sourceType: currentItem\.source_type \}\)/)
  assert.match(options.MARKET_ITEM_OPTION_REJECT_MESSAGES.grade, /목록이 바뀌었습니다\. 새로고침한 뒤 다시 저장해 주세요\./)
})

test('목록 저장 route: 이름 바꾸기로 상품이 바뀌면 공개 목록 캐시도 내리고, 모든 쓰기 route 가 요청 정보를 넘긴다', () => {
  const route = read('src/app/api/admin/market/item-options/route.ts')
  assert.match(route, /if \(renamedItemCount > 0\) revalidateTag\(MARKET_PUBLIC_LIST_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.match(route, /revalidateTag\(MARKET_ITEM_OPTIONS_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.match(read('src/app/api/admin/market/item-display/route.ts'), /revalidateTag\(MARKET_ITEM_DISPLAY_CACHE_TAG, \{ expire: 0 \}\)/)
  for (const path of ['src/app/api/admin/market/item-options/route.ts', 'src/app/api/admin/market/item-display/route.ts', 'src/app/api/admin/market/items/[id]/usage-basis/route.ts']) {
    const source = read(path)
    assert.match(source, /adminRequestMeta\(request\)/, path)
    assert.match(source, /isProductInfoPreviewEnabled\(\)/, path)
  }
})

// ── 내부 전용 고정(이용 근거) ───────────────────────────────────────────────────────────────────────
test('이용 근거 모듈은 관리자 route·화면만 가져다 쓰고, 표 이름은 그 모듈에만 있다', () => {
  const importers = SRC_FILES.filter((path) => /from '@\/lib\/market-item-usage-basis-server'/.test(read(path)))
  assert.ok(importers.length >= 2)
  for (const path of importers) assert.ok(isAdminFile(path), `${path} 가 이용 근거 모듈을 가져온다`)
  const tableUsers = SRC_FILES.filter((path) => read(path).includes('market_item_usage_bases'))
  assert.deepEqual(tableUsers.filter((path) => path !== 'src/types/supabase.ts'), ['src/lib/market-item-usage-basis-server.ts'])
  assert.doesNotMatch(read('src/lib/market-items-server.ts'), /usage_bas|usage-basis/)
  // 저장(PUT)도 읽기(GET)와 같게 상품 과목이 주소의 과목과 같아야 한다(다르면 404)
  const route = read('src/app/api/admin/market/items/[id]/usage-basis/route.ts')
  const put = route.slice(route.indexOf('export async function PUT'))
  assert.ok(put.indexOf('isMarketItemInSubject(id, resolveAdminWorkspaceSubject(') < put.indexOf('callSaveMarketItemUsageBasis('))
})

test('회원 화면·공개 API 파일에는 이용 근거 글자가 없다(관리자·규칙·기록 모듈만)', () => {
  const allowed = new Set([
    'src/lib/market-item-options.ts',
    'src/lib/market-item-options-server.ts',
    'src/lib/market-item-usage-basis-server.ts',
    'src/lib/admin-audit-log.ts',
  ])
  const holders = SRC_FILES.filter((path) => /usage_bas|usage-basis/i.test(read(path)))
  for (const path of holders) assert.ok(isAdminFile(path) || allowed.has(path), `${path} 에 이용 근거 글자가 있다`)
  // 회원 화면이 읽는 서버 모듈(필터 이름)은 이용 근거 표를 읽지 않는다
  const optionsServer = read('src/lib/market-item-options-server.ts')
  assert.doesNotMatch(optionsServer, /market_item_usage_bases/)
  assert.match(optionsServer, /if \(!\(MARKET_ITEM_PRODUCT_OPTION_KINDS as readonly string\[\]\)\.includes\(kind\)\) throw new Error\('product option kind only'\)/)
})

// ── 회원 화면 ──────────────────────────────────────────────────────────────────────────────────────
test('검색·자료 보관함: 필터 이름은 DB(facetLabels)에서만, 주소 key type 은 그대로, 보관함 빈 화면 안내도 DB', () => {
  const search = read('src/app/(solvook)/search/_components/search-view.tsx')
  const library = read('src/app/(solvook)/library/_components/library-view.tsx')
  for (const source of [search, library]) {
    assert.doesNotMatch(source, /자료유형/)
    assert.match(source, /\{facetLabels\[facet\.key\]\}/)
    // 필터 이름을 못 읽으면 막대를 숨긴다(이름 없는 버튼을 그리지 않음, 코드 기본 이름 없음)
    assert.match(source, /\{facetLabels \? \(/)
  }
  assert.deepEqual([...options.MARKET_ITEM_FACET_KEYS], ['category', 'type', 'year', 'grade'])
  assert.match(search, /const FACET_DEFS: \{ key: FacetKey \}\[\] = MARKET_ITEM_FACET_KEYS\.map/)
  assert.match(library, /key: 'type',\n    getValues/)
  assert.match(library, /description=\{emptyFilterHint \?\? ''\}/)
  const searchPage = read('src/app/(solvook)/search/page.tsx')
  const libraryPage = read('src/app/(solvook)/library/page.tsx')
  assert.match(searchPage, /const facetLabelsPromise = getMarketItemDisplay\(\)\.then\(\(display\) => display\.facetLabels\)\.catch\(/)
  assert.match(libraryPage, /const displayPromise = getMarketItemDisplay\(\)\.catch\(/)
  assert.match(searchPage, /type: toArray\(params\.type\)/)
  assert.match(libraryPage, /emptyFilterHint=\{display \? fillLibraryEmptyFilterHint\(display\) : null\}/)
})

// ── 가입 트리거 ────────────────────────────────────────────────────────────────────────────────────
test('handle_new_user 새 정의: avatar 없음·search_path 고정, 옛 정의 원문은 down 에(지문 대조)', () => {
  const definition = MIGRATION.slice(MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()'), MIGRATION.indexOf('$function$;') + 11)
  assert.doesNotMatch(definition, /avatar|picture|profile_image_url/)
  assert.match(definition, / SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS \$function\$/)
  assert.match(definition, /insert into public\.profiles \(\n    id,\n    email,\n    phone,\n    kakao_id,/)
  const old = generator.oldHandleNewUserDefinition()
  assert.match(old, /v_avatar_url text;/)
  assert.doesNotMatch(old, /search_path/)
  // 옛 정의에서 avatar 줄만 뺀 것이 새 본문이다(나머지 글자 그대로)
  const body = (text) => text.slice(text.indexOf('AS $function$'), text.lastIndexOf('$function$'))
  const removed = body(old).replace(/  v_avatar_url text;\n/, '')
    .replace(/  v_avatar_url := coalesce\([\s\S]*?\n  \);\n\n/, '')
    .replace(/    avatar_url,\n/, '').replace(/    v_avatar_url,\n/, '')
  assert.equal(body(definition), removed)
  assert.match(DOWN, /DOWN VERIFY: handle_new_user is not the old definition/)
})

// ── 되돌리기 ───────────────────────────────────────────────────────────────────────────────────────
test('down: 멈춤 조건(근거 행·18·19번 함수 이름·다른 FK), 순서, CSV 꺼내기 조회', () => {
  const down = sqlNoComments(DOWN)
  assert.match(down, /c_allow_drop_usage_bases constant boolean := false;/)
  assert.match(down, /IF EXISTS \(SELECT 1 FROM public\.market_item_usage_bases\) AND NOT c_allow_drop_usage_bases THEN/)
  assert.match(down, /v_later_functions text\[\] := ARRAY\['duplicate_market_item', 'reorder_market_item_subproducts'\];/)
  assert.match(down, /p\.proname = 'save_market_item_display'\n\s+AND p\.prosrc ~\* 'detail'/)
  assert.match(down, /c\.confrelid = 'public\.market_item_attribute_options'::regclass\n\s+AND c\.conrelid <> 'public\.market_item_usage_bases'::regclass/)
  assert.match(DOWN, /--        SELECT b\.item_id, i\.title, b\.workspace_subject, o\.label AS basis, b\.note, b\.evidence_ref/)
  const order = ['DROP TRIGGER guard_market_subproduct_category_identity', 'DROP FUNCTION public.guard_market_subproduct_category_identity',
    'DROP FUNCTION public.save_market_item_display', 'DROP TABLE public.market_item_usage_bases', 'DROP TABLE public.market_item_attribute_options',
    "DELETE FROM public.system_settings WHERE key = 'market_item_display'", 'CREATE OR REPLACE FUNCTION public.handle_new_user()']
  const positions = order.map((text) => down.indexOf(text))
  assert.ok(positions.every((position, index) => position > 0 && (index === 0 || positions[index - 1] < position)), JSON.stringify(positions))
  assert.match(down, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('리허설 파일은 생성기 결과와 같고, light 는 기존 표 DDL·이력 표·COMMIT 이 없다', () => {
  const files = generator.buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle17_rehearsal/${name}`), content, `${name} 다시 만들기(node supabase/scripts/bundle17_rehearsal/generate.mjs)`)
    assert.match(content, /^-- 17번 묶음 리허설[\s\S]*\nBEGIN;\n/)
    assert.match(content, /\nROLLBACK;\n$/)
    assert.doesNotMatch(content, /\bCOMMIT\s*;/)
    assert.match(content, /u\.email LIKE '%@test\.com'/)
  }
  const light = files['a_light.sql'].replace(/--[^\n]*/g, '')
  for (const word of generator.LIGHT_FORBIDDEN) assert.ok(!light.includes(word), word)
  assert.ok(files['a_light.sql'].includes(generator.migrationCopy('light')))
  assert.ok(files['b_full.sql'].includes(MIGRATION), 'full 은 마이그레이션 원본 그대로')
  assert.ok(files['b_full.sql'].includes("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261219100000', 'bundle17_product_info');"))
  // light 사본이 뺀 것은 기존 표 DDL 구역과 그 VERIFY 블록뿐
  const removed = MIGRATION.length - generator.migrationCopy('light').length
  const section = MIGRATION.match(/\n-- 6\. \[17번 기존 표 DDL\] 시작[\s\S]*?\n-- \[17번 기존 표 DDL\] 끝[^\n]*\n/)[0]
  const verify = MIGRATION.match(/\n-- 기존 표 DDL 확인[^\n]*\nDO \$verify_bundle17_existing_tables\$\n[\s\S]*?\n\$verify_bundle17_existing_tables\$;\n/)[0]
  assert.equal(removed, section.length + verify.length - 2)
  // 경우 P0~P9·B1 이 모두 있다(P10 기록은 각 경우 안)
  for (const label of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'B1']) assert.ok(files['a_light.sql'].includes(`'${label}'`), label)
  assert.ok(files['b_full.sql'].includes("'P7F'") && !files['a_light.sql'].includes("'P7F'"))
})

// ── 관리자 화면 ────────────────────────────────────────────────────────────────────────────────────
test('관리자: 상품 표시 설정 메뉴·가드, 상품 폼은 DB 목록 선택·출처 4칸·이용 근거 카드, LISTBOARD_GRADE_OPTIONS 는 생성 기능에만', () => {
  const sidebar = read('src/lib/admin-sidebar.ts')
  assert.match(sidebar, /'\/admin\/market\/product-settings': 'products\.edit',/)
  assert.match(sidebar, /\{ name: '상품 표시 설정', href: '\/admin\/market\/product-settings', icon: 'settings' \}/)
  assert.match(read('src/app/(admin)/admin/market/product-settings/page.tsx'), /await requireAdminPagePermission\('products\.edit'\)/)
  const settings = read('src/app/(admin)/admin/market/product-settings/product-settings-admin.tsx')
  assert.match(settings, /국어·영어 공통 설정입니다/)
  assert.match(settings, /회원에게 보이지 않는 내부 기록입니다/)
  assert.match(settings, /이 이름을 쓰는 상품 \{rename\?\.itemCount \?\? 0\}개도 함께 바뀝니다\./)
  assert.match(settings, /옛 이름으로 저장된 검색 링크\(\?grade=/)
  const client = readProductAdminSource()
  assert.doesNotMatch(client, /LISTBOARD_GRADE_OPTIONS/)
  assert.match(client, /\{ value: '', label: '선택 안 함' \}/)
  assert.match(client, /label: `\(숨김\) \$\{value\}`/)
  // 18번: 카드가 근거 유무를 알려 준다(공개 전 점검의 경고 칩)
  assert.match(client, /<MarketItemUsageBasisCard key=\{form\.id\} itemId=\{form\.id\} workspaceSubject=\{workspaceSubject\} onBasisChange=\{/)
  assert.match(read('src/app/(admin)/admin/market/products/market-item-usage-basis-card.tsx'), /회원에게 보이지 않음/)
  assert.match(read('src/lib/generate-menu.ts'), /export const LISTBOARD_GRADE_OPTIONS/)
  // slug·code DB 오류는 지금과 같은 문구로
  const server = read('src/lib/market-items-server.ts')
  assert.equal(server.match(/if \(error\.message\.includes\(MARKET_IDENTIFIER_LOCKED_ERROR\)\)/g).length, 2)
})
