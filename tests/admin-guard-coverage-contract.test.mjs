import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, adminGuardMocks, createFakeSessionClient, load } from './helpers/market-images-harness.mjs'
import { memberNotificationsServer } from './helpers/member-notifications-harness.mjs'

// 계획 U3-3: 관리자 화면·API·서버 액션이 모두 계정별 권한 가드를 부르는지 전수로 본다.
// 새 페이지·route·액션을 만들면 아래 표에 요구 권한을 적어야 하고, 적지 않거나 가드를 부르지 않으면 실패한다.
// 표의 값: 권한 키, 'owner'(대표 전용), 'admin'(관리자면 누구나), 배열(그중 하나라도).

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

function walk(dir, match, found = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, match, found)
    else if (match(entry, path)) found.push(path)
  }
  return found.sort()
}

const OWNER = 'owner'
const { ADMIN_PERMISSION_KEYS, meetsAdminRequirement, buildAdminAccess } = load('src/lib/admin-permissions.ts')
const { resolveAdminFeature } = load('src/lib/admin-features.ts')

function assertKnownRequirement(requirement, where) {
  for (const item of Array.isArray(requirement) ? requirement : [requirement]) {
    assert.ok(item === 'owner' || item === 'admin' || ADMIN_PERMISSION_KEYS.includes(item), `${where}: 모르는 권한 ${item}`)
  }
}

// 'x' 또는 ['x', 'y'] 형태의 가드 인자 글자를 값으로 읽는다.
function parseRequirement(text, where) {
  const trimmed = text.trim()
  const single = trimmed.match(/^'([^']+)'$/)
  if (single) return single[1]
  const list = trimmed.match(/^\[((?:\s*'[^']+'\s*,?)+)\]$/)
  assert.ok(list, `${where}: 가드 인자는 권한 글자 그대로 적는다(읽은 값: ${trimmed})`)
  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

// ---------------------------------------------------------------------------------------------------------------
// ① (admin) 아래 모든 page.tsx
// ---------------------------------------------------------------------------------------------------------------
const PAGE_ROOT = 'src/app/(admin)/admin'
const PAGE_REQUIREMENTS = {
  // 공통
  'page.tsx': 'admin',
  // 본인 비밀번호 변경(관리자면 누구나, 본인 계정만)
  'my-password/page.tsx': 'admin',
  // 대표 고정
  'admin-accounts/page.tsx': OWNER,
  'audit-log/page.tsx': OWNER,
  // 문의 · 주문 조회 · 회원 · 크레딧 · 환불
  'support/page.tsx': 'support.manage',
  // 14번: 공지사항·자주 묻는 질문(같은 부품·같은 서버 액션)
  'notices/page.tsx': 'content.manage',
  'faq/page.tsx': 'content.manage',
  // 16번: 회원 알림 문구·공지 알림 보내기(대표만 — Q1)
  'notifications/page.tsx': OWNER,
  'orders/page.tsx': 'orders.view',
  'users/page.tsx': 'members.view',
  'users/[id]/page.tsx': 'members.view',
  'credits/page.tsx': 'credits.view',
  'refunds/page.tsx': ['refunds.payment', 'refunds.market'],
  // 상품
  'market/products/page.tsx': 'products.edit',
  'market/products/new/page.tsx': 'products.edit',
  'market/images/page.tsx': 'products.edit',
  'market-categories/page.tsx': 'products.edit',
  // 홈 화면
  'main-ad-settings/page.tsx': 'storefront.edit',
  'market-main-settings/page.tsx': 'storefront.edit',
  // 후기
  'reviews/page.tsx': 'reviews.manage',
  'review-tags/page.tsx': 'reviews.manage',
  // 요금제 · 사이트
  'pricing/page.tsx': 'pricing.manage',
  'footer/page.tsx': 'site.manage',
  // 약관 본문 이력(읽기 전용, 6번 묶음)
  'footer/policy-history/page.tsx': 'site.manage',
  'storefront-menu/page.tsx': 'site.manage',
  // 닫을 예정(4-2절 2차)이라 그 전까지 대표 전용
  'menu-management/page.tsx': OWNER,
  // 꺼 둔 기능(4-2절): 미들웨어가 먼저 404로 막고, 다시 켜더라도 대표 전용
  'ai-connections/page.tsx': OWNER,
  'ai-question-generation-runs/page.tsx': OWNER,
  'ai-question-generation-runs/[runId]/page.tsx': OWNER,
  'generate/products/page.tsx': OWNER,
  'generate/products/[postId]/edit/page.tsx': OWNER,
  'labels/page.tsx': OWNER,
  'landing-pages/page.tsx': OWNER,
  'passages/page.tsx': OWNER,
  'passages/models/page.tsx': OWNER,
  'passages/prompts/page.tsx': OWNER,
  'problem-types/page.tsx': OWNER,
  'problem-types/new/page.tsx': OWNER,
  'problem-types/[id]/edit/page.tsx': OWNER,
  'problem-types/[id]/test/page.tsx': OWNER,
  'question-bank/backfill/page.tsx': OWNER,
  'question-bank/options/page.tsx': OWNER,
  'question-bank/problem-types/page.tsx': OWNER,
  'questions/page.tsx': OWNER,
  'questions/upload/page.tsx': OWNER,
  'questions/[id]/page.tsx': OWNER,
  'roles/page.tsx': OWNER,
  'source-configs/page.tsx': OWNER,
}
// 가드를 부르지 않는 페이지와 그 이유.
const PAGE_EXCEPTIONS = {
  'forbidden/page.tsx': '권한 없음 안내 화면. 가드를 부르면 권한 없는 계정이 끝없이 되돌아온다(레이아웃의 관리자 확인만 거친다).',
}

// (admin) 묶음 밖에 있는 관리자 화면(옛 주소). 꺼 둔 기능이라 대표 전용이다.
const OUTSIDE_PAGE_ROOT = 'src/app/dashboard/admin'
const OUTSIDE_PAGE_REQUIREMENTS = {
  'src/app/dashboard/admin/passages/page.tsx': OWNER,
  'src/app/dashboard/admin/passages/prompts/page.tsx': OWNER,
}
const ALL_PAGE_REQUIREMENTS = [
  ...Object.entries(PAGE_REQUIREMENTS).map(([path, requirement]) => [`${PAGE_ROOT}/${path}`, requirement]),
  ...Object.entries(OUTSIDE_PAGE_REQUIREMENTS),
]

const pages = walk(PAGE_ROOT, (entry) => entry === 'page.tsx').map((path) => path.slice(PAGE_ROOT.length + 1))

test('① 관리자 페이지는 하나도 빠짐없이 표에 있다', () => {
  assert.deepEqual(pages, [...Object.keys(PAGE_REQUIREMENTS), ...Object.keys(PAGE_EXCEPTIONS)].sort())
  assert.deepEqual(walk(OUTSIDE_PAGE_ROOT, (entry) => entry === 'page.tsx'), Object.keys(OUTSIDE_PAGE_REQUIREMENTS).sort())
  for (const [path, requirement] of ALL_PAGE_REQUIREMENTS) assertKnownRequirement(requirement, path)
})

test('① 모든 관리자 페이지는 다른 일을 하기 전에 표의 권한으로 페이지 가드를 부른다', () => {
  for (const [path, expected] of ALL_PAGE_REQUIREMENTS) {
    const source = read(path)
    assert.doesNotMatch(source, /^['"]use client['"]/m, `${path}: page.tsx는 서버 컴포넌트여야 가드를 부를 수 있다`)
    const component = source.match(/export default async function \w+\([\s\S]*?\)\s*\{\n([\s\S]*)$/)
    assert.ok(component, `${path}: export default async function`)
    // 가드보다 먼저 기다리는 것은 주소 값(params·searchParams)과 세션 클라이언트 준비뿐이다(가드보다 먼저 읽는 것이 없다).
    const awaits = component[1].split('\n').filter((line) => /\bawait\b/.test(line))
    const guardAt = awaits.findIndex((line) => /await require(AdminPagePermission|AdminPanelUser)\(/.test(line))
    assert.ok(guardAt >= 0, `${path}: 가드를 부르지 않는다`)
    for (const line of awaits.slice(0, guardAt)) {
      assert.match(line, /^\s*const [\w{} ,]+ = (await createClient\(\)|await params|searchParams \? await searchParams : undefined)$/, `${path}: 가드보다 먼저 하는 일이 있다 → ${line.trim()}`)
    }
    const guardLine = awaits[guardAt]
    if (expected === 'admin') {
      // 관리자면 누구나: 레이아웃과 같은 확인(requireAdminPanelUser)을 그대로 쓴다.
      assert.match(guardLine, /^\s*await requireAdminPanelUser\(\)$/, path)
      continue
    }
    const call = guardLine.match(/^\s*(?:const access = )?await requireAdminPagePermission\((.*)\)$/)
    assert.ok(call, `${path}: 가드 호출 형태 → ${guardLine.trim()}`)
    assert.deepEqual(parseRequirement(call[1], path), expected, path)
    assert.equal(source.match(/requireAdminPagePermission\(/g).length, 1, `${path}: 가드는 한 번만`)
    assert.doesNotMatch(source, /\.select\('is_admin'\)|requireAdmin\(/, `${path}: 옛 확인이 남아 있다`)
  }
  for (const path of Object.keys(PAGE_EXCEPTIONS)) {
    assert.doesNotMatch(read(`${PAGE_ROOT}/${path}`), /admin-permissions-server|createClient|createAdminClient/, path)
  }
})

test('① 환불 화면은 권한이 있는 구역만 조회하고 그린다', () => {
  const page = read(`${PAGE_ROOT}/refunds/page.tsx`)
  assert.match(page, /const canPayment = hasAdminPermission\(access, 'refunds\.payment'\)/)
  assert.match(page, /const canMarket = hasAdminPermission\(access, 'refunds\.market'\)/)
  // 조회 4건과 판매 상태는 모두 권한 조건 뒤에 있다.
  assert.equal(page.match(/= !canPayment \? notLoaded : await paymentAdmin\s*\.from\(/g).length, 3)
  assert.equal(page.match(/= !canMarket \? notLoaded : await supabase\s*\.from\('market_refund_requests'\)/g).length, 1)
  assert.equal(page.match(/await (paymentAdmin|supabase)\s*\.from\(/g).length, 4, '권한 조건 없는 조회가 없다')
  assert.match(page, /const salesStatus = canPayment \? await getPaymentSalesStatus\(\) : null/)
  assert.match(page, /\{canPayment && <PaymentSalesPanel status=\{salesStatus\} canStopSales=\{hasAdminPermission\(access, 'owner'\)\} \/>\}/)
  assert.match(page, /\{canPayment && \(\s*<RefundsClient/)
  assert.match(page, /\{canMarket && <MarketRefundsClient /)
})

// ---------------------------------------------------------------------------------------------------------------
// ② api/admin 아래 모든 route.ts (HTTP 메서드별)
// ---------------------------------------------------------------------------------------------------------------
const ROUTE_ROOT = 'src/app/api/admin'
const all = (requirement, ...methods) => Object.fromEntries(methods.map((method) => [method, requirement]))
const ROUTE_REQUIREMENTS = {
  // 공통: 관리자면 통과
  'stats/route.ts': all('admin', 'GET'),
  'alerts/summary/route.ts': all('admin', 'GET'),
  'my-password/route.ts': all('admin', 'POST'),
  // 대표 고정
  'admin-accounts/route.ts': all(OWNER, 'GET', 'POST'),
  'admin-accounts/[userId]/route.ts': all(OWNER, 'PATCH', 'DELETE'),
  'admin-accounts/[userId]/permissions/route.ts': all(OWNER, 'PUT'),
  'admin-accounts/[userId]/revoke/route.ts': all(OWNER, 'POST'),
  'audit-log/route.ts': all(OWNER, 'GET'),
  // 13번 8-3: 개인정보 열람 기록 조회(대표 전용)
  'audit-log/access/route.ts': all(OWNER, 'GET'),
  // 문의
  'support/stats/route.ts': all('support.manage', 'GET'),
  'support/categories/route.ts': all('support.manage', 'GET', 'POST'),
  'support/categories/[id]/route.ts': all('support.manage', 'PATCH', 'DELETE'),
  // 13번 7절: 숨긴 카테고리 다시 사용 / 5절: 이전 답변(열람 기록 support.ticket)
  'support/categories/[id]/restore/route.ts': all('support.manage', 'POST'),
  'support/tickets/[id]/route.ts': all('support.manage', 'PATCH'),
  'support/tickets/[id]/answer-revisions/route.ts': all('support.manage', 'GET'),
  'support/tickets/[id]/member-summary/route.ts': all('support.manage', 'GET'),
  // 주문 조회
  'orders/market/route.ts': all('orders.view', 'GET'),
  'orders/payments/route.ts': all('orders.view', 'GET'),
  // 크레딧
  'users/credits/route.ts': all('credits.grant', 'POST'),
  // 13번 8-2: 지급 창 회원 찾기(서버 키, 열람 기록 member_search)
  'users/search/route.ts': all('credits.grant', 'GET'),
  'users/credits/limits/route.ts': all('credits.limits.manage', 'PUT'),
  'users/credits/revoke/route.ts': all('credits.revoke', 'POST'),
  // 10번: 회원 탈퇴(요청 기록·익명화·가림·보류 주문 닫기·보관함 열람)는 대표만
  'users/[id]/withdrawal/route.ts': all(OWNER, 'POST'),
  // 12번: 이용 제한·해제·알림 기록(로그인 차단과 그 해제·알림 기록은 DB 함수가 대표만 받는다), 메모 추가·지우기, 메모 가림(대표)
  'users/[id]/suspension/route.ts': all('members.suspend', 'POST'),
  'users/[id]/notes/route.ts': all('members.memo', 'POST'),
  'users/[id]/notes/redact/route.ts': all(OWNER, 'POST'),
  // 환불
  'market/refunds/route.ts': all('refunds.market', 'GET'),
  'market/refunds/[id]/route.ts': all('refunds.market', 'GET', 'PATCH'),
  'market/orders/[id]/exception-refund/route.ts': all('refunds.market', 'GET', 'POST'),
  'refunds/route.ts': all('refunds.payment', 'GET', 'PATCH'),
  // 9번: 수동 완료 화면의 원천별 원자료(get_manual_refund_recovery_preview)
  'refunds/recovery-preview/route.ts': all('refunds.payment', 'GET'),
  'payments/alerts/route.ts': all('refunds.payment', 'PATCH'),
  'payments/review/route.ts': all('refunds.payment', 'PATCH'),
  // 충전 판매 전체 중지는 대표만(재개는 SQL로만 된다).
  'payments/sales-stop/route.ts': all(OWNER, 'POST'),
  // 상품
  'market/items/route.ts': all('products.edit', 'GET', 'POST'),
  'market/items/[id]/route.ts': { GET: 'products.edit', PATCH: 'products.edit', DELETE: 'products.delete' },
  'market/items/thumbnail/route.ts': all('products.edit', 'POST'),
  'market/items/[id]/bundle-option/route.ts': all('products.edit', 'GET', 'PATCH', 'DELETE'),
  'market/items/[id]/files/route.ts': all('products.edit', 'POST'),
  'market/items/[id]/sample-pages/route.ts': all('products.edit', 'GET', 'PATCH'),
  'market/items/[id]/sample-pages/[pageId]/route.ts': all('products.edit', 'DELETE'),
  'market/items/[id]/sample-pages/source/route.ts': all('products.edit', 'POST'),
  'market/items/[id]/sample-pages/source/finalize/route.ts': all('products.edit', 'POST'),
  'market/items/[id]/samples/commit/route.ts': all('products.edit', 'POST'),
  'market/items/[id]/subproducts/route.ts': all('products.edit', 'GET', 'POST'),
  'market/items/[id]/subproducts/[subproductId]/route.ts': all('products.edit', 'PATCH', 'DELETE'),
  'market/items/[id]/subproducts/[subproductId]/files/route.ts': all('products.edit', 'GET', 'POST'),
  'market/items/[id]/subproducts/[subproductId]/files/[fileId]/route.ts': all('products.edit', 'DELETE'),
  'market/file-types/route.ts': all('products.edit', 'GET', 'POST'),
  'market/file-types/[id]/route.ts': all('products.edit', 'PATCH', 'DELETE'),
  'market/subproduct-categories/route.ts': all('products.edit', 'GET', 'POST'),
  'market/subproduct-categories/[id]/route.ts': all('products.edit', 'PATCH', 'DELETE'),
  'market/images/route.ts': all('products.edit', 'GET', 'POST'),
  'market/images/[id]/route.ts': all('products.edit', 'GET', 'PATCH', 'DELETE'),
  'market/images/check/route.ts': all('products.edit', 'POST'),
  'market/images/move/route.ts': all('products.edit', 'POST'),
  'market/image-folders/route.ts': all('products.edit', 'GET', 'POST'),
  'market/image-folders/[id]/route.ts': all('products.edit', 'PATCH', 'DELETE'),
  'market/storage-cleanup/route.ts': all('products.edit', 'POST'),
  'market-categories/route.ts': all('products.edit', 'GET', 'POST'),
  'market-categories/[nodeId]/route.ts': all('products.edit', 'PATCH', 'DELETE'),
  // 홈 화면
  'main-ad-settings/route.ts': all('storefront.edit', 'POST'),
  'market-main-settings/route.ts': all('storefront.edit', 'POST'),
  // 후기
  'reviews/route.ts': all('reviews.manage', 'GET'),
  'reviews/[reviewId]/route.ts': all('reviews.manage', 'DELETE'),
  'review-tags/route.ts': all('reviews.manage', 'GET', 'POST'),
  'review-tags/[tagId]/route.ts': all('reviews.manage', 'PATCH'),
  // 사이트
  'site-logo/route.ts': all('site.manage', 'POST', 'DELETE'),
  // 꺼 둔 기능(4-2절): 미들웨어가 먼저 404로 막고, 다시 켜더라도 대표 전용
  'ai-connections/route.ts': all(OWNER, 'GET'),
  'ai-connections/[provider]/route.ts': all(OWNER, 'PATCH'),
  'ai-connections/[provider]/test/route.ts': all(OWNER, 'POST'),
  'ai-models/route.ts': all(OWNER, 'GET', 'POST', 'PUT', 'DELETE'),
  'ai-question-generation-runs/route.ts': all(OWNER, 'GET'),
  'ai-question-generation-runs/[runId]/route.ts': all(OWNER, 'GET'),
  'ai-question-generation-runs/[runId]/download/route.ts': all(OWNER, 'GET'),
  'problem-type-default-prompts/route.ts': all(OWNER, 'GET', 'PATCH'),
  'problem-types/route.ts': all(OWNER, 'GET', 'POST', 'PATCH'),
  'problem-types/[id]/route.ts': all(OWNER, 'GET', 'PATCH', 'DELETE'),
  'problem-types/[id]/test/route.ts': all(OWNER, 'POST'),
  'problem-types/[id]/test-runs/route.ts': all(OWNER, 'GET'),
  'problem-types/[id]/test-runs/[runId]/route.ts': all(OWNER, 'GET'),
  'problem-types/[id]/test-runs/[runId]/download/route.ts': all(OWNER, 'GET'),
  'providers/route.ts': all(OWNER, 'GET', 'POST', 'PUT', 'DELETE'),
  'question-bank/backfill/route.ts': all(OWNER, 'GET', 'POST'),
  'question-bank/books/route.ts': all(OWNER, 'GET', 'POST'),
  'question-bank/books/[id]/route.ts': all(OWNER, 'PATCH', 'DELETE'),
  'question-bank/problem-types/route.ts': all(OWNER, 'GET', 'POST'),
  'question-bank/problem-types/[id]/route.ts': all(OWNER, 'PATCH', 'DELETE'),
  'question-bank/years/route.ts': all(OWNER, 'GET', 'POST'),
  'question-bank/years/[id]/route.ts': all(OWNER, 'PATCH', 'DELETE'),
  'questions/route.ts': all(OWNER, 'GET'),
  'questions/[id]/route.ts': all(OWNER, 'GET', 'DELETE', 'PATCH'),
  'questions/bulk-upload/route.ts': all(OWNER, 'POST'),
  'questions/filled-template/route.ts': all(OWNER, 'POST'),
  'questions/hwpx-analyze/route.ts': all(OWNER, 'POST'),
  'questions/template/route.ts': all(OWNER, 'GET'),
  'questions/upload/route.ts': all(OWNER, 'POST'),
  'source-configs/route.ts': all(OWNER, 'GET', 'POST'),
  'source-configs/[id]/route.ts': all(OWNER, 'PATCH', 'DELETE'),
}
// 가드를 부르지 않는 route와 그 이유.
const ROUTE_EXCEPTIONS = {
  'session/route.ts': '관리자 로그인 화면이 "이 세션이 관리자인가"를 묻는 곳. 관리자가 아닌 세션도 불러야 하고, 본인의 isAdmin 값만 돌려준다.',
}

// api/admin 밖에 있는 관리자 전용 route.
const OUTSIDE_ROUTE_REQUIREMENTS = {
  // 꺼 둔 기능(AI 문제 생성)의 관리자용 검수 API
  'src/app/api/questions/review/route.ts': all(OWNER, 'POST'),
}
const ALL_ROUTE_REQUIREMENTS = [
  ...Object.entries(ROUTE_REQUIREMENTS).map(([path, methods]) => [`${ROUTE_ROOT}/${path}`, methods]),
  ...Object.entries(OUTSIDE_ROUTE_REQUIREMENTS),
]
// 가드가 권한을 읽지 못했을 때(500)만 is_admin을 직접 확인해 계속 진행하는 route와 그 이유.
const ROUTE_LOOKUP_FALLBACKS = {
  'src/app/api/admin/stats/route.ts': '권한 조회가 실패해도 가입 수·처리 대기는 보여 준다(권한이 필요한 구역만 뺀다).',
}
// api/admin 밖에서 profiles.is_admin을 읽는 route와 그 이유. 관리자 기능을 여는 용도가 아니어야 한다.
const OUTSIDE_IS_ADMIN_READERS = {
  'src/app/api/auth/withdraw/route.ts': '관리자 계정은 탈퇴할 수 없게 막는 확인(권한을 여는 것이 아니라 막는 것).',
}

const routes = walk(ROUTE_ROOT, (entry) => entry === 'route.ts').map((path) => path.slice(ROUTE_ROOT.length + 1))

// 공용 가드를 부르는 얇은 함수는 가드 결과를 받아, 거부이면 그 상태·문구로 만든 값을 바로 돌려준다.
const THIN_GUARD_RETURNS_REFUSAL = /const guard = await requireAdminApiPermission\([^)]*\)\n\s*if \('error' in guard\) (?:\{\n\s*(?:const code = [^\n]*\n\s*)?)?return [^\n]*guard\.(?:error|status)/

// 파일 안의 지역 가드 함수(공용 가드를 부르는 얇은 함수)가 요구하는 권한. 인자 기본값이 있으면 그 값이다.
function localGuards(source, where) {
  const guards = {}
  for (const match of source.matchAll(/^async function (\w+)\(([^)]*)\) \{\n([\s\S]*?)^\}\n/gm)) {
    const [, name, params, body] = match
    const call = body.match(/await requireAdminApiPermission\(([^)]*)\)/)
    if (!call) continue
    assert.match(body, THIN_GUARD_RETURNS_REFUSAL, `${where}: ${name}이 가드의 거부 결과를 돌려주지 않는다`)
    if (call[1].trim() === 'permission') {
      const fallback = params.match(/^permission: AdminPermissionRequirement = ('[^']+')$/)
      assert.ok(fallback, `${where}: ${name}의 permission 인자는 기본값이 있어야 한다`)
      guards[name] = { fallback: parseRequirement(fallback[1], where), takesArgument: true }
    } else {
      guards[name] = { fallback: parseRequirement(call[1], where), takesArgument: false }
    }
  }
  return guards
}

// 이미지 route가 함께 쓰는 공용 함수가 요구하는 권한.
const marketImageGuard = (() => {
  const body = read('src/lib/market-images-server.ts').match(/export async function requireMarketImageAdmin\(\)[\s\S]+?\n}\n/)[0]
  assert.match(body, THIN_GUARD_RETURNS_REFUSAL, 'requireMarketImageAdmin이 가드의 거부 결과를 돌려주지 않는다')
  return parseRequirement(body.match(/await requireAdminApiPermission\(([^)]*)\)/)[1], 'requireMarketImageAdmin')
})()

// 핸들러 본문에서 처음 부르는 가드, 그 위치, 결과를 받은 변수 이름들.
function handlerGuard(body, guards, where) {
  const candidates = []
  const add = (pattern, requirementOf) => {
    const call = body.match(new RegExp(`(?:const (\\w+|\\{[^}]*\\}) = )?await ${pattern}`))
    if (!call) return
    assert.ok(call[1], `${where}: 가드 결과를 변수로 받지 않는다`)
    // { user, denied } 또는 { supabase, error: authError } → 지역 이름들
    const names = call[1].startsWith('{')
      ? call[1].slice(1, -1).split(',').map((part) => part.split(':').pop().trim()).filter(Boolean)
      : [call[1]]
    candidates.push({ index: call.index, requirement: requirementOf(call[2] ?? ''), names, destructured: call[1].startsWith('{') })
  }
  add('requireAdminApiPermission\\(([^)]*)\\)', (argument) => parseRequirement(argument, where))
  add('requireMarketImageAdmin\\(()\\)', () => marketImageGuard)
  for (const [name, guard] of Object.entries(guards)) {
    add(`${name}\\(([^)]*)\\)`, (text) => {
      const argument = text.trim()
      assert.ok(argument === '' || guard.takesArgument, `${where}: ${name}은 인자를 받지 않는다`)
      return argument === '' ? guard.fallback : parseRequirement(argument, where)
    })
  }
  return candidates.sort((a, b) => a.index - b.index)[0] ?? null
}

// 그 가드 결과 변수로 거부를 판정해 바로 돌려주는 형태. 다른 값의 검사(예: parsed.error)는 인정하지 않는다.
function guardRefusal(guard, allowLookupFallback) {
  const name = guard.names.join('|')
  if (guard.destructured) return new RegExp(`if \\((${name})\\)\\s*\\{?\\s*return \\1\\b`)
  const lookupFallback = allowLookupFallback ? `|'error' in ${name} && ${name}\\.status !== 500` : ''
  return new RegExp(
    `if \\((?:'error' in ${name}|${name}\\.error|${name} instanceof NextResponse${lookupFallback})\\)\\s*\\{?\\s*return (?:NextResponse\\.json\\(|${name}\\b)`
    + `|if \\(${name}\\)\\s*\\{?\\s*return ${name}\\b`
  )
}

// 가드보다 먼저 나오면 안 되는 것: DB·저장소 접근과 요청 본문 읽기.
const GUARDED_WORK = /\.from\(|\.rpc\(|\.storage\b|createAdminClient\(|createPaymentAdminClient\(|request\.(json|formData|text)\(/

test('② 관리자 API route는 하나도 빠짐없이 표에 있다', () => {
  assert.deepEqual(routes, [...Object.keys(ROUTE_REQUIREMENTS), ...Object.keys(ROUTE_EXCEPTIONS)].sort())
  for (const [path, methods] of ALL_ROUTE_REQUIREMENTS) {
    for (const requirement of Object.values(methods)) assertKnownRequirement(requirement, path)
  }
  // api/admin 밖에서 is_admin으로 접근을 가르는 route가 새로 생기면 여기서 걸린다(가드를 쓰고 위 표에 적는다).
  const outsideReaders = walk('src/app/api', (entry, path) => entry === 'route.ts' && !path.startsWith(`${ROUTE_ROOT}/`) && /is_admin/.test(read(path)))
  assert.deepEqual(outsideReaders, Object.keys(OUTSIDE_IS_ADMIN_READERS).sort())
})

test('② 모든 관리자 API route는 메서드마다 표의 권한으로 가드를 부르고, 그 전에 데이터를 건드리지 않는다', () => {
  for (const [path, expected] of ALL_ROUTE_REQUIREMENTS) {
    const source = read(path)
    const lookupFallback = path in ROUTE_LOOKUP_FALLBACKS
    if (!lookupFallback) assert.doesNotMatch(source, /\.select\('is_admin'\)|profile\?\.is_admin/, `${path}: is_admin만 보는 옛 확인이 남아 있다`)
    assert.doesNotMatch(source, /export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/, `${path}: 핸들러는 export async function으로 쓴다`)

    const guards = localGuards(source, path)
    const handlers = [...source.matchAll(/^export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(/gm)]
    const actual = {}
    handlers.forEach((handler, index) => {
      const method = handler[1]
      const where = `${path} ${method}`
      const body = source.slice(handler.index, handlers[index + 1]?.index ?? source.length)
      const guard = handlerGuard(body, guards, where)
      assert.ok(guard, `${where}: 가드를 부르지 않는다`)
      const work = body.match(GUARDED_WORK)
      assert.ok(!work || guard.index < work.index, `${where}: 가드보다 먼저 ${work?.[0]} 를 쓴다`)
      // 가드 결과를 확인해 거부 응답을 돌려준 뒤에야 일을 한다.
      const afterGuard = body.slice(guard.index)
      const refusal = afterGuard.match(guardRefusal(guard, lookupFallback))
      assert.ok(refusal, `${where}: 가드 결과(${guard.names.join(', ')})로 거부 응답을 돌려주지 않는다`)
      const workAfterGuard = afterGuard.match(GUARDED_WORK)
      assert.ok(!workAfterGuard || refusal.index < workAfterGuard.index, `${where}: 거부 응답보다 먼저 ${workAfterGuard?.[0]} 를 쓴다`)
      actual[method] = guard.requirement
    })
    assert.deepEqual(actual, expected, path)
  }
})

test('② 통계 route는 권한 조회가 실패했을 때만 is_admin을 직접 확인하고, 그때는 권한이 필요한 구역을 읽지 않는다', () => {
  assert.deepEqual(Object.keys(ROUTE_LOOKUP_FALLBACKS), ['src/app/api/admin/stats/route.ts'])
  const route = read('src/app/api/admin/stats/route.ts')
  // 401·403은 가드 응답 그대로 돌려준다.
  assert.match(route, /if \('error' in guard && guard\.status !== 500\) \{\s*return NextResponse\.json\(\{ error: guard\.error \}, \{ status: guard\.status \}\)/)
  assert.match(route, /const access = 'error' in guard \? null : guard\.access\s*if \(!access\) \{/)
  // 직접 확인은 접근 정보가 없을 때만 하고, 비로그인 401·비관리자 403을 돌려준다.
  const fallback = route.slice(route.indexOf('if (!access) {'), route.indexOf('const period = getKstPeriodStarts()'))
  assert.equal(route.match(/\.select\('is_admin'\)/g).length, 1)
  assert.match(fallback, /if \(!user\) \{\s*return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  assert.match(fallback, /\.select\('is_admin'\)[\s\S]*if \(!profile\?\.is_admin\) \{\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  assert.match(route, /access \? getAdminDashboard\(access, period\) : null/)
})

test('② 예외 route(session)는 본인 세션의 관리자 여부만 돌려준다', () => {
  const session = read(`${ROUTE_ROOT}/session/route.ts`)
  assert.deepEqual(session.match(/^export async function (\w+)\(/gm), ['export async function GET('])
  assert.doesNotMatch(session, /createAdminClient|supabase\/bypass|\.(insert|update|upsert|delete|rpc)\(/)
  assert.deepEqual(session.match(/NextResponse\.json\(\{[^}]*\}/g), [
    'NextResponse.json({ isAdmin: false }',
    'NextResponse.json({ isAdmin: Boolean(profile?.is_admin) }',
  ])
})

// ---------------------------------------------------------------------------------------------------------------
// ③ 관리자 서버 액션 파일의 모든 export
// ---------------------------------------------------------------------------------------------------------------
const LEGACY = (feature) => ({ requirement: OWNER, feature })
const ACTION_REQUIREMENTS = {
  'src/app/(admin)/admin/storefront-menu/actions.ts': {
    saveStorefrontHeaderLinksAction: 'site.manage',
  },
  // 가입 동의 항목·안내 문구는 대표 전용(전 회원 재동의를 일으킬 수 있다).
  'src/app/(admin)/admin/footer/consent-actions.ts': {
    getSignupConsentAdminData: 'owner',
    saveSignupConsentItemAction: 'owner',
    reviseSignupConsentItemAction: 'owner',
    saveSignupConsentTextsAction: 'owner',
  },
  'src/app/(admin)/admin/footer/actions.ts': {
    getFooterSettingsData: 'site.manage',
    saveSiteFooterContentAction: 'site.manage',
    saveFooterContentAction: { alias: 'saveSiteFooterContentAction' },
    saveSiteBrandAction: 'site.manage',
  },
  // 공지 팝업(15번)은 대표 전용(DB 함수도 대표인지 다시 본다).
  'src/app/(admin)/admin/footer/notice-popup-actions.ts': {
    getNoticePopupAdminData: 'owner',
    saveNoticePopupAction: 'owner',
  },
  // 12번 6-3: 이용 정지 안내 문구·사유 분류는 대표 전용(DB 저장 함수도 대표인지 다시 본다).
  'src/app/(admin)/admin/users/suspension-policy-actions.ts': {
    getMemberSuspensionPolicyAdminData: 'owner',
    saveMemberSuspensionPolicyAction: 'owner',
  },
  // 13번: 답변 템플릿은 support.manage(Q8 가), 고객지원 안내 문구는 대표 전용(Q9 가 — 응답 시간 같은 약속이 들어 있음).
  'src/app/(admin)/admin/support/actions.ts': {
    saveSupportReplyTemplateAction: 'support.manage',
    hideSupportReplyTemplateAction: 'support.manage',
    getSupportPageContentAdminData: 'owner',
    saveSupportPageContentAction: 'owner',
  },
  // 14번: 공지·FAQ 글·순서·안내 문구는 content.manage, 가림은 대표만(Q6 — DB 함수도 대표인지 다시 본다).
  'src/app/(admin)/admin/notices/actions.ts': {
    saveSiteBoardPostAction: 'content.manage',
    deleteSiteBoardPostAction: 'content.manage',
    reorderSiteBoardPostsAction: 'content.manage',
    redactSiteBoardPostAction: 'owner',
    saveSiteBoardContentAction: 'content.manage',
  },
  // 16번: 알림 문구 저장·공지 알림 미리보기·보내기·회수는 대표만(DB 함수도 대표인지 다시 본다)
  'src/app/(admin)/admin/notifications/actions.ts': {
    saveMemberNotificationTextsAction: 'owner',
    previewMemberBroadcastAction: 'owner',
    sendMemberBroadcastAction: 'owner',
    retractMemberBroadcastAction: 'owner',
  },
  'src/app/(admin)/admin/footer/purchase-policy-actions.ts': {
    getMarketPurchasePolicyAdminData: 'site.manage',
    saveMarketPurchasePolicyAction: 'site.manage',
  },
  'src/app/(admin)/admin/pricing/actions.ts': {
    getPricingPlans: 'pricing.manage',
    upsertPricingPlan: 'pricing.manage',
    deletePricingPlan: 'pricing.manage',
    togglePlanStatus: 'pricing.manage',
    savePricingPageContentAction: 'pricing.manage',
    savePointChargePolicyTextsAction: 'pricing.manage',
    // 11번 9절: 결제 전 확인 문구 관리자 읽기(판·2판 키·저장된 값의 지문)
    getPointChargePolicyAdminData: 'pricing.manage',
  },
  'src/app/(admin)/admin/menu-management/actions.ts': {
    // 사이드바의 메뉴 이름 바꾸기는 운영 기능이다(기능 묶음 검사 없음).
    renameAdminSidebarMenuAction: 'site.manage',
    // 메뉴관리 화면은 닫을 예정(4-2절 2차)이라 그 전까지 대표 전용.
    getMenuManagementData: OWNER,
    saveAdminSidebarNavigationConfigAction: LEGACY('menu_management'),
    saveMenuManagementConfig: LEGACY('menu_management'),
    backfillMarketMenuEntriesAction: LEGACY('menu_management'),
    // 문제생성 게시판(꺼 둔 기능)
    getGenerateListboardPostsAction: OWNER,
    getGenerateListboardPostItemsAction: OWNER,
    createGenerateMenuEntryAction: LEGACY('generate'),
    updateGenerateMenuEntryAction: LEGACY('generate'),
    archiveGenerateMenuEntryAction: LEGACY('generate'),
    reorderGenerateMenuEntriesAction: LEGACY('generate'),
    backfillGenerateMenuEntriesAction: LEGACY('generate'),
    createGenerateListboardPostAction: LEGACY('generate'),
    createGenerateListboardPostWithItemsAction: LEGACY('generate'),
    updateGenerateListboardPostAction: LEGACY('generate'),
    archiveGenerateListboardPostAction: LEGACY('generate'),
    createGenerateListboardPostItemAction: LEGACY('generate'),
    updateGenerateListboardPostItemAction: LEGACY('generate'),
    archiveGenerateListboardPostItemAction: LEGACY('generate'),
  },
  'src/app/(admin)/admin/landing-pages/actions.ts': {
    getLandingPagesAdminData: OWNER,
    saveMainLandingConfigAction: LEGACY('landing_pages'),
    saveWorkspaceLandingConfigAction: LEGACY('landing_pages'),
  },
  'src/app/(admin)/admin/problem-types/actions.ts': {
    createProblemType: LEGACY('ai_generation'),
    updateProblemType: LEGACY('ai_generation'),
    deleteProblemType: LEGACY('ai_generation'),
    updateProblemTypeSortOrder: LEGACY('ai_generation'),
    updateProblemTypeDefaultPrompts: LEGACY('ai_generation'),
  },
  'src/app/(admin)/admin/roles/actions.ts': {
    createRole: LEGACY('signup_roles'),
    updateRole: LEGACY('signup_roles'),
    deleteRole: LEGACY('signup_roles'),
  },
  'src/app/api/admin/labels/actions.ts': {
    getDisplayLabels: OWNER,
    getDisplayLabelsByCategory: OWNER,
    getDisplayValue: OWNER,
    updateDisplayLabel: LEGACY('labels'),
    addDisplayLabel: LEGACY('labels'),
    deleteDisplayLabel: LEGACY('labels'),
  },
  'src/app/api/admin/prompts/actions.ts': {
    getSystemPrompts: OWNER,
    updateSystemPrompt: LEGACY('passages'),
  },
  'src/app/api/admin/settings/actions.ts': {
    // 사용자 쪽 옛 지문 기능(api/ai/generate-passages, api/ocr/actions, api/passages/actions, ai-generator)이 부르는 읽기다.
    // 관리자 가드를 걸면 그 경로가 깨진다. 쓰기는 없고 AI 설정 값만 읽으며, 그 기능 자체는 site_passages 묶음으로 닫혀 있다.
    getSystemSettings: { exempt: '사용자 쪽 옛 지문 기능이 부르는 읽기 전용 설정 조회' },
    getAIModelSettings: { exempt: '사용자 쪽 옛 지문 기능이 부르는 읽기 전용 설정 조회' },
    getAvailableAIModels: OWNER,
    updateSystemSettings: LEGACY('passages'),
    updateAIModelSettings: LEGACY('passages'),
    saveAvailableAIModels: LEGACY('passages'),
  },
}

// 파일 맨 앞의 주석·빈 줄을 건너뛴 첫 문장이 'use server'인 파일.
const USE_SERVER_DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use server['"]/
const isServerActionFile = (_entry, path) => /\.tsx?$/.test(path) && USE_SERVER_DIRECTIVE.test(read(path))
const actionFiles = [...walk('src/app/(admin)', isServerActionFile), ...walk('src/app/api/admin', isServerActionFile)]

// 가드 앞에 올 수 있는 줄: 기능 묶음 차단, 기존 관리자 확인(redirect), 세션 클라이언트 준비, 주석, try.
const BEFORE_ACTION_GUARD = /^(\s*|\s*\/\/.*|\s*await assertAdminFeatureEnabled\('[a-z_]+'\)|\s*(const user = )?await requireAdmin\(\)|\s*const supabase = await createClient\(\);?|\s*try \{)$/

test('③ 관리자 서버 액션 파일은 하나도 빠짐없이 표에 있다', () => {
  assert.deepEqual(actionFiles.sort(), Object.keys(ACTION_REQUIREMENTS).sort())
})

test('③ 관리자 서버 액션의 모든 export는 표의 권한으로 액션 가드를 부르고, 그 전에 아무것도 읽거나 쓰지 않는다', () => {
  for (const [path, expected] of Object.entries(ACTION_REQUIREMENTS)) {
    const source = read(path)
    // 값으로 내보내는 것 전부(타입·인터페이스는 실행되지 않는다).
    const exported = [...source.matchAll(/^export (?:async function|function|const|let|var|class) (\w+)/gm)].map((match) => match[1])
    assert.deepEqual(exported.sort(), Object.keys(expected).sort(), `${path}: export 목록`)
    assert.doesNotMatch(source, /^export \{|^export \*|^export default/m, `${path}: 다른 방식의 export는 쓰지 않는다`)
    assert.doesNotMatch(source, /\.select\('is_admin'\)/, `${path}: is_admin만 보는 옛 확인이 남아 있다`)

    for (const [name, rule] of Object.entries(expected)) {
      const where = `${path} ${name}`
      if (typeof rule === 'object' && 'alias' in rule) {
        assert.match(source, new RegExp(`^export const ${name} = ${rule.alias}$`, 'm'), where)
        assert.ok(typeof expected[rule.alias] === 'string', `${where}: 가드가 있는 함수의 다른 이름이어야 한다`)
        continue
      }
      const declaration = source.match(new RegExp(`^export async function ${name}\\([\\s\\S]*?\\n\\}\\n`, 'm'))
      assert.ok(declaration, `${where}: export async function`)
      const bodyLines = declaration[0].slice(declaration[0].search(/\{\n/) + 2).split('\n')
      if (typeof rule === 'object' && 'exempt' in rule) {
        assert.ok(rule.exempt.length > 0, where)
        // 예외는 읽기만 한다.
        assert.doesNotMatch(declaration[0], /assertAdminActionPermission|\.(insert|update|upsert|delete|rpc)\(|createSupabaseClient\(/, where)
        continue
      }
      const requirement = typeof rule === 'string' ? rule : rule.requirement
      assertKnownRequirement(requirement, where)
      const guardLine = bodyLines.findIndex((line) => /await assertAdminActionPermission\(/.test(line))
      assert.ok(guardLine >= 0, `${where}: 가드를 부르지 않는다`)
      // 결과(처리자 id — 작업 기록용)를 access로 받아도 된다.
      assert.equal(bodyLines[guardLine].trim().replace(/^const access = /, ''), `await assertAdminActionPermission('${requirement}')`, where)
      const before = bodyLines.slice(0, guardLine)
      // 여러 줄 인자 목록의 닫는 줄(") {" 형태)은 본문이 아니다.
      const firstBodyLine = before.findIndex((line) => /^\)(: [^{]+)? \{$/.test(line)) + 1
      for (const line of before.slice(firstBodyLine)) {
        assert.match(line, BEFORE_ACTION_GUARD, `${where}: 가드보다 먼저 하는 일이 있다 → ${line.trim()}`)
      }
      // 꺼 둔 기능의 쓰기 액션: 차단 검사가 권한 검사보다 먼저다(대표도 404와 같은 취급).
      const featureLine = before.findIndex((line) => /await assertAdminFeatureEnabled\(/.test(line))
      if (typeof rule === 'object') {
        assert.ok(featureLine >= 0, `${where}: 기능 묶음 차단이 없다`)
        assert.equal(before[featureLine].trim(), `await assertAdminFeatureEnabled('${rule.feature}')`, where)
      } else {
        assert.equal(featureLine, -1, `${where}: 표에 기능 묶음을 적는다`)
      }
    }
  }
})

// ---------------------------------------------------------------------------------------------------------------
// ④ 꺼 둘 수 있는 기능 묶음에 속한 주소는 대표 전용이다
// ---------------------------------------------------------------------------------------------------------------
test('④ 기능 묶음(4-2절)에 속한 페이지·API는 모두 대표 전용이고, 차단 규칙은 그대로다', () => {
  const toUrl = (prefix, path, suffix) => `${prefix}/${path}`.replace(new RegExp(`/?${suffix}$`), '')
  let checked = 0
  for (const [path, requirement] of Object.entries(PAGE_REQUIREMENTS)) {
    if (!resolveAdminFeature(toUrl('/admin', path, 'page\\.tsx'))) continue
    assert.equal(requirement, OWNER, path)
    checked += 1
  }
  for (const [path, methods] of Object.entries(ROUTE_REQUIREMENTS)) {
    if (!resolveAdminFeature(toUrl('/api/admin', path, 'route\\.ts'))) continue
    for (const [method, requirement] of Object.entries(methods)) assert.equal(requirement, OWNER, `${path} ${method}`)
    checked += 1
  }
  assert.ok(checked >= 50, `기능 묶음에 속한 주소 ${checked}개`)
  // 운영 화면은 어느 묶음에도 속하지 않는다(가드만으로 막는다).
  for (const url of ['/admin', '/admin/orders', '/admin/refunds', '/api/admin/users/credits', '/api/admin/market/items', '/admin/forbidden']) {
    assert.equal(resolveAdminFeature(url), null, url)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// ⑤ 가드를 실제로 돌려 본다: staff 계정의 권한·한도
// ---------------------------------------------------------------------------------------------------------------
const grant = (permission, limits = {}) => ({ permission, limits })
const json = { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } }
const GRANT_KEY = '0f8fad5b-d9cb-469f-a165-70867728950e'
const MEMBER_ID = '00000000-0000-4000-8000-000000000002'
const CREDIT_STAFF = [grant('members.view'), grant('credits.view')]

function loadCreditGrantRoute(session) {
  const grants = []
  const route = load('src/app/api/admin/users/credits/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/member-notifications-server': memberNotificationsServer(),
    '@/lib/credits': { CreditService: { grantCreditsAsAdmin: async (...args) => { grants.push(args); return { newBalance: 1, alreadyGranted: false } } } },
    '@/lib/credit-source-display': { resolveAdminGrantSourceCategory: () => 'admin_other' },
    '@/lib/credit-balance': { getCreditBalanceSnapshot: async () => ({}), buildCreditBalanceResponseFields: () => ({}) },
  })
  const post = (amount) => route.POST({
    json: async () => ({ userId: MEMBER_ID, amount, description: '보상', category: 'other', idempotencyKey: GRANT_KEY }),
  })
  return { post, grants }
}

test('⑤ 크레딧 지급: 권한(의존 포함)이 있으면 지급 함수를 부르고, 1회·하루 한도는 지급 함수(DB)가 본다', async () => {
  // 대표: 1만 넘는 수량도 지급 함수까지 간다(대표는 한도 없음 — 20261118120000).
  const owner = loadCreditGrantRoute({})
  assert.equal((await owner.post(50000)).status, 200)
  assert.equal(owner.grants.length, 1)

  // 직원: 계정별 한도가 없어도(기본 한도) route는 막지 않는다. 한도 판정은 지급 함수가 한다.
  for (const limits of [{}, { per_grant: 1000, per_day: 5000 }]) {
    const staff = loadCreditGrantRoute({ role: 'staff', grants: [...CREDIT_STAFF, grant('credits.grant', limits)] })
    assert.equal((await staff.post(1001)).status, 200, JSON.stringify(limits))
    assert.equal(staff.grants.length, 1)
  }

  // 의존 권한이 빠진 권한, 권한 없음, 관리자 아님, 비로그인
  const noDependency = loadCreditGrantRoute({ role: 'staff', grants: [grant('credits.grant', { per_grant: 1000 })] })
  assert.equal((await noDependency.post(1)).status, 403)
  const viewOnly = loadCreditGrantRoute({ role: 'staff', grants: CREDIT_STAFF })
  assert.deepEqual(await viewOnly.post(1), { body: { error: '이 작업을 할 권한이 없습니다.' }, status: 403 })
  assert.deepEqual(await loadCreditGrantRoute({ isAdmin: false }).post(1), { body: { error: 'Forbidden: Admin only' }, status: 403 })
  assert.deepEqual(await loadCreditGrantRoute({ loggedIn: false }).post(1), { body: { error: 'Unauthorized' }, status: 401 })
  for (const blocked of [noDependency, viewOnly]) assert.equal(blocked.grants.length, 0)

  // route는 한도를 직접 보지 않고(하드코딩 10,000 없음) 행위자를 지급 함수에 넘긴다.
  const source = read('src/app/api/admin/users/credits/route.ts')
  assert.doesNotMatch(source, /checkAdminLimit|10000|10,000/)
  assert.match(source, /actorId: guard\.access\.userId/)
})

function loadCreditLimitsRoute(session, rpc = async () => ({ data: { after: { per_grant: 5000, per_day: 20000 } }, error: null })) {
  const calls = []
  const route = load('src/app/api/admin/users/credits/limits/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/admin-credit-grant-limits-server': load('src/lib/admin-credit-grant-limits-server.ts', {
      '@/lib/supabase/bypass': { createAdminClient: () => ({ rpc: async (name, args) => { calls.push([name, args]); return rpc(name, args) } }) },
    }),
  })
  const put = (body) => route.PUT({ json: async () => body })
  return { put, calls }
}

test('⑤ 지급 기본 한도 변경: 대표와 credits.limits.manage(+credits.view)를 받은 직원만, 행위자를 함수에 넘긴다', async () => {
  const owner = loadCreditLimitsRoute({})
  const saved = await owner.put({ perGrant: 5000, perDay: 20000 })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body, { success: true, limits: { perGrant: 5000, perDay: 20000 } })
  assert.deepEqual(owner.calls, [['set_admin_credit_grant_limits', { p_actor_id: '00000000-0000-4000-8000-000000000001', p_per_grant: 5000, p_per_day: 20000 }]])

  const manager = loadCreditLimitsRoute({ role: 'staff', grants: [grant('credits.view'), grant('credits.limits.manage')] })
  assert.equal((await manager.put({ perGrant: 1, perDay: 1 })).status, 200)

  // 권한 없음·의존 빠짐 → 함수를 부르지 않는다
  for (const grants of [[grant('credits.view'), grant('credits.grant')], [grant('credits.limits.manage')]]) {
    const denied = loadCreditLimitsRoute({ role: 'staff', grants })
    assert.equal((await denied.put({ perGrant: 1, perDay: 1 })).status, 403)
    assert.equal(denied.calls.length, 0)
  }
  // 입력 검증: 1회 > 하루, 0, 소수, 문자열
  for (const body of [{ perGrant: 2, perDay: 1 }, { perGrant: 0, perDay: 1 }, { perGrant: 1.5, perDay: 2 }, { perGrant: '1', perDay: 2 }, null]) {
    const bad = loadCreditLimitsRoute({})
    assert.equal((await bad.put(body)).status, 400, JSON.stringify(body))
    assert.equal(bad.calls.length, 0)
  }
  // 함수 거부는 상태·문구로
  const rejected = loadCreditLimitsRoute({}, async () => ({ data: null, error: { message: 'ADMIN_GRANT_LIMITS_ACTOR_NOT_ALLOWED' } }))
  assert.equal((await rejected.put({ perGrant: 1, perDay: 2 })).status, 403)
})

function loadMarketRefundRoute(session, { requested = 5000, lookupError = null, requester = MEMBER_ID } = {}) {
  const calls = { approve: [], reject: [], lookups: 0 }
  const route = load('src/app/api/admin/market/refunds/[id]/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        from: (table) => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => {
            assert.equal(table, 'market_refund_requests')
            calls.lookups += 1
            return lookupError ? { data: null, error: lookupError } : { data: { user_id: requester, requested_refund_credits: requested }, error: null }
          } }) }),
          insert: async () => ({ error: null }),
        }),
      }),
    },
    '@/lib/member-notifications-server': memberNotificationsServer(),
    '@/lib/market-refunds': {
      MarketRefundConflictError: class extends Error {},
      MarketRefundShortfallError: class extends Error {},
      approveMarketRefund: async (input) => { calls.approve.push(input); return { user_id: MEMBER_ID, restored_refund_credits: requested } },
      rejectMarketRefund: async (input) => { calls.reject.push(input); return { user_id: MEMBER_ID } },
      // 8번: 거부 사유 코드·대표 정산·새 오류 종류
      MARKET_REFUND_REJECT_CODES: ['TARGET_CHANGED', 'PROVIDED_CONFIRMED', 'OTHER'],
      MarketRefundNeedsOwnerError: class extends Error {},
      MarketRefundRuleError: class extends Error {},
      settleMarketRefundByOwner: async () => ({}),
      getMarketRefundOwnerContext: async () => null,
    },
  })
  const patch = (body) => route.PATCH({ json: async () => body }, { params: Promise.resolve({ id: 'request-1' }) })
  return { patch, calls }
}

test('⑤ 마켓 환불: 대표는 한도 없이, staff는 1건 승인 한도 안에서만 승인하고 거부는 한도와 무관하다', async () => {
  const owner = loadMarketRefundRoute({}, { requested: 9_000_000 })
  assert.equal((await owner.patch({ action: 'approve' })).status, 200)
  // 대표도 처리 전에 요청을 한 번 읽는다(본인이 낸 요청인지 확인).
  assert.equal(owner.calls.lookups, 1)

  const session = { role: 'staff', grants: [grant('orders.view'), grant('refunds.market', { per_request: 5000 })] }
  const within = loadMarketRefundRoute(session, { requested: 5000 })
  assert.equal((await within.patch({ action: 'approve' })).status, 200)
  assert.equal(within.calls.approve.length, 1)

  const over = loadMarketRefundRoute(session, { requested: 5001 })
  const blocked = await over.patch({ action: 'approve' })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'ADMIN_LIMIT_EXCEEDED')
  assert.equal(over.calls.approve.length, 0, '한도를 넘으면 승인 함수를 부르지 않는다')
  // 확인한 복구량을 작게 보내도 요청 크레딧이 기준이고, 크게 보내면 그 값이 기준이다.
  assert.equal((await over.patch({ action: 'approve', confirmedRefundCredits: 1 })).status, 403)
  assert.equal((await within.patch({ action: 'approve', confirmedRefundCredits: 5001 })).status, 403)
  // 거부는 한도가 없다.
  assert.equal((await over.patch({ action: 'reject', rejectCode: 'OTHER', adminNote: '요건 미달' })).status, 200)
  assert.equal(over.calls.reject.length, 1)

  // 요청을 읽지 못하면 승인하지 않는다.
  const unreadable = loadMarketRefundRoute(session, { lookupError: { message: 'down' } })
  assert.equal((await unreadable.patch({ action: 'approve' })).status, 500)
  assert.equal(unreadable.calls.approve.length, 0)

  // 권한이 없거나(의존 빠짐 포함) 관리자가 아니면 본문을 읽기 전에 막힌다.
  for (const denied of [{ role: 'staff', grants: [grant('refunds.market', { per_request: 5000 })] }, { role: 'staff', grants: [grant('refunds.payment'), grant('orders.view')] }, { isAdmin: false }]) {
    const world = loadMarketRefundRoute(denied)
    assert.equal((await world.patch({ action: 'reject' })).status, 403)
    assert.equal(world.calls.reject.length, 0)
  }
  assert.equal((await loadMarketRefundRoute({ loggedIn: false }).patch({ action: 'reject' })).status, 401)
})

function loadItemRoute(session) {
  const calls = { deleted: 0 }
  const route = load('src/app/api/admin/market/items/[id]/route.ts', {
    'next/server': { NextResponse },
    'next/cache': { revalidateTag: () => {} },
    ...adminGuardMocks(session),
    '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'korean' },
    '@/lib/market-categories-server': {},
    '@/lib/market-item-cleanup': { deleteOrHideMarketItem: async () => { calls.deleted += 1; return { result: 'deleted' } } },
    '@/lib/market-images-server': {},
    '@/lib/market-images': {},
    '@/lib/market-items-server': {
      getMarketItemById: async () => ({ id: 'item-1', workspace_subject: 'korean' }),
      getMarketItemByIdForAdmin: async () => ({ id: 'item-1' }),
      listMarketItemFiles: async () => [],
      listMarketItemSubproductsForAdmin: async () => [],
      listMarketSubproductFilesForAdmin: async () => [],
      getMarketItemBundleOptionForAdmin: async () => null,
    },
  })
  const request = { url: 'http://localhost/api/admin/market/items/item-1?subject=korean' }
  const context = { params: Promise.resolve({ id: 'item-1' }) }
  return { get: () => route.GET(request, context), remove: () => route.DELETE(request, context), calls }
}

test('⑤ 상품: 수정 권한만으로는 완전 삭제를 못 하고, 오류는 기존 응답 형식 그대로다', async () => {
  const editor = loadItemRoute({ role: 'staff', grants: [grant('products.edit')] })
  assert.equal((await editor.get()).status, 200)
  const denied = await editor.remove()
  assert.equal(denied.status, 403)
  assert.deepEqual(await denied.json(), { success: false, error: { code: 'FORBIDDEN', message: '이 작업을 할 권한이 없습니다.' } })
  assert.equal(editor.calls.deleted, 0)

  const deleter = loadItemRoute({ role: 'staff', grants: [grant('products.edit'), grant('products.delete')] })
  assert.equal((await deleter.remove()).status, 200)
  assert.equal(deleter.calls.deleted, 1)
  // 삭제 권한만 있고 수정 권한(의존)이 없으면 삭제도 못 한다.
  assert.equal((await loadItemRoute({ role: 'staff', grants: [grant('products.delete')] }).remove()).status, 403)

  const owner = loadItemRoute({})
  assert.equal((await owner.get()).status, 200)
  assert.equal((await owner.remove()).status, 200)

  const anonymous = await loadItemRoute({ loggedIn: false }).get()
  assert.equal(anonymous.status, 401)
  assert.deepEqual(await anonymous.json(), { success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } })
  // 관리자가 아닌 계정의 403은 예전 한글 문구 그대로다.
  const member = await loadItemRoute({ isAdmin: false }).get()
  assert.equal(member.status, 403)
  assert.deepEqual(await member.json(), { success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } })
})

function loadStatsRoute(session, { lookupFails = false } = {}) {
  const calls = { dashboard: 0, workAccess: [] }
  const guard = adminGuardMocks(session)
  const route = load('src/app/api/admin/stats/route.ts', {
    'next/server': json,
    ...guard,
    // 권한 조회 실패: 가드가 500을 돌려준다.
    ...(lookupFails ? { '@/lib/admin-permissions-server': { requireAdminApiPermission: async () => ({ error: '권한을 확인하지 못했습니다.', status: 500 }) } } : {}),
    '@/lib/supabase/server': { createClient: async () => {
      const client = createFakeSessionClient(session)
      return { auth: client.auth, from: (table) => ({ ...client.from(table), select: (_columns, options) => (options?.head ? { gte: async () => ({ count: 3, error: null }) } : client.from(table)) }) }
    } },
    '@/lib/admin-dashboard-server': { getAdminDashboard: async () => { calls.dashboard += 1; return { metrics: { ok: true }, recentOrders: { failed: false, data: [] }, recentTickets: null } } },
    '@/lib/admin-work-summary-server': { getAdminWorkSummary: async (access) => { calls.workAccess.push(access); return { supportPending: 1 } } },
    '@/lib/kst-period': { getKstPeriodStarts: () => ({ todayStart: 't', monthStart: 'm', year: 2026, month: 11 }) },
    // 13번 M3: 가입 수는 서버 키로 센다(세션은 다른 회원의 profiles 를 읽지 못함). 최근 주문·문의 이메일은 열람 기록 뒤에 싣는다.
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: () => ({ select: (_columns, options) => (options?.head ? { gte: async () => ({ count: 3, error: null }) } : null) }) }) },
    '@/lib/admin-member-access-log-server': { recordMemberAccess: async (input) => { calls.access = (calls.access ?? []).concat([input]); return true } },
    '@/lib/admin-request-meta': load('src/lib/admin-request-meta.ts'),
  })
  return { get: () => route.GET(new Request('http://localhost/api/admin/stats')), calls }
}

test('⑤ 통계: 가입 수는 회원 조회 권한, 처리 대기는 항목별 권한으로 거르고, 권한 조회가 실패하면 "확인 불가"로 보낸다', async () => {
  // 권한 0개 staff: 가입 수는 빠지고(null), 처리 대기는 그 계정의 권한으로 센다.
  const normal = loadStatsRoute({ role: 'staff' })
  const ok = await normal.get()
  assert.equal(ok.status, 200)
  assert.equal(ok.body.signups, null)
  assert.deepEqual(ok.body.metrics, { ok: true })
  assert.equal(normal.calls.dashboard, 1)
  assert.equal(normal.calls.workAccess.length, 1)
  assert.equal(normal.calls.workAccess[0].role, 'staff')

  // 회원 조회 권한이 있는 staff와 대표는 가입 수를 본다.
  for (const session of [{ role: 'staff', grants: [grant('members.view')] }, {}]) {
    assert.deepEqual((await loadStatsRoute(session).get()).body.signups, { today: 3, month: 3 }, JSON.stringify(session))
  }

  // 권한을 읽지 못하면: 가입 수는 세지 않고 "확인 불가"(null 값), 처리 대기도 권한 없이(null) 부르고, 권한 구역은 뺀다.
  const degraded = loadStatsRoute({}, { lookupFails: true })
  const partial = await degraded.get()
  assert.equal(partial.status, 200)
  assert.deepEqual(partial.body.signups, { today: null, month: null })
  assert.deepEqual(degraded.calls.workAccess, [null])
  assert.equal(partial.body.metrics, null)
  assert.equal(degraded.calls.dashboard, 0)

  // 조회가 실패한 상태에서도 관리자가 아니면 403, 비로그인은 401이다.
  assert.deepEqual(await loadStatsRoute({ isAdmin: false }, { lookupFails: true }).get(), { body: { error: 'Forbidden' }, status: 403 })
  assert.deepEqual(await loadStatsRoute({ loggedIn: false }, { lookupFails: true }).get(), { body: { error: 'Unauthorized' }, status: 401 })
  // 조회가 되는 평소에는 가드 응답 그대로다.
  assert.deepEqual(await loadStatsRoute({ isAdmin: false }).get(), { body: { error: 'Forbidden: Admin only' }, status: 403 })
  assert.deepEqual(await loadStatsRoute({ loggedIn: false }).get(), { body: { error: 'Unauthorized' }, status: 401 })
})

test('⑤ 판정 함수: 표의 모든 요구 조건을 대표는 통과하고 권한 0개 staff는 "관리자면 누구나"만 통과한다', () => {
  const owner = buildAdminAccess('u', { is_admin: true, admin_role: 'owner' }, [])
  const empty = buildAdminAccess('u', { is_admin: true, admin_role: null }, [])
  const requirements = [
    ...ALL_PAGE_REQUIREMENTS.map(([, requirement]) => requirement),
    ...ALL_ROUTE_REQUIREMENTS.flatMap(([, methods]) => Object.values(methods)),
    ...Object.values(ACTION_REQUIREMENTS).flatMap((rules) => Object.values(rules))
      .map((rule) => (typeof rule === 'string' ? rule : rule.requirement)).filter(Boolean),
  ]
  for (const requirement of requirements) {
    assert.equal(meetsAdminRequirement(owner, requirement), true, `owner ${requirement}`)
    assert.equal(meetsAdminRequirement(empty, requirement), requirement === 'admin', `staff ${requirement}`)
    assert.equal(meetsAdminRequirement(null, requirement), false)
  }
})
