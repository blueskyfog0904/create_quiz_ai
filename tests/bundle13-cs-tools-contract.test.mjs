import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, createFakeAdmin, load, loadRoute, op } from './helpers/market-images-harness.mjs'

// 13번 묶음(docs/plan-bundle13-cs-tools.md) 12-1 계약 시험 — 회원 정보 열람 기록(8절)과 Q14 (가) M3 의 코드 조건.
// M3(profiles 조회를 대표만으로 좁힘)의 c_code_deployed 는 이 시험이 통과한 커밋이 운영에 배포됐다는 확인이다.

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const path = `${dir}/${name}`
  return statSync(join(ROOT, path)).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
})
const SCAN_ROOTS = ['src/app/(admin)', 'src/app/api/admin', 'src/lib']
const SCAN_FILES = SCAN_ROOTS.flatMap(walk)

// 주석을 같은 길이의 빈칸으로 바꾼다(위치는 그대로, 설명 글의 'profiles' 는 보지 않음).
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, (match, head) => head + ' '.repeat(match.length - head.length))
const normalize = (columns) => columns.replace(/\s+/g, ' ').trim()

// profiles 를 읽는 쿼리를 모두 찾는다(쿼리 단위). from('profiles') 와 끼워 읽기(profiles!fk( · alias:profiles…( · profiles:col ( ) 모두.
function findProfileQueries(file) {
  const source = stripComments(read(file))
  const found = []
  for (const match of source.matchAll(/\.from\(\s*['"]profiles['"]\s*\)/g)) {
    const after = source.slice(match.index, match.index + 400)
    const call = after.match(/\.(select|update|delete|insert|upsert)\(\s*(?:(['"`])([\s\S]*?)\2|([A-Z_]+))?/)
    let columns = call ? (call[3] ?? call[4] ?? '') : '?'
    if (call?.[4]) {
      const constant = source.match(new RegExp(`const ${call[4]} = (['"\`])([\\s\\S]*?)\\1`))
      columns = constant ? constant[2] : call[4]
    }
    found.push({ key: `${file} | from:${call?.[1] ?? '?'} | ${normalize(columns)}`, after })
  }
  for (const match of source.matchAll(/(?<![\w.'"])(?:(\w+)\s*:\s*)?profiles(?:!(\w+)|:(\w+))?\s*\(([^)]*)\)/g)) {
    const label = `${match[1] ?? ''}${match[2] ? `!${match[2]}` : ''}${match[3] ? `:${match[3]}` : ''}`
    found.push({ key: `${file} | join:${label} | ${normalize(match[4])}`, after: source.slice(match.index, match.index + 400) })
  }
  return found
}

const DISABLED = '꺼진 기능(admin_disabled_features 의 question_bank·ai_generation, 대표에게도 404). 다시 켤 때 화면 키와 기록을 더한다(8-1)'
// 쿼리 단위 판정표. client: 'session'(화면 세션) | 'service'(서버 키). use:
//   recorded  — 연락처가 그 응답에 실리며 via 의 파일이 recordMemberAccess/attachMemberContacts 로 그 화면 키를 기록한다
//   recorder  — 기록 함수 자신(attachMemberContacts 가 연락처를 읽는 곳)
//   admin     — 관리자 계정끼리(처리자·작성자 아이디, 관리자 계정 관리)
//   disabled  — 꺼진 기능
//   withdrawn — 탈퇴 회원 행만(익명화돼 연락처가 없음)
//   public_name — 공개 화면의 표시 이름(이메일 앞 4글자 + 태그)만 만들고 이메일은 내보내지 않음
//   not_shown — 서버 안에서 대조만 하고 응답에 싣지 않음
//   self      — 자기 행(.eq('id', user.id|userId))
//   no_contact — 이메일·전화를 고르지 않음(검색 조건에만 쓰거나 id·건수만)
const PROFILE_QUERIES = {
  'src/app/(admin)/admin/ai-question-generation-runs/[runId]/page.tsx | from:select | id,email,display_tag': { client: 'session', use: 'disabled', reason: DISABLED },
  'src/app/(admin)/admin/ai-question-generation-runs/page.tsx | from:select | id,email,display_tag': { client: 'session', use: 'disabled', reason: DISABLED },
  'src/app/api/admin/ai-question-generation-runs/[runId]/route.ts | from:select | id,email': { client: 'session', use: 'disabled', reason: DISABLED },
  'src/app/api/admin/ai-question-generation-runs/route.ts | from:select | id,email': { client: 'session', use: 'disabled', reason: DISABLED },
  'src/app/api/admin/questions/[id]/route.ts | join::user_id | id, email': { client: 'session', use: 'disabled', count: 2, reason: DISABLED },
  'src/app/(admin)/admin/refunds/page.tsx | join:user!refund_requests_user_id_fkey | id, email, display_tag': {
    client: 'service', proof: /await paymentAdmin\s*\.from\('refund_requests'\)/, use: 'recorded', via: [['src/app/(admin)/admin/refunds/page.tsx', 'refunds.list']], reason: '충전 환불 목록',
  },
  'src/app/(admin)/admin/refunds/page.tsx | join:processor!refund_requests_processed_by_fkey | id, email': { client: 'service', proof: /await paymentAdmin\s*\.from\('refund_requests'\)/, use: 'admin', reason: '처리한 관리자' },
  'src/app/(admin)/admin/refunds/page.tsx | join:user!payment_orders_user_id_fkey | email': {
    client: 'service', proof: /await paymentAdmin\s*\.from\('payment_orders'\)/, use: 'recorded', via: [['src/app/(admin)/admin/refunds/page.tsx', 'refunds.list']], reason: '수동 확인 주문',
  },
  'src/app/api/admin/refunds/route.ts | join:user!refund_requests_user_id_fkey | id, email': { client: 'service', use: 'recorded', via: [['src/app/api/admin/refunds/route.ts', 'refunds.list']], reason: '충전 환불 목록 API' },
  'src/app/api/admin/refunds/route.ts | join:processor!refund_requests_processed_by_fkey | id, email': { client: 'service', use: 'admin', reason: '처리한 관리자' },
  'src/app/api/admin/session/route.ts | from:select | is_admin': { client: 'session', use: 'self', reason: '본인 관리자 여부' },
  'src/app/api/admin/stats/route.ts | from:select | is_admin': { client: 'session', use: 'self', reason: '권한 조회 실패 때 본인 관리자 여부' },
  'src/app/api/admin/stats/route.ts | from:select | id': { client: 'service', proof: /createAdminClient\(\)\s*\.from\('profiles'\)/, use: 'no_contact', reason: '가입 수(건수만)' },
  'src/app/api/admin/users/[id]/withdrawal/route.ts | from:select | email': { client: 'service', use: 'not_shown', reason: '익명화 확인 입력과 대조만(응답에 싣지 않음, 대표 전용)' },
  'src/app/api/admin/users/search/route.ts | from:select | id, email, display_tag': { client: 'service', use: 'recorded', via: [['src/app/api/admin/users/search/route.ts', 'member_search']], reason: '지급 창 회원 찾기' },
  'src/lib/admin-accounts-server.ts | from:select | id, admin_role': { client: 'service', use: 'admin', reason: '관리자 계정 관리' },
  'src/lib/admin-accounts-server.ts | from:update | ': { client: 'service', use: 'admin', reason: '관리자 계정 관리(쓰기)' },
  'src/lib/admin-accounts-server.ts | from:select | id, is_admin, admin_role, email': { client: 'service', use: 'admin', reason: '관리자 계정 관리' },
  'src/lib/admin-accounts-server.ts | from:select | id': { client: 'service', use: 'no_contact', reason: '관리자 계정 확인' },
  'src/lib/admin-audit-log-server.ts | from:select | id, email': {
    client: 'service', use: 'recorded', count: 2, via: [['src/app/api/admin/audit-log/route.ts', 'audit_log']],
    reason: '처리자 필터(관리자 계정)와 처리자·대상 회원 이메일 — 대상 회원 이메일은 route 가 audit_log 로 기록',
  },
  'src/lib/admin-credit-transactions-server.ts | from:select | id': { client: 'service', use: 'no_contact', reason: '이메일 검색 조건(맞는 회원 id 만)' },
  'src/lib/admin-credit-transactions-server.ts | from:select | id, email, display_tag': { client: 'service', use: 'recorded', via: [['src/app/(admin)/admin/credits/page.tsx', 'credits.list']], reason: '크레딧 거래 목록' },
  'src/lib/admin-dashboard-server.ts | join:user!payment_orders_user_id_fkey | email': { client: 'service', use: 'recorded', via: [['src/app/api/admin/stats/route.ts', 'dashboard']], reason: '대시보드 최근 주문' },
  'src/lib/admin-dashboard-server.ts | join:user!support_tickets_user_id_profiles_fkey | email': { client: 'service', use: 'recorded', via: [['src/app/api/admin/stats/route.ts', 'dashboard']], reason: '대시보드 최근 문의' },
  'src/lib/admin-member-access-log-server.ts | from:select | id, email, phone, display_tag, withdrawn_at': { client: 'service', use: 'recorder', reason: 'attachMemberContacts 가 연락처를 읽고 같은 함수에서 기록' },
  'src/lib/admin-member-access-log-view-server.ts | from:select | id, email': { client: 'service', use: 'admin', reason: '처리자 필터(관리자 계정)' },
  'src/lib/admin-member-access-log-view-server.ts | from:select | id, email, display_tag, withdrawn_at': {
    client: 'service', use: 'recorded', via: [['src/app/api/admin/audit-log/access/route.ts', 'audit_log']], reason: '열람 기록 탭의 회원 표시 이름(이메일은 내보내지 않음)',
  },
  'src/lib/admin-member-detail-server.ts | from:select | id, email, display_tag, phone, created_at, provider, is_admin, withdrawn_at': {
    client: 'service', use: 'recorded', via: [['src/app/(admin)/admin/users/[id]/page.tsx', 'users.detail']], reason: '회원 상세',
  },
  'src/lib/admin-member-suspension-server.ts | from:select | id, email': { client: 'service', use: 'admin', reason: '메모·정지 작성자(관리자) 아이디' },
  'src/lib/admin-orders-server.ts | from:select | id': { client: 'service', use: 'no_contact', count: 2, reason: '이메일 검색 조건(맞는 회원 id 만)' },
  'src/lib/admin-orders-server.ts | from:select | id, email': { client: 'service', use: 'admin', reason: '조치한 관리자 아이디' },
  'src/lib/admin-orders-server.ts | join:user!payment_orders_user_id_fkey | email, display_tag': {
    client: 'service', use: 'recorded',
    via: [['src/app/api/admin/orders/payments/route.ts', 'orders.payments'], ['src/app/(admin)/admin/users/[id]/page.tsx', 'users.detail']], reason: '충전 결제 주문(목록·회원 상세)',
  },
  'src/lib/admin-orders-server.ts | join:user!market_purchase_orders_user_id_fkey | email, display_tag': {
    client: 'service', use: 'recorded',
    via: [['src/app/api/admin/orders/market/route.ts', 'orders.market'], ['src/app/(admin)/admin/users/[id]/page.tsx', 'users.detail']], reason: '마켓 구매 주문(목록·예외 환불 창·회원 상세)',
  },
  'src/lib/admin-permissions-server.ts | from:select | is_admin, admin_role': { client: 'session', use: 'self', reason: '본인 권한' },
  'src/lib/admin-support-server.ts | from:select | id': { client: 'service', use: 'no_contact', reason: '문의 목록 이메일 검색 조건(맞는 회원 id 만, 탈퇴 제외)' },
  'src/lib/admin-users-server.ts | from:select | id, email, display_tag, phone, organization, role, is_admin, provider, created_at, withdrawn_at': {
    client: 'service', use: 'recorded', via: [['src/app/(admin)/admin/users/page.tsx', 'users.list']], reason: '회원 목록(전화는 가린 값만)',
  },
  'src/lib/auth.ts | from:select | *': { client: 'session', use: 'self', reason: '본인 프로필' },
  'src/lib/auth.ts | from:select | is_admin': { client: 'session', use: 'self', count: 2, reason: '본인 관리자 여부' },
  'src/lib/credit-balance.ts | from:update | ': { client: 'session', use: 'self', reason: '본인(또는 넘겨받은 클라이언트) 잔액 캐시 갱신' },
  'src/lib/market-refunds.ts | from:select | withdrawn_at': { client: 'service', use: 'no_contact', reason: '탈퇴 여부' },
  'src/lib/market-reviews-server.ts | from:select | id, email, role, display_tag': { client: 'service', use: 'public_name', reason: '공개 후기 목록의 표시 이름' },
  'src/lib/market-reviews-server.ts | from:select | id, email, display_tag': { client: 'service', use: 'recorded', via: [['src/app/api/admin/reviews/route.ts', 'reviews.list']], reason: '관리자 후기 목록 작성자' },
  'src/lib/member-withdrawal-server.ts | from:delete | ': { client: 'service', use: 'no_contact', reason: '완전 삭제(쓰기)' },
  'src/lib/member-withdrawal-server.ts | from:select | id': { client: 'service', use: 'no_contact', reason: '탈퇴 회원 id' },
  'src/lib/site-board-server.ts | from:select | id, email': { client: 'service', use: 'admin', reason: '14번 공지·FAQ 마지막 수정자(관리자) 아이디' },
  'src/lib/member-broadcast-server.ts | from:select | id, email': { client: 'service', use: 'admin', reason: '16번 공지 알림 보낸 사람(관리자) 아이디' },
  'src/lib/signup-consent-server.ts | from:select | provider, signup_completed': { client: 'service', use: 'no_contact', reason: '가입 상태' },
  'src/lib/supabase/middleware.ts | from:select | provider, signup_completed': { client: 'session', use: 'self', reason: '본인 가입 상태' },
  'src/lib/withdrawn-member-redaction-server.ts | from:select | id': { client: 'service', use: 'no_contact', count: 2, reason: '탈퇴 회원 id' },
  'src/lib/withdrawn-member-redaction-server.ts | join:user!market_refund_requests_user_id_fkey | email, display_tag': { client: 'service', use: 'withdrawn', reason: '탈퇴 회원 자료 환불(익명화돼 연락처 없음)' },
}
const CONTACT_COLUMNS = /(^|[\s,*])(\*|email|phone)(?=$|[\s,])/
const SESSION_IMPORT = /from '@\/lib\/supabase\/(server|client)'/
const DISABLED_PATHS = /\/(ai-question-generation-runs|questions)\//

test('profiles 를 읽는 쿼리는 하나도 빠짐없이 판정표에 있다(쿼리 단위)', () => {
  const counts = {}
  for (const file of SCAN_FILES) {
    for (const query of findProfileQueries(file)) counts[query.key] = (counts[query.key] ?? 0) + 1
  }
  const expected = Object.fromEntries(Object.entries(PROFILE_QUERIES).map(([key, rule]) => [key, rule.count ?? 1]))
  assert.deepEqual(counts, expected)
})

test('이메일·전화를 고르는 쿼리는 열람 기록을 거치거나 관리자끼리·꺼진 기능 등 사유가 있다', () => {
  for (const [key, rule] of Object.entries(PROFILE_QUERIES)) {
    const columns = key.split(' | ')[2]
    assert.ok(rule.reason, key)
    if (CONTACT_COLUMNS.test(columns)) assert.notEqual(rule.use, 'no_contact', `${key}: 연락처를 고른다`)
    if (rule.use === 'disabled') assert.match(key, DISABLED_PATHS, key)
    if (rule.use !== 'recorded') continue
    assert.ok(rule.via?.length > 0, key)
    for (const [file, screen] of rule.via) {
      const source = read(file)
      assert.match(source, /\b(recordMemberAccess|attachMemberContacts)\(/, `${key}: ${file} 가 기록하지 않는다`)
      assert.ok(source.includes(`screen: '${screen}'`), `${key}: ${file} 에 화면 키 ${screen} 이 없다`)
    }
  }
})

test('세션 클라이언트로 profiles 를 읽는 모든 형태는 자기 행이거나 꺼진 기능이다(M3 c_code_deployed 의 조건)', () => {
  const byFile = new Map()
  for (const file of SCAN_FILES) byFile.set(file, findProfileQueries(file))
  for (const [key, rule] of Object.entries(PROFILE_QUERIES)) {
    const file = key.split(' | ')[0]
    if (rule.client === 'session') {
      assert.ok(['self', 'disabled'].includes(rule.use), `${key}: 세션으로 다른 회원 profiles 를 읽는다`)
      if (rule.use === 'self') {
        for (const query of byFile.get(file).filter((item) => item.key === key)) {
          assert.match(query.after, /\.eq\('id', (user\.id|userId)\)/, `${key}: 자기 행 조건이 없다`)
        }
      }
    } else if (SESSION_IMPORT.test(read(file))) {
      // 세션 클라이언트를 쓰는 파일에서 서버 키라고 적은 쿼리는 그 근거(서버 키 클라이언트로 부르는 줄)가 있어야 한다.
      assert.ok(rule.proof, `${key}: 세션 클라이언트 파일 — 서버 키 근거(proof)를 적는다`)
      assert.match(read(file), rule.proof, key)
    }
  }
})

test('관리자 클라이언트 컴포넌트는 브라우저 세션으로 profiles 를 읽지 않는다(지급 창은 서버 route)', () => {
  for (const file of walk('src/app/(admin)')) {
    const source = stripComments(read(file))
    if (!source.includes("from '@/lib/supabase/client'")) continue
    assert.doesNotMatch(source, /from\(\s*['"]profiles['"]\s*\)|profiles!|:\s*profiles\b/, file)
  }
  const dialog = read('src/app/(admin)/admin/credits/grant-credit-dialog.tsx')
  assert.doesNotMatch(dialog, /@\/lib\/supabase\/client/)
  assert.match(dialog, /fetch\(`\/api\/admin\/users\/search\?q=\$\{encodeURIComponent\(searchQuery\.trim\(\)\)\}`\)/)
})

test('화면 키·항목 목록과 쓰는 곳: 쓰는 키는 모두 목록에 있고, 꺼진 기능 밖의 키는 모두 어딘가에서 기록한다', () => {
  const { ADMIN_MEMBER_ACCESS_SCREENS, ADMIN_MEMBER_ACCESS_FIELDS } = load('src/lib/admin-member-access-log.ts')
  assert.deepEqual(Object.keys(ADMIN_MEMBER_ACCESS_SCREENS), [
    'users.list', 'users.detail', 'support.list', 'support.ticket', 'orders.payments', 'orders.market',
    'refunds.list', 'credits.list', 'member_search', 'reviews.list', 'dashboard', 'audit_log',
  ])
  const used = new Set()
  for (const file of walk('src')) {
    const source = read(file)
    if (!/\b(recordMemberAccess|attachMemberContacts)\(/.test(source)) continue
    for (const match of source.matchAll(/screen: '([a-z_.]+)'/g)) used.add(match[1])
    for (const match of source.matchAll(/fields: \[([^\]]*)\]/g)) {
      for (const field of match[1].matchAll(/'([a-z_]+)'/g)) assert.ok(field[1] in ADMIN_MEMBER_ACCESS_FIELDS, `${file}: 모르는 항목 ${field[1]}`)
    }
  }
  for (const screen of used) assert.ok(screen in ADMIN_MEMBER_ACCESS_SCREENS, `모르는 화면 키 ${screen}`)
  assert.deepEqual([...used].sort(), Object.keys(ADMIN_MEMBER_ACCESS_SCREENS).sort())
})

test('화면별 조건: 목록 전화 가림, 기록 실패 때 연락처 가림, stats 는 서버 키로 세기', () => {
  const usersPage = read('src/app/(admin)/admin/users/page.tsx')
  assert.match(usersPage, /phone: logged \|\| user\.is_admin \? maskPhone\(user\.phone\) : null/)
  assert.match(usersPage, /email: logged \|\| user\.is_admin \? user\.email : null/)
  assert.match(usersPage, /filter\(\(user\) => !user\.is_admin && !user\.withdrawn_at\)/)
  assert.match(usersPage, /users=\{users\}/)
  const detail = read('src/app/(admin)/admin/users/[id]/page.tsx')
  assert.match(detail, /const profile = logged \? detail\.profile : \{ \.\.\.detail\.profile, email: null, phone: null \}/)
  assert.match(detail, /if \(detail\.notes && !detail\.notes\.failed && detail\.notes\.data\.notes\.length > 0\) shownFields\.push\('memo'\)/)
  // [이 회원 열람 기록] 링크는 대표에게만
  assert.match(detail, /\{isOwner && \(\s*<Link href=\{`\/admin\/audit-log\?tab=access&member=\$\{profile\.id\}`\}/)
  for (const route of ['src/app/api/admin/orders/payments/route.ts', 'src/app/api/admin/orders/market/route.ts']) {
    assert.match(read(route), /const data = logged \? result : \{ \.\.\.result, orders: result\.orders\.map\(\(order\) => \(\{ \.\.\.order, user: order\.user \? \{ \.\.\.order\.user, email: null \} : null \}\)\) \}/, route)
  }
  const stats = read('src/app/api/admin/stats/route.ts')
  assert.match(stats, /const \{ count, error \} = await createAdminClient\(\)\s*\.from\('profiles'\)\s*\.select\('id', \{ count: 'exact', head: true \}\)/)
  // 자료 환불은 세션 행에서 profiles 끼워 읽기를 빼고 attachMemberContacts 로 붙인다(탈퇴 가림은 RLS 그대로)
  const refunds = read('src/app/(admin)/admin/refunds/page.tsx')
  assert.match(refunds, /await supabase\s*\.from\('market_refund_requests'\)\s*\.select\('\*, item:market_items!market_refund_requests_item_id_fkey\(title\)'\)/)
  assert.match(refunds, /attachMemberContacts\(\{[\s\S]*?screen: 'refunds\.list'[\s\S]*?shape: \(row, contact\) => \(\{ \.\.\.row, user: contact \? \{ email: contact\.email, display_tag: contact\.display_tag \} : null \}\)/)
})

// ── 실행 시험 ───────────────────────────────────────────────────────────────────────────────────────
const pure = load('src/lib/admin-member-access-log.ts')
const requestMeta = load('src/lib/admin-request-meta.ts')

test('maskPhone: 가운데를 가리고 끝 4자리만 남긴다', () => {
  assert.equal(pure.maskPhone('010-1234-5678'), '010-****-5678')
  assert.equal(pure.maskPhone('01012345678'), '010-****-5678')
  assert.equal(pure.maskPhone('02-123-4567'), '021-***-4567')
  assert.equal(pure.maskPhone('12345'), '*****')
  assert.equal(pure.maskPhone(''), null)
  assert.equal(pure.maskPhone(null), null)
  assert.ok(!pure.maskPhone('010-9876-5432').includes('9876'))
})

test('기록 인자: 빈 값·중복을 빼고 200명씩 나눈다, 빈 목록이면 0묶음', () => {
  assert.deepEqual(pure.buildMemberAccessBatches([]), [])
  assert.deepEqual(pure.buildMemberAccessBatches([null, undefined, '']), [])
  assert.deepEqual(pure.buildMemberAccessBatches(['a', 'b', 'a', null]), [['a', 'b']])
  const ids = Array.from({ length: 450 }, (_, index) => `m${index}`)
  const batches = pure.buildMemberAccessBatches([...ids, ...ids])
  assert.deepEqual(batches.map((batch) => batch.length), [200, 200, 50])
  assert.deepEqual(batches.flat(), ids)
})

test('adminRequestMeta: IP(첫 x-forwarded-for)·기기(300자)만', () => {
  const meta = requestMeta.adminRequestMeta(new Request('http://localhost', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'U'.repeat(400) } }))
  assert.deepEqual(Object.keys(meta).sort(), ['ip', 'user_agent'])
  assert.equal(meta.ip, '203.0.113.7')
  assert.equal(meta.user_agent.length, 300)
  assert.deepEqual(requestMeta.adminRequestMeta(new Headers()), { ip: null, user_agent: null })
})

const ACTOR = '00000000-0000-4000-8000-0000000000aa'
const M1 = '00000000-0000-4000-8000-000000000001'
const M2 = '00000000-0000-4000-8000-000000000002'
const GONE = '00000000-0000-4000-8000-000000000003'

function loadAccessServer({ rpcError = null, profiles = [] } = {}) {
  const events = []
  const { client, calls } = createFakeAdmin(({ table, ops }) => {
    if (table === 'profiles') return { data: profiles.filter((row) => op(ops, 'in')[2].includes(row.id)), error: null }
    if (table === 'admin_events') {
      events.push(op(ops, 'insert')[1])
      return { error: null }
    }
    return { data: null, error: null }
  }, { rpc: () => ({ data: 'log-id', error: rpcError }) })
  const errors = []
  const server = load('src/lib/admin-member-access-log-server.ts', {
    'server-only': {},
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.9', 'user-agent': 'UA' }) },
    '@/lib/supabase/bypass': { createAdminClient: () => client },
    '@/lib/admin-member-access-log': pure,
    '@/lib/admin-request-meta': requestMeta,
  }, errors)
  return { server, calls, events }
}

test('recordMemberAccess: 0명이면 부르지 않고, 200명 넘으면 나눠 남기며(part·parts), 요청 정보는 headers() 로 채운다', async () => {
  const empty = loadAccessServer()
  assert.equal(await empty.server.recordMemberAccess({ access: { userId: ACTOR }, screen: 'users.list', memberIds: [], fields: ['email'] }), true)
  assert.equal(empty.calls.filter((call) => call.type === 'rpc').length, 0)

  const many = loadAccessServer()
  const ids = Array.from({ length: 201 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  assert.equal(await many.server.recordMemberAccess({ access: { userId: ACTOR }, screen: 'refunds.list', memberIds: ids, fields: ['email'], context: { count: 201 } }), true)
  const rpcs = many.calls.filter((call) => call.type === 'rpc')
  assert.deepEqual(rpcs.map((call) => call.name), ['record_admin_member_access', 'record_admin_member_access'])
  assert.deepEqual(rpcs.map((call) => call.args.p_member_ids.length), [200, 1])
  assert.deepEqual(rpcs.map((call) => call.args.p_context), [{ count: 201, part: 1, parts: 2 }, { count: 201, part: 2, parts: 2 }])
  assert.deepEqual(rpcs[0].args.p_request_meta, { ip: '198.51.100.9', user_agent: 'UA' })
  assert.equal(rpcs[0].args.p_actor_id, ACTOR)
  assert.equal(rpcs[0].args.p_screen, 'refunds.list')
  assert.equal(rpcs[0].args.p_reason, null)
})

test('recordMemberAccess: 실패하면 false 와 대표 알림(같은 화면은 1시간에 1번 — dedupe_key)', async () => {
  const failing = loadAccessServer({ rpcError: { code: '42883', message: 'missing' } })
  assert.equal(await failing.server.recordMemberAccess({ access: { userId: ACTOR }, screen: 'users.detail', memberIds: [M1], fields: ['email', 'phone'] }), false)
  assert.equal(failing.events.length, 1)
  assert.equal(failing.events[0].kind, 'member_access_log_failed')
  assert.equal(failing.events[0].required_permission, 'owner')
  assert.match(failing.events[0].dedupe_key, /^member_access_log_failed:users\.detail:\d{4}-\d{2}-\d{2}T\d{2}$/)
})

test('attachMemberContacts: 탈퇴 회원은 붙이지 않고 member_ids 에서도 빼며, 적지 않은 칸은 null, 기록 실패면 모두 가린다', async () => {
  const profiles = [
    { id: M1, email: 'a@example.com', phone: '010-1111-2222', display_tag: 'AAAA', withdrawn_at: null },
    { id: M2, email: 'b@example.com', phone: null, display_tag: 'BBBB', withdrawn_at: null },
    { id: GONE, email: null, phone: null, display_tag: 'GONE', withdrawn_at: '2026-11-20T00:00:00Z' },
  ]
  const rows = [{ id: 'r1', user_id: M1 }, { id: 'r2', user_id: GONE }, { id: 'r3', user_id: M2 }, { id: 'r4', user_id: M1 }]
  const input = {
    access: { userId: ACTOR }, screen: 'support.list', rows, userIdOf: (row) => row.user_id, fields: ['email'],
    shape: (row, contact) => ({ id: row.id, profiles: contact ? { email: contact.email, phone: contact.phone } : null }),
  }
  const ok = loadAccessServer({ profiles })
  const result = await ok.server.attachMemberContacts(input)
  assert.equal(result.logged, true)
  assert.deepEqual(result.rows, [
    { id: 'r1', profiles: { email: 'a@example.com', phone: null } },
    { id: 'r2', profiles: null },
    { id: 'r3', profiles: { email: 'b@example.com', phone: null } },
    { id: 'r4', profiles: { email: 'a@example.com', phone: null } },
  ])
  const rpc = ok.calls.find((call) => call.type === 'rpc')
  assert.deepEqual(rpc.args.p_member_ids, [M1, M2])
  assert.deepEqual(rpc.args.p_fields, ['email'])

  const failing = loadAccessServer({ profiles, rpcError: { code: 'XX000', message: 'x' } })
  const masked = await failing.server.attachMemberContacts(input)
  assert.equal(masked.logged, false)
  assert.ok(masked.rows.every((row) => row.profiles === null))

  const nobody = loadAccessServer({ profiles })
  const none = await nobody.server.attachMemberContacts({ ...input, rows: [{ id: 'x', user_id: null }] })
  assert.deepEqual(none, { rows: [{ id: 'x', profiles: null }], logged: true })
  assert.equal(nobody.calls.length, 0)
})

function loadSearchRoute({ session = {}, logged = true, rows = [] } = {}) {
  const access = []
  const { client, calls } = createFakeAdmin(() => ({ data: rows, error: null }))
  const { route } = loadRoute('src/app/api/admin/users/search/route.ts', {
    ...session,
    admin: { client },
    mocks: {
      '@/lib/admin-member-access-log-server': { recordMemberAccess: async (input) => { access.push(input); return logged } },
      '@/lib/admin-request-meta': requestMeta,
    },
  })
  return { get: (q) => route.GET(new Request(`http://localhost/api/admin/users/search?q=${encodeURIComponent(q)}`)), access, calls }
}

test('GET /api/admin/users/search: credits.grant 가드, 서버 키·탈퇴·관리자 제외, 돌려주기 전에 member_search 기록', async () => {
  const user = { id: M1, email: 'a@example.com', display_tag: 'AAAA' }
  const ok = loadSearchRoute({ rows: [user] })
  const response = await ok.get('a@ex%')
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).users, [user])
  const ops = ok.calls[0].ops
  assert.deepEqual(op(ops, 'ilike'), ['ilike', 'email', '%a@ex\\%%'])
  assert.deepEqual(op(ops, 'is'), ['is', 'withdrawn_at', null])
  assert.deepEqual(op(ops, 'not'), ['not', 'is_admin', 'is', true])
  assert.deepEqual(ok.access.map(({ screen, memberIds, fields }) => ({ screen, memberIds, fields })), [{ screen: 'member_search', memberIds: [M1], fields: ['email'] }])

  const unlogged = loadSearchRoute({ rows: [user], logged: false })
  const refused = await unlogged.get('a')
  assert.equal(refused.status, 503)
  assert.equal((await refused.json()).users, undefined)

  const staff = loadSearchRoute({ session: { role: 'staff', grants: [{ permission: 'credits.view', limits: {} }] } })
  assert.equal((await staff.get('a')).status, 403)
  assert.equal(staff.calls.length, 0)

  const blank = loadSearchRoute()
  assert.deepEqual(await (await blank.get('  ')).json(), { success: true, users: [] })
  assert.equal(blank.calls.length, 0)
  assert.ok(NextResponse)
})

test('열람 기록 탭: 대표 전용 route·탭, 이 탭을 연 것도 audit_log 로 기록, 이메일은 펼치지 않음', () => {
  const route = read('src/app/api/admin/audit-log/access/route.ts')
  assert.match(route, /const guard = await requireAdminApiPermission\('owner'\)/)
  assert.match(route, /screen: 'audit_log',[\s\S]*?fields: \['access_log'\]/)
  const view = read('src/lib/admin-member-access-log-view-server.ts')
  assert.match(view, /\.contains\('member_ids', \[member\]\)/)
  assert.doesNotMatch(view, /email: profile\.email|email: row/)
  const page = read('src/app/(admin)/admin/audit-log/page.tsx')
  assert.match(page, /await requireAdminPagePermission\('owner'\)/)
  assert.match(page, /\{ id: 'access', label: '개인정보 열람' \}/)
  const client = read('src/app/(admin)/admin/audit-log/member-access-log-client.tsx')
  assert.match(client, /fetch\(`\/api\/admin\/audit-log\/access\?\$\{requestKey\}`\)/)
  assert.doesNotMatch(client, /\.email\b/)
  // 탈퇴 보관함 열람(withdrawn_record_view)도 같은 화면에서 이어 본다
  assert.match(client, /tab=actions&action=withdrawn_record_view/)
})

test('새 작업 기록 종류(13번)가 목록에 있다', () => {
  const { ADMIN_AUDIT_ACTIONS } = load('src/lib/admin-audit-log.ts')
  for (const action of [
    'support_ticket_reply', 'support_ticket_reply_edit', 'support_category_create', 'support_category_update', 'support_category_hide',
    'support_category_restore', 'support_reply_template_save', 'support_reply_template_hide', 'support_page_content_update',
  ]) assert.ok(action in ADMIN_AUDIT_ACTIONS, action)
})
