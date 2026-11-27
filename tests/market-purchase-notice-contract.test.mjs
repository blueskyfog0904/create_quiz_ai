import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'

// 7번 묶음(docs/plan-bundle7-purchase-notice.md): 자료 구매 고지·동의 기록, 환불 기간 DB 값, 상품 상세 구매 전 확인
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const between = (source, start, end) => {
  const from = source.indexOf(start)
  assert.ok(from >= 0, start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, end)
  return source.slice(from, to)
}

const policyLib = load('src/lib/market-purchase-policy.ts')
const policyServer = load('src/lib/market-purchase-policy-server.ts', {
  'server-only': {},
  'next/cache': { revalidateTag: () => {}, unstable_cache: (fn) => fn },
  '@/lib/supabase/bypass': { createAdminClient: () => { throw new Error('not used') } },
  '@/lib/market-purchase-policy': policyLib,
  // 11번: 2판(접는 동의) 읽기·개발 스위치. 이 시험은 1판 지문·기록 대응만 본다(2판은 bundle11-* 시험).
  '@/lib/checkout-consent': load('src/lib/checkout-consent.ts', {
    '@/lib/point-charge-policy': load('src/lib/point-charge-policy.ts', { '@/lib/payment-constants': { MAX_POINT_CHARGE_AMOUNT: 100000 } }),
  }),
  '@/lib/checkout-consent-server': {
    buildCheckoutConsentBundle: () => null,
    buildMarketCartTexts: () => null,
    readRawSiteFooterValue: async () => null,
    recordCheckoutConsentUnavailableAlert: async () => {},
  },
  '@/lib/checkout-consent-preview': { isCheckoutConsentPreview: () => false, readCheckoutConsentPreviewKeys: async () => null },
})
const migration = read('supabase/migrations/20261123100000_market_purchase_notice.sql')
const bundle7Policy = JSON.parse(migration.split('$json$')[1])
// 8번 묶음(20261124100000)이 같은 설정 위에 덮는 값(refundDays 30, 문구 4개 교체, partialRefundConfirmNotice 추가)
const bundle8Migration = read('supabase/migrations/20261124100000_market_material_refund.sql')
const bundle8Patch = Object.fromEntries(Array.from(
  between(bundle8Migration.slice(bundle8Migration.indexOf("AND value ? 'partialRefundConfirmNotice';")), 'SET value = value || jsonb_build_object(', "updated_at = now()")
    .matchAll(/'([A-Za-z]+)', (?:'((?:[^']|'')*)'|(\d+))/g),
  (match) => [match[1], match[3] !== undefined ? Number(match[3]) : match[2].replaceAll("''", "'")]
))
const initialPolicy = { ...bundle7Policy, ...bundle8Patch }

test('지문: TS 계산 = DB 함수(리허설에서 SQL 이 낸 값), 자리표시는 모두 바뀐다', () => {
  // 7번 문구: 지문은 체크 문구·고지 본문만으로 정해진다(8번에서 더한 키는 지문에 들어가지 않는다).
  const view7 = policyServer.toMarketPurchasePolicyView(policyLib.parseMarketPurchasePolicy({ ...bundle7Policy, partialRefundConfirmNotice: '확인' }))
  // 2026-11-23 운영 DB 리허설(BEGIN…ROLLBACK)에서 record_purchase_notice_ack 가 돌려준 noticeSha256 과 같은 값
  assert.equal(view7.noticeSha256, '3f5c7fd6cf184d13bd631a0ad9b246bbef7d63ab85f72fd01c70a854115e93c4')
  assert.match(view7.checkboxLabel, /구매 후 7일 안에/)
  // 8번 문구: 키 10개, 30일이 채워진다
  assert.deepEqual(Object.keys(bundle8Patch).sort(), ['checkboxLabel', 'confirmNotice', 'detailRefundNotice', 'partialRefundConfirmNotice', 'refundDays', 'refundExpiredReason'])
  const view = policyServer.toMarketPurchasePolicyView(policyLib.parseMarketPurchasePolicy(initialPolicy))
  assert.equal(view.refundDays, 30)
  assert.match(view.checkboxLabel, /구매일 다음 날부터 30일째 되는 날까지/)
  assert.equal(policyLib.MARKET_PURCHASE_POLICY_TEXT_KEYS.length, 8)
  assert.equal(policyLib.fillMarketRefundDays('{자료환불기간}일·{자료환불기간}일', 7), '7일·7일')
  for (const key of policyLib.MARKET_PURCHASE_POLICY_TEXT_KEYS) {
    assert.doesNotMatch(view[key], /[{}]/, key)
  }
  // SQL 과 같은 규칙: 줄바꿈 하나로 잇는다
  assert.match(migration, /v_text := v_label \|\| chr\(10\) \|\| v_notice;/)
  assert.match(read('src/lib/market-purchase-policy.ts'), /return `\$\{checkboxLabel\}\\n\$\{confirmNotice\}`/)
})

test('설정 해석: refundDays 는 1~3650 정수(DB 함수와 같은 범위), 문구가 비면 null', () => {
  const ok = (refundDays) => policyLib.parseMarketPurchasePolicy({ ...initialPolicy, refundDays })
  assert.equal(ok(7)?.refundDays, 7)
  assert.equal(ok(3650)?.refundDays, 3650)
  for (const bad of ['7', 0, -1, 7.5, 3651, null]) assert.equal(ok(bad), null, String(bad))
  assert.equal(policyLib.parseMarketPurchasePolicy({ ...initialPolicy, confirmNotice: '  ' }), null)
  assert.equal(policyLib.parseMarketPurchasePolicy({ ...initialPolicy, checkboxLabel: null }), null)
  assert.match(migration, /v_days_numeric <> trunc\(v_days_numeric\) OR v_days_numeric <= 0 OR v_days_numeric > 3650/)
  assert.equal(policyLib.MARKET_REFUND_DAYS_MAX, 3650)
})

test('관리자 저장 검사: 자리표시 외 중괄호 거부, 세 문구는 {자료환불기간} 필수·숫자+일 거부', () => {
  const texts = Object.fromEntries(policyLib.MARKET_PURCHASE_POLICY_TEXT_KEYS.map((key) => [key, initialPolicy[key]]))
  assert.equal(policyLib.validateMarketPurchasePolicyTexts(texts), null)
  assert.match(policyLib.validateMarketPurchasePolicyTexts({ ...texts, confirmNotice: '{환불기간} 안내' }), /중괄호/)
  assert.match(policyLib.validateMarketPurchasePolicyTexts({ ...texts, refundExpiredReason: '구매 후 7일이 지난 자료' }), /\{자료환불기간\}/)
  assert.match(policyLib.validateMarketPurchasePolicyTexts({ ...texts, checkboxLabel: '{자료환불기간}일 또는 7일' }), /숫자/)
  assert.match(policyLib.validateMarketPurchasePolicyTexts({ ...texts, usageScopeNotice: '' }), /입력/)
  assert.equal(policyLib.normalizeMarketPurchasePolicyText('  가\r\n나  '), '가\n나')
})

test('구매 API: 장바구니만 고지 체크·지문 필수, 기록은 판매 중지 검사 뒤 결제 바로 앞, 상세 바로 구매는 410(11번)', () => {
  const direct = read('src/app/api/market/items/[itemId]/purchase/route.ts')
  const route = read('src/app/api/market/cart/checkout/route.ts')
  assert.match(route, /acknowledgePurchaseNotice: z\.boolean\(/)
  assert.match(route, /noticeSha256: z\.string\(\{ error: [^}]+\}\)\.regex\(\/\^\[0-9a-f\]\{64\}\$\//)
  // 배포 전에 열어 둔 탭(새 필드 없음)은 새로고침 안내로 400
  assert.match(route, /화면을 새로고침한 뒤 다시 구매해 주세요/)
  const ackAt = route.indexOf('checkPurchaseNoticeAcknowledged(parsed.data.acknowledgePurchaseNotice)')
  const killAt = route.indexOf('isMarketV2PurchaseEnabled()')
  const recordAt = route.indexOf('await enforcePurchaseNoticeAck({')
  const checkoutAt = route.indexOf('await runMarketCheckout({')
  assert.ok(route.indexOf('.safeParse(') < ackAt && ackAt < killAt && killAt < recordAt && recordAt < checkoutAt)
  // 11번 7절: 상세 바로 구매 route 는 410 만 남고 동의 기록·결제 RPC 를 부르지 않는다
  assert.match(direct, /status: 410/)
  assert.match(direct, /MARKET_DIRECT_PURCHASE_CLOSED/)
  assert.doesNotMatch(direct, /enforcePurchaseNoticeAck|runMarketCheckout|rpc\(/)
})

test('기록 결과 대응: CHANGED·KEY_CONFLICT → 409(details 는 DB 함수 값), 입력 오류 → 400, 그 밖 → 503(결제 안 함)', async () => {
  const server = read('src/lib/market-purchase-policy-server.ts')
  // 11번: 1판 고지·2판 묶음·장바구니 문구를 새 해석기로 나눠 읽는다(그 밖의 모양은 null)
  assert.match(server, /case 'NOTICE_CHANGED':\n\s+case 'NOTICE_KEY_CONFLICT':\n\s+return \{\n\s+status: 'changed',\n\s+notice: parseMarketPurchaseNotice\(result\.details\),\n\s+consent: parseCheckoutConsentBundle\(result\.details\),\n\s+cartTexts: parseMarketCartTexts\(result\.cartTexts\),/)
  assert.match(server, /case 'NOTICE_INPUT_INVALID':\n\s+return \{ status: 'invalid' \}/)
  const block = between(server, 'export async function enforcePurchaseNoticeAck', '// 관리자 저장')
  assert.match(block, /status: 409,\n\s+code: 'PURCHASE_NOTICE_CHANGED'/)
  assert.match(block, /status: 400, code: 'INVALID_INPUT'/)
  assert.match(block, /status: 503,\n\s+code: 'PURCHASE_NOTICE_UNAVAILABLE'/)
  assert.equal(policyServer.checkPurchaseNoticeAcknowledged(false).code, 'PURCHASE_NOTICE_ACK_REQUIRED')
  assert.equal(policyServer.checkPurchaseNoticeAcknowledged(true), null)
  // details 형식이 틀리면 null(화면은 확인창을 닫고 새로고침)
  assert.equal(policyLib.parseMarketPurchaseNotice({ checkboxLabel: 'a', confirmNotice: 'b', noticeSha256: 'XYZ', refundDays: 7 }), null)
})

// 11번: 상세 구매하기와 구매 확인창(market-checkout-confirm-dialog)은 없앴다. 장바구니 결제 칸의 동의 수명·응답 처리는 bundle11-cart-* 시험.
test('화면: 상세는 구매하지 않고, 장바구니 결제 칸은 받은 지문 사본을 그대로 보낸다', () => {
  const detail = read('src/components/market/market-item-actions.tsx')
  assert.doesNotMatch(detail, /noticeSha256|acknowledgePurchaseNotice|items\/\$\{itemId\}\/purchase/)
  const panel = read('src/lib/cart-checkout-panel.ts')
  // 화면은 지문을 계산하지 않는다(사본 값을 그대로 보냄)
  assert.doesNotMatch(panel, /createHash|crypto\.subtle|sha256\(/)
  assert.match(panel, /cartTextsSha256/)
  assert.match(panel, /noticeSha256/)
})

test('고지 문구는 코드에 없다(확인창·상세 블록·구매 영역·환불 판정)', () => {
  const sources = [
    'src/components/market/market-purchase-info-section.tsx',
    'src/components/market/market-item-actions.tsx',
    'src/app/(solvook)/cart/_components/cart-view.tsx',
    'src/lib/market-refunds.ts',
  ].map((path) => [path, read(path)])
  for (const [path, source] of sources) {
    assert.doesNotMatch(source, /단순 변심|기간·횟수 제한 없이|재판매|구매 후 바로 다운로드할 수 있으며/, path)
  }
  const refunds = read('src/lib/market-refunds.ts')
  assert.doesNotMatch(refunds, /7일|addDays\([^)]*, 7\)/)
})

test('환불 판정: 기간은 인자로 받은 DB 값, 보관함은 요청당 한 번(캐시), 신청·승인은 캐시 없이·못 읽으면 503', () => {
  const refunds = read('src/lib/market-refunds.ts')
  const judge = between(refunds, 'export async function getMarketRefundEligibility', 'export async function hasPendingMarketRefundRequestForTarget')
  assert.doesNotMatch(judge, /readMarketRefundPolicyUncached|getMarketRefundPolicyCached|system_settings/)
  // 정책 없이도 정해지는 상태(요청 있음·미완료·다운로드)가 먼저, 기간 판정이 필요할 때만 unavailable
  assert.ok(judge.indexOf('downloadCount > 0') < judge.indexOf("status = 'unavailable'"))
  const request = between(refunds, 'export async function requestMarketRefund', 'export async function listMarketRefundRequestsForAdmin')
  assert.match(request, /await readMarketRefundPolicyUncached\(\)\n\s+if \(!refundPolicy\) \{\n\s+throw new MarketRefundPolicyUnavailableError\(\)/)
  const approve = between(refunds, 'export async function approveMarketRefund', 'export async function rejectMarketRefund')
  assert.match(approve, /await readMarketRefundPolicyUncached\(\)/)
  assert.match(approve, /judgeAt: requestedAt,/)
  assert.ok(approve.indexOf('readMarketRefundPolicyUncached') < approve.indexOf("rpc('approve_market_refund'"))

  const items = read('src/lib/market-items-server.ts')
  assert.match(items, /const refundPolicy = await getMarketRefundPolicyCached\(\)\n\s+const refundTargetEntries = await Promise\.all/)
  // 8번: v2 주문 판정은 업그레이드 주문 대기 중 허용(allowPendingUpgradeRefund) 줄이 사이에 낀다
  assert.equal((items.match(/\n\s+refundPolicy,\n(?:\s+\/\/[^\n]*\n\s+allowPendingUpgradeRefund: true,\n)?\s+preloaded: \{/g) ?? []).length, 2)

  const memberRoute = read('src/app/api/market/refunds/route.ts')
  assert.match(memberRoute, /error\.name === 'REFUND_POLICY_UNAVAILABLE'[\s\S]+status: 503/)
  assert.doesNotMatch(memberRoute, /message\.includes\('다운로드'\)/)
  const adminRoute = read('src/app/api/admin/market/refunds/[id]/route.ts')
  assert.match(adminRoute, /error\.name === 'REFUND_POLICY_UNAVAILABLE'[\s\S]+code: 'REFUND_POLICY_UNAVAILABLE',\n\s+\}, \{ status: 503 \}/)
})

test('상품 상세: 구매 전 확인 블록은 DB 문구·하단 정보의 약관 링크를 쓴다(공급자·파일 형식 줄 없음)', () => {
  const page = read('src/app/(solvook)/items/[itemId]/page.tsx')
  assert.match(page, /getMarketPurchasePolicyView\(\),\n\s+getSiteFooterContent\(\),\n\s+\]\)/)
  assert.match(page, /purchaseInfo=\{buildMarketPurchaseInfo\(footerContent\)\}/)
  const section = read('src/components/market/market-purchase-info-section.tsx')
  for (const field of ['downloadPeriodNotice', 'usageScopeNotice', 'detailRefundNotice']) {
    assert.match(section, new RegExp(`\\{policy\\.${field}\\}`))
  }
  // 공급자는 하단 정보(footer)에, 파일 형식은 자료 선택에 있어 이 블록에서 뺐다
  assert.doesNotMatch(section, /supplierRows|fileType|label: '공급자'|label: '파일 형식'/)
  const info = read('src/lib/market-purchase-info.ts')
  assert.match(info, /getVisibleFooterPolicyLinks\(footer\)/)
  assert.doesNotMatch(info, /supplierRows/)
  const items = read('src/lib/market-items-server.ts')
  // 필요 프로그램은 회원 화면에서 뺐다 — 상품 조회가 그 열을 읽지 않는다
  assert.match(items, /\.select\('id, code, label, extension'\)/)
  assert.doesNotMatch(items, /required_program|requiredProgram/)
  // 부가 모듈(하단 정보 기본 약관 본문)이 브라우저 번들로 가지 않게 결제 칸 1판 동의 부품은 타입만 가져온다
  assert.match(read('src/components/checkout/market-legacy-consent.tsx'), /import type \{ MarketPurchaseLink/)
  assert.doesNotMatch(read('src/components/market/market-item-actions.tsx'), /from '@\/lib\/market-purchase-info'/)
})

test('관리자: 구매 고지 저장은 site.manage·작업 기록·캐시 즉시 무효화, 환불 기간·version 은 DB 값 유지', () => {
  const action = read('src/app/(admin)/admin/footer/purchase-policy-actions.ts')
  assert.match(action, /assertAdminActionPermission\('site\.manage'\)/)
  assert.match(action, /action: 'market_purchase_policy_update'/)
  assert.match(action, /validateMarketPurchasePolicyTexts\(/)
  assert.doesNotMatch(action, /refundDays: input|input\.refundDays/)
  const server = read('src/lib/market-purchase-policy-server.ts')
  // 8번: 읽은 원본 jsonb 위에 문구만 덮고(모르는 키·refundDays 보존), 그사이 기간이 바뀌었으면 저장하지 않는다.
  // 11번 9절: 자료도 낙관적 잠금(version 대조 + 1), 판(consentFormat)은 입력으로 받지 않고 원본 값 그대로.
  assert.match(server, /const after: Record<string, Json> = \{\n\s+\.\.\.before,\n\s+\.\.\.input\.texts,/)
  assert.match(server, /version: nextVersion,/)
  assert.match(server, /if \(current\.version !== input\.expectedVersion\)/)
  assert.match(server, /if \(Object\.hasOwn\(before, 'consentFormat'\)\) after\.consentFormat = before\.consentFormat/)
  assert.match(server, /\.update\(\{ value: after as unknown as Json/)
  assert.match(server, /\.eq\('value->>refundDays', String\(current\.refundDays\)\)/)
  assert.match(server, /revalidateTag\(MARKET_PURCHASE_POLICY_SETTING_KEY, \{ expire: 0 \}\)/)
  const form = read('src/app/(admin)/admin/footer/purchase-policy-form.tsx')
  assert.match(form, /useUnsavedChangesGuard\(hasChanges\)/)
  assert.match(read('src/app/(admin)/admin/footer/page.tsx'), /<PurchasePolicyForm initial=\{purchasePolicy\} \/>/)
  assert.match(read('src/lib/admin-audit-log.ts'), /market_purchase_policy_update: /)
})

test('파일 유형: 필요 프로그램 칸은 없앴고(DB 열만 남음), 수정은 작업 기록을 남긴다', () => {
  const post = read('src/app/api/admin/market/file-types/route.ts')
  const patch = read('src/app/api/admin/market/file-types/[id]/route.ts')
  for (const source of [post, patch, read('src/app/(admin)/admin/market/product-settings/taxonomy-tab.tsx')]) {
    assert.doesNotMatch(source, /requiredProgram|required_program|필요 프로그램/)
  }
  assert.match(patch, /action: 'market_file_type_update'/)
  assert.match(read('src/lib/admin-audit-log.ts'), /market_file_type_update: /)
})

test('마이그레이션: 첫 값 6행 필요 프로그램, 결제·환불 RPC 는 그대로, 함수는 service_role 만', () => {
  assert.match(migration, /WHERE workspace_subject IN \('korean', 'english'\)\n\s+AND code IN \('pdf', 'hwp', 'zip'\)/)
  assert.match(migration, /IF v_count <> 6 THEN\n\s+RAISE EXCEPTION 'VERIFY: required_program rows = %'/)
  assert.match(migration, /md5\(pg_get_functiondef\('public\.checkout_market_selection\(uuid,text,uuid,jsonb,uuid\)'::regprocedure\)\)/)
  assert.match(migration, /md5\(pg_get_functiondef\('public\.approve_market_refund\(uuid,uuid,text,integer\)'::regprocedure\)\)/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_purchase_notice_ack\(uuid, uuid, text\) TO service_role;/)
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.record_purchase_notice_ack\(uuid, uuid, text\) TO (anon|authenticated)/)
  assert.equal(bundle7Policy.refundDays, 7)
  assert.equal(Object.keys(bundle7Policy).length, 9)
  // 8번 뒤: 키 10개(문구 8 + refundDays + version)
  assert.equal(Object.keys(initialPolicy).length, 10)
})
