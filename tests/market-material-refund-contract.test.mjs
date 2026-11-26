import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'
import { memberNotificationRules, seedMemberNotificationTexts } from './helpers/member-notifications-harness.mjs'

// 8번 묶음(docs/plan-bundle8-material-refund.md): 자료 환불 30일·받지 않은 자료 환불·예외 환불·대표 정산
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const rules = load('src/lib/market-refund-rules.ts')
const migration = read('supabase/migrations/20261124100000_market_material_refund.sql')
const rollback = read('supabase/rollback/20261124100000_market_material_refund_down.sql')

test('마감: TS = DB market_refund_deadline (구매일 KST 다음 날부터 N일째 24:00, 기준 시각 < 마감)', () => {
  // 마이그레이션 VERIFY 와 같은 값: 2026-11-23 23:30 KST 구매, 30일 → 2026-12-24 00:00 KST
  assert.match(migration, /market_refund_deadline\('2026-11-23 23:30:00\+09'::timestamptz, 30\) <> '2026-12-24 00:00:00\+09'::timestamptz/)
  assert.equal(rules.marketRefundDeadline('2026-11-23T23:30:00+09:00', 30).toISOString(), '2026-12-23T15:00:00.000Z')
  // 한국 시간 자정 직후 구매도 그날이 구매일이다(UTC 로는 전날)
  assert.equal(rules.marketRefundDeadline('2026-11-23T00:10:00+09:00', 30).toISOString(), '2026-12-23T15:00:00.000Z')
  const deadline = rules.marketRefundDeadline('2026-11-23T10:00:00+09:00', 30)
  assert.equal(rules.isWithinMarketRefundPeriod('2026-11-23T10:00:00+09:00', 30, new Date(deadline.getTime() - 1)), true)
  assert.equal(rules.isWithinMarketRefundPeriod('2026-11-23T10:00:00+09:00', 30, deadline), false)
  assert.equal(rules.marketRefundLastDayLabel('2026-11-23T23:30:00+09:00', 30), '12월 23일(한국 시간)까지')
})

test('심사 중 차단 범위: 전체·대상 없는 예외는 주문 전부, 부분·대상 지정 예외는 대상과 같은 분류(교체본)만, 분류를 모르면 주문 전부', () => {
  const slugs = new Map([['sp-a', 'answer_pdf'], ['sp-b', 'question_hwp']])
  const scopes = rules.buildPendingMarketRefundScopes([
    { order_id: 'full', refund_kind: 'full', refund_subproduct_ids: null },
    { order_id: 'exception', refund_kind: 'exception', refund_subproduct_ids: ['sp-a'] },
    { order_id: 'exception-all', refund_kind: 'exception', refund_subproduct_ids: null },
    { order_id: 'partial', refund_kind: 'partial', refund_subproduct_ids: ['sp-a'] },
    { order_id: 'unknown', refund_kind: 'partial', refund_subproduct_ids: ['sp-gone'] },
    { order_id: null, refund_kind: 'full', refund_subproduct_ids: null },
  ], (id) => slugs.get(id))
  assert.equal(scopes.size, 5)
  const blocks = (orderId, file) => rules.isPendingRefundBlockingFile(scopes.get(orderId), file)
  const other = { subproductId: 'sp-b', categorySlug: 'question_hwp' }
  assert.equal(blocks('full', other), true)
  assert.equal(blocks('exception', other), false, '대상을 지정한 예외 요청은 대상만 막는다')
  assert.equal(blocks('exception', { subproductId: 'sp-a', categorySlug: 'answer_pdf' }), true)
  assert.equal(blocks('exception-all', other), true, '대상 없는 예외 요청(서브상품 주문)은 주문 전체')
  assert.equal(blocks('partial', other), false, '부분 환불 대상이 아닌 자료는 계속 받을 수 있다')
  assert.equal(blocks('partial', { subproductId: 'sp-a', categorySlug: 'answer_pdf' }), true)
  assert.equal(blocks('partial', { subproductId: 'sp-a2', categorySlug: 'answer_pdf' }), true, '같은 분류의 교체본도 막는다')
  assert.equal(blocks('unknown', other), true, '분류를 모르면 주문 전체를 막는다')
  assert.equal(blocks('none', other), false)
  assert.equal(scopes.get('unknown').kind, 'full')
})

test('같은 판정 함수: 다운로드 route·자료 보관함·상품 상세·관리자 진단', () => {
  const route = read('src/app/api/market/items/[itemId]/download/route.ts')
  assert.match(route, /await listPendingMarketRefundScopes\(/)
  assert.match(route, /isPendingRefundBlockingFile\(/)
  // 분류를 못 읽으면 내려주지 않는다
  assert.match(route, /if \(fileSubproductError\) throw new Error/)
  const items = read('src/lib/market-items-server.ts')
  assert.equal(items.match(/buildPendingMarketRefundScopes\(/g).length, 2)
  assert.doesNotMatch(items, /function buildPendingRefundScopes/)
  const refunds = read('src/lib/market-refunds.ts')
  assert.match(refunds, /return buildPendingMarketRefundScopes\(data \?\? \[\], \(id\) => slugBySubproductId\.get\(id\)\)/)
  const adminOrders = read('src/lib/admin-orders-server.ts')
  assert.match(adminOrders, /buildPendingMarketRefundScopes\(pendingRequests, /)
})

test('마이그레이션: 서비스 함수 5개만 service_role 실행, 내부 함수는 아무도 직접 못 부른다', () => {
  const services = [
    'preview_market_partial_refund(uuid, uuid)',
    'request_market_partial_refund(uuid, uuid, integer, text, uuid)',
    'approve_market_partial_refund(uuid, uuid, text, integer)',
    'admin_exception_market_refund(uuid, uuid, text, text, uuid[], integer, integer, text, uuid, uuid, timestamptz, integer)',
    'settle_market_refund_by_owner(uuid, uuid, jsonb, text, integer)',
  ]
  const grants = Array.from(migration.matchAll(/^GRANT EXECUTE ON FUNCTION public\.(.+) TO (.+);$/gm))
  assert.deepEqual(grants.map((match) => match[1]).sort(), services.slice().sort())
  for (const match of grants) assert.equal(match[2], 'service_role')
  assert.doesNotMatch(migration, /TO (anon|authenticated|PUBLIC)\b/)
  // 원래 정의를 지문으로 확인한 뒤에만 바꾼다
  for (const fn of ['approve_market_refund', 'evaluate_market_targets', 'revoke_admin_credits', 'update_own_pending_support_ticket', 'checkout_market_selection']) {
    assert.match(migration, new RegExp(`md5\\(pg_get_functiondef\\('public\\.${fn}\\(`), fn)
  }
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/)
  // 되돌리기: 부분·예외·대표 정산 기록이 생겼으면 멈춘다
  assert.match(rollback, /refund_kind <> 'full'/)
  assert.match(rollback, /market_refund_reissued_sources/)
})

test('회원 API: 부분 환불은 기대 금액·이전 요청을 넘기고, 규칙 거절은 409(설정 못 읽음은 503)', () => {
  const route = read('src/app/api/market/refunds/route.ts')
  assert.match(route, /if \(parsed\.data\.kind === 'partial'\) \{/)
  assert.match(route, /requestMarketPartialRefund\(\{/)
  assert.match(route, /POLICY_UNAVAILABLE/)
  const view = read('src/app/(solvook)/library/_components/library-view.tsx')
  assert.match(view, /kind: 'partial',\s*expectedCredits: target\.partialRefund\.amount,/)
  assert.match(view, /if \(result\?\.error\?\.code === 'AMOUNT_CHANGED'\) router\.refresh\(\)/)
  // 확인창 문구는 DB 값(partialRefundConfirmNotice). 못 읽으면 부분 환불 버튼을 숨긴다.
  assert.match(read('src/app/(solvook)/library/page.tsx'), /partialRefundNotice=\{purchasePolicy\?\.partialRefundConfirmNotice \?\? null\}/)
  assert.match(view, /target\.partialRefund && partialRefundNotice \? \(/)
})

test('관리자 API: 거부는 사유 종류·사유 필수, 대표 정산은 대표만, 예외 환불은 refunds.market 권한', () => {
  const route = read('src/app/api/admin/market/refunds/[id]/route.ts')
  assert.match(route, /if \(parsed\.data\.action === 'reject' && !parsed\.data\.rejectCode\) \{/)
  assert.match(route, /if \(parsed\.data\.action === 'owner_settle'\) \{\s*if \(adminCheck\.access\.role !== 'owner'\) \{/)
  const exception = read('src/app/api/admin/market/orders/[id]/exception-refund/route.ts')
  assert.equal(exception.match(/requireAdminApiPermission\('refunds\.market'\)/g).length, 2)
  // 작업 기록 종류는 DB 함수가 같은 트랜잭션에서 남긴다
  assert.match(migration, /'market_refund_exception',/)
  assert.match(migration, /'market_refund_owner_settle',/)
  const audit = read('src/lib/admin-audit-log.ts')
  assert.match(audit, /market_refund_exception: /)
  assert.match(audit, /market_refund_owner_settle: /)
})

test('그 밖: 구성 기록 실패는 결제 409, 판매액은 환불된 크레딧을 빼고, 차액 기준에서 패키지 출처 PDF 는 뺀다', () => {
  const checkout = read('src/lib/market-checkout-server.ts')
  assert.match(checkout, /if \(error\.code === 'P0409'\) \{\s*return toMarketCheckoutFailure\('BUNDLE_COMPONENTS_EMPTY'\)/)
  assert.match(checkout, /BUNDLE_COMPONENTS_EMPTY: 409,/)
  assert.match(migration, /RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'MARKET_BUNDLE_COMPONENTS_EMPTY'/)
  const dashboard = read('src/lib/admin-dashboard-server.ts')
  assert.match(dashboard, /sum \+ row\.charged_credits - \(row\.refunded_credits \?\? 0\)/)
  const items = read('src/lib/market-items-server.ts')
  assert.match(items, /source_order:market_purchase_orders!market_entitlements_order_workspace_fkey\(purchase_type\)/)
  assert.match(items, /source_order\?\.purchase_type !== 'bundle'/)
})

// 구현 검증 1차 지적 반영
test('거부: 받지 않은 자료 환불(부분·고객센터 접수 예외)은 "그 밖"으로 거부 못 함, 받은 사실 확인은 근거 필수, 설정을 못 읽으면 멈춤', () => {
  const refunds = read('src/lib/market-refunds.ts')
  assert.match(refunds, /let qualifying = request\.refund_kind === 'partial'\s*\|\| \(request\.refund_kind === 'exception' && request\.claim_type === 'withdrawal'\)/)
  assert.match(refunds, /if \(input\.rejectCode === 'PROVIDED_CONFIRMED' && evidence\.length < 5\) \{/)
  assert.match(refunds, /if \(!refundPolicy\) \{\s*\/\/[^\n]*\n\s*throw new MarketRefundRuleError\('POLICY_UNAVAILABLE'/)
  const client = read('src/app/(admin)/admin/refunds/market-refunds-client.tsx')
  assert.match(client, /option\.value !== 'OTHER' \|\| !\(pending\.request\.refund_kind === 'partial'/)
  // 대표 정산 입력 기본값은 비어 있다(회원에게 불리한 '지급 안 함 전부'를 기본으로 두지 않음)
  assert.match(client, /\{ restored: '', reissued: '', unrecovered: '', reason: '' \}/)
})

test('대표 정산: 대기 원인이 풀린 예외 요청은 엔진 배정대로 닫고, 문제 원천을 덜 지정하면 거절한다', () => {
  assert.match(migration, /IF v_request\.refund_kind <> 'exception' OR v_plan ->> 'code' <> 'OK' THEN\s*RETURN jsonb_build_object\('ok', false, 'code', 'NOT_OWNER_CASE'\);/)
  assert.match(migration, /IF jsonb_array_length\(p_items\) <> 0 THEN\s*RETURN jsonb_build_object\('ok', false, 'code', 'OWNER_CONTEXT_STALE'\);/)
  // 규칙대로 정산할 때도 (e)와 같은 부족분 확인
  assert.match(migration, /p_confirmed_refund_credits IS DISTINCT FROM \(v_plan ->> 'restorable'\)::integer THEN\s*RETURN jsonb_build_object\('ok', false, 'code', 'MARKET_REFUND_SHORTFALL', 'details', v_plan\);\s*END IF;\s*v_plan_items := v_plan -> 'items';/)
  // 받지 않은 자료 환불(부분·고객센터 접수 예외)은 대기 중 판정이 바뀌면 거부해 닫는다
  // 다시 판정은 받은 자료가 있을 때만(다운로드 0건 패키지는 calc 가 FULL_REFUND_AVAILABLE 이라 비교하면 잘못 거부됨 — 리허설 T16)
  assert.match(migration, /OR \(v_request\.refund_kind = 'exception' AND v_request\.claim_type = 'withdrawal' AND v_order\.purchase_type = 'bundle'\s*AND EXISTS \(SELECT 1 FROM public\.market_download_events WHERE order_id = v_order\.id\)\) THEN/)
  assert.match(migration, /WHERE x ->> 'reason' = 'unmatched'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'code', 'ITEMS_INVALID'/)
})

test('재신청: 미리보기가 신청 함수와 같은 규칙으로 앞 신청 id·처음 신청 시각을 쓰고, 보관함은 그 id 를 넘긴다', () => {
  assert.match(migration, /RETURN \(public\.market_partial_refund_calc\(p_order_id, v_base\) - 'state'\) \|\| jsonb_build_object\('prior_request_id', v_prior_id\);/)
  const items = read('src/lib/market-items-server.ts')
  assert.match(items, /priorRequestId: preview\.priorRequestId,/)
})

test('차액 구매 기준 PDF 주문: 보관함은 업그레이드 주문 대기 중이면 신청 가능으로 보고, 업그레이드 주문 신청 때 함께 신청한다', () => {
  const items = read('src/lib/market-items-server.ts')
  assert.match(items, /allowPendingUpgradeRefund: true,\s*preloaded:/)
  assert.match(items, /upgradeOrderIds: eligibility\.upgradeOrderIds,/)
  const view = read('src/app/(solvook)/library/_components/library-view.tsx')
  // 지금 신청하는 주문이 그 PDF 주문을 막는 차액 구매 주문일 때만 함께 신청
  assert.match(view, /target\.upgradeOrderIds\.includes\(refundConfirmTarget\.targetId\)/)
  assert.match(view, /if \(succeeded && includeUpgradeBase\) \{\s*for \(const baseTarget of upgradeBaseTargets\) \{\s*await handleRefundRequest\(baseTarget, false, true\)/)
  assert.match(view, /formatMarketRefundLastDay\(target\.refundableUntil\)/)
})

test('예외 환불 창: 1:1 문의 접수는 판을 직접 고르고 본문을 본 뒤 환불 의사 확인 체크가 있어야 처리된다', () => {
  const dialog = read('src/app/(admin)/admin/orders/market-exception-refund-dialog.tsx')
  assert.match(dialog, /const ticketReady = !isTicketWithdrawal \|\| \(Boolean\(ticketId\) && Boolean\(selectedBody\) && intentConfirmed\)/)
  assert.match(dialog, /disabled=\{submitting \|\| !context \|\| !preview \|\| !reason\.trim\(\) \|\| !ticketReady\s*\|\| \(needsEvidence && evidence\.trim\(\)\.length < 5\)\}/)
  // 이메일·전화 접수는 증빙 필수(서버도 같은 검사)
  assert.match(read('src/app/api/admin/market/orders/[id]/exception-refund/route.ts'), /if \(needsEvidence && !body\.preview && \(body\.evidence \?\? ''\)\.length < 5\) \{/)
  assert.match(read('src/lib/market-refunds.ts'), /select\('id, subject, message, created_at, member_updated_at'\)/)
})

test('되돌리기는 문의 수정 함수(판 보관)를 남기고, 재적용 사전 검사는 그 새 지문도 받는다', () => {
  assert.doesNotMatch(rollback, /FUNCTION public\.update_own_pending_support_ticket/)
  assert.match(migration, /NOT IN \('ed40fb5a478afaf27a5f1440aca1eb70', 'cb221135b63d2bcc590b7fa4d2a082b0'\)/)
  assert.match(migration, /RAISE EXCEPTION 'VERIFY: redefined function md5'/)
  assert.match(migration, /UPDATE public\.support_tickets SET member_updated_at = updated_at\s*WHERE member_updated_at IS NULL AND status = 'pending' AND updated_at > created_at;/)
})

test('같은 분류 서브상품 중복 저장은 409 안내', () => {
  const items = read('src/lib/market-items-server.ts')
  assert.equal(items.match(/throwIfSubproductCategoryConflict\(error\)/g).length, 2)
  for (const path of ['src/app/api/admin/market/items/[id]/subproducts/route.ts', 'src/app/api/admin/market/items/[id]/subproducts/[subproductId]/route.ts']) {
    assert.match(read(path), /if \(error instanceof MarketSubproductCategoryConflictError\) \{\s*return NextResponse\.json\(\{ success: false, error: \{ code: 'CATEGORY_CONFLICT'/, path)
  }
})

test('승인 알림 문구: 돌려준 크레딧, 다시 지급한 몫, 돌려주지 못한 몫을 나눠 알린다(승인·예외 환불 공용)', () => {
  // 16번: 조립 규칙은 코드(buildMarketRefundMessage), 문장 4개는 DB(member_notification_texts.marketRefundMessage — 첫 값은 옛 문구 그대로)
  const { buildMarketRefundMessage } = memberNotificationRules
  const texts = seedMemberNotificationTexts().marketRefundMessage
  assert.equal(buildMarketRefundMessage({ requested_refund_credits: 300, approved_refund_credits: 300, allocated_items: [] }, texts), '300 크레딧이 돌아왔습니다.')
  const mixed = buildMarketRefundMessage({
    requested_refund_credits: 4500,
    approved_refund_credits: 4000,
    allocated_items: [{ reissued: 1500 }, { reissued: 0 }],
  }, texts)
  assert.match(mixed, /^4,000 크레딧이 돌아왔습니다\. 그중 1,500 크레딧은 새 유효기간으로 다시 지급되었습니다/)
  assert.match(mixed, /나머지 500 크레딧은 결제에 쓴 크레딧의 사정/)
  assert.equal(buildMarketRefundMessage({ approved_refund_credits: null }, texts), '크레딧 복구 내역은 크레딧 관리에서 확인해 주세요.')
  for (const [path, kind] of [['src/app/api/admin/market/refunds/[id]/route.ts', 'marketRefundApproved'], ['src/app/api/admin/market/orders/[id]/exception-refund/route.ts', 'marketRefundException']]) {
    assert.match(read(path), new RegExp(`sendMemberNotification\\(\\{ kind: '${kind}', userId: [a-zA-Z.]+user_id, marketRefund: `), path)
  }
})
