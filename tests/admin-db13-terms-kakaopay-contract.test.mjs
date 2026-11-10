import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const migration = read('../supabase/migrations/20261110116000_terms_remove_kakaopay.sql')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const rollback = read('../supabase/rollback/20261110116000_terms_remove_kakaopay_down.sql')
const before = readFileSync(new URL('../supabase/rollback/20261110116000_terms_remove_kakaopay_before.json', import.meta.url))
const footerDefaults = read('../src/lib/footer-content.ts')
const termsPage = read('../src/app/terms/[documentSlug]/page.tsx')

const md5 = (text) => createHash('md5').update(text).digest('hex')
const count = (text, part) => text.split(part).length - 1

// SQL 문자열 상수(|| 로 이어 붙인 조각 포함)를 하나의 문자열로 읽는다.
function constant(sql, name) {
  const match = sql.match(new RegExp(`${name} constant text :=([\\s\\S]*?);\\n`))
  assert.ok(match, `${name} is declared`)
  return [...match[1].matchAll(/E?'((?:[^']|'')*)'/g)]
    .map(([, value]) => value.replace(/''/g, "'").replace(/\\n/g, '\n'))
    .join('')
}

const PAIRS = [
  ['refundPolicy', 'c_refund_pg_old', 'c_refund_pg_new'],
  ['refundPolicy', 'c_refund_methods_old', 'c_refund_methods_new'],
  ['privacyPolicy', 'c_privacy_old', 'c_privacy_new'],
]

// 마이그레이션이 DB에서 하는 치환을 적용 전 원문에 그대로 해 본다.
function applyMigration(value) {
  const next = structuredClone(value)
  for (const [doc, oldName, newName] of PAIRS) {
    const content = next.policyDocuments[doc].content
    assert.equal(count(content, constant(migration, oldName)), 1, oldName)
    next.policyDocuments[doc].content = content.replace(constant(migration, oldName), constant(migration, newName))
  }
  return next
}

test('the before snapshot matches the md5 guard of the migration and the rollback', () => {
  const expected = migration.match(/c_expected_md5 constant text := '([0-9a-f]{32})'/)?.[1]
  assert.equal(md5(before), expected)
  assert.equal(rollback.match(/c_original_md5 constant text := '([0-9a-f]{32})'/)?.[1], expected)
  assert.doesNotThrow(() => JSON.parse(before.toString('utf8')))
})

test('migration removes every kakaopay mention and keeps kakao login and other content', () => {
  const value = JSON.parse(before.toString('utf8'))
  const after = applyMigration(value)
  const text = JSON.stringify(after)

  assert.equal(count(JSON.stringify(value), '카카오페이'), 4)
  assert.equal(count(text, '카카오페이'), 0)
  assert.equal(count(text, '카카오 로그인'), count(JSON.stringify(value), '카카오 로그인'))
  assert.match(after.policyDocuments.privacyPolicy.content, /\(주\)유디아이디\(페이앱\)[^\n]*\n- OpenAI/)

  for (const doc of ['refundPolicy', 'privacyPolicy']) {
    delete value.policyDocuments[doc].content
    delete after.policyDocuments[doc].content
  }
  assert.deepEqual(after, value)
})

test('migration wording matches the code defaults and the terms page', () => {
  const after = applyMigration(JSON.parse(before.toString('utf8')))
  for (const doc of ['refundPolicy', 'privacyPolicy']) {
    for (const line of after.policyDocuments[doc].content.split('\n')) {
      if (/페이앱|휴대폰 결제를/.test(line)) {
        assert.ok(footerDefaults.includes(line.replace(/^- /, '')), line)
      }
    }
  }
  assert.doesNotMatch(footerDefaults, /카카오페이/)
  assert.doesNotMatch(termsPage, /카카오페이/)
  assert.match(footerDefaults, /카카오 로그인/)
})

test('migration is guarded, updates only the two fixed paths and verifies the result', () => {
  assert.match(migrationCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.equal((migrationCode.match(/md5\(value::text\) = c_expected_md5/g) ?? []).length, 2)
  for (const [, oldName] of PAIRS) {
    assert.match(migrationCode, new RegExp(`/ length\\(${oldName}\\) IS DISTINCT FROM 1`), oldName)
  }
  assert.match(migrationCode, /jsonb_set\(value, '\{policyDocuments,refundPolicy,content\}'/)
  assert.match(migrationCode, /'\{policyDocuments,privacyPolicy,content\}', to_jsonb\(v_privacy\)\)/)
  assert.match(migrationCode, /IF v_count <> 1 THEN/)
  assert.match(migrationCode, /position\('카카오페이' IN v_text\) > 0/)
  assert.match(migrationCode, /RAISE EXCEPTION 'VERIFY: unrelated footer content changed'/)
  assert.doesNotMatch(migrationCode, /\bCASCADE\b|^\s*(BEGIN|COMMIT)\s*;|payment_methods|kakaopay_accepts_new_orders/im)
  assert.match(migrationCode.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('rollback restores the exact before value', () => {
  for (const [, oldName, newName] of PAIRS) {
    assert.equal(constant(rollback, oldName), constant(migration, oldName), oldName)
    // 지운 위탁 줄(c_privacy_new = '')은 되돌리기에서 c_privacy_anchor 뒤에 다시 넣는다.
    if (newName !== 'c_privacy_new') assert.equal(constant(rollback, newName), constant(migration, newName), newName)
  }
  const anchor = constant(rollback, 'c_privacy_anchor')
  const value = JSON.parse(before.toString('utf8'))
  const after = applyMigration(value)
  assert.equal(count(after.policyDocuments.privacyPolicy.content, anchor), 1)

  // 되돌리기와 같은 치환을 한 뒤 원문과 같아야 한다.
  const restored = structuredClone(after)
  const refund = restored.policyDocuments.refundPolicy
  refund.content = refund.content
    .replace(constant(rollback, 'c_refund_methods_new'), constant(rollback, 'c_refund_methods_old'))
    .replace(constant(rollback, 'c_refund_pg_new'), constant(rollback, 'c_refund_pg_old'))
  const privacy = restored.policyDocuments.privacyPolicy
  privacy.content = privacy.content.replace(anchor, anchor + constant(rollback, 'c_privacy_old'))
  assert.deepEqual(restored, value)

  assert.match(rollback, /IF md5\(v_restored::text\) IS DISTINCT FROM c_original_md5 THEN/)
  assert.match(rollback, /WHERE key = 'site_footer_content'\n\s+FOR UPDATE;/)
  assert.match(rollback.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})
