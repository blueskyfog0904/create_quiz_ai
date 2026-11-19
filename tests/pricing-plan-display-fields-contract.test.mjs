import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

import {
  PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH,
  getChargePlanBonus,
  normalizePricingPlanDisplayText,
} from '../src/lib/pricing-plan-display.ts'

const url = (path) => new URL(`../${path}`, import.meta.url)
const read = (path) => readFileSync(url(path), 'utf8')

const MIGRATION = 'supabase/migrations/20261117100000_pricing_plan_display_fields.sql'
const DOWN = 'supabase/rollback/20261117100000_pricing_plan_display_fields_down.sql'
const migration = read(MIGRATION)
const pricingClient = read('src/app/pricing/pricing-client.tsx')
const pricingPage = read('src/app/pricing/page.tsx')
const actions = read('src/app/(admin)/admin/pricing/actions.ts')
const dialog = read('src/app/(admin)/admin/pricing/components/pricing-plan-dialog.tsx')
const adminList = read('src/app/(admin)/admin/pricing/pricing-plans-client.tsx')
const types = read('src/types/supabase.ts')

test('마이그레이션이 표시용 열 3개와 CHECK를 더하고, 되돌리기 파일이 있다', () => {
  assert.match(migration, /ADD COLUMN badge_text text,/)
  assert.match(migration, /ADD COLUMN is_highlighted boolean NOT NULL DEFAULT false,/)
  assert.match(migration, /ADD COLUMN discount_text text,/)
  for (const column of ['badge_text', 'discount_text']) {
    assert.match(
      migration,
      new RegExp(
        `CONSTRAINT pricing_plans_${column}_check\\s+CHECK \\(${column} IS NULL OR \\(char_length\\(${column}\\) BETWEEN 1 AND 20 AND ${column} !~ '\\^\\\\s\\|\\\\s\\$'\\)\\)`
      )
    )
    assert.match(migration, new RegExp(`COMMENT ON COLUMN public\\.pricing_plans\\.${column} IS`))
  }
  assert.match(migration, /COMMENT ON COLUMN public\.pricing_plans\.is_highlighted IS/)
  assert.match(migration, /SET LOCAL lock_timeout = '3s';/)
  assert.match(migration, /NOTIFY pgrst, 'reload schema';\s*$/)

  assert.ok(existsSync(url(DOWN)), '되돌리기 파일이 있다')
  const down = read(DOWN)
  for (const column of ['badge_text', 'is_highlighted', 'discount_text']) {
    assert.match(down, new RegExp(`DROP COLUMN ${column}\\b`))
  }
  assert.match(down, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('초기값은 특정 id가 아니라 조건으로 넣고, 할인 문구는 비워 둔다', () => {
  assert.match(migration, /SET badge_text = '가장 인기',\s+is_highlighted = true\s+WHERE name = 'Basic';/)
  assert.match(migration, /SET badge_text = '최고 가성비'\s+WHERE is_active IS TRUE\s+AND badge_text IS NULL/)
  assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  assert.doesNotMatch(migration, /SET[^;]*discount_text\s*=/)
})

test('타입 파일의 pricing_plans에 새 열이 Row·Insert·Update 모두 있다', () => {
  const start = types.indexOf('      pricing_plans: {')
  const block = types.slice(start, types.indexOf('Relationships: []', start))
  for (const column of ['badge_text', 'is_highlighted', 'discount_text']) {
    assert.equal(block.split(`${column}`).length - 1, 3, column)
  }
})

test('회원 충전 상품 화면은 이름 비교·자동 계산 없이 DB 값으로만 그린다', () => {
  assert.doesNotMatch(pricingClient, /plan\.name ===/)
  assert.doesNotMatch(pricingClient, /우선 고객 지원/)
  assert.doesNotMatch(pricingClient, /% 할인/)
  // 다른 상품과 비교한 할인율은 만들지 않는다. 보너스는 각 상품의 금액·크레딧만으로 계산한다(2026-11-19 결정).
  assert.doesNotMatch(pricingClient, /savingsPercent|lowestPricePerCredit/)
  assert.doesNotMatch(pricingClient, /가장 인기|최고 가성비/)
  assert.match(pricingClient, /getChargePlanBonus\(plan\.price, plan\.credits\)/)

  assert.match(pricingClient, /const highlighted = plan\.is_highlighted === true/)
  // 배지 글자는 DB 값 그대로, 색과 이모지는 강조 여부(is_highlighted)로만 고른다(글자 비교 없음).
  assert.match(pricingClient, /\{plan\.badge_text && \([\s\S]{0,1500}\{plan\.badge_text\}/)
  assert.match(pricingClient, /\$\{highlighted\s+\? 'bg-\[var\(--studio-highlight-soft\)\]/)
  assert.match(pricingClient, /highlighted \? '\/emoji\/fire_3d\.png' : '\/emoji\/gem_stone_3d\.png'/)
  assert.doesNotMatch(pricingClient, /badge_text ===|badge_text\.includes/)
  assert.match(pricingClient, /\{plan\.discount_text && \([\s\S]{0,240}\{plan\.discount_text\}/)
  // 사이트 공통 색(studio 토큰)만 쓴다. 예전 기본 파랑·초록·반짝이 아이콘은 쓰지 않는다.
  assert.doesNotMatch(pricingClient, /bg-blue-|bg-green-|Sparkles|scale-105/)

  assert.match(pricingClient, /문제마켓 이용/)
  assert.match(pricingClient, /사용 기한 \{POINT_CHARGE_VALIDITY_YEARS\}년/)

  // 새 열이 아직 없는 응답(undefined)도 받을 수 있게 선택 항목이다.
  assert.match(pricingClient, /badge_text\?: string \| null/)
  assert.match(pricingClient, /is_highlighted\?: boolean/)
  assert.match(pricingClient, /discount_text\?: string \| null/)
  assert.match(pricingPage, /\.from\('pricing_plans'\)\s+\.select\('\*'\)/)
})

test('배지·할인 문구는 앞뒤 공백을 떼고, 비면 null, 20자를 넘으면 한국어 오류', () => {
  assert.equal(PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH, 20)
  assert.equal(normalizePricingPlanDisplayText('  가장 인기  ', '배지 문구'), '가장 인기')
  assert.equal(normalizePricingPlanDisplayText('', '배지 문구'), null)
  assert.equal(normalizePricingPlanDisplayText('   \n\t', '배지 문구'), null)
  assert.equal(normalizePricingPlanDisplayText(null, '배지 문구'), null)
  assert.equal(normalizePricingPlanDisplayText(undefined, '배지 문구'), null)
  assert.equal(normalizePricingPlanDisplayText('가'.repeat(20), '배지 문구'), '가'.repeat(20))
  assert.equal(normalizePricingPlanDisplayText(` ${'가'.repeat(20)} `, '배지 문구'), '가'.repeat(20))
  assert.throws(() => normalizePricingPlanDisplayText('가'.repeat(21), '배지 문구'), /배지 문구는 20자 이하여야 합니다\./)
  assert.throws(
    () => normalizePricingPlanDisplayText('가'.repeat(21), '할인·혜택 문구'),
    /할인·혜택 문구는 20자 이하여야 합니다\./
  )
  assert.throws(() => normalizePricingPlanDisplayText(123, '배지 문구'), /배지 문구는 글자로 입력해 주세요\./)
})

test('서버 액션은 접근 검사·가격 검증 뒤에 문구를 정리해서 저장한다', () => {
  const upsertAction = actions.indexOf('export async function upsertPricingPlan(')
  const adminCheck = actions.indexOf("await assertAdminActionPermission('pricing.manage')", upsertAction)
  const priceCheck = actions.indexOf('data.price < MIN_POINT_CHARGE_AMOUNT')
  const normalize = actions.indexOf("normalizePricingPlanDisplayText(data.badge_text, '배지 문구')")
  const upsert = actions.indexOf('.upsert({ ...data, badge_text: badgeText, discount_text: discountText })')
  assert.ok(adminCheck > 0 && adminCheck < priceCheck && priceCheck < normalize && normalize < upsert)
  assert.match(actions, /normalizePricingPlanDisplayText\(data\.discount_text, '할인·혜택 문구'\)/)
})

test('관리자 화면에서 세 항목을 입력하고 목록에서 볼 수 있다', () => {
  for (const id of ['badge_text', 'is_highlighted', 'discount_text']) {
    assert.match(dialog, new RegExp(`id="${id}"`))
  }
  assert.equal(dialog.split('maxLength={PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH}').length - 1, 2)
  assert.equal(dialog.split('회원 충전 상품 화면').length - 1, 3)
  assert.match(dialog, /badge_text: formData\.badge_text,\s+is_highlighted: formData\.is_highlighted \?\? false,\s+discount_text: formData\.discount_text,/)
  assert.match(adminList, /화면 표시/)
  assert.match(adminList, /plan\.badge_text \|\| '없음'/)
  assert.match(adminList, /plan\.is_highlighted \? '예' : '아니오'/)
  assert.match(adminList, /plan\.discount_text \|\| '없음'/)
})

test('보너스 크레딧은 1원 = 1크레딧 기준으로 금액보다 더 받는 만큼, 비율은 내림 정수', () => {
  assert.deepEqual(getChargePlanBonus(9900, 10000), { credits: 100, percent: 1 })
  assert.deepEqual(getChargePlanBonus(29900, 33000), { credits: 3100, percent: 10 })
  assert.deepEqual(getChargePlanBonus(49900, 65000), { credits: 15100, percent: 30 })
  // 금액보다 적거나 같으면 보너스가 없다
  assert.equal(getChargePlanBonus(1000, 100), null)
  assert.equal(getChargePlanBonus(10000, 10000), null)
  // 잘못된 값
  assert.equal(getChargePlanBonus(0, 100), null)
  assert.equal(getChargePlanBonus(Number.NaN, 100), null)
})
