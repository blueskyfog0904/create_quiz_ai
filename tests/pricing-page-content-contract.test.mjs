import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  PRICING_PAGE_CONTENT_SETTING_KEY,
  fillPricingPagePlaceholders,
  normalizePricingPageContent,
  parsePricingPageContent,
} from '../src/lib/pricing-page-content.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const MIGRATION = read('supabase/migrations/20261119100000_pricing_page_content.sql')
const DOWN = read('supabase/rollback/20261119100000_pricing_page_content_down.sql')
const page = read('src/app/pricing/page.tsx')
const client = read('src/app/pricing/pricing-client.tsx')
const server = read('src/lib/pricing-page-content-server.ts')
const actions = read('src/app/(admin)/admin/pricing/actions.ts')
const adminPage = read('src/app/(admin)/admin/pricing/page.tsx')
const form = read('src/app/(admin)/admin/pricing/pricing-page-content-form.tsx')

const seedJson = () => JSON.parse(MIGRATION.match(/\$json\$([\s\S]*?)\$json\$/)[1])

test('마이그레이션은 지금 화면 문구를 pricing_page_content 한 행으로 넣고, 이미 있으면 건드리지 않는다', () => {
  assert.equal(PRICING_PAGE_CONTENT_SETTING_KEY, 'pricing_page_content')
  assert.match(MIGRATION, /INSERT INTO public\.system_settings \(key, value, description, updated_at\)/)
  assert.match(MIGRATION, /'pricing_page_content',\s+\$json\$/)
  assert.match(MIGRATION, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.doesNotMatch(MIGRATION, /CREATE POLICY|ALTER TABLE|GRANT|DROP/i)
  assert.match(DOWN, /DELETE FROM public\.system_settings WHERE key = 'pricing_page_content';/)
})

test('처음 문구는 저장 검사를 통과하고, 정책 숫자는 자리표시로만 쓴다', () => {
  const seed = seedJson()
  assert.deepEqual(normalizePricingPageContent(seed), seed)
  const all = JSON.stringify(seed)
  for (const placeholder of ['{사용기한}', '{환불기간}', '{충전한도}', '{최대보너스}']) {
    assert.ok(all.includes(placeholder), placeholder)
  }
  assert.doesNotMatch(all, /\d+년|\d+일 이내|100,000원/)
  assert.equal(seed.refund_items.length, 6)
  assert.equal(seed.notice_items.length, 3)
})

test('자리표시는 실제 값으로 바뀌고, 모르는 중괄호는 그대로 둔다', () => {
  const values = { '{사용기한}': '1', '{환불기간}': '7', '{충전한도}': '100,000원', '{최대보너스}': '30' }
  assert.equal(fillPricingPagePlaceholders('사용 기한 {사용기한}년, {환불기간}일, {충전한도}, {최대보너스}%', values), '사용 기한 1년, 7일, 100,000원, 30%')
  assert.equal(fillPricingPagePlaceholders('{사용기한}{사용기한} {모름}', values), '11 {모름}')
})

test('저장 검사: 앞뒤 공백·빈 항목 정리, 필수·길이·개수는 한국어 오류', () => {
  const base = seedJson()
  const tidy = normalizePricingPageContent({
    ...base,
    banner_title: '  제목  ',
    notice_items: [...base.notice_items, { title: ' ', body: '' }],
    refund_items: [...base.refund_items, '   '],
  })
  assert.equal(tidy.banner_title, '제목')
  assert.equal(tidy.notice_items.length, 3)
  assert.equal(tidy.refund_items.length, 6)

  assert.throws(() => normalizePricingPageContent({ ...base, banner_title: ' ' }), /배너 제목.*입력해 주세요/)
  assert.throws(() => normalizePricingPageContent({ ...base, guest_balance_text: 'x'.repeat(121) }), /120자 이하/)
  assert.throws(() => normalizePricingPageContent({ ...base, refund_items: [] }), /환불 정책을 1줄 이상/)
  assert.throws(() => normalizePricingPageContent({ ...base, notice_items: [{ title: '제목만', body: '' }] }), /제목과 내용을 함께/)
  assert.throws(() => normalizePricingPageContent({ ...base, refund_items: Array(13).fill('줄') }), /12줄까지/)
  assert.throws(() => normalizePricingPageContent(null), /형식이 올바르지 않습니다/)
  // 자리표시 오타는 저장하지 않는다
  assert.throws(() => normalizePricingPageContent({ ...base, summary_note: '사용 기한 {사용 기한}년' }), /\{사용 기한\}는 쓸 수 없는 자리표시/)
  assert.throws(
    () => normalizePricingPageContent({ ...base, notice_items: [{ title: '기한', body: '{기간}' }] }),
    /확인 사항 1번 내용의 \{기간\}는 쓸 수 없는 자리표시/
  )
  // 읽을 때는 화면을 깨지 않도록 null
  assert.equal(parsePricingPageContent({ banner_title: 1 }), null)
  assert.equal(parsePricingPageContent(undefined), null)
})

test('읽기·저장은 서버 키로 이 키 한 줄만, 실패하면 null(문구 영역을 그리지 않음)', () => {
  assert.match(server, /^import 'server-only'/)
  assert.match(server, /\.eq\('key', PRICING_PAGE_CONTENT_SETTING_KEY\)/)
  assert.match(server, /return parsePricingPageContent\(data\?\.value\)/)
  assert.match(server, /const content = normalizePricingPageContent\(input\)/)
  assert.match(server, /\.upsert\([\s\S]{0,200}key: PRICING_PAGE_CONTENT_SETTING_KEY[\s\S]{0,300}onConflict: 'key'/)
})

test('관리자 저장은 pricing.manage 권한 검사 뒤 저장하고 작업 기록을 남긴다', () => {
  const body = actions.slice(actions.indexOf('export async function savePricingPageContentAction'))
  assert.ok(body.indexOf("assertAdminActionPermission('pricing.manage')") < body.indexOf('savePricingPageContent(input)'))
  assert.ok(body.indexOf('savePricingPageContent(input)') < body.indexOf("action: 'pricing_page_content_update'"))
  assert.match(body, /revalidatePath\('\/pricing'\)/)
  // 운영 빌드에서도 검사 오류 문구가 보이도록 결과 값으로 돌려준다
  assert.match(body, /return \{ success: false, error: error instanceof Error \? error\.message/)
  assert.match(form, /if \(!result\.success\) \{\s+toast\.error\(result\.error\)/)
  // 쓰지 않는 공개 읽기 액션은 두지 않는다
  assert.doesNotMatch(actions, /getPricingPageContentForAdmin/)
  // 관리자 화면은 "행 없음"과 "읽기 실패"를 구분하고, 읽기 실패면 저장을 막는다(빈 양식으로 덮어쓰기 방지)
  assert.match(adminPage, /<PricingPageContentForm initial=\{await readPricingPageContentForAdmin\(\)\} \/>/)
  assert.ok(adminPage.indexOf("requireAdminPagePermission('pricing.manage')") < adminPage.indexOf('readPricingPageContentForAdmin()'))
  assert.match(server, /if \(!data\) return \{ status: 'missing' \}/)
  assert.match(server, /return \{ status: 'error' \}/)
  // 형식이 깨진 행은 화면에서 다시 저장해 고칠 수 있다(저장을 막지 않음)
  assert.match(server, /return content \? \{ status: 'ok', content \} : \{ status: 'invalid' \}/)
  assert.match(form, /initial\.status === 'invalid'/)
  assert.match(form, /const readFailed = initial\.status === 'error'/)
  assert.match(form, /saveDisabled=\{saving \|\| readFailed\}/)
  assert.match(form, /savePricingPageContentAction\(content\)/)
  // 관리자 화면에도 기본 문구를 두지 않는다(빈 틀만)
  assert.match(form, /banner_title: '',/)
})

test('충전 화면은 설정 문구를 정책 값으로 채워 그리고, 환불 정책은 접지 않는다', () => {
  assert.match(page, /const content = await getPricingPageContent\(\)/)
  assert.match(page, /'\{최대보너스\}': String\(maxBonusPercent\)/)
  assert.match(page, /maxBonusPercent > 0 \? content\.banner_title : content\.banner_title_no_bonus/)
  // 9번: {환불기간} 이 든 줄은 충전 정책 설정을 못 읽으면 걸러 낸 뒤 그린다.
  assert.match(page, /const refundItems = content \? content\.refund_items\.filter\(shows\) : \[\]/)
  assert.match(page, /refundItems\.map/)
  assert.match(page, /noticeItems\.map/)
  assert.doesNotMatch(page, /<details|<summary/)
  assert.doesNotMatch(page + client, /자세히 보기/)
  // 문구는 코드에 두지 않는다
  for (const text of ['결제 전에 확인해 주세요', '많이 충전할수록', '로그인하면 보유 크레딧', '문제마켓 이용에 쓰는 선불']) {
    assert.ok(!page.includes(text) && !client.includes(text), text)
  }
  assert.match(client, /\{copy && \(/)
  // 문구 목록은 문구가 있을 때만, 약관·내역 링크는 문구가 없어도 보인다(문구 블록 뒤)
  assert.match(page, /\{content && \(\s+<>/)
  assert.ok(page.indexOf('refundItems.map') < page.indexOf('href="/terms/refund"'))
  assert.ok(page.indexOf('href="/terms/refund"') < page.indexOf('</section>'))
})

test('문구(환불 정책 포함)를 읽지 못하면 결제 버튼을 막는다(PC 버튼·모바일 하단 바 모두)', () => {
  assert.match(client, /const purchaseBlocked = copy === null/)
  assert.match(client, /if \(!selected \|\| purchaseBlocked\) return/)
  assert.match(client, /disabled=\{!selected \|\| purchaseBlocked\}/)
  assert.match(client, /onClick=\{handlePurchase\} disabled=\{purchaseBlocked\}/)
  assert.match(client, /role="alert"[\s\S]{0,300}결제할 수 없습니다/)
})

test('상품 설명은 60자까지(입력 칸·서버 모두), 보너스 없는 상품도 크레딧 수를 보인다', () => {
  const dialog = read('src/app/(admin)/admin/pricing/components/pricing-plan-dialog.tsx')
  assert.match(dialog, /maxLength=\{PRICING_PLAN_DESCRIPTION_MAX_LENGTH\}/)
  assert.match(actions, /description\.length > PRICING_PLAN_DESCRIPTION_MAX_LENGTH/)
  assert.match(actions, /\.upsert\(\{ \.\.\.data, description, badge_text/)
  assert.match(client, /\{bonus \? \([\s\S]{0,300}\+\{formatNumber\(bonus\.credits\)\} 크레딧[\s\S]{0,200}\) : \([\s\S]{0,300}\{formatNumber\(plan\.credits\)\} 크레딧/)
})
