import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

// 14번 계획(docs/plan-bundle14-notice-faq.md) 10-1 의 계약 시험. DB 동작은 리허설(5-8, supabase/scripts/bundle14_rehearsal)이 본다.
// 등록 훅이 켜진 뒤에 불러야 '@/' 경로를 찾는다(정적 import 는 훅보다 먼저 풀린다).
const board = await import('../src/lib/site-board.ts')
const pii = await import('../src/lib/member-facing-text-pii.ts')
const gate = await import('../src/lib/consent-gate.ts')
const generator = await import('../supabase/scripts/bundle14_rehearsal/generate.mjs')

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const MIGRATION = read('supabase/migrations/20261217140000_bundle14_site_board.sql')
const DOWN = read('supabase/rollback/20261217140000_bundle14_site_board_down.sql')
const EXAMPLES = JSON.parse(read('tests/fixtures/bundle14-site-board-examples.json'))
const sqlNoComments = (sql) => sql.replace(/--[^\n]*/g, '')

function fnBody(name) {
  const match = MIGRATION.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn_${name}\\$([\\s\\S]*?)\\$fn_${name}\\$;`))
  assert.ok(match, `${name} 정의`)
  return match[1]
}
const sqlArrayIn = (source, name) => [...source.match(new RegExp(`${name} text\\[\\] := ARRAY\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

// ── 마이그레이션 ─────────────────────────────────────────────────────────────────────────────────
test('마이그레이션: 추가만(기존 표 DDL 없음), 사전 점검 지문, 잠금 시간, NOTIFY', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.match(sql, /SET LOCAL lock_timeout = '3s';/)
  assert.match(sql, /md5\(pg_get_functiondef\(to_regprocedure\('public\.record_admin_audit\(uuid,text,text,text,uuid,integer,text,jsonb,text\)'\)\)\)\s*<> 'a42b474d9d95753ffba5041acb0c1c77'/)
  assert.doesNotMatch(sql, /\bBEGIN;|\bCOMMIT;|\bROLLBACK;/)
  assert.doesNotMatch(sql, /DROP |ALTER POLICY|CREATE POLICY|LOCK TABLE/)
  for (const match of sql.matchAll(/ALTER TABLE ([a-z_.]+)/g)) assert.ok(['public.site_board_posts', 'public.site_board_post_revisions'].includes(match[1]), match[1])
  for (const match of sql.matchAll(/REFERENCES ([a-z_.]+)/g)) assert.equal(match[1], 'public.site_board_posts')
  for (const match of sql.matchAll(/CREATE TRIGGER \w+\s+[A-Z ]+? ON ([a-z_.]+)/g)) assert.equal(match[1], 'public.site_board_post_revisions')
  // system_settings 에는 행 INSERT 만(있으면 그대로)
  assert.match(sql, /INSERT INTO public\.system_settings \(key, value, description\)\nVALUES \('site_board_content'[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('표 권한: PUBLIC·anon·authenticated·service_role 회수 뒤 service_role SELECT 만, RLS 켬, 행위자 칸 FK 없음', () => {
  const sql = sqlNoComments(MIGRATION)
  for (const table of ['site_board_posts', 'site_board_post_revisions']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`))
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated, service_role;`))
  }
  assert.deepEqual([...sql.matchAll(/GRANT ([A-Z, ]+) ON TABLE ([a-z_.]+) TO (\w+);/g)].map((m) => m.slice(1).join(' ')),
    ['SELECT public.site_board_posts service_role', 'SELECT public.site_board_post_revisions service_role'])
  const posts = sql.match(/CREATE TABLE public\.site_board_posts \(([\s\S]*?)\n\);/)[1]
  assert.doesNotMatch(posts, /REFERENCES/)
  for (const column of ['created_by uuid NOT NULL,', 'updated_by uuid,', 'deleted_by uuid,', 'redacted_by uuid,']) assert.ok(posts.includes(column), column)
  const revisions = sql.match(/CREATE TABLE public\.site_board_post_revisions \(([\s\S]*?)\n\);/)[1]
  assert.deepEqual([...revisions.matchAll(/REFERENCES ([a-z_.(]+)/g)].map((m) => m[1]), ['public.site_board_posts(id'])
  assert.match(revisions, /saved_by uuid NOT NULL,/)
  assert.match(revisions, /redacted_by uuid,/)
  assert.match(revisions, /UNIQUE \(post_id, revision\)/)
})

test('함수 7개: SECURITY DEFINER·search_path, EXECUTE 는 service_role 만, VERIFY 가 같은 것을 본다', () => {
  const sql = sqlNoComments(MIGRATION)
  const signatures = {
    site_board_actor_allowed: 'uuid',
    member_facing_text_pii_hits: 'text',
    save_site_board_post: 'uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb',
    delete_site_board_post: 'uuid, uuid, integer, jsonb',
    reorder_site_board_posts: 'uuid, text, text, uuid[], jsonb',
    redact_site_board_post: 'uuid, uuid, text, jsonb',
    save_site_board_content: 'uuid, integer, jsonb, jsonb',
  }
  for (const [name, args] of Object.entries(signatures)) {
    const head = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$fn_${name}\\$`))[0]
    assert.match(head, /SECURITY DEFINER/, name)
    assert.match(head, /SET search_path TO 'public', 'pg_temp'/, name)
    const escaped = `${name}(${args})`.replace(/[()[\]]/g, '\\$&')
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon, authenticated, service_role;`), name)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role;`), name)
  }
  assert.equal([...sql.matchAll(/GRANT EXECUTE ON FUNCTION/g)].length, 7)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guard_site_board_post_revisions_mutation\(\) FROM PUBLIC, anon, authenticated, service_role;/)
  // VERIFY: 표 권한·RLS·정책 0·FK·가드 트리거·함수 권한·설정 행
  const verify = sql.match(/DO \$verify_bundle14_site_board\$([\s\S]*?)\$verify_bundle14_site_board\$;/)[1]
  for (const piece of ["has_table_privilege('service_role', v_rel, 'INSERT')", 'aclexplode(c.relacl)', 'pg_policy', "c.contype = 'f'",
    'guard_site_board_post_revisions_truncate', "has_function_privilege('anon', v_fn, 'EXECUTE')", "'search_path=public, pg_temp' = ANY (p.proconfig)",
    `jsonb_path_query(v_value, '$.** ? (@.type() == "string")')`, 'site_board_posts_published', 'site_board_post_revisions_sha256']) {
    assert.ok(verify.includes(piece), piece)
  }
})

test('행위자 판정: 12번 식(admin_role 빈 관리자 거절)·가림은 대표만', () => {
  const actor = fnBody('site_board_actor_allowed')
  assert.match(actor, /p_actor_id IS NOT NULL AND EXISTS/)
  assert.match(actor, /p\.is_admin IS TRUE AND p\.withdrawn_at IS NULL/)
  assert.match(actor, /p\.admin_role = 'owner'\s*OR \(p\.admin_role = 'staff'\s*AND EXISTS \(SELECT 1 FROM public\.admin_permission_grants g WHERE g\.user_id = p\.id AND g\.permission = 'content\.manage'\)\)/)
  assert.match(fnBody('redact_site_board_post'), /p\.is_admin IS TRUE AND p\.withdrawn_at IS NULL AND p\.admin_role = 'owner'/)
  for (const name of ['save_site_board_post', 'delete_site_board_post', 'reorder_site_board_posts', 'save_site_board_content']) {
    assert.match(fnBody(name), /IF NOT public\.site_board_actor_allowed\(p_actor_id\) THEN\s*RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';/, name)
  }
})

test('잠금 순서: 쓰기 함수 다섯은 권한 확인 직후 같은 advisory lock — 글 행 FOR UPDATE·설정 읽기·고정 수·분류 사용 중 검사보다 앞', () => {
  const LOCK = "PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));"
  for (const name of ['save_site_board_post', 'delete_site_board_post', 'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content']) {
    const body = sqlNoComments(fnBody(name))
    const lock = body.indexOf(LOCK)
    assert.ok(lock > 0, `${name}: 잠금`)
    assert.equal(body.split(LOCK).length, 2, `${name}: 잠금 한 번`)
    assert.ok(body.indexOf('SITE_BOARD_ACTOR_NOT_ALLOWED') < lock, `${name}: 권한 확인 뒤`)
    for (const later of ['FOR UPDATE', "s.key = 'site_board_content'", 'count(*)', 'max(p.sort_order)', 'SITE_BOARD_CATEGORY_IN_USE']) {
      const at = body.indexOf(later)
      if (at >= 0) assert.ok(at > lock, `${name}: ${later} 는 잠금 뒤`)
    }
  }
  // 고정 상한은 잠금 뒤 읽은 maxPinned 로 센다(save_site_board_post), 상한 낮추기는 지금 고정 수 이상(save_site_board_content)
  assert.match(fnBody('save_site_board_post'), /v_content #> '\{notice,maxPinned\}'[\s\S]*p\.board = 'notice' AND p\.is_pinned AND p\.deleted_at IS NULL\) >= v_max_pinned/)
  assert.match(fnBody('save_site_board_content'), /v_max_pinned < \(SELECT count\(\*\) FROM public\.site_board_posts p WHERE p\.board = 'notice' AND p\.is_pinned AND p\.deleted_at IS NULL\)/)
})

test('작업 기록: 종류 다섯이 함수 안 글자 꼴, details 에 request 가 있고 제목·본문 원문 키가 없다(리허설 키 목록과 같음)', () => {
  const kinds = { save_site_board_post: 'site_board_post_save', delete_site_board_post: 'site_board_post_delete', reorder_site_board_posts: 'site_board_post_reorder',
    redact_site_board_post: 'site_board_post_redact', save_site_board_content: 'site_board_content_update' }
  for (const [name, action] of Object.entries(kinds)) {
    const body = fnBody(name)
    assert.ok(body.includes(`'${action}',`), action)
    const details = body.match(/record_admin_audit\([\s\S]*?jsonb_build_object\(([\s\S]*?)\),\s*NULL\);/)[1]
    const keys = [...details.matchAll(/^\s*'([a-z_0-9]+)',/gm)].map((m) => m[1]).sort()
    assert.deepEqual(keys, [...generator.AUDIT_DETAIL_KEYS[action]].sort(), action)
    assert.ok(keys.includes('request'), action)
    for (const forbidden of ['title', 'body', 'link_url', 'link_label']) assert.ok(!keys.includes(forbidden), `${action}: ${forbidden}`)
    // 본문 지문도 넣지 않는다(가릴 수 없는 표 — 짧은 본문은 사전 대입으로 되찾을 수 있음)
    assert.doesNotMatch(details, /sha256/, action)
    // 값이 제목·본문·링크 원문 그대로인 칸이 없다(글자 수·바뀐 칸·판 이력 행 id 만)
    assert.doesNotMatch(details, /'[a-z_0-9]+', v_(?:new|old)\.(?:title|body|link_url|link_label)\b/, action)
  }
  const audit = read('src/lib/admin-audit-log.ts')
  for (const action of Object.values(kinds)) assert.match(audit, new RegExp(`\\n  ${action}: '`), action)
})

test('오류 코드: 함수가 던지는 코드 = site-board.ts 관리자 문구 표', () => {
  const thrown = new Set([...MIGRATION.matchAll(/RAISE EXCEPTION '(SITE_BOARD_[A-Z_]+)/g)].map((m) => m[1]))
  assert.deepEqual([...thrown].sort(), Object.keys(board.SITE_BOARD_ERROR_MESSAGES).sort())
  assert.deepEqual(board.extractSiteBoardError('ERROR: SITE_BOARD_INPUT_INVALID:notice.maxPinned (P0001)'), { code: 'SITE_BOARD_INPUT_INVALID', detail: 'notice.maxPinned' })
  assert.deepEqual(board.extractSiteBoardError('SITE_BOARD_PII_SUSPECTED:email,mobile'), { code: 'SITE_BOARD_PII_SUSPECTED', detail: 'email,mobile' })
  assert.equal(board.extractSiteBoardError('SITE_BOARD_UNKNOWN'), null)
  assert.match(board.siteBoardErrorMessage({ code: 'SITE_BOARD_PII_SUSPECTED', detail: 'email,rrn' }, pii.MEMBER_FACING_PII_LABELS), /이메일 주소, 주민등록번호/)
  // 가림 사유 코드 목록이 같다
  assert.match(fnBody('redact_site_board_post'), new RegExp(`p_reason_code NOT IN \\(${board.SITE_BOARD_REDACT_REASON_CODES.map((c) => `'${c}'`).join(', ')}\\)`))
})

test('필수 키: TS SITE_BOARD_REQUIRED_KEYS = 저장 함수 목록 = VERIFY 목록, 첫 값에 모든 키가 있고 parseSiteBoardContent 를 통과', () => {
  const save = fnBody('save_site_board_content')
  const verify = MIGRATION.match(/DO \$verify_bundle14_site_board\$([\s\S]*?)\$verify_bundle14_site_board\$;/)[1]
  for (const source of [save, verify]) {
    assert.deepEqual(sqlArrayIn(source, 'v_notice_keys'), [...board.SITE_BOARD_REQUIRED_KEYS.notice])
    assert.deepEqual(sqlArrayIn(source, 'v_faq_keys'), [...board.SITE_BOARD_REQUIRED_KEYS.faq])
    assert.deepEqual(sqlArrayIn(source, 'v_footer_keys'), [...board.SITE_BOARD_REQUIRED_KEYS.footer])
  }
  const seed = generator.seedContentFromMigration()
  const parsed = board.parseSiteBoardContent(seed)
  assert.ok(parsed)
  assert.equal(parsed.notice.maxPinned, 5)
  assert.deepEqual(parsed.faq.categories.map((c) => c.key), ['credit', 'refund', 'download', 'account'])
  assert.equal(board.parseSiteBoardContent({ ...seed, notice: { ...seed.notice, pageTitle: ' ' } }), null, '필수 키가 비면 null')
  assert.equal(board.parseSiteBoardContent({ ...seed, redactedText: 'a\nb' }), null)
  assert.equal(board.validateSiteBoardContentInput(seed, 5), null)
  assert.equal(board.validateSiteBoardContentInput(seed, 6), 'notice.maxPinned')
  assert.equal(board.validateSiteBoardContentInput({ ...seed, redactedText: 'x'.repeat(101) }, 0), 'redactedText')
})

// ── 예시 묶음(리허설과 같은 표) ─────────────────────────────────────────────────────────────────────
test('개인정보 판정 예시 묶음(TS) — 고객센터 연락처는 빼고 전화는 숫자로 비교', () => {
  const allowed = EXAMPLES.piiAllowedForTs
  const fill = (text) => text
    .replaceAll('{customerCenterDigits}', allowed.customerCenter.replace(/[^0-9]/g, ''))
    .replaceAll('{customerCenter}', allowed.customerCenter)
    .replaceAll('{orderEmailUpper}', allowed.orderEmail.toUpperCase())
    .replaceAll('{orderEmail}', allowed.orderEmail)
  for (const example of EXAMPLES.pii) {
    assert.deepEqual(pii.memberFacingTextPiiHits(fill(example.text), allowed), example.hits, example.text)
  }
  assert.ok(EXAMPLES.pii.some((e) => e.text.includes('{customerCenterDigits}')) && EXAMPLES.pii.some((e) => e.text.includes('{customerCenter}')))
  // DB 함수와 같은 모양 정규식(글자까지)
  const fn = fnBody('member_facing_text_pii_hits')
  const ts = read('src/lib/member-facing-text-pii.ts')
  for (const [name, re] of [['EMAIL', /'(\[A-Za-z0-9[^']+)'/], ['MOBILE', /'(\(\?<!\[0-9\]\)01[^']+)'/], ['PHONE', /'(\(\?<!\[0-9\]\)0\(\?:2[^']+)'/], ['RRN', /'(\(\?<!\[0-9\]\)\[0-9\]\{2\}[^']+)'/]]) {
    const sqlPattern = fn.match(re)[1]
    assert.ok(ts.includes(`${name}_PATTERN = /${sqlPattern}/`), `${name}: ${sqlPattern}`)
  }
  assert.match(fn, /fixedFields[\s\S]*customerCenter,value[\s\S]*orderEmail,value/)
})

test('링크 규칙 예시 묶음(TS) — isAllowedNoticeLink 와 같은 규칙', () => {
  for (const example of EXAMPLES.links) {
    const url = example.url + 'a'.repeat(example.pad ?? 0)
    assert.equal(board.isAllowedSiteBoardLink(url), example.ok, JSON.stringify(url))
  }
  assert.match(read('src/lib/site-board.ts'), /return isAllowedNoticeLink\(linkUrl\) && charLength\(linkUrl\) <= SITE_BOARD_LINK_MAX && !ENCODED_CONTROL_PATTERN\.test\(linkUrl\)/)
  assert.match(fnBody('save_site_board_post'), /OR v_link_url ~\* '%\(0\[0-9a-f\]\|1\[0-9a-f\]\|7f\)'\) THEN/)
})

test('행위자 판정 예시 묶음(TS) — admin_role 이 빈 관리자는 거절(DB 가 더 엄격)', () => {
  for (const example of EXAMPLES.actors) {
    const profile = { isAdmin: example.isAdmin, adminRole: example.adminRole, withdrawn: example.withdrawn }
    assert.equal(board.siteBoardActorAllowed(profile, example.grants), example.allowed, example.name)
  }
  assert.ok(EXAMPLES.actors.some((e) => e.dbBlocked && e.name.includes('DB 가 더 엄격')))
  assert.equal(board.siteBoardActorAllowed(null, []), false)
})

test('정렬 규칙 예시 묶음(TS) — 공지는 고정 sort_order → 비고정 게시일 최신순, FAQ 는 분류 순서 → 분류 안 sort_order', () => {
  assert.deepEqual(board.sortNoticePosts(EXAMPLES.noticeSort.posts).map((p) => p.id), EXAMPLES.noticeSort.expected)
  assert.deepEqual(board.sortFaqPosts(EXAMPLES.faqSort.posts, EXAMPLES.faqSort.categories).map((p) => p.id), EXAMPLES.faqSort.expected)
  // 회원 목록 쿼리도 같은 규칙(고정 sort_order,id → 비고정 published_at DESC,id)
  const server = read('src/lib/site-board-server.ts')
  assert.match(server, /\.eq\('is_pinned', true\)\s*\.order\('sort_order', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/)
  assert.match(server, /\.eq\('is_pinned', false\)\s*\.order\('published_at', \{ ascending: false \}\)\.order\('id', \{ ascending: true \}\)/)
})

test('입력 검사(TS)는 DB 와 같은 칸 순서', () => {
  const ok = { title: '제목', body: '본문', linkUrl: null, linkLabel: null, faqCategoryKey: null, isPinned: false, isPublished: true }
  assert.equal(board.validateSiteBoardPostInput('notice', ok, []), null)
  assert.equal(board.validateSiteBoardPostInput('notice', { ...ok, title: 'a\nb' }, []), 'title')
  assert.equal(board.validateSiteBoardPostInput('notice', { ...ok, title: 'x'.repeat(101) }, []), 'title')
  assert.equal(board.validateSiteBoardPostInput('notice', { ...ok, body: ' ' }, []), 'body')
  assert.equal(board.validateSiteBoardPostInput('notice', { ...ok, linkUrl: 'https://x' }, []), 'linkUrl')
  assert.equal(board.validateSiteBoardPostInput('notice', { ...ok, linkUrl: '/x' }, []), 'linkLabel')
  assert.equal(board.validateSiteBoardPostInput('notice', { ...ok, faqCategoryKey: 'credit' }, ['credit']), 'faqCategoryKey')
  assert.equal(board.validateSiteBoardPostInput('faq', { ...ok, faqCategoryKey: 'nope' }, ['credit']), 'faqCategoryKey')
  assert.equal(board.validateSiteBoardPostInput('faq', { ...ok, faqCategoryKey: 'credit', isPinned: true }, ['credit']), 'isPinned')
  assert.deepEqual(board.normalizeSiteBoardPostInput({ ...ok, linkLabel: '이름만' }).linkLabel, null)
})

// ── 서버 읽기·회원 화면 ───────────────────────────────────────────────────────────────────────────
test('읽기: 서버 키만(세션 클라이언트로 표를 읽지 않음), 60초 상한 + 태그, FAQ 는 쪽 나눔 없이', () => {
  const server = read('src/lib/site-board-server.ts')
  assert.match(server, /^import 'server-only'/)
  assert.doesNotMatch(server, /@\/lib\/supabase\/(server|client)/)
  assert.equal(board.SITE_BOARD_CACHE_SECONDS, 60)
  const caches = [...server.matchAll(/unstable_cache\(\s*async[\s\S]*?\{ revalidate: SITE_BOARD_CACHE_SECONDS, tags: \[(SITE_BOARD_[A-Z_]+)\] \}/g)].map((m) => m[1])
  assert.deepEqual(caches.sort(), ['SITE_BOARD_CONTENT_CACHE_TAG', 'SITE_BOARD_POSTS_CACHE_TAG', 'SITE_BOARD_POSTS_CACHE_TAG', 'SITE_BOARD_POSTS_CACHE_TAG', 'SITE_BOARD_POSTS_CACHE_TAG'])
  const faq = server.match(/const getCachedPublishedFaqs = unstable_cache\(([\s\S]*?)\n\)/)[1]
  assert.match(faq, /async \(\): Promise/)
  assert.doesNotMatch(faq, /\.range\(|page/)
  // 공지 쪽 나눔은 비고정 게시 글 수로만 센다
  assert.match(server, /\.eq\('board', 'notice'\)\.eq\('is_published', true\)\.is\('deleted_at', null\)\.eq\('is_pinned', false\)\n\s*if \(countError\)[^\n]*\n\s*const pagination = getListPagination\(count \?\? 0/)
  // 표 이름은 서버 lib 밖에서 쓰지 않는다(src 전체)
  for (const path of ['src/app/(solvook)/notices/page.tsx', 'src/app/(solvook)/notices/[id]/page.tsx', 'src/app/(solvook)/faq/page.tsx', 'src/app/(admin)/admin/notices/actions.ts']) {
    assert.doesNotMatch(read(path), /site_board_posts|site_board_post_revisions|createClient/, path)
  }
  // 저장 뒤 태그를 바로 만료
  const actions = read('src/app/(admin)/admin/notices/actions.ts')
  assert.match(actions, /revalidateTag\(SITE_BOARD_POSTS_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.match(actions, /revalidateTag\(SITE_BOARD_CONTENT_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.match(actions, /adminRequestMeta\(await headers\(\)\)/)
})

test('회원 화면 문구는 DB 에서만(코드에 한글 문구 없음), 상세 not-found 는 전용 화면', () => {
  for (const path of ['src/app/(solvook)/notices/page.tsx', 'src/app/(solvook)/notices/[id]/page.tsx', 'src/app/(solvook)/notices/[id]/not-found.tsx',
    'src/app/(solvook)/faq/page.tsx', 'src/app/(solvook)/faq/_components/faq-view.tsx', 'src/components/site-board/site-board-post-body.tsx',
    'src/app/(solvook)/notices/_components/notice-pagination.tsx']) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path)
    assert.doesNotMatch(stripComments(read(path)), /[가-힣]/, `${path}: 회원 문구는 DB 값`)
  }
  assert.match(read('src/app/(solvook)/notices/[id]/page.tsx'), /if \(!post\) notFound\(\)/)
  assert.match(read('src/app/(solvook)/notices/[id]/not-found.tsx'), /content\.notice\.notFoundTitle[\s\S]*content\.notice\.notFoundDescription/)
  // FAQ: <details id>, '전체' 탭으로 바꾼 뒤 펼침·스크롤·초점, hashchange 에도
  const view = read('src/app/(solvook)/faq/_components/faq-view.tsx')
  assert.match(view, /<details key=\{post\.id\} id=\{post\.id\}/)
  assert.match(view, /window\.addEventListener\('hashchange', openFromHash\)/)
  assert.match(view, /setActive\(ALL\)[\s\S]*element\.open = true[\s\S]*scrollIntoView[\s\S]*focus\(/)
  assert.match(read('src/app/(solvook)/faq/page.tsx'), /\.filter\(\(group\) => group\.posts\.length > 0\)/)
})

test('동의 관문·카카오 가입 미완료: /notices·/notices/x·/faq 는 연다, /noticesx 는 아니다', () => {
  for (const path of ['/notices', '/notices/abc', '/faq', '/faq/']) {
    assert.equal(gate.isConsentGateExcludedPath(path), true, path)
    assert.equal(gate.isSiteBoardMemberPath(path), true, path)
  }
  for (const path of ['/noticesx', '/faqs', '/notice']) {
    assert.equal(gate.isConsentGateExcludedPath(path), false, path)
    assert.equal(gate.isSiteBoardMemberPath(path), false, path)
  }
  assert.match(read('src/lib/supabase/middleware.ts'), /if \(isKakaoSignupPage \|\| isTermsPath\(pathname\) \|\| isSiteBoardMemberPath\(pathname\)\) \{/)
})

test('하단·고객지원 링크: 정책 nav 밖 별도 nav(이름은 DB), 게시 글이 있는 종류만, 읽기 실패면 링크만 뺀다', () => {
  const footer = read('src/app/(solvook)/_components/solvook-footer.tsx')
  const policyNav = footer.indexOf('aria-label="약관 및 정책"')
  const boardNav = footer.indexOf('aria-label={boardNav.navLabel}')
  assert.ok(policyNav > 0 && boardNav > policyNav)
  assert.ok(footer.slice(policyNav, boardNav).includes('</nav>'), '정책 nav 가 닫힌 뒤 별도 nav')
  assert.match(footer, /boardNav && boardNav\.links\.length > 0 \?/)
  const server = read('src/lib/site-board-server.ts')
  assert.match(server, /if \(available\.notice\) links\.push/)
  assert.match(server, /if \(available\.faq\) links\.push/)
  assert.match(server, /export async function getSiteBoardLinks\(\)[\s\S]*?catch \(error\) \{[\s\S]*?return null/)
  assert.match(read('src/lib/solvook-footer-data.ts'), /getSiteBoardLinks\(\)/)
  for (const layout of ['src/app/(solvook)/layout.tsx', 'src/app/terms/layout.tsx']) assert.match(read(layout), /boardNav=\{footer\.boardNav\}/, layout)
  // 고객지원: FAQ 게시 글이 있을 때만
  assert.match(read('src/app/(solvook)/mypage/support/page.tsx'), /const faqLink = boardLinks\?\.links\.find\(\(link\) => link\.key === 'faq'\) \?\? null/)
  assert.match(read('src/app/(solvook)/mypage/support/_components/support-view.tsx'), /\{faqLink \? \(/)
})

// ── 관리자 ───────────────────────────────────────────────────────────────────────────────────────
test('관리자: 사이드바 회원·고객 묶음에 두 화면(content.manage), 가림 액션은 대표, 팝업 연결 판정은 linkPathOf', () => {
  const sidebar = read('src/lib/admin-sidebar.ts')
  assert.match(sidebar, /ADMIN_MEMBER_MENU_HREFS = \['\/admin\/users', '\/admin\/support', '\/admin\/notices', '\/admin\/faq'\]/)
  assert.match(sidebar, /'\/admin\/notices': 'content\.manage',\n {2}'\/admin\/faq': 'content\.manage',/)
  assert.match(read('src/app/(admin)/admin/notices/actions.ts'), /export async function redactSiteBoardPostAction[^\n]*\n {2}await requireAdmin\(\)\n {2}const access = await assertAdminActionPermission\('owner'\)/)
  assert.match(read('src/lib/site-board.ts'), /const path = linkPathOf\(linkUrl\)/)
  assert.match(read('src/lib/site-board-server.ts'), /popup && shouldServeNoticePopup\(popup, nowMs\) \? noticeIdFromPopupLink\(popup\.linkUrl\) : null/)
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  assert.equal(board.noticeIdFromPopupLink(`/notices/${id.toUpperCase()}/?from=popup#top`), id)
  assert.equal(board.noticeIdFromPopupLink(`/notices/${id}`), id)
  assert.equal(board.noticeIdFromPopupLink('/notices/not-a-uuid'), null)
  assert.equal(board.noticeIdFromPopupLink('/terms/upcoming'), null)
  assert.equal(board.noticeIdFromPopupLink(null), null)
  // 확인 창 문구(관리자 안내)
  const admin = read('src/app/(admin)/admin/notices/board-admin.tsx')
  assert.match(admin, /회원 화면에서 사라집니다\. 기록에는 남습니다\./)
  assert.match(admin, /지금 공지 팝업 버튼이 이 글로 연결됩니다\. 숨기면 팝업 버튼이 끊깁니다\. 먼저 팝업 링크를 바꾸세요\./)
  assert.match(admin, /이 글의 모든 판에서 제목·본문이 가림 문구로 바뀌고 링크가 지워지며 되돌릴 수 없습니다\./)
  assert.match(admin, /공지 팝업 링크로 쓸 수 있습니다\. 약관 변경 고지 기간에는 팝업 링크를 바꾸지 마세요\./)
})

test('개발 미리보기: development·Vercel 아님·SITE_BOARD_PREVIEW=1 일 때만, 미리보기에서는 액션이 DB 를 부르지 않는다', () => {
  const server = read('src/lib/site-board-server.ts')
  assert.match(server, /process\.env\.NODE_ENV === 'development'\s*&& !process\.env\.VERCEL\s*&& process\.env\.SITE_BOARD_PREVIEW === '1'/)
  const actions = read('src/app/(admin)/admin/notices/actions.ts')
  for (const call of ['callSaveSiteBoardPost', 'callDeleteSiteBoardPost', 'callReorderSiteBoardPosts', 'callRedactSiteBoardPost', 'callSaveSiteBoardContent']) {
    const at = actions.indexOf(`await ${call}(`)
    const guard = actions.lastIndexOf('if (isSiteBoardPreviewEnabled())', at)
    assert.ok(at > 0 && guard > 0 && actions.lastIndexOf('export async function', at) < guard, call)
  }
  const preview = generator.buildPreviewData()
  assert.ok(preview.posts.filter((p) => p.board === 'notice' && p.isPublished && !p.isPinned).length >= 21)
  assert.ok(preview.posts.filter((p) => p.board === 'faq' && p.isPublished).length >= 25)
})

test('4번 후속 문구: 공지 게시판 전 임시 안내가 사라지고 15번 절차(변경 예정 약관 먼저)·본문 교체 확인 조건이 남는다', () => {
  const source = read('src/app/(admin)/admin/footer/signup-consent-admin.tsx')
  assert.doesNotMatch(source, /공지 게시판이 생기기 전까지는/)
  const dialog = source.match(/<DialogTitle>회원에게 다시 동의를 받습니다<\/DialogTitle>([\s\S]*?)<\/DialogDescription>/)[1]
  const steps = ['① 변경 예정 약관을 게시', '② 회원에게 불리한 변경은 30일 전부터 공지 팝업', '③ 필요하면 공지사항에도', '④ 시행일 당일']
  let last = -1
  for (const step of steps) {
    const at = dialog.indexOf(step)
    assert.ok(at > last, step)
    last = at
  }
  assert.match(dialog, /하단 정보 본문이 새 전문으로 바뀐 것을 확인한 뒤 누르세요/)
  assert.match(dialog, /15번 시행 스크립트\(런북\)로 시행하면 본문 교체와 다시 동의가 함께 되므로 이 버튼을 누르지 않습니다/)
  assert.match(source, /이용약관 개정: 변경 예정 약관 게시/)
})

// ── 되돌리기·리허설 ─────────────────────────────────────────────────────────────────────────────────
test('되돌리기: 멈춤 조건은 16번 함수 이름 목록·판 이력 표가 아닌 FK·글 있음(대표 확인) — 기록 표 존재로는 멈추지 않는다', () => {
  const down = sqlNoComments(DOWN)
  assert.match(down, /SET LOCAL lock_timeout = '3s';/)
  assert.match(down, /c_allow_drop_posts constant boolean := false;/)
  assert.match(down, /ARRAY\['send_member_broadcast', 'save_member_notification_texts', 'retract_member_broadcast', 'member_broadcast_preview'\]/)
  assert.match(down, /p\.proname = 'reject_point_charge_refund' AND p\.pronargs = 5/)
  assert.match(down, /c\.contype = 'f' AND c\.confrelid = 'public\.site_board_posts'::regclass\s*AND c\.conrelid <> 'public\.site_board_post_revisions'::regclass/)
  assert.doesNotMatch(down, /to_regclass\('public\.member_/, '16번 표 존재로 멈추지 않는다')
  // 순서: 함수 → 표 → 설정 행
  const fn = down.indexOf('DROP FUNCTION public.save_site_board_content')
  const table = down.indexOf('DROP TABLE public.site_board_post_revisions')
  const row = down.indexOf("DELETE FROM public.system_settings WHERE key = 'site_board_content'")
  assert.ok(fn > 0 && fn < table && table < row)
  assert.match(down, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('리허설 파일은 생성기 결과와 같고, light 는 기존 표 DDL·이력 표·COMMIT 이 없다', () => {
  const files = generator.buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle14_rehearsal/${name}`), content, `${name} 다시 만들기(node supabase/scripts/bundle14_rehearsal/generate.mjs)`)
    assert.match(content, /^-- 14번 묶음 리허설[\s\S]*\nBEGIN;\n/)
    assert.match(content, /\nROLLBACK;\n$/)
    assert.doesNotMatch(content, /\bCOMMIT\s*;/)
    assert.ok(content.includes(MIGRATION), `${name}: 마이그레이션 원본 그대로`)
  }
  const light = files['a_light.sql'].replace(/--[^\n]*/g, '')
  for (const word of generator.LIGHT_FORBIDDEN) assert.ok(!light.includes(word), word)
  assert.ok(files['b_full.sql'].includes("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261217140000', 'bundle14_site_board');"))
  // @test.com 시험 계정만
  assert.match(files['a_light.sql'], /u\.email LIKE '%@test\.com'/)
  // 리허설이 같은 예시 묶음을 쓴다
  for (const example of EXAMPLES.actors) assert.ok(files['a_light.sql'].includes(example.name), example.name)
})

// ── 독립 검증 1차 반영(2026-11-26) ─────────────────────────────────────────────────────────────────
test('가림: 판 이력 지문도 지운다(가드는 지문 NULL 만 받음, 지문은 가리지 않은 행에만)', () => {
  const sql = sqlNoComments(MIGRATION)
  assert.match(sql, /body_sha256 text CHECK \(body_sha256 IS NULL OR body_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\),/)
  assert.match(sql, /CONSTRAINT site_board_post_revisions_sha256 CHECK \(\(body_sha256 IS NULL\) = \(redacted_at IS NOT NULL\)\)/)
  const guard = sql.match(/AS \$fn_guard_site_board_post_revisions_mutation\$([\s\S]*?)\$fn_guard_site_board_post_revisions_mutation\$/)[1]
  assert.match(guard, /NEW\.link_url IS NULL AND NEW\.link_label IS NULL AND NEW\.body_sha256 IS NULL/)
  assert.doesNotMatch(guard, /NEW\.body_sha256, /)
  assert.match(fnBody('redact_site_board_post'), /SET title = v_text, body = v_text, link_url = NULL, link_label = NULL, body_sha256 = NULL,/)
  assert.match(fnBody('delete_site_board_post'), /CASE WHEN v_new\.redacted_at IS NULL THEN encode\(sha256\(convert_to\(v_new\.body, 'UTF8'\)\), 'hex'\) END/)
})

test('링크 개인정보: 원문과 퍼센트 인코딩을 푼 값 둘 다 검사(TS·DB 같은 푸는 규칙, 예시 묶음 linkPii)', () => {
  const allowed = EXAMPLES.piiAllowedForTs
  const order = ['email', 'mobile', 'phone', 'rrn']
  for (const example of EXAMPLES.linkPii) {
    const decoded = board.decodeSiteBoardLinkForPii(example.url)
    assert.equal(decoded, example.decoded, example.url)
    const hits = new Set([...pii.memberFacingTextPiiHits(example.url, allowed), ...pii.memberFacingTextPiiHits(decoded, allowed)])
    assert.deepEqual(order.filter((kind) => hits.has(kind)), example.hits, example.url)
  }
  const save = fnBody('save_site_board_post')
  assert.match(save, /regexp_matches\(v_link_url, '\(%\[0-9A-Fa-f\]\{2\}\)\|\(\[\^%\]\+\|%\)', 'g'\)/)
  assert.match(save, /EXCEPTION WHEN OTHERS THEN\s*v_link_decoded := v_link_url;/)
  assert.match(save, /public\.member_facing_text_pii_hits\(v_link_url\) \|\| public\.member_facing_text_pii_hits\(v_link_decoded\)/)
  assert.match(read('src/lib/site-board.ts'), /matchAll\(\/\(%\[0-9A-Fa-f\]\{2\}\)\|\(\[\^%\]\+\|%\)\/g\)/)
  assert.match(read('src/app/(admin)/admin/notices/board-admin.tsx'), /decodeSiteBoardLinkForPii\(editor\.input\.linkUrl \?\? ''\)/)
  // 리허설도 같은 예시를 저장 함수에 넣는다
  const light = generator.buildRehearsalFiles()['a_light.sql']
  for (const example of EXAMPLES.linkPii) assert.ok(light.includes(example.url.replaceAll("'", "''")), example.url)
})

test('같은 화면 /faq#id 링크: next/link 는 pushState 라 hashchange 가 없으므로 FAQ 화면이 문서 클릭을 캡처로 먼저 받아 펼친다', () => {
  for (const example of EXAMPLES.sameFaqHash) {
    assert.equal(board.sameFaqPageHashId(example.href, example.current), example.id, example.href)
  }
  const view = read('src/app/(solvook)/faq/_components/faq-view.tsx')
  assert.match(view, /document\.addEventListener\('click', onClick, true\)/)
  assert.match(view, /document\.removeEventListener\('click', onClick, true\)/)
  assert.match(view, /const id = sameFaqPageHashId\(anchor\.href, window\.location\.href\)\n\s*if \(!id \|\| !ids\.has\(id\)\) return\n\s*event\.preventDefault\(\)/)
  // 주소는 Next 가 감싼 pushState 로만 바꾼다(location.hash 대입은 Next 밖 기록이라 뒤로 가기 때 화면이 안 바뀜)
  assert.match(view, /if \(window\.location\.hash\.slice\(1\)\.toLowerCase\(\) !== id\) window\.history\.pushState\(null, '', `#\$\{id\}`\)\n\s*openFromHash\(\)/)
  assert.doesNotMatch(stripComments(view), /location\.hash =/)
  assert.doesNotMatch(view, /event\.defaultPrevented/)
  assert.match(read('node_modules/next/dist/client/components/app-router.js'), /copyNextJsInternalHistoryState/)
  // 이 방식이 기대는 next/link 동작: 미리 막힌 클릭(defaultPrevented)이면 자기 이동을 하지 않는다
  const nextLink = read('node_modules/next/dist/client/app-dir/link.js')
  assert.match(nextLink, /if \(e\.defaultPrevented\) \{\s*return;\s*\}\s*linkClicked\(/)
})

test('관리자: 판 충돌이면 편집·확인 창을 닫고, 저장·삭제·가림 성공 때 순서 편집 상태를 버리고, 팝업 읽기 실패는 따로 경고', () => {
  const admin = read('src/app/(admin)/admin/notices/board-admin.tsx')
  assert.match(admin, /if \(result\.conflict\) \{\s*setOrders\(null\)\s*setEditor\(null\)\s*setConfirm\(null\)\s*router\.refresh\(\)/)
  for (const success of ["'저장했습니다.'", "'삭제했습니다. 기록에는 남습니다.'", "'모든 판의 제목·본문을 가렸습니다.'"]) {
    const at = admin.indexOf(success)
    assert.ok(at > 0 && admin.slice(at, at + 300).includes('setOrders(null)'), success)
  }
  assert.match(admin, /data\.popupCheckFailed \?[\s\S]{0,200}공지 팝업 연결을 확인하지 못했습니다/)
  assert.match(admin, /16번 연결점\(7-3\)/)
  assert.match(read('src/lib/site-board-server.ts'), /popupCheckFailed: popupRow === null,/)
  assert.match(read('docs/plan-bundle16-notification-copy.md'), /\*\*넣는 것\*\*:[^\n]*14번 숨김·삭제·가림 확인 창에 '이 글로 보낸 공지 알림' 경고/)
  assert.match(board.SITE_BOARD_ERROR_MESSAGES.SITE_BOARD_REVISION_CONFLICT, /글을 다시 열어 확인한 뒤 저장하세요/)
})
